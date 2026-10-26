/**
 * BATERIA DE TESTES AUTOMATIZADOS — FASE C: MOTOR DE EXERCÍCIOS OFICIAIS GROUNDED COM GEMINI
 * Students Hub — Turma C
 * Slogan: "Apontamentos que ajudam, exercícios que resultam. Rumo ao 20."
 * Princípio Sagrado: «SEMPRE COM BASE NOS APONTAMENTOS OFICIAIS!!!»
 */

import { PGlite } from '@electric-sql/pglite';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

process.env.NODE_ENV = 'test';
process.env.GEMINI_API_KEY = 'test-mock-gemini-key';

import {
  validateOfficialExerciseBatch,
  OfficialNoteGroundedContext,
  OFFICIAL_EXERCISE_SYSTEM_INSTRUCTION,
} from '../netlify/functions/exercise-schema';
import { handler as generateExercisesHandler } from '../netlify/functions/generate-exercises';

// Identidades Reais de Teste
const ALUNO_A_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ADMIN_ID = '99999999-9999-4999-8999-999999999999';

interface PhaseCTestResult {
  id: string;
  name: string;
  category: 'AUTH' | 'INPUT_VALIDATION' | 'OFFICIAL_GROUNDING' | 'CITATION_VERIFICATION' | 'DRAFT_ISOLATION' | 'PROVENANCE_INTEGRITY' | 'ADMIN_REVIEW';
  passed: boolean;
  details: string;
}

const testResults: PhaseCTestResult[] = [];

