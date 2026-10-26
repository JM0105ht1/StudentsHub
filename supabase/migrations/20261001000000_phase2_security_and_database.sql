-- ==============================================================================
-- STUDENTS HUB — FASE 2: SEGURANÇA E BASE DE DADOS
-- Schema PostgreSQL, RLS, Integridade Relacional e Storage
-- Slogan: "Apontamentos que ajudam, exercícios que resultam. Rumo ao 20."
-- ==============================================================================

-- 1. EXTENSÕES
DO $$
BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  BEGIN
    CREATE EXTENSION IF NOT EXISTS "pgcrypto";
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END
$$;

-- 2. USER_ROLES (Mecanismo seguro de papéis)
CREATE TABLE IF NOT EXISTS public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  role text NOT NULL CHECK (role IN ('student', 'admin')) DEFAULT 'student',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 3. FUNÇÃO AUXILIAR DE ADMIN (SECURITY DEFINER SEGURA)
-- Define search_path explicitamente para prevenir ataques de hijacking
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = auth.uid()
      AND role = 'admin'
  );
$$;

-- 4. PROFILES (Perfis dos Alunos)
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL CHECK (char_length(trim(full_name)) >= 2),
  avatar_url text,
  school_year text NOT NULL CHECK (school_year IN ('10º Ano', '11º Ano', '12º Ano')),
  is_public_leaderboard boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Trigger para impedir alteração de ID no profiles
CREATE OR REPLACE FUNCTION public.prevent_profile_id_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.id <> OLD.id THEN
    RAISE EXCEPTION 'Não é permitido alterar o identificador de utilizador no perfil.';
  END IF;
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_profile_id_change ON public.profiles;
CREATE TRIGGER trg_prevent_profile_id_change
BEFORE UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.prevent_profile_id_change();

-- 5. SUBJECTS (Disciplinas Oficiais Estáveis)
CREATE TABLE IF NOT EXISTS public.subjects (
  id text PRIMARY KEY,
  name text NOT NULL UNIQUE,
  code text NOT NULL,
  grade_level text NOT NULL,
  description text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Inserção das 6 disciplinas oficiais com identificadores estáveis
INSERT INTO public.subjects (id, name, code, grade_level, description)
VALUES 
  ('matematica-a', 'Matemática A', 'MAT A', '10º, 11º e 12º Anos', 'Cálculo diferencial, trigonometria, probabilidades, sucessões e geometria analítica.'),
  ('fisica-quimica-a', 'Física e Química A', 'FQA', '10º e 11º Anos', 'Mecânica, ondas, eletromagnetismo, transformações químicas e equilíbrio.'),
  ('filosofia', 'Filosofia', 'FIL', '10º e 11º Anos', 'Ação humana, epistemologia, ética deontológica e utilitarista, filosofia da ciência.'),
  ('portugues', 'Português', 'PORT', '10º, 11º e 12º Anos', 'Os Lusíadas, Mensagem, Fernando Pessoa e heterónimos, Memorial do Convento.'),
  ('ingles', 'Inglês', 'ING', '10º e 11º Anos', 'The World of Work, Technology and Society, Global Citizenship and Culture.'),
  ('geometria-descritiva-a', 'Geometria Descritiva A', 'GDA', '10º e 11º Anos', 'Projeções ortogonais, método de Monge, interseções de planos, sombras e sólidos.')
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  code = EXCLUDED.code,
  grade_level = EXCLUDED.grade_level,
  description = EXCLUDED.description;

-- 6. TESTS (Avaliações / Testes Escolares do Aluno)
CREATE TABLE IF NOT EXISTS public.tests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subject_id text NOT NULL REFERENCES public.subjects(id) ON DELETE RESTRICT,
  title text NOT NULL CHECK (char_length(trim(title)) > 0),
  academic_term text NOT NULL CHECK (char_length(trim(academic_term)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Chave única composta para garantir integridade referencial por proprietário
  CONSTRAINT uq_tests_id_user UNIQUE (id, user_id)
);

-- 7. PERSONAL_NOTES (Apontamentos Pessoais)
CREATE TABLE IF NOT EXISTS public.personal_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  test_id uuid,
  subject_id text NOT NULL REFERENCES public.subjects(id) ON DELETE RESTRICT,
  title text NOT NULL CHECK (char_length(trim(title)) > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Chave única composta para foreign keys filhas
  CONSTRAINT uq_personal_notes_id_user UNIQUE (id, user_id),
  -- Integridade referencial com teste: se associado, o teste TEM de pertencer ao mesmo user_id!
  CONSTRAINT fk_personal_notes_test_user FOREIGN KEY (test_id, user_id)
    REFERENCES public.tests(id, user_id) ON DELETE SET NULL
);

-- 8. NOTE_PAGES (Páginas de Caderno / Imagens / PDFs com Rastreio de Multi-página)
-- Decisão de Arquitetura:
-- Um PDF de 10 páginas contém 10 entradas com o mesmo document_id/document_name.
-- page_number é a ordenação sequencial do caderno do aluno nesta nota.
-- document_page_number regista a folha original do ficheiro.
CREATE TABLE IF NOT EXISTS public.note_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id uuid NOT NULL,
  user_id uuid NOT NULL,
  document_id uuid NOT NULL DEFAULT gen_random_uuid(),
  document_name text NOT NULL,
  document_page_number integer NOT NULL DEFAULT 1 CHECK (document_page_number > 0),
  page_number integer NOT NULL CHECK (page_number > 0),
  storage_file_path text NOT NULL,
  file_sha256 text NOT NULL,
  raw_ocr_text text,
  confirmed_text text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- Integridade relacional estrita: a nota DEVE pertencer ao mesmo utilizador da página!
  CONSTRAINT fk_note_pages_note_user FOREIGN KEY (note_id, user_id) 
    REFERENCES public.personal_notes(id, user_id) ON DELETE CASCADE,
  -- Chave única composta para foreign keys de chunks
  CONSTRAINT uq_note_pages_id_user UNIQUE (id, user_id),
  -- Ordem sequencial única de visualização no caderno
  CONSTRAINT uq_note_pages_note_page UNIQUE (note_id, page_number)
);

-- 9. NOTE_CHUNKS (Segmentos Semânticos de Estudo)
CREATE TABLE IF NOT EXISTS public.note_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id uuid NOT NULL,
  note_id uuid NOT NULL,
  user_id uuid NOT NULL,
  chunk_index integer NOT NULL CHECK (chunk_index >= 0),
  chunk_type text NOT NULL CHECK (chunk_type IN ('theory', 'formula', 'example', 'exercise', 'summary')),
  content text NOT NULL CHECK (char_length(trim(content)) > 0),
  token_count integer NOT NULL DEFAULT 0 CHECK (token_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Integridade relacional composta tripla: chunk, página e nota partilham obrigatoriamente o mesmo user_id
  CONSTRAINT fk_note_chunks_page_user FOREIGN KEY (page_id, user_id)
    REFERENCES public.note_pages(id, user_id) ON DELETE CASCADE,
  CONSTRAINT fk_note_chunks_note_user FOREIGN KEY (note_id, user_id)
    REFERENCES public.personal_notes(id, user_id) ON DELETE CASCADE,
  CONSTRAINT uq_note_chunks_page_index UNIQUE (page_id, chunk_index)
);

-- 10. PUBLIC_NOTES (Biblioteca Pública Curada por Administradores)
CREATE TABLE IF NOT EXISTS public.public_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  curator_admin_id uuid NOT NULL REFERENCES auth.users(id),
  subject_id text NOT NULL REFERENCES public.subjects(id) ON DELETE RESTRICT,
  title text NOT NULL CHECK (char_length(trim(title)) > 0),
  canonical_markdown text NOT NULL,
  clean_print_ast jsonb,
  topics text[] NOT NULL DEFAULT '{}',
  is_published boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 11. EXERCISE_SESSIONS (Sessões de Estudo — Estrutura Preparada)
CREATE TABLE IF NOT EXISTS public.exercise_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subject_id text NOT NULL REFERENCES public.subjects(id) ON DELETE RESTRICT,
  title text NOT NULL CHECK (char_length(trim(title)) > 0),
  mode text NOT NULL CHECK (mode IN ('study', 'exam', 'flashcards')),
  status text NOT NULL CHECK (status IN ('in_progress', 'completed', 'abandoned')) DEFAULT 'in_progress',
  score numeric(5,2) DEFAULT 0.00,
  max_score numeric(5,2) DEFAULT 0.00,
  score_scale_20 numeric(4,2) DEFAULT 0.00,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT uq_exercise_sessions_id_user UNIQUE (id, user_id)
);

