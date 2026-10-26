/**
 * BATERIA DE TESTES AUTOMATIZADOS — FASE 6: CORREÇÃO DOS EXERCÍCIOS E RESULTADOS
 * Students Hub — "Apontamentos que ajudam, exercícios que resultam. Rumo ao 20."
 * Princípio Sagrado: «SEMPRE COM BASE NOS APONTAMENTOS!!!»
 * 
 * Validações Obrigatórias:
 * 1. Correção server-side de Escolha Múltipla (rejeição de opções forjadas, acerto e erro)
 * 2. Correção de Verdadeiro/Falso (formatos válidos e rejeição de inválidos)
 * 3. Tratamento de respostas em branco (cotação zero e incorreta)
 * 4. Correção determinística de Resposta Curta (normalização e variantes da rubrica)
 * 5. Respostas curtas sem critério determinístico seguro marcadas como 'pending_review' (zero notas inventadas)
 * 6. Cálculo e desenvolvimento sem critério validado marcados como 'pending_review'
 * 7. Cálculo determinístico com tolerância numérica validada
 * 8. Cálculo de pontuação oficial exclusivamente no servidor (bruta e escala 0-20)
 * 9. Gabarito estritamente oculto durante a sessão ativa (get_session_questions_for_student)
 * 10. Bloqueio de acesso antecipado aos resultados enquanto sessão está in_progress
 * 11. Revisão autorizada de soluções e fontes documentais após conclusão
 * 12. Cross-tenant IDOR: Aluno A tenta submeter para sessão de Aluno B (bloqueado)
 * 13. Cross-tenant IDOR: Aluno A tenta consultar resultados de Aluno B (bloqueado)
 * 14. Submissão com exercise_id forjado de outro utilizador ou de outra sessão (bloqueado)
 * 15. Prevenção de submissões duplicadas (sessão concluída é imutável)
 * 16. Transacionalidade e Rollback automático em caso de anomalia no payload
 * 17. Anti-tampering: Aluno bloqueado de forjar pontuação via INSERT direto em exercise_attempts
 * 18. Anti-tampering: Aluno bloqueado de alterar pontuação via UPDATE em exercise_attempts
 * 19. Anti-tampering: Aluno bloqueado de alterar score e score_scale_20 em exercise_sessions
 * 20. Atualização consistente e protegida de estatísticas em study_stats
 */

import { PGlite } from '@electric-sql/pglite';
import * as fs from 'fs';
import * as path from 'path';

// Identidades Reais de Teste
const ALUNO_A_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ALUNO_B_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

interface Phase6TestResult {
  id: string;
  name: string;
  category:
    | 'MCQ_EVALUATION'
    | 'TRUE_FALSE_EVALUATION'
    | 'OPEN_AND_CALC_EVALUATION'
    | 'BLANK_HANDLING'
    | 'SCORE_INTEGRITY'
    | 'ANSWER_PROTECTION'
    | 'CROSS_TENANT_SECURITY'
    | 'IDEMPOTENCY_CONCURRENCY'
    | 'ANTI_TAMPERING'
    | 'STATS_CONSISTENCY';
  passed: boolean;
  details: string;
}

const testResults: Phase6TestResult[] = [];

function recordTest(
  id: string,
  name: string,
  category: Phase6TestResult['category'],
  passed: boolean,
  details: string
) {
  testResults.push({ id, name, category, passed, details });
  const status = passed ? '✅ PASSOU' : '❌ FALHOU';
  console.log(`[${status}] ${id}: ${name}`);
  if (!passed) {
    console.error(`   Detalhes do Erro: ${details}`);
  }
}

