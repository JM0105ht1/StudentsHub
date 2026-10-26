-- ==============================================================================
-- STUDENTS HUB — FASE A.1: AUDITORIA CORRETIVA DE SEGURANÇA E INTEGRIDADE
-- Slogan: "Apontamentos que ajudam, exercícios que resultam. Rumo ao 20."
-- Princípio Sagrado: «SEMPRE COM BASE NOS APONTAMENTOS OFICIAIS!!!»
-- Migração Incremental, Não-Destrutiva e Reversível
-- ==============================================================================

-- 1. TABELA DE REGISTO UNIFICADO DE AVALIAÇÕES OFICIAIS (OFFICIAL_ASSESSMENTS)
-- Resolve a integridade relacional entre official_first_attempts e as avaliações reais
-- (exames e conjuntos de exercícios), eliminando chaves estrangeiras fictícias ou polimórficas soltas.
CREATE TABLE IF NOT EXISTS public.official_assessments (
  id uuid NOT NULL,
  assessment_type text NOT NULL CHECK (assessment_type IN ('exam', 'exercise_set')),
  subject_id text NOT NULL REFERENCES public.subjects(id) ON DELETE RESTRICT,
  title text NOT NULL CHECK (char_length(trim(title)) > 0),
  is_published boolean NOT NULL DEFAULT false,
  total_points numeric(5,2) NOT NULL DEFAULT 20.00 CHECK (total_points > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, assessment_type)
);

-- Povoar official_assessments a partir dos exames e conjuntos existentes
INSERT INTO public.official_assessments (id, assessment_type, subject_id, title, is_published, total_points, created_at, updated_at)
SELECT id, 'exam', subject_id, title, is_published, total_points, created_at, updated_at
FROM public.official_exams
ON CONFLICT (id, assessment_type) DO UPDATE SET
  title = EXCLUDED.title,
  is_published = EXCLUDED.is_published,
  total_points = EXCLUDED.total_points,
  updated_at = now();

INSERT INTO public.official_assessments (id, assessment_type, subject_id, title, is_published, total_points, created_at, updated_at)
SELECT id, 'exercise_set', subject_id, title, is_published, 20.00, created_at, updated_at
FROM public.official_exercise_sets
ON CONFLICT (id, assessment_type) DO UPDATE SET
  title = EXCLUDED.title,
  is_published = EXCLUDED.is_published,
  updated_at = now();

-- 2. TRIGGERS DE SINCRONIZAÇÃO AUTOMÁTICA DE AVALIAÇÕES OFICIAIS
-- Mantêm official_assessments permanentemente sincronizada com official_exams e official_exercise_sets
CREATE OR REPLACE FUNCTION public.sync_exam_to_assessments()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.official_assessments (id, assessment_type, subject_id, title, is_published, total_points, created_at, updated_at)
    VALUES (NEW.id, 'exam', NEW.subject_id, NEW.title, NEW.is_published, NEW.total_points, NEW.created_at, NEW.updated_at)
    ON CONFLICT (id, assessment_type) DO UPDATE SET
      title = EXCLUDED.title,
      is_published = EXCLUDED.is_published,
      total_points = EXCLUDED.total_points,
      updated_at = now();
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    UPDATE public.official_assessments
    SET title = NEW.title,
        is_published = NEW.is_published,
        total_points = NEW.total_points,
        subject_id = NEW.subject_id,
        updated_at = now()
    WHERE id = NEW.id AND assessment_type = 'exam';
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    DELETE FROM public.official_assessments WHERE id = OLD.id AND assessment_type = 'exam';
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_exam_to_assessments ON public.official_exams;
CREATE TRIGGER trg_sync_exam_to_assessments
AFTER INSERT OR UPDATE OR DELETE ON public.official_exams
FOR EACH ROW EXECUTE FUNCTION public.sync_exam_to_assessments();

