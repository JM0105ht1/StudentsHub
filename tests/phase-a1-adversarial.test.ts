/**
 * SUITE DE AUDITORIA E TESTES ADVERSARIAIS — FASE A.1: SEGURANÇA E INTEGRIDADE
 * Students Hub — "Apontamentos que ajudam, exercícios que resultam. Rumo ao 20."
 * Princípio Sagrado: «SEMPRE COM BASE NOS APONTAMENTOS OFICIAIS!!!»
 * 
 * Executa as 12 validações de ataque e integridade estrita contra o motor PostgreSQL 16 (PGlite):
 * 1. Tentativa de aluno inserir diretamente em official_first_attempts (bloqueada).
 * 2. Tentativa de aluno manipular app.evaluating_attempt para contornar triggers (bloqueada).
 * 3. Tentativa de segunda tentativa substituir ou sobrescrever a primeira (bloqueada).
 * 4. Tentativa de criar primeira tentativa com assessment_id inexistente / inválido (bloqueada por FK).
 * 5. Tentativa de aluno criar exercício com is_official = true ou created_by_role = 'admin' (bloqueada).
 * 6. Tentativa de alterar conteúdo de versão publicada de apontamento oficial (bloqueada por imutabilidade).
 * 7. Tentativa de eliminar versão de apontamento oficial referenciada por exercício (bloqueada por rastreabilidade).
 * 8. Tentativa de submeter notas fora dos limites (score > max, negativos, scale_20 > 20, max <= 0) (bloqueada).
 * 9. Tentativa de aluno adulterar study_stats.streak_days diretamente (bloqueada).
 * 10. Consulta à leaderboard por aluno não privilegiado sem vazamento de PII (zero emails expostos).
 * 11. Verificação de despublicação sem destruição de referências históricas (rastreabilidade intacta).
 * 12. Verificação de integridade referencial nas avaliações oficiais (sincronização estrita de official_assessments).
 */

import { PGlite } from '@electric-sql/pglite';
import * as fs from 'fs';
import * as path from 'path';

const ALUNO_A_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ALUNO_B_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ADMIN_ID   = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

interface AdversarialTestResult {
  id: string;
  name: string;
  threatCategory:
    | 'TAMPER_DIRECT_INSERT'
    | 'TAMPER_GUC_FORGERY'
    | 'FIRST_ATTEMPT_SUBSTITUTION'
    | 'FOREIGN_KEY_INTEGRITY'
    | 'FORGED_OFFICIAL_EXERCISE'
    | 'NOTE_CONTENT_IMMUTABILITY'
    | 'REFERENCED_VERSION_DELETION'
    | 'SCORE_DOMAIN_BOUNDARY'
    | 'STUDY_STATS_TAMPERING'
    | 'PII_LEAK_PREVENTION'
    | 'UNPUBLISH_TRACEABILITY'
    | 'ASSESSMENT_REGISTRY_SYNC';
  passed: boolean;
  attackVector: string;
  defenseMechanism: string;
  details: string;
}

const results: AdversarialTestResult[] = [];

function recordAdversarial(
  id: string,
  name: string,
  threatCategory: AdversarialTestResult['threatCategory'],
  passed: boolean,
  attackVector: string,
  defenseMechanism: string,
  details: string
) {
  results.push({ id, name, threatCategory, passed, attackVector, defenseMechanism, details });
  const icon = passed ? '🛡️ [PROTEGIDO]' : '🚨 [VULNERÁVEL]';
  console.log(`${icon} ${id}: ${name}`);
  if (!passed) {
    console.error(`   ⚠️ VULNERABILIDADE DETETADA: ${details}`);
  }
}

