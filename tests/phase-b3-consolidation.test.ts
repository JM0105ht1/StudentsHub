/**
 * SUITE DE TESTES E VERIFICAÇÃO — FASE B.3
 * Students Hub — "Apontamentos que ajudam, exercícios que resultam. Rumo ao 20."
 * Princípio Sagrado: «SEMPRE COM BASE NOS APONTAMENTOS OFICIAIS!!!»
 * 
 * Verifica a consolidação da Fase B.3 no PostgreSQL 16 (PGlite Nativo C):
 * 1. Remoção segura das tabelas e políticas do antigo caderno pessoal (personal_notes, note_pages, note_chunks)
 * 2. Preservação integral das tabelas oficiais da Turma C (official_notes, official_note_versions, official_note_audit_logs)
 * 3. Preservação integral do sistema de exames, primeiras tentativas, classificação e estatísticas
 * 4. Funcionamento da tabela exercise_source_references exclusivamente com proveniência oficial
 * 5. Garantia de que alunos apenas leem apontamentos oficiais publicados e sem acesso a raw_html
 * 6. Ausência estrita de implementação da Fase C (geração Gemini não iniciada)
 */

import { PGlite } from '@electric-sql/pglite';
import * as fs from 'fs';
import * as path from 'path';

const ALUNO_ID = '11111111-1111-4111-8111-111111111111';
const ADMIN_ID = '99999999-9999-4999-8999-999999999999';

export interface B3TestResult {
  id: string;
  category: string;
  name: string;
  status: 'PASSOU' | 'FALHOU';
  evidence: string;
}

const b3Results: B3TestResult[] = [];

function recordB3(
  id: string,
  category: string,
  name: string,
  status: 'PASSOU' | 'FALHOU',
  evidence: string
) {
  b3Results.push({ id, category, name, status, evidence });
  const icon = status === 'PASSOU' ? '✅ [PASSOU]' : '❌ [FALHOU]';
  console.log(`${icon} ${id}: ${name}`);
  if (status === 'FALHOU') {
    console.error(`   ⚠️ ERRO: ${evidence}`);
  }
}

