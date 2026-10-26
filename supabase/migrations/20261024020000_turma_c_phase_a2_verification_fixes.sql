-- ==============================================================================
-- STUDENTS HUB — FASE A.2: CORREÇÕES E BLINDAGEM FINAL DE VERIFICAÇÃO
-- Slogan: "Apontamentos que ajudam, exercícios que resultam. Rumo ao 20."
-- Princípio Sagrado: «SEMPRE COM BASE NOS APONTAMENTOS OFICIAIS!!!»
-- Migração Incremental, Não-Destrutiva e Reversível
-- ==============================================================================

-- 1. HARDENING DE IMUTABILIDADE DA ESTRUTURA DE EXAMES OFICIAIS
-- Garante que após existirem tentativas de alunos:
-- a) Não é permitido inserir, alterar ou remover exercícios (INSERT / UPDATE / DELETE)
-- b) Não é permitido alterar total_points, duration_minutes ou eliminar o exame em si
CREATE OR REPLACE FUNCTION public.protect_published_exam_immutability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_has_attempts boolean;
  v_exam_id uuid;
BEGIN
  v_exam_id := COALESCE(OLD.exam_id, NEW.exam_id);
  SELECT EXISTS (
    SELECT 1 FROM public.official_first_attempts
    WHERE assessment_type = 'exam' AND assessment_id = v_exam_id
  ) INTO v_has_attempts;

  IF v_has_attempts THEN
    RAISE EXCEPTION 'Violação de Integridade: O exame já possui tentativas registadas por alunos e a sua estrutura é imutável. Crie uma nova versão para alterar exercícios.';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_exam_exercises_immutability ON public.official_exam_exercises;
CREATE TRIGGER trg_protect_exam_exercises_immutability
BEFORE INSERT OR UPDATE OR DELETE ON public.official_exam_exercises
FOR EACH ROW
EXECUTE FUNCTION public.protect_published_exam_immutability();

-- Trigger de proteção na própria tabela official_exams
CREATE OR REPLACE FUNCTION public.protect_official_exam_header_immutability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_has_attempts boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.official_first_attempts
      WHERE assessment_type = 'exam' AND assessment_id = OLD.id
    ) INTO v_has_attempts;

    IF v_has_attempts THEN
      RAISE EXCEPTION 'Violação de Integridade: Não é permitido eliminar um exame oficial que já possui tentativas registadas por alunos.';
    END IF;
    RETURN OLD;

  ELSIF TG_OP = 'UPDATE' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.official_first_attempts
      WHERE assessment_type = 'exam' AND assessment_id = OLD.id
    ) INTO v_has_attempts;

    IF v_has_attempts THEN
      IF (NEW.total_points IS DISTINCT FROM OLD.total_points) OR
         (NEW.duration_minutes IS DISTINCT FROM OLD.duration_minutes) OR
         (NEW.subject_id IS DISTINCT FROM OLD.subject_id) THEN
        RAISE EXCEPTION 'Violação de Integridade: Não é permitido alterar a cotação total, duração ou disciplina de um exame oficial com tentativas registadas.';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_official_exam_header_immutability ON public.official_exams;
CREATE TRIGGER trg_protect_official_exam_header_immutability
BEFORE UPDATE OR DELETE ON public.official_exams
FOR EACH ROW
EXECUTE FUNCTION public.protect_official_exam_header_immutability();

-- 2. HARDENING DE IMUTABILIDADE DE CONJUNTOS DE EXERCÍCIOS OFICIAIS
CREATE OR REPLACE FUNCTION public.protect_official_set_immutability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_has_attempts boolean;
  v_set_id uuid;
BEGIN
  v_set_id := COALESCE(OLD.set_id, NEW.set_id);
  SELECT EXISTS (
    SELECT 1 FROM public.official_first_attempts
    WHERE assessment_type = 'exercise_set' AND assessment_id = v_set_id
  ) INTO v_has_attempts;

  IF v_has_attempts THEN
    RAISE EXCEPTION 'Violação de Integridade: O conjunto de exercícios já possui tentativas registadas por alunos e a sua composição é imutável.';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_official_set_immutability ON public.official_set_exercises;