-- 12. SESSION_TESTS (Relação entre Sessão e Testes Escolares)
CREATE TABLE IF NOT EXISTS public.session_tests (
  session_id uuid NOT NULL,
  test_id uuid NOT NULL,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, test_id),
  -- Integridade relacional: a sessão e o teste têm obrigatoriamente de pertencer ao mesmo user_id
  CONSTRAINT fk_session_tests_session_user FOREIGN KEY (session_id, user_id)
    REFERENCES public.exercise_sessions(id, user_id) ON DELETE CASCADE,
  CONSTRAINT fk_session_tests_test_user FOREIGN KEY (test_id, user_id)
    REFERENCES public.tests(id, user_id) ON DELETE CASCADE
);

-- 13. EXERCISES (Exercícios do Aluno — Soluções Protegidas de Alteração)
CREATE TABLE IF NOT EXISTS public.exercises (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subject_id text NOT NULL REFERENCES public.subjects(id) ON DELETE RESTRICT,
  prompt text NOT NULL CHECK (char_length(trim(prompt)) > 0),
  question_type text NOT NULL CHECK (question_type IN ('multiple_choice', 'open_answer', 'calculation', 'true_false')),
  options jsonb,
  correct_answer text NOT NULL, -- Protegido contra alteração por alunos
  scoring_rubric jsonb NOT NULL DEFAULT '{}'::jsonb, -- Protegido
  max_points numeric(4,2) NOT NULL DEFAULT 20.00 CHECK (max_points > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_exercises_id_user UNIQUE (id, user_id),
  CONSTRAINT fk_exercises_session_user FOREIGN KEY (session_id, user_id)
    REFERENCES public.exercise_sessions(id, user_id) ON DELETE SET NULL
);

-- 14. EXERCISE_SOURCE_REFERENCES (Evidência Documental do Exercício)
CREATE TABLE IF NOT EXISTS public.exercise_source_references (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exercise_id uuid NOT NULL,
  user_id uuid NOT NULL,
  note_id uuid NOT NULL,
  page_id uuid,
  chunk_id uuid,
  citation_excerpt text,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- Integridade de isolamento: tudo pertence estritamente ao mesmo user_id
  CONSTRAINT fk_exercise_sources_exercise_user FOREIGN KEY (exercise_id, user_id)
    REFERENCES public.exercises(id, user_id) ON DELETE CASCADE,
  CONSTRAINT fk_exercise_sources_note_user FOREIGN KEY (note_id, user_id)
    REFERENCES public.personal_notes(id, user_id) ON DELETE CASCADE,
  CONSTRAINT fk_exercise_sources_page_user FOREIGN KEY (page_id, user_id)
    REFERENCES public.note_pages(id, user_id) ON DELETE SET NULL
);

-- 15. EXERCISE_ATTEMPTS (Tentativas de Resolução do Aluno)
CREATE TABLE IF NOT EXISTS public.exercise_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exercise_id uuid NOT NULL,
  session_id uuid,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  student_answer text NOT NULL,
  awarded_points numeric(4,2) CHECK (awarded_points >= 0),
  feedback text,
  is_correct boolean,
  review_status text NOT NULL DEFAULT 'evaluated' CHECK (review_status IN ('evaluated', 'pending_review')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_exercise_attempts_exercise_user FOREIGN KEY (exercise_id, user_id)
    REFERENCES public.exercises(id, user_id) ON DELETE CASCADE
);

-- 16. STUDY_STATS (Estatísticas do Aluno — Protegidas contra Manipulação)
CREATE TABLE IF NOT EXISTS public.study_stats (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  streak_days integer NOT NULL DEFAULT 0 CHECK (streak_days >= 0),
  last_study_date date,
  exercises_solved integer NOT NULL DEFAULT 0 CHECK (exercises_solved >= 0),
  correct_answers integer NOT NULL DEFAULT 0 CHECK (correct_answers >= 0),
  success_rate numeric(5,2) NOT NULL DEFAULT 0.00 CHECK (success_rate >= 0 AND success_rate <= 100),
  average_score_scale_20 numeric(4,2) NOT NULL DEFAULT 0.00 CHECK (average_score_scale_20 >= 0 AND average_score_scale_20 <= 20),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 17. TRIGGERS DE SEGURANÇA CONTRA FRAUDE E TAMPERING

-- A) Impede que o aluno altere a solução oficial ou critérios do exercício
CREATE OR REPLACE FUNCTION public.protect_exercise_solutions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_admin() THEN
    IF (NEW.correct_answer <> OLD.correct_answer) OR 
       (NEW.scoring_rubric::text <> OLD.scoring_rubric::text) OR 
       (NEW.max_points <> OLD.max_points) THEN
      RAISE EXCEPTION 'Violação de Segurança: Alunos não podem alterar o gabarito ou pontuação oficial do exercício.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_exercise_solutions ON public.exercises;
CREATE TRIGGER trg_protect_exercise_solutions
BEFORE UPDATE ON public.exercises
FOR EACH ROW
EXECUTE FUNCTION public.protect_exercise_solutions();

-- B) Impede que o aluno altere ou insira a sua própria pontuação em exercise_attempts
CREATE OR REPLACE FUNCTION public.protect_attempt_scores()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_is_system boolean := COALESCE(current_setting('app.evaluating_attempt', true) = 'true', false);
BEGIN
  IF NOT public.is_admin() AND NOT v_is_system THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.awarded_points IS NOT NULL OR NEW.is_correct IS NOT NULL THEN
        RAISE EXCEPTION 'Violação de Segurança: A avaliação da resposta só pode ser atribuída pelo sistema ou curador.';
      END IF;
    ELSIF TG_OP = 'UPDATE' THEN
      IF (OLD.awarded_points IS NOT DISTINCT FROM NEW.awarded_points) IS FALSE OR
         (OLD.is_correct IS NOT DISTINCT FROM NEW.is_correct) IS FALSE THEN
        RAISE EXCEPTION 'Violação de Segurança: A avaliação da resposta só pode ser atribuída pelo sistema ou curador.';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_attempt_scores ON public.exercise_attempts;
CREATE TRIGGER trg_protect_attempt_scores
BEFORE INSERT OR UPDATE ON public.exercise_attempts
FOR EACH ROW
EXECUTE FUNCTION public.protect_attempt_scores();

-- B2) Impede que o aluno altere pontuações e estado da sessão diretamente
CREATE OR REPLACE FUNCTION public.protect_session_scores()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_is_system boolean := COALESCE(current_setting('app.evaluating_attempt', true) = 'true', false);
BEGIN
  IF NOT public.is_admin() AND NOT v_is_system THEN
    IF (OLD.score IS NOT DISTINCT FROM NEW.score) IS FALSE OR
       (OLD.max_score IS NOT DISTINCT FROM NEW.max_score) IS FALSE OR
       (OLD.score_scale_20 IS NOT DISTINCT FROM NEW.score_scale_20) IS FALSE OR
       (OLD.status = 'completed' AND NEW.status <> 'completed') THEN
      RAISE EXCEPTION 'Violação de Segurança: A pontuação e conclusão da sessão só podem ser atribuídas pelo servidor.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_session_scores ON public.exercise_sessions;
CREATE TRIGGER trg_protect_session_scores
BEFORE UPDATE ON public.exercise_sessions
FOR EACH ROW
EXECUTE FUNCTION public.protect_session_scores();

-- C) Inicializador automático de utilizador em auth.users -> profiles, user_roles, study_stats
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  -- Cria perfil inicial com base nos metadados ou padrão
  INSERT INTO public.profiles (id, full_name, school_year, is_public_leaderboard)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', 'Estudante'),
    COALESCE(NEW.raw_user_meta_data->>'school_year', '10º Ano'),
    true
  ) ON CONFLICT (id) DO NOTHING;

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

-- Trigger disparado no registo do Supabase Auth
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_user();

