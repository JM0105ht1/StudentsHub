-- Treino por tipo de pergunta e limite total de 20 exercícios.
-- p_type_counts: {"multiple_choice": 5, "true_false": 3, "open_answer": 2, "calculation": 0}
DROP FUNCTION IF EXISTS public.start_official_practice_session(text, text, integer, text, text);

CREATE OR REPLACE FUNCTION public.start_official_practice_session(
  p_subject_id text,
  p_academic_period text DEFAULT NULL,
  p_count integer DEFAULT 5,
  p_question_type text DEFAULT NULL,
  p_difficulty text DEFAULT NULL,
  p_type_counts jsonb DEFAULT NULL
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
  v_use_counts boolean := false;
  v_total integer := 0;
  v_key text;
  v_val integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Não autorizado: Identidade de autenticação ausente.';
  END IF;

  v_use_counts := p_type_counts IS NOT NULL
    AND jsonb_typeof(p_type_counts) = 'object'
    AND p_type_counts <> '{}'::jsonb;

  IF v_use_counts THEN
    FOR v_key, v_val IN
      SELECT key, COALESCE(NULLIF(value, '')::integer, 0) FROM jsonb_each_text(p_type_counts)
    LOOP
      IF v_key NOT IN ('multiple_choice', 'true_false', 'open_answer', 'calculation') THEN
        RAISE EXCEPTION 'Tipo de exercício inválido.';
      END IF;
      IF v_val < 0 OR v_val > 20 THEN
        RAISE EXCEPTION 'O número de exercícios deve estar entre 1 e 20.';
      END IF;
      v_total := v_total + v_val;
    END LOOP;
    IF v_total < 1 OR v_total > 20 THEN
      RAISE EXCEPTION 'O número de exercícios deve estar entre 1 e 20.';
    END IF;
  ELSIF p_count IS NULL OR p_count < 1 OR p_count > 20 THEN
    RAISE EXCEPTION 'O número de exercícios deve estar entre 1 e 20.';
  END IF;

  SELECT name INTO v_subject_name FROM public.subjects WHERE id = p_subject_id;
  IF v_subject_name IS NULL THEN
    RAISE EXCEPTION 'Disciplina inválida.';
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS _practice_pick (id uuid) ON COMMIT DROP;
  DELETE FROM _practice_pick;

  IF v_use_counts THEN
    FOR v_key, v_val IN
      SELECT key, COALESCE(NULLIF(value, '')::integer, 0) FROM jsonb_each_text(p_type_counts)
    LOOP
      CONTINUE WHEN v_val < 1;
      INSERT INTO _practice_pick
      SELECT e.id
      FROM public.exercises e
      WHERE e.is_official = true AND e.status = 'published' AND e.session_id IS NULL
        AND e.subject_id = p_subject_id
        AND (p_academic_period IS NULL OR e.academic_period = p_academic_period)
        AND e.question_type = v_key
        AND (p_difficulty IS NULL OR p_difficulty = 'mixed' OR e.difficulty = p_difficulty)
        AND EXISTS (SELECT 1 FROM public.exercise_source_references r
                    WHERE r.exercise_id = e.id AND r.source_type = 'official')
      ORDER BY random()
      LIMIT v_val;
    END LOOP;
  ELSE
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
  END IF;

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

REVOKE ALL ON FUNCTION public.start_official_practice_session(text, text, integer, text, text, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.start_official_practice_session(text, text, integer, text, text, jsonb) TO authenticated;
