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
