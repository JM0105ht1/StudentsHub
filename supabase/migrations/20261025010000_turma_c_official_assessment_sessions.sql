-- ==============================================================================
-- STUDENTS HUB — SESSÕES DE AVALIAÇÕES OFICIAIS + 1.ª TENTATIVA LIGADA À SESSÃO
-- Princípio Sagrado: «SEMPRE COM BASE NOS APONTAMENTOS OFICIAIS!!!»
-- Migração INCREMENTAL. Reutiliza a correção existente (submit_exercise_session_answers_atomic).
--
--  1. Liga sessões a avaliações oficiais (exame P1/P2/P3 ou conjunto) e exercícios-cópia à origem.
--  2. start_official_assessment_session: cria sessão com CÓPIAS dos exercícios oficiais publicados
--     (com a proveniência oficial copiada), cotação = cotação oficial da avaliação.
--  3. A 1.ª tentativa só pode ser registada com sessão concluída, do próprio aluno, ligada à
--     MESMA avaliação, sem itens pendentes de revisão e com a nota calculada pelo servidor.
--  4. submit_session_and_record_first_attempt: corrige + regista 1.ª tentativa na mesma transação.
--  5. Remove funções MORTAS do antigo sistema de apontamentos pessoais/OCR (sem tocar em dados).
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. COLUNAS DE LIGAÇÃO
-- ------------------------------------------------------------------------------
ALTER TABLE public.exercise_sessions
  ADD COLUMN IF NOT EXISTS official_assessment_id uuid,
  ADD COLUMN IF NOT EXISTS official_assessment_type text;

ALTER TABLE public.exercise_sessions
  DROP CONSTRAINT IF EXISTS chk_session_official_assessment_pair;
ALTER TABLE public.exercise_sessions
  ADD CONSTRAINT chk_session_official_assessment_pair
  CHECK ((official_assessment_id IS NULL) = (official_assessment_type IS NULL));

ALTER TABLE public.exercise_sessions
  DROP CONSTRAINT IF EXISTS fk_session_official_assessment;
ALTER TABLE public.exercise_sessions
  ADD CONSTRAINT fk_session_official_assessment
  FOREIGN KEY (official_assessment_id, official_assessment_type)
  REFERENCES public.official_assessments(id, assessment_type) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_sessions_user_official_assessment
  ON public.exercise_sessions (user_id, official_assessment_type, official_assessment_id)
  WHERE official_assessment_id IS NOT NULL;

ALTER TABLE public.exercises
  ADD COLUMN IF NOT EXISTS origin_exercise_id uuid REFERENCES public.exercises(id) ON DELETE SET NULL;

-- Alunos (papéis authenticated/anon) nunca podem forjar a ligação a uma avaliação oficial
-- nem a origem de um exercício; só as RPCs SECURITY DEFINER (dono da função) o fazem.
CREATE OR REPLACE FUNCTION public.guard_official_session_binding()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER -- current_user tem de ser o papel de quem chama (authenticated/anon)
SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    IF TG_OP = 'INSERT' AND NEW.official_assessment_id IS NOT NULL THEN
      RAISE EXCEPTION 'Violação de Integridade: sessões de avaliações oficiais só podem ser criadas por start_official_assessment_session.';
    END IF;
    IF TG_OP = 'UPDATE' AND (
         NEW.official_assessment_id IS DISTINCT FROM OLD.official_assessment_id
      OR NEW.official_assessment_type IS DISTINCT FROM OLD.official_assessment_type) THEN
      RAISE EXCEPTION 'Violação de Integridade: a ligação da sessão à avaliação oficial é imutável.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_official_session_binding ON public.exercise_sessions;
CREATE TRIGGER trg_guard_official_session_binding
BEFORE INSERT OR UPDATE ON public.exercise_sessions
FOR EACH ROW EXECUTE FUNCTION public.guard_official_session_binding();