-- D) Impede qualquer alteração de raw_ocr_text ou metadados de integridade da página (Imutabilidade Estrita)
CREATE OR REPLACE FUNCTION public.protect_raw_ocr_immutability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Se o raw_ocr_text já estava registado, é estritamente proibido alterá-lo
  IF OLD.raw_ocr_text IS NOT NULL AND NEW.raw_ocr_text IS DISTINCT FROM OLD.raw_ocr_text THEN
    RAISE EXCEPTION 'Violação de Imutabilidade: O texto OCR original (raw_ocr_text) é estritamente imutável após registo.';
  END IF;

  -- O hash do ficheiro original é imutável
  IF OLD.file_sha256 IS NOT NULL AND NEW.file_sha256 IS DISTINCT FROM OLD.file_sha256 THEN
    RAISE EXCEPTION 'Violação de Imutabilidade: O hash de integridade do ficheiro (file_sha256) é imutável.';
  END IF;

  -- Proibido transferir a página para outro utilizador ou para outro caderno
  IF NEW.user_id <> OLD.user_id THEN
    RAISE EXCEPTION 'Violação de Integridade: Não é permitido transferir a página para outro utilizador.';
  END IF;

  IF NEW.note_id <> OLD.note_id THEN
    RAISE EXCEPTION 'Violação de Integridade: Não é permitido transferir a página para outro caderno.';
  END IF;

  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_raw_ocr_immutability ON public.note_pages;
CREATE TRIGGER trg_protect_raw_ocr_immutability
BEFORE UPDATE ON public.note_pages
FOR EACH ROW
EXECUTE FUNCTION public.protect_raw_ocr_immutability();

-- E) Garante que chunks só podem ser criados a partir de confirmed_text autorizado (Única Fonte Autorizada)
CREATE OR REPLACE FUNCTION public.validate_note_chunk_source()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_page public.note_pages%ROWTYPE;
BEGIN
  -- 1. Obter a página mãe
  SELECT * INTO v_page
  FROM public.note_pages
  WHERE id = NEW.page_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Violação de Integridade: A página associada ao chunk não existe.';
  END IF;

  -- 2. Garantir isolamento multi-tenant estrito
  IF v_page.user_id <> NEW.user_id THEN
    RAISE EXCEPTION 'Violação de Segurança: A página associada ao chunk pertence a outro utilizador.';
  END IF;

  IF v_page.note_id <> NEW.note_id THEN
    RAISE EXCEPTION 'Violação de Integridade: O note_id do chunk não coincide com a página mãe.';
  END IF;

  -- 3. CASO A: confirmed_text = NULL -> PROIBIDO criar chunks!
  IF v_page.confirmed_text IS NULL OR trim(v_page.confirmed_text) = '' THEN
    RAISE EXCEPTION 'Violação da Cadeia de Verdade: Não é permitido criar chunks para uma folha sem texto confirmado (confirmed_text IS NULL).';
  END IF;

  -- 4. CASO B/C/D: O conteúdo do chunk DEVE estar estritamente contido no confirmed_text!
  IF position(trim(NEW.content) in v_page.confirmed_text) = 0 THEN
    RAISE EXCEPTION 'Violação da Cadeia de Verdade: O conteúdo do chunk deve provir exclusivamente do texto confirmado pelo aluno.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_note_chunk_source ON public.note_chunks;
CREATE TRIGGER trg_validate_note_chunk_source
BEFORE INSERT OR UPDATE ON public.note_chunks
FOR EACH ROW
EXECUTE FUNCTION public.validate_note_chunk_source();

-- 18. ATIVAÇÃO DE ROW LEVEL SECURITY (RLS) EM TODAS AS TABELAS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles FORCE ROW LEVEL SECURITY;
ALTER TABLE public.subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subjects FORCE ROW LEVEL SECURITY;
ALTER TABLE public.tests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tests FORCE ROW LEVEL SECURITY;
ALTER TABLE public.personal_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.personal_notes FORCE ROW LEVEL SECURITY;
ALTER TABLE public.note_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.note_pages FORCE ROW LEVEL SECURITY;
ALTER TABLE public.note_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.note_chunks FORCE ROW LEVEL SECURITY;
ALTER TABLE public.public_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.public_notes FORCE ROW LEVEL SECURITY;
ALTER TABLE public.exercise_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exercise_sessions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.session_tests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.session_tests FORCE ROW LEVEL SECURITY;
ALTER TABLE public.exercises ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exercises FORCE ROW LEVEL SECURITY;
ALTER TABLE public.exercise_source_references ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exercise_source_references FORCE ROW LEVEL SECURITY;
ALTER TABLE public.exercise_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exercise_attempts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.study_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.study_stats FORCE ROW LEVEL SECURITY;

-- 19. DEFINIÇÃO COMPLETA DE POLICIES RLS (SELECT, INSERT, UPDATE, DELETE)

-- ==================== PROFILES ====================
-- O perfil completo só pode ser lido pelo próprio utilizador
-- Dados públicos para leaderboard são acedidos exclusivamente via RPC get_public_leaderboard()
CREATE POLICY "profiles_select_own"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (id = auth.uid());

CREATE POLICY "profiles_insert_own"
  ON public.profiles FOR INSERT
  TO authenticated
  WITH CHECK (id = auth.uid());

CREATE POLICY "profiles_update_own"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- Alunos não apagam profiles diretamente (apenas via conta auth ou admin)
CREATE POLICY "profiles_delete_admin"
  ON public.profiles FOR DELETE
  TO authenticated
  USING (public.is_admin());

-- ==================== USER_ROLES ====================
-- Utilizador autenticado pode apenas ler o seu próprio papel
CREATE POLICY "user_roles_select_own"
  ON public.user_roles FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());

-- Alunos NÃO podem inserir, atualizar ou apagar papéis. Apenas admin!
CREATE POLICY "user_roles_insert_admin"
  ON public.user_roles FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY "user_roles_update_admin"
  ON public.user_roles FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "user_roles_delete_admin"
  ON public.user_roles FOR DELETE
  TO authenticated
  USING (public.is_admin());

-- ==================== SUBJECTS ====================
-- Todos os utilizadores autenticados podem consultar as disciplinas oficiais
CREATE POLICY "subjects_select_authenticated"
  ON public.subjects FOR SELECT
  TO authenticated
  USING (true);

-- Apenas admin pode gerir o catálogo de disciplinas
CREATE POLICY "subjects_insert_admin"
  ON public.subjects FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY "subjects_update_admin"
  ON public.subjects FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "subjects_delete_admin"
  ON public.subjects FOR DELETE
  TO authenticated
  USING (public.is_admin());

-- ==================== TESTS ====================
CREATE POLICY "tests_select_own"
  ON public.tests FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "tests_insert_own"
  ON public.tests FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "tests_update_own"
  ON public.tests FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "tests_delete_own"
  ON public.tests FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- ==================== PERSONAL_NOTES ====================
CREATE POLICY "personal_notes_select_own"
  ON public.personal_notes FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "personal_notes_insert_own"
  ON public.personal_notes FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "personal_notes_update_own"
  ON public.personal_notes FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "personal_notes_delete_own"
  ON public.personal_notes FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- ==================== NOTE_PAGES ====================
CREATE POLICY "note_pages_select_own"
  ON public.note_pages FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "note_pages_insert_own"
  ON public.note_pages FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "note_pages_update_own"
  ON public.note_pages FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "note_pages_delete_own"
  ON public.note_pages FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- ==================== NOTE_CHUNKS ====================
CREATE POLICY "note_chunks_select_own"
  ON public.note_chunks FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "note_chunks_insert_own"
  ON public.note_chunks FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.note_pages p
      WHERE p.id = page_id
        AND p.user_id = auth.uid()
        AND p.confirmed_text IS NOT NULL
        AND trim(p.confirmed_text) <> ''
    )
  );

-- Chunks são blocos imutáveis derivados de confirmed_text; updates diretos de frontend são proibidos
CREATE POLICY "note_chunks_update_admin"
  ON public.note_chunks FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "note_chunks_delete_own"
  ON public.note_chunks FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- ==================== PUBLIC_NOTES ====================
-- Utilizadores autenticados só podem ler notas que foram explicitamente publicadas
CREATE POLICY "public_notes_select_published"
  ON public.public_notes FOR SELECT
  TO authenticated
  USING (is_published = true OR public.is_admin());