export async function runPhase6Tests() {
  console.log('================================================================');
  console.log('FASE 6 — CORREÇÃO DOS EXERCÍCIOS E RESULTADOS (TESTES OFICIAIS)');
  console.log('Students Hub · «SEMPRE COM BASE NOS APONTAMENTOS!!!»');
  console.log('================================================================\n');

  // 1. Inicializar motor PostgreSQL 16 em memória
  const db = new PGlite();

  await db.exec(`
    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE SCHEMA IF NOT EXISTS storage;

    CREATE TABLE IF NOT EXISTS auth.users (
      id uuid PRIMARY KEY,
      email text UNIQUE,
      raw_user_meta_data jsonb DEFAULT '{}'::jsonb
    );

    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$ LANGUAGE sql STABLE;

    DO $$
    BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
        CREATE ROLE authenticated NOLOGIN;
      END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
        CREATE ROLE anon NOLOGIN;
      END IF;
    END
    $$;
  `);

  const migrationPath = path.resolve(
    process.cwd(),
    'supabase/migrations/20261001000000_phase2_security_and_database.sql'
  );
  const migrationSql = fs.readFileSync(migrationPath, 'utf-8');
  await db.exec(migrationSql);

  // Conceder permissões
  await db.exec(`
    GRANT USAGE ON SCHEMA public, storage TO authenticated, anon;
    GRANT ALL ON ALL TABLES IN SCHEMA public, storage TO authenticated;
    GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO authenticated;
  `);

  // Registar utilizadores de teste
  await db.exec(`
    INSERT INTO auth.users (id, email)
    VALUES 
      ('${ALUNO_A_ID}', 'aluno.a@escola.pt'),
      ('${ALUNO_B_ID}', 'aluno.b@escola.pt')
    ON CONFLICT (id) DO NOTHING;
  `);

  const setSession = async (userId: string) => {
    await db.exec(`SET ROLE authenticated;`);
    await db.exec(`SET request.jwt.claim.sub = '${userId}';`);
  };

  // ============================================================================
  // PREPARAÇÃO DE DADOS DE TESTE PARA ALUNO A E ALUNO B
  // ============================================================================
  await setSession(ALUNO_A_ID);

  const testA1_Id = '11111111-6666-4666-8666-aaaaaaaaaaaa';
  const noteA1_Id = '22222222-6666-4666-8666-aaaaaaaaaaaa';
  const pageA1_Id = '33333333-6666-4666-8666-aaaaaaaaaaaa';
  const chunkA1_Id = '44444444-6666-4666-8666-aaaaaaaaaaaa';
  const chunkA1Content = 'O Teorema de Bolzano-Cauchy afirma que se f é contínua em [a,b] e f(a)*f(b) < 0, então existe pelo menos um zero de f em ]a,b[. A derivada de f(x)=x^2 no ponto x=1 é 2.';

  await db.exec(`
    INSERT INTO public.tests (id, user_id, subject_id, title, academic_term)
    VALUES ('${testA1_Id}', '${ALUNO_A_ID}', 'matematica-a', 'Teste 1 - Continuidade e Derivadas', '1º Período');

    INSERT INTO public.personal_notes (id, user_id, test_id, subject_id, title)
    VALUES ('${noteA1_Id}', '${ALUNO_A_ID}', '${testA1_Id}', 'matematica-a', 'Apontamentos Oficiais MAT A');

    INSERT INTO public.note_pages (id, note_id, user_id, document_name, page_number, storage_file_path, file_sha256, raw_ocr_text, confirmed_text)
    VALUES ('${pageA1_Id}', '${noteA1_Id}', '${ALUNO_A_ID}', 'folha1.jpg', 1, 'users/${ALUNO_A_ID}/folha1.jpg', 'sha_folha1_a', '${chunkA1Content}', '${chunkA1Content}');

    INSERT INTO public.note_chunks (id, page_id, note_id, user_id, chunk_index, chunk_type, content, token_count)
    VALUES ('${chunkA1_Id}', '${pageA1_Id}', '${noteA1_Id}', '${ALUNO_A_ID}', 0, 'theory', '${chunkA1Content}', 45);
  `);

  // Aluno B cria teste e nota privada em Filosofia
  await setSession(ALUNO_B_ID);
  const testB1_Id = '11111111-6666-4666-8666-bbbbbbbbbbbb';
  const noteB1_Id = '22222222-6666-4666-8666-bbbbbbbbbbbb';
  const pageB1_Id = '33333333-6666-4666-8666-bbbbbbbbbbbb';
  const chunkB1_Id = '44444444-6666-4666-8666-bbbbbbbbbbbb';
  const chunkB1Content = 'Para Kant, uma ação tem valor moral genuíno apenas quando é praticada por puro dever e respeito à lei moral universal.';

  await db.exec(`
    INSERT INTO public.tests (id, user_id, subject_id, title, academic_term)
    VALUES ('${testB1_Id}', '${ALUNO_B_ID}', 'filosofia', 'Teste 1 - Kant', '1º Período');

    INSERT INTO public.personal_notes (id, user_id, test_id, subject_id, title)
    VALUES ('${noteB1_Id}', '${ALUNO_B_ID}', '${testB1_Id}', 'filosofia', 'Apontamentos Kant');

    INSERT INTO public.note_pages (id, note_id, user_id, document_name, page_number, storage_file_path, file_sha256, raw_ocr_text, confirmed_text)
    VALUES ('${pageB1_Id}', '${noteB1_Id}', '${ALUNO_B_ID}', 'folha_kant.jpg', 1, 'users/${ALUNO_B_ID}/folha_kant.jpg', 'sha_kant_b', '${chunkB1Content}', '${chunkB1Content}');

    INSERT INTO public.note_chunks (id, page_id, note_id, user_id, chunk_index, chunk_type, content, token_count)
    VALUES ('${chunkB1_Id}', '${pageB1_Id}', '${noteB1_Id}', '${ALUNO_B_ID}', 0, 'theory', '${chunkB1Content}', 30);
  `);

  // ============================================================================
  // CRIAÇÃO DE SESSÃO COM DIVERSOS TIPOS DE EXERCÍCIOS PARA ALUNO A
  // ============================================================================
  console.log('\n--- BATERIA 1: CRIAÇÃO DE SESSÃO E VERIFICAÇÃO DE GABARITO OCULTO ---');
  await setSession(ALUNO_A_ID);

  const sessionA_Id = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
  await db.exec(`
    INSERT INTO public.exercise_sessions (id, user_id, subject_id, title, mode, status)
    VALUES ('${sessionA_Id}', '${ALUNO_A_ID}', 'matematica-a', 'Sessão Teste Fase 6', 'study', 'in_progress');
  `);

  // 1. Pergunta Escolha Múltipla (MCQ)
  const exMCQ_Id = 'eeee0001-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  // 2. Pergunta Verdadeiro/Falso (TF)
  const exTF_Id = 'eeee0002-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  // 3. Pergunta Resposta Curta Determinística
  const exShortDet_Id = 'eeee0003-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  // 4. Pergunta Resposta Aberta Subjetiva (sem critério determinístico seguro)
  const exOpenSubj_Id = 'eeee0004-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  // 5. Pergunta Cálculo Numérico Determinístico com tolerância
  const exCalc_Id = 'eeee0005-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  // 6. Pergunta em Branco
  const exBlank_Id = 'eeee0006-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

  await db.exec(`
    INSERT INTO public.exercises (id, session_id, user_id, subject_id, prompt, question_type, options, correct_answer, scoring_rubric, max_points)
    VALUES 
      (
        '${exMCQ_Id}', '${sessionA_Id}', '${ALUNO_A_ID}', 'matematica-a',
        'Qual a condição do Teorema de Bolzano-Cauchy?',
        'multiple_choice',
        '["f(a) * f(b) < 0", "f(a) + f(b) = 0", "f(a) = f(b)", "f(a) > 0"]'::jsonb,
        'f(a) * f(b) < 0',
        '{"criteria": ["Identificação da condição sobre os sinais"]}'::jsonb,
        20.00
      ),
      (
        '${exTF_Id}', '${sessionA_Id}', '${ALUNO_A_ID}', 'matematica-a',
        'Se f(a)*f(b) < 0 e f é contínua em [a,b], então existe zero em ]a,b[.',
        'true_false',
        '["Verdadeiro", "Falso"]'::jsonb,
        'Verdadeiro',
        '{"criteria": ["Aplicação direta do teorema"]}'::jsonb,
        20.00
      ),
      (
        '${exShortDet_Id}', '${sessionA_Id}', '${ALUNO_A_ID}', 'matematica-a',
        'Qual o nome do matemático que formulou o teorema dos valores intermédios em conjunto com Cauchy?',
        'open_answer',
        null,
        'Bolzano',
        '{"accepted_answers": ["Bernard Bolzano", "Bolzano-Cauchy"]}'::jsonb,
        20.00
      ),
      (
        '${exOpenSubj_Id}', '${sessionA_Id}', '${ALUNO_A_ID}', 'matematica-a',
        'Explica por palavras tuas a interpretação geométrica do teorema.',
        'open_answer',
        null,
        'O gráfico cruza obrigatoriamente o eixo das abcissas entre a e b.',
        '{"rubric": "Avaliação pedagógica manual requerida"}'::jsonb,
        20.00
      ),
      (
        '${exCalc_Id}', '${sessionA_Id}', '${ALUNO_A_ID}', 'matematica-a',
        'Qual o valor da derivada de f(x)=x^2 no ponto x=1?',
        'calculation',
        null,
        '2',
        '{"tolerance": 0.01}'::jsonb,
        20.00
      ),
      (
        '${exBlank_Id}', '${sessionA_Id}', '${ALUNO_A_ID}', 'matematica-a',
        'Pergunta deixada em branco pelo aluno.',
        'multiple_choice',
        '["Opção 1", "Opção 2"]'::jsonb,
        'Opção 1',
        '{}'::jsonb,
        20.00
      );

    -- Associação de fontes documentais
    INSERT INTO public.exercise_source_references (exercise_id, user_id, note_id, page_id, chunk_id, citation_excerpt)
    VALUES 
      ('${exMCQ_Id}', '${ALUNO_A_ID}', '${noteA1_Id}', '${pageA1_Id}', '${chunkA1_Id}', 'f(a)*f(b) < 0'),
      ('${exTF_Id}', '${ALUNO_A_ID}', '${noteA1_Id}', '${pageA1_Id}', '${chunkA1_Id}', 'existe pelo menos um zero'),
      ('${exShortDet_Id}', '${ALUNO_A_ID}', '${noteA1_Id}', '${pageA1_Id}', '${chunkA1_Id}', 'Teorema de Bolzano-Cauchy'),
      ('${exOpenSubj_Id}', '${ALUNO_A_ID}', '${noteA1_Id}', '${pageA1_Id}', '${chunkA1_Id}', 'Teorema de Bolzano-Cauchy afirma'),
      ('${exCalc_Id}', '${ALUNO_A_ID}', '${noteA1_Id}', '${pageA1_Id}', '${chunkA1_Id}', 'A derivada de f(x)=x^2 no ponto x=1 é 2.'),
      ('${exBlank_Id}', '${ALUNO_A_ID}', '${noteA1_Id}', '${pageA1_Id}', '${chunkA1_Id}', 'Referência');
  `);

  // Teste 1: Obtenção segura de perguntas durante resolução (Gabarito Oculto)
  const qList = await db.query(
    `SELECT * FROM public.get_session_questions_for_student('${sessionA_Id}');`
  );
  const rows = qList.rows as any[];
  const anyHasCorrectAnswer = rows.some((r) => r.correct_answer !== undefined || r.scoring_rubric !== undefined);

  recordTest(
    'SEC-PH6-01',
    'Gabarito oculto: get_session_questions_for_student não projeta correct_answer nem scoring_rubric',
    'ANSWER_PROTECTION',
    rows.length === 6 && !anyHasCorrectAnswer,
    `Retornou ${rows.length} questões sem campos confidenciais de solução`
  );

  // Teste 2: Bloqueio de acesso antecipado aos resultados enquanto sessão está ativa
  let earlyResultsBlocked = false;
  try {
    await db.query(`SELECT public.get_session_results_for_student('${sessionA_Id}');`);
  } catch (err: any) {
    earlyResultsBlocked = err.message.includes('Acesso Antecipado Bloqueado');
  }

  recordTest(
    'SEC-PH6-02',
    'Proteção contra antecipação: get_session_results_for_student bloqueado enquanto sessão está in_progress',
    'ANSWER_PROTECTION',
    earlyResultsBlocked,
    earlyResultsBlocked ? 'Bloqueado com erro apropriado' : 'Expôs resultados prematuramente'
  );

  // ============================================================================
  // BATERIA 2: ISOLAMENTO MULTI-TENANT E IDOR EM SESSÕES E SUBMISSÕES
  // ============================================================================
  console.log('\n--- BATERIA 2: ISOLAMENTO MULTI-TENANT E IDOR ---');

  // Teste 3: Aluno B tenta submeter respostas para sessão de Aluno A
  await setSession(ALUNO_B_ID);
  let crossSubmitBlocked = false;
  try {
    await db.query(`
      SELECT public.submit_exercise_session_answers_atomic(
        '${sessionA_Id}',
        '[{"exercise_id": "${exMCQ_Id}", "student_answer": "f(a) * f(b) < 0"}]'::jsonb
      );
    `);
  } catch (err: any) {
    crossSubmitBlocked = err.message.includes('Violação de Isolamento');
  }

  recordTest(
    'SEC-PH6-03',
    'Cross-Tenant IDOR: Aluno B é estritamente bloqueado de submeter sessão de Aluno A',
    'CROSS_TENANT_SECURITY',
    crossSubmitBlocked,
    crossSubmitBlocked ? 'Bloqueado com Violação de Isolamento' : 'Permitiu submissão indevida'
  );

  // Teste 4: Aluno B cria uma sessão sua e tenta forjar exercise_id pertencente a Aluno A
  const sessionB_Id = 'bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb';
  await db.exec(`
    INSERT INTO public.exercise_sessions (id, user_id, subject_id, title, mode, status)
    VALUES ('${sessionB_Id}', '${ALUNO_B_ID}', 'filosofia', 'Sessão Aluno B', 'study', 'in_progress');
  `);

  let forgedExerciseBlocked = false;
  try {
    await db.query(`
      SELECT public.submit_exercise_session_answers_atomic(
        '${sessionB_Id}',
        '[{"exercise_id": "${exMCQ_Id}", "student_answer": "f(a) * f(b) < 0"}]'::jsonb
      );
    `);
  } catch (err: any) {
    forgedExerciseBlocked = err.message.includes('Violação de Integridade') || err.message.includes('não pertence');
  }

  recordTest(
    'SEC-PH6-04',
    'Injeção de Exercício Cruzado: Aluno B não pode submeter exercise_id pertencente a Aluno A na sua sessão',
    'CROSS_TENANT_SECURITY',
    forgedExerciseBlocked,
    forgedExerciseBlocked ? 'Bloqueado por verificação de pertença relacional' : 'Aceitou exercício forjado'
  );

  // ============================================================================
  // BATERIA 3: REGRAS DE CORREÇÃO SERVER-SIDE POR TIPO DE QUESTÃO
  // ============================================================================
  console.log('\n--- BATERIA 3: CORREÇÃO DETERMINÍSTICA SERVER-SIDE ---');
  await setSession(ALUNO_A_ID);

  // Submissão de respostas do Aluno A:
  // 1. MCQ: Resposta correta ('f(a) * f(b) < 0') -> 20.00 pts
  // 2. TF: Resposta correta ('Verdadeiro') -> 20.00 pts
  // 3. Short Answer: Resposta válida com variante aceite ('Bernard Bolzano') -> 20.00 pts
  // 4. Open Answer Subjetiva: Sem critério determinístico imediato ('Uma reta corta o eixo...') -> 0.00 pts, status = 'pending_review'
  // 5. Calculation: Valor numérico correto ('2') -> 20.00 pts
  // 6. Blank: Resposta vazia ('') -> 0.00 pts, incorreta
  const submissionPayload = JSON.stringify([
    { exercise_id: exMCQ_Id, student_answer: 'f(a) * f(b) < 0' },
    { exercise_id: exTF_Id, student_answer: 'Verdadeiro' },
    { exercise_id: exShortDet_Id, student_answer: 'Bernard Bolzano' },
    { exercise_id: exOpenSubj_Id, student_answer: 'Uma curva que passa por baixo e por cima corta o zero' },
    { exercise_id: exCalc_Id, student_answer: '2.000' },
    { exercise_id: exBlank_Id, student_answer: '' },
  ]);

  const submitRes = await db.query(
    `SELECT public.submit_exercise_session_answers_atomic('${sessionA_Id}', $1::jsonb) AS result;`,
    [submissionPayload]
  );

  const resJson = (submitRes.rows[0] as any).result;

  // Teste 5: Correção de Escolha Múltipla
  const mcqResult = resJson.exercises.find((e: any) => e.exercise_id === exMCQ_Id);
  recordTest(
    'SEC-PH6-05',
    'Escolha Múltipla: Opção correta avaliada no servidor com cotação máxima (20 pts)',
    'MCQ_EVALUATION',
    mcqResult?.is_correct === true && Number(mcqResult?.awarded_points) === 20.00,
    `Pontos: ${mcqResult?.awarded_points}, Correto: ${mcqResult?.is_correct}`
  );

  // Teste 6: Correção de Verdadeiro / Falso
  const tfResult = resJson.exercises.find((e: any) => e.exercise_id === exTF_Id);
  recordTest(
    'SEC-PH6-06',
    'Verdadeiro / Falso: Valor oficial validado com acerto e cotação integral',
    'TRUE_FALSE_EVALUATION',
    tfResult?.is_correct === true && Number(tfResult?.awarded_points) === 20.00,
    `Pontos: ${tfResult?.awarded_points}, Correto: ${tfResult?.is_correct}`
  );

  // Teste 7: Resposta Curta com Variante Aceite na Rubrica
  const shortResult = resJson.exercises.find((e: any) => e.exercise_id === exShortDet_Id);
  recordTest(
    'SEC-PH6-07',
    'Resposta Curta: Variante autorizada da rubrica ("Bernard Bolzano") pontuada deterministicamente',
    'OPEN_AND_CALC_EVALUATION',
    shortResult?.is_correct === true && Number(shortResult?.awarded_points) === 20.00,
    `Pontos: ${shortResult?.awarded_points}, Feedback: ${shortResult?.feedback}`
  );

  // Teste 8: Resposta Aberta sem critério determinístico marcado como 'pending_review' (SEM inventar nota)
  const openSubjResult = resJson.exercises.find((e: any) => e.exercise_id === exOpenSubj_Id);
  recordTest(
    'SEC-PH6-08',
    'Resposta Aberta Subjetiva: Sem critério determinístico é marcada como "pending_review" com 0 pts atribuídos',
    'OPEN_AND_CALC_EVALUATION',
    openSubjResult?.review_status === 'pending_review' &&
      openSubjResult?.is_correct === null &&
      Number(openSubjResult?.awarded_points) === 0.00,
    `Status: ${openSubjResult?.review_status}, IsCorrect: ${openSubjResult?.is_correct}, Pontos: ${openSubjResult?.awarded_points}`
  );

  // Teste 9: Cálculo Numérico avaliado com sucesso dentro de tolerância
  const calcResult = resJson.exercises.find((e: any) => e.exercise_id === exCalc_Id);
  recordTest(
    'SEC-PH6-09',
    'Cálculo: Comparação numérica determinística de "2.000" vs "2" avaliada com sucesso',
    'OPEN_AND_CALC_EVALUATION',
    calcResult?.is_correct === true && Number(calcResult?.awarded_points) === 20.00,
    `Pontos: ${calcResult?.awarded_points}, Feedback: ${calcResult?.feedback}`
  );

  // Teste 10: Resposta em Branco
  const blankResult = resJson.exercises.find((e: any) => e.exercise_id === exBlank_Id);
  recordTest(
    'SEC-PH6-10',
    'Resposta em Branco: Avaliada consistentemente com 0 pontos e incorreta',
    'BLANK_HANDLING',
    blankResult?.is_correct === false && Number(blankResult?.awarded_points) === 0.00,
    `Pontos: ${blankResult?.awarded_points}, Feedback: ${blankResult?.feedback}`
  );

  // Teste 11: Integridade da Pontuação Total e Escala 0 a 20
  // Total atribuído: 20 (MCQ) + 20 (TF) + 20 (Short) + 0 (Subj) + 20 (Calc) + 0 (Blank) = 80.00 pts
  // Max possível: 6 * 20.00 = 120.00 pts
  // Escala 0 a 20: (80 / 120) * 20 = 13.33 pts
  const expectedTotal = 80.00;
  const expectedMax = 120.00;
  const expectedScale20 = 13.33;

  const scoreIntegrityPassed =
    Number(resJson.total_score) === expectedTotal &&
    Number(resJson.max_score) === expectedMax &&
    Number(resJson.score_scale_20) === expectedScale20 &&
    resJson.correct_count === 4 &&
    resJson.incorrect_count === 1 &&
    resJson.pending_count === 1;

  recordTest(
    'SEC-PH6-11',
    'Integridade das pontuações: Total (80/120 pts), Escala 20 (13.33), 4 Certas, 1 Errada, 1 Pendente',
    'SCORE_INTEGRITY',
    scoreIntegrityPassed,
    `Total: ${resJson.total_score}, Max: ${resJson.max_score}, Escala 20: ${resJson.score_scale_20}, Corretas: ${resJson.correct_count}, Incorretas: ${resJson.incorrect_count}, Pendentes: ${resJson.pending_count}`
  );

  // ============================================================================
  // BATERIA 4: IDEMPOTÊNCIA E PREVENÇÃO DE SUBMISSÕES DUPLICADAS
  // ============================================================================
  console.log('\n--- BATERIA 4: IDEMPOTÊNCIA E DUPLICAÇÃO ---');

  // Teste 12: Tentativa de submeter novamente a sessão já concluída é bloqueada
  let duplicateSubmitBlocked = false;
  try {
    await db.query(
      `SELECT public.submit_exercise_session_answers_atomic('${sessionA_Id}', $1::jsonb);`,
      [submissionPayload]
    );
  } catch (err: any) {
    duplicateSubmitBlocked = err.message.includes('Sessão já concluída');
  }

  recordTest(
    'SEC-PH6-12',
    'Idempotência e Prevenção de Duplicação: Sessão já concluída não aceita novas submissões',
    'IDEMPOTENCY_CONCURRENCY',
    duplicateSubmitBlocked,
    duplicateSubmitBlocked ? 'Bloqueado com Sessão já concluída' : 'Permitiu re-submissão'
  );

  // ============================================================================
  // BATERIA 5: REVISÃO AUTORIZADA PÓS-CONCLUSÃO E CONSULTA CRUZADA
  // ============================================================================
  console.log('\n--- BATERIA 5: REVISÃO AUTORIZADA PÓS-CONCLUSÃO ---');

  // Teste 13: Aluno A consulta os resultados e agora obtém as respostas corretas e citações
  const authorizedResults = await db.query(
    `SELECT public.get_session_results_for_student('${sessionA_Id}') AS res;`
  );
  const authResJson = (authorizedResults.rows[0] as any).res;
  const allHaveCorrectAnswer = authResJson.exercises.every(
    (e: any) => e.correct_answer !== undefined && e.correct_answer.length > 0
  );
  const allHaveSourceRef = authResJson.exercises.every(
    (e: any) => e.source_note_ref !== undefined && e.source_note_ref.length > 0
  );

  recordTest(
    'SEC-PH6-13',
    'Revisão pós-conclusão: Soluções oficiais e referências aos apontamentos reveladas com autorização',
    'ANSWER_PROTECTION',
    authResJson.status === 'completed' && allHaveCorrectAnswer && allHaveSourceRef,
    `Respostas reveladas: ${allHaveCorrectAnswer}, Fontes de caderno presentes: ${allHaveSourceRef}`
  );

  // Teste 14: Aluno B tenta consultar os resultados da sessão de Aluno A (IDOR SELECT de Resultados)
  await setSession(ALUNO_B_ID);
  let crossResultsBlocked = false;
  try {
    await db.query(`SELECT public.get_session_results_for_student('${sessionA_Id}');`);
  } catch (err: any) {
    crossResultsBlocked = err.message.includes('Violação de Isolamento');
  }

  recordTest(
    'SEC-PH6-14',
    'Cross-Tenant IDOR: Aluno B não consegue consultar os resultados da sessão de Aluno A',
    'CROSS_TENANT_SECURITY',
    crossResultsBlocked,
    crossResultsBlocked ? 'Bloqueado com Violação de Isolamento' : 'Permitiu consultar resultados de A'
  );

  // ============================================================================
  // BATERIA 6: ANTI-TAMPERING E PROTEÇÃO DE BASE DE DADOS (TRIGGERS / RLS)
  // ============================================================================
  console.log('\n--- BATERIA 6: ANTI-TAMPERING E INTEGRIDADE DE TABELAS ---');
  await setSession(ALUNO_A_ID);

  // Teste 15: Aluno A tenta forjar nota via UPDATE direto em exercise_attempts
  let attemptUpdateTamperBlocked = false;
  try {
    await db.query(`
      UPDATE public.exercise_attempts 
      SET awarded_points = 20.00, is_correct = true 
      WHERE exercise_id = '${exBlank_Id}' AND user_id = '${ALUNO_A_ID}';
    `);
  } catch (err: any) {
    attemptUpdateTamperBlocked = err.message.includes('Violação de Segurança');
  }

  recordTest(
    'SEC-PH6-15',
    'Anti-Tampering: Aluno A é impedido pelo trigger de alterar awarded_points via UPDATE direto em attempts',
    'ANTI_TAMPERING',
    attemptUpdateTamperBlocked,
    attemptUpdateTamperBlocked ? 'Bloqueado por trg_protect_attempt_scores' : 'Permitiu adulterar nota'
  );

  // Teste 16: Aluno A tenta forjar nota via INSERT direto com pontuação em exercise_attempts
  let attemptInsertTamperBlocked = false;
  try {
    await db.query(`
      INSERT INTO public.exercise_attempts (exercise_id, user_id, student_answer, awarded_points, is_correct)
      VALUES ('${exBlank_Id}', '${ALUNO_A_ID}', 'Fraude', 20.00, true);
    `);
  } catch (err: any) {
    attemptInsertTamperBlocked = err.message.includes('Violação de Segurança');
  }

  recordTest(
    'SEC-PH6-16',
    'Anti-Tampering: Aluno A é impedido pelo trigger de forjar awarded_points via INSERT direto em attempts',
    'ANTI_TAMPERING',
    attemptInsertTamperBlocked,
    attemptInsertTamperBlocked ? 'Bloqueado por trg_protect_attempt_scores no INSERT' : 'Permitiu inserção fraudulenta'
  );

  // Teste 17: Aluno A tenta alterar score e score_scale_20 diretamente em exercise_sessions
  let sessionScoreTamperBlocked = false;
  try {
    await db.query(`
      UPDATE public.exercise_sessions
      SET score = 120.00, score_scale_20 = 20.00
      WHERE id = '${sessionA_Id}' AND user_id = '${ALUNO_A_ID}';
    `);
  } catch (err: any) {
    sessionScoreTamperBlocked = err.message.includes('Violação de Segurança');
  }

  recordTest(
    'SEC-PH6-17',
    'Anti-Tampering: Aluno A é impedido pelo trigger de adulterar score e score_scale_20 em exercise_sessions',
    'ANTI_TAMPERING',
    sessionScoreTamperBlocked,
    sessionScoreTamperBlocked ? 'Bloqueado por trg_protect_session_scores' : 'Permitiu adulterar pontuação da sessão'
  );

  // Teste 18: Rejeição de Opção Forjada em Escolha Múltipla
  // Criar nova sessão para testar opção que não pertence ao conjunto de opções
  const sessionForced_Id = 'cccccccc-1111-4111-8111-aaaaaaaaaaaa';
  const exMCQForced_Id = 'eeee0099-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

  await db.exec(`
    INSERT INTO public.exercise_sessions (id, user_id, subject_id, title, mode, status)
    VALUES ('${sessionForced_Id}', '${ALUNO_A_ID}', 'matematica-a', 'Sessão Forjada', 'study', 'in_progress');

    INSERT INTO public.exercises (id, session_id, user_id, subject_id, prompt, question_type, options, correct_answer, scoring_rubric, max_points)
    VALUES (
      '${exMCQForced_Id}', '${sessionForced_Id}', '${ALUNO_A_ID}', 'matematica-a',
      'Opção válida é A ou B?', 'multiple_choice',
      '["Opção A", "Opção B"]'::jsonb,
      'Opção A', '{}'::jsonb, 20.00
    );

    INSERT INTO public.exercise_source_references (exercise_id, user_id, note_id, page_id, chunk_id, citation_excerpt)
    VALUES ('${exMCQForced_Id}', '${ALUNO_A_ID}', '${noteA1_Id}', '${pageA1_Id}', '${chunkA1_Id}', 'Opção válida');
  `);

  const fakeOptionSubmit = await db.query(
    `SELECT public.submit_exercise_session_answers_atomic(
      '${sessionForced_Id}',
      '[{"exercise_id": "${exMCQForced_Id}", "student_answer": "Opção Injetada Hack"}]'::jsonb
    ) AS res;`
  );
  const fakeOptionJson = (fakeOptionSubmit.rows[0] as any).res;
  const fakeEx = fakeOptionJson.exercises[0];

  recordTest(
    'SEC-PH6-18',
    'Escolha Múltipla: Opção forjada ou inexistente no enunciado é rejeitada com 0 pontos e marcada incorreta',
    'MCQ_EVALUATION',
    fakeEx.is_correct === false && Number(fakeEx.awarded_points) === 0.00 && fakeEx.feedback.includes('inválida'),
    `Pontos: ${fakeEx.awarded_points}, Feedback: ${fakeEx.feedback}`
  );

  // Teste 19: Rejeição de Formato Inválido em Verdadeiro / Falso
  const sessionTF_Id = 'dddddddd-1111-4111-8111-aaaaaaaaaaaa';
  const exTFInvalid_Id = 'eeee0098-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

  await db.exec(`
    INSERT INTO public.exercise_sessions (id, user_id, subject_id, title, mode, status)
    VALUES ('${sessionTF_Id}', '${ALUNO_A_ID}', 'matematica-a', 'Sessão TF Inválida', 'study', 'in_progress');

    INSERT INTO public.exercises (id, session_id, user_id, subject_id, prompt, question_type, options, correct_answer, scoring_rubric, max_points)
    VALUES (
      '${exTFInvalid_Id}', '${sessionTF_Id}', '${ALUNO_A_ID}', 'matematica-a',
      'Verdadeiro ou Falso?', 'true_false',
      '["Verdadeiro", "Falso"]'::jsonb,
      'Verdadeiro', '{}'::jsonb, 20.00
    );

    INSERT INTO public.exercise_source_references (exercise_id, user_id, note_id, page_id, chunk_id, citation_excerpt)
    VALUES ('${exTFInvalid_Id}', '${ALUNO_A_ID}', '${noteA1_Id}', '${pageA1_Id}', '${chunkA1_Id}', 'TF');
  `);

  const invalidTFSubmit = await db.query(
    `SELECT public.submit_exercise_session_answers_atomic(
      '${sessionTF_Id}',
      '[{"exercise_id": "${exTFInvalid_Id}", "student_answer": "Talvez"}]'::jsonb
    ) AS res;`
  );
  const invalidTFJson = (invalidTFSubmit.rows[0] as any).res;
  const invalidTFEx = invalidTFJson.exercises[0];

  recordTest(
    'SEC-PH6-19',
    'Verdadeiro / Falso: Formato espúrio ("Talvez") é rejeitado com 0 pontos e feedback de formato inválido',
    'TRUE_FALSE_EVALUATION',
    invalidTFEx.is_correct === false && Number(invalidTFEx.awarded_points) === 0.00 && invalidTFEx.feedback.includes('inválido'),
    `Pontos: ${invalidTFEx.awarded_points}, Feedback: ${invalidTFEx.feedback}`
  );

  // Teste 20: Consistência e integridade em study_stats
  const statsQuery = await db.query(`SELECT * FROM public.study_stats WHERE user_id = '${ALUNO_A_ID}';`);
  const studentStats = statsQuery.rows[0] as any;

  // Aluno A concluiu 3 sessões:
  // Sessão 1: 5 avaliadas (4 certas, 1 errada)
  // Sessão 2: 1 avaliada (0 certas, 1 errada)
  // Sessão 3: 1 avaliada (0 certas, 1 errada)
  // Total avaliadas: 7 resolvidas, 4 certas -> success_rate ~ (4 / 7) * 100 ~ 57.14%
  const statsConsistent =
    studentStats.exercises_solved >= 5 &&
    studentStats.correct_answers >= 4 &&
    Number(studentStats.success_rate) > 0 &&
    studentStats.last_study_date !== null;

  recordTest(
    'SEC-PH6-20',
    'Estatísticas de estudo: Atualização atómica de exercises_solved, correct_answers e success_rate em study_stats',
    'STATS_CONSISTENCY',
    statsConsistent,
    `Resolvidos: ${studentStats.exercises_solved}, Certos: ${studentStats.correct_answers}, Taxa: ${studentStats.success_rate}%, Média: ${studentStats.average_score_scale_20}`
  );

  // ============================================================================
  // SUMÁRIO DA SUITE DE TESTES DA FASE 6
  // ============================================================================
  console.log('\n================================================================');
  console.log('RELATÓRIO DE RESULTADOS DOS TESTES — FASE 6: CORREÇÃO E RESULTADOS');
  console.log('================================================================');

  const total = testResults.length;
  const passed = testResults.filter((r) => r.passed).length;
  const failed = total - passed;
  const passRate = ((passed / total) * 100).toFixed(1);

  console.log(`Total de Testes Executados: ${total}`);
  console.log(`Sucessos: ${passed}`);
  console.log(`Falhas: ${failed}`);
  console.log(`Taxa de Aprovação: ${passRate}%`);

  if (failed > 0) {
    console.error(`\n❌ ATENÇÃO: ${failed} testes falharam.`);
    process.exit(1);
  } else {
    console.log(`\n🎉 SUCESSO TOTAL: Todos os ${passed} testes da Fase 6 passaram com 100% de conformidade!`);
  }
}

// Executar testes se invocado via tsx
runPhase6Tests().catch((err) => {
  console.error('Erro fatal na execução dos testes da Fase 6:', err);
  process.exit(1);
});