CREATE OR REPLACE FUNCTION public.guard_exercise_origin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER -- current_user tem de ser o papel de quem chama (authenticated/anon)
SET search_path = public, pg_temp
AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    IF (TG_OP = 'INSERT' AND NEW.origin_exercise_id IS NOT NULL)
       OR (TG_OP = 'UPDATE' AND NEW.origin_exercise_id IS DISTINCT FROM OLD.origin_exercise_id) THEN
      RAISE EXCEPTION 'Violação de Integridade: origin_exercise_id só é definido pelo servidor.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_exercise_origin ON public.exercises;
CREATE TRIGGER trg_guard_exercise_origin
BEFORE INSERT OR UPDATE ON public.exercises
FOR EACH ROW EXECUTE FUNCTION public.guard_exercise_origin();

-- ------------------------------------------------------------------------------
-- 2. INICIAR SESSÃO DE AVALIAÇÃO OFICIAL (exame P1/P2/P3 ou conjunto)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.start_official_assessment_session(
  p_assessment_type text,
  p_assessment_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_assessment RECORD;
  v_existing uuid;
  v_session_id uuid;
  v_n integer;
  v_sum numeric;
  v_base numeric;
  v_idx integer := 0;
  v_src RECORD;
  v_src_list jsonb;
  v_new_id uuid;
  v_points numeric;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Não autorizado: Identidade de autenticação ausente.';
  END IF;

  IF p_assessment_type NOT IN ('exam', 'exercise_set') THEN
    RAISE EXCEPTION 'Tipo de avaliação inválido: %.', p_assessment_type;
  END IF;

  SELECT id, assessment_type, subject_id, title, is_published, total_points INTO v_assessment
  FROM public.official_assessments
  WHERE id = p_assessment_id AND assessment_type = p_assessment_type;

  IF NOT FOUND OR v_assessment.is_published IS NOT TRUE THEN
    RAISE EXCEPTION 'Avaliação oficial inexistente ou não publicada.';
  END IF;

  -- Retomar sessão em curso (evita duplicados); repetir após concluir é permitido
  SELECT id INTO v_existing
  FROM public.exercise_sessions
  WHERE user_id = v_uid AND official_assessment_id = p_assessment_id
    AND official_assessment_type = p_assessment_type AND status = 'in_progress'
  ORDER BY created_at DESC LIMIT 1;

  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('session_id', v_existing, 'resumed', true);
  END IF;

  -- Exercícios da avaliação, por ordem (jsonb: evita tabelas temporárias)
  IF p_assessment_type = 'exam' THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object('exercise_id', ee.exercise_id, 'ord', ee.order_index, 'pts', ee.allocated_points) ORDER BY ee.order_index), '[]'::jsonb)
    INTO v_src_list
    FROM public.official_exam_exercises ee WHERE ee.exam_id = p_assessment_id;
  ELSE
    SELECT COALESCE(jsonb_agg(jsonb_build_object('exercise_id', se.exercise_id, 'ord', se.order_index, 'pts', NULL) ORDER BY se.order_index), '[]'::jsonb)
    INTO v_src_list
    FROM public.official_set_exercises se WHERE se.set_id = p_assessment_id;
  END IF;

  v_n := jsonb_array_length(v_src_list);
  IF v_n = 0 THEN
    RAISE EXCEPTION 'A avaliação oficial não tem exercícios.';
  END IF;

  -- Todos os exercícios têm de ser oficiais, publicados e com proveniência oficial
  IF EXISTS (
    SELECT 1 FROM jsonb_to_recordset(v_src_list) AS s(exercise_id uuid, ord integer, pts numeric)
    LEFT JOIN public.exercises e ON e.id = s.exercise_id
    WHERE e.id IS NULL OR e.is_official IS NOT TRUE OR e.status <> 'published'
       OR NOT EXISTS (SELECT 1 FROM public.exercise_source_references r
                      WHERE r.exercise_id = e.id AND r.source_type = 'official')
  ) THEN
    RAISE EXCEPTION 'A avaliação contém exercícios não publicados ou sem proveniência nos apontamentos oficiais.';
  END IF;

  IF p_assessment_type = 'exam' THEN
    SELECT SUM(pts) INTO v_sum FROM jsonb_to_recordset(v_src_list) AS s(exercise_id uuid, ord integer, pts numeric);
    IF v_sum IS DISTINCT FROM v_assessment.total_points THEN
      RAISE EXCEPTION 'Cotação inconsistente: soma das cotações (%) difere do total oficial (%).', v_sum, v_assessment.total_points;
    END IF;
  ELSE
    v_base := trunc(v_assessment.total_points / v_n, 2);
  END IF;

  INSERT INTO public.exercise_sessions (
    user_id, subject_id, title, mode, status, official_assessment_id, official_assessment_type
  ) VALUES (
    v_uid, v_assessment.subject_id, v_assessment.title,
    CASE WHEN p_assessment_type = 'exam' THEN 'exam' ELSE 'study' END,
    'in_progress', p_assessment_id, p_assessment_type
  ) RETURNING id INTO v_session_id;

  FOR v_src IN SELECT * FROM jsonb_to_recordset(v_src_list) AS s(exercise_id uuid, ord integer, pts numeric) ORDER BY ord
  LOOP
    v_idx := v_idx + 1;
    v_new_id := gen_random_uuid();

    IF p_assessment_type = 'exam' THEN
      v_points := v_src.pts;
    ELSIF v_idx < v_n THEN
      v_points := v_base;
    ELSE
      v_points := v_assessment.total_points - v_base * (v_n - 1);
    END IF;

    INSERT INTO public.exercises (
      id, session_id, user_id, subject_id, academic_period, prompt, question_type, options,
      correct_answer, scoring_rubric, max_points, difficulty,
      is_official, status, created_by_role, origin_exercise_id
    )
    SELECT v_new_id, v_session_id, v_uid, e.subject_id, e.academic_period, e.prompt, e.question_type, e.options,
           e.correct_answer, e.scoring_rubric, v_points, e.difficulty,
           false, 'published', 'student', e.id
    FROM public.exercises e WHERE e.id = v_src.exercise_id;

    INSERT INTO public.exercise_source_references (
      exercise_id, user_id, source_type, official_note_id, official_version_id,
      content_hash, quote_excerpt, official_section
    )
    SELECT v_new_id, v_uid, 'official', r.official_note_id, r.official_version_id,
           r.content_hash, r.quote_excerpt, r.official_section
    FROM public.exercise_source_references r
    WHERE r.exercise_id = v_src.exercise_id AND r.source_type = 'official'
    LIMIT 1;
  END LOOP;

  RETURN jsonb_build_object('session_id', v_session_id, 'resumed', false, 'exercise_count', v_n);