export async function runPhaseA1AdversarialTests() {
  console.log('================================================================');
  console.log('FASE A.1 — BATERIA DE TESTES ADVERSARIAIS E DE INTEGRIDADE');
  console.log('Motor: PostgreSQL 16 (PGlite Engine Nativo C)');
  console.log('Students Hub · Turma C · «SEMPRE COM BASE NOS APONTAMENTOS OFICIAIS!!!»');
  console.log('================================================================\n');

  const db = new PGlite();

  // 1. Provisionar infraestrutura base do Supabase
  await db.exec(`
    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE SCHEMA IF NOT EXISTS storage;

    CREATE TABLE IF NOT EXISTS auth.users (
      id uuid PRIMARY KEY,
      email text UNIQUE,
      raw_user_meta_data jsonb DEFAULT '{}'::jsonb,
      created_at timestamptz DEFAULT now()
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

  // 2. Executar Migrações Sequenciais
  console.log('1. A carregar migração original Fase 2 (20261001000000)...');
  const baseSql = fs.readFileSync(path.resolve(process.cwd(), 'supabase/migrations/20261001000000_phase2_security_and_database.sql'), 'utf-8');
  await db.exec(baseSql);

  console.log('2. A carregar migração Fase A (20261024000000)...');
  const phaseASql = fs.readFileSync(path.resolve(process.cwd(), 'supabase/migrations/20261024000000_turma_c_official_schema.sql'), 'utf-8');
  await db.exec(phaseASql);

  console.log('3. A carregar migração corretiva Fase A.1 (20261024010000)...');
  const phaseA1Sql = fs.readFileSync(path.resolve(process.cwd(), 'supabase/migrations/20261024010000_turma_c_phase_a1_audit_fixes.sql'), 'utf-8');
  await db.exec(phaseA1Sql);

  // Permissões de roles Supabase
  await db.exec(`
    GRANT USAGE ON SCHEMA public TO authenticated, anon;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
    REVOKE INSERT, UPDATE, DELETE ON public.official_first_attempts FROM authenticated, anon;
    REVOKE INSERT, UPDATE, DELETE ON public.study_stats FROM authenticated, anon;
    GRANT SELECT ON public.subjects TO anon;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated, anon;
  `);

  // 3. Registar utilizadores de teste
  console.log('4. A inicializar identidades reais (Aluno A, Aluno B, Admin)...');
  await db.exec(`
    INSERT INTO auth.users (id, email, raw_user_meta_data)
    VALUES 
      ('${ALUNO_A_ID}', 'aluno.a@turmac.studentshub.pt', '{"full_name": "Tiago Ferreira", "school_year": "11º Ano"}'::jsonb),
      ('${ALUNO_B_ID}', 'aluno.b@turmac.studentshub.pt', '{"full_name": "Beatriz Costa", "school_year": "12º Ano"}'::jsonb),
      ('${ADMIN_ID}', 'admin@studentshub.pt', '{"full_name": "Professor Administrador"}'::jsonb)
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.user_roles (user_id, role)
    VALUES ('${ADMIN_ID}', 'admin')
    ON CONFLICT (user_id) DO UPDATE SET role = 'admin';
  `);

  // Helper para simular conexão
  const setSession = async (role: 'authenticated' | 'anon', userId?: string) => {
    await db.exec(`SET ROLE ${role};`);
    if (userId) {
      await db.exec(`SET request.jwt.claim.sub = '${userId}';`);
    } else {
      await db.exec(`RESET request.jwt.claim.sub;`);
    }
  };

  const resetSession = async () => {
    await db.exec(`RESET ROLE;`);
    await db.exec(`RESET request.jwt.claim.sub;`);
    await db.exec(`RESET app.evaluating_attempt;`);
  };

  // Preparar um exame oficial publicado e apontamento oficial como base
  let officialNoteId = '';
  let officialVersionId = '';
  let officialExamId = '';
  let officialExerciseId = '';

  await (async () => {
    await setSession('authenticated', ADMIN_ID);

    // Apontamento oficial e versão
    const noteRes = await db.query<{ id: string }>(`
      INSERT INTO public.official_notes (subject_id, academic_period, theme, title, is_published, created_by)
      VALUES ('matematica-a', 'P1', 'Geometria no Espaço', 'Vetores e Planos no Espaço', true, '${ADMIN_ID}')
      RETURNING id;
    `);
    officialNoteId = noteRes.rows[0].id;

    const verRes = await db.query<{ id: string }>(`
      INSERT INTO public.official_note_versions (note_id, version_number, raw_html, sanitized_html, plain_text_content, is_published, created_by)
      VALUES ('${officialNoteId}', 1, '<h1>Equação do Plano</h1><p>Ax + By + Cz + D = 0</p>', '<h1>Equação do Plano</h1><p>Ax + By + Cz + D = 0</p>', 'Equação do Plano', true, '${ADMIN_ID}')
      RETURNING id;
    `);
    officialVersionId = verRes.rows[0].id;

    await db.exec(`UPDATE public.official_notes SET current_version_id = '${officialVersionId}' WHERE id = '${officialNoteId}';`);

    // Exercício oficial criado pelo admin
    const exRes = await db.query<{ id: string }>(`
      INSERT INTO public.exercises (
        user_id, subject_id, prompt, question_type, options, correct_answer,
        scoring_rubric, max_points, difficulty, is_official, status, academic_period, created_by_role
      ) VALUES (
        '${ADMIN_ID}', 'matematica-a', 'Qual o vetor normal ao plano 2x - 3y + z = 5?', 'multiple_choice',
        '["(2,-3,1)", "(1,1,1)", "(2,3,1)", "(0,0,1)"]'::jsonb,
        '(2,-3,1)', '{"correct_option_index": 0}'::jsonb,
        20.00, 'medio', true, 'published', 'P1', 'admin'
      ) RETURNING id;
    `);
    officialExerciseId = exRes.rows[0].id;

    // Rastreabilidade documental
    await db.exec(`
      INSERT INTO public.exercise_source_references (
        exercise_id, user_id, source_type, official_note_id, official_version_id, official_section, citation_excerpt
      ) VALUES (
        '${officialExerciseId}', '${ADMIN_ID}', 'official', '${officialNoteId}', '${officialVersionId}', 'Vetores Normais',
        'O vetor normal a Ax + By + Cz + D = 0 é (A, B, C).'
      );
    `);

    // Exame oficial
    const examRes = await db.query<{ id: string }>(`
      INSERT INTO public.official_exams (
        subject_id, title, description, duration_minutes, total_points, is_published, version, created_by
      ) VALUES (
        'matematica-a', 'Exame Modelo Turma C — 1.ª Época', 'Exame Oficial Completo',
        90, 20.00, true, 1, '${ADMIN_ID}'
      ) RETURNING id;
    `);
    officialExamId = examRes.rows[0].id;

    await db.exec(`
      INSERT INTO public.official_exam_exercises (exam_id, exercise_id, period, order_index, allocated_points)
      VALUES ('${officialExamId}', '${officialExerciseId}', 'P1', 1, 20.00);
    `);

    await resetSession();
  })();

  console.log('Dados de referência oficiais provisionados com sucesso.\n');

  // ============================================================================
  // TESTE 1: TENTATIVA DE ALUNO INSERIR DIRETAMENTE EM OFFICIAL_FIRST_ATTEMPTS
  // ============================================================================
  try {
    await setSession('authenticated', ALUNO_A_ID);
    await db.exec(`
      INSERT INTO public.official_first_attempts (
        user_id, assessment_type, assessment_id, score_achieved, max_score, score_percentage, score_scale_20
      ) VALUES (
        '${ALUNO_A_ID}', 'exam', '${officialExamId}', 20.00, 20.00, 100.00, 20.00
      );
    `);
    recordAdversarial('A1-SEC-01', 'Tentativa de inserção direta por aluno em official_first_attempts', 'TAMPER_DIRECT_INSERT', false, 'INSERT direto via SQL com role authenticated', 'Bloqueio por permissões / RLS', 'Aluno conseguiu executar INSERT direto');
  } catch (err: any) {
    recordAdversarial('A1-SEC-01', 'Tentativa de inserção direta por aluno em official_first_attempts', 'TAMPER_DIRECT_INSERT', true, 'INSERT direto via SQL com role authenticated', 'REVOKE INSERT explícito e Trigger de barreira', `Bloqueado com sucesso: ${err.message}`);
  } finally {
    await resetSession();
  }

  // ============================================================================
  // TESTE 2: TENTATIVA DE ALUNO MANIPULAR APP.EVALUATING_ATTEMPT (GUC FORGERY)
  // ============================================================================
  try {
    await setSession('authenticated', ALUNO_A_ID);
    // Ataque adversarial: aluno injeta a flag GUC na sua sessão para iludir triggers antigos
    await db.exec(`SET app.evaluating_attempt = 'true';`);
    await db.exec(`
      INSERT INTO public.official_first_attempts (
        user_id, assessment_type, assessment_id, score_achieved, max_score, score_percentage, score_scale_20
      ) VALUES (
        '${ALUNO_A_ID}', 'exam', '${officialExamId}', 20.00, 20.00, 100.00, 20.00
      );
    `);
    recordAdversarial('A1-SEC-02', 'Tentativa de forjar GUC app.evaluating_attempt para contornar triggers', 'TAMPER_GUC_FORGERY', false, 'SET app.evaluating_attempt = true seguido de INSERT', 'Eliminação da confiança em variáveis GUC de sessão', 'GUC forjado permitiu inserção não autorizada');
  } catch (err: any) {
    recordAdversarial('A1-SEC-02', 'Tentativa de forjar GUC app.evaluating_attempt para contornar triggers', 'TAMPER_GUC_FORGERY', true, 'SET app.evaluating_attempt = true seguido de INSERT', 'GUC descartado como vetor de autorização; canalização via RPC seguro', `Ataque neutralizado: ${err.message}`);
  } finally {
    await resetSession();
  }

  // ============================================================================
  // REGISTO DA PRIMEIRA TENTATIVA LEGÍTIMA VIA RPC SERVER-SIDE
  // ============================================================================
  let validAttemptId = '';
  try {
    await setSession('authenticated', ALUNO_A_ID);
    const attemptRes = await db.query<{ id: string; score_scale_20: string }>(`
      SELECT id, score_scale_20 FROM public.record_official_first_attempt(
        '${officialExamId}', 'exam', 16.00, 20.00
      );
    `);
    validAttemptId = attemptRes.rows[0].id;
  } finally {
    await resetSession();
  }

  // ============================================================================
  // TESTE 3: TENTATIVA DE SEGUNDA TENTATIVA SUBSTITUIR A PRIMEIRA
  // ============================================================================
  try {
    await setSession('authenticated', ALUNO_A_ID);
    // Tenta submeter nova tentativa de melhoria (19.00)
    await db.exec(`
      SELECT public.record_official_first_attempt(
        '${officialExamId}', 'exam', 19.00, 20.00
      );
    `);
    recordAdversarial('A1-SEC-03', 'Tentativa de segunda tentativa substituir a 1.ª tentativa oficial', 'FIRST_ATTEMPT_SUBSTITUTION', false, 'Submissão de segunda tentativa com pontuação superior', 'Inviolabilidade atómica da 1.ª tentativa oficial', 'Permitiu registar segunda tentativa oficial');
  } catch (err: any) {
    recordAdversarial('A1-SEC-03', 'Tentativa de segunda tentativa substituir a 1.ª tentativa oficial', 'FIRST_ATTEMPT_SUBSTITUTION', true, 'Submissão de segunda tentativa com pontuação superior', 'Verificação atómica pré-inserção e restrição UNIQUE composta', `Bloqueado com sucesso: ${err.message}`);
  } finally {
    await resetSession();
  }

  // ============================================================================
  // TESTE 4: TENTATIVA DE CRIAR PRIMEIRA TENTATIVA COM ASSESSMENT_ID INEXISTENTE
  // ============================================================================
  try {
    await setSession('authenticated', ALUNO_B_ID);
    const fakeAssessmentId = '99999999-9999-4999-8999-999999999999';
    await db.exec(`
      SELECT public.record_official_first_attempt(
        '${fakeAssessmentId}', 'exam', 15.00, 20.00
      );
    `);
    recordAdversarial('A1-SEC-04', 'Tentativa de associar tentativa a assessment_id inexistente', 'FOREIGN_KEY_INTEGRITY', false, 'Invocação de registo com UUID aleatório inexistente', 'Validação relacional estrita contra official_assessments', 'Permitiu assessment_id arbitrário');
  } catch (err: any) {
    recordAdversarial('A1-SEC-04', 'Tentativa de associar tentativa a assessment_id inexistente', 'FOREIGN_KEY_INTEGRITY', true, 'Invocação de registo com UUID aleatório inexistente', 'Entidade unificada official_assessments e FK relacional', `Rejeitado com sucesso: ${err.message}`);
  } finally {
    await resetSession();
  }

  // ============================================================================
  // TESTE 5: TENTATIVA DE ALUNO CRIAR EXERCÍCIO COM IS_OFFICIAL = TRUE
  // ============================================================================
  try {
    await setSession('authenticated', ALUNO_A_ID);
    await db.exec(`
      INSERT INTO public.exercises (
        user_id, subject_id, prompt, question_type, is_official, created_by_role
      ) VALUES (
        '${ALUNO_A_ID}', 'matematica-a', 'Pergunta forjada pelo aluno', 'multiple_choice', true, 'admin'
      );
    `);
    recordAdversarial('A1-SEC-05', 'Tentativa de aluno forjar exercício oficial (is_official = true)', 'FORGED_OFFICIAL_EXERCISE', false, 'INSERT em exercises com is_official=true e created_by_role=admin', 'Trigger protect_official_exercise_integrity', 'Aluno conseguiu forjar exercício oficial');
  } catch (err: any) {
    recordAdversarial('A1-SEC-05', 'Tentativa de aluno forjar exercício oficial (is_official = true)', 'FORGED_OFFICIAL_EXERCISE', true, 'INSERT em exercises com is_official=true e created_by_role=admin', 'Trigger protect_official_exercise_integrity e validação de perfil', `Bloqueado com sucesso: ${err.message}`);
  } finally {
    await resetSession();
  }

  // ============================================================================
  // TESTE 6: TENTATIVA DE ALTERAR CONTEÚDO DE VERSÃO PUBLICADA DE APONTAMENTO
  // ============================================================================
  try {
    await setSession('authenticated', ADMIN_ID);
    await db.exec(`
      UPDATE public.official_note_versions
      SET raw_html = '<h1>Conteúdo Modificado Silenciosamente</h1>',
          sanitized_html = '<h1>Conteúdo Modificado Silenciosamente</h1>'
      WHERE id = '${officialVersionId}';
    `);
    recordAdversarial('A1-SEC-06', 'Tentativa de modificar conteúdo de versão publicada de apontamento', 'NOTE_CONTENT_IMMUTABILITY', false, 'UPDATE direto de raw_html/sanitized_html em versão publicada', 'Trigger protect_published_note_version_immutability', 'Permitiu alterar conteúdo publicado sem nova versão');
  } catch (err: any) {
    recordAdversarial('A1-SEC-06', 'Tentativa de modificar conteúdo de versão publicada de apontamento', 'NOTE_CONTENT_IMMUTABILITY', true, 'UPDATE direto de raw_html/sanitized_html em versão publicada', 'Trigger protect_published_note_version_immutability exige criação de v2', `Protegido com sucesso: ${err.message}`);
  } finally {
    await resetSession();
  }

  // ============================================================================
  // TESTE 7: TENTATIVA DE ELIMINAR VERSÃO DE APONTAMENTO REFERENCIADA POR EXERCÍCIO
  // ============================================================================
  try {
    await setSession('authenticated', ADMIN_ID);
    await db.exec(`
      DELETE FROM public.official_note_versions WHERE id = '${officialVersionId}';
    `);
    recordAdversarial('A1-SEC-07', 'Tentativa de eliminar versão de apontamento referenciada por exercício', 'REFERENCED_VERSION_DELETION', false, 'DELETE de versão citada em exercise_source_references', 'Trigger protect_official_note_version_deletion', 'Permitiu eliminar versão referenciada e quebrar rastreabilidade');
  } catch (err: any) {
    recordAdversarial('A1-SEC-07', 'Tentativa de eliminar versão de apontamento referenciada por exercício', 'REFERENCED_VERSION_DELETION', true, 'DELETE de versão citada em exercise_source_references', 'Trigger de bloqueio de eliminação de notas referenciadas', `Bloqueado com sucesso: ${err.message}`);
  } finally {
    await resetSession();
  }

  // ============================================================================
  // TESTE 8: TENTATIVAS DE SUBMETER NOTAS FORA DOS LIMITES ADMITIDOS
  // ============================================================================
  let boundaryViolationsBlocked = 0;
  const boundaryTests = [
    { label: 'Nota superior ao máximo (25 em 20)', score: 25.00, max: 20.00 },
    { label: 'Nota negativa (-5 em 20)', score: -5.00, max: 20.00 },
    { label: 'Pontuação máxima zero (0)', score: 0.00, max: 0.00 },
    { label: 'Pontuação máxima negativa (-20)', score: 5.00, max: -20.00 }
  ];

  for (const bTest of boundaryTests) {
    try {
      await setSession('authenticated', ALUNO_B_ID);
      await db.exec(`
        SELECT public.record_official_first_attempt(
          '${officialExamId}', 'exam', ${bTest.score}, ${bTest.max}
        );
      `);
    } catch (err) {
      boundaryViolationsBlocked++;
    } finally {
      await resetSession();
    }
  }

  if (boundaryViolationsBlocked === 4) {
    recordAdversarial('A1-SEC-08', 'Rejeição de notas fora dos limites (score > max, negativos, max <= 0)', 'SCORE_DOMAIN_BOUNDARY', true, 'Valores numéricos anómalos via RPC', 'Validação server-side estrita de limites e não-negatividade', '100% das 4 anomalias numéricas foram rejeitadas');
  } else {
    recordAdversarial('A1-SEC-08', 'Rejeição de notas fora dos limites (score > max, negativos, max <= 0)', 'SCORE_DOMAIN_BOUNDARY', false, 'Valores numéricos anómalos via RPC', 'Validação server-side estrita de limites e não-negatividade', `Apenas ${boundaryViolationsBlocked}/4 anomalias foram rejeitadas`);
  }

  // ============================================================================
  // TESTE 9: TENTATIVA DE ALUNO ADULTERAR STUDY_STATS.STREAK_DAYS DIRETAMENTE
  // ============================================================================
  try {
    await setSession('authenticated', ALUNO_A_ID);
    await db.exec(`
      UPDATE public.study_stats
      SET streak_days = 999
      WHERE user_id = '${ALUNO_A_ID}';
    `);
    recordAdversarial('A1-SEC-09', 'Tentativa de aluno adulterar streak_days em study_stats diretamente', 'STUDY_STATS_TAMPERING', false, 'UPDATE direto em study_stats por aluno', 'REVOKE UPDATE e trigger protect_study_stats_tampering', 'Aluno conseguiu alterar o seu streak para 999');
  } catch (err: any) {
    recordAdversarial('A1-SEC-09', 'Tentativa de aluno adulterar streak_days em study_stats diretamente', 'STUDY_STATS_TAMPERING', true, 'UPDATE direto em study_stats por aluno', 'Permissão revogada e trigger de integridade de estatísticas', `Bloqueado com sucesso: ${err.message}`);
  } finally {
    await resetSession();
  }

  // ============================================================================
  // TESTE 10: CONSULTA À LEADERBOARD DA TURMA C SEM VAZAMENTO DE PII (EMAILS)
  // ============================================================================
  try {
    await setSession('authenticated', ALUNO_A_ID);
    const lbRes = await db.query<any>(`SELECT * FROM public.get_turma_c_leaderboard();`);
    const returnedCols = Object.keys(lbRes.rows[0] || {});
    const leaksEmail = returnedCols.some(c => c.toLowerCase().includes('email'));
    const leaksPassword = returnedCols.some(c => c.toLowerCase().includes('password') || c.toLowerCase().includes('hash'));
    
    // Verificar se algum valor retornado contém "@"
    let containsEmailValue = false;
    for (const row of lbRes.rows) {
      for (const val of Object.values(row)) {
        if (typeof val === 'string' && val.includes('@')) {
          containsEmailValue = true;
          break;
        }
      }
    }

    if (!leaksEmail && !leaksPassword && !containsEmailValue) {
      recordAdversarial('A1-SEC-10', 'Consulta da Leaderboard da Turma C sem vazamento de emails ou PII', 'PII_LEAK_PREVENTION', true, 'SELECT * FROM get_turma_c_leaderboard() por aluno', 'Sanitização de projeção e search_path seguro', 'Colunas estritamente públicas (rank, full_name, streak, %) sem qualquer email');
    } else {
      recordAdversarial('A1-SEC-10', 'Consulta da Leaderboard da Turma C sem vazamento de emails ou PII', 'PII_LEAK_PREVENTION', false, 'SELECT * FROM get_turma_c_leaderboard() por aluno', 'Sanitização de projeção e search_path seguro', 'Foi detetado email ou PII no retorno da leaderboard');
    }
  } catch (err: any) {
    recordAdversarial('A1-SEC-10', 'Consulta da Leaderboard da Turma C sem vazamento de emails ou PII', 'PII_LEAK_PREVENTION', false, 'SELECT * FROM get_turma_c_leaderboard() por aluno', 'Sanitização de projeção e search_path seguro', err.message);
  } finally {
    await resetSession();
  }

  // ============================================================================
  // TESTE 11: DESPUBLICAÇÃO SEM DESTRUIÇÃO DE REFERÊNCIAS HISTÓRICAS
  // ============================================================================
  try {
    await setSession('authenticated', ADMIN_ID);
    // Despublicar apontamento oficial
    await db.exec(`UPDATE public.official_notes SET is_published = false WHERE id = '${officialNoteId}';`);

    // Aluno não pode ver o apontamento na listagem pública
    await setSession('authenticated', ALUNO_A_ID);
    const visibleNotes = await db.query(`SELECT * FROM public.official_notes WHERE id = '${officialNoteId}';`);
    
    // Mas a referência de rastreabilidade do exercício continua intacta na base de dados
    await resetSession();
    const sourceRefs = await db.query(`
      SELECT * FROM public.exercise_source_references
      WHERE official_note_id = '${officialNoteId}' AND official_version_id = '${officialVersionId}';
    `);

    if (visibleNotes.rows.length === 0 && sourceRefs.rows.length === 1) {
      recordAdversarial('A1-SEC-11', 'Despublicação de apontamento sem destruição de referências históricas', 'UNPUBLISH_TRACEABILITY', true, 'UPDATE official_notes SET is_published = false', 'Despublicação lógica preservando versões e referências em source_references', 'Apontamento ocultado aos alunos mas auditoria histórica 100% preservada');
    } else {
      recordAdversarial('A1-SEC-11', 'Despublicação de apontamento sem destruição de referências históricas', 'UNPUBLISH_TRACEABILITY', false, 'UPDATE official_notes SET is_published = false', 'Despublicação lógica preservando versões e referências', `Visíveis: ${visibleNotes.rows.length}, Refs: ${sourceRefs.rows.length}`);
    }
  } catch (err: any) {
    recordAdversarial('A1-SEC-11', 'Despublicação de apontamento sem destruição de referências históricas', 'UNPUBLISH_TRACEABILITY', false, 'UPDATE official_notes SET is_published = false', 'Despublicação lógica', err.message);
  } finally {
    await resetSession();
  }

  // ============================================================================
  // TESTE 12: INTEGRIDADE REFERENCIAL NAS AVALIAÇÕES OFICIAIS (OFFICIAL_ASSESSMENTS)
  // ============================================================================
  try {
    await setSession('authenticated', ADMIN_ID);
    // Criar um novo conjunto de exercícios
    const setRes = await db.query<{ id: string }>(`
      INSERT INTO public.official_exercise_sets (
        subject_id, academic_period, title, is_published, created_by
      ) VALUES (
        'fisica-quimica-a', 'P2', 'Mecânica e Cinemática Turma C', true, '${ADMIN_ID}'
      ) RETURNING id;
    `);
    const newSetId = setRes.rows[0].id;

    // Verificar se o trigger sync_set_to_assessments povoou automaticamente official_assessments
    const syncRes = await db.query<{ id: string; assessment_type: string }>(`
      SELECT id, assessment_type FROM public.official_assessments
      WHERE id = '${newSetId}' AND assessment_type = 'exercise_set';
    `);

    // Tentar associar uma tentativa com tipo trocado ('exam' em vez de 'exercise_set') -> Deve falhar
    let typeMismatchBlocked = false;
    try {
      await setSession('authenticated', ALUNO_B_ID);
      await db.exec(`
        SELECT public.record_official_first_attempt(
          '${newSetId}', 'exam', 18.00, 20.00
        );
      `);
    } catch {
      typeMismatchBlocked = true;
    }

    if (syncRes.rows.length === 1 && typeMismatchBlocked) {
      recordAdversarial('A1-SEC-12', 'Integridade referencial de official_assessments e rejeição de mismatch de tipo', 'ASSESSMENT_REGISTRY_SYNC', true, 'Tentativa de usar ID de exercise_set com tipo exam', 'Chave primária e estrangeira composta (id, assessment_type)', 'Sincronização automática via trigger e integridade de tipos confirmada');
    } else {
      recordAdversarial('A1-SEC-12', 'Integridade referencial de official_assessments e rejeição de mismatch de tipo', 'ASSESSMENT_REGISTRY_SYNC', false, 'Tentativa de usar ID com tipo trocado', 'Chave composta', `Sync: ${syncRes.rows.length}, TypeMismatchBlocked: ${typeMismatchBlocked}`);
    }
  } catch (err: any) {
    recordAdversarial('A1-SEC-12', 'Integridade referencial de official_assessments e rejeição de mismatch de tipo', 'ASSESSMENT_REGISTRY_SYNC', false, 'Sincronização de avaliações', 'Trigger de sincronização', err.message);
  } finally {
    await resetSession();
  }

  // ============================================================================
  // RELATÓRIO FINAL DA BATERIA ADVERSARIAL
  // ============================================================================
  console.log('\n================================================================');
  console.log('RELATÓRIO DE RESULTADOS — FASE A.1: AUDITORIA ADVERSARIAL');
  console.log('================================================================');
  const total = results.length;
  const passed = results.filter(r => r.passed).length;
  const failed = total - passed;
  const successRate = ((passed / total) * 100).toFixed(1);

  console.log(`Total de Ataques Adversariais Testados: ${total}`);
  console.log(`Vetores Neutralizados com Sucesso:    ${passed}`);
  console.log(`Vulnerabilidades Encontradas:          ${failed}`);
  console.log(`Taxa de Blindagem:                     ${successRate}%`);

  if (failed === 0) {
    console.log('\n🎉 SUCESSO TOTAL: Todos os 12 testes adversariais e de integridade passaram com 100% de proteção!');
  } else {
    console.error(`\n❌ FALHAS: ${failed} testes de segurança falharam.`);
    process.exit(1);
  }
}

// Execução direta
runPhaseA1AdversarialTests().catch(err => {
  console.error('Erro fatal na suite adversarial:', err);
  process.exit(1);
});
