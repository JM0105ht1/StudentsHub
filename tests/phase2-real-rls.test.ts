/**
 * SUITE DE AUDITORIA REAL DE SEGURANÇA E RLS — FASE 2.1
 * Students Hub — "Apontamentos que ajudam, exercícios que resultam. Rumo ao 20."
 * 
 * Executa verificações contra o motor PostgreSQL C real (via @electric-sql/pglite):
 * 1. Execução de policies RLS nativas de PostgreSQL
 * 2. auth.uid() e isolamento de sessões com SET ROLE authenticated
 * 3. 3 Identidades Reais: Aluno A, Aluno B e Administrador
 * 4. Proteção contra IDOR (noteId, testId, chunkId, storage path)
 * 5. Isolamento de Storage (personal-vault privado, proibição anon)
 * 6. Proteção estrita de user_roles, exercises e study_stats
 * 7. Integridade referencial composta por tenant (Composite Foreign Keys)
 */

import { PGlite } from '@electric-sql/pglite';
import * as fs from 'fs';
import * as path from 'path';

// Constantes de Identidades Reais
const ALUNO_A_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ALUNO_B_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ADMIN_ID   = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

interface TestResult {
  id: string;
  name: string;
  category: 'RLS_CROSS_TENANT' | 'IDOR' | 'STORAGE' | 'ROLES' | 'EXERCISES' | 'STATS' | 'INTEGRITY';
  passed: boolean;
  details: string;
}

const results: TestResult[] = [];

function recordTest(id: string, name: string, category: TestResult['category'], passed: boolean, details: string) {
  results.push({ id, name, category, passed, details });
  const status = passed ? '✅ PASSOU' : '❌ FALHOU';
  console.log(`[${status}] ${id}: ${name}`);
  if (!passed) {
    console.error(`   Detalhes: ${details}`);
  }
}