CREATE TRIGGER trg_protect_official_set_immutability
BEFORE INSERT OR UPDATE OR DELETE ON public.official_set_exercises
FOR EACH ROW
EXECUTE FUNCTION public.protect_official_set_immutability();

-- 3. HARDENING DO PROCEDIMENTO DE REGISTO: RECORD_OFFICIAL_FIRST_ATTEMPT
-- a) Valida que p_max_score coincide com total_points de official_assessments
-- b) Valida consistência estrita se p_session_id for fornecido
-- c) Atualiza deterministicamente o streak do aluno de acordo com o calendário diário
CREATE OR REPLACE FUNCTION public.record_official_first_attempt(
  p_assessment_id uuid,
  p_assessment_type text,
  p_score_achieved numeric,
  p_max_score numeric,
  p_session_id uuid DEFAULT NULL
)
RETURNS public.official_first_attempts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid;
  v_assessment RECORD;
  v_percentage numeric(5,2);
  v_scale_20 numeric(4,2);
  v_new_attempt public.official_first_attempts;
  v_already_exists boolean;
  v_session RECORD;
  v_last_study_date date;
  v_current_streak integer;
  v_new_streak integer;
BEGIN
  -- 1. Obter e validar identidade do utilizador autenticado
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Não autorizado: Identidade de autenticação ausente.';
  END IF;

  -- 2. Validar tipo de avaliação
  IF p_assessment_type NOT IN ('exam', 'exercise_set') THEN
    RAISE EXCEPTION 'Tipo de avaliação inválido: %. Valores aceites: exam, exercise_set.', p_assessment_type;
  END IF;

  -- 3. Validar limites matemáticos e não-negatividade estrita
  IF p_max_score IS NULL OR p_max_score <= 0 THEN
    RAISE EXCEPTION 'A pontuação máxima deve ser estritamente superior a zero. Recebido: %', p_max_score;
  END IF;

  IF p_score_achieved IS NULL OR p_score_achieved < 0 THEN
    RAISE EXCEPTION 'A pontuação obtida não pode ser negativa. Recebido: %', p_score_achieved;
  END IF;

  IF p_score_achieved > p_max_score THEN
    RAISE EXCEPTION 'A pontuação obtida (%) não pode exceder a pontuação máxima (%).', p_score_achieved, p_max_score;
  END IF;

  -- 4. Validar existência e publicação da avaliação oficial na entidade comum
  SELECT id, assessment_type, is_published, total_points
  INTO v_assessment
  FROM public.official_assessments
  WHERE id = p_assessment_id AND assessment_type = p_assessment_type;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Avaliação oficial inexistente ou não registada: id=% tipo=%', p_assessment_id, p_assessment_type;
  END IF;

  IF NOT v_assessment.is_published AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Não é permitido submeter tentativas para avaliações oficiais não publicadas.';
  END IF;

  -- Validação estrita: a pontuação máxima deve coincidir com a cotação oficial da avaliação
  IF p_max_score <> v_assessment.total_points THEN
    RAISE EXCEPTION 'Violação de Integridade: A pontuação máxima informada (%) difere da cotação oficial da avaliação (%).', p_max_score, v_assessment.total_points;
  END IF;

  -- 5. Se houver session_id associado, validar integridade estrita com exercise_sessions
  IF p_session_id IS NOT NULL THEN
    SELECT id, user_id, status, score, max_score
    INTO v_session
    FROM public.exercise_sessions
    WHERE id = p_session_id AND user_id = v_user_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Sessão de exercícios inválida ou não pertence ao aluno autenticado.';
    END IF;

    IF v_session.status <> 'completed' THEN
      RAISE EXCEPTION 'A sessão de avaliação associada ainda não foi concluída e avaliada pelo servidor.';
    END IF;

    -- Se o aluno não for admin, a pontuação obtida deve corresponder exatamente à pontuação avaliada pelo servidor na sessão
    IF NOT public.is_admin() AND v_session.score IS NOT NULL THEN
      IF p_score_achieved <> v_session.score THEN
        RAISE EXCEPTION 'Violação de Integridade: A pontuação obtida (%) diverge da pontuação avaliada na sessão oficial (%).', p_score_achieved, v_session.score;
      END IF;
    END IF;
  END IF;

  -- 6. Verificar atomicamente se já existe primeira tentativa (Garantia de Inviolabilidade)
  SELECT EXISTS (
    SELECT 1 FROM public.official_first_attempts
    WHERE user_id = v_user_id 
      AND assessment_type = p_assessment_type 
      AND assessment_id = p_assessment_id
  ) INTO v_already_exists;

  IF v_already_exists THEN
    RAISE EXCEPTION 'Violação de Inviolabilidade: Já existe uma 1.ª tentativa oficial registada para este aluno e avaliação. Tentativas posteriores não são elegíveis.';
  END IF;

  -- 7. Calcular estritamente no servidor a percentagem e escala de 0–20
  v_percentage := ROUND((p_score_achieved / p_max_score) * 100.0, 2);
  v_scale_20 := ROUND((p_score_achieved / p_max_score) * 20.0, 2);

  -- Validação de integridade pós-cálculo
  IF v_percentage < 0 OR v_percentage > 100 OR v_scale_20 < 0 OR v_scale_20 > 20 THEN
    RAISE EXCEPTION 'Erro de cálculo de pontuação: percentagem ou escala fora do domínio admitido.';
  END IF;

  -- 8. Inserir atomicamente o registo oficial
  INSERT INTO public.official_first_attempts (
    user_id,
    assessment_type,
    assessment_id,
    session_id,
    score_achieved,
    max_score,
    score_percentage,
    score_scale_20,
    is_first_attempt,
    completed_at
  ) VALUES (
    v_user_id,
    p_assessment_type,
    p_assessment_id,
    p_session_id,
    p_score_achieved,
    p_max_score,
    v_percentage,
    v_scale_20,
    true,
    now()
  )
  RETURNING * INTO v_new_attempt;

  -- 9. Calcular e atualizar streak e study_stats de forma determinística
  SELECT last_study_date, streak_days
  INTO v_last_study_date, v_current_streak
  FROM public.study_stats
  WHERE user_id = v_user_id;

  IF v_last_study_date IS NULL THEN
    v_new_streak := 1;
  ELSIF v_last_study_date = CURRENT_DATE THEN
    v_new_streak := COALESCE(v_current_streak, 1);
  ELSIF v_last_study_date = CURRENT_DATE - 1 THEN
    v_new_streak := COALESCE(v_current_streak, 0) + 1;
  ELSE
    -- Quebrou a sequência diária de estudo
    v_new_streak := 1;
  END IF;

  UPDATE public.study_stats
  SET exercises_solved = exercises_solved + 1,
      streak_days = v_new_streak,
      last_study_date = CURRENT_DATE,
      updated_at = now()
  WHERE user_id = v_user_id;

  RETURN v_new_attempt;
