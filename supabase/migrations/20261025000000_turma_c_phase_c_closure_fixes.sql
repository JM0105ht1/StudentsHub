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