-- Apenas curadores/administradores podem criar, editar e apagar notas públicas
CREATE POLICY "public_notes_insert_admin"
  ON public.public_notes FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin() AND curator_admin_id = auth.uid());

CREATE POLICY "public_notes_update_admin"
  ON public.public_notes FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "public_notes_delete_admin"
  ON public.public_notes FOR DELETE
  TO authenticated
  USING (public.is_admin());

-- ==================== EXERCISE_SESSIONS ====================
CREATE POLICY "exercise_sessions_select_own"
  ON public.exercise_sessions FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "exercise_sessions_insert_own"
  ON public.exercise_sessions FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "exercise_sessions_update_own"
  ON public.exercise_sessions FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "exercise_sessions_delete_own"
  ON public.exercise_sessions FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- ==================== SESSION_TESTS ====================
CREATE POLICY "session_tests_select_own"
  ON public.session_tests FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "session_tests_insert_own"
  ON public.session_tests FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "session_tests_update_own"
  ON public.session_tests FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "session_tests_delete_own"
  ON public.session_tests FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- ==================== EXERCISES ====================
CREATE POLICY "exercises_select_own"
  ON public.exercises FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "exercises_insert_own"
  ON public.exercises FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Alunos NUNCA podem alterar exercícios ou soluções. Apenas curadores/admin!
CREATE POLICY "exercises_update_admin"
  ON public.exercises FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "exercises_delete_own"
  ON public.exercises FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- ==================== EXERCISE_SOURCE_REFERENCES ====================
CREATE POLICY "exercise_sources_select_own"
  ON public.exercise_source_references FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "exercise_sources_insert_own"
  ON public.exercise_source_references FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- Alunos NUNCA podem alterar referências de fontes de exercícios registados!
CREATE POLICY "exercise_sources_update_admin"
  ON public.exercise_source_references FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "exercise_sources_delete_own"
  ON public.exercise_source_references FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- ==================== EXERCISE_ATTEMPTS ====================
CREATE POLICY "exercise_attempts_select_own"
  ON public.exercise_attempts FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "exercise_attempts_insert_own"
  ON public.exercise_attempts FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "exercise_attempts_update_own"
  ON public.exercise_attempts FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "exercise_attempts_delete_own"
  ON public.exercise_attempts FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

-- ==================== STUDY_STATS ====================
-- O aluno apenas pode LER as suas estatísticas
CREATE POLICY "study_stats_select_own"
  ON public.study_stats FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- NENHUMA policy de INSERT/UPDATE/DELETE direta para alunos no frontend!
-- As estatísticas só são alteradas por triggers internos ou rotinas privilegiadas de backend
CREATE POLICY "study_stats_manage_admin"
  ON public.study_stats FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- 20. PROJEÇÃO SEGURA DE LEADERBOARD (VIEW + RPC COM ZERO DADOS PRIVADOS)
CREATE OR REPLACE VIEW public.leaderboard_public_view AS
SELECT 
  p.full_name,
  p.avatar_url,
  p.school_year,
  s.streak_days,
  s.exercises_solved,
  s.success_rate,
  s.average_score_scale_20
FROM public.profiles p
INNER JOIN public.study_stats s ON p.id = s.user_id
WHERE p.is_public_leaderboard = true
ORDER BY s.exercises_solved DESC, s.average_score_scale_20 DESC;

-- Função RPC segura para consulta pelo frontend
CREATE OR REPLACE FUNCTION public.get_public_leaderboard()
RETURNS TABLE (
  full_name text,
  avatar_url text,
  school_year text,
  streak_days integer,
  exercises_solved integer,
  success_rate numeric,
  average_score_scale_20 numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT 
    p.full_name,
    p.avatar_url,
    p.school_year,
    s.streak_days,
    s.exercises_solved,
    s.success_rate,
    s.average_score_scale_20
  FROM public.profiles p
  INNER JOIN public.study_stats s ON p.id = s.user_id
  WHERE p.is_public_leaderboard = true
  ORDER BY s.exercises_solved DESC, s.average_score_scale_20 DESC
  LIMIT 50;
$$;

-- 21. STORAGE BUCKETS E POLICIES
CREATE SCHEMA IF NOT EXISTS storage;

CREATE TABLE IF NOT EXISTS storage.buckets (
  id text PRIMARY KEY,
  name text NOT NULL,
  public boolean DEFAULT false,
  file_size_limit bigint,
  allowed_mime_types text[],
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS storage.objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text REFERENCES storage.buckets(id) ON DELETE CASCADE,
  name text NOT NULL,
  owner uuid,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  last_accessed_at timestamptz DEFAULT now(),
  metadata jsonb
);

CREATE OR REPLACE FUNCTION storage.foldername(name text)
RETURNS text[]
LANGUAGE sql IMMUTABLE
AS $$
  SELECT string_to_array(name, '/');
$$;

ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE storage.objects FORCE ROW LEVEL SECURITY;

-- Criação dos buckets no esquema storage (idempotente)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES 
  ('personal-vault', 'personal-vault', false, 52428800, ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
  ('curated-library', 'curated-library', true, 52428800, ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Políticas de Armazenamento para personal-vault (Caminho: users/{auth.uid()}/...)
-- SELECT / Download
CREATE POLICY "personal_vault_select_own"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'personal-vault' 
  AND auth.uid()::text = (storage.foldername(name))[2]
);

-- INSERT / Upload
CREATE POLICY "personal_vault_insert_own"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'personal-vault' 
  AND auth.uid()::text = (storage.foldername(name))[2]
);

-- UPDATE
CREATE POLICY "personal_vault_update_own"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'personal-vault' 
  AND auth.uid()::text = (storage.foldername(name))[2]
)
WITH CHECK (
  bucket_id = 'personal-vault' 
  AND auth.uid()::text = (storage.foldername(name))[2]
);

-- DELETE
CREATE POLICY "personal_vault_delete_own"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'personal-vault' 
  AND auth.uid()::text = (storage.foldername(name))[2]
);

-- Políticas de Armazenamento para curated-library
CREATE POLICY "curated_library_select_all"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'curated-library');

CREATE POLICY "curated_library_manage_admin"
ON storage.objects FOR ALL
TO authenticated
USING (bucket_id = 'curated-library' AND public.is_admin())
WITH CHECK (bucket_id = 'curated-library' AND public.is_admin());

