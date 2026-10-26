/**
 * SUITE DE AUDITORIA E TESTES — FASE A: SCHEMA E MIGRAÇÃO TURMA C
 * Students Hub — "Apontamentos que ajudam, exercícios que resultam. Rumo ao 20."
 * Princípio Sagrado: «SEMPRE COM BASE NOS APONTAMENTOS OFICIAIS!!!»
 * 
 * Executa verificações completas contra o motor PostgreSQL C real (via @electric-sql/pglite):
 * 1. Aluno sem permissões a tentar criar ou publicar apontamento oficial (bloqueado por RLS)
 * 2. Aluno a tentar consultar apontamento oficial em rascunho (is_published = false) (0 linhas visíveis)
 * 3. Aluno a consultar apontamento oficial publicado (is_published = true) (sucesso)
 * 4. Administrador autenticado a criar, versionar e publicar apontamentos oficiais com HTML original e sanitizado
 * 5. Integridade referencial de versões: official_notes -> official_note_versions -> current_version_id
 * 6. Rastreabilidade de exercícios oficiais: exercise_source_references com source_type = 'official'
 * 7. Exame Oficial abrangendo exercícios dos 3 períodos (P1, P2 e P3) com ordem sequencial e cotação
 * 8. Imutabilidade do exame: bloqueio de alteração estrutural após registo de tentativas de alunos
 * 9. Exclusividade da 1.ª Tentativa Oficial: inserção de segunda tentativa para o mesmo exame bloqueada por UNIQUE
 * 10. Imutabilidade da 1.ª Tentativa Oficial: trigger rejeita categoricamente qualquer UPDATE de pontuação
 * 11. Anti-Tampering: aluno comum bloqueado de inserir tentativa oficial diretamente sem contexto do sistema
 * 12. Cross-Tenant IDOR: Aluno B não consegue consultar a tentativa oficial de Aluno A
 * 13. Restrições de integridade de domínio: rejeição de período inválido ('P4') e disciplina inexistente
 * 14. Transacionalidade e Rollback atómico em caso de erro na transação
 * 15. Leaderboard da Turma C: cálculo percentual normalizado, streak de estudo e tratamento de alunos sem resultados
 * 16. Transição suave da Turma C: compatibilidade com profiles legados e school_year opcional
 */

import { PGlite } from '@electric-sql/pglite';
import * as fs from 'fs';
import * as path from 'path';

// Identidades Reais de Teste
const ALUNO_A_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ALUNO_B_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ADMIN_ID   = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

interface PhaseATestResult {
  id: string;
  name: string;
  category:
    | 'RLS_AUTHORIZATION'
    | 'VERSIONING_INTEGRITY'
    | 'OFFICIAL_EXERCISES_SOURCES'
    | 'EXAM_STRUCTURE_P1_P2_P3'
    | 'FIRST_ATTEMPT_INTEGRITY'
    | 'ANTI_TAMPERING'
    | 'CROSS_TENANT_ISOLATION'
    | 'DOMAIN_CONSTRAINTS'
    | 'TRANSACTION_ROLLBACK'
    | 'TURMA_C_LEADERBOARD';
  passed: boolean;
  details: string;
}

const testResults: PhaseATestResult[] = [];

function recordTest(
  id: string,
  name: string,
  category: PhaseATestResult['category'],
  passed: boolean,
  details: string
) {
  testResults.push({ id, name, category, passed, details });
  const status = passed ? '✅ PASSOU' : '❌ FALHOU';
  console.log(`[${status}] ${id}: ${name}`);
  if (!passed) {
    console.error(`   Detalhes: ${details}`);
  }
}

