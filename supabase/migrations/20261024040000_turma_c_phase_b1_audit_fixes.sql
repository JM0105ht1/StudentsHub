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