END;
$$;

REVOKE ALL ON FUNCTION public.start_official_assessment_session(text, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.start_official_assessment_session(text, uuid) TO authenticated;

-- ------------------------------------------------------------------------------
-- 2b. SESSÃO DE TREINO LIVRE (exercícios oficiais publicados da disciplina)
--     Sessão REAL no servidor (nunca um id gerado no cliente). Não conta para
--     a 1.ª tentativa oficial nem para o leaderboard.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.start_official_practice_session(
  p_subject_id text,
  p_academic_period text DEFAULT NULL,
  p_count integer DEFAULT 5,
  p_question_type text DEFAULT NULL,
  p_difficulty text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_session_id uuid;
  v_subject_name text;
  v_n integer := 0;
  v_ex RECORD;
  v_new_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Não autorizado: Identidade de autenticação ausente.';
  END IF;

  IF p_count IS NULL OR p_count < 1 OR p_count > 15 THEN
    RAISE EXCEPTION 'O número de exercícios deve estar entre 1 e 15.';
  END IF;

  SELECT name INTO v_subject_name FROM public.subjects WHERE id = p_subject_id;
  IF v_subject_name IS NULL THEN
    RAISE EXCEPTION 'Disciplina inválida.';
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS _practice_pick (id uuid) ON COMMIT DROP;
  DELETE FROM _practice_pick;
  INSERT INTO _practice_pick
  SELECT e.id
  FROM public.exercises e
  WHERE e.is_official = true AND e.status = 'published' AND e.session_id IS NULL
    AND e.subject_id = p_subject_id
    AND (p_academic_period IS NULL OR e.academic_period = p_academic_period)
    AND (p_question_type IS NULL OR p_question_type = 'mixed' OR e.question_type = p_question_type)
    AND (p_difficulty IS NULL OR p_difficulty = 'mixed' OR e.difficulty = p_difficulty)
    AND EXISTS (SELECT 1 FROM public.exercise_source_references r
                WHERE r.exercise_id = e.id AND r.source_type = 'official')
  ORDER BY random()
  LIMIT p_count;

  IF NOT EXISTS (SELECT 1 FROM _practice_pick) THEN
    RAISE EXCEPTION 'Sem exercícios oficiais publicados para estes filtros.';
  END IF;

  INSERT INTO public.exercise_sessions (user_id, subject_id, title, mode, status)
  VALUES (v_uid, p_subject_id, 'Treino · ' || v_subject_name, 'study', 'in_progress')
  RETURNING id INTO v_session_id;

  FOR v_ex IN SELECT id FROM _practice_pick
  LOOP
    v_new_id := gen_random_uuid();
    INSERT INTO public.exercises (
      id, session_id, user_id, subject_id, academic_period, prompt, question_type, options,
      correct_answer, scoring_rubric, max_points, difficulty,
      is_official, status, created_by_role, origin_exercise_id
    )
    SELECT v_new_id, v_session_id, v_uid, e.subject_id, e.academic_period, e.prompt, e.question_type, e.options,
           e.correct_answer, e.scoring_rubric, e.max_points, e.difficulty,
           false, 'published', 'student', e.id
    FROM public.exercises e WHERE e.id = v_ex.id;

    INSERT INTO public.exercise_source_references (
      exercise_id, user_id, source_type, official_note_id, official_version_id,
      content_hash, quote_excerpt, official_section
    )
    SELECT v_new_id, v_uid, 'official', r.official_note_id, r.official_version_id,
           r.content_hash, r.quote_excerpt, r.official_section
    FROM public.exercise_source_references r
    WHERE r.exercise_id = v_ex.id AND r.source_type = 'official'
    LIMIT 1;
    v_n := v_n + 1;
  END LOOP;

  RETURN jsonb_build_object('session_id', v_session_id, 'exercise_count', v_n);
END;
$$;

REVOKE ALL ON FUNCTION public.start_official_practice_session(text, text, integer, text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.start_official_practice_session(text, text, integer, text, text) TO authenticated;

-- ------------------------------------------------------------------------------
-- 3. 1.ª TENTATIVA: SÓ COM SESSÃO LIGADA, CONCLUÍDA E CALCULADA PELO SERVIDOR
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_first_attempt_session_binding()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_session RECORD;
BEGIN
  -- Administradores (auditoria/manutenção) ficam isentos; alunos nunca declaram a nota
  IF public.is_admin() THEN
    RETURN NEW;
  END IF;

  IF NEW.session_id IS NULL THEN
    RAISE EXCEPTION 'Violação de Integridade: a 1.ª tentativa oficial exige uma sessão corrigida pelo servidor.';
  END IF;

  SELECT user_id, status, score, max_score, official_assessment_id, official_assessment_type
  INTO v_session
  FROM public.exercise_sessions WHERE id = NEW.session_id;

  IF NOT FOUND OR v_session.user_id <> NEW.user_id THEN
    RAISE EXCEPTION 'Violação de Integridade: sessão inexistente ou de outro aluno.';
  END IF;

  IF v_session.official_assessment_id IS DISTINCT FROM NEW.assessment_id
     OR v_session.official_assessment_type IS DISTINCT FROM NEW.assessment_type THEN
    RAISE EXCEPTION 'Violação de Integridade: a sessão não corresponde à avaliação oficial indicada.';
  END IF;

  IF v_session.status <> 'completed'
     OR v_session.score IS DISTINCT FROM NEW.score_achieved
     OR v_session.max_score IS DISTINCT FROM NEW.max_score THEN
    RAISE EXCEPTION 'Violação de Integridade: a nota não coincide com a sessão concluída e corrigida.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.exercise_attempts a
    WHERE a.session_id = NEW.session_id AND a.review_status = 'pending_review'
  ) THEN
    RAISE EXCEPTION 'Violação de Integridade: existem respostas pendentes de revisão; a 1.ª tentativa só é registada com nota final.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_first_attempt_session_binding ON public.official_first_attempts;
CREATE TRIGGER trg_enforce_first_attempt_session_binding
BEFORE INSERT ON public.official_first_attempts
FOR EACH ROW EXECUTE FUNCTION public.enforce_first_attempt_session_binding();

-- ------------------------------------------------------------------------------
-- 4. CORRIGIR + REGISTAR 1.ª TENTATIVA NA MESMA TRANSAÇÃO
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_session_and_record_first_attempt(
  p_session_id uuid,
  p_answers jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_result jsonb;
  v_session RECORD;
  v_official jsonb := '{}'::jsonb;
  v_pending integer;
BEGIN
  v_result := public.submit_exercise_session_answers_atomic(p_session_id, p_answers);

  SELECT user_id, official_assessment_id, official_assessment_type, score, max_score
  INTO v_session FROM public.exercise_sessions WHERE id = p_session_id;

  IF v_session.official_assessment_id IS NOT NULL THEN
    v_pending := COALESCE((v_result->>'pending_count')::integer, 0);

    IF EXISTS (
      SELECT 1 FROM public.official_first_attempts
      WHERE user_id = v_session.user_id
        AND assessment_type = v_session.official_assessment_type
        AND assessment_id = v_session.official_assessment_id
    ) THEN
      v_official := jsonb_build_object('recorded', false, 'reason', 'repeat_attempt');
    ELSIF v_pending > 0 THEN
      v_official := jsonb_build_object('recorded', false, 'reason', 'pending_review');
    ELSE
      PERFORM public.record_official_first_attempt(
        v_session.official_assessment_id, v_session.official_assessment_type,
        v_session.score, v_session.max_score, p_session_id
      );
      v_official := jsonb_build_object('recorded', true, 'reason', 'first_attempt');
    END IF;
  END IF;

  RETURN v_result || jsonb_build_object('official', v_official);
END;
$$;

REVOKE ALL ON FUNCTION public.submit_session_and_record_first_attempt(uuid, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.submit_session_and_record_first_attempt(uuid, jsonb) TO authenticated;

-- ------------------------------------------------------------------------------
-- 5. REMOÇÃO DE FUNÇÕES MORTAS DO SISTEMA ANTIGO (apontamentos pessoais / OCR)
--    Não remove dados: as tabelas já foram eliminadas na Fase B3 e estas funções
--    referenciam tabelas inexistentes. Dados oficiais, proveniência, auditorias e
--    avaliações permanecem intactos.
-- ------------------------------------------------------------------------------
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'get_authorized_note_chunks',
        'confirm_note_page_atomic',
        'create_exercise_session_with_exercises_atomic',
        'protect_raw_ocr_immutability',
        'validate_note_chunk_source'
      )
  LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || r.sig::text;
  END LOOP;
END $$;
