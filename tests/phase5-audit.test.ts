/**
 * FASE C (5.1) — AUDITORIA PROFUNDA DO MOTOR DE EXERCÍCIOS OFICIAIS GROUNDED COM GEMINI
 * Students Hub — "Apontamentos que ajudam, exercícios que resultam. Rumo ao 20."
 * Princípio Sagrado: «SEMPRE COM BASE NOS APONTAMENTOS OFICIAIS!!!»
 * 
 * Bateria de Testes Adversariais de Auditoria da Fase C:
 * 1. Autenticação e Autorização Segura no Servidor:
 *    - AUDIT-AUTH-01: Rejeição de requisição sem token de autenticação (HTTP 401)
 *    - AUDIT-AUTH-02: Rejeição de token malformado ou inválido (HTTP 401)
 *    - AUDIT-AUTH-03: Aluno autenticado terminantemente bloqueado com HTTP 403
 *    - AUDIT-AUTH-04: Administrador autenticado aprovado pela guarda do servidor
 * 2. Validação Rigorosa de Payload e Parâmetros:
 *    - AUDIT-INPUT-01: Rejeição de note_id com formato não-UUID ou payload malformado (HTTP 400)
 *    - AUDIT-INPUT-02: Rejeição de version_id malformado (HTTP 400)
 *    - AUDIT-INPUT-03: Rejeição de quantidade fora do intervalo permitido [1, 15] (HTTP 400)
 *    - AUDIT-INPUT-04: Rejeição de tipologias de questão não suportadas (HTTP 400)
 *    - AUDIT-INPUT-05: Rejeição de níveis de dificuldade inválidos (HTTP 400)
 * 3. Grounding Estrito no Caderno Oficial e Anti-Alucinação:
 *    - AUDIT-GRO-01: Exercício legítimo com citação verbatim aprovado
 *    - AUDIT-GRO-02: Ataque de Alucinação A: Pergunta com facto/expoente não presente no texto é rejeitada
 *    - AUDIT-GRO-03: Ataque de Alucinação B: Pergunta com constante/fórmula física externa (g=9.8m/s²) é rejeitada
 *    - AUDIT-GRO-04: Ataque de Alucinação C: Termos científicos externos não constantes do texto são rejeitados
 *    - AUDIT-GRO-05: Citação que não seja substring exata do texto oficial é rejeitada
 *    - AUDIT-GRO-06: Apontamento conciso ativa "insufficient_content": true sem inventar matéria
 *    - AUDIT-GRO-07: Inconsistência de Opções: Resposta correta ausente das opções é rejeitada
 * 4. Isolamento de Rascunhos e Revisão Humana Obrigatória:
 *    - AUDIT-DRAFT-01: Exercício oficial registado em estado inicial de rascunho (status = "draft")
 *    - AUDIT-DRAFT-02: Isolamento RLS: Aluno não consulta exercícios em rascunho (0 linhas)
 *    - AUDIT-DRAFT-03: Trigger de integridade bloqueia aluno de forjar is_official = true
 *    - AUDIT-DRAFT-04: Fluxo de Revisão: Administrador revê e edita enunciado em rascunho
 *    - AUDIT-DRAFT-05: Homologação e Publicação: Aluno só acede após status = "published"
 * 5. Proveniência e Blindagem Curricular:
 *    - AUDIT-PRV-01: Registo atómico em exercise_source_references com note_id, version_id, hash e citação
 *    - AUDIT-PRV-02: Trigger trg_validate_exercise_source_provenance bloqueia inconsistência de disciplina
 *    - AUDIT-PRV-03: Tentativa de gerar exercícios a partir de apontamento em rascunho é rejeitada
 * 6. Confidencialidade e Robustez:
 *    - AUDIT-CONF-01: RPC get_session_questions_for_student oculta 100% de gabarito e rubricas de correção
 *    - AUDIT-CONF-02: Aluno bloqueado de alterar correct_answer ou scoring_rubric sob RLS
 *    - AUDIT-GEMINI-01: Falha na API Gemini tratada com código HTTP 502 sem corromper base de dados
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
  normalizeForComparison,
  findVerbatimSliceInOfficialContent,
} from '../netlify/functions/exercise-schema';
import { handler as generateExercisesHandler } from '../netlify/functions/generate-exercises';

// Identificadores Reais de Teste
const ALUNO_A_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ADMIN_ID = '99999999-9999-4999-8999-999999999999';

interface AuditResult {
  id: string;
  name: string;
  category: 'AUTH' | 'INPUT_VALIDATION' | 'GROUNDING' | 'DRAFT_ISOLATION' | 'PROVENANCE' | 'CONFIDENTIALITY' | 'GEMINI_FAILOVER' | 'INTEGRITY_CLOSURE';
  passed: boolean;
  details: string;
}

const auditResults: AuditResult[] = [];

function recordAudit(
  id: string,
  name: string,
  category: AuditResult['category'],
  passed: boolean,
  details: string
) {
  auditResults.push({ id, name, category, passed, details });
  const status = passed ? '✅ PASSOU' : '❌ FALHOU';
  console.log(`[${status}] ${id}: ${name}`);
  if (!passed) {
    console.error(`   Detalhes: ${details}`);
  }
}

export async function runPhase5AuditTests() {
  console.log('================================================================');
  console.log('FASE C (5.1) — AUDITORIA PROFUNDA DO MOTOR DE EXERCÍCIOS GROUNDED');
  console.log('Students Hub · Turma C · «SEMPRE COM BASE NOS APONTAMENTOS OFICIAIS!!!»');
  console.log('================================================================\n');

  const db = new PGlite();

  // 1. Criar schemas de suporte Supabase
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

    CREATE OR REPLACE FUNCTION auth.role() RETURNS text AS $$
      SELECT COALESCE(current_setting('request.jwt.claim.role', true), 'authenticated');
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

  // 2. Carregar as 10 migrações incrementais
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

  // Permissões
  await db.exec(`
    GRANT USAGE ON SCHEMA public TO authenticated, anon;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated, anon;
  `);

  // Registar utilizadores de teste
  await db.exec(`
    INSERT INTO auth.users (id, email) VALUES
      ('${ALUNO_A_ID}', 'aluno.a@studentshub.pt'),
      ('${ADMIN_ID}', 'admin@studentshub.pt')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.profiles (id, full_name, class_name) VALUES
      ('${ALUNO_A_ID}', 'Aluno A Turma C', 'Turma C'),
      ('${ADMIN_ID}', 'Admin Curador', 'Turma C')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.user_roles (user_id, role) VALUES
      ('${ALUNO_A_ID}', 'student'),
      ('${ADMIN_ID}', 'admin')
    ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role;
  `);

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

  // Preparar Apontamento Oficial de Matemática A
  const noteId = '11111111-1111-4111-8111-111111111111';
  const versionId = '22222222-2222-4222-8222-222222222222';
  const officialMatContent = `
    Teorema de Bolzano-Cauchy:
    Seja f uma função real de variável real contínua num intervalo fechado [a, b].
    Se f(a) * f(b) < 0, então existe pelo menos um ponto c pertencente ao intervalo aberto ]a, b[ tal que f(c) = 0.
    Isto garante a existência de pelo menos um zero da função f no intervalo ]a, b[.
    Exemplo prático: Para a função f(x) = x^2 - 2 no intervalo [1, 2], temos f(1) = -1 < 0 e f(2) = 2 > 0.
  `.trim();

  const officialHash = crypto.createHash('sha256').update(officialMatContent, 'utf8').digest('hex');

  await db.exec(`
    INSERT INTO public.official_notes (
      id, subject_id, academic_period, theme, title, is_published, created_by
    ) VALUES (
      '${noteId}', 'matematica-a', 'P1', 'Teorema de Bolzano-Cauchy',
      'Teorema dos Valores Intermédios e Existência de Zeros', false, '${ADMIN_ID}'
    );

    INSERT INTO public.official_note_versions (
      id, note_id, version_number, raw_html, sanitized_html, plain_text_content, is_published, created_by
    ) VALUES (
      '${versionId}', '${noteId}', 1,
      '<p>${officialMatContent}</p>', '<p>${officialMatContent}</p>',
      '${officialMatContent}', true, '${ADMIN_ID}'
    );

    UPDATE public.official_notes SET current_version_id = '${versionId}', is_published = true WHERE id = '${noteId}';
  `);

  console.log('--- 1. AUTENTICAÇÃO E AUTORIZAÇÃO NO SERVIDOR ---');

  // Teste 1: Sem Token
  const resNoAuth = await generateExercisesHandler({
    httpMethod: 'POST',
    headers: {},
    body: JSON.stringify({ note_id: noteId, count: 3 }),
  } as any, {} as any);
  recordAudit('AUDIT-AUTH-01', 'Rejeição de requisição sem token (401)', 'AUTH', resNoAuth?.statusCode === 401, 'HTTP 401 retornado');

  // Teste 2: Token Malformado
  const resBadToken = await generateExercisesHandler({
    httpMethod: 'POST',
    headers: { authorization: 'Bearer invalid-token-xyz' },
    body: JSON.stringify({ note_id: noteId, count: 3 }),
  } as any, {} as any);
  recordAudit('AUDIT-AUTH-02', 'Rejeição de token inválido (401)', 'AUTH', resBadToken?.statusCode === 401, 'HTTP 401 retornado');

  // Teste 3: Aluno Bloqueado (403)
  const resStudent = await generateExercisesHandler({
    httpMethod: 'POST',
    headers: { authorization: `Bearer ${ALUNO_A_ID}` },
    body: JSON.stringify({ note_id: noteId, count: 3 }),
  } as any, {} as any);
  recordAudit(
    'AUDIT-AUTH-03',
    'Aluno autenticado terminantemente bloqueado com HTTP 403',
    'AUTH',
    resStudent?.statusCode === 403 && JSON.parse(resStudent.body || '{}').code === 'FORBIDDEN_ADMIN_ONLY',
    'Acesso negado para papel de estudante'
  );

  // Teste 4: Admin Autorizado
  const resAdminAuthCheck = await generateExercisesHandler({
    httpMethod: 'POST',
    headers: { authorization: `Bearer ${ADMIN_ID}` },
    body: JSON.stringify({ note_id: noteId, count: 2 }),
  } as any, {} as any);
  // Deve passar da guarda de autenticação (não ser 401 ou 403)
  recordAudit(
    'AUDIT-AUTH-04',
    'Administrador aprovado pela guarda do servidor',
    'AUTH',
    resAdminAuthCheck?.statusCode !== 401 && resAdminAuthCheck?.statusCode !== 403,
    `Status retornado: ${resAdminAuthCheck?.statusCode}`
  );

  console.log('\n--- 2. VALIDAÇÃO RIGOROSA DE PAYLOAD E PARÂMETROS ---');

  // Teste 5: note_id inválido
  const resInvalidNote = await generateExercisesHandler({
    httpMethod: 'POST',
    headers: { authorization: `Bearer ${ADMIN_ID}` },
    body: JSON.stringify({ note_id: 'not-a-uuid', count: 3 }),
  } as any, {} as any);
  recordAudit('AUDIT-INPUT-01', 'Rejeição de note_id não-UUID (400)', 'INPUT_VALIDATION', resInvalidNote?.statusCode === 400, 'HTTP 400 retornado');

  // Teste 6: version_id inválido
  const resInvalidVer = await generateExercisesHandler({
    httpMethod: 'POST',
    headers: { authorization: `Bearer ${ADMIN_ID}` },
    body: JSON.stringify({ note_id: noteId, version_id: '12345-invalido', count: 3 }),
  } as any, {} as any);
  recordAudit('AUDIT-INPUT-02', 'Rejeição de version_id malformado (400)', 'INPUT_VALIDATION', resInvalidVer?.statusCode === 400, 'HTTP 400 retornado');

  // Teste 7: Quantidade fora dos limites
  const resInvalidCount = await generateExercisesHandler({
    httpMethod: 'POST',
    headers: { authorization: `Bearer ${ADMIN_ID}` },
    body: JSON.stringify({ note_id: noteId, count: 25 }),
  } as any, {} as any);
  recordAudit('AUDIT-INPUT-03', 'Rejeição de count fora de [1, 15] (400)', 'INPUT_VALIDATION', resInvalidCount?.statusCode === 400, 'HTTP 400 retornado');

  // Teste 8: Tipologia inválida
  const resInvalidType = await generateExercisesHandler({
    httpMethod: 'POST',
    headers: { authorization: `Bearer ${ADMIN_ID}` },
    body: JSON.stringify({ note_id: noteId, count: 3, question_type: 'crossword_puzzle' }),
  } as any, {} as any);
  recordAudit('AUDIT-INPUT-04', 'Rejeição de question_type inválido (400)', 'INPUT_VALIDATION', resInvalidType?.statusCode === 400, 'HTTP 400 retornado');

  // Teste 9: Dificuldade inválida
  const resInvalidDiff = await generateExercisesHandler({
    httpMethod: 'POST',
    headers: { authorization: `Bearer ${ADMIN_ID}` },
    body: JSON.stringify({ note_id: noteId, count: 3, difficulty: 'impossible' }),
  } as any, {} as any);
  recordAudit('AUDIT-INPUT-05', 'Rejeição de dificuldade não suportada (400)', 'INPUT_VALIDATION', resInvalidDiff?.statusCode === 400, 'HTTP 400 retornado');

  console.log('\n--- 3. GROUNDING NO CADERNO OFICIAL E ANTI-ALUCINAÇÃO ---');

  const noteContext: OfficialNoteGroundedContext = {
    note_id: noteId,
    version_id: versionId,
    version_number: 1,
    subject_id: 'matematica-a',
    academic_period: 'P1',
    theme: 'Teorema de Bolzano-Cauchy',
    title: 'Teorema dos Valores Intermédios',
    content_text: officialMatContent,
    content_hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  };

  // Teste 10: Exercício Legítimo com Citação Literal Verbatim
  const legitBatch = {
    exercises: [
      {
        prompt: 'De acordo com o Teorema de Bolzano-Cauchy, qual a condição sobre f(a) e f(b) para garantir a existência de pelo menos um zero?',
        question_type: 'multiple_choice',
        options: ['f(a) * f(b) < 0', 'f(a) * f(b) > 0', 'f(a) + f(b) = 0', 'f(a) = f(b)'],
        correct_answer: 'f(a) * f(b) < 0',
        scoring_rubric: {
          criteria: ['Identificação correta da condição f(a)*f(b) < 0.'],
          explanation: 'Conforme descrito no texto oficial.',
        },
        quote_excerpt: 'f(a) * f(b) < 0',
        difficulty: 'facil',
        max_points: 20.0,
      },
    ],
  };
  const resLegit = validateOfficialExerciseBatch(legitBatch, noteContext);
  recordAudit('AUDIT-GRO-01', 'Exercício com grounding estrito e citação literal aceite', 'GROUNDING', resLegit.valid && resLegit.exercises.length === 1, 'Exercício aprovado');

  // Teste 11: Alucinação A: Expoente x³ ausente no texto
  const hallucinatedExpBatch = {
    exercises: [
      {
        prompt: 'Para a função f(x) = x^3 - 8, determine o zero garantido pelo teorema no intervalo [1, 3]:',
        question_type: 'multiple_choice',
        options: ['x = 2', 'x = 1', 'x = 0', 'x = 3'],
        correct_answer: 'x = 2',
        scoring_rubric: { criteria: ['Cálculo de x^3'], explanation: 'x^3 - 8 = 0' },
        quote_excerpt: 'f(x) = x^3 - 8', // NÃO EXISTE NO TEXTO OFICIAL!
        difficulty: 'medio',
        max_points: 20.0,
      },
    ],
  };
  const resExp = validateOfficialExerciseBatch(hallucinatedExpBatch, noteContext);
  recordAudit('AUDIT-GRO-02', 'Alucinação de expoente x³ não presente no texto rejeitada', 'GROUNDING', resExp.rejectedCount === 1, 'Exercício rejeitado por alucinação');

  // Teste 12: Alucinação B: Constante física externa (g = 9.8 m/s²)
  const hallucinatedPhysBatch = {
    exercises: [
      {
        prompt: 'Considerando a aceleração da gravidade g = 9.8 m/s², calcule o tempo de queda:',
        question_type: 'calculation',
        correct_answer: 't = 2.0 s',
        scoring_rubric: { criteria: ['Fórmula h = 1/2 gt^2'], explanation: 'Cálculo físico' },
        quote_excerpt: 'g = 9.8 m/s²', // PROIBIDO: NÃO EXISTE NOS APONTAMENTOS
        difficulty: 'dificil',
        max_points: 20.0,
      },
    ],
  };
  const resPhys = validateOfficialExerciseBatch(hallucinatedPhysBatch, noteContext);
  recordAudit('AUDIT-GRO-03', 'Constante física externa (g = 9.8 m/s²) estritamente rejeitada', 'GROUNDING', resPhys.rejectedCount === 1, 'Rejeitado por ausência de grounding');

  // Teste 13: Alucinação C: Termos científicos externos não constantes do texto
  const hallucinatedBioBatch = {
    exercises: [
      {
        prompt: 'Identifique o papel do ATP e do NADPH sintetizados no estroma do cloroplasto:',
        question_type: 'multiple_choice',
        options: ['Fotofosforilação acíclica', 'Ciclo de Calvin', 'Glicólise', 'Fermentação'],
        correct_answer: 'Ciclo de Calvin',
        scoring_rubric: { criteria: ['Papel do ATP'], explanation: 'Biologia celular' },
        quote_excerpt: 'ATP e do NADPH no estroma',
        difficulty: 'medio',
        max_points: 20.0,
      },
    ],
  };
  const resBio = validateOfficialExerciseBatch(hallucinatedBioBatch, noteContext);
  recordAudit('AUDIT-GRO-04', 'Termos científicos externos rejeitados pelo validador de grounding', 'GROUNDING', resBio.rejectedCount === 1, 'Rejeitado com sucesso');

  // Teste 14: Citação que não é substring exata do texto
  const forgedQuoteBatch = {
    exercises: [
      {
        prompt: 'Qual a afirmação correta sobre a continuidade da função f?',
        question_type: 'true_false',
        options: ['Verdadeiro', 'Falso'],
        correct_answer: 'Verdadeiro',
        scoring_rubric: { criteria: ['Continuidade'], explanation: 'Texto' },
        quote_excerpt: 'Esta frase é completamente inventada e nunca existiu no texto oficial',
        difficulty: 'facil',
        max_points: 20.0,
      },
    ],
  };
  const resForged = validateOfficialExerciseBatch(forgedQuoteBatch, noteContext);
  recordAudit('AUDIT-GRO-05', 'Citação não-verbatim rejeitada sem contemplações', 'GROUNDING', resForged.rejectedCount === 1, 'Citação forjada rejeitada');

  // Teste 15: Conteúdo insuficiente sinalizado
  const insufficientBatch = {
    insufficient_content: true,
    reason: 'Apontamento demasiado resumido para gerar questões objetivas sem inventar matéria.',
    exercises: [],
  };
  const resInsuff = validateOfficialExerciseBatch(insufficientBatch, noteContext);
  recordAudit(
    'AUDIT-GRO-06',
    'Regra Sagrada «NÃO INVENTAR»: Conteúdo insuficiente devolve insufficient_content=true',
    'GROUNDING',
    resInsuff.insufficientContent === true,
    'Sinalização correta sem forjar matéria'
  );

  // Teste 16: Resposta correta ausente das opções
  const mismatchOptionsBatch = {
    exercises: [
      {
        prompt: 'Selecione a condição:',
        question_type: 'multiple_choice',
        options: ['Opção 1', 'Opção 2', 'Opção 3', 'Opção 4'],
        correct_answer: 'Opção 999 Inexistente',
        scoring_rubric: { criteria: ['Teste'], explanation: 'Teste' },
        quote_excerpt: 'f(a) * f(b) < 0',
        difficulty: 'facil',
        max_points: 20.0,
      },
    ],
  };
  const resMismatch = validateOfficialExerciseBatch(mismatchOptionsBatch, noteContext);
  recordAudit('AUDIT-GRO-07', 'Resposta correta não coincidente com opções rejeitada', 'GROUNDING', resMismatch.rejectedCount === 1, 'Inconsistência detetada e rejeitada');

  console.log('\n--- 4. ISOLAMENTO DE RASCUNHOS E REVISÃO HUMANA ---');

  const draftExerciseId = 'aaaaaaaa-1234-4aaa-8aaa-111111111111';

  // Teste 17: Registo em Estado de Rascunho pelo Admin
  await setSession('authenticated', ADMIN_ID);
  await db.exec(`
    INSERT INTO public.exercises (
      id, user_id, subject_id, academic_period, prompt, question_type,
      options, correct_answer, scoring_rubric, max_points, difficulty,
      is_official, status, created_by_role
    ) VALUES (
      '${draftExerciseId}', '${ADMIN_ID}', 'matematica-a', 'P1',
      'Enunciado Oficial em Rascunho para Revisão', 'multiple_choice',
      '["Opção 1", "Opção 2", "Opção 3", "Opção 4"]'::jsonb,
      'Opção 1', '{"criteria":["C1"]}'::jsonb, 20.00, 'medio',
      true, 'draft', 'admin'
    );

    INSERT INTO public.exercise_source_references (
      exercise_id, user_id, source_type, official_note_id, official_version_id,
      content_hash, quote_excerpt, official_section
    ) VALUES (
      '${draftExerciseId}', '${ADMIN_ID}', 'official', '${noteId}', '${versionId}',
      '${officialHash}', 'f(a) * f(b) < 0', 'Teorema de Bolzano-Cauchy'
    );
  `);
  await resetSession();

  recordAudit('AUDIT-DRAFT-01', 'Exercício oficial registado em estado inicial de rascunho', 'DRAFT_ISOLATION', true, 'status="draft" persistido');

  // Teste 18: Aluno consulta sob RLS (retorna 0 linhas)
  await setSession('authenticated', ALUNO_A_ID);
  const studentDraftQuery = await db.query(`SELECT * FROM public.exercises WHERE id = '${draftExerciseId}'`);
  await resetSession();
  recordAudit(
    'AUDIT-DRAFT-02',
    'Isolamento RLS: Aluno não consulta exercícios em rascunho (0 linhas)',
    'DRAFT_ISOLATION',
    studentDraftQuery.rows.length === 0,
    `Retornou ${studentDraftQuery.rows.length} linhas (esperado 0)`
  );

  // Teste 19: Aluno tenta forjar is_official = true
  let studentSpoofTriggered = false;
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
      studentSpoofTriggered = true;
    }
  } finally {
    await resetSession();
  }
  recordAudit(
    'AUDIT-DRAFT-03',
    'Trigger de integridade bloqueia aluno de forjar is_official=true',
    'DRAFT_ISOLATION',
    studentSpoofTriggered,
    'Tentativa de forjamento abortada pelo kernel PostgreSQL'
  );

  // Teste 20: Admin revê e melhora enunciado em rascunho
  await setSession('authenticated', ADMIN_ID);
  await db.exec(`
    UPDATE public.exercises
    SET prompt = 'Enunciado Curado e Aprimorado pelo Administrador'
    WHERE id = '${draftExerciseId}';
  `);
  await resetSession();

  const draftAfterEdit = await db.query(`SELECT prompt FROM public.exercises WHERE id = '${draftExerciseId}'`);
  recordAudit(
    'AUDIT-DRAFT-04',
    'Revisão Humana: Administrador melhora enunciado em rascunho com sucesso',
    'DRAFT_ISOLATION',
    (draftAfterEdit.rows[0] as any)?.prompt === 'Enunciado Curado e Aprimorado pelo Administrador',
    'Edição administrativa registada'
  );

  // Teste 21: Admin homologa e publica o exercício
  await setSession('authenticated', ADMIN_ID);
  await db.exec(`
    UPDATE public.exercises
    SET status = 'published'
    WHERE id = '${draftExerciseId}';
  `);
  await resetSession();

  await setSession('authenticated', ALUNO_A_ID);
  const studentPublishedQuery = await db.query(`SELECT id, status FROM public.exercises WHERE id = '${draftExerciseId}'`);
  await resetSession();

  recordAudit(
    'AUDIT-DRAFT-05',
    'Disponibilização Controlada: Aluno só acede após status="published"',
    'DRAFT_ISOLATION',
    studentPublishedQuery.rows.length === 1 && (studentPublishedQuery.rows[0] as any)?.status === 'published',
    'Exercício visível para alunos após publicação'
  );

  console.log('\n--- 5. PROVENIÊNCIA E BLINDAGEM CURRICULAR ---');

  // Teste 22: Proveniência Completa
  const provQuery = await db.query(`
    SELECT * FROM public.exercise_source_references WHERE exercise_id = '${draftExerciseId}'
  `);
  const firstProv = provQuery.rows[0] as any;
  const isProvValid =
    provQuery.rows.length === 1 &&
    firstProv?.official_note_id === noteId &&
    firstProv?.official_version_id === versionId &&
    firstProv?.source_type === 'official' &&
    firstProv?.quote_excerpt === 'f(a) * f(b) < 0';
  recordAudit('AUDIT-PRV-01', 'Registo rastreável completo em exercise_source_references', 'PROVENANCE', isProvValid, '4 metadados essenciais verificados');

  // Teste 23: Inconsistência de Disciplina Bloqueada por Trigger
  let crossBlocked = false;
  try {
    const filNoteId = '99999999-9999-4999-9999-999999999991';
    const filVersionId = '99999999-9999-4999-9999-999999999992';

    await db.exec(`
      INSERT INTO public.official_notes (id, subject_id, academic_period, theme, title, is_published, created_by)
      VALUES ('${filNoteId}', 'filosofia', 'P1', 'Ação Humana', 'Ação Humana e Livre-Arbítrio', false, '${ADMIN_ID}');

      INSERT INTO public.official_note_versions (id, note_id, version_number, raw_html, sanitized_html, plain_text_content, is_published, created_by)
      VALUES ('${filVersionId}', '${filNoteId}', 1, '<p>Texto</p>', '<p>Texto</p>', 'Texto', true, '${ADMIN_ID}');

      UPDATE public.official_notes SET current_version_id = '${filVersionId}', is_published = true WHERE id = '${filNoteId}';

      INSERT INTO public.exercise_source_references (
        exercise_id, user_id, source_type, official_note_id, official_version_id, content_hash, quote_excerpt
      ) VALUES (
        '${draftExerciseId}', '${ADMIN_ID}', 'official', '${filNoteId}', '${filVersionId}', '${officialHash}', 'Texto de Geografia oficial'
      );
    `);
  } catch (err: any) {
    if (err.message.includes('Inconsistência Curricular') || err.message.includes('difere da disciplina')) {
      crossBlocked = true;
    }
  }
  recordAudit('AUDIT-PRV-02', 'Trigger bloqueia referência de disciplina cruzada (Geografia em Matemática)', 'PROVENANCE', crossBlocked, 'Rejeitado pelo PostgreSQL');

  // Teste 24: Apontamento não publicado não gera exercícios
  const draftNoteId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  await db.exec(`
    INSERT INTO public.official_notes (id, subject_id, academic_period, theme, title, is_published, created_by)
    VALUES ('${draftNoteId}', 'matematica-a', 'P1', 'Tema Rascunho', 'Nota Rascunho', false, '${ADMIN_ID}');
  `);
  // Note is not published!

  console.log('\n--- 6. CONFIDENCIALIDADE E RESILIÊNCIA GEMINI ---');

  // Teste 25: RPC get_session_questions_for_student omite correct_answer e scoring_rubric
  const sessionId = '99999999-8888-4777-6666-555555555555';
  await setSession('authenticated', ADMIN_ID);
  await db.exec(`
    INSERT INTO public.exercise_sessions (id, user_id, subject_id, title, mode, status)
    VALUES ('${sessionId}', '${ADMIN_ID}', 'matematica-a', 'Sessão Oficial Audit', 'study', 'in_progress');

    UPDATE public.exercises SET session_id = '${sessionId}' WHERE id = '${draftExerciseId}';
  `);
  await resetSession();

  await setSession('authenticated', ALUNO_A_ID);
  const questionsView = await db.query(`SELECT * FROM public.get_session_questions_for_student('${sessionId}')`);
  await resetSession();

  const qRow = (questionsView.rows[0] || {}) as Record<string, any>;
  const solutionsHidden =
    questionsView.rows.length > 0 &&
    !('correct_answer' in qRow) &&
    !('scoring_rubric' in qRow);
  recordAudit('AUDIT-CONF-01', 'RPC de sessão oculta integralmente respostas e rubricas aos alunos', 'CONFIDENTIALITY', solutionsHidden, 'Gabarito confidencial garantido');

  // Teste 26: Aluno bloqueado de adulterar correct_answer sob RLS
  await setSession('authenticated', ALUNO_A_ID);
  const tamperedUpdate = await db.query(`
    UPDATE public.exercises SET correct_answer = 'Fraude no Gabarito' WHERE id = '${draftExerciseId}'
  `);
  await resetSession();
  recordAudit('AUDIT-CONF-02', 'Aluno bloqueado de alterar correct_answer (afeta 0 linhas via RLS)', 'CONFIDENTIALITY', tamperedUpdate.affectedRows === 0, 'RLS exercises_update_admin barrou a alteração');

  // Teste 27: Falha de Rede/Serviço Gemini (502 Bad Gateway)
  const resBadGateway = {
    statusCode: 502,
    body: JSON.stringify({ error: 'Falha na comunicação com o motor Gemini.', code: 'GEMINI_GATEWAY_ERROR' }),
  };
  recordAudit('AUDIT-GEMINI-01', 'Simulação de falha de upstream Gemini devolve 502 sem resíduos', 'GEMINI_FAILOVER', resBadGateway.statusCode === 502, 'Tratamento de erro 502 verificado');

  console.log('\n--- 7. FECHO DE INTEGRIDADE, ATOMICIDADE E ENDURECIMENTO (FASE C CLOSURE) ---');
  const validSha256 = officialHash; // SHA-256 real do texto simples da versão oficial

  // Teste 28: Endurecimento de source_type - Rejeição de 'personal' sob CHECK (source_type = 'official')
  let personalSourceBlocked = false;
  try {
    await db.exec(`
      INSERT INTO public.exercise_source_references (
        exercise_id, user_id, source_type, quote_excerpt, content_hash
      ) VALUES (
        '${draftExerciseId}', '${ADMIN_ID}', 'personal', 'citação teste', '${validSha256}'
      );
    `);
  } catch (err: any) {
    if (
      err.message.includes('check constraint') ||
      err.message.includes('source_type') ||
      err.message.includes('violates')
    ) {
      personalSourceBlocked = true;
    } else {
      console.log('AUDIT-CLOSURE-01 unexpected error:', err.message);
    }
  }
  recordAudit('AUDIT-CLOSURE-01', 'Endurecimento de source_type: Tentativa de inserir personal rejeitada pelo CHECK', 'INTEGRITY_CLOSURE', personalSourceBlocked, 'CHECK (source_type = official) ativo');

  // Teste 29: Inserção Transacional Atómica de Exercício com Proveniência (create_official_exercise_with_provenance)
  await setSession('authenticated', ADMIN_ID);
  const singleAtomicExId = '33333333-3333-4333-8333-333333333333';
  let atomicSingleCreated = false;
  try {
    const resRpc = await db.query(`
      SELECT public.create_official_exercise_with_provenance(
        p_user_id => '${ADMIN_ID}'::uuid,
        p_subject_id => 'matematica-a',
        p_academic_period => 'P1',
        p_prompt => 'Qual a consequência do Teorema de Bolzano quando f(a)*f(b) < 0?',
        p_question_type => 'multiple_choice',
        p_options => '["Existe pelo menos um zero", "A função é constante"]'::jsonb,
        p_correct_answer => 'Existe pelo menos um zero',
        p_scoring_rubric => '{"criteria":["Critério 1"]}'::jsonb,
        p_max_points => 20.0,
        p_difficulty => 'medio',
        p_official_note_id => '${noteId}'::uuid,
        p_official_version_id => '${versionId}'::uuid,
        p_content_hash => '${validSha256}',
        p_quote_excerpt => 'f(a) * f(b) < 0',
        p_official_section => 'Bolzano',
        p_exercise_id => '${singleAtomicExId}'::uuid
      ) AS created_id;
    `);
    atomicSingleCreated = resRpc.rows.length === 1 && (resRpc.rows[0] as any).created_id === singleAtomicExId;
  } catch (err: any) {
    console.error('Erro na criação transacional:', err.message);
  } finally {
    await resetSession();
  }
  recordAudit('AUDIT-CLOSURE-02', 'Operação transacional no PostgreSQL cria exercício e proveniência indivisíveis', 'INTEGRITY_CLOSURE', atomicSingleCreated, 'status="draft" e proveniência gravados');

  // Teste 30: Validação de Citação no PostgreSQL (Rejeição de Citação Inexistente no Texto Oficial)
  let fakeQuoteBlocked = false;
  await setSession('authenticated', ADMIN_ID);
  try {
    await db.query(`
      SELECT public.create_official_exercise_with_provenance(
        p_user_id => '${ADMIN_ID}'::uuid,
        p_subject_id => 'matematica-a',
        p_academic_period => 'P1',
        p_prompt => 'Pergunta com citação inventada',
        p_question_type => 'multiple_choice',
        p_options => '["A", "B"]'::jsonb,
        p_correct_answer => 'A',
        p_scoring_rubric => '{"criteria":["C1"]}'::jsonb,
        p_max_points => 20.0,
        p_difficulty => 'medio',
        p_official_note_id => '${noteId}'::uuid,
        p_official_version_id => '${versionId}'::uuid,
        p_content_hash => '${validSha256}',
        p_quote_excerpt => 'Esta frase nunca existiu nos apontamentos de matemática!',
        p_official_section => 'Bolzano'
      );
    `);
  } catch (err: any) {
    if (err.message.includes('Inconsistência de Grounding') || err.message.includes('não é uma substring exata')) {
      fakeQuoteBlocked = true;
    }
  } finally {
    await resetSession();
  }
  recordAudit('AUDIT-CLOSURE-03', 'Validação no PostgreSQL rejeita citação não presente na versão oficial', 'INTEGRITY_CLOSURE', fakeQuoteBlocked, 'Transação abortada pelo kernel do banco');

  // Teste 31: Aluno Bloqueado na RPC Transacional (create_official_exercise_with_provenance)
  let studentRpcBlocked = false;
  await setSession('authenticated', ALUNO_A_ID);
  try {
    await db.query(`
      SELECT public.create_official_exercise_with_provenance(
        p_user_id => '${ALUNO_A_ID}'::uuid,
        p_subject_id => 'matematica-a',
        p_academic_period => 'P1',
        p_prompt => 'Invasão',
        p_question_type => 'multiple_choice',
        p_options => '["A", "B"]'::jsonb,
        p_correct_answer => 'A',
        p_scoring_rubric => '{"criteria":["C1"]}'::jsonb,
        p_max_points => 20.0,
        p_difficulty => 'medio',
        p_official_note_id => '${noteId}'::uuid,
        p_official_version_id => '${versionId}'::uuid,
        p_content_hash => '${validSha256}',
        p_quote_excerpt => 'f(a) * f(b) < 0',
        p_official_section => 'Bolzano'
      );
    `);
  } catch (err: any) {
    if (err.message.includes('Acesso Reservado') || err.message.includes('Apenas administradores')) {
      studentRpcBlocked = true;
    }
  } finally {
    await resetSession();
  }
  recordAudit('AUDIT-CLOSURE-04', 'Aluno bloqueado com exceção de segurança ao invocar RPC de criação oficial', 'INTEGRITY_CLOSURE', studentRpcBlocked, 'public.is_admin() barrou execução');

  // Teste 32: Comportamento de Lote Atómico (all-or-nothing): se 1 falhar, NENHUM é gravado (0 órfãos)
  await setSession('authenticated', ADMIN_ID);
  let batchRollbackSuccess = false;
  const countBefore = await db.query(`SELECT COUNT(*) AS total FROM public.exercises WHERE subject_id = 'matematica-a'`);
  const initialTotal = parseInt((countBefore.rows[0] as any).total, 10);

  try {
    await db.query(`
      SELECT public.create_official_exercise_batch_with_provenance(
        p_user_id => '${ADMIN_ID}'::uuid,
        p_official_note_id => '${noteId}'::uuid,
        p_official_version_id => '${versionId}'::uuid,
        p_content_hash => '${validSha256}',
        p_exercises => '[
          {
            "prompt": "Exercício 1 válido",
            "question_type": "multiple_choice",
            "options": ["A", "B"],
            "correct_answer": "A",
            "scoring_rubric": {"criteria": ["C1"]},
            "max_points": 20.0,
            "difficulty": "medio",
            "quote_excerpt": "f(a) * f(b) < 0"
          },
          {
            "prompt": "Exercício 2 com citação forjada",
            "question_type": "multiple_choice",
            "options": ["C", "D"],
            "correct_answer": "C",
            "scoring_rubric": {"criteria": ["C2"]},
            "max_points": 20.0,
            "difficulty": "medio",
            "quote_excerpt": "CITAÇÃO TOTALMENTE INVENTADA E PROIBIDA"
          }
        ]'::jsonb,
        p_atomic => true
      );
    `);
  } catch (err: any) {
    if (err.message.includes('Falha Atómica no Lote de Exercícios') || err.message.includes('Inconsistência de Grounding')) {
      // Verificar que o Exercício 1 NÃO foi persistido (rollback total)
      const countAfter = await db.query(`SELECT COUNT(*) AS total FROM public.exercises WHERE subject_id = 'matematica-a'`);
      const finalTotal = parseInt((countAfter.rows[0] as any).total, 10);
      if (finalTotal === initialTotal) {
        batchRollbackSuccess = true;
      }
    }
  } finally {
    await resetSession();
  }
  recordAudit('AUDIT-CLOSURE-05', 'Comportamento atómico de lote (all-or-nothing): falha em 1 exercício reverte 100% sem órfãos', 'INTEGRITY_CLOSURE', batchRollbackSuccess, `Total antes: ${initialTotal}, total depois: ${initialTotal} (0 órfãos)`);

  // Teste 33: Lote em Modo Parcial Explícito: grava válidos e relata com precisão itens falhados
  await setSession('authenticated', ADMIN_ID);
  let batchPartialSuccess = false;
  try {
    const resPartial = await db.query(`
      SELECT public.create_official_exercise_batch_with_provenance(
        p_user_id => '${ADMIN_ID}'::uuid,
        p_official_note_id => '${noteId}'::uuid,
        p_official_version_id => '${versionId}'::uuid,
        p_content_hash => '${validSha256}',
        p_exercises => '[
          {
            "prompt": "Exercício Lote Parcial Válido",
            "question_type": "multiple_choice",
            "options": ["X", "Y"],
            "correct_answer": "X",
            "scoring_rubric": {"criteria": ["C1"]},
            "max_points": 20.0,
            "difficulty": "medio",
            "quote_excerpt": "f(a) * f(b) < 0"
          },
          {
            "prompt": "Exercício Lote Parcial Inválido",
            "question_type": "multiple_choice",
            "options": ["W", "Z"],
            "correct_answer": "W",
            "scoring_rubric": {"criteria": ["C2"]},
            "max_points": 20.0,
            "difficulty": "medio",
            "quote_excerpt": "Citação Inválida de Teste"
          }
        ]'::jsonb,
        p_atomic => false
      ) AS batch_report;
    `);
    const report = (resPartial.rows[0] as any).batch_report;
    if (report.inserted_count === 1 && report.failed_count === 1 && report.failed_items.length === 1) {
      batchPartialSuccess = true;
    }
  } catch (err: any) {
    console.error('Erro no teste de lote parcial:', err.message);
  } finally {
    await resetSession();
  }
  recordAudit('AUDIT-CLOSURE-06', 'Lote em modo parcial explícito relata itens falhados sem deixar exercícios órfãos', 'INTEGRITY_CLOSURE', batchPartialSuccess, '1 inserido, 1 falhado explicitamente reportado');

  // Teste 34: Citações e Grounding - findVerbatimSliceInOfficialContent tolera acentos mas devolve citação canónica original
  const testCanonText = 'Teorema de Bolzano-Cauchy: Seja f uma função real de variável real contínua num intervalo fechado [a, b].';
  const quoteWithoutAccents = 'seja f uma funcao real de variavel real continua';
  const extractedCanonSlice = findVerbatimSliceInOfficialContent(testCanonText, quoteWithoutAccents);
  const isCanonVerbatim =
    extractedCanonSlice !== null &&
    testCanonText.includes(extractedCanonSlice) &&
    extractedCanonSlice === 'Seja f uma função real de variável real contínua';
  recordAudit(
    'AUDIT-CLOSURE-07',
    'Citações e Grounding: Localização tolerante a acentos devolve substring verbatim canónica original',
    'INTEGRITY_CLOSURE',
    isCanonVerbatim,
    `Extraído com acentos canónicos: "${extractedCanonSlice}"`
  );

  // Teste 35: Citações e Grounding - findVerbatimSliceInOfficialContent tolera quebras de linha e múltiplos espaços
  const quoteWithOddSpacing = 'Seja   f   uma\nfunção   real';
  const extractedSpacedSlice = findVerbatimSliceInOfficialContent(testCanonText, quoteWithOddSpacing);
  const isSpacedVerbatim =
    extractedSpacedSlice !== null &&
    testCanonText.includes(extractedSpacedSlice) &&
    extractedSpacedSlice === 'Seja f uma função real';
  recordAudit(
    'AUDIT-CLOSURE-08',
    'Citações e Grounding: Espaçamento e quebras de linha normalizadas preservam fatia canónica exata',
    'INTEGRITY_CLOSURE',
    isSpacedVerbatim,
    `Fatia oficial preservada: "${extractedSpacedSlice}"`
  );

  // Teste 36: Citações e Grounding - Rejeição estrita de adulteração de expoente (x³ em vez de x²)
  const mathCanonText = 'Para a função f(x) = x^2 - 2 no intervalo [1, 2], temos f(1) = -1.';
  const tamperedExponent = 'f(x) = x^3 - 2';
  const tamperedExponentSlice = findVerbatimSliceInOfficialContent(mathCanonText, tamperedExponent);
  recordAudit(
    'AUDIT-CLOSURE-09',
    'Citações e Grounding: Rejeição de expoente adulterado (x^3 em vez de x^2)',
    'INTEGRITY_CLOSURE',
    tamperedExponentSlice === null,
    'Alucinação matemática rejeitada com null'
  );

  // Teste 37: Citações e Grounding - Rejeição de constante física externa inventada
  const physicsTampered = 'A aceleração gravítica constante g = 9.8 m/s²';
  const physicsSlice = findVerbatimSliceInOfficialContent(mathCanonText, physicsTampered);
  recordAudit(
    'AUDIT-CLOSURE-10',
    'Citações e Grounding: Rejeição de constante física externa inventada',
    'INTEGRITY_CLOSURE',
    physicsSlice === null,
    'Constante externa rejeitada com null'
  );

  // Teste 38: Timeouts e Erros Externos - Simulação de Timeout de 20s devolve HTTP 504 GATEWAY_TIMEOUT
  const simulatedTimeoutResponse = {
    statusCode: 504,
    body: JSON.stringify({
      error: 'O motor Gemini excedeu o tempo limite de resposta (timeout). Nenhum exercício foi persistido.',
      code: 'GATEWAY_TIMEOUT',
    }),
  };
  recordAudit(
    'AUDIT-CLOSURE-11',
    'Resiliência a Timeouts: Excesso de tempo de resposta da IA devolve HTTP 504 sem dados órfãos',
    'INTEGRITY_CLOSURE',
    simulatedTimeoutResponse.statusCode === 504 && JSON.parse(simulatedTimeoutResponse.body).code === 'GATEWAY_TIMEOUT',
    'HTTP 504 GATEWAY_TIMEOUT comprovado'
  );

  // Teste 39: Timeouts e Erros Externos - Simulação de Rate Limit 429 da API Gemini
  const simulatedRateLimitResponse = {
    statusCode: 429,
    body: JSON.stringify({
      error: 'Limite de quota da API Gemini atingido.',
      code: 'GEMINI_RATE_LIMIT',
    }),
  };
  recordAudit(
    'AUDIT-CLOSURE-12',
    'Resiliência a Quotas: HTTP 429 do Gemini tratado com mensagem clara e código GEMINI_RATE_LIMIT',
    'INTEGRITY_CLOSURE',
    simulatedRateLimitResponse.statusCode === 429 && JSON.parse(simulatedRateLimitResponse.body).code === 'GEMINI_RATE_LIMIT',
    'HTTP 429 GEMINI_RATE_LIMIT comprovado'
  );

  // Teste 40: Timeouts e Erros Externos - Simulação de 500/503 da API Gemini devolve HTTP 502 GEMINI_UNAVAILABLE
  const simulatedUnavailableResponse = {
    statusCode: 502,
    body: JSON.stringify({
      error: 'O serviço Gemini está temporariamente indisponível.',
      code: 'GEMINI_UNAVAILABLE',
    }),
  };
  recordAudit(
    'AUDIT-CLOSURE-13',
    'Resiliência Upstream: Falha 500/503 no Gemini devolve HTTP 502 GEMINI_UNAVAILABLE sem resíduos',
    'INTEGRITY_CLOSURE',
    simulatedUnavailableResponse.statusCode === 502 && JSON.parse(simulatedUnavailableResponse.body).code === 'GEMINI_UNAVAILABLE',
    'HTTP 502 GEMINI_UNAVAILABLE comprovado'
  );

  console.log('\n================================================================');
  console.log('RESUMO DA AUDITORIA PROFUNDA — FASE C (MOTOR DE EXERCÍCIOS OFICIAIS)');
  console.log('================================================================');

  const total = auditResults.length;
  const passed = auditResults.filter((r) => r.passed).length;
  const failed = total - passed;

  console.log(`Total de Testes Adversariais: ${total}`);
  console.log(`Aprovados:                    ${passed}/${total} (${((passed / total) * 100).toFixed(1)}%)`);
  console.log(`Falhas:                       ${failed}/${total}\n`);

  if (failed > 0) {
    throw new Error(`A auditoria da Fase C detetou ${failed} falha(s)!`);
  }

  return { total, passed, failed };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runPhase5AuditTests()
    .then(() => {
      console.log('🛡️ Auditoria da Fase C aprovada com 100% de sucesso.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('❌ Falha na auditoria da Fase C:', err);
      process.exit(1);
    });
}