CREATE OR REPLACE FUNCTION public.sync_set_to_assessments()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.official_assessments (id, assessment_type, subject_id, title, is_published, total_points, created_at, updated_at)
    VALUES (NEW.id, 'exercise_set', NEW.subject_id, NEW.title, NEW.is_published, 20.00, NEW.created_at, NEW.updated_at)
    ON CONFLICT (id, assessment_type) DO UPDATE SET
      title = EXCLUDED.title,
      is_published = EXCLUDED.is_published,
      updated_at = now();
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    UPDATE public.official_assessments
    SET title = NEW.title,
        is_published = NEW.is_published,
        subject_id = NEW.subject_id,
        updated_at = now()
    WHERE id = NEW.id AND assessment_type = 'exercise_set';
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    DELETE FROM public.official_assessments WHERE id = OLD.id AND assessment_type = 'exercise_set';
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_set_to_assessments ON public.official_exercise_sets;
CREATE TRIGGER trg_sync_set_to_assessments
AFTER INSERT OR UPDATE OR DELETE ON public.official_exercise_sets
FOR EACH ROW EXECUTE FUNCTION public.sync_set_to_assessments();

-- RLS em official_assessments
ALTER TABLE public.official_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.official_assessments FORCE ROW LEVEL SECURITY;

CREATE POLICY "official_assessments_select_published"
  ON public.official_assessments FOR SELECT
  TO authenticated
  USING (is_published = true OR public.is_admin());

CREATE POLICY "official_assessments_admin_all"
  ON public.official_assessments FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- 3. CHAVE ESTRANGEIRA REAL ENTRE OFFICIAL_FIRST_ATTEMPTS E OFFICIAL_ASSESSMENTS
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_official_first_attempts_assessment'
      AND table_name = 'official_first_attempts'
  ) THEN
    ALTER TABLE public.official_first_attempts
      ADD CONSTRAINT fk_official_first_attempts_assessment
      FOREIGN KEY (assessment_id, assessment_type)
      REFERENCES public.official_assessments(id, assessment_type)
      ON DELETE RESTRICT;
  END IF;
END $$;

-- 4. BLINDAGEM CONTRA FALSIFICAÇÃO GUC (app.evaluating_attempt) E REVOGAÇÃO DE ESCRITA DIRETA
-- Remove a dependência insegura da variável de sessão GUC
DROP TRIGGER IF EXISTS trg_protect_first_attempt_insert ON public.official_first_attempts;

CREATE OR REPLACE FUNCTION public.protect_first_attempt_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Validação estrita de limites numéricos e integridade
  IF NEW.score_achieved < 0 THEN
    RAISE EXCEPTION 'A pontuação obtida não pode ser negativa.';
  END IF;

  IF NEW.max_score <= 0 THEN
    RAISE EXCEPTION 'A pontuação máxima deve ser estritamente superior a zero.';
  END IF;

  IF NEW.score_achieved > NEW.max_score THEN
    RAISE EXCEPTION 'A pontuação obtida não pode ser superior à pontuação máxima.';
  END IF;

  IF NEW.score_percentage < 0 OR NEW.score_percentage > 100 THEN
    RAISE EXCEPTION 'A percentagem deve estar compreendida entre 0.00 e 100.00.';
  END IF;

  IF NEW.score_scale_20 < 0 OR NEW.score_scale_20 > 20 THEN
    RAISE EXCEPTION 'A escala de 0–20 deve estar compreendida entre 0.00 e 20.00.';
  END IF;

  -- Apenas administrador ou o contexto privilegiado do servidor (via SECURITY DEFINER) podem inserir
  IF NOT public.is_admin() AND session_user = 'authenticated' THEN
    RAISE EXCEPTION 'Violação de Segurança: A 1.ª tentativa oficial só pode ser registada pelo procedimento seguro do servidor (record_official_first_attempt). A inserção direta via SQL/API é expressamente proibida.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_protect_first_attempt_insert
BEFORE INSERT ON public.official_first_attempts
FOR EACH ROW EXECUTE FUNCTION public.protect_first_attempt_insert();

-- Revogar permissões diretas de manipulação para authenticated e anon
REVOKE INSERT, UPDATE, DELETE ON public.official_first_attempts FROM authenticated, anon;
GRANT SELECT ON public.official_first_attempts TO authenticated;

-- Eliminar políticas RLS permissivas anteriores que permitiam INSERT direto a alunos
DROP POLICY IF EXISTS "official_first_attempts_insert_system" ON public.official_first_attempts;
DROP POLICY IF EXISTS "official_first_attempts_update_trigger" ON public.official_first_attempts;

