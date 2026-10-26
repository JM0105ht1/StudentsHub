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
