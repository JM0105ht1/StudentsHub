/**
 * FASE C — FECHO FINAL: testes reais em PostgreSQL (PGlite) com as 11 migrações.
 * Princípio Sagrado: «SEMPRE COM BASE NOS APONTAMENTOS OFICIAIS!!!»
 *
 * Cobre:
 *  C-01  source_type: novos 'personal' rejeitados
 *  C-02  source_type com dados legados: preservados (NOT VALID) e novos bloqueados
 *  C-03  citação só presente no HTML (não no texto simples) rejeitada
 *  C-04  citação curta (<10) rejeitada; citação literal válida aceite
 *  C-05  lote atómico: um item inválido reverte TODO o lote (zero órfãos)
 *  C-06  lote parcial explícito: itens bons gravados, mau revertido sem órfãos
 *  C-07  lote parcial sem nenhum item aceite falha por inteiro
 *  C-08  p_user_id forjado rejeitado (identidade = auth.uid())
 *  C-09  aluno e anónimo não executam as RPCs
 *  C-10  hash que não corresponde ao texto da versão rejeitado
 *  C-11  disciplina/período do chamador diferentes da nota rejeitados
 *  C-12  lote com mais de 15 itens / não-array rejeitado
 *  C-13  publicar sem proveniência rejeitado na BD
 *  C-14  conteúdo de exercício publicado imutável; rascunho editável
 *  C-15  estado arquivado é final
 */

import { PGlite } from '@electric-sql/pglite';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

const ALUNO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ADMIN_ID = '99999999-9999-4999-8999-999999999999';
const NOTE_ID = '11111111-1111-4111-8111-111111111111';
const VERSION_ID = '22222222-2222-4222-8222-222222222222';