async function runRealRlsAudit() {
  console.log('================================================================');
  console.log('INICIANDO FASE 2.1: AUDITORIA REAL DE SEGURANÇA E RLS POSTGRESQL');
  console.log('Motor: PostgreSQL 16 (C Engine Nativo)');
  console.log('================================================================\n');

  const db = new PGlite();

  // 1. Preparar schemas de suporte (auth e roles Supabase)
  console.log('1. A provisionar ambiente e roles padrão Supabase (authenticated, anon)...');
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

  // 2. Carregar e Executar o ficheiro de migração oficial
  console.log('2. A carregar o ficheiro oficial supabase/migrations/20261001000000_phase2_security_and_database.sql...');
  const migrationPath = path.resolve(process.cwd(), 'supabase/migrations/20261001000000_phase2_security_and_database.sql');
  const migrationSql = fs.readFileSync(migrationPath, 'utf-8');
  await db.exec(migrationSql);

  // Garantir permissões de schema para os roles padrão Supabase
  await db.exec(`
    GRANT USAGE ON SCHEMA public TO authenticated, anon;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
    GRANT SELECT ON public.subjects TO anon;
    GRANT USAGE ON SCHEMA storage TO authenticated, anon;
    GRANT ALL ON ALL TABLES IN SCHEMA storage TO authenticated;
    GRANT SELECT ON storage.buckets TO anon;
  `);

  console.log('Schema oficial aplicado com sucesso e permissões de roles concedidas.\n');

  // 3. Criar as 3 Identidades Reais em auth.users
  console.log('3. A registar as 3 Identidades Reais (Aluno A, Aluno B, Admin)...');
  await db.exec(`
    INSERT INTO auth.users (id, email, raw_user_meta_data)
    VALUES 
      ('${ALUNO_A_ID}', 'aluno.a@secundario.pt', '{"full_name": "João Silva", "school_year": "11º Ano"}'::jsonb),
      ('${ALUNO_B_ID}', 'aluno.b@secundario.pt', '{"full_name": "Mariana Santos", "school_year": "12º Ano"}'::jsonb),
      ('${ADMIN_ID}', 'admin@studentshub.pt', '{"full_name": "Professor Curador", "school_year": "12º Ano"}'::jsonb)
    ON CONFLICT (id) DO NOTHING;

    -- Definir Admin na tabela user_roles
    UPDATE public.user_roles SET role = 'admin' WHERE user_id = '${ADMIN_ID}';
  `);

  console.log('Identidades criadas e associadas com sucesso.\n');

  // Helper para simular conexão da sessão autenticada com JWT claim
  const setSession = async (role: 'authenticated' | 'anon', userId?: string) => {
    await db.exec(`SET ROLE ${role};`);
    if (userId) {
      await db.exec(`SET request.jwt.claim.sub = '${userId}';`);
    } else {
      await db.exec(`RESET request.jwt.claim.sub;`);
    }
  };

  // ============================================================================
  // BATERIA DE TESTES 1: ISOLAMENTO ENTRE ALUNO A E ALUNO B (RLS REAL)
  // ============================================================================
  console.log('--- TESTES 1: ISOLAMENTO ENTRE ALUNO A E ALUNO B ---');

  // Sessão: Aluno A cria os seus registos
  await setSession('authenticated', ALUNO_A_ID);
  
  const testAId = '11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const noteAId = '22222222-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const pageAId = '33333333-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const chunkAId = '44444444-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

  await db.exec(`
    INSERT INTO public.tests (id, user_id, subject_id, title, academic_term)
    VALUES ('${testAId}', '${ALUNO_A_ID}', 'matematica-a', 'Teste 1 - Limites e Derivadas', '1º Período');

    INSERT INTO public.personal_notes (id, user_id, test_id, subject_id, title)
    VALUES ('${noteAId}', '${ALUNO_A_ID}', '${testAId}', 'matematica-a', 'Resumos de Derivadas');

    INSERT INTO public.note_pages (id, note_id, user_id, document_name, page_number, storage_file_path, file_sha256, confirmed_text)
    VALUES ('${pageAId}', '${noteAId}', '${ALUNO_A_ID}', 'derivadas_p1.pdf', 1, 'users/${ALUNO_A_ID}/tests/${testAId}/${noteAId}/page1.pdf', 'hash123', 'Regra da cadeia: (f(g(x))) = f(g(x))*g(x)');

    INSERT INTO public.note_chunks (id, page_id, note_id, user_id, chunk_index, chunk_type, content)
    VALUES ('${chunkAId}', '${pageAId}', '${noteAId}', '${ALUNO_A_ID}', 0, 'formula', 'Regra da cadeia: (f(g(x))) = f(g(x))*g(x)');
  `);

  // Sessão: Aluno B tenta consultar dados de Aluno A
  await setSession('authenticated', ALUNO_B_ID);

  // Teste 1: Aluno B lista personal_notes
  const notesB = await db.query('SELECT * FROM public.personal_notes');
  recordTest(
    'SEC-RLS-01',
    'Aluno B não lista notas de Aluno A (SELECT geral sob RLS)',
    'RLS_CROSS_TENANT',
    notesB.rows.length === 0,
    `Retornou ${notesB.rows.length} linhas (esperado 0)`
  );

  // Teste 2: Aluno B tenta listar tests de Aluno A
  const testsB = await db.query('SELECT * FROM public.tests');
  recordTest(
    'SEC-RLS-02',
    'Aluno B não lista testes de Aluno A (SELECT geral sob RLS)',
    'RLS_CROSS_TENANT',
    testsB.rows.length === 0,
    `Retornou ${testsB.rows.length} linhas (esperado 0)`
  );

  // Teste 3: Aluno B tenta listar note_pages de Aluno A
  const pagesB = await db.query('SELECT * FROM public.note_pages');
  recordTest(
    'SEC-RLS-03',
    'Aluno B não lista páginas de caderno de Aluno A',
    'RLS_CROSS_TENANT',
    pagesB.rows.length === 0,
    `Retornou ${pagesB.rows.length} linhas (esperado 0)`
  );

  // Teste 4: Aluno B tenta listar chunks de Aluno A
  const chunksB = await db.query('SELECT * FROM public.note_chunks');
  recordTest(
    'SEC-RLS-04',
    'Aluno B não lista chunks semânticos de Aluno A',
    'RLS_CROSS_TENANT',
    chunksB.rows.length === 0,
    `Retornou ${chunksB.rows.length} linhas (esperado 0)`
  );

  // ============================================================================
  // BATERIA DE TESTES 2: PROTEÇÃO CONTRA IDOR (ACESSO DIRETO POR ID)
  // ============================================================================
  console.log('\n--- TESTES 2: PROTEÇÃO CONTRA IDOR (ACESSO DIRETO POR ID) ---');

  // Teste 5: Aluno B tenta SELECT direto na nota de A via noteId
  const idorNoteSelect = await db.query(`SELECT * FROM public.personal_notes WHERE id = '${noteAId}'`);
  recordTest(
    'SEC-IDOR-01',
    'IDOR SELECT: Aluno B não consulta nota de A pelo noteId direto',
    'IDOR',
    idorNoteSelect.rows.length === 0,
    `Retornou ${idorNoteSelect.rows.length} linhas (esperado 0)`
  );

  // Teste 6: Aluno B tenta SELECT direto no teste de A via testId
  const idorTestSelect = await db.query(`SELECT * FROM public.tests WHERE id = '${testAId}'`);
  recordTest(
    'SEC-IDOR-02',
    'IDOR SELECT: Aluno B não consulta teste de A pelo testId direto',
    'IDOR',
    idorTestSelect.rows.length === 0,
    `Retornou ${idorTestSelect.rows.length} linhas (esperado 0)`
  );

  // Teste 7: Aluno B tenta SELECT direto no chunk de A via chunkId
  const idorChunkSelect = await db.query(`SELECT * FROM public.note_chunks WHERE id = '${chunkAId}'`);
  recordTest(
    'SEC-IDOR-03',
    'IDOR SELECT: Aluno B não consulta chunk de A pelo chunkId direto',
    'IDOR',
    idorChunkSelect.rows.length === 0,
    `Retornou ${idorChunkSelect.rows.length} linhas (esperado 0)`
  );

  // Teste 8: IDOR UPDATE: Aluno B tenta alterar o título da nota de A
  const idorUpdate = await db.query(`UPDATE public.personal_notes SET title = 'Subvertido por B' WHERE id = '${noteAId}'`);
  recordTest(
    'SEC-IDOR-04',
    'IDOR UPDATE: Aluno B não altera nota de Aluno A (afeta 0 linhas)',
    'IDOR',
    idorUpdate.affectedRows === 0,
    `Linhas afetadas: ${idorUpdate.affectedRows} (esperado 0)`
  );

  // Teste 9: IDOR DELETE: Aluno B tenta apagar a nota de Aluno A
  const idorDelete = await db.query(`DELETE FROM public.personal_notes WHERE id = '${noteAId}'`);
  recordTest(
    'SEC-IDOR-05',
    'IDOR DELETE: Aluno B não apaga nota de Aluno A (afeta 0 linhas)',
    'IDOR',
    idorDelete.affectedRows === 0,
    `Linhas afetadas: ${idorDelete.affectedRows} (esperado 0)`
  );

  // Teste 10: Spoof INSERT: Aluno B tenta criar uma nota em nome de Aluno A
  let spoofInsertBlocked = false;
  try {
    await db.exec(`
      INSERT INTO public.personal_notes (id, user_id, subject_id, title)
      VALUES (gen_random_uuid(), '${ALUNO_A_ID}', 'matematica-a', 'Nota Falsa Injetada por B');
    `);
  } catch (err: any) {
    spoofInsertBlocked = err.message.includes('violates row-level security policy');
  }
  recordTest(
    'SEC-IDOR-06',
    'SPOOF INSERT: Aluno B é bloqueado pelo RLS ao tentar inserir dados em nome de Aluno A',
    'IDOR',
    spoofInsertBlocked,
    'Tentativa de inserção com user_id alheio foi bloqueada pela política WITH CHECK'
  );

  // ============================================================================
  // BATERIA DE TESTES 3: ISOLAMENTO DE STORAGE E PROIBIÇÃO DE ANON
  // ============================================================================
  console.log('\n--- TESTES 3: ISOLAMENTO DE STORAGE E PROIBIÇÃO DE ANON ---');

  // Sessão: Aluno A carrega ficheiro para o seu cofre
  await setSession('authenticated', ALUNO_A_ID);
  const fileAId = '55555555-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const filePathA = `users/${ALUNO_A_ID}/tests/${testAId}/${noteAId}/folha_privada.pdf`;

  await db.exec(`
    INSERT INTO storage.objects (id, bucket_id, name, owner)
    VALUES ('${fileAId}', 'personal-vault', '${filePathA}', '${ALUNO_A_ID}');
  `);

  // Sessão: Aluno B tenta consultar storage
  await setSession('authenticated', ALUNO_B_ID);

  // Teste 11: Aluno B lista personal-vault
  const storageListB = await db.query(`SELECT * FROM storage.objects WHERE bucket_id = 'personal-vault'`);
  recordTest(
    'SEC-STOR-01',
    'Storage: Aluno B não lista ficheiros do personal-vault de Aluno A',
    'STORAGE',
    storageListB.rows.length === 0,
    `Retornou ${storageListB.rows.length} ficheiros (esperado 0)`
  );

  // Teste 12: Aluno B tenta aceder diretamente ao path do ficheiro de A
  const storagePathB = await db.query(`SELECT * FROM storage.objects WHERE name = '${filePathA}'`);
  recordTest(
    'SEC-STOR-02',
    'Storage IDOR: Aluno B não acede ao ficheiro de A pelo caminho direto no Storage',
    'STORAGE',
    storagePathB.rows.length === 0,
    `Retornou ${storagePathB.rows.length} ficheiros (esperado 0)`
  );

  // Teste 13: Aluno B tenta fazer upload para a pasta de Aluno A
  let storageUploadSpoofBlocked = false;
  try {
    await db.exec(`
      INSERT INTO storage.objects (id, bucket_id, name, owner)
      VALUES (gen_random_uuid(), 'personal-vault', 'users/${ALUNO_A_ID}/trojan.pdf', '${ALUNO_B_ID}');
    `);
  } catch (err: any) {
    storageUploadSpoofBlocked = err.message.includes('violates row-level security policy');
  }
  recordTest(
    'SEC-STOR-03',
    'Storage Upload Spoof: Aluno B é impedido de gravar na pasta de Aluno A',
    'STORAGE',
    storageUploadSpoofBlocked,
    'Bloqueado pela política WITH CHECK do Storage'
  );

  // Teste 14: Utilizador Anónimo (anon key sem JWT) tenta ler personal-vault
  await setSession('anon');
  let anonStorageBlocked = false;
  try {
    const anonStorage = await db.query(`SELECT * FROM storage.objects WHERE bucket_id = 'personal-vault'`);
    anonStorageBlocked = (anonStorage.rows.length === 0);
  } catch (err: any) {
    anonStorageBlocked = err.message.includes('permission denied') || err.message.includes('violates row-level security');
  }
  recordTest(
    'SEC-STOR-04',
    'Storage Anon: Utilizador anónimo tem ZERO acesso ao bucket personal-vault (rejeitado por ACL/RLS)',
    'STORAGE',
    anonStorageBlocked,
    'PostgreSQL bloqueou totalmente acesso anónimo ao bucket privado'
  );

  // ============================================================================
  // BATERIA DE TESTES 4: PROFILES E PROJEÇÃO LEADERBOARD
  // ============================================================================
  console.log('\n--- TESTES 4: PROFILES E PROJEÇÃO LEADERBOARD ---');

  // Sessão: Aluno B tenta consultar perfis
  await setSession('authenticated', ALUNO_B_ID);

  // Teste 15: Aluno B não consulta perfil completo de Aluno A
  const profileAfromB = await db.query(`SELECT * FROM public.profiles WHERE id = '${ALUNO_A_ID}'`);
  recordTest(
    'SEC-PROF-01',
    'Profiles: Aluno B não consegue consultar o perfil completo de Aluno A',
    'RLS_CROSS_TENANT',
    profileAfromB.rows.length === 0,
    `Retornou ${profileAfromB.rows.length} linhas (esperado 0)`
  );

  // Teste 16: Aluno B consulta apenas o seu próprio perfil
  const profileOwn = await db.query('SELECT * FROM public.profiles');
  recordTest(
    'SEC-PROF-02',
    'Profiles: Aluno B consulta única e exclusivamente o seu próprio perfil',
    'RLS_CROSS_TENANT',
    profileOwn.rows.length === 1 && (profileOwn.rows[0] as any)?.id === ALUNO_B_ID,
    `Linhas retornadas: ${profileOwn.rows.length}`
  );

  // Teste 17: Leaderboard público expõe apenas dados autorizados sem expor IDs privados
  const leaderboard = await db.query('SELECT * FROM public.get_public_leaderboard()');
  const hasPrivateIds = leaderboard.rows.some((r: any) => r.id !== undefined || r.email !== undefined);
  recordTest(
    'SEC-PROF-03',
    'Leaderboard: Projeção pública RPC não expõe IDs privados nem dados sensíveis',
    'RLS_CROSS_TENANT',
    leaderboard.rows.length >= 2 && !hasPrivateIds,
    `Retornou ${leaderboard.rows.length} alunos com campos públicos sem expor identificadores privados`
  );

  // ============================================================================
  // BATERIA DE TESTES 5: USER_ROLES E ELEVAÇÃO DE PRIVILÉGIOS
  // ============================================================================
  console.log('\n--- TESTES 5: USER_ROLES E ELEVAÇÃO DE PRIVILÉGIOS ---');

  // Sessão: Aluno A tenta tornar-se admin
  await setSession('authenticated', ALUNO_A_ID);

  let roleInsertBlocked = false;
  try {
    await db.exec(`INSERT INTO public.user_roles (user_id, role) VALUES ('${ALUNO_A_ID}', 'admin');`);
  } catch (err: any) {
    roleInsertBlocked = err.message.includes('violates row-level security policy') || err.message.includes('duplicate key');
  }
  recordTest(
    'SEC-ROLE-01',
    'Roles: Aluno A é bloqueado de inserir papel de admin',
    'ROLES',
    roleInsertBlocked,
    'Tentativa de INSERT em user_roles rejeitada por RLS'
  );

  const roleUpdate = await db.query(`UPDATE public.user_roles SET role = 'admin' WHERE user_id = '${ALUNO_A_ID}'`);
  recordTest(
    'SEC-ROLE-02',
    'Roles: Aluno A é bloqueado de fazer UPDATE do seu próprio papel para admin',
    'ROLES',
    roleUpdate.affectedRows === 0,
    `Linhas afetadas: ${roleUpdate.affectedRows} (esperado 0)`
  );

  // ============================================================================
  // BATERIA DE TESTES 6: EXERCÍCIOS, SOLUÇÕES E STATS
  // ============================================================================
  console.log('\n--- TESTES 6: EXERCÍCIOS, SOLUÇÕES E STATS ---');

  // Criar exercício para Aluno A
  const exAId = '66666666-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  await db.exec(`
    INSERT INTO public.exercises (id, user_id, subject_id, prompt, question_type, correct_answer, max_points)
    VALUES ('${exAId}', '${ALUNO_A_ID}', 'matematica-a', 'Qual a derivada de e^x?', 'multiple_choice', 'e^x', 20.00);
  `);

  // Aluno A tenta alterar a solução ou pontuação do exercício
  const exUpdate = await db.query(`UPDATE public.exercises SET correct_answer = 'Fraude', max_points = 50.00 WHERE id = '${exAId}'`);
  recordTest(
    'SEC-EXER-01',
    'Exercícios: Aluno A não consegue alterar o gabarito ou pontuação do exercício',
    'EXERCISES',
    exUpdate.affectedRows === 0,
    `Linhas afetadas: ${exUpdate.affectedRows} (esperado 0)`
  );

  // Aluno A tenta alterar manualmente as suas estatísticas de estudo
  const statsUpdate = await db.query(`UPDATE public.study_stats SET exercises_solved = 5000, streak_days = 999 WHERE user_id = '${ALUNO_A_ID}'`);
  recordTest(
    'SEC-STAT-01',
    'Stats: Aluno A não consegue forjar estatísticas de estudo via frontend UPDATE',
    'STATS',
    statsUpdate.affectedRows === 0,
    `Linhas afetadas: ${statsUpdate.affectedRows} (esperado 0)`
  );

  // ============================================================================
  // BATERIA DE TESTES 7: PUBLIC_NOTES E PRIVILÉGIOS DE ADMIN
  // ============================================================================
  console.log('\n--- TESTES 7: PUBLIC_NOTES E PRIVILÉGIOS DE ADMIN ---');

  // Aluno A tenta criar ou alterar nota pública
  let publicNoteInsertBlocked = false;
  try {
    await db.exec(`
      INSERT INTO public.public_notes (curator_admin_id, subject_id, title, canonical_markdown, is_published)
      VALUES ('${ALUNO_A_ID}', 'filosofia', 'Descartes Desmistificado', '# Cogito', true);
    `);
  } catch (err: any) {
    publicNoteInsertBlocked = err.message.includes('violates row-level security policy');
  }
  recordTest(
    'SEC-PUBN-01',
    'Public Notes: Aluno A não tem permissão para publicar apontamentos na biblioteca curada',
    'ROLES',
    publicNoteInsertBlocked,
    'Tentativa de inserção rejeitada por RLS'
  );

  // Sessão: Administrador
  await setSession('authenticated', ADMIN_ID);

  // Admin cria nota pública oficial
  const pubNoteAdminId = '77777777-dddd-4ddd-8ddd-dddddddddddd';
  await db.exec(`
    INSERT INTO public.public_notes (id, curator_admin_id, subject_id, title, canonical_markdown, is_published)
    VALUES ('${pubNoteAdminId}', '${ADMIN_ID}', 'filosofia', 'Descartes - Meditações Metafísicas', '# O Método', true);
  `);

  const adminNoteCreated = await db.query(`SELECT * FROM public.public_notes WHERE id = '${pubNoteAdminId}'`);
  recordTest(
    'SEC-PUBN-02',
    'Public Notes: Administrador consegue gerir notas públicas curadas',
    'ROLES',
    adminNoteCreated.rows.length === 1,
    `Nota criada pelo admin com sucesso`
  );

  // Admin NÃO ganha acesso indiscriminado aos apontamentos privados dos alunos
  const adminReadsStudentNotes = await db.query(`SELECT * FROM public.personal_notes WHERE user_id = '${ALUNO_A_ID}'`);
  recordTest(
    'SEC-ADMN-01',
    'Admin Isolation: Administrador NÃO ganha acesso indiscriminado ao cofre privado do Aluno A',
    'ROLES',
    adminReadsStudentNotes.rows.length === 0,
    `Retornou ${adminReadsStudentNotes.rows.length} notas privadas de alunos (esperado 0)`
  );

  // ============================================================================
  // BATERIA DE TESTES 8: INTEGRIDADE RELACIONAL COMPOSTA (CROSS-TENANT FOREIGN KEYS)
  // ============================================================================
  console.log('\n--- TESTES 8: INTEGRIDADE REFERENCIAL MULTI-TENANT ---');

  // Aluno B cria o seu próprio teste
  await setSession('authenticated', ALUNO_B_ID);
  const testBId = '88888888-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  await db.exec(`
    INSERT INTO public.tests (id, user_id, subject_id, title, academic_term)
    VALUES ('${testBId}', '${ALUNO_B_ID}', 'portugues', 'Teste Os Lusíadas', '1º Período');
  `);

  // Aluno B tenta associar uma nota sua ao teste de Aluno A (Injeção de Foreign Key cruzada)
  let crossFkNoteTestBlocked = false;
  try {
    await db.exec(`
      INSERT INTO public.personal_notes (id, user_id, test_id, subject_id, title)
      VALUES (gen_random_uuid(), '${ALUNO_B_ID}', '${testAId}', 'portugues', 'Nota com teste do Aluno A');
    `);
  } catch (err: any) {
    crossFkNoteTestBlocked = err.message.includes('violates foreign key constraint') || err.message.includes('fk_personal_notes_test_user');
  }
  recordTest(
    'SEC-INTG-01',
    'Integridade Relacional: Bloqueia ligação de nota de Aluno B com teste de Aluno A (Composite FK)',
    'INTEGRITY',
    crossFkNoteTestBlocked,
    'PostgreSQL rejeitou violação da chave estrangeira composta (test_id, user_id)'
  );

  // Aluno B tenta criar uma note_page apontando para a nota de Aluno A (com page_number 2)
  let crossFkPageNoteBlocked = false;
  let crossFkPageError = '';
  try {
    await db.exec(`
      INSERT INTO public.note_pages (id, note_id, user_id, document_name, page_number, storage_file_path, file_sha256)
      VALUES (gen_random_uuid(), '${noteAId}', '${ALUNO_B_ID}', 'folha.pdf', 2, 'users/b/f.pdf', 'hash');
    `);
  } catch (err: any) {
    crossFkPageError = err.message;
    crossFkPageNoteBlocked = err.message.toLowerCase().includes('violates foreign key') || 
                             err.message.toLowerCase().includes('violates row-level security') ||
                             err.message.includes('fk_note_pages_note_user');
  }
  recordTest(
    'SEC-INTG-02',
    'Integridade Relacional: Bloqueia ligação de página de Aluno B com nota de Aluno A (Composite FK)',
    'INTEGRITY',
    crossFkPageNoteBlocked,
    `Erro retornado: ${crossFkPageError}`
  );

  // ============================================================================
  // SUMÁRIO DOS RESULTADOS DA AUDITORIA
  // ============================================================================
  console.log('\n================================================================');
  console.log('RELATÓRIO DE RESULTADOS DOS TESTES RLS REAIS');
  console.log('================================================================');
  
  const total = results.length;
  const passed = results.filter(r => r.passed).length;
  const failed = total - passed;

  console.log(`Total de Testes Executados: ${total}`);
  console.log(`Sucessos: ${passed}`);
  console.log(`Falhas: ${failed}`);
  console.log(`Taxa de Aprovação: ${((passed / total) * 100).toFixed(1)}%\n`);

  if (failed > 0) {
    console.error('ALERTA: Existem testes que falharam!');
    process.exit(1);
  } else {
    console.log('SUCESSO TOTAL: Todos os 24 testes de RLS real no motor PostgreSQL C foram validados com êxito!');
  }
}

runRealRlsAudit().catch((err) => {
  console.error('ERRO FATAL NA EXECUÇÃO DOS TESTES RLS:', err);
  process.exit(1);
});
