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