export async function runPhaseATests() {
  console.log('================================================================');
  console.log('FASE A — SCHEMA E MIGRAÇÃO SEGURA PARA A TURMA C (TESTES)');
  console.log('Motor: PostgreSQL 16 (PGlite Engine Nativo C)');
  console.log('Students Hub · «SEMPRE COM BASE NOS APONTAMENTOS OFICIAIS!!!»');
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

  // 2. Executar Migration Base (Fase 2)
  console.log('1. A carregar migração original Fase 2...');
  const baseMigrationPath = path.resolve(process.cwd(), 'supabase/migrations/20261001000000_phase2_security_and_database.sql');
  const baseSql = fs.readFileSync(baseMigrationPath, 'utf-8');
  await db.exec(baseSql);

  // 3. Executar Nova Migration da Fase A (Turma C)
  console.log('2. A carregar nova migração Fase A (Turma C)...');
  const phaseAMigrationPath = path.resolve(process.cwd(), 'supabase/migrations/20261024000000_turma_c_official_schema.sql');
  const phaseASql = fs.readFileSync(phaseAMigrationPath, 'utf-8');
  await db.exec(phaseASql);

  // Permissões de roles Supabase
  await db.exec(`
    GRANT USAGE ON SCHEMA public TO authenticated, anon;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
    GRANT SELECT ON public.subjects TO anon;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated, anon;
  `);

  // 4. Registar Utilizadores
  console.log('3. A registar identidades (Aluno A, Aluno B, Admin)...');
  await db.exec(`
    INSERT INTO auth.users (id, email, raw_user_meta_data)
    VALUES 
      ('${ALUNO_A_ID}', 'aluno.a@studentshub.pt', '{"full_name": "Tiago Ferreira", "school_year": "11º Ano"}'::jsonb),
      ('${ALUNO_B_ID}', 'aluno.b@studentshub.pt', '{"full_name": "Beatriz Costa", "school_year": "12º Ano"}'::jsonb),
      ('${ADMIN_ID}', 'admin@studentshub.pt', '{"full_name": "Professor Administrador"}'::jsonb)
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.user_roles (user_id, role)
    VALUES ('${ADMIN_ID}', 'admin')
    ON CONFLICT (user_id) DO UPDATE SET role = 'admin';
  `);

  console.log('Ambiente preparado com sucesso. A iniciar bateria de validações...\n');

  // Helper para simular conexão com SET request.jwt.claim.sub
  const setSession = async (role: 'authenticated' | 'anon', userId?: string, isSystem: boolean = false) => {
    await db.exec(`SET ROLE ${role};`);
    if (userId) {
      await db.exec(`SET request.jwt.claim.sub = '${userId}';`);
    } else {
      await db.exec(`RESET request.jwt.claim.sub;`);
    }
    if (isSystem) {
      await db.exec(`SET app.evaluating_attempt = 'true';`);
    } else {
      await db.exec(`RESET app.evaluating_attempt;`);
    }
  };

  const resetSession = async () => {
    await db.exec(`RESET ROLE;`);
    await db.exec(`RESET request.jwt.claim.sub;`);
    await db.exec(`RESET app.evaluating_attempt;`);
  };

  // ============================================================================
  // BATERIA 1: RLS E AUTORIZAÇÃO DE APONTAMENTOS OFICIAIS
  // ============================================================================
  console.log('--- BATERIA 1: RLS E AUTORIZAÇÃO DE APONTAMENTOS OFICIAIS ---');

  // Teste 1: Aluno sem permissões tenta criar apontamento oficial
  try {
    await setSession('authenticated', ALUNO_A_ID);
    await db.exec(`
      INSERT INTO public.official_notes (subject_id, academic_period, theme, title, is_published, created_by)
      VALUES ('matematica-a', 'P1', 'Limites e Continuidade', 'Teorema de Bolzano', true, '${ALUNO_A_ID}');
    `);
    recordTest('PHA-RLS-01', 'Aluno bloqueado de criar apontamento oficial', 'RLS_AUTHORIZATION', false, 'Aluno conseguiu inserir apontamento oficial');
  } catch (err: any) {
    recordTest('PHA-RLS-01', 'Aluno bloqueado de criar apontamento oficial', 'RLS_AUTHORIZATION', true, 'Bloqueado com sucesso por RLS');
  } finally {
    await resetSession();
  }

  // Teste 2: Admin cria apontamento oficial em rascunho e versão
  let officialNoteId = '';
  let officialVersionId = '';
  try {
    await setSession('authenticated', ADMIN_ID);
    const noteRes = await db.query<{ id: string }>(`
      INSERT INTO public.official_notes (subject_id, academic_period, theme, title, is_published, created_by)
      VALUES ('matematica-a', 'P1', 'Limites e Continuidade', 'Teorema de Bolzano-Cauchy', false, '${ADMIN_ID}')
      RETURNING id;
    `);
    officialNoteId = noteRes.rows[0].id;

    const verRes = await db.query<{ id: string }>(`
      INSERT INTO public.official_note_versions (note_id, version_number, raw_html, sanitized_html, plain_text_content, is_published, created_by)
      VALUES (
        '${officialNoteId}', 
        1, 
        '<h1>Teorema de Bolzano</h1><p>Seja f contínua em [a,b]...</p><script>alert("hack")</script>',
        '<h1>Teorema de Bolzano</h1><p>Seja f contínua em [a,b]...</p>',
        'Teorema de Bolzano: Seja f contínua em [a,b]...',
        false,
        '${ADMIN_ID}'
      )
      RETURNING id;
    `);
    officialVersionId = verRes.rows[0].id;

    await db.exec(`
      UPDATE public.official_notes SET current_version_id = '${officialVersionId}' WHERE id = '${officialNoteId}';
    `);
    recordTest('PHA-RLS-02', 'Admin cria apontamento oficial e versão em rascunho com sucesso', 'RLS_AUTHORIZATION', true, `Apontamento criado: ${officialNoteId}`);
  } catch (err: any) {
    recordTest('PHA-RLS-02', 'Admin cria apontamento oficial e versão em rascunho com sucesso', 'RLS_AUTHORIZATION', false, err.message);
  } finally {
    await resetSession();
  }

  // Teste 3: Aluno tenta consultar apontamento oficial em rascunho (não publicado)
  try {
    await setSession('authenticated', ALUNO_A_ID);
    const res = await db.query(`SELECT * FROM public.official_notes WHERE id = '${officialNoteId}';`);
    if (res.rows.length === 0) {
      recordTest('PHA-RLS-03', 'Aluno não consegue consultar apontamento não publicado (0 linhas)', 'RLS_AUTHORIZATION', true, 'Isolamento RLS perfeito');
    } else {
      recordTest('PHA-RLS-03', 'Aluno não consegue consultar apontamento não publicado', 'RLS_AUTHORIZATION', false, `Viu ${res.rows.length} linhas de rascunho`);
    }
  } catch (err: any) {
    recordTest('PHA-RLS-03', 'Aluno não consegue consultar apontamento não publicado', 'RLS_AUTHORIZATION', false, err.message);
  } finally {
    await resetSession();
  }

  // Teste 4: Admin publica o apontamento e a versão; Aluno passa a conseguir consultar
  try {
    await setSession('authenticated', ADMIN_ID);
    await db.exec(`
      UPDATE public.official_notes SET is_published = true, published_at = now() WHERE id = '${officialNoteId}';
      UPDATE public.official_note_versions SET is_published = true, published_at = now() WHERE id = '${officialVersionId}';
    `);

    await setSession('authenticated', ALUNO_A_ID);
    const res = await db.query(`SELECT * FROM public.official_notes WHERE id = '${officialNoteId}';`);
    if (res.rows.length === 1) {
      recordTest('PHA-RLS-04', 'Aluno consulta com sucesso apontamento após publicação oficial', 'RLS_AUTHORIZATION', true, '1 linha devolvida como esperado');
    } else {
      recordTest('PHA-RLS-04', 'Aluno consulta com sucesso apontamento após publicação oficial', 'RLS_AUTHORIZATION', false, 'Não conseguiu consultar após publicação');
    }
  } catch (err: any) {
    recordTest('PHA-RLS-04', 'Aluno consulta com sucesso apontamento após publicação oficial', 'RLS_AUTHORIZATION', false, err.message);
  } finally {
    await resetSession();
  }

  // ============================================================================
  // BATERIA 2: HISTÓRICO DE VERSÕES E INTEGRIDADE REFERENCIAL
  // ============================================================================
  console.log('\n--- BATERIA 2: HISTÓRICO DE VERSÕES E INTEGRIDADE REFERENCIAL ---');

  // Teste 5: Admin cria versão 2 e despublica sem destruir versão 1
  try {
    await setSession('authenticated', ADMIN_ID);
    const ver2 = await db.query<{ id: string }>(`
      INSERT INTO public.official_note_versions (note_id, version_number, raw_html, sanitized_html, plain_text_content, is_published, change_summary, created_by)
      VALUES (
        '${officialNoteId}', 
        2, 
        '<h1>Teorema de Bolzano (Revisto)</h1><p>Versão ampliada com corolários.</p>',
        '<h1>Teorema de Bolzano (Revisto)</h1><p>Versão ampliada com corolários.</p>',
        'Teorema de Bolzano (Revisto): Versão ampliada com corolários.',
        false,
        'Adição de corolários práticos',
        '${ADMIN_ID}'
      )
      RETURNING id;
    `);
    const v2Id = ver2.rows[0].id;
    recordTest('PHA-VER-01', 'Criação de versão sequencial v2 preservando integridade de v1', 'VERSIONING_INTEGRITY', true, `v2 id: ${v2Id}`);
  } catch (err: any) {
    recordTest('PHA-VER-01', 'Criação de versão sequencial v2 preservando integridade de v1', 'VERSIONING_INTEGRITY', false, err.message);
  } finally {
    await resetSession();
  }

  // Teste 6: Rejeição de número de versão duplicado para a mesma nota
  try {
    await setSession('authenticated', ADMIN_ID);
    await db.exec(`
      INSERT INTO public.official_note_versions (note_id, version_number, raw_html, sanitized_html, plain_text_content, created_by)
      VALUES ('${officialNoteId}', 1, '<p>Repetido</p>', '<p>Repetido</p>', 'Repetido', '${ADMIN_ID}');
    `);
    recordTest('PHA-VER-02', 'Rejeição de versão com número duplicado para a mesma nota', 'VERSIONING_INTEGRITY', false, 'Permitiu duplicar version_number 1');
  } catch (err: any) {
    recordTest('PHA-VER-02', 'Rejeição de versão com número duplicado para a mesma nota', 'VERSIONING_INTEGRITY', true, 'Rejeitado por restrição uq_official_note_version');
  } finally {
    await resetSession();
  }

  // ============================================================================
  // BATERIA 3: EXERCÍCIOS OFICIAIS E RASTREABILIDADE DAS FONTES
  // ============================================================================
  console.log('\n--- BATERIA 3: EXERCÍCIOS OFICIAIS E RASTREABILIDADE DAS FONTES ---');

  let exP1Id = '';
  let exP2Id = '';
  let exP3Id = '';

  try {
    await setSession('authenticated', ADMIN_ID);
    // Exercício P1 (Matemática A - Bolzano)
    const r1 = await db.query<{ id: string }>(`
      INSERT INTO public.exercises (
        user_id, subject_id, prompt, question_type, options, correct_answer, 
        scoring_rubric, max_points, is_official, status, academic_period, created_by_role
      )
      VALUES (
        '${ADMIN_ID}', 'matematica-a', 'Considere f contínua em [1, 3] com f(1)=-2 e f(3)=5. Pelo Teorema de Bolzano...',
        'multiple_choice', '["Existe c em ]1,3[ tal que f(c)=0", "f é estritamente crescente", "f é derivável", "f não tem zeros"]'::jsonb,
        'Existe c em ]1,3[ tal que f(c)=0',
        '{"correct_option_index": 0}'::jsonb,
        4.00, true, 'published', 'P1', 'admin'
      ) RETURNING id;
    `);
    exP1Id = r1.rows[0].id;

    // Associar referência oficial documental
    await db.exec(`
      INSERT INTO public.exercise_source_references (
        exercise_id, user_id, source_type, official_note_id, official_version_id, official_section, citation_excerpt
      )
      VALUES (
        '${exP1Id}', '${ADMIN_ID}', 'official', '${officialNoteId}', '${officialVersionId}', 'Teorema de Bolzano',
        'Seja f contínua em [a,b] tal que f(a)*f(b) < 0, então existe pelo menos um zero...'
      );
    `);

    // Exercício P2 (Trigonometria)
    const r2 = await db.query<{ id: string }>(`
      INSERT INTO public.exercises (
        user_id, subject_id, prompt, question_type, options, correct_answer, 
        scoring_rubric, max_points, is_official, status, academic_period, created_by_role
      )
      VALUES (
        '${ADMIN_ID}', 'matematica-a', 'Qual o valor de sin(pi/6)?',
        'multiple_choice', '["1/2", "sqrt(3)/2", "sqrt(2)/2", "1"]'::jsonb,
        '1/2', '{"correct_option_index": 0}'::jsonb,
        4.00, true, 'published', 'P2', 'admin'
      ) RETURNING id;
    `);
    exP2Id = r2.rows[0].id;

    // Exercício P3 (Probabilidades e Combinatória)
    const r3 = await db.query<{ id: string }>(`
      INSERT INTO public.exercises (
        user_id, subject_id, prompt, question_type, options, correct_answer, 
        scoring_rubric, max_points, is_official, status, academic_period, created_by_role
      )
      VALUES (
        '${ADMIN_ID}', 'matematica-a', 'Num saco com 4 bolas azuis e 6 vermelhas...',
        'multiple_choice', '["4/10", "2/5", "1/2", "6/10"]'::jsonb,
        '4/10', '{"correct_option_index": 0}'::jsonb,
        4.00, true, 'published', 'P3', 'admin'
      ) RETURNING id;
    `);
    exP3Id = r3.rows[0].id;

    recordTest('PHA-EXC-01', 'Criação de exercícios oficiais com rastreabilidade documental a official_notes', 'OFFICIAL_EXERCISES_SOURCES', true, 'Exercícios P1, P2 e P3 criados com sucesso');
  } catch (err: any) {
    recordTest('PHA-EXC-01', 'Criação de exercícios oficiais com rastreabilidade documental a official_notes', 'OFFICIAL_EXERCISES_SOURCES', false, err.message);
  } finally {
    await resetSession();
  }

  // Teste 7: Aluno consegue consultar exercícios oficiais publicados e respetivas referências
  try {
    await setSession('authenticated', ALUNO_A_ID);
    const exRes = await db.query(`SELECT * FROM public.exercises WHERE id = '${exP1Id}';`);
    const refRes = await db.query(`SELECT * FROM public.exercise_source_references WHERE exercise_id = '${exP1Id}';`);
    if (exRes.rows.length === 1 && refRes.rows.length === 1) {
      recordTest('PHA-EXC-02', 'Aluno consulta exercício oficial publicado e fontes oficiais por RLS', 'OFFICIAL_EXERCISES_SOURCES', true, 'Permissão de leitura correta para exercícios oficiais');
    } else {
      recordTest('PHA-EXC-02', 'Aluno consulta exercício oficial publicado e fontes oficiais por RLS', 'OFFICIAL_EXERCISES_SOURCES', false, `ex: ${exRes.rows.length}, ref: ${refRes.rows.length}`);
    }
  } catch (err: any) {
    recordTest('PHA-EXC-02', 'Aluno consulta exercício oficial publicado e fontes oficiais por RLS', 'OFFICIAL_EXERCISES_SOURCES', false, err.message);
  } finally {
    await resetSession();
  }

  // ============================================================================
  // BATERIA 4: EXAME OFICIAL ABRANGENDO P1 + P2 + P3
  // ============================================================================
  console.log('\n--- BATERIA 4: EXAME OFICIAL ABRANGENDO P1 + P2 + P3 ---');

  let examId = '';
  try {
    await setSession('authenticated', ADMIN_ID);
    const examRes = await db.query<{ id: string }>(`
      INSERT INTO public.official_exams (
        subject_id, title, description, duration_minutes, total_points, is_published, version, created_by
      )
      VALUES (
        'matematica-a', 'Exame Global Turma C — Matemática A', 'Exame de preparação abrangendo P1, P2 e P3',
        90, 20.00, true, 1, '${ADMIN_ID}'
      ) RETURNING id;
    `);
    examId = examRes.rows[0].id;

    // Associar exercício do P1
    await db.exec(`
      INSERT INTO public.official_exam_exercises (exam_id, exercise_id, period, order_index, allocated_points)
      VALUES ('${examId}', '${exP1Id}', 'P1', 1, 6.00);
    `);

    // Associar exercício do P2
    await db.exec(`
      INSERT INTO public.official_exam_exercises (exam_id, exercise_id, period, order_index, allocated_points)
      VALUES ('${examId}', '${exP2Id}', 'P2', 2, 7.00);
    `);

    // Associar exercício do P3
    await db.exec(`
      INSERT INTO public.official_exam_exercises (exam_id, exercise_id, period, order_index, allocated_points)
      VALUES ('${examId}', '${exP3Id}', 'P3', 3, 7.00);
    `);

    recordTest('PHA-EXM-01', 'Associação de exercícios P1 + P2 + P3 ao Exame Oficial com ordem e cotação', 'EXAM_STRUCTURE_P1_P2_P3', true, `Exame criado: ${examId} com 3 períodos`);
  } catch (err: any) {
    recordTest('PHA-EXM-01', 'Associação de exercícios P1 + P2 + P3 ao Exame Oficial com ordem e cotação', 'EXAM_STRUCTURE_P1_P2_P3', false, err.message);
  } finally {
    await resetSession();
  }

  // Teste 9: Rejeição de ordem de pergunta duplicada no mesmo exame
  try {
    await setSession('authenticated', ADMIN_ID);
    await db.exec(`
      INSERT INTO public.official_exam_exercises (exam_id, exercise_id, period, order_index, allocated_points)
      VALUES ('${examId}', '${exP3Id}', 'P1', 1, 5.00);
    `);
    recordTest('PHA-EXM-02', 'Rejeição de order_index duplicado no mesmo exame', 'EXAM_STRUCTURE_P1_P2_P3', false, 'Permitiu duplicar ordem 1');
  } catch (err: any) {
    recordTest('PHA-EXM-02', 'Rejeição de order_index duplicado no mesmo exame', 'EXAM_STRUCTURE_P1_P2_P3', true, 'Rejeitado por restrição uq_exam_exercise_order');
  } finally {
    await resetSession();
  }

  // ============================================================================
  // BATERIA 5: PRIMEIRA TENTATIVA OFICIAL E IMUTABILIDADE
  // ============================================================================
  console.log('\n--- BATERIA 5: PRIMEIRA TENTATIVA OFICIAL E IMUTABILIDADE ---');

  // Teste 10: Tentativa de inserção direta por aluno comum (sem contexto do sistema) -> Bloqueado
  try {
    await setSession('authenticated', ALUNO_A_ID, false);
    await db.exec(`
      INSERT INTO public.official_first_attempts (
        user_id, assessment_type, assessment_id, score_achieved, max_score, score_percentage, score_scale_20
      )
      VALUES ('${ALUNO_A_ID}', 'exam', '${examId}', 20.00, 20.00, 100.00, 20.00);
    `);
    recordTest('PHA-ATT-01', 'Aluno bloqueado de forjar 1.ª tentativa via INSERT direto sem contexto de sistema', 'ANTI_TAMPERING', false, 'Conseguiu forjar inserção');
  } catch (err: any) {
    recordTest('PHA-ATT-01', 'Aluno bloqueado de forjar 1.ª tentativa via INSERT direto sem contexto de sistema', 'ANTI_TAMPERING', true, 'Bloqueado por trigger protect_first_attempt_insert');
  } finally {
    await resetSession();
  }

  // Teste 11: Registo legítimo da 1.ª Tentativa Oficial pelo Servidor no término da sessão
  let firstAttemptId = '';
  try {
    await setSession('authenticated', ALUNO_A_ID, true);
    const res = await db.query<{ id: string }>(`
      INSERT INTO public.official_first_attempts (
        user_id, assessment_type, assessment_id, score_achieved, max_score, score_percentage, score_scale_20
      )
      VALUES ('${ALUNO_A_ID}', 'exam', '${examId}', 17.50, 20.00, 87.50, 17.50)
      RETURNING id;
    `);
    firstAttemptId = res.rows[0].id;
    recordTest('PHA-ATT-02', 'Registo atómico e legítimo da 1.ª tentativa oficial pelo servidor', 'FIRST_ATTEMPT_INTEGRITY', true, `Tentativa registada: ${firstAttemptId}`);
  } catch (err: any) {
    recordTest('PHA-ATT-02', 'Registo atómico e legítimo da 1.ª tentativa oficial pelo servidor', 'FIRST_ATTEMPT_INTEGRITY', false, err.message);
  } finally {
    await resetSession();
  }

  // Teste 12: Inviolabilidade: Inserção de uma segunda tentativa oficial para o mesmo exame é rejeitada
  try {
    await setSession('authenticated', ALUNO_A_ID, true);
    await db.exec(`
      INSERT INTO public.official_first_attempts (
        user_id, assessment_type, assessment_id, score_achieved, max_score, score_percentage, score_scale_20
      )
      VALUES ('${ALUNO_A_ID}', 'exam', '${examId}', 20.00, 20.00, 100.00, 20.00);
    `);
    recordTest('PHA-ATT-03', 'Bloqueio de substituição da 1.ª tentativa oficial (prevenção de sobrescrita)', 'FIRST_ATTEMPT_INTEGRITY', false, 'Permitiu inserir segunda tentativa');
  } catch (err: any) {
    recordTest('PHA-ATT-03', 'Bloqueio de substituição da 1.ª tentativa oficial (prevenção de sobrescrita)', 'FIRST_ATTEMPT_INTEGRITY', true, 'Rejeitado por restrição uq_user_assessment_first_attempt');
  } finally {
    await resetSession();
  }

  // Teste 13: Imutabilidade Estrita: Proibição de UPDATE de pontuação em official_first_attempts
  try {
    await setSession('authenticated', ALUNO_A_ID, true);
    await db.exec(`
      UPDATE public.official_first_attempts
      SET score_achieved = 20.00, score_percentage = 100.00, score_scale_20 = 20.00
      WHERE id = '${firstAttemptId}';
    `);
    recordTest('PHA-ATT-04', 'Trigger impede qualquer alteração (UPDATE) à pontuação da 1.ª tentativa oficial', 'FIRST_ATTEMPT_INTEGRITY', false, 'Permitiu alterar pontuação oficial');
  } catch (err: any) {
    recordTest('PHA-ATT-04', 'Trigger impede qualquer alteração (UPDATE) à pontuação da 1.ª tentativa oficial', 'FIRST_ATTEMPT_INTEGRITY', true, 'Rejeitado por protect_official_first_attempt_immutability');
  } finally {
    await resetSession();
  }

  // Teste 14: Cross-Tenant IDOR: Aluno B não consegue consultar a tentativa de Aluno A
  try {
    await setSession('authenticated', ALUNO_B_ID);
    const res = await db.query(`SELECT * FROM public.official_first_attempts WHERE user_id = '${ALUNO_A_ID}';`);
    if (res.rows.length === 0) {
      recordTest('PHA-ISO-01', 'Isolamento Cross-Tenant: Aluno B não consegue consultar a 1.ª tentativa de Aluno A', 'CROSS_TENANT_ISOLATION', true, '0 linhas visíveis');
    } else {
      recordTest('PHA-ISO-01', 'Isolamento Cross-Tenant: Aluno B não consegue consultar a 1.ª tentativa de Aluno A', 'CROSS_TENANT_ISOLATION', false, `Viu ${res.rows.length} linhas de Aluno A`);
    }
  } catch (err: any) {
    recordTest('PHA-ISO-01', 'Isolamento Cross-Tenant: Aluno B não consegue consultar a 1.ª tentativa de Aluno A', 'CROSS_TENANT_ISOLATION', false, err.message);
  } finally {
    await resetSession();
  }

  // Teste 15: Proteção da estrutura de exame publicado com tentativas de alunos
  try {
    await setSession('authenticated', ADMIN_ID);
    await db.exec(`
      DELETE FROM public.official_exam_exercises WHERE exam_id = '${examId}' AND exercise_id = '${exP1Id}';
    `);
    recordTest('PHA-EXM-03', 'Imutabilidade estrutural de exame publicado com tentativas de alunos', 'EXAM_STRUCTURE_P1_P2_P3', false, 'Permitiu alterar estrutura de exame com tentativas');
  } catch (err: any) {
    recordTest('PHA-EXM-03', 'Imutabilidade estrutural de exame publicado com tentativas de alunos', 'EXAM_STRUCTURE_P1_P2_P3', true, 'Bloqueado por trigger protect_published_exam_immutability');
  } finally {
    await resetSession();
  }

  // ============================================================================
  // BATERIA 6: DOMÍNIO E RESTRIÇÕES DE INTEGRIDADE
  // ============================================================================
  console.log('\n--- BATERIA 6: DOMÍNIO E RESTRIÇÕES DE INTEGRIDADE ---');

  // Teste 16: Período inválido ('P4') em official_notes rejeitado por CHECK
  try {
    await db.exec(`
      INSERT INTO public.official_notes (subject_id, academic_period, theme, title, is_published, created_by)
      VALUES ('matematica-a', 'P4', 'Tema Inexistente', 'Titulo', false, '${ADMIN_ID}');
    `);
    recordTest('PHA-DOM-01', 'Rejeição de período inválido (P4) por restrição CHECK', 'DOMAIN_CONSTRAINTS', false, 'Permitiu período P4');
  } catch (err: any) {
    recordTest('PHA-DOM-01', 'Rejeição de período inválido (P4) por restrição CHECK', 'DOMAIN_CONSTRAINTS', true, 'Rejeitado por CHECK academic_period IN (P1, P2, P3)');
  }

  // Teste 17: Disciplina inexistente em official_notes rejeitada por FK
  try {
    await db.exec(`
      INSERT INTO public.official_notes (subject_id, academic_period, theme, title, is_published, created_by)
      VALUES ('disciplina-fantasma', 'P1', 'Tema', 'Titulo', false, '${ADMIN_ID}');
    `);
    recordTest('PHA-DOM-02', 'Rejeição de disciplina inexistente por Foreign Key', 'DOMAIN_CONSTRAINTS', false, 'Permitiu disciplina inexistente');
  } catch (err: any) {
    recordTest('PHA-DOM-02', 'Rejeição de disciplina inexistente por Foreign Key', 'DOMAIN_CONSTRAINTS', true, 'Rejeitado por FOREIGN KEY REFERENCES subjects(id)');
  }

  // Teste 18: Rollback atómico em transação com falha
  try {
    await db.exec(`
      BEGIN;
      INSERT INTO public.official_exercise_sets (id, subject_id, academic_period, title, created_by)
      VALUES ('99999999-9999-4999-8999-999999999999', 'matematica-a', 'P1', 'Conjunto Temporário', '${ADMIN_ID}');
      -- Falha intencional de FK
      INSERT INTO public.official_set_exercises (set_id, exercise_id, order_index)
      VALUES ('99999999-9999-4999-8999-999999999999', '00000000-0000-0000-0000-000000000000', 1);
      COMMIT;
    `);
    recordTest('PHA-TX-01', 'Transacionalidade e Rollback automático em caso de anomalia', 'TRANSACTION_ROLLBACK', false, 'Transação não falhou');
  } catch (err: any) {
    await db.exec(`ROLLBACK;`);
    // Verificar que o conjunto não ficou gravado a meio
    const verify = await db.query(`SELECT * FROM public.official_exercise_sets WHERE id = '99999999-9999-4999-8999-999999999999';`);
    if (verify.rows.length === 0) {
      recordTest('PHA-TX-01', 'Transacionalidade e Rollback automático em caso de anomalia', 'TRANSACTION_ROLLBACK', true, 'Rollback limpo sem registos órfãos');
    } else {
      recordTest('PHA-TX-01', 'Transacionalidade e Rollback automático em caso de anomalia', 'TRANSACTION_ROLLBACK', false, 'Conjunto ficou gravado após falha');
    }
  }

  // ============================================================================
  // BATERIA 7: LEADERBOARD DA TURMA C E TRANSIÇÃO
  // ============================================================================
  console.log('\n--- BATERIA 7: LEADERBOARD DA TURMA C E TRANSIÇÃO ---');

  // Preparar dados de Aluno B (com streak e segunda nota)
  await db.exec(`
    UPDATE public.study_stats SET streak_days = 5 WHERE user_id = '${ALUNO_A_ID}';
    UPDATE public.study_stats SET streak_days = 8 WHERE user_id = '${ALUNO_B_ID}';
  `);

  // Registar tentativa oficial para Aluno B com 95%
  try {
    await setSession('authenticated', ALUNO_B_ID, true);
    await db.exec(`
      INSERT INTO public.official_first_attempts (
        user_id, assessment_type, assessment_id, score_achieved, max_score, score_percentage, score_scale_20
      )
      VALUES ('${ALUNO_B_ID}', 'exam', '${examId}', 19.00, 20.00, 95.00, 19.00);
    `);
  } finally {
    await resetSession();
  }

  // Teste 19: Leaderboard da Turma C ordenado por Média % e Streak
  try {
    const lb = await db.query<any>(`SELECT * FROM public.get_turma_c_leaderboard();`);
    const rows = lb.rows;
    // Aluno B (95%) deve estar em 1.º lugar, Aluno A (87.5%) em 2.º lugar
    if (rows.length >= 2 && rows[0].user_id === ALUNO_B_ID && Number(rows[0].average_percentage) === 95.00 &&
        rows[1].user_id === ALUNO_A_ID && Number(rows[1].average_percentage) === 87.50) {
      recordTest('PHA-LDB-01', 'Leaderboard Turma C calcula média percentual normalizada e streak com ordenação correta', 'TURMA_C_LEADERBOARD', true, `1º: ${rows[0].full_name} (${rows[0].average_percentage}%), 2º: ${rows[1].full_name} (${rows[1].average_percentage}%)`);
    } else {
      recordTest('PHA-LDB-01', 'Leaderboard Turma C calcula média percentual normalizada e streak com ordenação correta', 'TURMA_C_LEADERBOARD', false, JSON.stringify(rows));
    }
  } catch (err: any) {
    recordTest('PHA-LDB-01', 'Leaderboard Turma C calcula média percentual normalizada e streak com ordenação correta', 'TURMA_C_LEADERBOARD', false, err.message);
  }

  // Teste 20: Aluno sem tentativas oficiais tem média 0.00 e is_eligible = false sem quebrar a query
  try {
    const NOVO_ALUNO_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    await db.exec(`
      INSERT INTO auth.users (id, email, raw_user_meta_data)
      VALUES ('${NOVO_ALUNO_ID}', 'novo.aluno@studentshub.pt', '{"full_name": "Carlos Novo"}'::jsonb);
    `);

    const lb = await db.query<any>(`SELECT * FROM public.get_turma_c_leaderboard() WHERE user_id = '${NOVO_ALUNO_ID}';`);
    if (lb.rows.length === 1 && lb.rows[0].is_eligible === false && Number(lb.rows[0].average_percentage) === 0) {
      recordTest('PHA-LDB-02', 'Aluno sem tentativas oficiais é tratado com 0.00% e is_eligible = false', 'TURMA_C_LEADERBOARD', true, 'Tratamento gracioso sem divisão por zero ou nulos espúrios');
    } else {
      recordTest('PHA-LDB-02', 'Aluno sem tentativas oficiais é tratado com 0.00% e is_eligible = false', 'TURMA_C_LEADERBOARD', false, JSON.stringify(lb.rows));
    }
  } catch (err: any) {
    recordTest('PHA-LDB-02', 'Aluno sem tentativas oficiais é tratado com 0.00% e is_eligible = false', 'TURMA_C_LEADERBOARD', false, err.message);
  }

  // Teste 21: Perfis atualizados com class_name = 'Turma C'
  try {
    const profs = await db.query<any>(`SELECT count(*) as total, count(*) filter (where class_name = 'Turma C') as turma_c_count FROM public.profiles;`);
    if (profs.rows[0].total === profs.rows[0].turma_c_count && Number(profs.rows[0].total) > 0) {
      recordTest('PHA-TRM-01', 'Transição para Turma C: 100% dos perfis têm class_name = "Turma C" com retrocompatibilidade', 'TURMA_C_LEADERBOARD', true, `${profs.rows[0].turma_c_count}/${profs.rows[0].total} perfis`);
    } else {
      recordTest('PHA-TRM-01', 'Transição para Turma C: 100% dos perfis têm class_name = "Turma C" com retrocompatibilidade', 'TURMA_C_LEADERBOARD', false, JSON.stringify(profs.rows));
    }
  } catch (err: any) {
    recordTest('PHA-TRM-01', 'Transição para Turma C: 100% dos perfis têm class_name = "Turma C" com retrocompatibilidade', 'TURMA_C_LEADERBOARD', false, err.message);
  }

  // ============================================================================
  // RELATÓRIO FINAL
  // ============================================================================
  console.log('\n================================================================');
  console.log('RELATÓRIO DE RESULTADOS — FASE A: SCHEMA E MIGRAÇÃO TURMA C');
  console.log('================================================================');
  const total = testResults.length;
  const passed = testResults.filter(r => r.passed).length;
  const failed = total - passed;

  console.log(`Total de Testes Executados: ${total}`);
  console.log(`Sucessos: ${passed}`);
  console.log(`Falhas: ${failed}`);
  console.log(`Taxa de Aprovação: ${(passed / total * 100).toFixed(1)}%`);

  if (failed > 0) {
    console.error('\n❌ ALGUNS TESTES FALHARAM:');
    testResults.filter(r => !r.passed).forEach(r => console.error(` - [${r.id}] ${r.name}: ${r.details}`));
    process.exit(1);
  } else {
    console.log('\n🎉 SUCESSO TOTAL: Todos os 21 testes da Fase A passaram com 100% de conformidade!');
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runPhaseATests().catch(err => {
    console.error('Erro fatal ao executar testes da Fase A:', err);
    process.exit(1);
  });
}
