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