-- ==============================================================================
-- 22. FUNÇÃO ATÓMICA E IDEMPOTENTE DE CONFIRMAÇÃO DE APONTAMENTO
-- Garante transação única: confirmação da página + substituição total dos chunks.
-- Em caso de erro na geração de chunks, reverte automaticamente (ROLLBACK total).
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.confirm_note_page_atomic(
  p_page_id uuid,
  p_note_id uuid,
  p_user_id uuid,
  p_confirmed_text text,
  p_chunks jsonb
)
RETURNS TABLE (
  chunk_id uuid,
  chunk_index integer,
  chunk_type text,
  content text,
  token_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_page public.note_pages%ROWTYPE;
  v_chunk record;
  v_clean_text text;
BEGIN
  -- 1. Validar utilizador autenticado
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'Violação de Segurança: Não tem permissão para confirmar esta página.';
  END IF;

  v_clean_text := trim(p_confirmed_text);
  IF v_clean_text IS NULL OR char_length(v_clean_text) = 0 THEN
    RAISE EXCEPTION 'O texto de confirmação não pode ser vazio.';
  END IF;

  -- 2. Validar existência e ownership da página
  SELECT * INTO v_page
  FROM public.note_pages
  WHERE id = p_page_id AND user_id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Acesso negado: A página indicada não pertence ao utilizador.';
  END IF;

  IF v_page.note_id <> p_note_id THEN
    RAISE EXCEPTION 'Inconsistência relacional: O note_id não corresponde à página mãe.';
  END IF;

  -- 3. Atualizar note_pages com confirmed_text (em transação atómica)
  UPDATE public.note_pages
  SET 
    confirmed_text = v_clean_text,
    updated_at = now()
  WHERE id = p_page_id AND user_id = p_user_id;

  -- 4. Idempotência / Limpeza atómica de chunks anteriores desta página
  DELETE FROM public.note_chunks
  WHERE page_id = p_page_id AND user_id = p_user_id;

  -- 5. Inserir os novos chunks estruturados (se algum falhar, toda a transação reverte)
  IF p_chunks IS NOT NULL AND jsonb_array_length(p_chunks) > 0 THEN
    FOR v_chunk IN 
      SELECT 
        (value->>'chunk_index')::integer AS idx,
        COALESCE(value->>'chunk_type', 'theory') AS c_type,
        trim(value->>'content') AS c_content,
        COALESCE((value->>'token_count')::integer, 0) AS t_count
      FROM jsonb_array_elements(p_chunks)
    LOOP
      IF v_chunk.c_content IS NOT NULL AND char_length(v_chunk.c_content) > 0 THEN
        -- Validação estrita: conteúdo DEVE existir no confirmed_text
        IF position(v_chunk.c_content in v_clean_text) = 0 THEN
          RAISE EXCEPTION 'Violação da Cadeia de Verdade: O bloco de chunk não existe no texto confirmado.';
        END IF;

        INSERT INTO public.note_chunks (
          page_id,
          note_id,
          user_id,
          chunk_index,
          chunk_type,
          content,
          token_count
        )
        VALUES (
          p_page_id,
          p_note_id,
          p_user_id,
          v_chunk.idx,
          v_chunk.c_type,
          v_chunk.c_content,
          GREATEST(v_chunk.t_count, ceil(char_length(v_chunk.c_content)::numeric / 4)::integer)
        );
      END IF;
    END LOOP;
  ELSE
    -- Se p_chunks for vazio, cria um chunk único com o texto confirmado completo
    INSERT INTO public.note_chunks (
      page_id,
      note_id,
      user_id,
      chunk_index,
      chunk_type,
      content,
      token_count
    )
    VALUES (
      p_page_id,
      p_note_id,
      p_user_id,
      0,
      'theory',
      v_clean_text,
      ceil(char_length(v_clean_text)::numeric / 4)::integer
    );
  END IF;

  -- 6. Devolver os chunks criados
  RETURN QUERY
  SELECT 
    c.id,
    c.chunk_index,
    c.chunk_type,
    c.content,
    c.token_count
  FROM public.note_chunks c
  WHERE c.page_id = p_page_id AND c.user_id = p_user_id
  ORDER BY c.chunk_index ASC;
END;
$$;

-- 24. FASE 5: PERSISTÊNCIA ATÓMICA DE EXERCÍCIOS GROUNDED
-- Criação atómica de sessão, associação de testes escolares, exercícios e referências de origem
CREATE OR REPLACE FUNCTION public.create_exercise_session_with_exercises_atomic(
  p_user_id uuid,
  p_subject_id text,
  p_test_ids uuid[],
  p_title text,
  p_exercises jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_session_id uuid;
  v_test_id uuid;
  v_exercise_record jsonb;
  v_ex_id uuid;
  v_source_record jsonb;
  v_created_exercises jsonb := '[]'::jsonb;
  v_single_ex jsonb;
  v_q_type text;
  v_chunk_user uuid;
  v_note_id uuid;
  v_page_id uuid;
  v_note_subject text;
  v_note_test uuid;
  v_page_confirmed text;
  v_source_count integer;
BEGIN
  -- 1. Validação estrita de utilizador e caller
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Utilizador não autenticado.';
  END IF;

  -- Se for invocado por utilizador autenticado, o caller TEM de ser o próprio p_user_id
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'Violação de Segurança: Não pode executar ações em nome de outro utilizador.';
  END IF;

  -- 2. Validação de disciplina oficial estável
  IF NOT EXISTS (SELECT 1 FROM public.subjects WHERE id = p_subject_id) THEN
    RAISE EXCEPTION 'Disciplina inválida ou inexistente: %', p_subject_id;
  END IF;

  -- 3. Criação da sessão de estudo
  INSERT INTO public.exercise_sessions (
    user_id,
    subject_id,
    title,
    mode,
    status
  )
  VALUES (
    p_user_id,
    p_subject_id,
    COALESCE(NULLIF(trim(p_title), ''), 'Treino de Exercícios'),
    'study',
    'in_progress'
  )
  RETURNING id INTO v_session_id;

  -- 4. Associação de testes à sessão (com validação estrita de ownership por tenant e disciplina)
  IF p_test_ids IS NOT NULL AND array_length(p_test_ids, 1) > 0 THEN
    FOREACH v_test_id IN ARRAY p_test_ids LOOP
      IF NOT EXISTS (
        SELECT 1 FROM public.tests 
        WHERE id = v_test_id 
          AND user_id = p_user_id 
          AND subject_id = p_subject_id
      ) THEN
        RAISE EXCEPTION 'Violação de Isolamento: O teste % não pertence ao utilizador ou não é da disciplina %.', v_test_id, p_subject_id;
      END IF;

      INSERT INTO public.session_tests (session_id, test_id, user_id)
      VALUES (v_session_id, v_test_id, p_user_id)
      ON CONFLICT DO NOTHING;
    END LOOP;
  END IF;

  -- 5. Inserção de exercícios gerados e respetivas fontes documentais
  IF p_exercises IS NOT NULL AND jsonb_array_length(p_exercises) > 0 THEN
    FOR v_exercise_record IN SELECT * FROM jsonb_array_elements(p_exercises) LOOP
      v_q_type := v_exercise_record->>'question_type';
      IF v_q_type NOT IN ('multiple_choice', 'open_answer', 'calculation', 'true_false') THEN
        RAISE EXCEPTION 'Tipo de pergunta inválido: %', v_q_type;
      END IF;

      INSERT INTO public.exercises (
        session_id,
        user_id,
        subject_id,
        prompt,
        question_type,
        options,
        correct_answer,
        scoring_rubric,
        max_points
      )
      VALUES (
        v_session_id,
        p_user_id,
        p_subject_id,
        trim(v_exercise_record->>'prompt'),
        v_q_type,
        v_exercise_record->'options',
        trim(v_exercise_record->>'correct_answer'),
        COALESCE(v_exercise_record->'scoring_rubric', '{}'::jsonb),
        COALESCE((v_exercise_record->>'max_points')::numeric, 20.00)
      )
      RETURNING id INTO v_ex_id;

      -- Inserção das fontes documentais obrigatórias (Grounded)
      v_source_count := 0;
      IF v_exercise_record->'source_references' IS NOT NULL AND jsonb_array_length(v_exercise_record->'source_references') > 0 THEN
        FOR v_source_record IN SELECT * FROM jsonb_array_elements(v_exercise_record->'source_references') LOOP
          -- Validar chunk_id através de join completo para garantir verdade documental
          SELECT 
            c.user_id, 
            c.note_id, 
            c.page_id, 
            n.subject_id,
            n.test_id,
            p.confirmed_text
          INTO 
            v_chunk_user, 
            v_note_id, 
            v_page_id, 
            v_note_subject,
            v_note_test,
            v_page_confirmed
          FROM public.note_chunks c
          JOIN public.personal_notes n ON c.note_id = n.id
          JOIN public.note_pages p ON c.page_id = p.id
          WHERE c.id = (v_source_record->>'chunk_id')::uuid;

          -- Validação 1: O chunk existe e pertence estritamente ao utilizador
          IF NOT FOUND OR v_chunk_user <> p_user_id THEN
            RAISE EXCEPTION 'Violação de Isolamento: O chunk % não pertence ao utilizador.', (v_source_record->>'chunk_id');
          END IF;

          -- Validação 2: O chunk pertence à disciplina do exercício
          IF v_note_subject <> p_subject_id THEN
            RAISE EXCEPTION 'Violação Grounded: O chunk % pertence a outra disciplina (%).', (v_source_record->>'chunk_id'), v_note_subject;
          END IF;

          -- Validação 3: A página DEVE ter texto confirmado (nunca raw_ocr_text)
          IF v_page_confirmed IS NULL OR char_length(trim(v_page_confirmed)) = 0 THEN
            RAISE EXCEPTION 'Violação Grounded: A folha do chunk % não tem texto confirmado pelo estudante.', (v_source_record->>'chunk_id');
          END IF;

          -- Validação 4: Se o aluno selecionou testes específicos, o chunk DEVE pertencer a um dos testes escolhidos!
          IF p_test_ids IS NOT NULL AND array_length(p_test_ids, 1) > 0 THEN
            IF v_note_test IS NULL OR NOT (v_note_test = ANY(p_test_ids)) THEN
              RAISE EXCEPTION 'Violação Grounded: O chunk % não pertence aos testes selecionados.', (v_source_record->>'chunk_id');
            END IF;
          END IF;

          INSERT INTO public.exercise_source_references (
            exercise_id,
            user_id,
            note_id,
            page_id,
            chunk_id,
            citation_excerpt
          )
          VALUES (
            v_ex_id,
            p_user_id,
            v_note_id,
            v_page_id,
            (v_source_record->>'chunk_id')::uuid,
            trim(v_source_record->>'citation_excerpt')
          );
          v_source_count := v_source_count + 1;
        END LOOP;
      END IF;

      IF v_source_count = 0 THEN
        RAISE EXCEPTION 'Violação Grounded: Todo o exercício tem de ter pelo menos uma referência a chunks dos apontamentos.';
      END IF;

      -- Construir objeto sanitizado para o estudante (SEM a solução correta ou rubrica)
      v_single_ex := jsonb_build_object(
        'id', v_ex_id,
        'session_id', v_session_id,
        'subject_id', p_subject_id,
        'prompt', trim(v_exercise_record->>'prompt'),
        'question_type', v_q_type,
        'options', v_exercise_record->'options',
        'max_points', COALESCE((v_exercise_record->>'max_points')::numeric, 20.00),
        'source_references', v_exercise_record->'source_references'
      );
      v_created_exercises := v_created_exercises || jsonb_build_array(v_single_ex);
    END LOOP;
  ELSE
    RAISE EXCEPTION 'Nenhum exercício válido para persistir.';
  END IF;

  RETURN jsonb_build_object(
    'session_id', v_session_id,
    'subject_id', p_subject_id,
    'exercises', v_created_exercises
  );
END;
$$;

-- 25. FUNÇÃO RPC PARA OBTER QUESTÕES DA SESSÃO SEM EXPÔR O GABARITO
CREATE OR REPLACE FUNCTION public.get_session_questions_for_student(p_session_id uuid)
RETURNS TABLE (
  id uuid,
  session_id uuid,
  subject_id text,
  prompt text,
  question_type text,
  options jsonb,
  max_points numeric,
  source_note_ref text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    e.id,
    e.session_id,
    e.subject_id,
    e.prompt,
    e.question_type,
    e.options,
    e.max_points,
    COALESCE(
      (
        SELECT n.title || ' · Pág. ' || p.page_number
        FROM public.exercise_source_references r
        JOIN public.personal_notes n ON r.note_id = n.id
        LEFT JOIN public.note_pages p ON r.page_id = p.id
        WHERE r.exercise_id = e.id
        LIMIT 1
      ),
      'Apontamentos de Caderno'
    ) AS source_note_ref
  FROM public.exercises e
  WHERE e.session_id = p_session_id
    AND e.user_id = auth.uid()
  ORDER BY e.created_at ASC;
END;
$$;

-- 26. QUERY DETERMINÍSTICA E SEGURA DE CHUNKS AUTORIZADOS
-- Garante que NUNCA são obtidos chunks fora dos testes selecionados ou sem confirmed_text
CREATE OR REPLACE FUNCTION public.get_authorized_note_chunks(
  p_user_id uuid,
  p_subject_id text,
  p_test_ids uuid[],
  p_limit integer DEFAULT 30
)
RETURNS TABLE (
  id uuid,
  chunk_index integer,
  chunk_type text,
  content text,
  page_id uuid,
  page_number integer,
  document_name text,
  note_id uuid,
  note_title text,
  test_id uuid,
  test_title text,
  subject_id text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Se for invocado por authenticated role, verificar que o utilizador só consulta os seus dados
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'Violação de Segurança: Não pode consultar apontamentos de outro utilizador.';
  END IF;

  RETURN QUERY
  SELECT 
    c.id,
    c.chunk_index,
    c.chunk_type,
    c.content,
    p.id AS page_id,
    p.page_number,
    p.document_name,
    n.id AS note_id,
    n.title AS note_title,
    t.id AS test_id,
    t.title AS test_title,
    n.subject_id
  FROM public.note_chunks c
  JOIN public.note_pages p ON c.page_id = p.id
  JOIN public.personal_notes n ON c.note_id = n.id
  LEFT JOIN public.tests t ON n.test_id = t.id
  WHERE c.user_id = p_user_id
    AND n.subject_id = p_subject_id
    AND p.confirmed_text IS NOT NULL
    AND char_length(trim(c.content)) > 0
    AND (
      p_test_ids IS NULL 
      OR array_length(p_test_ids, 1) IS NULL 
      OR array_length(p_test_ids, 1) = 0 
      OR n.test_id = ANY(p_test_ids)
    )
  ORDER BY 
    COALESCE(t.created_at, n.created_at) ASC,
    n.created_at ASC,
    p.page_number ASC,
    c.chunk_index ASC
  LIMIT LEAST(GREATEST(p_limit, 1), 50);
END;
$$;

-- 27. RATE LIMITING PERSISTENTE NO POSTGRESQL (IMUNE A COLD STARTS E MULTI-INSTANCE)
CREATE TABLE IF NOT EXISTS public.api_rate_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_user_action_time
  ON public.api_rate_limits (user_id, action, created_at DESC);

CREATE OR REPLACE FUNCTION public.check_and_record_rate_limit(
  p_user_id uuid,
  p_action text,
  p_max_requests integer,
  p_window_seconds integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count integer;
BEGIN
  -- 1. Contar pedidos do utilizador dentro da janela temporal
  SELECT count(*)
  INTO v_count
  FROM public.api_rate_limits
  WHERE user_id = p_user_id
    AND action = p_action
    AND created_at >= (now() - (p_window_seconds || ' seconds')::interval);

  IF v_count >= p_max_requests THEN
    RETURN false; -- Excedeu o limite (Rate Limited)
  END IF;

  -- 2. Registar este pedido
  INSERT INTO public.api_rate_limits (user_id, action)
  VALUES (p_user_id, p_action);

  -- 3. Limpeza periódica de registos com mais de 2 horas (Housekeeping)
  DELETE FROM public.api_rate_limits
  WHERE created_at < (now() - interval '2 hours');

  RETURN true; -- Autorizado
END;
$$;

-- ==============================================================================
-- 28. FASE 6: SUBMISSÃO ATÓMICA E CORREÇÃO DETERMINÍSTICA NO SERVIDOR
-- O gabarito reside exclusivamente no PostgreSQL. O cliente nunca calcula pontuação.
-- Avaliação protegida contra submissões duplicadas, IDOR e adulteração de notas.
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.submit_exercise_session_answers_atomic(
  p_session_id uuid,
  p_answers jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id uuid := auth.uid();
  v_session public.exercise_sessions%ROWTYPE;
  v_answer_record record;
  v_exercise public.exercises%ROWTYPE;
  v_ex_id uuid;
  v_student_answer text;
  v_is_correct boolean;
  v_points_awarded numeric(5,2);
  v_review_status text;
  v_feedback text;
  v_total_awarded numeric(5,2) := 0.00;
  v_max_possible numeric(5,2) := 0.00;
  v_scale_20 numeric(4,2) := 0.00;
  v_correct_count integer := 0;
  v_incorrect_count integer := 0;
  v_pending_count integer := 0;
  v_processed_ex_ids uuid[] := '{}';
  v_exercise_results jsonb := '[]'::jsonb;
  v_single_result jsonb;
  v_num_student numeric;
  v_num_official numeric;
  v_num_tolerance numeric;
  v_option_text text;
  v_norm_student text;
  v_norm_official text;
  v_valid_option boolean;
  v_source_ref text;
  v_citation text;
  v_accepted_alt text;
  v_matched_alt boolean;
BEGIN
  -- 1. Validar utilizador autenticado
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Utilizador não autenticado.';
  END IF;

  -- 2. Obter e bloquear a sessão para atualização concorrente segura (Prevenção de Race Conditions)
  SELECT * INTO v_session
  FROM public.exercise_sessions
  WHERE id = p_session_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sessão inexistente: %', p_session_id;
  END IF;

  -- 3. Isolamento multi-tenant estrito
  IF v_session.user_id <> v_caller_id THEN
    RAISE EXCEPTION 'Violação de Isolamento: A sessão % não pertence ao utilizador autenticado.', p_session_id;
  END IF;

  -- 4. Idempotência / Prevenção de submissões duplicadas
  IF v_session.status = 'completed' THEN
    RAISE EXCEPTION 'Sessão já concluída: Esta sessão de exercícios já foi submetida e corrigida anteriormente.';
  END IF;

  -- Configurar flag interna de transação para permitir inserção de notas/pontos pelo servidor
  PERFORM set_config('app.evaluating_attempt', 'true', true);

  -- 5. Processar cada resposta enviada pelo aluno
  IF p_answers IS NOT NULL AND jsonb_array_length(p_answers) > 0 THEN
    FOR v_answer_record IN 
      SELECT 
        (value->>'exercise_id')::uuid AS ex_id,
        value->>'student_answer' AS st_ans
      FROM jsonb_array_elements(p_answers)
    LOOP
      v_ex_id := v_answer_record.ex_id;
      v_student_answer := v_answer_record.st_ans;

      -- Prevenir IDs de exercício duplicados no mesmo payload
      IF v_ex_id = ANY(v_processed_ex_ids) THEN
        CONTINUE;
      END IF;
      v_processed_ex_ids := array_append(v_processed_ex_ids, v_ex_id);

      -- Obter exercício e validar posse e pertença à sessão
      SELECT * INTO v_exercise
      FROM public.exercises
      WHERE id = v_ex_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Exercício inexistente: %', v_ex_id;
      END IF;

      IF v_exercise.session_id <> p_session_id OR v_exercise.user_id <> v_caller_id THEN
        RAISE EXCEPTION 'Violação de Integridade: O exercício % não pertence a esta sessão ou utilizador.', v_ex_id;
      END IF;

      -- Avaliação server-side rigorosa por tipo de questão
      v_is_correct := false;
      v_points_awarded := 0.00;
      v_review_status := 'evaluated';
      v_feedback := '';

      -- A) Resposta em branco ou nula
      IF v_student_answer IS NULL OR trim(v_student_answer) = '' THEN
        v_is_correct := false;
        v_points_awarded := 0.00;
        v_review_status := 'evaluated';
        v_feedback := 'Resposta em branco.';
        v_incorrect_count := v_incorrect_count + 1;

      -- B) Escolha Múltipla
      ELSIF v_exercise.question_type = 'multiple_choice' THEN
        -- Validar se a opção submetida existe realmente no array de opções
        v_valid_option := false;
        IF v_exercise.options IS NOT NULL AND jsonb_array_length(v_exercise.options) > 0 THEN
          FOR v_option_text IN SELECT jsonb_array_elements_text(v_exercise.options) LOOP
            IF trim(v_option_text) = trim(v_student_answer) THEN
              v_valid_option := true;
              EXIT;
            END IF;
          END LOOP;
        END IF;

        IF NOT v_valid_option THEN
          -- Opção forjada ou inexistente
          v_is_correct := false;
          v_points_awarded := 0.00;
          v_review_status := 'evaluated';
          v_feedback := 'Opção submetida inválida ou inexistente nas opções do exercício.';
          v_incorrect_count := v_incorrect_count + 1;
        ELSE
          IF trim(lower(v_student_answer)) = trim(lower(v_exercise.correct_answer)) THEN
            v_is_correct := true;
            v_points_awarded := v_exercise.max_points;
            v_review_status := 'evaluated';
            v_feedback := 'Resposta correta.';
            v_correct_count := v_correct_count + 1;
          ELSE
            v_is_correct := false;
            v_points_awarded := 0.00;
            v_review_status := 'evaluated';
            v_feedback := 'Resposta incorreta.';
            v_incorrect_count := v_incorrect_count + 1;
          END IF;
        END IF;

      -- C) Verdadeiro / Falso
      ELSIF v_exercise.question_type = 'true_false' THEN
        v_norm_student := lower(trim(v_student_answer));
        v_norm_official := lower(trim(v_exercise.correct_answer));

        -- Normalizar valores aceites
        IF v_norm_student IN ('verdadeiro', 'v', 'true') THEN
          v_norm_student := 'verdadeiro';
        ELSIF v_norm_student IN ('falso', 'f', 'false') THEN
          v_norm_student := 'falso';
        ELSE
          v_norm_student := 'invalido';
        END IF;

        IF v_norm_official IN ('verdadeiro', 'v', 'true') THEN
          v_norm_official := 'verdadeiro';
        ELSE
          v_norm_official := 'falso';
        END IF;

        IF v_norm_student = 'invalido' THEN
          v_is_correct := false;
          v_points_awarded := 0.00;
          v_review_status := 'evaluated';
          v_feedback := 'Formato inválido para questão de Verdadeiro/Falso.';
          v_incorrect_count := v_incorrect_count + 1;
        ELSIF v_norm_student = v_norm_official THEN
          v_is_correct := true;
          v_points_awarded := v_exercise.max_points;
          v_review_status := 'evaluated';
          v_feedback := 'Resposta correta.';
          v_correct_count := v_correct_count + 1;
        ELSE
          v_is_correct := false;
          v_points_awarded := 0.00;
          v_review_status := 'evaluated';
          v_feedback := 'Resposta incorreta.';
          v_incorrect_count := v_incorrect_count + 1;
        END IF;

      -- D) Resposta Curta / Aberta
      ELSIF v_exercise.question_type = 'open_answer' THEN
        -- Critério determinístico: normalização de espaços, casing e pontuação final
        v_norm_student := lower(trim(regexp_replace(v_student_answer, '\s+', ' ', 'g')));
        v_norm_student := rtrim(v_norm_student, '.,;!');
        v_norm_official := lower(trim(regexp_replace(v_exercise.correct_answer, '\s+', ' ', 'g')));
        v_norm_official := rtrim(v_norm_official, '.,;!');

        IF v_norm_student = v_norm_official THEN
          v_is_correct := true;
          v_points_awarded := v_exercise.max_points;
          v_review_status := 'evaluated';
          v_feedback := 'Resposta correta segundo o critério determinístico dos apontamentos.';
          v_correct_count := v_correct_count + 1;
        ELSE
          -- Verificar se existem respostas alternativas explicitamente validadas na rubrica
          v_matched_alt := false;
          IF v_exercise.scoring_rubric->'accepted_answers' IS NOT NULL THEN
            FOR v_accepted_alt IN SELECT jsonb_array_elements_text(v_exercise.scoring_rubric->'accepted_answers') LOOP
              IF v_norm_student = lower(trim(rtrim(v_accepted_alt, '.,;!'))) THEN
                v_matched_alt := true;
                EXIT;
              END IF;
            END LOOP;
          END IF;

          IF v_matched_alt THEN
            v_is_correct := true;
            v_points_awarded := v_exercise.max_points;
            v_review_status := 'evaluated';
            v_feedback := 'Resposta correta segundo variante aceite na rubrica.';
            v_correct_count := v_correct_count + 1;
          ELSE
            -- Sem critério determinístico seguro: marcar como pendente de avaliação (NÃO inventar classificação)
            v_is_correct := NULL;
            v_points_awarded := 0.00;
            v_review_status := 'pending_review';
            v_feedback := 'Pendente de avaliação: resposta aberta sem critério determinístico imediato.';
            v_pending_count := v_pending_count + 1;
          END IF;
        END IF;

      -- E) Cálculo
      ELSIF v_exercise.question_type = 'calculation' THEN
        -- Tentar comparação numérica segura
        BEGIN
          v_num_student := replace(trim(v_student_answer), ',', '.')::numeric;
          v_num_official := replace(trim(v_exercise.correct_answer), ',', '.')::numeric;
          v_num_tolerance := COALESCE((v_exercise.scoring_rubric->>'tolerance')::numeric, 0.0001);

          IF abs(v_num_student - v_num_official) <= v_num_tolerance THEN
            v_is_correct := true;
            v_points_awarded := v_exercise.max_points;
            v_review_status := 'evaluated';
            v_feedback := 'Cálculo correto.';
            v_correct_count := v_correct_count + 1;
          ELSE
            v_is_correct := false;
            v_points_awarded := 0.00;
            v_review_status := 'evaluated';
            v_feedback := 'Resultado numérico não coincide com a solução oficial.';
            v_incorrect_count := v_incorrect_count + 1;
          END IF;
        EXCEPTION WHEN OTHERS THEN
          -- Não é puramente numérico ou contém fórmula não avaliável deterministicamente
          v_is_correct := NULL;
          v_points_awarded := 0.00;
          v_review_status := 'pending_review';
          v_feedback := 'Pendente de avaliação: resolução de cálculo requer validação de passos.';
          v_pending_count := v_pending_count + 1;
        END;

      ELSE
        -- Outro tipo não determinístico (ex: desenvolvimento livre)
        v_is_correct := NULL;
        v_points_awarded := 0.00;
        v_review_status := 'pending_review';
        v_feedback := 'Pendente de avaliação: requer correção segundo rubrica.';
        v_pending_count := v_pending_count + 1;
      END IF;

      -- Registar a tentativa oficial (Exercise Attempt)
      INSERT INTO public.exercise_attempts (
        exercise_id,
        session_id,
        user_id,
        student_answer,
        awarded_points,
        feedback,
        is_correct,
        review_status
      )
      VALUES (
        v_ex_id,
        p_session_id,
        v_caller_id,
        COALESCE(v_student_answer, ''),
        v_points_awarded,
        v_feedback,
        v_is_correct,
        v_review_status
      );

      v_total_awarded := v_total_awarded + v_points_awarded;
      v_max_possible := v_max_possible + v_exercise.max_points;

      -- Obter referência ao caderno
      SELECT 
        COALESCE(n.title || ' · Pág. ' || p.page_number, 'Apontamentos'),
        COALESCE(r.citation_excerpt, '')
      INTO v_source_ref, v_citation
      FROM public.exercise_source_references r
      JOIN public.personal_notes n ON r.note_id = n.id
      LEFT JOIN public.note_pages p ON r.page_id = p.id
      WHERE r.exercise_id = v_ex_id
      LIMIT 1;

      -- Construir objeto de revisão de cada exercício
      v_single_result := jsonb_build_object(
        'exercise_id', v_ex_id,
        'prompt', v_exercise.prompt,
        'question_type', v_exercise.question_type,
        'options', v_exercise.options,
        'student_answer', v_student_answer,
        'correct_answer', v_exercise.correct_answer, -- Agora autorizado porque a sessão é concluída
        'is_correct', v_is_correct,
        'review_status', v_review_status,
        'awarded_points', v_points_awarded,
        'max_points', v_exercise.max_points,
        'feedback', v_feedback,
        'source_note_ref', COALESCE(v_source_ref, 'Apontamentos'),
        'citation_excerpt', COALESCE(v_citation, '')
      );
      v_exercise_results := v_exercise_results || jsonb_build_array(v_single_result);
    END LOOP;
  END IF;

  -- Se não houve exercícios ou cotação total = 0, prevenir divisão por zero
  IF v_max_possible > 0 THEN
    v_scale_20 := round((v_total_awarded / v_max_possible) * 20.00, 2);
  ELSE
    v_scale_20 := 0.00;
  END IF;

  -- 6. Concluir a sessão na base de dados
  UPDATE public.exercise_sessions
  SET 
    status = 'completed',
    completed_at = now(),
    score = v_total_awarded,
    max_score = v_max_possible,
    score_scale_20 = v_scale_20
  WHERE id = p_session_id;

  -- 7. Atualizar estatísticas do utilizador em study_stats
  UPDATE public.study_stats
  SET 
    exercises_solved = exercises_solved + (v_correct_count + v_incorrect_count),
    correct_answers = correct_answers + v_correct_count,
    success_rate = CASE 
      WHEN (exercises_solved + v_correct_count + v_incorrect_count) > 0 
      THEN round(((correct_answers + v_correct_count)::numeric * 100.0) / (exercises_solved + v_correct_count + v_incorrect_count)::numeric, 2)
      ELSE 0.00
    END,
    average_score_scale_20 = CASE 
      WHEN (exercises_solved + v_correct_count + v_incorrect_count) > 0 
      THEN round((((average_score_scale_20 * exercises_solved) + (v_scale_20 * (v_correct_count + v_incorrect_count))) / (exercises_solved + v_correct_count + v_incorrect_count))::numeric, 2)
      ELSE v_scale_20
    END,
    last_study_date = CURRENT_DATE,
    updated_at = now()
  WHERE user_id = v_caller_id;

  -- 8. Devolver payload completo de resultados
  RETURN jsonb_build_object(
    'session_id', p_session_id,
    'subject_id', v_session.subject_id,
    'title', v_session.title,
    'status', 'completed',
    'total_score', v_total_awarded,
    'max_score', v_max_possible,
    'score_scale_20', v_scale_20,
    'correct_count', v_correct_count,
    'incorrect_count', v_incorrect_count,
    'pending_count', v_pending_count,
    'exercises', v_exercise_results
  );
END;
$$;

-- ==============================================================================
-- 29. CONSULTA AUTORIZADA DE RESULTADOS E REVISÃO PÓS-CONCLUSÃO
-- Bloqueia a consulta prematura de gabarito enquanto a sessão está ativa.
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.get_session_results_for_student(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id uuid := auth.uid();
  v_session public.exercise_sessions%ROWTYPE;
  v_results jsonb := '[]'::jsonb;
  v_single jsonb;
  v_rec record;
  v_correct_cnt integer := 0;
  v_incorrect_cnt integer := 0;
  v_pending_cnt integer := 0;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Utilizador não autenticado.';
  END IF;

  SELECT * INTO v_session
  FROM public.exercise_sessions
  WHERE id = p_session_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sessão inexistente: %', p_session_id;
  END IF;

  IF v_session.user_id <> v_caller_id THEN
    RAISE EXCEPTION 'Violação de Isolamento: Não tem permissão para consultar os resultados desta sessão.';
  END IF;

  IF v_session.status <> 'completed' THEN
    RAISE EXCEPTION 'Acesso Antecipado Bloqueado: O gabarito e os resultados só podem ser consultados após a conclusão da sessão.';
  END IF;

  FOR v_rec IN 
    SELECT 
      e.id AS exercise_id,
      e.prompt,
      e.question_type,
      e.options,
      e.correct_answer,
      e.max_points,
      a.student_answer,
      a.awarded_points,
      a.is_correct,
      a.review_status,
      a.feedback,
      COALESCE(
        (SELECT n.title || ' · Pág. ' || p.page_number
         FROM public.exercise_source_references r
         JOIN public.personal_notes n ON r.note_id = n.id
         LEFT JOIN public.note_pages p ON r.page_id = p.id
         WHERE r.exercise_id = e.id LIMIT 1),
        'Apontamentos'
      ) AS source_note_ref,
      COALESCE(
        (SELECT r.citation_excerpt
         FROM public.exercise_source_references r
         WHERE r.exercise_id = e.id LIMIT 1),
        ''
      ) AS citation_excerpt
    FROM public.exercises e
    LEFT JOIN public.exercise_attempts a ON a.exercise_id = e.id AND a.user_id = v_caller_id
    WHERE e.session_id = p_session_id
      AND e.user_id = v_caller_id
    ORDER BY e.created_at ASC
  LOOP
    IF v_rec.review_status = 'pending_review' THEN
      v_pending_cnt := v_pending_cnt + 1;
    ELSIF v_rec.is_correct = true THEN
      v_correct_cnt := v_correct_cnt + 1;
    ELSE
      v_incorrect_cnt := v_incorrect_cnt + 1;
    END IF;

    v_single := jsonb_build_object(
      'exercise_id', v_rec.exercise_id,
      'prompt', v_rec.prompt,
      'question_type', v_rec.question_type,
      'options', v_rec.options,
      'student_answer', v_rec.student_answer,
      'correct_answer', v_rec.correct_answer,
      'is_correct', v_rec.is_correct,
      'review_status', v_rec.review_status,
      'awarded_points', v_rec.awarded_points,
      'max_points', v_rec.max_points,
      'feedback', v_rec.feedback,
      'source_note_ref', v_rec.source_note_ref,
      'citation_excerpt', v_rec.citation_excerpt
    );
    v_results := v_results || jsonb_build_array(v_single);
  END LOOP;

  RETURN jsonb_build_object(
    'session_id', v_session.id,
    'subject_id', v_session.subject_id,
    'title', v_session.title,
    'status', v_session.status,
    'total_score', v_session.score,
    'max_score', v_session.max_score,
    'score_scale_20', v_session.score_scale_20,
    'correct_count', v_correct_cnt,
    'incorrect_count', v_incorrect_cnt,
    'pending_count', v_pending_cnt,
    'exercises', v_results
  );
END;
$$;

