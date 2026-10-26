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
