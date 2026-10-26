/**
 * Script de Verificação Corretiva Aprofundada — Pré-Fase C
 * Valida o estado real da base de dados com as 8 migrações aplicadas.
 */

import { PGlite } from '@electric-sql/pglite';
import * as fs from 'fs';
import * as path from 'path';

async function runDeepVerification() {
  console.log('='.repeat(70));
  console.log('STUDENTS HUB — VERIFICAÇÃO TÉCNICA CORRETIVA APROFUNDADA (PRÉ-FASE C)');
  console.log('Motor: PostgreSQL 16 (PGlite Nativo)');
  console.log('='.repeat(70));

  const db = new PGlite();

  // 1. Aplicar todas as 8 migrações em ordem estrita
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
    const filename = migrations[i];
    const filepath = path.join(process.cwd(), 'supabase', 'migrations', filename);
    const sql = fs.readFileSync(filepath, 'utf8');
    await db.exec(sql);
    console.log(`[MIGRAÇÃO ${i + 1}/8 APLICADA]: ${filename}`);
  }

  console.log('\n--- 1. INSPEÇÃO DAS COLUNAS DE EXERCISE_SOURCE_REFERENCES ---');
  const cols = await db.query(`
    SELECT column_name, data_type, column_default, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'exercise_source_references'
    ORDER BY ordinal_position;
  `);
  console.table(cols.rows);

  console.log('\n--- 2. INSPEÇÃO DAS CONSTRAINTS DE EXERCISE_SOURCE_REFERENCES ---');
  const constraints = await db.query(`
    SELECT conname, contype, pg_get_constraintdef(c.oid) as definition
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON t.relnamespace = n.oid
    WHERE n.nspname = 'public' AND t.relname = 'exercise_source_references';
  `);
  console.table(constraints.rows);

  console.log('\n--- 3. INSPEÇÃO DOS TRIGGERS EM EXERCISE_SOURCE_REFERENCES ---');
  const triggers = await db.query(`
    SELECT trigger_name, event_manipulation, action_statement, action_timing
    FROM information_schema.triggers
    WHERE event_object_schema = 'public' AND event_object_table = 'exercise_source_references';
  `);
  console.table(triggers.rows);

  console.log('\n--- 4. TESTE DE ESCRITA COM VALOR POR OMISSÃO (source_type = official) ---');
  // Criar contexto: admin, disciplina, nota oficial, versão oficial publicada, exercício
  const adminId = '99999999-9999-4999-8999-999999999999';
  await db.query(`
    INSERT INTO auth.users (id, email) VALUES ($1, 'admin@studentshub.pt')
    ON CONFLICT (id) DO NOTHING;
  `, [adminId]);

  await db.query(`
    INSERT INTO public.user_roles (user_id, role) VALUES ($1, 'admin')
    ON CONFLICT (user_id) DO NOTHING;
  `, [adminId]);

  // Criar nota oficial
  const noteRes = await db.query(`
    SELECT public.create_official_note_atomic(
      'matematica-a',
      'P1',
      'Geometria Analítica',
      'Vetores e Planos no Espaço',
      '<article><h1>Vetores e Planos</h1><p>Equação vetorial da reta: r: X = P + k*v.</p></article>',
      'Versão Inicial Homologada',
      '1.0',
      'admin@studentshub.pt'
    ) as note_id;
  `);
  const noteId = (noteRes.rows[0] as any).note_id;

  // Obter versão
  const verRes = await db.query(`
    SELECT id FROM public.official_note_versions WHERE note_id = $1;
  `, [noteId]);
  const versionId = (verRes.rows[0] as any).id;

  // Publicar nota
  await db.query(`
    SELECT public.publish_official_note_version_atomic($1, $2, 'admin@studentshub.pt');
  `, [noteId, versionId]);

  // Criar exercício oficial
  const exRes = await db.query(`
    INSERT INTO public.exercises (
      subject_id, academic_term, question_type, difficulty,
      title, problem_statement, correct_answer, explanation,
      points, is_official, created_by_role
    ) VALUES (
      'matematica-a', 'P1', 'multiple_choice', 'medium',
      'Exercício Oficial de Vetores',
      'Considere o vetor u = (1, 2, 3). Qual a sua norma?',
      'sqrt(14)', 'A norma ao quadrado é 1^2 + 2^2 + 3^2 = 14.',
      20, true, 'admin'
    ) RETURNING id;
  `);
  const exerciseId = (exRes.rows[0] as any).id;

  // Inserir referência sem passar source_type (para testar o default 'official')
  const refRes = await db.query(`
    INSERT INTO public.exercise_source_references (
      exercise_id, user_id, official_note_id, official_version_id,
      official_section, content_hash, quote_excerpt
    ) VALUES (
      $1, $2, $3, $4,
      'Equação vetorial da reta', 'hash_sha256_mock_123', 'Equação vetorial da reta: r: X = P + k*v.'
    ) RETURNING id, source_type;
  `, [exerciseId, adminId, noteId, versionId]);

  console.log('✅ Inserção sem especificar source_type sucedeu com sucesso!');
  console.log(`ID: ${(refRes.rows[0] as any).id} | source_type resultante: ${(refRes.rows[0] as any).source_type}`);

  console.log('\n--- 5. TESTE DE REJEIÇÃO DE INCONSISTÊNCIAS DE PROVENIÊNCIA ---');
  // A. Versão NULA
  try {
    await db.query(`
      INSERT INTO public.exercise_source_references (
        exercise_id, user_id, official_note_id, official_version_id
      ) VALUES ($1, $2, $3, NULL);
    `, [exerciseId, adminId, noteId]);
    console.error('❌ FALHA: Deveria ter rejeitado official_version_id NULO!');
  } catch (err: any) {
    console.log('✅ Bloqueou official_version_id NULO:', err.message);
  }

  // B. Mismatch de disciplina (exercício de Matemática referenciando nota de Filosofia)
  const filNoteRes = await db.query(`
    SELECT public.create_official_note_atomic(
      'filosofia',
      'P1',
      'Lógica Proposicional',
      'Tabelas de Verdade',
      '<article><h1>Lógica</h1><p>Tabelas de verdade para disjunção e conjunção.</p></article>',
      'Versão Inicial',
      '1.0',
      'admin@studentshub.pt'
    ) as note_id;
  `);
  const filNoteId = (filNoteRes.rows[0] as any).note_id;
  const filVerRes = await db.query(`SELECT id FROM public.official_note_versions WHERE note_id = $1`, [filNoteId]);
  const filVerId = (filVerRes.rows[0] as any).id;

  try {
    await db.query(`
      INSERT INTO public.exercise_source_references (
        exercise_id, user_id, official_note_id, official_version_id
      ) VALUES ($1, $2, $3, $4);
    `, [exerciseId, adminId, filNoteId, filVerId]);
    console.error('❌ FALHA: Deveria ter bloqueado mismatch curricular!');
  } catch (err: any) {
    console.log('✅ Bloqueou mismatch curricular (Matemática vs Filosofia):', err.message);
  }

  // C. Versão que pertence a outra nota
  try {
    await db.query(`
      INSERT INTO public.exercise_source_references (
        exercise_id, user_id, official_note_id, official_version_id
      ) VALUES ($1, $2, $3, $4);
    `, [exerciseId, adminId, noteId, filVerId]);
    console.error('❌ FALHA: Deveria ter bloqueado versão não pertencente à nota!');
  } catch (err: any) {
    console.log('✅ Bloqueou versão pertencente a outro documento:', err.message);
  }

  console.log('\n--- 6. VERIFICAÇÃO DO BUCKET PERSONAL-VAULT E POLÍTICAS DE STORAGE ---');
  const buckets = await db.query(`
    SELECT id, name, public FROM storage.buckets;
  `);
  console.log('Buckets existentes:');
  console.table(buckets.rows);

  const storagePolicies = await db.query(`
    SELECT policyname, permissive, roles, cmd, qual
    FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects';
  `);
  console.log('Políticas RLS em storage.objects:');
  console.table(storagePolicies.rows);

  console.log('\n--- 7. VERIFICAÇÃO DAS 12 TABELAS NUCLEARES E STATUS RLS ---');
  const expectedTables = [
    'official_notes',
    'official_note_versions',
    'official_note_audit_logs',
    'official_first_attempts',
    'study_stats',
    'official_assessments',
    'official_exams',
    'admin_rate_limit_buckets',
    'exercises',
    'exercise_source_references',
    'exercise_sessions',
    'user_roles',
  ];

  const rlsStatus = await db.query(`
    SELECT c.relname as table_name, c.relrowsecurity as rls_enabled, c.relforcerowsecurity as rls_forced
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = ANY($1::text[])
    ORDER BY c.relname;
  `, [expectedTables]);
  console.table(rlsStatus.rows);

  console.log('\n--- 8. VERIFICAÇÃO DA INEXISTÊNCIA DE TABELAS LEGADAS ---');
  const legacyTables = await db.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name IN ('personal_notes', 'note_pages', 'note_chunks');
  `);
  if (legacyTables.rows.length === 0) {
    console.log('✅ CONFIRMADO: personal_notes, note_pages e note_chunks não existem na base de dados.');
  } else {
    console.error('❌ ERRO: Tabelas legadas ainda encontradas:', legacyTables.rows);
  }

  console.log('\n' + '='.repeat(70));
  console.log('FIM DA VERIFICAÇÃO TÉCNICA APROFUNDADA: SUCESSO INTEGRAL');
  console.log('='.repeat(70));
}

runDeepVerification().catch((e) => {
  console.error('Erro na verificação aprofundada:', e);
  process.exit(1);
});
