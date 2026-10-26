-- ==============================================================================
-- STUDENTS HUB — FASE A: SCHEMA E MIGRAÇÃO SEGURA PARA A TURMA C
-- Slogan: "Apontamentos que ajudam, exercícios que resultam. Rumo ao 20."
-- Princípio Sagrado: «SEMPRE COM BASE NOS APONTAMENTOS OFICIAIS!!!»
-- Migration Incremental, Não-Destrutiva e Reversível
-- ==============================================================================

-- 1. EXTENSÃO DO PERFIL PARA A TURMA C (Compatível com dados legados)
ALTER TABLE public.profiles 
  ADD COLUMN IF NOT EXISTS class_name text DEFAULT 'Turma C';

-- Preencher perfis existentes para assegurar consistência
UPDATE public.profiles 
SET class_name = 'Turma C' 
WHERE class_name IS NULL;

-- Permitir transição suave: school_year torna-se opcional para novas entradas
ALTER TABLE public.profiles 
  ALTER COLUMN school_year DROP NOT NULL;

-- Atualizar trigger handle_new_user para garantir 'Turma C' e backward compatibility
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  -- Cria perfil inicial com Turma C
  INSERT INTO public.profiles (id, full_name, class_name, school_year, is_public_leaderboard)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', 'Estudante'),
    'Turma C',
    COALESCE(NEW.raw_user_meta_data->>'school_year', '10º Ano'),
    true
  ) ON CONFLICT (id) DO UPDATE SET
    class_name = 'Turma C';

  -- Atribui papel padrão 'student' (impossível virar admin aqui)
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'student')
  ON CONFLICT (user_id) DO NOTHING;

  -- Inicializa registo de estatísticas a zeros
  INSERT INTO public.study_stats (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

-- 2. APONTAMENTOS OFICIAIS (Estrutura Principal)
CREATE TABLE IF NOT EXISTS public.official_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id text NOT NULL REFERENCES public.subjects(id) ON DELETE RESTRICT,
  academic_period text NOT NULL CHECK (academic_period IN ('P1', 'P2', 'P3')),
  theme text NOT NULL CHECK (char_length(trim(theme)) > 0),
  title text NOT NULL CHECK (char_length(trim(title)) > 0),
  is_published boolean NOT NULL DEFAULT false,
  published_at timestamptz,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 3. VERSÕES DE APONTAMENTOS OFICIAIS (Histórico, Auditoria de Raw HTML e Sanitized HTML)
CREATE TABLE IF NOT EXISTS public.official_note_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id uuid NOT NULL REFERENCES public.official_notes(id) ON DELETE CASCADE,
  version_number integer NOT NULL CHECK (version_number > 0),
  raw_html text NOT NULL CHECK (char_length(trim(raw_html)) > 0),
  sanitized_html text NOT NULL,
  plain_text_content text NOT NULL DEFAULT '',
  change_summary text,
  is_published boolean NOT NULL DEFAULT false,
  published_at timestamptz,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_official_note_version UNIQUE (note_id, version_number)
);