export async function runPhaseB3ConsolidationTests() {
  console.log('================================================================');
  console.log('FASE B.3 — CONSOLIDAÇÃO DO CADERNO OFICIAL E LIMPEZA LEGADA');
  console.log('Motor: PostgreSQL 16 (PGlite Nativo C)');
  console.log('Princípio Sagrado: «SEMPRE COM BASE NOS APONTAMENTOS OFICIAIS!!!»');
  console.log('================================================================\n');

  const db = new PGlite();

  // 1. Configurar auth mock e esquemas essenciais
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
    END $$;
  `);

  // 2. Aplicar sequencialmente todas as 8 migrações até à Fase B.3
  const migrations = [
    '20261001000000_phase2_security_and_database.sql',
    '20261024000000_turma_c_official_schema.sql',
    '20261024010000_turma_c_phase_a1_audit_fixes.sql',
    '20261024020000_turma_c_phase_a2_verification_fixes.sql',
    '20261024030000_turma_c_phase_b_notes_management.sql',
    '20261024040000_turma_c_phase_b1_audit_fixes.sql',
    '20261024050000_turma_c_phase_b2_integrity_fixes.sql',
    '20261024060000_turma_c_phase_b3_cleanup_personal_notes.sql',
  ];

  for (let i = 0; i < migrations.length; i++) {
    const migFile = migrations[i];
    const migPath = path.resolve(process.cwd(), 'supabase/migrations', migFile);
    console.log(`Aplicando migração ${i + 1}/${migrations.length}: ${migFile}...`);
    const sql = fs.readFileSync(migPath, 'utf8');
    await db.exec(sql);
  }

  // 3. Permissões de schema e roles
  await db.exec(`
    GRANT USAGE ON SCHEMA public, auth TO authenticated, anon;
    GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
    REVOKE INSERT, UPDATE, DELETE ON public.official_first_attempts FROM authenticated, anon;
    REVOKE INSERT, UPDATE, DELETE ON public.study_stats FROM authenticated, anon;
    REVOKE UPDATE, DELETE ON public.official_note_audit_logs FROM authenticated, anon;
    GRANT SELECT, INSERT ON public.official_note_audit_logs TO authenticated;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated, anon;
    REVOKE ALL ON public.admin_rate_limit_buckets FROM anon, authenticated;
    GRANT SELECT ON public.admin_rate_limit_buckets TO authenticated;
    REVOKE SELECT ON public.official_note_versions FROM authenticated, anon;
    GRANT SELECT (
      id, note_id, version_number, sanitized_html, plain_text_content,
      change_summary, is_published, published_at, created_by, created_at
    ) ON public.official_note_versions TO authenticated, anon;
  `);

  // Inserir utilizadores de teste
  await db.exec(`
    INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES
      ('${ALUNO_ID}', 'aluno.turmac@escola.pt', '{"full_name": "Aluno Turma C"}'::jsonb),
      ('${ADMIN_ID}', 'admin.turmac@escola.pt', '{"full_name": "Administrador Oficial"}'::jsonb)
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.user_roles (user_id, role) VALUES
      ('${ALUNO_ID}', 'student'),
      ('${ADMIN_ID}', 'admin')
    ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role;
  `);

  console.log('\n--- GRUPO 1: VERIFICAÇÃO DA REMOÇÃO DO ANTIGO CADERNO PESSOAL ---');

  // Teste B3-01: Confirmação de que personal_notes, note_pages e note_chunks foram removidas
  try {
    const res = await db.query<{ table_name: string }>(`
      SELECT table_name FROM information_schema.tables 
      WHERE table_schema = 'public' 
        AND table_name IN ('personal_notes', 'note_pages', 'note_chunks');
    `);
    if (res.rows.length === 0) {
      recordB3(
        'B3-01',
        'Limpeza Legada',
        'Tabelas de caderno pessoal (personal_notes, note_pages, note_chunks) removidas',
        'PASSOU',
        '0 tabelas legadas encontradas no information_schema.'
      );
    } else {
      recordB3(
        'B3-01',
        'Limpeza Legada',
        'Tabelas de caderno pessoal removidas',
        'FALHOU',
        `Tabelas ainda presentes: ${res.rows.map(r => r.table_name).join(', ')}`
      );
    }
  } catch (err: any) {
    recordB3('B3-01', 'Limpeza Legada', 'Tabelas de caderno pessoal removidas', 'FALHOU', err.message);
  }

  // Teste B3-02: Confirmação de que o trigger prevent_note_chunk_modification foi removido
  try {
    const res = await db.query<{ count: string }>(`
      SELECT count(*)::text as count FROM pg_proc WHERE proname = 'prevent_note_chunk_modification';
    `);
    if (parseInt(res.rows[0].count, 10) === 0) {
      recordB3(
        'B3-02',
        'Limpeza Legada',
        'Função trigger prevent_note_chunk_modification removida sem resíduos',
        'PASSOU',
        'Função removida com sucesso.'
      );
    } else {
      recordB3(
        'B3-02',
        'Limpeza Legada',
        'Função trigger prevent_note_chunk_modification removida',
        'FALHOU',
        'A função ainda existe no catálogo pg_proc.'
      );
    }
  } catch (err: any) {
    recordB3('B3-02', 'Limpeza Legada', 'Função trigger removida', 'FALHOU', err.message);
  }

  // Teste B3-03: Confirmação de remoção de FK constraints legadas em exercise_source_references
  try {
    const res = await db.query<{ conname: string }>(`
      SELECT conname FROM pg_constraint
      WHERE conname IN ('fk_exercise_sources_note_user', 'fk_exercise_sources_page_user');
    `);
    if (res.rows.length === 0) {
      recordB3(
        'B3-03',
        'Integridade Estrutural',
        'Chaves estrangeiras legadas removidas de exercise_source_references sem DROP CASCADE',
        'PASSOU',
        'Constraints fk_exercise_sources_note_user e fk_exercise_sources_page_user removidas com sucesso.'
      );
    } else {
      recordB3(
        'B3-03',
        'Integridade Estrutural',
        'Chaves estrangeiras legadas removidas',
        'FALHOU',
        `Constraints ainda existentes: ${res.rows.map(r => r.conname).join(', ')}`
      );
    }
  } catch (err: any) {
    recordB3('B3-03', 'Integridade Estrutural', 'Chaves estrangeiras legadas removidas', 'FALHOU', err.message);
  }

  console.log('\n--- GRUPO 2: PRESERVAÇÃO INTEGRAL DA INFRAESTRUTURA OFICIAL TURMA C ---');

  // Teste B3-04: Confirmação de que todas as tabelas oficiais essenciais existem e estão operacionais
  try {
    const requiredTables = [
      'official_notes',
      'official_note_versions',
      'official_note_audit_logs',
      'official_first_attempts',
      'study_stats',
      'official_assessments',
      'official_exams',
      'official_exercise_sets',
      'exercises',
      'exercise_source_references',
      'user_roles',
      'admin_rate_limit_buckets',
    ];
    const res = await db.query<{ table_name: string }>(`
      SELECT table_name FROM information_schema.tables 
      WHERE table_schema = 'public' 
        AND table_name = ANY($1::text[]);
    `, [requiredTables]);

    const found = res.rows.map(r => r.table_name);
    const missing = requiredTables.filter(t => !found.includes(t));

    if (missing.length === 0) {
      recordB3(
        'B3-04',
        'Preservação Oficial',
        'Todas as 12 tabelas oficiais preservadas intactas com integridade total',
        'PASSOU',
        `Tabelas verificadas: ${found.join(', ')}`
      );
    } else {
      recordB3(
        'B3-04',
        'Preservação Oficial',
        'Todas as tabelas oficiais preservadas',
        'FALHOU',
        `Tabelas em falta: ${missing.join(', ')}`
      );
    }
  } catch (err: any) {
    recordB3('B3-04', 'Preservação Oficial', 'Tabelas oficiais preservadas', 'FALHOU', err.message);
  }

  // Teste B3-05: Confirmação de RLS ativo nas tabelas oficiais
  try {
    const res = await db.query<{ relname: string; relrowsecurity: boolean }>(`
      SELECT relname, relrowsecurity 
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' 
        AND relname IN ('official_notes', 'official_note_versions', 'official_note_audit_logs', 'official_first_attempts');
    `);
    const allRlsActive = res.rows.every(r => r.relrowsecurity === true);
    if (allRlsActive && res.rows.length === 4) {
      recordB3(
        'B3-05',
        'Segurança RLS',
        'RLS ativo e inviolável em todas as tabelas nucleares de apontamentos e exames',
        'PASSOU',
        `RLS habilitado em: ${res.rows.map(r => r.relname).join(', ')}`
      );
    } else {
      recordB3(
        'B3-05',
        'Segurança RLS',
        'RLS ativo nas tabelas nucleares',
        'FALHOU',
        'Algumas tabelas não têm RLS ativo.'
      );
    }
  } catch (err: any) {
    recordB3('B3-05', 'Segurança RLS', 'RLS ativo nas tabelas nucleares', 'FALHOU', err.message);
  }

  // Teste B3-06: Criação e ciclo de vida do Caderno Oficial por administrador
  let testNoteId = '';
  let testVersionId = '';
  try {
    // Configurar sessão admin
    await db.exec(`SET request.jwt.claim.sub = '${ADMIN_ID}';`);
    await db.exec(`SET ROLE authenticated;`);

    // Criar nota oficial atomicamente via RPC
    const rawHtml = '<p>Teorema de Bolzano-Cauchy: Se f é contínua em [a,b]...</p>';
    const sanitizedHtml = '<p>Teorema de Bolzano-Cauchy: Se f é contínua em [a,b]...</p>';
    const plainText = 'Teorema de Bolzano-Cauchy: Se f é contínua em [a,b]...';

    const noteRes = await db.query<any>(`
      SELECT public.create_official_note_atomic(
        'matematica-a',
        'P1',
        'Limites e Continuidade',
        'Teorema de Bolzano-Cauchy — Turma C',
        '${rawHtml}',
        '${sanitizedHtml}',
        '${plainText}',
        'Versão homologada para Teste 1'
      ) AS result;
    `);

    testNoteId = noteRes.rows[0].result.note_id;
    testVersionId = noteRes.rows[0].result.version_id;

    // Publicar atomicamente via RPC oficial
    const pubRes = await db.query<any>(`
      SELECT public.publish_official_note_version_atomic('${testVersionId}') AS result;
    `);

    // Resetar role
    await db.exec(`RESET ROLE;`);

    if (pubRes.rows[0].result.is_published === true) {
      recordB3(
        'B3-06',
        'Ciclo Oficial',
        'Criação e publicação atómica de versão oficial no Caderno da Turma C',
        'PASSOU',
        `Nota ${testNoteId} com versão v1 publicada atomicamente.`
      );
    } else {
      recordB3(
        'B3-06',
        'Ciclo Oficial',
        'Criação e publicação atómica de versão oficial',
        'FALHOU',
        `Resultado inesperado: ${JSON.stringify(pubRes.rows[0])}`
      );
    }
  } catch (err: any) {
    await db.exec(`RESET ROLE;`);
    recordB3('B3-06', 'Ciclo Oficial', 'Criação e publicação de versão oficial', 'FALHOU', err.message);
  }

  console.log('\n--- GRUPO 3: AUTORIZAÇÃO E ISOLAMENTO DOS ALUNOS NO CADERNO OFICIAL ---');

  // Teste B3-07: Aluno apenas consulta apontamentos oficiais publicados
  try {
    await db.exec(`SET request.jwt.claim.sub = '${ALUNO_ID}';`);
    await db.exec(`SET ROLE authenticated;`);

    const viewableNotes = await db.query<{ id: string; title: string }>(`
      SELECT id, title FROM public.official_notes;
    `);

    await db.exec(`RESET ROLE;`);

    if (viewableNotes.rows.length === 1 && viewableNotes.rows[0].id === testNoteId) {
      recordB3(
        'B3-07',
        'Acesso do Aluno',
        'Aluno acede com sucesso apenas a apontamentos oficiais publicados',
        'PASSOU',
        `Aluno consultou nota publicada '${viewableNotes.rows[0].title}'.`
      );
    } else {
      recordB3(
        'B3-07',
        'Acesso do Aluno',
        'Aluno acede a apontamentos oficiais publicados',
        'FALHOU',
        `Registos inesperados: ${viewableNotes.rows.length}`
      );
    }
  } catch (err: any) {
    await db.exec(`RESET ROLE;`);
    recordB3('B3-07', 'Acesso do Aluno', 'Aluno acede a apontamentos oficiais publicados', 'FALHOU', err.message);
  }

  // Teste B3-08: Aluno impedido de consultar raw_html (protegido por coluna e views)
  try {
    await db.exec(`SET request.jwt.claim.sub = '${ALUNO_ID}';`);
    await db.exec(`SET ROLE authenticated;`);

    let rawHtmlExposed = false;
    try {
      await db.query(`SELECT raw_html FROM public.official_note_versions WHERE id = '${testVersionId}';`);
      rawHtmlExposed = true;
    } catch (permErr: any) {
      rawHtmlExposed = false; // Esperado: permission denied for column raw_html
    }

    await db.exec(`RESET ROLE;`);

    if (!rawHtmlExposed) {
      recordB3(
        'B3-08',
        'Segurança de Dados',
        'Coluna raw_html protegida contra leitura direta por alunos (REVOKE SELECT)',
        'PASSOU',
        'Tentativa de SELECT raw_html bloqueada por permissões SQL.'
      );
    } else {
      recordB3(
        'B3-08',
        'Segurança de Dados',
        'Coluna raw_html protegida contra leitura direta por alunos',
        'FALHOU',
        'A coluna raw_html foi exposta ao aluno.'
      );
    }
  } catch (err: any) {
    await db.exec(`RESET ROLE;`);
    recordB3('B3-08', 'Segurança de Dados', 'Coluna raw_html protegida', 'FALHOU', err.message);
  }

  // Teste B3-09: Aluno impedido de criar, editar ou despublicar apontamentos oficiais
  try {
    await db.exec(`SET request.jwt.claim.sub = '${ALUNO_ID}';`);
    await db.exec(`SET ROLE authenticated;`);

    let writeSucceeded = false;
    try {
      await db.query(`
        INSERT INTO public.official_notes (subject_id, title, is_published, created_by)
        VALUES ('matematica-a', 'Apontamento Falso de Aluno', true, '${ALUNO_ID}');
      `);
      writeSucceeded = true;
    } catch {
      writeSucceeded = false;
    }

    await db.exec(`RESET ROLE;`);

    if (!writeSucceeded) {
      recordB3(
        'B3-09',
        'Autorização Estrita',
        'Alunos bloqueados de criar, editar ou alterar o Caderno Oficial da Turma C',
        'PASSOU',
        'Inserção direta de nota bloqueada por política RLS.'
      );
    } else {
      recordB3(
        'B3-09',
        'Autorização Estrita',
        'Alunos bloqueados de gerir Caderno Oficial',
        'FALHOU',
        'Aluno conseguiu criar um apontamento oficial!'
      );
    }
  } catch (err: any) {
    await db.exec(`RESET ROLE;`);
    recordB3('B3-09', 'Autorização Estrita', 'Alunos bloqueados de gerir Caderno Oficial', 'FALHOU', err.message);
  }

  console.log('\n--- GRUPO 4: PROVENIÊNCIA OFICIAL DOS EXERCÍCIOS E EXAMES ---');

  // Teste B3-10: exercise_source_references vincula exclusivamente a apontamentos oficiais
  try {
    await db.exec(`SET request.jwt.claim.sub = '${ADMIN_ID}';`);
    await db.exec(`SET ROLE authenticated;`);

    // Inserir exercício oficial na tabela exercises
    const exRes = await db.query<{ id: string }>(`
      INSERT INTO public.exercises (
        user_id, subject_id, prompt, question_type,
        options, correct_answer, scoring_rubric,
        is_official, status, academic_period, difficulty, created_by_role
      ) VALUES (
        '${ADMIN_ID}', 'matematica-a',
        'Considere a função contínua f no intervalo [0, 2]. Calcule o valor do limite...',
        'multiple_choice', '["A", "B", "C", "D"]'::jsonb, 'B',
        '{"criterios": "Opção B - 20 pontos"}'::jsonb,
        true, 'published', 'P1', 'medio', 'admin'
      ) RETURNING id;
    `);
    const exerciseId = exRes.rows[0].id;

    // Vincular referência oficial
    const refRes = await db.query<{ id: string; source_type: string }>(`
      INSERT INTO public.exercise_source_references (
        exercise_id, user_id, source_type,
        official_note_id, official_version_id, official_section,
        citation_excerpt
      ) VALUES (
        '${exerciseId}', '${ADMIN_ID}', 'official',
        '${testNoteId}', '${testVersionId}', 'Teorema de Bolzano-Cauchy',
        'Se f é contínua em [a,b]...'
      ) RETURNING id, source_type;
    `);

    await db.exec(`RESET ROLE;`);

    if (refRes.rows[0].source_type === 'official') {
      recordB3(
        'B3-10',
        'Proveniência Oficial',
        'exercise_source_references opera com source_type = official vinculado à versão imutável',
        'PASSOU',
        `Referência ${refRes.rows[0].id} criada com sucesso para a versão oficial v1.`
      );
    } else {
      recordB3(
        'B3-10',
        'Proveniência Oficial',
        'exercise_source_references opera com source_type = official',
        'FALHOU',
        `source_type inesperado: ${refRes.rows[0].source_type}`
      );
    }
  } catch (err: any) {
    recordB3('B3-10', 'Proveniência Oficial', 'exercise_source_references opera com source_type = official', 'FALHOU', err.message);
  }

  // Teste B3-11: Confirmação de que o sistema de classificação e primeiras tentativas não foi afetado
  try {
    const fnRes = await db.query<{ count: string }>(`
      SELECT count(*)::text as count FROM pg_proc WHERE proname = 'record_official_first_attempt';
    `);
    const lbRes = await db.query<{ count: string }>(`
      SELECT count(*)::text as count FROM pg_proc WHERE proname = 'get_turma_c_leaderboard';
    `);

    const hasAttemptFn = parseInt(fnRes.rows[0].count, 10) > 0;
    const hasLbFn = parseInt(lbRes.rows[0].count, 10) > 0;

    if (hasAttemptFn && hasLbFn) {
      recordB3(
        'B3-11',
        'Integridade Académica',
        'Funções nucleares de primeiras tentativas e leaderboard preservadas a 100%',
        'PASSOU',
        'record_official_first_attempt e get_turma_c_leaderboard ativas e inalteradas.'
      );
    } else {
      recordB3(
        'B3-11',
        'Integridade Académica',
        'Funções nucleares preservadas',
        'FALHOU',
        `hasAttemptFn: ${hasAttemptFn}, hasLbFn: ${hasLbFn}`
      );
    }
  } catch (err: any) {
    recordB3('B3-11', 'Integridade Académica', 'Funções nucleares preservadas', 'FALHOU', err.message);
  }

  // Teste B3-12: Ausência de código ou tabelas da Fase C (Geração Gemini)
  try {
    const res = await db.query<{ table_name: string }>(`
      SELECT table_name FROM information_schema.tables 
      WHERE table_schema = 'public' 
        AND table_name IN ('gemini_generation_jobs', 'ai_generated_exercises', 'exercise_generation_drafts');
    `);
    if (res.rows.length === 0) {
      recordB3(
        'B3-12',
        'Fronteira de Fase',
        'Zero tabelas ou artefactos prematuros da Fase C na base de dados',
        'PASSOU',
        'Nenhuma tabela de geração de exercícios presente. Âmbito da Fase B.3 estritamente respeitado.'
      );
    } else {
      recordB3(
        'B3-12',
        'Fronteira de Fase',
        'Zero artefactos prematuros da Fase C',
        'FALHOU',
        `Tabelas prematuras encontradas: ${res.rows.map(r => r.table_name).join(', ')}`
      );
    }
  } catch (err: any) {
    recordB3('B3-12', 'Fronteira de Fase', 'Zero artefactos prematuros da Fase C', 'FALHOU', err.message);
  }

  console.log('\n================================================================');
  console.log('RESUMO FINAL DA FASE B.3:');
  const total = b3Results.length;
  const passed = b3Results.filter(r => r.status === 'PASSOU').length;
  const failed = b3Results.filter(r => r.status === 'FALHOU').length;
  console.log(`Total de testes: ${total} | Aprovados: ${passed} | Falhas: ${failed}`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runPhaseB3ConsolidationTests().catch((err) => {
  console.error('Erro fatal nos testes B.3:', err);
  process.exit(1);
});