CREATE POLICY "official_first_attempts_insert_admin"
  ON public.official_first_attempts FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

-- 5. PROCEDIMENTO SEGURO SERVER-SIDE: RECORD_OFFICIAL_FIRST_ATTEMPT
-- Cálculo fidedigno no servidor, verificação de limites, atomicidade e registo da 1.ª tentativa
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

  -- 5. Verificar atomicamente se já existe primeira tentativa (Garantia de Inviolabilidade)
  SELECT EXISTS (
    SELECT 1 FROM public.official_first_attempts
    WHERE user_id = v_user_id 
      AND assessment_type = p_assessment_type 
      AND assessment_id = p_assessment_id
  ) INTO v_already_exists;

  IF v_already_exists THEN
    RAISE EXCEPTION 'Violação de Inviolabilidade: Já existe uma 1.ª tentativa oficial registada para este aluno e avaliação. Tentativas posteriores não são elegíveis.';
  END IF;

  -- 6. Calcular estritamente no servidor a percentagem e escala de 0–20
  v_percentage := ROUND((p_score_achieved / p_max_score) * 100.0, 2);
  v_scale_20 := ROUND((p_score_achieved / p_max_score) * 20.0, 2);

  -- Validação de integridade pós-cálculo
  IF v_percentage < 0 OR v_percentage > 100 OR v_scale_20 < 0 OR v_scale_20 > 20 THEN
    RAISE EXCEPTION 'Erro de cálculo de pontuação: percentagem ou escala fora do domínio admitido.';
  END IF;

  -- 7. Se houver session_id associado, validar integridade com exercise_sessions
  IF p_session_id IS NOT NULL THEN
    PERFORM 1 FROM public.exercise_sessions
    WHERE id = p_session_id AND user_id = v_user_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Sessão de exercícios inválida ou não pertence ao aluno autenticado.';
    END IF;
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

  -- 9. Atualizar study_stats do aluno no mesmo ciclo transacional
  UPDATE public.study_stats
  SET exercises_solved = exercises_solved + 1,
      updated_at = now()
  WHERE user_id = v_user_id;

  RETURN v_new_attempt;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_official_first_attempt(uuid, text, numeric, numeric, uuid) TO authenticated;

-- 6. IMUTABILIDADE DOCUMENTAL: PROTEÇÃO DE VERSÕES PUBLICADAS
-- Bloqueia alteração de conteúdo (raw_html, sanitized_html, plain_text_content) em versões já publicadas
CREATE OR REPLACE FUNCTION public.protect_published_note_version_immutability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.is_published = true THEN
    IF NEW.raw_html IS DISTINCT FROM OLD.raw_html OR
       NEW.sanitized_html IS DISTINCT FROM OLD.sanitized_html OR
       NEW.plain_text_content IS DISTINCT FROM OLD.plain_text_content OR
       NEW.version_number IS DISTINCT FROM OLD.version_number OR
       NEW.note_id IS DISTINCT FROM OLD.note_id THEN
      RAISE EXCEPTION 'Violação de Imutabilidade Documental: O conteúdo de uma versão publicada de apontamento oficial é estritamente imutável. Crie uma nova versão (ex: v%) para introduzir atualizações.', OLD.version_number + 1;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_published_note_version_immutability ON public.official_note_versions;
CREATE TRIGGER trg_protect_published_note_version_immutability
BEFORE UPDATE ON public.official_note_versions
FOR EACH ROW EXECUTE FUNCTION public.protect_published_note_version_immutability();

-- 7. PROTEÇÃO CONTRA ELIMINAÇÃO DE VERSÕES REFERENCIADAS POR EXERCÍCIOS
CREATE OR REPLACE FUNCTION public.protect_official_note_version_deletion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.exercise_source_references
    WHERE official_version_id = OLD.id
  ) THEN
    RAISE EXCEPTION 'Violação de Rastreabilidade Documental: Não é permitido eliminar uma versão de apontamento oficial referenciada por exercícios oficiais ativos ou históricos.';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_official_note_version_deletion ON public.official_note_versions;