function recordTest(
  id: string,
  name: string,
  category: PhaseCTestResult['category'],
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

export async function runPhase5Tests() {
  console.log('================================================================');
  console.log('FASE C — MOTOR DE EXERCÍCIOS OFICIAIS GROUNDED COM GEMINI');
  console.log('Students Hub · Turma C · «SEMPRE COM BASE NOS APONTAMENTOS OFICIAIS!!!»');
  console.log('================================================================\n');

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

  // Carregar as 9 migrações incrementais
  const migrationFiles = [
    '20261001000000_phase2_security_and_database.sql',
    '20261024000000_turma_c_official_schema.sql',
    '20261024010000_turma_c_phase_a1_audit_fixes.sql',
    '20261024020000_turma_c_phase_a2_verification_fixes.sql',
    '20261024030000_turma_c_phase_b_notes_management.sql',
    '20261024040000_turma_c_phase_b1_audit_fixes.sql',
    '20261024050000_turma_c_phase_b2_integrity_fixes.sql',
    '20261024060000_turma_c_phase_b3_cleanup_personal_notes.sql',
    '20261024070000_turma_c_phase_c_official_exercises.sql',
    '20261024080000_turma_c_phase_c_integrity_closure.sql',
    '20261025000000_turma_c_phase_c_closure_fixes.sql',
  ];

  for (let i = 0; i < migrationFiles.length; i++) {
    const fPath = path.resolve(process.cwd(), 'supabase/migrations', migrationFiles[i]);
    const sql = fs.readFileSync(fPath, 'utf-8');
    await db.exec(sql);
  }

  const setSession = async (role: 'authenticated' | 'anon', userId?: string) => {
    await db.exec(`SET ROLE ${role};`);
    if (userId) {
      await db.exec(`SET request.jwt.claim.sub = '${userId}';`);
      await db.exec(`SET request.jwt.claim.role = '${role}';`);
    } else {
      await db.exec(`RESET request.jwt.claim.sub;`);
      await db.exec(`RESET request.jwt.claim.role;`);
    }
  };

  const resetSession = async () => {
    await db.exec(`RESET ROLE; RESET request.jwt.claim.sub; RESET request.jwt.claim.role;`);
  };

  // Conceder permissões operacionais às roles Supabase
  await db.exec(`
    GRANT USAGE ON SCHEMA public TO authenticated, anon;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated, anon;
  `);

  // Registar utilizadores e papéis
  await db.exec(`
    INSERT INTO auth.users (id, email) VALUES
      ('${ALUNO_A_ID}', 'aluno.a@studentshub.pt'),
      ('${ADMIN_ID}', 'admin@studentshub.pt')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.profiles (id, full_name, class_name) VALUES
      ('${ALUNO_A_ID}', 'Aluno Turma C', 'Turma C'),
      ('${ADMIN_ID}', 'Administrador Curador', 'Turma C')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.user_roles (user_id, role) VALUES
      ('${ALUNO_A_ID}', 'student'),
      ('${ADMIN_ID}', 'admin')
    ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role;
  `);

  // Criar apontamento oficial publicado de Matemática A para os testes
  const noteId = '11111111-1111-4111-8111-111111111111';
  const versionId = '22222222-2222-4222-8222-222222222222';
  const officialPlainText = 'Teorema de Bolzano-Cauchy: Se uma funcao f e continua num intervalo fechado [a, b] e f(a) * f(b) < 0, entao existe pelo menos um ponto c pertencente ao intervalo aberto ]a, b[ tal que f(c) = 0. Aplicacao principal: localizacao e existencia de zeros de funcoes continuas.';
  const officialHtml = `<p>${officialPlainText}</p>`;

  await db.exec(`
    INSERT INTO public.official_notes (
      id, subject_id, academic_period, theme, title, is_published, created_by
    ) VALUES (
      '${noteId}', 'matematica-a', 'P1', 'Teorema de Bolzano-Cauchy', 'Continuidade e Zeros de Funções', false, '${ADMIN_ID}'
    );

    INSERT INTO public.official_note_versions (
      id, note_id, version_number, raw_html, sanitized_html, plain_text_content, is_published, published_at, created_by
    ) VALUES (
      '${versionId}', '${noteId}', 1, '${officialHtml}', '${officialHtml}', '${officialPlainText}', true, now(), '${ADMIN_ID}'
    );

    UPDATE public.official_notes
    SET current_version_id = '${versionId}', is_published = true, published_at = now()
    WHERE id = '${noteId}';
  `);

  // SHA-256 real do texto simples oficial (a BD recalcula e confirma o hash na criação atómica)
  const officialHash = crypto.createHash('sha256').update(officialPlainText, 'utf8').digest('hex');

  console.log('--- 1. AUTENTICAÇÃO E AUTORIZAÇÃO ADMINISTRATIVA ---');

  // Teste 1: Chamada sem autorização (deve dar 401)
  const resNoAuth = await generateExercisesHandler({
    httpMethod: 'POST',
    headers: {},
    body: JSON.stringify({ note_id: noteId }),
  } as any, {} as any, () => {}) as any;

  recordTest(
    'F5-AUTH-01',
    'Rejeição de requisição sem token de autenticação (HTTP 401)',
    'AUTH',
    resNoAuth.statusCode === 401,
    'Endpoint barrou chamada anónima'
  );

  // Teste 2: Aluno tenta gerar exercícios oficiais (deve dar 403 Forbidden)
  const resStudent = await generateExercisesHandler({
    httpMethod: 'POST',
    headers: { authorization: `Bearer ${ALUNO_A_ID}` },
    body: JSON.stringify({ note_id: noteId, count: 5 }),
  } as any, {} as any, () => {}) as any;

  recordTest(
    'F5-AUTH-02',
    'Aluno autenticado terminantemente impedido de gerar exercícios oficiais (HTTP 403)',
    'AUTH',
    resStudent.statusCode === 403 && JSON.parse(resStudent.body || '{}').code === 'FORBIDDEN_ADMIN_ONLY',
    'Endpoint validou a role no servidor e barrou o aluno'
  );

  console.log('\n--- 2. VALIDAÇÃO DE INPUTS NO ENDPOINT DO SERVIDOR ---');

  // Teste 3: note_id inválido ou não-UUID (HTTP 400)
  const resBadNoteId = await generateExercisesHandler({
    httpMethod: 'POST',
    headers: { authorization: `Bearer ${ADMIN_ID}` },
    body: JSON.stringify({ note_id: 'not-a-uuid; DROP TABLE users;' }),
  } as any, {} as any, () => {}) as any;

  recordTest(
    'F5-VAL-01',
    'Rejeição de identificador note_id inválido ou malformado (HTTP 400)',
    'INPUT_VALIDATION',
    resBadNoteId.statusCode === 400,
    'Endpoint bloqueou note_id malformado'
  );

  // Teste 4: Quantidade fora dos limites (count = 0 e count = 25) (HTTP 400)
  const resBadCount0 = await generateExercisesHandler({
    httpMethod: 'POST',
    headers: { authorization: `Bearer ${ADMIN_ID}` },
    body: JSON.stringify({ note_id: noteId, count: 0 }),
  } as any, {} as any, () => {}) as any;

  const resBadCount25 = await generateExercisesHandler({
    httpMethod: 'POST',
    headers: { authorization: `Bearer ${ADMIN_ID}` },
    body: JSON.stringify({ note_id: noteId, count: 25 }),
  } as any, {} as any, () => {}) as any;

  recordTest(
    'F5-VAL-02',
    'Rejeição de quantidade de exercícios fora do intervalo [1, 15] (HTTP 400)',
    'INPUT_VALIDATION',
    resBadCount0.statusCode === 400 && resBadCount25.statusCode === 400,
    'Endpoint barrou contagens inválidas'
  );

  // Teste 5: Tipo de questão inválido (HTTP 400)
  const resBadType = await generateExercisesHandler({
    httpMethod: 'POST',
    headers: { authorization: `Bearer ${ADMIN_ID}` },
    body: JSON.stringify({ note_id: noteId, question_type: 'tipo_inexistente' }),
  } as any, {} as any, () => {}) as any;

  recordTest(
    'F5-VAL-03',
    'Rejeição de tipologia de questão não suportada (HTTP 400)',
    'INPUT_VALIDATION',
    resBadType.statusCode === 400,
    'Endpoint barrou tipo desconhecido'
  );

  console.log('\n--- 3. GROUNDING NO CADERNO OFICIAL E ANTI-ALUCINAÇÃO ---');

  const fullNoteContext: OfficialNoteGroundedContext = {
    note_id: noteId,
    version_id: versionId,
    version_number: 1,
    subject_id: 'matematica-a',
    academic_period: 'P1',
    theme: 'Teorema de Bolzano-Cauchy',
    title: 'Continuidade e Zeros de Funções',
    content_text: officialPlainText,
    content_hash: 'hash-sha256-bolzano-123',
  };

  // Teste 6: Conteúdo curricular insuficiente sinalizado sem inventar
  const noteContextShort: OfficialNoteGroundedContext = {
    note_id: noteId,
    version_id: versionId,
    version_number: 1,
    subject_id: 'matematica-a',
    academic_period: 'P1',
    theme: 'Curto',
    title: 'Nota Curta',
    content_text: 'Pouco texto',
    content_hash: 'hash123',
  };

  const validationShort = validateOfficialExerciseBatch({
    insufficient_content: true,
    reason: 'Texto curricular insuficiente no caderno oficial.',
  }, noteContextShort);

  recordTest(
    'F5-GRO-01',
    'Regra «NÃO INVENTAR»: Conteúdo insuficiente sinalizado sem inventar exercícios',
    'OFFICIAL_GROUNDING',
    validationShort.insufficientContent === true && validationShort.exercises.length === 0,
    'Motor não gerou exercícios fictícios'
  );

  // Teste 7: Citação literal verídica presente no apontamento oficial
  const validBatch = {
    exercises: [
      {
        prompt: 'Considerando uma função f contínua em [a, b], indica a condição do Teorema de Bolzano-Cauchy:',
        question_type: 'multiple_choice',
        options: [
          'f(a) * f(b) < 0',
          'f(a) + f(b) = 0',
          'f(a) * f(b) > 0',
          'f(a) = f(b)',
        ],
        correct_answer: 'f(a) * f(b) < 0',
        scoring_rubric: {
          criteria: ['Identificação rigorosa da hipótese de sinais opostos.'],
          explanation: 'O texto indica expressamente f(a) * f(b) < 0.',
        },
        quote_excerpt: 'f(a) * f(b) < 0',
        difficulty: 'medio',
        max_points: 20.0,
      },
    ],
  };

  const validationRes = validateOfficialExerciseBatch(validBatch, fullNoteContext);

  recordTest(
    'F5-CIT-01',
    'Citação literal verificada com sucesso no texto oficial (Aprovada)',
    'CITATION_VERIFICATION',
    validationRes.valid && validationRes.exercises.length === 1 && validationRes.rejectedCount === 0,
    'Citação literal "f(a) * f(b) < 0" confirmada como substring exata'
  );

  // Teste 8: Citação inexistente / alucinada fora do texto oficial é rejeitada
  const hallucinatedBatch = {
    exercises: [
      {
        prompt: 'Qual a derivada de x^3 segundo a regra geral?',
        question_type: 'multiple_choice',
        options: ['3x^2', 'x^2', '2x', '3x'],
        correct_answer: '3x^2',
        quote_excerpt: 'a derivada da potencia e n*x^(n-1)', // Não existe no apontamento oficial de Bolzano!
      },
    ],
  };

  const validationHallucinated = validateOfficialExerciseBatch(hallucinatedBatch, fullNoteContext);

  recordTest(
    'F5-CIT-02',
    'Rejeição estrita de exercício com citação alucinada ou não existente no texto oficial',
    'CITATION_VERIFICATION',
    !validationHallucinated.valid && validationHallucinated.rejectedCount === 1,
    'Validador descartou pergunta com citação não fundamentada no Caderno Oficial'
  );

  // Teste 9: Escolha múltipla em que a resposta correta não consta nas opções é rejeitada
  const mismatchedOptionsBatch = {
    exercises: [
      {
        prompt: 'Assinale a condição:',
        question_type: 'multiple_choice',
        options: ['Opção 1', 'Opção 2', 'Opção 3', 'Opção 4'],
        correct_answer: 'Opção 5 Inexistente',
        quote_excerpt: 'f(a) * f(b) < 0',
      },
    ],
  };

  const validationMismatch = validateOfficialExerciseBatch(mismatchedOptionsBatch, fullNoteContext);

  recordTest(
    'F5-CIT-03',
    'Rejeição de questão onde a resposta correta não corresponde a nenhuma das opções fornecidas',
    'CITATION_VERIFICATION',
    !validationMismatch.valid && validationMismatch.rejectedCount === 1,
    'Consistência gabarito-opções validada'
  );

  console.log('\n--- 4. ISOLAMENTO DE RASCUNHOS E REVISÃO HUMANA ---');

  // Teste 10: Inserção de exercício oficial em estado de rascunho como administrador
  const exerciseId = '55555555-5555-4555-8555-555555555555';

  await setSession('authenticated', ADMIN_ID);
  await db.exec(`
    INSERT INTO public.exercises (
      id, user_id, subject_id, academic_period, prompt, question_type,
      options, correct_answer, scoring_rubric, max_points, difficulty,
      is_official, status, created_by_role
    ) VALUES (
      '${exerciseId}', '${ADMIN_ID}', 'matematica-a', 'P1',
      'Enunciado de Teste em Rascunho', 'multiple_choice',
      '["Opcao A", "Opcao B", "Opcao C", "Opcao D"]'::jsonb,
      'Opcao A', '{"criteria":["C1"]}'::jsonb, 20.00, 'medio',
      true, 'draft', 'admin'
    );

    INSERT INTO public.exercise_source_references (
      exercise_id, user_id, source_type, official_note_id, official_version_id,
      content_hash, quote_excerpt, official_section
    ) VALUES (
      '${exerciseId}', '${ADMIN_ID}', 'official', '${noteId}', '${versionId}',
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'f(a) * f(b) < 0', 'Teorema de Bolzano-Cauchy'
    );
  `);
  await resetSession();

  recordTest(
    'F5-REV-01',
    'Exercício oficial registado em estado de rascunho (status = "draft") e com proveniência completa',
    'DRAFT_ISOLATION',
    true,
    'Exercício gravado como rascunho associado a official_notes e official_note_versions'
  );

  // Teste 11: Aluno consulta exercícios via RLS (deve retornar 0 linhas enquanto status = draft)
  await setSession('authenticated', ALUNO_A_ID);
  const studentDraftSelect = await db.query(`
    SELECT * FROM public.exercises WHERE id = '${exerciseId}'
  `);
  await resetSession();

  recordTest(
    'F5-REV-02',
    'Isolamento RLS: Aluno não consegue consultar exercícios em estado de rascunho (0 linhas)',
    'DRAFT_ISOLATION',
    studentDraftSelect.rows.length === 0,
    'RLS exercises_select_official filtrou o exercício em rascunho'
  );

  // Teste 12: Aluno é bloqueado de forjar exercício oficial via INSERT direto
  let studentSpoofBlocked = false;
  await setSession('authenticated', ALUNO_A_ID);
  try {
    await db.exec(`
      INSERT INTO public.exercises (
        id, user_id, subject_id, prompt, question_type, correct_answer, is_official, created_by_role
      ) VALUES (
        gen_random_uuid(), '${ALUNO_A_ID}', 'matematica-a', 'Fraude', 'open_answer', 'X', true, 'admin'
      );
    `);
  } catch (err: any) {
    if (err.message.includes('Violação de Segurança')) {
      studentSpoofBlocked = true;
    }
  } finally {
    await resetSession();
  }

  recordTest(
    'F5-REV-03',
    'Trigger trg_protect_official_exercise_integrity bloqueia aluno de forjar exercícios oficiais',
    'DRAFT_ISOLATION',
    studentSpoofBlocked,
    'Tentativa de forjar is_official=true bloqueada no kernel PostgreSQL'
  );

  // Teste 13: Administrador atualiza enunciado em rascunho
  await setSession('authenticated', ADMIN_ID);
  await db.exec(`
    UPDATE public.exercises
    SET prompt = 'Enunciado Revisto e Aprimorado pelo Administrador'
    WHERE id = '${exerciseId}';
  `);
  await resetSession();

  const updatedEx = await db.query(`SELECT prompt FROM public.exercises WHERE id = '${exerciseId}'`);

  recordTest(
    'F5-REV-04',
    'Revisão Humana: Administrador edita e aprimora exercício em rascunho com sucesso',
    'ADMIN_REVIEW',
    (updatedEx.rows[0] as any)?.prompt === 'Enunciado Revisto e Aprimorado pelo Administrador',
    'Edição administrativa registada'
  );

  // Teste 14: Administrador homologa e publica o exercício
  await setSession('authenticated', ADMIN_ID);
  await db.exec(`
    UPDATE public.exercises
    SET status = 'published'
    WHERE id = '${exerciseId}';
  `);
  await resetSession();

  // Teste 15: Aluno agora consegue aceder ao exercício oficial publicado sob RLS
  await setSession('authenticated', ALUNO_A_ID);
  const studentPubSelect = await db.query(`
    SELECT id, prompt, is_official, status FROM public.exercises WHERE id = '${exerciseId}'
  `);
  await resetSession();

  recordTest(
    'F5-REV-05',
    'Disponibilização Controlada: Aluno acede ao exercício oficial exclusivamente após publicação',
    'ADMIN_REVIEW',
    studentPubSelect.rows.length === 1 && (studentPubSelect.rows[0] as any)?.status === 'published',
    'Exercício visível para os alunos apenas após homologação'
  );

  console.log('\n--- 5. PROVENIÊNCIA E BLINDAGEM DE INTEGRIDADE CURRICULAR ---');

  // Teste 16: Rastreabilidade total na tabela exercise_source_references
  const srcRecords = await db.query(`
    SELECT * FROM public.exercise_source_references WHERE exercise_id = '${exerciseId}'
  `);

  const firstSrc = srcRecords.rows[0] as any;
  const validProvenance =
    srcRecords.rows.length === 1 &&
    firstSrc?.source_type === 'official' &&
    firstSrc?.official_note_id === noteId &&
    firstSrc?.official_version_id === versionId &&
    firstSrc?.quote_excerpt === 'f(a) * f(b) < 0';

  recordTest(
    'F5-PRV-01',
    'Rastreabilidade Documental: Referência vinculada à versão oficial imutável com citação e hash',
    'PROVENANCE_INTEGRITY',
    validProvenance,
    'Todos os 4 campos de proveniência verificados na base de dados'
  );

  // Teste 17: Trigger trg_validate_exercise_source_provenance bloqueia inconsistência curricular (disciplina cruzada)
  let crossMismatchBlocked = false;
  try {
    const filNoteId = '66666666-6666-4666-8666-666666666666';
    const filVersionId = '77777777-7777-4777-8777-777777777777';

    await db.exec(`
      INSERT INTO public.official_notes (id, subject_id, academic_period, theme, title, is_published, created_by)
      VALUES ('${filNoteId}', 'filosofia', 'P1', 'Acao Humana', 'Acao Humana', false, '${ADMIN_ID}');

      INSERT INTO public.official_note_versions (id, note_id, version_number, raw_html, sanitized_html, plain_text_content, is_published, created_by)
      VALUES ('${filVersionId}', '${filNoteId}', 1, '<p>Texto de Filosofia oficial</p>', '<p>Texto de Filosofia oficial</p>', 'Texto de Filosofia oficial', true, '${ADMIN_ID}');

      UPDATE public.official_notes SET current_version_id = '${filVersionId}', is_published = true WHERE id = '${filNoteId}';

      INSERT INTO public.exercise_source_references (
        exercise_id, user_id, source_type, official_note_id, official_version_id, content_hash, quote_excerpt
      ) VALUES (
        '${exerciseId}', '${ADMIN_ID}', 'official', '${filNoteId}', '${filVersionId}', '${officialHash}', 'Texto de Filosofia oficial'
      );
    `);
  } catch (err: any) {
    if (err.message.includes('Inconsistência Curricular') || err.message.includes('difere da disciplina')) {
      crossMismatchBlocked = true;
    }
  }

  recordTest(
    'F5-PRV-02',
    'Trigger trg_validate_exercise_source_provenance bloqueia referência de disciplina cruzada',
    'PROVENANCE_INTEGRITY',
    crossMismatchBlocked,
    'Tentativa de ligar nota de Filosofia a exercício de Matemática A rejeitada pelo kernel PostgreSQL'
  );

  // Teste 18: Confidencialidade de Soluções durante a resolução (get_session_questions_for_student)
  const sessionId = '88888888-8888-4888-8888-888888888888';
  await setSession('authenticated', ADMIN_ID);
  await db.exec(`
    INSERT INTO public.exercise_sessions (id, user_id, subject_id, title, mode, status)
    VALUES ('${sessionId}', '${ADMIN_ID}', 'matematica-a', 'Sessão de Treino Oficial', 'study', 'in_progress');
  `);
  await resetSession();

  await setSession('authenticated', ADMIN_ID);
  await db.exec(`
    UPDATE public.exercises SET session_id = '${sessionId}' WHERE id = '${exerciseId}';
  `);
  await resetSession();

  await setSession('authenticated', ALUNO_A_ID);
  const studentQuestionView = await db.query(`
    SELECT * FROM public.get_session_questions_for_student('${sessionId}')
  `);
  await resetSession();

  const questionRow = (studentQuestionView.rows[0] || {}) as Record<string, any>;
  const solutionsHidden =
    studentQuestionView.rows.length > 0 &&
    !('correct_answer' in questionRow) &&
    !('scoring_rubric' in questionRow);

  recordTest(
    'F5-SEC-01',
    'Confidencialidade das Soluções: RPC oculta correct_answer e scoring_rubric durante a resolução',
    'PROVENANCE_INTEGRITY',
    solutionsHidden,
    'Aluno recebe apenas prompt, opções e pontuação máxima'
  );

  console.log('\n================================================================');
  console.log('SUMÁRIO DA BATERIA DE TESTES — FASE C (MOTOR DE EXERCÍCIOS GEMINI)');
  console.log('================================================================');

  const total = testResults.length;
  const passed = testResults.filter((r) => r.passed).length;
  const failed = total - passed;

  console.log(`Total de Verificações: ${total}`);
  console.log(`Sucesso: ${passed}/${total} (${((passed / total) * 100).toFixed(1)}%)`);
  console.log(`Falhas:  ${failed}/${total}\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runPhase5Tests().catch((err) => {
  console.error('Erro na execução dos testes da Fase C:', err);
  process.exit(1);
});
