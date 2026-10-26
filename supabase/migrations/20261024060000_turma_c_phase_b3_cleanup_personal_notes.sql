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