const MIGRATIONS = [
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

const PLAIN_TEXT = [
  'Teorema de Bolzano-Cauchy:',
  'Seja f uma função real de variável real contínua num intervalo fechado [a, b].',
  'Se f(a) * f(b) < 0, então existe pelo menos um ponto c pertencente ao intervalo aberto ]a, b[ tal que f(c) = 0.',
  'Isto garante a existência de pelo menos um zero da função f no intervalo ]a, b[.',
].join('\n');
const REAL_HASH = crypto.createHash('sha256').update(PLAIN_TEXT, 'utf8').digest('hex');
const GOOD_QUOTE = 'Se f(a) * f(b) < 0, então existe pelo menos um ponto c';
const HTML_ONLY_MARKER = 'frase-so-no-html-fabricada';

let passed = 0;
let failed = 0;
function record(id: string, name: string, ok: boolean, details = '') {
  if (ok) passed++;
  else failed++;
  console.log(`[${ok ? '✅ PASSOU' : '❌ FALHOU'}] ${id}: ${name}`);
  if (!ok && details) console.error(`   Detalhes: ${details}`);
}

async function newDb(upTo: number) {
  const db = new PGlite();
  await db.exec(`
    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE SCHEMA IF NOT EXISTS storage;
    CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY, email text UNIQUE, raw_user_meta_data jsonb DEFAULT '{}'::jsonb);
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$ LANGUAGE sql STABLE;
    CREATE OR REPLACE FUNCTION auth.role() RETURNS text AS $$
      SELECT COALESCE(current_setting('request.jwt.claim.role', true), 'authenticated');
    $$ LANGUAGE sql STABLE;
    DO $$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
    END $$;
  `);
  for (const f of MIGRATIONS.slice(0, upTo)) {
    await db.exec(fs.readFileSync(path.resolve(process.cwd(), 'supabase/migrations', f), 'utf-8'));
  }
  await db.exec(`
    GRANT USAGE ON SCHEMA public TO authenticated, anon;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated, anon;
    INSERT INTO auth.users (id, email) VALUES
      ('${ALUNO_ID}', 'aluno@studentshub.pt'), ('${ADMIN_ID}', 'admin@studentshub.pt') ON CONFLICT (id) DO NOTHING;
    INSERT INTO public.profiles (id, full_name, class_name) VALUES
      ('${ALUNO_ID}', 'Aluno', 'Turma C'), ('${ADMIN_ID}', 'Admin', 'Turma C') ON CONFLICT (id) DO NOTHING;
    INSERT INTO public.user_roles (user_id, role) VALUES ('${ALUNO_ID}', 'student'), ('${ADMIN_ID}', 'admin')
      ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role;
  `);
  return db;
}

async function seedNote(db: PGlite) {
  await db.exec(`
    INSERT INTO public.official_notes (id, subject_id, academic_period, theme, title, is_published, created_by)
    VALUES ('${NOTE_ID}', 'matematica-a', 'P1', 'Bolzano-Cauchy', 'Teorema dos Valores Intermédios', false, '${ADMIN_ID}');
    INSERT INTO public.official_note_versions (id, note_id, version_number, raw_html, sanitized_html, plain_text_content, is_published, created_by)
    VALUES ('${VERSION_ID}', '${NOTE_ID}', 1,
      '<p>${PLAIN_TEXT.replace(/\n/g, ' ')} <span class="${HTML_ONLY_MARKER}">x</span></p>',
      '<p>${PLAIN_TEXT.replace(/\n/g, ' ')} <span class="${HTML_ONLY_MARKER}">x</span></p>',
      $txt$${PLAIN_TEXT}$txt$, true, '${ADMIN_ID}');
    UPDATE public.official_notes SET current_version_id = '${VERSION_ID}', is_published = true WHERE id = '${NOTE_ID}';
  `);
}

const as = async (db: PGlite, role: 'authenticated' | 'anon', uid?: string) => {
  await db.exec(`RESET ROLE; SET ROLE ${role};`);
  if (uid) await db.exec(`SET request.jwt.claim.sub = '${uid}'; SET request.jwt.claim.role = '${role}';`);
  else await db.exec(`RESET request.jwt.claim.sub; RESET request.jwt.claim.role;`);
};
const reset = (db: PGlite) => db.exec(`RESET ROLE; RESET request.jwt.claim.sub; RESET request.jwt.claim.role;`);

const ex = (quote: string, extra: Record<string, unknown> = {}) => ({
  prompt: 'Qual a consequência do Teorema de Bolzano quando f(a)*f(b) < 0?',
  question_type: 'multiple_choice',
  options: ['Existe pelo menos um zero', 'A função é constante'],
  correct_answer: 'Existe pelo menos um zero',
  scoring_rubric: { criteria: ['c1'], explanation: 'e' },
  max_points: 20,
  difficulty: 'medio',
  quote_excerpt: quote,
  ...extra,
});

async function callBatch(db: PGlite, items: unknown, atomic: boolean, opts: { uid?: string; hash?: string } = {}) {
  const sql = `SELECT public.create_official_exercise_batch_with_provenance(
    $1::uuid, $2::uuid, $3::uuid, $4, $5::jsonb, $6::boolean) AS r`;
  return db.query(sql, [opts.uid ?? ADMIN_ID, NOTE_ID, VERSION_ID, opts.hash ?? REAL_HASH, JSON.stringify(items), atomic]);
}

const counts = async (db: PGlite) => {
  const e = await db.query(`SELECT COUNT(*)::int AS n FROM public.exercises WHERE is_official = true`);
  const r = await db.query(`SELECT COUNT(*)::int AS n FROM public.exercise_source_references`);
  return { ex: (e.rows[0] as any).n as number, ref: (r.rows[0] as any).n as number };
};

const throws = async (fn: () => Promise<unknown>, contains?: string) => {
  try {
    await fn();
    return { threw: false, msg: '' };
  } catch (e: any) {
    const msg = String(e?.message || e);
    return { threw: contains ? msg.includes(contains) : true, msg };
  }
};

async function main() {
  console.log('================================================================');
  console.log('FASE C — FECHO FINAL · «SEMPRE COM BASE NOS APONTAMENTOS OFICIAIS!!!»');
  console.log('================================================================\n');

  // ---------------------------------------------------------------- C-02 (dados legados)
  {
    const legacy = await newDb(9); // antes do fecho de integridade: ainda aceita 'personal'
    await legacy.exec(`
      INSERT INTO public.exercises (id, user_id, subject_id, prompt, question_type, correct_answer)
      VALUES ('77777777-7777-4777-8777-777777777777', '${ALUNO_ID}', 'matematica-a', 'Pergunta legada', 'open_answer', 'x');
      INSERT INTO public.exercise_source_references (exercise_id, user_id, source_type, citation_excerpt)
      VALUES ('77777777-7777-4777-8777-777777777777', '${ALUNO_ID}', 'personal', 'excerto legado');
    `);
    // Aplicar as duas migrações seguintes COM o registo legado já presente
    for (const f of MIGRATIONS.slice(9)) {
      await legacy.exec(fs.readFileSync(path.resolve(process.cwd(), 'supabase/migrations', f), 'utf-8'));
    }
    const still = await legacy.query(`SELECT COUNT(*)::int AS n FROM public.exercise_source_references WHERE source_type = 'personal'`);
    const con = await legacy.query(`SELECT convalidated FROM pg_constraint WHERE conname = 'exercise_source_references_source_type_check'`);
    const blocked = await throws(
      () => legacy.exec(`INSERT INTO public.exercise_source_references (exercise_id, user_id, source_type, citation_excerpt)
        VALUES ('77777777-7777-4777-8777-777777777777', '${ALUNO_ID}', 'personal', 'novo')`)
    );
    record(
      'C-02',
      'Dados legados preservados (não apagados/convertidos) e novos source_type<>official bloqueados (NOT VALID)',
      (still.rows[0] as any).n === 1 && (con.rows[0] as any)?.convalidated === false && blocked.threw,
      `legacy=${(still.rows[0] as any).n} convalidated=${(con.rows[0] as any)?.convalidated} blocked=${blocked.msg}`
    );
    await legacy.close();
  }

  const db = await newDb(11);
  await seedNote(db);

  // ---------------------------------------------------------------- C-01
  {
    const r = await throws(() =>
      db.exec(`INSERT INTO public.exercise_source_references (exercise_id, user_id, source_type, citation_excerpt)
        VALUES (gen_random_uuid(), '${ALUNO_ID}', 'personal', 'x')`)
    );
    record('C-01', 'Inserção de source_type = personal rejeitada', r.threw, r.msg);
  }

  // ---------------------------------------------------------------- C-03 / C-04 (trigger direto)
  const mkDraft = async (id: string) => {
    await db.exec(`INSERT INTO public.exercises (id, user_id, subject_id, academic_period, prompt, question_type, correct_answer, is_official, status, created_by_role)
      VALUES ('${id}', '${ADMIN_ID}', 'matematica-a', 'P1', 'Enunciado de teste', 'open_answer', 'resp', true, 'draft', 'admin')`);
  };
  const insRef = (exId: string, quote: string) =>
    db.query(
      `INSERT INTO public.exercise_source_references (exercise_id, user_id, source_type, official_note_id, official_version_id, content_hash, quote_excerpt)
       VALUES ($1::uuid, $2::uuid, 'official', $3::uuid, $4::uuid, $5, $6)`,
      [exId, ADMIN_ID, NOTE_ID, VERSION_ID, REAL_HASH, quote]
    );

  const T1 = '10000000-0000-4000-8000-000000000001';
  const T2 = '10000000-0000-4000-8000-000000000002';
  const T3 = '10000000-0000-4000-8000-000000000003';
  await mkDraft(T1);
  await mkDraft(T2);
  await mkDraft(T3);

  {
    const r = await throws(() => insRef(T1, HTML_ONLY_MARKER), 'Grounding');
    record('C-03', 'Citação que só existe no HTML (não no texto simples oficial) rejeitada', r.threw, r.msg);
  }
  {
    const short = await throws(() => insRef(T1, 'f(a)'), 'pelo menos 10');
    let okInsert = false;
    try {
      await insRef(T2, GOOD_QUOTE);
      okInsert = true;
    } catch (e: any) {
      console.error('   erro inesperado:', e.message);
    }
    record('C-04', 'Citação curta rejeitada; citação literal válida aceite', short.threw && okInsert, short.msg);
  }

  // ---------------------------------------------------------------- C-05 / C-06 / C-07 (lotes)
  await as(db, 'authenticated', ADMIN_ID);
  {
    const before = await counts(db);
    const r = await throws(() =>
      callBatch(db, [ex(GOOD_QUOTE), ex(GOOD_QUOTE), ex('CITAÇÃO TOTALMENTE INVENTADA E PROIBIDA')], true)
    );
    const after = await counts(db);
    record(
      'C-05',
      'Lote atómico com 1 item inválido reverte TODO o lote (zero exercícios/proveniências órfãos)',
      r.threw && after.ex === before.ex && after.ref === before.ref,
      `antes=${JSON.stringify(before)} depois=${JSON.stringify(after)} erro=${r.msg}`
    );
  }
  {
    const before = await counts(db);
    let res: any = null;
    let err = '';
    try {
      res = ((await callBatch(db, [ex(GOOD_QUOTE), ex('CITAÇÃO TOTALMENTE INVENTADA E PROIBIDA'), ex(GOOD_QUOTE)], false)).rows[0] as any).r;
    } catch (e: any) {
      err = e.message;
    }
    const after = await counts(db);
    const orphans = await db.query(
      `SELECT COUNT(*)::int AS n FROM public.exercises e WHERE e.is_official = true AND e.id NOT IN (SELECT exercise_id FROM public.exercise_source_references)
         AND e.id NOT IN ('${T1}', '${T3}')`
    );
    record(
      'C-06',
      'Lote parcial explícito: 2 itens gravados, 1 revertido, sem órfãos e falha reportada',
      !!res && res.inserted_count === 2 && res.failed_count === 1 && after.ex - before.ex === 2 && after.ref - before.ref === 2 && (orphans.rows[0] as any).n === 0,
      `res=${JSON.stringify(res)} err=${err} antes=${JSON.stringify(before)} depois=${JSON.stringify(after)}`
    );
  }
  {
    const before = await counts(db);
    const r = await throws(() => callBatch(db, [ex('INVENTADA UM AAAA'), ex('INVENTADA DOIS BBBB')], false), 'nenhum exercício');
    const after = await counts(db);
    record('C-07', 'Lote parcial sem nenhum item aceite falha por inteiro', r.threw && after.ex === before.ex && after.ref === before.ref, r.msg);
  }

  // ---------------------------------------------------------------- C-08 .. C-12
  {
    const r = await throws(() => callBatch(db, [ex(GOOD_QUOTE)], true, { uid: ALUNO_ID }), 'Identidade');
    record('C-08', 'p_user_id forjado (diferente de auth.uid()) rejeitado', r.threw, r.msg);
  }
  {
    const r = await throws(() => callBatch(db, [ex(GOOD_QUOTE)], true, { hash: crypto.createHash('sha256').update('outro texto').digest('hex') }), 'Hash');
    record('C-10', 'content_hash que não corresponde ao texto da versão oficial rejeitado', r.threw, r.msg);
  }
  {
    const r = await throws(() =>
      db.query(
        `SELECT public.create_official_exercise_with_provenance($1::uuid,'fisica-quimica-a','P1','Enunciado de teste','open_answer',NULL,'r','{}'::jsonb,20,'medio',$2::uuid,$3::uuid,$4,$5,'s')`,
        [ADMIN_ID, NOTE_ID, VERSION_ID, REAL_HASH, GOOD_QUOTE]
      ),
      'Curricular'
    );
    record('C-11', 'Disciplina diferente da do apontamento oficial rejeitada', r.threw, r.msg);
  }
  {
    const many = Array.from({ length: 16 }, () => ex(GOOD_QUOTE));
    const tooMany = await throws(() => callBatch(db, many, true), '1 a 15');
    const notArray = await throws(() => callBatch(db, { a: 1 }, true), '1 a 15');
    record('C-12', 'Lote com >15 itens ou que não é array rejeitado', tooMany.threw && notArray.threw, `${tooMany.msg} | ${notArray.msg}`);
  }

  // ---------------------------------------------------------------- C-09 (aluno / anónimo)
  await as(db, 'authenticated', ALUNO_ID);
  const studentTry = await throws(() => callBatch(db, [ex(GOOD_QUOTE)], true, { uid: ALUNO_ID }), 'Acesso Reservado');
  await as(db, 'anon');
  const anonTry = await throws(() => callBatch(db, [ex(GOOD_QUOTE)], true));
  record('C-09', 'Aluno autenticado e utilizador anónimo não executam a RPC de geração', studentTry.threw && anonTry.threw, `${studentTry.msg} | ${anonTry.msg}`);

  // ---------------------------------------------------------------- C-13 .. C-15 (ciclo de vida)
  await reset(db);
  {
    // T3 é rascunho oficial SEM proveniência
    const r = await throws(() => db.exec(`UPDATE public.exercises SET status = 'published' WHERE id = '${T3}'`), 'proveniência');
    record('C-13', 'Publicar exercício oficial sem proveniência é rejeitado pela base de dados', r.threw, r.msg);
  }
  {
    // T2 tem proveniência. Todas as edições ocorrem como ADMIN autenticado (fluxo real do modal de revisão).
    await as(db, 'authenticated', ADMIN_ID);
    let draftEditOk = false;
    try {
      await db.exec(`UPDATE public.exercises SET prompt = 'Enunciado revisto pelo admin', correct_answer = 'resposta revista' WHERE id = '${T2}'`);
      draftEditOk = true;
    } catch (e: any) {
      console.error('   edição de rascunho por admin falhou:', e.message);
    }
    await db.exec(`UPDATE public.exercises SET status = 'published' WHERE id = '${T2}'`);
    const edit = await throws(() => db.exec(`UPDATE public.exercises SET correct_answer = 'adulterada' WHERE id = '${T2}'`), 'imutável');
    const back = await throws(() => db.exec(`UPDATE public.exercises SET status = 'draft' WHERE id = '${T2}'`), 'rascunho');
    await reset(db);
    record('C-14', 'Admin edita rascunho; publicado fica com conteúdo imutável e sem regresso a rascunho', draftEditOk && edit.threw && back.threw, `${edit.msg} | ${back.msg}`);
  }
  {
    await as(db, 'authenticated', ADMIN_ID);
    await db.exec(`UPDATE public.exercises SET status = 'archived' WHERE id = '${T2}'`);
    const react = await throws(() => db.exec(`UPDATE public.exercises SET status = 'published' WHERE id = '${T2}'`), 'arquivado');
    await reset(db);
    record('C-15', 'Exercício arquivado é estado final (não reativável)', react.threw, react.msg);
  }

  await db.close();

  console.log('\n================================================================');
  console.log(`Total: ${passed + failed} | Aprovados: ${passed} | Falhas: ${failed}`);
  console.log('================================================================');
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error('Erro ao executar testes:', e);
  process.exit(1);
});
