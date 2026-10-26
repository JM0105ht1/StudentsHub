/**
 * SESSÕES DE AVALIAÇÕES OFICIAIS + 1.ª TENTATIVA (PGlite, 12 migrações)
 * E-01 sessão ligada com cópias e cotação oficial · E-02 sem forjar ligação/origem
 * E-03 retoma sessão em curso · E-04 1.ª tentativa registada pelo servidor
 * E-05 repetição não altera a 1.ª tentativa · E-06 aluno não declara nota
 * E-07 avaliação não publicada · E-08 conjunto com cotação repartida
 * E-09 funções mortas removidas · E-10 leaderboard/percentagem
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
  '20261025010000_turma_c_official_assessment_sessions.sql',
  '20261025020000_turma_c_fix_grading_official_sources.sql',
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


let passed = 0, failed = 0;
function record(id: string, name: string, ok: boolean, d = '') {
  ok ? passed++ : failed++;
  console.log(`[${ok ? '✅ PASSOU' : '❌ FALHOU'}] ${id}: ${name}`);
  if (!ok && d) console.error(`   Detalhes: ${d}`);
}
const throws = async (fn: () => Promise<unknown>, contains?: string) => {
  try { await fn(); return { threw: false, msg: '' }; }
  catch (e: any) { const msg = String(e?.message || e); return { threw: contains ? msg.includes(contains) : true, msg }; }
};

async function newDb() {
  const db = new PGlite();
  await db.exec(`
    CREATE SCHEMA IF NOT EXISTS auth; CREATE SCHEMA IF NOT EXISTS storage;
    CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY, email text UNIQUE, raw_user_meta_data jsonb DEFAULT '{}'::jsonb);
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid; $$ LANGUAGE sql STABLE;
    CREATE OR REPLACE FUNCTION auth.role() RETURNS text AS $$ SELECT COALESCE(current_setting('request.jwt.claim.role', true), 'authenticated'); $$ LANGUAGE sql STABLE;
    DO $$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
    END $$;`);
  for (const f of MIGRATIONS) await db.exec(fs.readFileSync(path.resolve(process.cwd(), 'supabase/migrations', f), 'utf-8'));
  await db.exec(`
    GRANT USAGE ON SCHEMA public TO authenticated, anon;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated, anon;
    INSERT INTO auth.users (id, email) VALUES ('${ALUNO_ID}','aluno@studentshub.pt'),('${ADMIN_ID}','admin@studentshub.pt');
    INSERT INTO public.profiles (id, full_name, class_name) VALUES ('${ALUNO_ID}','Aluno','Turma C'),('${ADMIN_ID}','Admin','Turma C') ON CONFLICT (id) DO NOTHING;
    INSERT INTO public.user_roles (user_id, role) VALUES ('${ALUNO_ID}','student'),('${ADMIN_ID}','admin') ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role;`);
  return db;
}
const as = async (db: PGlite, uid: string) => { await db.exec(`RESET ROLE; SET ROLE authenticated; SET request.jwt.claim.sub='${uid}'; SET request.jwt.claim.role='authenticated';`); };
const reset = (db: PGlite) => db.exec(`RESET ROLE; RESET request.jwt.claim.sub; RESET request.jwt.claim.role;`);

async function main() {
  console.log('SESSÕES OFICIAIS — «SEMPRE COM BASE NOS APONTAMENTOS OFICIAIS!!!»\n');
  const db = await newDb();
  await db.exec(`
    INSERT INTO public.official_notes (id, subject_id, academic_period, theme, title, is_published, created_by)
      VALUES ('${NOTE_ID}','matematica-a','P1','Bolzano-Cauchy','Teorema',false,'${ADMIN_ID}');
    INSERT INTO public.official_note_versions (id, note_id, version_number, raw_html, sanitized_html, plain_text_content, is_published, created_by)
      VALUES ('${VERSION_ID}','${NOTE_ID}',1,'<p>x</p>','<p>x</p>',$txt$${PLAIN_TEXT}$txt$,true,'${ADMIN_ID}');
    UPDATE public.official_notes SET current_version_id='${VERSION_ID}', is_published=true WHERE id='${NOTE_ID}';`);

  // 3 exercícios oficiais publicados via RPC atómica (como o admin)
  await as(db, ADMIN_ID);
  const items = [1, 2, 3].map((i) => ({
    prompt: `Pergunta ${i}: o que garante o Teorema de Bolzano?`, question_type: 'multiple_choice',
    options: ['Existe pelo menos um zero', 'A função é constante'], correct_answer: 'Existe pelo menos um zero',
    scoring_rubric: { criteria: ['c'], explanation: 'e' }, max_points: 2, difficulty: 'medio', quote_excerpt: GOOD_QUOTE,
  }));
  const batch = (await db.query(`SELECT public.create_official_exercise_batch_with_provenance($1::uuid,$2::uuid,$3::uuid,$4,$5::jsonb,true) AS r`,
    [ADMIN_ID, NOTE_ID, VERSION_ID, REAL_HASH, JSON.stringify(items)])).rows[0] as any;
  const ids: string[] = batch.r.inserted_ids;
  for (const id of ids) await db.exec(`UPDATE public.exercises SET status='published' WHERE id='${id}'`);
  await reset(db);

  const EXAM_ID = '33333333-3333-4333-8333-333333333333';
  const SET_ID = '44444444-4444-4444-8444-444444444444';
  await db.exec(`
    INSERT INTO public.official_exams (id, subject_id, title, total_points, is_published, created_by)
      VALUES ('${EXAM_ID}','matematica-a','Exame P1+P2+P3',20,true,'${ADMIN_ID}');
    INSERT INTO public.official_exam_exercises (exam_id, exercise_id, period, order_index, allocated_points) VALUES
      ('${EXAM_ID}','${ids[0]}','P1',1,8),('${EXAM_ID}','${ids[1]}','P2',2,6),('${EXAM_ID}','${ids[2]}','P3',3,6);
    INSERT INTO public.official_exercise_sets (id, subject_id, academic_period, title, is_published, created_by)
      VALUES ('${SET_ID}','matematica-a','P1','Conjunto P1',true,'${ADMIN_ID}');
    INSERT INTO public.official_set_exercises (set_id, exercise_id, order_index) VALUES
      ('${SET_ID}','${ids[0]}',1),('${SET_ID}','${ids[1]}',2),('${SET_ID}','${ids[2]}',3);`);

  // ---- E-01
  await as(db, ALUNO_ID);
  const s1 = (await db.query(`SELECT public.start_official_assessment_session('exam',$1::uuid) AS r`, [EXAM_ID])).rows[0] as any;
  const sid: string = s1.r.session_id;
  await reset(db);
  {
    const q = await db.query(`SELECT COUNT(*)::int n, SUM(max_points)::numeric s, COUNT(origin_exercise_id)::int o, BOOL_AND(NOT is_official) c FROM public.exercises WHERE session_id='${sid}'`);
    const r = await db.query(`SELECT COUNT(*)::int n FROM public.exercise_source_references WHERE exercise_id IN (SELECT id FROM public.exercises WHERE session_id='${sid}') AND source_type='official'`);
    const row = q.rows[0] as any;
    record('E-01', 'Sessão de exame ligada ao exame, com 3 cópias, cotação 20, origem e proveniência oficiais copiadas',
      row.n === 3 && Number(row.s) === 20 && row.o === 3 && row.c === true && (r.rows[0] as any).n === 3, JSON.stringify(row));
  }

  // ---- E-02
  await as(db, ALUNO_ID);
  {
    const a = await throws(() => db.exec(`INSERT INTO public.exercise_sessions (user_id, subject_id, title, mode, official_assessment_id, official_assessment_type)
      VALUES ('${ALUNO_ID}','matematica-a','forjada','exam','${EXAM_ID}','exam')`), 'start_official_assessment_session');
    const b = await throws(() => db.exec(`UPDATE public.exercise_sessions SET official_assessment_id=NULL, official_assessment_type=NULL WHERE id='${sid}'`), 'imutável');
    const c = await throws(() => db.exec(`INSERT INTO public.exercises (user_id, subject_id, prompt, question_type, correct_answer, origin_exercise_id)
      VALUES ('${ALUNO_ID}','matematica-a','x','open_answer','y','${ids[0]}')`), 'servidor');
    record('E-02', 'Aluno não consegue forjar sessão oficial, desligá-la da avaliação nem definir origin_exercise_id', a.threw && b.threw && c.threw, `${a.msg}|${b.msg}|${c.msg}`);
  }

  // ---- E-03
  {
    const again = (await db.query(`SELECT public.start_official_assessment_session('exam',$1::uuid) AS r`, [EXAM_ID])).rows[0] as any;
    record('E-03', 'Iniciar de novo com sessão em curso retoma a mesma sessão', again.r.session_id === sid && again.r.resumed === true, JSON.stringify(again.r));
  }

  // ---- E-06 (antes de concluir)
  {
    const noSession = await throws(() => db.query(`SELECT public.record_official_first_attempt($1::uuid,'exam',20,20,NULL)`, [EXAM_ID]), 'sessão corrigida');
    const notDone = await throws(() => db.query(`SELECT public.record_official_first_attempt($1::uuid,'exam',20,20,$2::uuid)`, [EXAM_ID, sid]));
    record('E-06', 'Aluno não declara nota: sem sessão ou com sessão por concluir é rejeitado', noSession.threw && notDone.threw, `${noSession.msg}|${notDone.msg}`);
  }

  // ---- E-04 (responde certo às 2 primeiras, errado à 3.ª → 14/20)
  {
    const exs = (await db.query(`SELECT id, origin_exercise_id FROM public.exercises WHERE session_id='${sid}'`)).rows as any[];
    const orderOf = (o: string) => ids.indexOf(o);
    const answers = exs.map((e) => ({ exercise_id: e.id, student_answer: orderOf(e.origin_exercise_id) === 2 ? 'A função é constante' : 'Existe pelo menos um zero' }));
    const res = (await db.query(`SELECT public.submit_session_and_record_first_attempt($1::uuid,$2::jsonb) AS r`, [sid, JSON.stringify(answers)])).rows[0] as any;
    await reset(db);
    const fa = await db.query(`SELECT score_achieved, max_score, score_percentage, session_id FROM public.official_first_attempts WHERE user_id='${ALUNO_ID}' AND assessment_id='${EXAM_ID}'`);
    const row = fa.rows[0] as any;
    record('E-04', '1.ª tentativa registada pelo servidor (14/20 = 70%) na mesma transação da correção',
      res.r.official?.recorded === true && Number(row?.score_achieved) === 14 && Number(row?.max_score) === 20 && Number(row?.score_percentage) === 70 && row?.session_id === sid,
      JSON.stringify({ off: res.r.official, row }));
  }

  // ---- E-05 (repetição: acerta tudo, 1.ª tentativa permanece 14/20)
  {
    await as(db, ALUNO_ID);
    const s2 = (await db.query(`SELECT public.start_official_assessment_session('exam',$1::uuid) AS r`, [EXAM_ID])).rows[0] as any;
    const exs = (await db.query(`SELECT id FROM public.exercises WHERE session_id='${s2.r.session_id}'`)).rows as any[];
    const res = (await db.query(`SELECT public.submit_session_and_record_first_attempt($1::uuid,$2::jsonb) AS r`,
      [s2.r.session_id, JSON.stringify(exs.map((e) => ({ exercise_id: e.id, student_answer: 'Existe pelo menos um zero' })))])).rows[0] as any;
    await reset(db);
    const upd = await throws(() => db.exec(`UPDATE public.official_first_attempts SET score_achieved=20 WHERE user_id='${ALUNO_ID}'`), 'Imutabilidade');
    const fa = (await db.query(`SELECT score_achieved FROM public.official_first_attempts WHERE user_id='${ALUNO_ID}' AND assessment_id='${EXAM_ID}'`)).rows as any[];
    record('E-05', 'Repetição permitida (nota 20/20 na sessão) mas a 1.ª tentativa mantém-se 14/20 e é imutável',
      s2.r.session_id !== sid && res.r.official?.recorded === false && res.r.official?.reason === 'repeat_attempt' && fa.length === 1 && Number(fa[0].score_achieved) === 14 && upd.threw,
      JSON.stringify({ off: res.r.official, fa, upd: upd.msg }));
  }

  // ---- E-07
  {
    await db.exec(`UPDATE public.official_exams SET is_published=false WHERE id='${EXAM_ID}'`);
    await as(db, ALUNO_ID);
    const r = await throws(() => db.query(`SELECT public.start_official_assessment_session('exam',$1::uuid)`, [EXAM_ID]), 'não publicada');
    await reset(db);
    await db.exec(`UPDATE public.official_exams SET is_published=true WHERE id='${EXAM_ID}'`);
    record('E-07', 'Avaliação oficial não publicada não pode ser iniciada pelo aluno', r.threw, r.msg);
  }

  // ---- E-08
  {
    await as(db, ALUNO_ID);
    const s = (await db.query(`SELECT public.start_official_assessment_session('exercise_set',$1::uuid) AS r`, [SET_ID])).rows[0] as any;
    await reset(db);
    const sum = (await db.query(`SELECT SUM(max_points)::numeric s, COUNT(*)::int n FROM public.exercises WHERE session_id='${s.r.session_id}'`)).rows[0] as any;
    record('E-08', 'Conjunto de exercícios: cotação repartida soma exatamente o total oficial (20)', Number(sum.s) === 20 && sum.n === 3, JSON.stringify(sum));
  }

  // ---- E-09
  {
    const f = await db.query(`SELECT COUNT(*)::int n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN
      ('get_authorized_note_chunks','confirm_note_page_atomic','create_exercise_session_with_exercises_atomic','protect_raw_ocr_immutability','validate_note_chunk_source')`);
    const keep = await db.query(`SELECT COUNT(*)::int n FROM public.official_first_attempts`);
    record('E-09', 'Funções mortas do sistema antigo removidas e 1.ª tentativas preservadas', (f.rows[0] as any).n === 0 && (keep.rows[0] as any).n === 1);
  }

  // ---- E-10
  {
    await as(db, ALUNO_ID);
    let rows: any[] = []; let err = '';
    try { rows = (await db.query(`SELECT * FROM public.get_turma_c_leaderboard()`)).rows as any[]; } catch (e: any) { err = e.message; }
    await reset(db);
    record('E-10', 'Leaderboard calcula a partir das 1.ª tentativas oficiais', rows.length >= 1 && !err, err || JSON.stringify(rows[0]));
  }

  // ---- E-11 (treino livre: sessão real, não conta para 1.ª tentativa)
  {
    await as(db, ALUNO_ID);
    const p = (await db.query(`SELECT public.start_official_practice_session('matematica-a', NULL, 2, 'multiple_choice', NULL) AS r`)).rows[0] as any;
    const bad = await throws(() => db.query(`SELECT public.start_official_practice_session('disciplina-inexistente', NULL, 2, NULL, NULL)`), 'Disciplina');
    const none = await throws(() => db.query(`SELECT public.start_official_practice_session('matematica-a', NULL, 2, 'calculation', NULL)`), 'Sem exercícios');
    const big = await throws(() => db.query(`SELECT public.start_official_practice_session('matematica-a', NULL, 99, NULL, NULL)`), 'entre 1 e 15');
    await reset(db);
    const row = (await db.query(`SELECT COUNT(*)::int n, BOOL_AND(NOT is_official) c FROM public.exercises WHERE session_id='${p.r.session_id}'`)).rows[0] as any;
    const bound = (await db.query(`SELECT official_assessment_id FROM public.exercise_sessions WHERE id='${p.r.session_id}'`)).rows[0] as any;
    record('E-11', 'Treino: sessão real com 2 cópias oficiais, sem ligação a avaliação; filtros inválidos rejeitados',
      row.n === 2 && row.c === true && bound.official_assessment_id === null && bad.threw && none.threw && big.threw,
      `${JSON.stringify(row)}|${bad.msg}|${none.msg}|${big.msg}`);
  }

  await db.close();
  console.log(`\nTotal: ${passed + failed} | Aprovados: ${passed} | Falhas: ${failed}`);
  if (failed > 0) process.exit(1);
}
main().catch((e) => { console.error('Erro:', e); process.exit(1); });