CREATE TRIGGER trg_protect_official_note_version_deletion
BEFORE DELETE ON public.official_note_versions
FOR EACH ROW EXECUTE FUNCTION public.protect_official_note_version_deletion();

-- 8. BLINDAGEM DA TABELA EXERCISES: APENAS ADMIN CRIA EXERCÍCIOS OFICIAIS
-- Impede que alunos forjem exercícios com is_official = true ou created_by_role = 'admin'
CREATE OR REPLACE FUNCTION public.protect_official_exercise_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    IF NEW.is_official = true THEN
      RAISE EXCEPTION 'Violação de Segurança: Utilizadores sem privilégios não podem criar nem marcar exercícios como oficiais (is_official = true).';
    END IF;
    IF NEW.created_by_role = 'admin' THEN
      RAISE EXCEPTION 'Violação de Segurança: Utilizadores sem privilégios não podem definir created_by_role como admin.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_official_exercise_integrity ON public.exercises;
CREATE TRIGGER trg_protect_official_exercise_integrity
BEFORE INSERT OR UPDATE ON public.exercises
FOR EACH ROW EXECUTE FUNCTION public.protect_official_exercise_integrity();

-- 9. PROTEÇÃO CONTRA ADULTERAÇÃO DIRETA DE STUDY_STATS
CREATE OR REPLACE FUNCTION public.protect_study_stats_tampering()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_admin() AND session_user = 'authenticated' THEN
    RAISE EXCEPTION 'Violação de Segurança: As estatísticas de estudo não podem ser modificadas diretamente por alunos.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_study_stats_tampering ON public.study_stats;
CREATE TRIGGER trg_protect_study_stats_tampering
BEFORE INSERT OR UPDATE ON public.study_stats
FOR EACH ROW EXECUTE FUNCTION public.protect_study_stats_tampering();

REVOKE INSERT, UPDATE, DELETE ON public.study_stats FROM authenticated, anon;
GRANT SELECT ON public.study_stats TO authenticated;

-- 10. AUDITORIA E REFORÇO DA FUNÇÃO GET_TURMA_C_LEADERBOARD
-- search_path explícito, sem exposição de emails ou PII, tratamento sem divisão por zero
DROP FUNCTION IF EXISTS public.get_turma_c_leaderboard();
CREATE OR REPLACE FUNCTION public.get_turma_c_leaderboard()
RETURNS TABLE (
  rank integer,
  user_id uuid,
  full_name text,
  avatar_url text,
  class_name text,
  streak_days integer,
  official_attempts_count integer,
  average_percentage numeric(5,2),
  average_scale_20 numeric(4,2),
  is_eligible boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH student_stats AS (
    SELECT 
      p.id AS user_id,
      p.full_name,
      p.avatar_url,
      COALESCE(p.class_name, 'Turma C') AS class_name,
      COALESCE(ss.streak_days, 0) AS streak_days,
      COUNT(ofa.id)::integer AS official_attempts_count,
      ROUND(COALESCE(AVG(ofa.score_percentage), 0.00), 2) AS average_percentage,
      ROUND(COALESCE(AVG(ofa.score_scale_20), 0.00), 2) AS average_scale_20,
      (COUNT(ofa.id) > 0) AS is_eligible
    FROM public.profiles p
    LEFT JOIN public.study_stats ss ON ss.user_id = p.id
    LEFT JOIN public.official_first_attempts ofa ON ofa.user_id = p.id
    WHERE p.is_public_leaderboard = true
      AND (p.class_name = 'Turma C' OR p.class_name IS NULL)
    GROUP BY p.id, p.full_name, p.avatar_url, p.class_name, ss.streak_days
  )
  SELECT 
    ROW_NUMBER() OVER (
      ORDER BY 
        is_eligible DESC,
        average_percentage DESC, 
        streak_days DESC, 
        full_name ASC
    )::integer AS rank,
    user_id,
    full_name,
    avatar_url,
    class_name,
    streak_days,
    official_attempts_count,
    average_percentage,
    average_scale_20,
    is_eligible
  FROM student_stats;
$$;

GRANT EXECUTE ON FUNCTION public.get_turma_c_leaderboard() TO authenticated, anon;
