-- ===== LIMPEZA (a base de dados é nova; apaga o que ficou a meio) =====
DO $$ BEGIN
  DROP POLICY IF EXISTS "personal_vault_select_own" ON storage.objects;
  DROP POLICY IF EXISTS "personal_vault_insert_own" ON storage.objects;
  DROP POLICY IF EXISTS "personal_vault_update_own" ON storage.objects;
  DROP POLICY IF EXISTS "personal_vault_delete_own" ON storage.objects;
  DROP POLICY IF EXISTS "curated_library_select_all" ON storage.objects;
  DROP POLICY IF EXISTS "curated_library_manage_admin" ON storage.objects;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'limpeza do storage ignorada: %', SQLERRM;
END $$;

DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
GRANT USAGE, CREATE ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres, anon, authenticated, service_role;


-- ===== 20261001000000_phase2_security_and_database.sql =====
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
-- No Supabase o schema storage já existe e não se pode alterar: só se criam os buckets e as políticas.
-- Cada instrução é tolerante a falhas (o Supabase pode não permitir; o servidor usa a service role).
DO $$ BEGIN
  INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  VALUES
    ('personal-vault', 'personal-vault', false, 52428800, ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
    ('curated-library', 'curated-library', true, 52428800, ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
  ON CONFLICT (id) DO UPDATE SET
    public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'buckets ignorados: %', SQLERRM;
END $$;

DO $$ BEGIN
  CREATE POLICY "curated_library_select_all" ON storage.objects FOR SELECT TO authenticated
    USING (bucket_id = 'curated-library');
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'politica ignorada: %', SQLERRM;
END $$;

DO $$ BEGIN
  CREATE POLICY "curated_library_manage_admin" ON storage.objects FOR ALL TO authenticated
    USING (bucket_id = 'curated-library' AND public.is_admin())
    WITH CHECK (bucket_id = 'curated-library' AND public.is_admin());
EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'politica ignorada: %', SQLERRM;
END $$;

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



-- ===== 20261024000000_turma_c_official_schema.sql =====
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


-- ===== 20261024010000_turma_c_phase_a1_audit_fixes.sql =====
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


-- ===== 20261024020000_turma_c_phase_a2_verification_fixes.sql =====
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


-- ===== 20261024030000_turma_c_phase_b_notes_management.sql =====
-- ==============================================================================
-- STUDENTS HUB — FASE B: GESTÃO SEGURA DE APONTAMENTOS HTML E AUDITORIA
-- Slogan: "Apontamentos que ajudam, exercícios que resultam. Rumo ao 20."
-- Princípio Sagrado: «SEMPRE COM BASE NOS APONTAMENTOS OFICIAIS!!!»
-- Migração Incremental, Não-Destrutiva e Reversível
-- ==============================================================================

-- 1. TABELA DE AUDITORIA DE AÇÕES SOBRE APONTAMENTOS OFICIAIS
CREATE TABLE IF NOT EXISTS public.official_note_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id uuid REFERENCES public.official_notes(id) ON DELETE SET NULL,
  version_id uuid REFERENCES public.official_note_versions(id) ON DELETE SET NULL,
  action text NOT NULL CHECK (action IN ('create_note', 'create_version', 'publish_version', 'unpublish_note', 'delete_draft_version')),
  performed_by uuid NOT NULL REFERENCES auth.users(id),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- RLS em official_note_audit_logs
ALTER TABLE public.official_note_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.official_note_audit_logs FORCE ROW LEVEL SECURITY;

-- Apenas administradores podem ler os registos de auditoria
DROP POLICY IF EXISTS "official_note_audit_logs_select_admin" ON public.official_note_audit_logs;
CREATE POLICY "official_note_audit_logs_select_admin"
  ON public.official_note_audit_logs FOR SELECT
  TO authenticated
  USING (public.is_admin());

-- Inserção permitida para administradores ou contexto do servidor
DROP POLICY IF EXISTS "official_note_audit_logs_insert_admin" ON public.official_note_audit_logs;
CREATE POLICY "official_note_audit_logs_insert_admin"
  ON public.official_note_audit_logs FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

-- Sem policies de UPDATE ou DELETE: o registo de auditoria é estritamente imutável
REVOKE UPDATE, DELETE ON public.official_note_audit_logs FROM authenticated, anon;
REVOKE INSERT ON public.official_note_audit_logs FROM anon;
GRANT SELECT, INSERT ON public.official_note_audit_logs TO authenticated;

-- 2. REFORÇO DE ISOLAMENTO DE RASCUNHOS EM OFFICIAL_NOTE_VERSIONS
-- Um aluno só pode consultar uma versão se ela estiver publicada E o apontamento pai também estiver publicado!
DROP POLICY IF EXISTS "official_note_versions_select_published" ON public.official_note_versions;
CREATE POLICY "official_note_versions_select_published"
  ON public.official_note_versions FOR SELECT
  TO authenticated
  USING (
    public.is_admin() OR (
      is_published = true AND EXISTS (
        SELECT 1 FROM public.official_notes n
        WHERE n.id = official_note_versions.note_id AND n.is_published = true
      )
    )
  );

-- 3. TRIGGER DE PROTEÇÃO CONTRA ELIMINAÇÃO DE VERSÕES PUBLICADAS
CREATE OR REPLACE FUNCTION public.protect_published_note_version_deletion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Bloquear se já estiver publicada
  IF OLD.is_published = true THEN
    RAISE EXCEPTION 'Violação de Integridade: Não é permitido eliminar uma versão de apontamento que já foi publicada. Deve despublicar o apontamento para retirar a visibilidade sem apagar o histórico de auditoria.';
  END IF;

  -- Bloquear se for referenciada por exercícios oficiais
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
FOR EACH ROW EXECUTE FUNCTION public.protect_published_note_version_deletion();

-- 4. PROCEDIMENTO TRANSACIONAL: CRIAR NOVO APONTAMENTO OFICIAL COM VERSÃO 1
CREATE OR REPLACE FUNCTION public.create_official_note_atomic(
  p_subject_id text,
  p_academic_period text,
  p_theme text,
  p_title text,
  p_raw_html text,
  p_sanitized_html text,
  p_plain_text text DEFAULT '',
  p_change_summary text DEFAULT 'Versão inicial homologada.'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid;
  v_note_id uuid;
  v_version_id uuid;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso Negado: Apenas administradores da Turma C podem carregar e criar apontamentos oficiais.';
  END IF;

  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Autenticação Inválida: Identidade de utilizador ausente na sessão.';
  END IF;

  -- Validações de domínio
  IF NOT EXISTS (SELECT 1 FROM public.subjects WHERE id = p_subject_id) THEN
    RAISE EXCEPTION 'Disciplina inválida: %', p_subject_id;
  END IF;

  IF p_academic_period NOT IN ('P1', 'P2', 'P3') THEN
    RAISE EXCEPTION 'Período letivo inválido: % (deve ser P1, P2 ou P3)', p_academic_period;
  END IF;

  IF char_length(trim(p_theme)) = 0 THEN
    RAISE EXCEPTION 'O tema do apontamento não pode ser vazio.';
  END IF;

  IF char_length(trim(p_title)) = 0 THEN
    RAISE EXCEPTION 'O título do apontamento não pode ser vazio.';
  END IF;

  IF char_length(trim(p_raw_html)) = 0 OR char_length(trim(p_sanitized_html)) = 0 THEN
    RAISE EXCEPTION 'O conteúdo HTML (raw e sanitizado) é obrigatório.';
  END IF;

  -- Inserir cabeçalho do apontamento oficial em modo rascunho
  INSERT INTO public.official_notes (
    subject_id,
    academic_period,
    theme,
    title,
    is_published,
    created_by
  ) VALUES (
    p_subject_id,
    p_academic_period,
    trim(p_theme),
    trim(p_title),
    false,
    v_user_id
  ) RETURNING id INTO v_note_id;

  -- Inserir versão 1 em modo rascunho
  INSERT INTO public.official_note_versions (
    note_id,
    version_number,
    raw_html,
    sanitized_html,
    plain_text_content,
    change_summary,
    is_published,
    created_by
  ) VALUES (
    v_note_id,
    1,
    p_raw_html,
    p_sanitized_html,
    COALESCE(p_plain_text, ''),
    COALESCE(p_change_summary, 'Versão inicial homologada.'),
    false,
    v_user_id
  ) RETURNING id INTO v_version_id;

  -- Associar apontador da versão ativa inicial
  UPDATE public.official_notes
  SET current_version_id = v_version_id
  WHERE id = v_note_id;

  -- Registar na auditoria
  INSERT INTO public.official_note_audit_logs (
    note_id, version_id, action, performed_by, details
  ) VALUES (
    v_note_id, v_version_id, 'create_note', v_user_id,
    jsonb_build_object(
      'title', trim(p_title),
      'theme', trim(p_theme),
      'subject_id', p_subject_id,
      'academic_period', p_academic_period,
      'version_number', 1
    )
  );

  RETURN jsonb_build_object(
    'note_id', v_note_id,
    'version_id', v_version_id,
    'version_number', 1,
    'is_published', false
  );
END;
$$;

-- 5. PROCEDIMENTO TRANSACIONAL: CRIAR NOVA VERSÃO DE APONTAMENTO
CREATE OR REPLACE FUNCTION public.create_official_note_version_atomic(
  p_note_id uuid,
  p_raw_html text,
  p_sanitized_html text,
  p_plain_text text DEFAULT '',
  p_change_summary text DEFAULT 'Nova revisão de apontamento.'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid;
  v_next_version integer;
  v_version_id uuid;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso Negado: Apenas administradores da Turma C podem criar novas versões de apontamentos.';
  END IF;

  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Autenticação Inválida: Identidade de utilizador ausente na sessão.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.official_notes WHERE id = p_note_id) THEN
    RAISE EXCEPTION 'Apontamento oficial não encontrado: %', p_note_id;
  END IF;

  IF char_length(trim(p_raw_html)) = 0 OR char_length(trim(p_sanitized_html)) = 0 THEN
    RAISE EXCEPTION 'O conteúdo HTML (raw e sanitizado) é obrigatório.';
  END IF;

  -- Obter número da próxima versão sequencial
  SELECT COALESCE(MAX(version_number), 0) + 1
  INTO v_next_version
  FROM public.official_note_versions
  WHERE note_id = p_note_id;

  -- Inserir nova versão em modo rascunho
  INSERT INTO public.official_note_versions (
    note_id,
    version_number,
    raw_html,
    sanitized_html,
    plain_text_content,
    change_summary,
    is_published,
    created_by
  ) VALUES (
    p_note_id,
    v_next_version,
    p_raw_html,
    p_sanitized_html,
    COALESCE(p_plain_text, ''),
    COALESCE(p_change_summary, 'Nova revisão.'),
    false,
    v_user_id
  ) RETURNING id INTO v_version_id;

  -- Registar na auditoria
  INSERT INTO public.official_note_audit_logs (
    note_id, version_id, action, performed_by, details
  ) VALUES (
    p_note_id, v_version_id, 'create_version', v_user_id,
    jsonb_build_object(
      'version_number', v_next_version,
      'change_summary', p_change_summary
    )
  );

  RETURN jsonb_build_object(
    'note_id', p_note_id,
    'version_id', v_version_id,
    'version_number', v_next_version,
    'is_published', false
  );
END;
$$;

-- 6. PROCEDIMENTO TRANSACIONAL: PUBLICAR VERSÃO DE APONTAMENTO
CREATE OR REPLACE FUNCTION public.publish_official_note_version_atomic(
  p_version_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid;
  v_note_id uuid;
  v_version_number integer;
  v_now timestamptz := now();
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso Negado: Apenas administradores da Turma C podem publicar versões de apontamentos.';
  END IF;

  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Autenticação Inválida: Identidade de utilizador ausente na sessão.';
  END IF;

  SELECT note_id, version_number
  INTO v_note_id, v_version_number
  FROM public.official_note_versions
  WHERE id = p_version_id;

  IF v_note_id IS NULL THEN
    RAISE EXCEPTION 'Versão de apontamento não encontrada: %', p_version_id;
  END IF;

  -- 1. Marcar esta versão como publicada
  UPDATE public.official_note_versions
  SET is_published = true,
      published_at = COALESCE(published_at, v_now)
  WHERE id = p_version_id;

  -- 2. Atualizar a nota pai: torna-se publicada e current_version_id aponta para esta versão
  UPDATE public.official_notes
  SET is_published = true,
      current_version_id = p_version_id,
      published_at = COALESCE(published_at, v_now),
      updated_at = v_now
  WHERE id = v_note_id;

  -- 3. Registar na auditoria
  INSERT INTO public.official_note_audit_logs (
    note_id, version_id, action, performed_by, details
  ) VALUES (
    v_note_id, p_version_id, 'publish_version', v_user_id,
    jsonb_build_object(
      'version_number', v_version_number,
      'published_at', v_now
    )
  );

  RETURN jsonb_build_object(
    'note_id', v_note_id,
    'version_id', p_version_id,
    'version_number', v_version_number,
    'is_published', true,
    'published_at', v_now
  );
END;
$$;

-- 7. PROCEDIMENTO TRANSACIONAL: DESPUBLICAR APONTAMENTO
CREATE OR REPLACE FUNCTION public.unpublish_official_note_atomic(
  p_note_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid;
  v_now timestamptz := now();
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso Negado: Apenas administradores da Turma C podem despublicar apontamentos.';
  END IF;

  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Autenticação Inválida: Identidade de utilizador ausente na sessão.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.official_notes WHERE id = p_note_id) THEN
    RAISE EXCEPTION 'Apontamento oficial não encontrado: %', p_note_id;
  END IF;

  -- Despublicar cabeçalho do apontamento (versões permanecem no histórico)
  UPDATE public.official_notes
  SET is_published = false,
      updated_at = v_now
  WHERE id = p_note_id;

  -- Registar na auditoria
  INSERT INTO public.official_note_audit_logs (
    note_id, action, performed_by, details
  ) VALUES (
    p_note_id, 'unpublish_note', v_user_id,
    jsonb_build_object('unpublished_at', v_now)
  );

  RETURN jsonb_build_object(
    'note_id', p_note_id,
    'is_published', false,
    'unpublished_at', v_now
  );
END;
$$;

-- 8. PERMISSÕES E REVOGAÇÕES DE SEGURANÇA
REVOKE EXECUTE ON FUNCTION public.create_official_note_atomic(text, text, text, text, text, text, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_official_note_version_atomic(uuid, text, text, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.publish_official_note_version_atomic(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.unpublish_official_note_atomic(uuid) FROM anon;

GRANT EXECUTE ON FUNCTION public.create_official_note_atomic(text, text, text, text, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_official_note_version_atomic(uuid, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.publish_official_note_version_atomic(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unpublish_official_note_atomic(uuid) TO authenticated;


-- ===== 20261024040000_turma_c_phase_b1_audit_fixes.sql =====
-- ==============================================================================
-- STUDENTS HUB — FASE B.1: AUDITORIA CORRETIVA DE SEGURANÇA E INTEGRIDADE
-- Slogan: "Apontamentos que ajudam, exercícios que resultam. Rumo ao 20."
-- Princípio Sagrado: «SEMPRE COM BASE NOS APONTAMENTOS OFICIAIS!!!»
-- Migração Incremental, Não-Destrutiva e Reversível
-- ==============================================================================

-- 1. RATE LIMITING PERSISTENTE E DISTRIBUÍDO NO POSTGRESQL
CREATE TABLE IF NOT EXISTS public.admin_rate_limit_buckets (
  admin_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  window_start timestamptz NOT NULL DEFAULT now(),
  request_count integer NOT NULL DEFAULT 1,
  last_request_at timestamptz NOT NULL DEFAULT now()
);

-- Ativar e forçar RLS
ALTER TABLE public.admin_rate_limit_buckets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_rate_limit_buckets FORCE ROW LEVEL SECURITY;

-- Proibir acesso direto a estudantes e anónimos
REVOKE ALL ON public.admin_rate_limit_buckets FROM anon, authenticated;
DROP POLICY IF EXISTS "admin_rate_limit_select_own" ON public.admin_rate_limit_buckets;
CREATE POLICY "admin_rate_limit_select_own"
  ON public.admin_rate_limit_buckets FOR SELECT
  TO authenticated
  USING (admin_id = auth.uid() AND public.is_admin());

-- RPC Atómica de Verificação e Consumo de Rate Limit com Bloqueio de Linha (FOR UPDATE)
CREATE OR REPLACE FUNCTION public.check_and_consume_admin_rate_limit(
  p_max_requests integer DEFAULT 40,
  p_window_seconds integer DEFAULT 60
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin_id uuid;
  v_now timestamptz := now();
  v_window_start timestamptz;
  v_count integer;
  v_allowed boolean;
  v_remaining integer;
  v_retry_after integer := 0;
BEGIN
  -- 1. Obter identidade do utilizador a partir da sessão segura (nunca confiado no cliente)
  v_admin_id := auth.uid();
  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'Não autenticado: Sessão inválida ou ausente.';
  END IF;

  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso Negado: Apenas administradores podem aceder a este recurso.';
  END IF;

  -- 2. Transação atómica com bloqueio de linha (FOR UPDATE)
  -- Inserir bucket inicial se não existir
  INSERT INTO public.admin_rate_limit_buckets (admin_id, window_start, request_count, last_request_at)
  VALUES (v_admin_id, v_now, 0, v_now)
  ON CONFLICT (admin_id) DO NOTHING;

  -- Bloquear linha para evitar race conditions em pedidos concorrentes
  SELECT window_start, request_count
  INTO v_window_start, v_count
  FROM public.admin_rate_limit_buckets
  WHERE admin_id = v_admin_id
  FOR UPDATE;

  -- 3. Verificar se a janela expirou
  IF (v_now - v_window_start) >= (p_window_seconds || ' seconds')::interval THEN
    -- Reiniciar nova janela
    v_window_start := v_now;
    v_count := 1;
    v_allowed := true;
    v_remaining := p_max_requests - 1;

    UPDATE public.admin_rate_limit_buckets
    SET window_start = v_window_start,
        request_count = v_count,
        last_request_at = v_now
    WHERE admin_id = v_admin_id;
  ELSE
    -- Dentro da janela atual
    IF v_count >= p_max_requests THEN
      v_allowed := false;
      v_remaining := 0;
      v_retry_after := CEIL(EXTRACT(EPOCH FROM (v_window_start + (p_window_seconds || ' seconds')::interval - v_now)))::integer;
      IF v_retry_after < 1 THEN
        v_retry_after := 1;
      END IF;
    ELSE
      v_count := v_count + 1;
      v_allowed := true;
      v_remaining := p_max_requests - v_count;

      UPDATE public.admin_rate_limit_buckets
      SET request_count = v_count,
          last_request_at = v_now
      WHERE admin_id = v_admin_id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'allowed', v_allowed,
    'remaining', v_remaining,
    'retry_after', v_retry_after,
    'current_count', v_count,
    'limit', p_max_requests
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.check_and_consume_admin_rate_limit(integer, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.check_and_consume_admin_rate_limit(integer, integer) TO authenticated;

-- 2. BLINDAGEM RELACIONAL ENTRE NOTAS E VERSÕES (PAR NOTE_ID, ID)
-- Garante que current_version_id NUNCA pode apontar para uma versão pertencente a outra nota
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_official_note_version_pair'
  ) THEN
    ALTER TABLE public.official_note_versions
      ADD CONSTRAINT uq_official_note_version_pair UNIQUE (note_id, id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_official_notes_current_version'
  ) THEN
    ALTER TABLE public.official_notes
      ADD CONSTRAINT fk_official_notes_current_version
      FOREIGN KEY (id, current_version_id)
      REFERENCES public.official_note_versions (note_id, id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- 3. CONSISTÊNCIA ESTRITA DE ESTADOS (NOTA PUBLICADA VS VERSÃO ATIVA)
-- Impede que uma nota publicada aponte para um rascunho ou versão inexistente
CREATE OR REPLACE FUNCTION public.validate_official_note_state_consistency()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_version_is_published boolean;
  v_version_note_id uuid;
BEGIN
  IF NEW.is_published = true THEN
    IF NEW.current_version_id IS NULL THEN
      RAISE EXCEPTION 'Inconsistência de Estado: Uma nota homologada e publicada tem obrigatoriamente de referenciar uma versão ativa (current_version_id).';
    END IF;

    SELECT is_published, note_id
    INTO v_version_is_published, v_version_note_id
    FROM public.official_note_versions
    WHERE id = NEW.current_version_id;

    IF v_version_note_id IS NULL OR v_version_note_id <> NEW.id THEN
      RAISE EXCEPTION 'Inconsistência Relacional: A versão ativa (current_version_id) tem de pertencer estritamente a este apontamento oficial.';
    END IF;

    IF v_version_is_published IS NOT TRUE THEN
      RAISE EXCEPTION 'Inconsistência de Estado: Uma nota publicada não pode referenciar uma versão em rascunho (is_published = false). Deve homologar e publicar a versão antes ou simultaneamente.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_official_note_state_consistency ON public.official_notes;
CREATE TRIGGER trg_validate_official_note_state_consistency
BEFORE INSERT OR UPDATE ON public.official_notes
FOR EACH ROW EXECUTE FUNCTION public.validate_official_note_state_consistency();

-- Impede despublicar isoladamente uma versão que seja a versão ativa de uma nota publicada
CREATE OR REPLACE FUNCTION public.validate_version_unpublish_consistency()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.is_published = false AND OLD.is_published = true THEN
    IF EXISTS (
      SELECT 1 FROM public.official_notes
      WHERE current_version_id = NEW.id AND is_published = true
    ) THEN
      RAISE EXCEPTION 'Inconsistência de Estado: Não é permitido despublicar individualmente uma versão que está atualmente ativa num apontamento publicado. Despublique primeiro o apontamento oficial.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_version_unpublish_consistency ON public.official_note_versions;
CREATE TRIGGER trg_validate_version_unpublish_consistency
BEFORE UPDATE ON public.official_note_versions
FOR EACH ROW EXECUTE FUNCTION public.validate_version_unpublish_consistency();

-- 4. PROCEDIMENTO TRANSACIONAL DE REATIVAÇÃO DE VERSÕES HISTÓRICAS
CREATE OR REPLACE FUNCTION public.reactivate_historical_official_note_version_atomic(
  p_note_id uuid,
  p_version_id uuid,
  p_reason text DEFAULT 'Reativação formal de versão histórica homologada.'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid;
  v_version_number integer;
  v_prev_version_id uuid;
  v_now timestamptz := now();
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso Negado: Apenas administradores da Turma C podem reativar versões de apontamentos.';
  END IF;

  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Autenticação Inválida: Identidade de utilizador ausente na sessão.';
  END IF;

  -- 1. Obter versão atual da nota
  SELECT current_version_id
  INTO v_prev_version_id
  FROM public.official_notes
  WHERE id = p_note_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Apontamento oficial não encontrado: %', p_note_id;
  END IF;

  -- 2. Validar que a versão de destino existe e pertence estritamente a este apontamento
  SELECT version_number
  INTO v_version_number
  FROM public.official_note_versions
  WHERE id = p_version_id AND note_id = p_note_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'A versão especificada não pertence a este apontamento oficial ou não existe.';
  END IF;

  -- 3. Marcar a versão alvo como publicada (se já não estiver)
  UPDATE public.official_note_versions
  SET is_published = true,
      published_at = COALESCE(published_at, v_now)
  WHERE id = p_version_id;

  -- 4. Comutar a versão ativa no apontamento oficial
  UPDATE public.official_notes
  SET current_version_id = p_version_id,
      is_published = true,
      published_at = COALESCE(published_at, v_now),
      updated_at = v_now
  WHERE id = p_note_id;

  -- 5. Registar a ação na tabela de auditoria
  INSERT INTO public.official_note_audit_logs (
    note_id, version_id, action, performed_by, details
  ) VALUES (
    p_note_id, p_version_id, 'reactivate_historical_version', v_user_id,
    jsonb_build_object(
      'previous_version_id', v_prev_version_id,
      'reactivated_version_number', v_version_number,
      'reason', trim(COALESCE(p_reason, 'Reativação de versão histórica'))
    )
  );

  RETURN jsonb_build_object(
    'note_id', p_note_id,
    'version_id', p_version_id,
    'version_number', v_version_number,
    'is_published', true,
    'message', 'Versão histórica reativada com sucesso como versão oficial ativa.'
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.reactivate_historical_official_note_version_atomic(uuid, uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.reactivate_historical_official_note_version_atomic(uuid, uuid, text) TO authenticated;

-- Atualizar constraint de action na tabela de auditoria para incluir reativação
ALTER TABLE public.official_note_audit_logs
  DROP CONSTRAINT IF EXISTS official_note_audit_logs_action_check;

ALTER TABLE public.official_note_audit_logs
  ADD CONSTRAINT official_note_audit_logs_action_check
  CHECK (action IN ('create_note', 'create_version', 'publish_version', 'unpublish_note', 'delete_draft_version', 'reactivate_historical_version'));

-- 5. REFORÇO ESTREITO DE RLS SEM RECURSÃO MÚTUA
-- A consistência da versão ativa é garantida pelo trigger trg_validate_official_note_state_consistency,
-- evitando recursão infinita (42P17) entre official_notes e official_note_versions.
DROP POLICY IF EXISTS "official_notes_select_published" ON public.official_notes;
CREATE POLICY "official_notes_select_published"
  ON public.official_notes FOR SELECT
  TO authenticated
  USING (is_published = true OR public.is_admin());

-- 6. RPC SEGURA PARA LEITURA DE ALUNOS (OMITE RAW_HTML DO PROTOCOLO)
CREATE OR REPLACE FUNCTION public.get_published_official_notes_secure(
  p_subject_id text DEFAULT NULL,
  p_academic_period text DEFAULT NULL
)
RETURNS TABLE (
  note_id uuid,
  subject_id text,
  academic_period text,
  theme text,
  title text,
  version_id uuid,
  version_number integer,
  sanitized_html text,
  plain_text_content text,
  change_summary text,
  published_at timestamptz,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT 
    n.id AS note_id,
    n.subject_id,
    n.academic_period,
    n.theme,
    n.title,
    v.id AS version_id,
    v.version_number,
    v.sanitized_html,
    v.plain_text_content,
    v.change_summary,
    v.published_at,
    n.created_at
  FROM public.official_notes n
  INNER JOIN public.official_note_versions v 
    ON v.id = n.current_version_id 
   AND v.note_id = n.id
  WHERE n.is_published = true
    AND v.is_published = true
    AND (p_subject_id IS NULL OR n.subject_id = p_subject_id)
    AND (p_academic_period IS NULL OR n.academic_period = p_academic_period)
  ORDER BY n.academic_period ASC, n.theme ASC;
$$;

REVOKE EXECUTE ON FUNCTION public.get_published_official_notes_secure(text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_published_official_notes_secure(text, text) TO authenticated;

-- 7. PREPARAÇÃO DA RASTREABILIDADE DOCUMENTAL PARA A FASE C
-- Adicionar colunas de integridade de conteúdo e excerto em exercise_source_references
ALTER TABLE public.exercise_source_references
  ADD COLUMN IF NOT EXISTS content_hash text,
  ADD COLUMN IF NOT EXISTS quote_excerpt text;

-- Validação de integridade de proveniência na criação de referências de exercícios
CREATE OR REPLACE FUNCTION public.validate_exercise_source_provenance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_version_note_id uuid;
  v_note_subject text;
  v_exercise_subject text;
BEGIN
  IF NEW.source_type = 'official' THEN
    IF NEW.official_note_id IS NULL OR NEW.official_version_id IS NULL THEN
      RAISE EXCEPTION 'Inconsistência de Proveniência: Exercícios oficiais têm obrigatoriamente de referenciar official_note_id e official_version_id.';
    END IF;

    -- Validar que a versão pertence à nota indicada
    SELECT note_id INTO v_version_note_id
    FROM public.official_note_versions
    WHERE id = NEW.official_version_id;

    IF v_version_note_id IS NULL OR v_version_note_id <> NEW.official_note_id THEN
      RAISE EXCEPTION 'Inconsistência Relacional: A versão de origem indicada não pertence ao apontamento oficial referenciado.';
    END IF;

    -- Validar que a disciplina da nota corresponde à disciplina do exercício
    SELECT subject_id INTO v_note_subject
    FROM public.official_notes
    WHERE id = NEW.official_note_id;

    SELECT subject_id INTO v_exercise_subject
    FROM public.exercises
    WHERE id = NEW.exercise_id;

    IF v_note_subject IS DISTINCT FROM v_exercise_subject THEN
      RAISE EXCEPTION 'Inconsistência Curricular: A disciplina do apontamento oficial (%) difere da disciplina do exercício (%).', v_note_subject, v_exercise_subject;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_exercise_source_provenance ON public.exercise_source_references;
CREATE TRIGGER trg_validate_exercise_source_provenance
BEFORE INSERT OR UPDATE ON public.exercise_source_references
FOR EACH ROW EXECUTE FUNCTION public.validate_exercise_source_provenance();

-- 8. DEFESA EM PROFUNDIDADE: VALIDAÇÃO DE SANITIZAÇÃO NO POSTGRESQL
CREATE OR REPLACE FUNCTION public.validate_sanitized_html_security_patterns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.sanitized_html ~* '(<script|javascript:|on\w+\s*=|data:text/html|<iframe|<object|<embed)' THEN
    RAISE EXCEPTION 'Violação de Sanitização: O HTML sanitizado contém padrões executáveis ou proibidos pelo motor de segurança.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_sanitized_html_patterns ON public.official_note_versions;
CREATE TRIGGER trg_validate_sanitized_html_patterns
BEFORE INSERT OR UPDATE ON public.official_note_versions
FOR EACH ROW EXECUTE FUNCTION public.validate_sanitized_html_security_patterns();


-- ===== 20261024050000_turma_c_phase_b2_integrity_fixes.sql =====
-- ==============================================================================
-- STUDENTS HUB — FASE B.2: VERIFICAÇÃO FINAL DE INTEGRIDADE ANTES DA FASE C
-- Slogan: "Apontamentos que ajudam, exercícios que resultam. Rumo ao 20."
-- Princípio Sagrado: «SEMPRE COM BASE NOS APONTAMENTOS OFICIAIS!!!»
-- Migração Incremental, Não-Destrutiva e Reversível
-- ==============================================================================

-- 1. HARDENING DO RATE LIMITING: ATOMICIDADE NA 1.ª REQUISIÇÃO E SERIALIZAÇÃO
CREATE OR REPLACE FUNCTION public.check_and_consume_admin_rate_limit(
  p_max_requests integer DEFAULT 40,
  p_window_seconds integer DEFAULT 60
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin_id uuid;
  v_now timestamptz := now();
  v_window_start timestamptz;
  v_count integer;
  v_allowed boolean;
  v_remaining integer;
  v_retry_after integer := 0;
BEGIN
  -- 1. Obter identidade do utilizador a partir da sessão segura (nunca confiado no cliente)
  v_admin_id := auth.uid();
  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'Não autenticado: Sessão inválida ou ausente.';
  END IF;

  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso Negado: Apenas administradores podem aceder a este recurso.';
  END IF;

  -- 2. Transação atómica com bloqueio de linha (FOR UPDATE)
  -- Inserir bucket inicial se não existir de forma estritamente concorrente
  INSERT INTO public.admin_rate_limit_buckets (admin_id, window_start, request_count, last_request_at)
  VALUES (v_admin_id, v_now, 0, v_now)
  ON CONFLICT (admin_id) DO NOTHING;

  -- Bloquear linha explicitamente para serializar pedidos concorrentes
  SELECT window_start, request_count
  INTO v_window_start, v_count
  FROM public.admin_rate_limit_buckets
  WHERE admin_id = v_admin_id
  FOR UPDATE;

  -- 3. Verificar expiração da janela temporal
  IF (v_now - v_window_start) >= (p_window_seconds || ' seconds')::interval THEN
    -- Reiniciar nova janela
    v_window_start := v_now;
    v_count := 1;
    v_allowed := true;
    v_remaining := p_max_requests - 1;

    UPDATE public.admin_rate_limit_buckets
    SET window_start = v_window_start,
        request_count = v_count,
        last_request_at = v_now
    WHERE admin_id = v_admin_id;
  ELSE
    -- Dentro da janela atual
    IF v_count >= p_max_requests THEN
      v_allowed := false;
      v_remaining := 0;
      v_retry_after := CEIL(EXTRACT(EPOCH FROM (v_window_start + (p_window_seconds || ' seconds')::interval - v_now)))::integer;
      IF v_retry_after < 1 THEN
        v_retry_after := 1;
      END IF;
    ELSE
      v_count := v_count + 1;
      v_allowed := true;
      v_remaining := p_max_requests - v_count;

      UPDATE public.admin_rate_limit_buckets
      SET request_count = v_count,
          last_request_at = v_now
      WHERE admin_id = v_admin_id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'allowed', v_allowed,
    'remaining', v_remaining,
    'retry_after', v_retry_after,
    'current_count', v_count,
    'limit', p_max_requests
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.check_and_consume_admin_rate_limit(integer, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.check_and_consume_admin_rate_limit(integer, integer) TO authenticated;

-- 2. SERIALIZAÇÃO DE OPERAÇÕES SIMULTÂNEAS DE REATIVAÇÃO, PUBLICAÇÃO E DESPUBLICAÇÃO
-- Bloqueio FOR UPDATE em official_notes para evitar race conditions em current_version_id
CREATE OR REPLACE FUNCTION public.reactivate_historical_official_note_version_atomic(
  p_note_id uuid,
  p_version_id uuid,
  p_reason text DEFAULT 'Reativação formal de versão histórica homologada.'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid;
  v_version_number integer;
  v_prev_version_id uuid;
  v_now timestamptz := now();
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso Negado: Apenas administradores da Turma C podem reativar versões de apontamentos.';
  END IF;

  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Autenticação Inválida: Identidade de utilizador ausente na sessão.';
  END IF;

  -- 1. Obter versão atual com bloqueio pessimista FOR UPDATE na nota pai
  SELECT current_version_id
  INTO v_prev_version_id
  FROM public.official_notes
  WHERE id = p_note_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Apontamento oficial não encontrado: %', p_note_id;
  END IF;

  -- 2. Validar que a versão de destino existe e pertence estritamente a este apontamento
  SELECT version_number
  INTO v_version_number
  FROM public.official_note_versions
  WHERE id = p_version_id AND note_id = p_note_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'A versão especificada não pertence a este apontamento oficial ou não existe.';
  END IF;

  -- 3. Marcar a versão alvo como publicada (se já não estiver)
  UPDATE public.official_note_versions
  SET is_published = true,
      published_at = COALESCE(published_at, v_now)
  WHERE id = p_version_id;

  -- 4. Comutar a versão ativa no apontamento oficial
  UPDATE public.official_notes
  SET current_version_id = p_version_id,
      is_published = true,
      published_at = COALESCE(published_at, v_now),
      updated_at = v_now
  WHERE id = p_note_id;

  -- 5. Registar a ação na tabela de auditoria
  INSERT INTO public.official_note_audit_logs (
    note_id, version_id, action, performed_by, details
  ) VALUES (
    p_note_id, p_version_id, 'reactivate_historical_version', v_user_id,
    jsonb_build_object(
      'previous_version_id', v_prev_version_id,
      'reactivated_version_number', v_version_number,
      'reason', trim(COALESCE(p_reason, 'Reativação de versão histórica'))
    )
  );

  RETURN jsonb_build_object(
    'note_id', p_note_id,
    'version_id', p_version_id,
    'version_number', v_version_number,
    'is_published', true,
    'message', 'Versão histórica reativada com sucesso como versão oficial ativa.'
  );
END;
$$;

-- Reforçar publicação com bloqueio de linha FOR UPDATE
CREATE OR REPLACE FUNCTION public.publish_official_note_version_atomic(
  p_version_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid;
  v_note_id uuid;
  v_version_number integer;
  v_now timestamptz := now();
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso Negado: Apenas administradores da Turma C podem publicar versões de apontamentos.';
  END IF;

  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Autenticação Inválida: Identidade de utilizador ausente na sessão.';
  END IF;

  -- Bloquear a versão alvo
  SELECT note_id, version_number
  INTO v_note_id, v_version_number
  FROM public.official_note_versions
  WHERE id = p_version_id
  FOR UPDATE;

  IF v_note_id IS NULL THEN
    RAISE EXCEPTION 'Versão de apontamento não encontrada: %', p_version_id;
  END IF;

  -- Bloquear o apontamento pai
  PERFORM 1 FROM public.official_notes WHERE id = v_note_id FOR UPDATE;

  -- 1. Marcar esta versão como publicada
  UPDATE public.official_note_versions
  SET is_published = true,
      published_at = COALESCE(published_at, v_now)
  WHERE id = p_version_id;

  -- 2. Atualizar a nota pai: torna-se publicada e current_version_id aponta para esta versão
  UPDATE public.official_notes
  SET is_published = true,
      current_version_id = p_version_id,
      published_at = COALESCE(published_at, v_now),
      updated_at = v_now
  WHERE id = v_note_id;

  -- 3. Registar na auditoria
  INSERT INTO public.official_note_audit_logs (
    note_id, version_id, action, performed_by, details
  ) VALUES (
    v_note_id, p_version_id, 'publish_version', v_user_id,
    jsonb_build_object(
      'version_number', v_version_number,
      'published_at', v_now
    )
  );

  RETURN jsonb_build_object(
    'note_id', v_note_id,
    'version_id', p_version_id,
    'version_number', v_version_number,
    'is_published', true,
    'published_at', v_now
  );
END;
$$;

-- Reforçar despublicação com bloqueio de linha FOR UPDATE
CREATE OR REPLACE FUNCTION public.unpublish_official_note_atomic(
  p_note_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid;
  v_now timestamptz := now();
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso Negado: Apenas administradores da Turma C podem despublicar apontamentos.';
  END IF;

  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Autenticação Inválida: Identidade de utilizador ausente na sessão.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.official_notes
    WHERE id = p_note_id
    FOR UPDATE
  ) THEN
    RAISE EXCEPTION 'Apontamento oficial não encontrado: %', p_note_id;
  END IF;

  -- Despublicar cabeçalho do apontamento (versões permanecem no histórico)
  UPDATE public.official_notes
  SET is_published = false,
      updated_at = v_now
  WHERE id = p_note_id;

  -- Registar na auditoria
  INSERT INTO public.official_note_audit_logs (
    note_id, action, performed_by, details
  ) VALUES (
    p_note_id, 'unpublish_note', v_user_id,
    jsonb_build_object('unpublished_at', v_now)
  );

  RETURN jsonb_build_object(
    'note_id', p_note_id,
    'is_published', false,
    'unpublished_at', v_now
  );
END;
$$;

-- 3. CONFIDENCIALIDADE DE RAW_HTML: REVOGAÇÃO DE ACESSO DIRETO POR ALUNOS
-- Garante ao nível de permissões de coluna que 'raw_html' NUNCA é legível por 'authenticated' não-admin
DO $$
BEGIN
  -- Revogar SELECT amplo a nível de tabela em official_note_versions
  REVOKE SELECT ON public.official_note_versions FROM authenticated, anon;
  -- Conceder apenas as colunas seguras a authenticated (raw_html estritamente excluído)
  GRANT SELECT (
    id, note_id, version_number, sanitized_html, plain_text_content,
    change_summary, is_published, published_at, created_by, created_at
  ) ON public.official_note_versions TO authenticated;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- 4. PROVENIÊNCIA E HISTÓRICO DE EXERCÍCIOS: PROTEÇÃO CONTRA DELEÇÃO DE EVIDÊNCIAS
-- Trigger que impede DELETE físico de official_notes se referenciado em exercise_source_references
CREATE OR REPLACE FUNCTION public.protect_official_note_deletion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.exercise_source_references
    WHERE official_note_id = OLD.id
  ) THEN
    RAISE EXCEPTION 'Violação de Rastreabilidade Documental: Não é permitido eliminar um apontamento oficial referenciado por exercícios oficiais ativos ou históricos. Utilize despublicação (is_published = false).';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_official_note_deletion ON public.official_notes;
CREATE TRIGGER trg_protect_official_note_deletion
BEFORE DELETE ON public.official_notes
FOR EACH ROW EXECUTE FUNCTION public.protect_official_note_deletion();

-- Trigger que impede DELETE físico de exercícios oficiais publicados ou com tentativas
CREATE OR REPLACE FUNCTION public.protect_official_exercise_deletion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.is_official = true THEN
    -- Impedir eliminação se o exercício possui referências de fonte oficial
    IF EXISTS (
      SELECT 1 FROM public.exercise_source_references
      WHERE exercise_id = OLD.id
    ) THEN
      RAISE EXCEPTION 'Violação de Integridade Académica: Não é permitido eliminar fisicamente um exercício oficial referenciado por apontamentos. Utilize arquivamento (status = ''archived'').';
    END IF;

    -- Impedir eliminação se o exercício está associado a conjuntos ou exames oficiais
    IF EXISTS (
      SELECT 1 FROM public.official_set_exercises WHERE exercise_id = OLD.id
    ) OR EXISTS (
      SELECT 1 FROM public.official_exam_exercises WHERE exercise_id = OLD.id
    ) THEN
      RAISE EXCEPTION 'Violação de Integridade Académica: Não é permitido eliminar fisicamente um exercício oficial integrado em conjuntos ou exames homologados. Utilize arquivamento (status = ''archived'').';
    END IF;
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_official_exercise_deletion ON public.exercises;
CREATE TRIGGER trg_protect_official_exercise_deletion
BEFORE DELETE ON public.exercises
FOR EACH ROW EXECUTE FUNCTION public.protect_official_exercise_deletion();


-- ===== 20261024060000_turma_c_phase_b3_cleanup_personal_notes.sql =====
-- ==============================================================================
-- STUDENTS HUB — FASE B.3: LIMPEZA DO ANTIGO CADERNO PESSOAL E CONSOLIDAÇÃO DO CADERNO OFICIAL
-- Slogan: "Apontamentos que ajudam, exercícios que resultam. Rumo ao 20."
-- Princípio Sagrado: «SEMPRE COM BASE NOS APONTAMENTOS OFICIAIS!!!»
-- Migração Incremental, Não-Destrutiva e Reversível para a Infraestrutura Oficial
-- ==============================================================================

-- 1. REMOVER CONSTRAINTS DE DEPENDÊNCIA EM EXERCISE_SOURCE_REFERENCES
-- Desvincular as chaves estrangeiras legadas que apontavam para o antigo caderno pessoal
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_exercise_sources_note_user'
      AND table_name = 'exercise_source_references'
  ) THEN
    ALTER TABLE public.exercise_source_references
      DROP CONSTRAINT fk_exercise_sources_note_user;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_exercise_sources_page_user'
      AND table_name = 'exercise_source_references'
  ) THEN
    ALTER TABLE public.exercise_source_references
      DROP CONSTRAINT fk_exercise_sources_page_user;
  END IF;
END $$;

-- 2. REMOVER POLÍTICAS RLS, TRIGGERS E FUNÇÕES EXCLUSIVAS DO CADERNO PESSOAL
DROP TRIGGER IF EXISTS trg_prevent_note_chunk_modification ON public.note_chunks;
DROP FUNCTION IF EXISTS public.prevent_note_chunk_modification();

-- Políticas em note_chunks
DROP POLICY IF EXISTS "note_chunks_select_own" ON public.note_chunks;
DROP POLICY IF EXISTS "note_chunks_insert_own" ON public.note_chunks;
DROP POLICY IF EXISTS "note_chunks_update_admin" ON public.note_chunks;
DROP POLICY IF EXISTS "note_chunks_delete_own" ON public.note_chunks;

-- Políticas em note_pages
DROP POLICY IF EXISTS "note_pages_select_own" ON public.note_pages;
DROP POLICY IF EXISTS "note_pages_insert_own" ON public.note_pages;
DROP POLICY IF EXISTS "note_pages_update_own" ON public.note_pages;
DROP POLICY IF EXISTS "note_pages_delete_own" ON public.note_pages;

-- Políticas em personal_notes
DROP POLICY IF EXISTS "personal_notes_select_own" ON public.personal_notes;
DROP POLICY IF EXISTS "personal_notes_insert_own" ON public.personal_notes;
DROP POLICY IF EXISTS "personal_notes_update_own" ON public.personal_notes;
DROP POLICY IF EXISTS "personal_notes_delete_own" ON public.personal_notes;

-- 3. ELIMINAÇÃO CONTROLADA E ORDENADA DAS TABELAS LEGADAS (SEM DROP CASCADE INDISCRIMINADO)
-- Ordem estrita de dependência: chunks -> páginas -> apontamentos pessoais
DROP TABLE IF EXISTS public.note_chunks;
DROP TABLE IF EXISTS public.note_pages;
DROP TABLE IF EXISTS public.personal_notes;

-- 4. REMOÇÃO DE POLÍTICAS DE STORAGE DO ANTIGO PERSONAL-VAULT
-- Elimina políticas de acesso direto de alunos para upload de fotos de caderno
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'storage' AND tablename = 'objects') THEN
    DROP POLICY IF EXISTS "personal_vault_select_own" ON storage.objects;
    DROP POLICY IF EXISTS "personal_vault_insert_own" ON storage.objects;
    DROP POLICY IF EXISTS "personal_vault_delete_own" ON storage.objects;
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- 5. CONSOLIDAÇÃO DEFINITIVA DE EXERCISE_SOURCE_REFERENCES PARA O CADERNO OFICIAL
-- Garante que source_type tem como padrão 'official' e que as colunas oficiais estão indexadas
ALTER TABLE public.exercise_source_references
  ALTER COLUMN source_type SET DEFAULT 'official';

CREATE INDEX IF NOT EXISTS idx_exercise_sources_official_note_version
  ON public.exercise_source_references (official_note_id, official_version_id);

-- 6. GARANTIA DE PRESERVAÇÃO INTEGRAL DA INFRAESTRUTURA OFICIAL DA TURMA C
-- Validar que as tabelas nucleares oficiais existem e estão intactas
DO $$
DECLARE
  v_missing_tables text := '';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'official_notes') THEN
    v_missing_tables := v_missing_tables || ' official_notes';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'official_note_versions') THEN
    v_missing_tables := v_missing_tables || ' official_note_versions';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'official_note_audit_logs') THEN
    v_missing_tables := v_missing_tables || ' official_note_audit_logs';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'official_first_attempts') THEN
    v_missing_tables := v_missing_tables || ' official_first_attempts';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'study_stats') THEN
    v_missing_tables := v_missing_tables || ' study_stats';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'official_assessments') THEN
    v_missing_tables := v_missing_tables || ' official_assessments';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'official_exams') THEN
    v_missing_tables := v_missing_tables || ' official_exams';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'admin_rate_limit_buckets') THEN
    v_missing_tables := v_missing_tables || ' admin_rate_limit_buckets';
  END IF;

  IF char_length(v_missing_tables) > 0 THEN
    RAISE EXCEPTION 'Erro de Integridade Crítica: As seguintes tabelas oficiais foram indevidamente afetadas: %', v_missing_tables;
  END IF;
END $$;


-- ===== 20261024070000_turma_c_phase_c_official_exercises.sql =====
-- ==============================================================================
-- STUDENTS HUB — FASE C: GERAÇÃO INTELIGENTE DE EXERCÍCIOS OFICIAIS (TURMA C)
-- Slogan: "Apontamentos que ajudam, exercícios que resultam. Rumo ao 20."
-- Princípio Sagrado: «SEMPRE COM BASE NOS APONTAMENTOS OFICIAIS!!!»
-- Migração Incremental para a Infraestrutura de Exercícios Grounded no Caderno Oficial
-- ==============================================================================

-- 1. ATUALIZAÇÃO DA FUNÇÃO RPC GET_SESSION_QUESTIONS_FOR_STUDENT
-- Adaptada para o Caderno Oficial da Turma C após a remoção de personal_notes
-- Mantém 100% de confidencialidade de gabarito e rubricas de correção
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
        SELECT COALESCE(onotes.title, 'Caderno Oficial') || ' · v' || COALESCE(onv.version_number::text, '1')
        FROM public.exercise_source_references r
        LEFT JOIN public.official_notes onotes ON r.official_note_id = onotes.id
        LEFT JOIN public.official_note_versions onv ON r.official_version_id = onv.id
        WHERE r.exercise_id = e.id
        LIMIT 1
      ),
      'Caderno Oficial da Turma C'
    ) AS source_note_ref
  FROM public.exercises e
  WHERE e.session_id = p_session_id
    AND (
      e.user_id = auth.uid()
      OR (e.is_official = true AND e.status = 'published')
      OR public.is_admin()
    )
  ORDER BY e.created_at ASC;
END;
$$;

-- 2. BLINDAGEM DA TRIGGER TRG_PROTECT_OFFICIAL_EXERCISE_INTEGRITY
-- Impede forjamento de exercícios oficiais por utilizadores sem a role admin
CREATE OR REPLACE FUNCTION public.protect_official_exercise_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT public.is_admin() AND (current_user = 'authenticated' OR auth.uid() IS NOT NULL) THEN
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


-- ===== 20261024080000_turma_c_phase_c_integrity_closure.sql =====
-- ==============================================================================
-- STUDENTS HUB — FASE C: FECHO DE INTEGRIDADE E ATOMICIDADE DE PROVENIÊNCIA (TURMA C)
-- Slogan: "Apontamentos que ajudam, exercícios que resultam. Rumo ao 20."
-- Princípio Sagrado: «SEMPRE COM BASE NOS APONTAMENTOS OFICIAIS!!!»
-- Migração Incremental para Atomicidade Transacional e Endurecimento de Proveniência
-- ==============================================================================

-- 1. ENDURECIMENTO DE SOURCE_TYPE EM EXERCISE_SOURCE_REFERENCES
-- Garante que apenas registos oficiais com rastreabilidade completa são aceites
DO $$
DECLARE
  v_personal_count integer;
  r RECORD;
BEGIN
  -- Inspecionar se existem registos com source_type = 'personal'
  SELECT COUNT(*) INTO v_personal_count
  FROM public.exercise_source_references
  WHERE source_type = 'personal';

  IF v_personal_count > 0 THEN
    RAISE NOTICE 'Aviso de Migração: Existem % registo(s) com source_type = personal. Não serão apagados nem transformados automaticamente.', v_personal_count;
  ELSE
    -- Remover quaisquer check constraints existentes na coluna source_type de exercise_source_references
    FOR r IN (
      SELECT c.conname
      FROM pg_constraint c
      JOIN pg_class t ON c.conrelid = t.oid
      JOIN pg_namespace n ON t.relnamespace = n.oid
      WHERE n.nspname = 'public'
        AND t.relname = 'exercise_source_references'
        AND c.contype = 'c'
        AND pg_get_constraintdef(c.oid) ILIKE '%source_type%'
    ) LOOP
      EXECUTE 'ALTER TABLE public.exercise_source_references DROP CONSTRAINT IF EXISTS ' || quote_ident(r.conname);
    END LOOP;

    -- Aplicar restrição estrita: apenas 'official' é permitido
    ALTER TABLE public.exercise_source_references
      ADD CONSTRAINT exercise_source_references_source_type_check
      CHECK (source_type = 'official');

    -- Fixar o default como 'official'
    ALTER TABLE public.exercise_source_references
      ALTER COLUMN source_type SET DEFAULT 'official';
  END IF;
END $$;

-- 2. BLINDAGEM DA TRIGGER TRG_VALIDATE_EXERCISE_SOURCE_PROVENANCE
-- Valida no PostgreSQL: nota publicada, versão publicada pertencente à nota, correspondência curricular,
-- hash SHA-256 de 64 caracteres e presença literal da citação no texto da versão oficial.
CREATE OR REPLACE FUNCTION public.validate_exercise_source_provenance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_version RECORD;
  v_note RECORD;
  v_exercise RECORD;
BEGIN
  IF NEW.source_type = 'official' THEN
    -- Validação de campos obrigatórios
    IF NEW.official_note_id IS NULL OR NEW.official_version_id IS NULL THEN
      RAISE EXCEPTION 'Inconsistência de Proveniência: Exercícios oficiais têm obrigatoriamente de referenciar official_note_id e official_version_id.';
    END IF;

    -- Validar hash SHA-256 (64 caracteres hexadecimais)
    IF NEW.content_hash IS NULL OR length(trim(NEW.content_hash)) <> 64 THEN
      RAISE EXCEPTION 'Inconsistência de Hash: O content_hash deve ser um hash SHA-256 válido com exatamente 64 caracteres.';
    END IF;

    -- Validar citação literal
    IF NEW.quote_excerpt IS NULL OR length(trim(NEW.quote_excerpt)) < 4 THEN
      RAISE EXCEPTION 'Inconsistência de Citação: A citação (quote_excerpt) é obrigatória e deve conter pelo menos 4 caracteres.';
    END IF;

    -- Validar existência e estado do apontamento oficial
    SELECT id, subject_id, is_published INTO v_note
    FROM public.official_notes
    WHERE id = NEW.official_note_id;

    IF v_note.id IS NULL THEN
      RAISE EXCEPTION 'Inconsistência Relacional: O apontamento oficial referenciado não existe.';
    END IF;

    IF v_note.is_published IS NOT TRUE THEN
      RAISE EXCEPTION 'Inconsistência de Estado: O apontamento oficial referenciado não está publicado.';
    END IF;

    -- Validar existência, pertença e publicação da versão oficial
    SELECT id, note_id, is_published, plain_text_content, sanitized_html INTO v_version
    FROM public.official_note_versions
    WHERE id = NEW.official_version_id;

    IF v_version.id IS NULL OR v_version.note_id <> NEW.official_note_id THEN
      RAISE EXCEPTION 'Inconsistência Relacional: A versão de origem indicada não pertence ao apontamento oficial referenciado.';
    END IF;

    IF v_version.is_published IS NOT TRUE THEN
      RAISE EXCEPTION 'Inconsistência de Versão: A versão de origem indicada não está publicada/homologada.';
    END IF;

    -- Validar correspondência curricular entre o apontamento e o exercício
    SELECT id, subject_id INTO v_exercise
    FROM public.exercises
    WHERE id = NEW.exercise_id;

    IF v_exercise.id IS NOT NULL AND v_note.subject_id IS DISTINCT FROM v_exercise.subject_id THEN
      RAISE EXCEPTION 'Inconsistência Curricular: A disciplina do apontamento oficial (%) difere da disciplina do exercício (%).', v_note.subject_id, v_exercise.subject_id;
    END IF;

    -- Validar que a citação é substring literal do conteúdo da versão homologada
    IF position(trim(NEW.quote_excerpt) in v_version.plain_text_content) = 0
       AND position(trim(NEW.quote_excerpt) in v_version.sanitized_html) = 0 THEN
      RAISE EXCEPTION 'Inconsistência de Grounding: A citação indicada não é uma substring exata do conteúdo oficial homologado.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_exercise_source_provenance ON public.exercise_source_references;
CREATE TRIGGER trg_validate_exercise_source_provenance
BEFORE INSERT OR UPDATE ON public.exercise_source_references
FOR EACH ROW EXECUTE FUNCTION public.validate_exercise_source_provenance();

-- 3. OPERAÇÃO TRANSACIONAL ATÓMICA DE CRIAÇÃO DE EXERCÍCIO OFICIAL COM PROVENIÊNCIA
-- Insere o exercício em rascunho e a sua proveniência numa única transação atómica indivisível.
CREATE OR REPLACE FUNCTION public.create_official_exercise_with_provenance(
  p_user_id uuid,
  p_subject_id text,
  p_academic_period text,
  p_prompt text,
  p_question_type text,
  p_options jsonb,
  p_correct_answer text,
  p_scoring_rubric jsonb,
  p_max_points numeric,
  p_difficulty text,
  p_official_note_id uuid,
  p_official_version_id uuid,
  p_content_hash text,
  p_quote_excerpt text,
  p_official_section text,
  p_exercise_id uuid DEFAULT gen_random_uuid()
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_new_id uuid := COALESCE(p_exercise_id, gen_random_uuid());
BEGIN
  -- Validar que o utilizador é administrador
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso Reservado: Apenas administradores podem criar exercícios oficiais.';
  END IF;

  -- 1. Inserir exercício oficial em estado de rascunho (draft)
  INSERT INTO public.exercises (
    id, user_id, subject_id, academic_period, prompt, question_type,
    options, correct_answer, scoring_rubric, max_points, difficulty,
    is_official, status, created_by_role
  ) VALUES (
    v_new_id, p_user_id, p_subject_id, p_academic_period, p_prompt, p_question_type,
    p_options, p_correct_answer, p_scoring_rubric, p_max_points, p_difficulty,
    true, 'draft', 'admin'
  );

  -- 2. Inserir proveniência oficial com validações da trigger
  INSERT INTO public.exercise_source_references (
    exercise_id, user_id, source_type, official_note_id, official_version_id,
    content_hash, quote_excerpt, official_section
  ) VALUES (
    v_new_id, p_user_id, 'official', p_official_note_id, p_official_version_id,
    p_content_hash, p_quote_excerpt, p_official_section
  );

  RETURN v_new_id;
END;
$$;

-- 4. OPERAÇÃO TRANSACIONAL EM LOTE DE EXERCÍCIOS OFICIAIS COM PROVENIÊNCIA
-- Suporta modo atómico (all-or-nothing por defeito) ou com indicação explícita de itens bem/mal sucedidos.
CREATE OR REPLACE FUNCTION public.create_official_exercise_batch_with_provenance(
  p_user_id uuid,
  p_official_note_id uuid,
  p_official_version_id uuid,
  p_content_hash text,
  p_exercises jsonb,
  p_atomic boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_item jsonb;
  v_inserted_ids uuid[] := '{}';
  v_exercise_id uuid;
  v_failed_items jsonb := '[]'::jsonb;
  v_subject_id text;
  v_academic_period text;
  v_theme text;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso Reservado: Apenas administradores podem gerar lotes de exercícios oficiais.';
  END IF;

  -- Obter e validar dados do apontamento oficial publicado
  SELECT subject_id, academic_period, theme
  INTO v_subject_id, v_academic_period, v_theme
  FROM public.official_notes
  WHERE id = p_official_note_id AND is_published = true;

  IF v_subject_id IS NULL THEN
    RAISE EXCEPTION 'Inconsistência de Estado: Apontamento oficial inexistente ou não publicado.';
  END IF;

  -- Iterar pelo array de exercícios
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_exercises)
  LOOP
    BEGIN
      v_exercise_id := COALESCE((v_item->>'id')::uuid, gen_random_uuid());

      PERFORM public.create_official_exercise_with_provenance(
        p_user_id => p_user_id,
        p_subject_id => v_subject_id,
        p_academic_period => v_academic_period,
        p_prompt => v_item->>'prompt',
        p_question_type => v_item->>'question_type',
        p_options => v_item->'options',
        p_correct_answer => v_item->>'correct_answer',
        p_scoring_rubric => v_item->'scoring_rubric',
        p_max_points => COALESCE((v_item->>'max_points')::numeric, 20.0),
        p_difficulty => COALESCE(v_item->>'difficulty', 'medio'),
        p_official_note_id => p_official_note_id,
        p_official_version_id => p_official_version_id,
        p_content_hash => p_content_hash,
        p_quote_excerpt => v_item->>'quote_excerpt',
        p_official_section => COALESCE(v_item->>'official_section', v_theme),
        p_exercise_id => v_exercise_id
      );

      v_inserted_ids := array_append(v_inserted_ids, v_exercise_id);
    EXCEPTION WHEN OTHERS THEN
      IF p_atomic THEN
        -- No modo atómico (all-or-nothing), qualquer erro aborta a transação e faz ROLLBACK total
        RAISE EXCEPTION 'Falha Atómica no Lote de Exercícios: % (exercício descartado, lote revertido)', SQLERRM;
      ELSE
        -- No modo parcial explícito, regista a falha e prossegue
        v_failed_items := v_failed_items || jsonb_build_object(
          'prompt', v_item->>'prompt',
          'error', SQLERRM
        );
      END IF;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'atomic', p_atomic,
    'inserted_count', cardinality(v_inserted_ids),
    'inserted_ids', to_jsonb(v_inserted_ids),
    'failed_count', jsonb_array_length(v_failed_items),
    'failed_items', v_failed_items
  );
END;
$$;

-- Permissões explícitas para as novas funções
REVOKE ALL ON FUNCTION public.create_official_exercise_with_provenance FROM public, anon;
GRANT EXECUTE ON FUNCTION public.create_official_exercise_with_provenance TO authenticated;

REVOKE ALL ON FUNCTION public.create_official_exercise_batch_with_provenance FROM public, anon;
GRANT EXECUTE ON FUNCTION public.create_official_exercise_batch_with_provenance TO authenticated;


-- ===== 20261025000000_turma_c_phase_c_closure_fixes.sql =====
-- ==============================================================================
-- STUDENTS HUB — FASE C: FECHO FINAL (ATOMICIDADE, PROVENIÊNCIA E PUBLICAÇÃO)
-- Princípio Sagrado: «SEMPRE COM BASE NOS APONTAMENTOS OFICIAIS!!!»
-- Migração INCREMENTAL: não altera migrações já escritas, nem apaga dados.
--
-- Corrige:
--  1. source_type exclusivamente 'official' MESMO quando existem registos legados
--     (restrição NOT VALID: bloqueia novos 'personal' sem apagar nem transformar os antigos).
--  2. Citação literal validada apenas contra o TEXTO simples da versão publicada
--     (nunca contra HTML, onde tags/atributos poderiam "fabricar" citações) + tamanho mínimo.
--  3. RPCs atómicas deixam de confiar em p_user_id do cliente (identidade = auth.uid()),
--     derivam disciplina/período da nota oficial e verificam o hash SHA-256 da versão.
--  4. Rollback total de lotes incompletos (modo atómico) e proteção do modo parcial.
--  5. Publicação só com proveniência oficial; conteúdo congelado após sair de rascunho.
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. SOURCE_TYPE EXCLUSIVAMENTE 'official' (VERIFICANDO DADOS EXISTENTES)
-- ------------------------------------------------------------------------------
DO $$
DECLARE
  v_legacy_count integer;
  r RECORD;
BEGIN
  SELECT COUNT(*) INTO v_legacy_count
  FROM public.exercise_source_references
  WHERE source_type IS DISTINCT FROM 'official';

  -- Remove checks antigos sobre source_type (incluindo o do fecho anterior, para ser idempotente)
  FOR r IN (
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON t.relnamespace = n.oid
    WHERE n.nspname = 'public'
      AND t.relname = 'exercise_source_references'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%source_type%'
  ) LOOP
    EXECUTE 'ALTER TABLE public.exercise_source_references DROP CONSTRAINT IF EXISTS ' || quote_ident(r.conname);
  END LOOP;

  IF v_legacy_count = 0 THEN
    ALTER TABLE public.exercise_source_references
      ADD CONSTRAINT exercise_source_references_source_type_check
      CHECK (source_type = 'official');
  ELSE
    -- Existem registos legados: NÃO se apagam nem se convertem.
    -- NOT VALID impede qualquer novo INSERT/UPDATE que não seja 'official',
    -- preservando o histórico existente intacto para auditoria.
    RAISE NOTICE 'Migração: % registo(s) legado(s) com source_type <> official preservados; restrição aplicada como NOT VALID.', v_legacy_count;
    ALTER TABLE public.exercise_source_references
      ADD CONSTRAINT exercise_source_references_source_type_check
      CHECK (source_type = 'official') NOT VALID;
  END IF;

  ALTER TABLE public.exercise_source_references
    ALTER COLUMN source_type SET DEFAULT 'official';
END $$;

-- ------------------------------------------------------------------------------
-- 2. TRIGGER DE PROVENIÊNCIA: CITAÇÃO LITERAL APENAS NO TEXTO SIMPLES OFICIAL
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_exercise_source_provenance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_version RECORD;
  v_note RECORD;
  v_exercise RECORD;
  v_quote text;
BEGIN
  IF NEW.source_type IS DISTINCT FROM 'official' THEN
    RAISE EXCEPTION 'Inconsistência de Proveniência: apenas source_type = official é aceite (SEMPRE COM BASE NOS APONTAMENTOS OFICIAIS).';
  END IF;

  IF NEW.official_note_id IS NULL OR NEW.official_version_id IS NULL THEN
    RAISE EXCEPTION 'Inconsistência de Proveniência: Exercícios oficiais têm obrigatoriamente de referenciar official_note_id e official_version_id.';
  END IF;

  IF NEW.content_hash IS NULL OR NEW.content_hash !~ '^[0-9a-fA-F]{64}$' THEN
    RAISE EXCEPTION 'Inconsistência de Hash: O content_hash deve ser um hash SHA-256 válido (64 caracteres hexadecimais).';
  END IF;

  v_quote := btrim(COALESCE(NEW.quote_excerpt, ''), E' \t\r\n');
  IF char_length(v_quote) < 10 THEN
    RAISE EXCEPTION 'Inconsistência de Citação: A citação (quote_excerpt) é obrigatória e deve conter pelo menos 10 caracteres.';
  END IF;

  SELECT id, subject_id, is_published INTO v_note
  FROM public.official_notes
  WHERE id = NEW.official_note_id;

  IF v_note.id IS NULL THEN
    RAISE EXCEPTION 'Inconsistência Relacional: O apontamento oficial referenciado não existe.';
  END IF;

  IF v_note.is_published IS NOT TRUE THEN
    RAISE EXCEPTION 'Inconsistência de Estado: O apontamento oficial referenciado não está publicado.';
  END IF;

  SELECT id, note_id, is_published, plain_text_content INTO v_version
  FROM public.official_note_versions
  WHERE id = NEW.official_version_id;

  IF v_version.id IS NULL OR v_version.note_id <> NEW.official_note_id THEN
    RAISE EXCEPTION 'Inconsistência Relacional: A versão de origem indicada não pertence ao apontamento oficial referenciado.';
  END IF;

  IF v_version.is_published IS NOT TRUE THEN
    RAISE EXCEPTION 'Inconsistência de Versão: A versão de origem indicada não está publicada/homologada.';
  END IF;

  SELECT id, subject_id INTO v_exercise
  FROM public.exercises
  WHERE id = NEW.exercise_id;

  IF v_exercise.id IS NOT NULL AND v_note.subject_id IS DISTINCT FROM v_exercise.subject_id THEN
    RAISE EXCEPTION 'Inconsistência Curricular: A disciplina do apontamento oficial (%) difere da disciplina do exercício (%).', v_note.subject_id, v_exercise.subject_id;
  END IF;

  -- Citação literal: substring exata do TEXTO SIMPLES da versão homologada.
  -- (O HTML foi deliberadamente excluído: tags e atributos não são matéria oficial.)
  IF COALESCE(v_version.plain_text_content, '') = ''
     OR position(v_quote in v_version.plain_text_content) = 0 THEN
    RAISE EXCEPTION 'Inconsistência de Grounding: A citação indicada não é uma substring exata do texto oficial homologado.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_exercise_source_provenance ON public.exercise_source_references;
CREATE TRIGGER trg_validate_exercise_source_provenance
BEFORE INSERT OR UPDATE ON public.exercise_source_references
FOR EACH ROW EXECUTE FUNCTION public.validate_exercise_source_provenance();

-- ------------------------------------------------------------------------------
-- 3. CRIAÇÃO ATÓMICA DE EXERCÍCIO OFICIAL + PROVENIÊNCIA (IDENTIDADE = auth.uid())
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_official_exercise_with_provenance(
  p_user_id uuid,
  p_subject_id text,
  p_academic_period text,
  p_prompt text,
  p_question_type text,
  p_options jsonb,
  p_correct_answer text,
  p_scoring_rubric jsonb,
  p_max_points numeric,
  p_difficulty text,
  p_official_note_id uuid,
  p_official_version_id uuid,
  p_content_hash text,
  p_quote_excerpt text,
  p_official_section text,
  p_exercise_id uuid DEFAULT gen_random_uuid()
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_new_id uuid := COALESCE(p_exercise_id, gen_random_uuid());
  v_uid uuid := auth.uid();
  v_note RECORD;
  v_version RECORD;
  v_expected_hash text;
BEGIN
  IF v_uid IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso Reservado: Apenas administradores autenticados podem criar exercícios oficiais.';
  END IF;

  -- A identidade vem SEMPRE da sessão; o parâmetro do cliente só é aceite se coincidir.
  IF p_user_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'Violação de Identidade: p_user_id não corresponde ao administrador autenticado.';
  END IF;

  SELECT id, subject_id, academic_period, is_published INTO v_note
  FROM public.official_notes WHERE id = p_official_note_id;

  IF v_note.id IS NULL OR v_note.is_published IS NOT TRUE THEN
    RAISE EXCEPTION 'Inconsistência de Estado: Apontamento oficial inexistente ou não publicado.';
  END IF;

  -- Disciplina e período derivam SEMPRE do apontamento oficial (nunca do chamador)
  IF p_subject_id IS DISTINCT FROM v_note.subject_id
     OR p_academic_period IS DISTINCT FROM v_note.academic_period THEN
    RAISE EXCEPTION 'Inconsistência Curricular: disciplina/período do exercício não correspondem ao apontamento oficial.';
  END IF;

  SELECT id, note_id, is_published, plain_text_content INTO v_version
  FROM public.official_note_versions WHERE id = p_official_version_id;

  IF v_version.id IS NULL OR v_version.note_id <> p_official_note_id OR v_version.is_published IS NOT TRUE THEN
    RAISE EXCEPTION 'Inconsistência de Versão: versão inexistente, não publicada ou de outro apontamento.';
  END IF;

  -- O hash declarado tem de ser o SHA-256 do texto simples exato da versão homologada
  v_expected_hash := encode(sha256(convert_to(COALESCE(v_version.plain_text_content, ''), 'UTF8')), 'hex');
  IF lower(COALESCE(p_content_hash, '')) <> v_expected_hash THEN
    RAISE EXCEPTION 'Inconsistência de Hash: o content_hash não corresponde ao texto da versão oficial indicada.';
  END IF;

  INSERT INTO public.exercises (
    id, user_id, subject_id, academic_period, prompt, question_type,
    options, correct_answer, scoring_rubric, max_points, difficulty,
    is_official, status, created_by_role
  ) VALUES (
    v_new_id, v_uid, v_note.subject_id, v_note.academic_period, p_prompt, p_question_type,
    p_options, p_correct_answer, p_scoring_rubric, p_max_points, p_difficulty,
    true, 'draft', 'admin'
  );

  INSERT INTO public.exercise_source_references (
    exercise_id, user_id, source_type, official_note_id, official_version_id,
    content_hash, quote_excerpt, official_section
  ) VALUES (
    v_new_id, v_uid, 'official', p_official_note_id, p_official_version_id,
    v_expected_hash, p_quote_excerpt, p_official_section
  );

  RETURN v_new_id;
END;
$$;

-- ------------------------------------------------------------------------------
-- 4. LOTE ATÓMICO COM ROLLBACK TOTAL (e modo parcial explícito protegido)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_official_exercise_batch_with_provenance(
  p_user_id uuid,
  p_official_note_id uuid,
  p_official_version_id uuid,
  p_content_hash text,
  p_exercises jsonb,
  p_atomic boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_item jsonb;
  v_idx integer := 0;
  v_inserted_ids uuid[] := '{}';
  v_exercise_id uuid;
  v_failed_items jsonb := '[]'::jsonb;
  v_subject_id text;
  v_academic_period text;
  v_theme text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso Reservado: Apenas administradores autenticados podem gerar lotes de exercícios oficiais.';
  END IF;

  IF p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Violação de Identidade: p_user_id não corresponde ao administrador autenticado.';
  END IF;

  IF p_exercises IS NULL OR jsonb_typeof(p_exercises) <> 'array'
     OR jsonb_array_length(p_exercises) = 0 OR jsonb_array_length(p_exercises) > 15 THEN
    RAISE EXCEPTION 'Violação de Integridade: p_exercises deve ser um array com 1 a 15 exercícios.';
  END IF;

  SELECT subject_id, academic_period, theme
  INTO v_subject_id, v_academic_period, v_theme
  FROM public.official_notes
  WHERE id = p_official_note_id AND is_published = true;

  IF v_subject_id IS NULL THEN
    RAISE EXCEPTION 'Inconsistência de Estado: Apontamento oficial inexistente ou não publicado.';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_exercises)
  LOOP
    v_idx := v_idx + 1;
    v_exercise_id := gen_random_uuid();

    IF p_atomic THEN
      -- Sem sub-bloco de exceção: qualquer erro propaga-se e a transação inteira
      -- (todos os exercícios e proveniências já inseridos) é revertida pelo PostgreSQL.
      PERFORM public.create_official_exercise_with_provenance(
        p_user_id => p_user_id,
        p_subject_id => v_subject_id,
        p_academic_period => v_academic_period,
        p_prompt => v_item->>'prompt',
        p_question_type => v_item->>'question_type',
        p_options => CASE WHEN jsonb_typeof(v_item->'options') = 'array' THEN v_item->'options' ELSE NULL END,
        p_correct_answer => v_item->>'correct_answer',
        p_scoring_rubric => v_item->'scoring_rubric',
        p_max_points => COALESCE((v_item->>'max_points')::numeric, 20.0),
        p_difficulty => COALESCE(v_item->>'difficulty', 'medio'),
        p_official_note_id => p_official_note_id,
        p_official_version_id => p_official_version_id,
        p_content_hash => p_content_hash,
        p_quote_excerpt => v_item->>'quote_excerpt',
        p_official_section => COALESCE(v_item->>'official_section', v_theme),
        p_exercise_id => v_exercise_id
      );
      v_inserted_ids := array_append(v_inserted_ids, v_exercise_id);
    ELSE
      -- Modo parcial EXPLÍCITO: cada item corre num sub-bloco (savepoint) que reverte
      -- apenas esse item (exercício + proveniência) em caso de falha.
      BEGIN
        PERFORM public.create_official_exercise_with_provenance(
          p_user_id => p_user_id,
          p_subject_id => v_subject_id,
          p_academic_period => v_academic_period,
          p_prompt => v_item->>'prompt',
          p_question_type => v_item->>'question_type',
          p_options => CASE WHEN jsonb_typeof(v_item->'options') = 'array' THEN v_item->'options' ELSE NULL END,
          p_correct_answer => v_item->>'correct_answer',
          p_scoring_rubric => v_item->'scoring_rubric',
          p_max_points => COALESCE((v_item->>'max_points')::numeric, 20.0),
          p_difficulty => COALESCE(v_item->>'difficulty', 'medio'),
          p_official_note_id => p_official_note_id,
          p_official_version_id => p_official_version_id,
          p_content_hash => p_content_hash,
          p_quote_excerpt => v_item->>'quote_excerpt',
          p_official_section => COALESCE(v_item->>'official_section', v_theme),
          p_exercise_id => v_exercise_id
        );
        v_inserted_ids := array_append(v_inserted_ids, v_exercise_id);
      EXCEPTION WHEN OTHERS THEN
        v_failed_items := v_failed_items || jsonb_build_object(
          'index', v_idx - 1,
          'prompt', v_item->>'prompt',
          'error', SQLERRM
        );
      END;
    END IF;
  END LOOP;

  IF cardinality(v_inserted_ids) = 0 THEN
    RAISE EXCEPTION 'Falha no Lote de Exercícios: nenhum exercício foi aceite (%).', v_failed_items::text;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'atomic', p_atomic,
    'inserted_count', cardinality(v_inserted_ids),
    'inserted_ids', to_jsonb(v_inserted_ids),
    'failed_count', jsonb_array_length(v_failed_items),
    'failed_items', v_failed_items
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_official_exercise_with_provenance(uuid, text, text, text, text, jsonb, text, jsonb, numeric, text, uuid, uuid, text, text, text, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.create_official_exercise_with_provenance(uuid, text, text, text, text, jsonb, text, jsonb, numeric, text, uuid, uuid, text, text, text, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.create_official_exercise_batch_with_provenance(uuid, uuid, uuid, text, jsonb, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.create_official_exercise_batch_with_provenance(uuid, uuid, uuid, text, jsonb, boolean) TO authenticated;

-- ------------------------------------------------------------------------------
-- 5. PUBLICAÇÃO SÓ COM PROVENIÊNCIA OFICIAL + CONTEÚDO CONGELADO APÓS RASCUNHO
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.protect_official_exercise_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.is_official = true THEN
    -- A natureza oficial não pode ser retirada nem reatribuída
    IF NEW.is_official IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'Violação de Integridade Académica: um exercício oficial não pode deixar de ser oficial.';
    END IF;

    -- Máquina de estados: draft -> published | archived ; published -> archived ; archived é final
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      IF OLD.status = 'archived' THEN
        RAISE EXCEPTION 'Violação de Integridade Académica: um exercício arquivado não pode ser reativado.';
      END IF;
      IF OLD.status = 'published' AND NEW.status = 'draft' THEN
        RAISE EXCEPTION 'Violação de Integridade Académica: um exercício publicado não pode voltar a rascunho (arquive-o e gere outro).';
      END IF;
    END IF;

    -- Conteúdo avaliável congelado assim que sai de rascunho (resultados e exames dependem dele)
    IF OLD.status <> 'draft' AND (
         NEW.prompt IS DISTINCT FROM OLD.prompt
      OR NEW.question_type IS DISTINCT FROM OLD.question_type
      OR NEW.options IS DISTINCT FROM OLD.options
      OR NEW.correct_answer IS DISTINCT FROM OLD.correct_answer
      OR NEW.scoring_rubric IS DISTINCT FROM OLD.scoring_rubric
      OR NEW.max_points IS DISTINCT FROM OLD.max_points
      OR NEW.subject_id IS DISTINCT FROM OLD.subject_id
      OR NEW.academic_period IS DISTINCT FROM OLD.academic_period
    ) THEN
      RAISE EXCEPTION 'Violação de Integridade Académica: o conteúdo de um exercício oficial publicado/arquivado é imutável. Arquive-o e gere um novo.';
    END IF;
  END IF;

  -- Publicar exige proveniência oficial válida (também ao nível da base de dados)
  -- (Apenas em UPDATE: o INSERT direto de exercícios é reservado a admins por RLS/trigger
  --  e a via normal de criação — RPC atómica — insere sempre em rascunho.)
  IF TG_OP = 'UPDATE' AND NEW.is_official = true AND NEW.status = 'published'
     AND OLD.status IS DISTINCT FROM 'published' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.exercise_source_references r
      WHERE r.exercise_id = NEW.id
        AND r.source_type = 'official'
        AND r.official_note_id IS NOT NULL
        AND r.official_version_id IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'Violação de Integridade Académica: não é possível publicar um exercício oficial sem proveniência nos apontamentos oficiais.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_official_exercise_lifecycle ON public.exercises;
CREATE TRIGGER trg_protect_official_exercise_lifecycle
BEFORE INSERT OR UPDATE ON public.exercises
FOR EACH ROW EXECUTE FUNCTION public.protect_official_exercise_lifecycle();


-- ===== 20261025010000_turma_c_official_assessment_sessions.sql =====
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


-- ===== 20261025020000_turma_c_fix_grading_official_sources.sql =====
-- ==============================================================================
-- STUDENTS HUB — CORREÇÃO DE FUNÇÕES QUE AINDA USAVAM TABELAS PESSOAIS APAGADAS (B3)
-- submit_exercise_session_answers_atomic e get_session_results_for_student faziam JOIN a
-- personal_notes/note_pages (inexistentes) => a correção de sessões falhava.
-- Passam a referenciar EXCLUSIVAMENTE os apontamentos oficiais (proveniência oficial).
-- Lógica de correção e de segurança inalterada.
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
        COALESCE(onotes.title || COALESCE(' · ' || r.official_section, ''), 'Apontamentos Oficiais'),
        COALESCE(r.quote_excerpt, '')
      INTO v_source_ref, v_citation
      FROM public.exercise_source_references r
      LEFT JOIN public.official_notes onotes ON r.official_note_id = onotes.id
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
        (SELECT onotes.title || COALESCE(' · ' || r.official_section, '')
         FROM public.exercise_source_references r
         JOIN public.official_notes onotes ON r.official_note_id = onotes.id
         WHERE r.exercise_id = e.id LIMIT 1),
        'Apontamentos Oficiais'
      ) AS source_note_ref,
      COALESCE(
        (SELECT r.quote_excerpt
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

GRANT EXECUTE ON FUNCTION public.submit_exercise_session_answers_atomic(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_session_results_for_student(uuid) TO authenticated;