-- Adicionar apontador de versão ativa em official_notes (se ainda não existir)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
      AND table_name = 'official_notes' 
      AND column_name = 'current_version_id'
  ) THEN
    ALTER TABLE public.official_notes 
      ADD COLUMN current_version_id uuid REFERENCES public.official_note_versions(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 4. ATUALIZAÇÃO DE EXERCÍCIOS PARA SUPORTAR AUTORIA OFICIAL ADMINISTRATIVA
ALTER TABLE public.exercises
  ADD COLUMN IF NOT EXISTS is_official boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published', 'archived')),
  ADD COLUMN IF NOT EXISTS academic_period text CHECK (academic_period IN ('P1', 'P2', 'P3')),
  ADD COLUMN IF NOT EXISTS difficulty text CHECK (difficulty IN ('facil', 'medio', 'dificil')) DEFAULT 'medio',
  ADD COLUMN IF NOT EXISTS created_by_role text NOT NULL DEFAULT 'student' CHECK (created_by_role IN ('student', 'admin'));

-- 5. COMPATIBILIZAÇÃO NÃO DESTRUTIVA DE EXERCISE_SOURCE_REFERENCES
ALTER TABLE public.exercise_source_references
  ADD COLUMN IF NOT EXISTS source_type text NOT NULL DEFAULT 'personal' CHECK (source_type IN ('personal', 'official')),
  ADD COLUMN IF NOT EXISTS official_note_id uuid REFERENCES public.official_notes(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS official_version_id uuid REFERENCES public.official_note_versions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS official_section text;

-- Tornar note_id anulável para permitir que exercícios oficiais referenciem official_notes
ALTER TABLE public.exercise_source_references 
  ALTER COLUMN note_id DROP NOT NULL;

-- 6. CONJUNTOS DE EXERCÍCIOS OFICIAIS (OFFICIAL_EXERCISE_SETS)
CREATE TABLE IF NOT EXISTS public.official_exercise_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id text NOT NULL REFERENCES public.subjects(id) ON DELETE RESTRICT,
  academic_period text CHECK (academic_period IN ('P1', 'P2', 'P3')),
  title text NOT NULL CHECK (char_length(trim(title)) > 0),
  description text,
  is_published boolean NOT NULL DEFAULT false,
  published_at timestamptz,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.official_set_exercises (
  set_id uuid NOT NULL REFERENCES public.official_exercise_sets(id) ON DELETE CASCADE,
  exercise_id uuid NOT NULL REFERENCES public.exercises(id) ON DELETE CASCADE,
  order_index integer NOT NULL CHECK (order_index >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (set_id, exercise_id),
  CONSTRAINT uq_official_set_order UNIQUE (set_id, order_index)
);

-- 7. EXAMES OFICIAIS (OFFICIAL_EXAMS) — ABRANGÊNCIA P1 + P2 + P3
CREATE TABLE IF NOT EXISTS public.official_exams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id text NOT NULL REFERENCES public.subjects(id) ON DELETE RESTRICT,
  title text NOT NULL CHECK (char_length(trim(title)) > 0),
  description text,
  duration_minutes integer NOT NULL DEFAULT 90 CHECK (duration_minutes > 0),
  total_points numeric(4,2) NOT NULL DEFAULT 20.00 CHECK (total_points > 0),
  is_published boolean NOT NULL DEFAULT false,
  published_at timestamptz,
  is_immutable boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.official_exam_exercises (
  exam_id uuid NOT NULL REFERENCES public.official_exams(id) ON DELETE CASCADE,
  exercise_id uuid NOT NULL REFERENCES public.exercises(id) ON DELETE CASCADE,
  period text NOT NULL CHECK (period IN ('P1', 'P2', 'P3')),
  order_index integer NOT NULL CHECK (order_index >= 1),
  allocated_points numeric(4,2) NOT NULL DEFAULT 2.00 CHECK (allocated_points > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (exam_id, exercise_id),
  CONSTRAINT uq_exam_exercise_order UNIQUE (exam_id, order_index)
);

-- 8. PRIMEIRA TENTATIVA OFICIAL INVIOLÁVEL (OFFICIAL_FIRST_ATTEMPTS)
CREATE TABLE IF NOT EXISTS public.official_first_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  assessment_type text NOT NULL CHECK (assessment_type IN ('exam', 'exercise_set')),
  assessment_id uuid NOT NULL,
  session_id uuid REFERENCES public.exercise_sessions(id) ON DELETE SET NULL,
  score_achieved numeric(5,2) NOT NULL CHECK (score_achieved >= 0),
  max_score numeric(5,2) NOT NULL CHECK (max_score > 0),
  score_percentage numeric(5,2) NOT NULL CHECK (score_percentage >= 0 AND score_percentage <= 100),
  score_scale_20 numeric(4,2) NOT NULL CHECK (score_scale_20 >= 0 AND score_scale_20 <= 20),
  completed_at timestamptz NOT NULL DEFAULT now(),
  is_first_attempt boolean NOT NULL DEFAULT true CHECK (is_first_attempt = true),
  -- Chave única composta: impossibilita mais de uma primeira tentativa por aluno e avaliação
  CONSTRAINT uq_user_assessment_first_attempt UNIQUE (user_id, assessment_type, assessment_id)
);

-- Trigger de Imutabilidade Estrita: Proíbe UPDATE na primeira tentativa oficial
CREATE OR REPLACE FUNCTION public.protect_official_first_attempt_immutability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Violação de Imutabilidade: A 1.ª tentativa oficial é estritamente imutável e não pode ser alterada.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_official_first_attempt_immutability ON public.official_first_attempts;
CREATE TRIGGER trg_protect_official_first_attempt_immutability
BEFORE UPDATE ON public.official_first_attempts
FOR EACH ROW
EXECUTE FUNCTION public.protect_official_first_attempt_immutability();

-- Trigger Anti-Tampering em Inserção Direta de official_first_attempts:
-- Apenas o servidor (contexto app.evaluating_attempt) ou Admin podem inserir
CREATE OR REPLACE FUNCTION public.protect_first_attempt_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_is_system boolean := COALESCE(current_setting('app.evaluating_attempt', true) = 'true', false);
BEGIN
  IF NOT public.is_admin() AND NOT v_is_system THEN
    RAISE EXCEPTION 'Violação de Segurança: A 1.ª tentativa oficial só pode ser registada pelo servidor durante a conclusão da sessão.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_first_attempt_insert ON public.official_first_attempts;
CREATE TRIGGER trg_protect_first_attempt_insert
BEFORE INSERT ON public.official_first_attempts
FOR EACH ROW
EXECUTE FUNCTION public.protect_first_attempt_insert();

-- Proteção contra alteração de estrutura em exames com tentativas já submetidas
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
BEFORE UPDATE OR DELETE ON public.official_exam_exercises
FOR EACH ROW
EXECUTE FUNCTION public.protect_published_exam_immutability();

-- 9. LEADERBOARD OFICIAL DA TURMA C (Função RPC e Cálculo Normalizado)
-- Exclusivamente Streak de dias e Média percentual das primeiras tentativas oficiais elegíveis
CREATE OR REPLACE FUNCTION public.get_turma_c_leaderboard()
RETURNS TABLE (
  rank integer,
  user_id uuid,
  full_name text,
  avatar_url text,
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
    GROUP BY p.id, p.full_name, p.avatar_url, ss.streak_days
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
    streak_days,
    official_attempts_count,
    average_percentage,
    average_scale_20,
    is_eligible
  FROM student_stats;
$$;

-- 10. ATIVAÇÃO DE ROW LEVEL SECURITY (RLS) NAS NOVAS TABELAS
ALTER TABLE public.official_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.official_notes FORCE ROW LEVEL SECURITY;

ALTER TABLE public.official_note_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.official_note_versions FORCE ROW LEVEL SECURITY;

ALTER TABLE public.official_exercise_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.official_exercise_sets FORCE ROW LEVEL SECURITY;

ALTER TABLE public.official_set_exercises ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.official_set_exercises FORCE ROW LEVEL SECURITY;

ALTER TABLE public.official_exams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.official_exams FORCE ROW LEVEL SECURITY;

ALTER TABLE public.official_exam_exercises ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.official_exam_exercises FORCE ROW LEVEL SECURITY;

ALTER TABLE public.official_first_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.official_first_attempts FORCE ROW LEVEL SECURITY;

-- 11. POLÍTICAS RLS EXPLÍCITAS

-- ==================== OFFICIAL_NOTES ====================
CREATE POLICY "official_notes_select_published"
  ON public.official_notes FOR SELECT
  TO authenticated
  USING (is_published = true OR public.is_admin());

CREATE POLICY "official_notes_insert_admin"
  ON public.official_notes FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY "official_notes_update_admin"
  ON public.official_notes FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "official_notes_delete_admin"
  ON public.official_notes FOR DELETE
  TO authenticated
  USING (public.is_admin());

-- ==================== OFFICIAL_NOTE_VERSIONS ====================
CREATE POLICY "official_note_versions_select_published"
  ON public.official_note_versions FOR SELECT
  TO authenticated
  USING (is_published = true OR public.is_admin());

CREATE POLICY "official_note_versions_insert_admin"
  ON public.official_note_versions FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY "official_note_versions_update_admin"
  ON public.official_note_versions FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "official_note_versions_delete_admin"
  ON public.official_note_versions FOR DELETE
  TO authenticated
  USING (public.is_admin());

-- ==================== OFFICIAL_EXERCISE_SETS ====================
CREATE POLICY "official_exercise_sets_select_published"
  ON public.official_exercise_sets FOR SELECT
  TO authenticated
  USING (is_published = true OR public.is_admin());

CREATE POLICY "official_exercise_sets_insert_admin"
  ON public.official_exercise_sets FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY "official_exercise_sets_update_admin"
  ON public.official_exercise_sets FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "official_exercise_sets_delete_admin"
  ON public.official_exercise_sets FOR DELETE
  TO authenticated
  USING (public.is_admin());

-- ==================== OFFICIAL_SET_EXERCISES ====================
CREATE POLICY "official_set_exercises_select"
  ON public.official_set_exercises FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.official_exercise_sets s
      WHERE s.id = set_id AND (s.is_published = true OR public.is_admin())
    )
  );

CREATE POLICY "official_set_exercises_admin_all"
  ON public.official_set_exercises FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ==================== OFFICIAL_EXAMS ====================
CREATE POLICY "official_exams_select_published"
  ON public.official_exams FOR SELECT
  TO authenticated
  USING (is_published = true OR public.is_admin());

CREATE POLICY "official_exams_insert_admin"
  ON public.official_exams FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY "official_exams_update_admin"
  ON public.official_exams FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "official_exams_delete_admin"
  ON public.official_exams FOR DELETE
  TO authenticated
  USING (public.is_admin());

-- ==================== OFFICIAL_EXAM_EXERCISES ====================
CREATE POLICY "official_exam_exercises_select"
  ON public.official_exam_exercises FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.official_exams e
      WHERE e.id = exam_id AND (e.is_published = true OR public.is_admin())
    )
  );

CREATE POLICY "official_exam_exercises_admin_all"
  ON public.official_exam_exercises FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ==================== OFFICIAL_FIRST_ATTEMPTS ====================
CREATE POLICY "official_first_attempts_select_own"
  ON public.official_first_attempts FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());

CREATE POLICY "official_first_attempts_insert_system"
  ON public.official_first_attempts FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid() OR public.is_admin());

CREATE POLICY "official_first_attempts_update_trigger"
  ON public.official_first_attempts FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());

CREATE POLICY "official_first_attempts_delete_admin"
  ON public.official_first_attempts FOR DELETE
  TO authenticated
  USING (public.is_admin());

-- ==================== EXERCISES (Atualização de Policy) ====================
-- Permitir que alunos leiam exercícios oficiais publicados
CREATE POLICY "exercises_select_official"
  ON public.exercises FOR SELECT
  TO authenticated
  USING (is_official = true AND status = 'published');

-- ==================== EXERCISE_SOURCE_REFERENCES (Atualização de Policy) ====================
CREATE POLICY "exercise_sources_select_official"
  ON public.exercise_source_references FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.exercises e
      WHERE e.id = exercise_id AND e.is_official = true AND e.status = 'published'
    )
  );