END;
$$;

-- 4. REVOGAÇÃO DE PRIVILÉGIOS DE EXECUÇÃO EM FUNÇÕES DE TRIGGER
-- Funções de trigger nunca devem ter GRANT EXECUTE público ou direto
REVOKE EXECUTE ON FUNCTION public.protect_first_attempt_insert() FROM PUBLIC, authenticated, anon;
REVOKE EXECUTE ON FUNCTION public.protect_study_stats_tampering() FROM PUBLIC, authenticated, anon;
REVOKE EXECUTE ON FUNCTION public.protect_official_exercise_integrity() FROM PUBLIC, authenticated, anon;
REVOKE EXECUTE ON FUNCTION public.protect_published_exam_immutability() FROM PUBLIC, authenticated, anon;
REVOKE EXECUTE ON FUNCTION public.protect_published_note_version_immutability() FROM PUBLIC, authenticated, anon;
REVOKE EXECUTE ON FUNCTION public.protect_official_note_version_deletion() FROM PUBLIC, authenticated, anon;
REVOKE EXECUTE ON FUNCTION public.sync_exam_to_assessments() FROM PUBLIC, authenticated, anon;
REVOKE EXECUTE ON FUNCTION public.sync_set_to_assessments() FROM PUBLIC, authenticated, anon;
REVOKE EXECUTE ON FUNCTION public.protect_official_exam_header_immutability() FROM PUBLIC, authenticated, anon;
REVOKE EXECUTE ON FUNCTION public.protect_official_set_immutability() FROM PUBLIC, authenticated, anon;
