/**
 * BATERIA DE TESTES AUTOMATIZADOS — FASE B: GESTÃO SEGURA DE APONTAMENTOS HTML
 * Students Hub — "Apontamentos que ajudam, exercícios que resultam. Rumo ao 20."
 * Princípio Sagrado: «SEMPRE COM BASE NOS APONTAMENTOS OFICIAIS!!!»
 * 
 * Executa as verificações das 5 áreas da Fase B sobre PostgreSQL 16 (PGlite Nativo):
 * 1. Autenticação e Autorização Administrativa (Escalamento de privilégios de alunos bloqueado)
 * 2. Upload, Validação e Sanitização Estrita de HTML (XSS, scripts, event handlers, extração de plain text)
 * 3. Isolamento e Ciclo de Vida Documental (Drafts invisíveis a alunos, transição Draft -> Review -> Published)
 * 4. Versionamento Atómico e Imutabilidade (v1 -> v2, imutabilidade de versões publicadas, integridade referencial)
 * 5. Despublicação Segura e Auditoria Imutável (Preservação histórica para auditoria e logs protegidos)
 */

import { PGlite } from '@electric-sql/pglite';
import * as fs from 'fs';
import * as path from 'path';
import {
  validateAndSanitizeOfficialHtml,
  extractPlainTextFromHtml,
  MAX_HTML_SIZE_BYTES,
} from '../src/lib/htmlSanitizer';

const ALUNO_ID = '11111111-1111-4111-8111-111111111111';
const ADMIN_ID = '99999999-9999-4999-8999-999999999999';

export interface TestResult {
  id: string;
  name: string;
  status: 'PASSOU' | 'FALHOU';
  category: string;
  evidence: string;
}

const testResults: TestResult[] = [];

function recordTest(
  id: string,
  category: string,
  name: string,
  status: 'PASSOU' | 'FALHOU',
  evidence: string
) {
  testResults.push({ id, category, name, status, evidence });
  const icon = status === 'PASSOU' ? '✅ [PASSOU]' : '❌ [FALHOU]';
  console.log(`${icon} ${id}: ${name}`);
  if (status === 'FALHOU') {
    console.error(`   ⚠️ ERRO: ${evidence}`);
  }
}

export async function runPhaseBTests() {
  console.log('================================================================');
  console.log('FASE B — SUITE DE TESTES: GESTÃO SEGURA DE APONTAMENTOS HTML');
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

  // 2. Carregar migrações em ordem estrita
  const migrations = [
    '20261001000000_phase2_security_and_database.sql',
    '20261024000000_turma_c_official_schema.sql',
    '20261024010000_turma_c_phase_a1_audit_fixes.sql',
    '20261024020000_turma_c_phase_a2_verification_fixes.sql',
    '20261024030000_turma_c_phase_b_notes_management.sql',
    '20261024040000_turma_c_phase_b1_audit_fixes.sql',
  ];

  for (let i = 0; i < migrations.length; i++) {
    const migFile = migrations[i];
    const migPath = path.resolve(process.cwd(), 'supabase/migrations', migFile);
    console.log(`Carregando migração ${i + 1}/${migrations.length}: ${migFile}...`);
    const sql = fs.readFileSync(migPath, 'utf8');
    await db.exec(sql);
  }

  // Permissões padrão do Supabase para authenticated
  await db.exec(`
    GRANT USAGE ON SCHEMA public TO authenticated, anon;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
    REVOKE INSERT, UPDATE, DELETE ON public.official_first_attempts FROM authenticated, anon;
    REVOKE INSERT, UPDATE, DELETE ON public.study_stats FROM authenticated, anon;
    REVOKE UPDATE, DELETE ON public.official_note_audit_logs FROM authenticated, anon;
    GRANT SELECT, INSERT ON public.official_note_audit_logs TO authenticated;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated, anon;
  `);

  // Configurar utilizadores
  await db.exec(`
    INSERT INTO auth.users (id, email)
    VALUES 
      ('${ALUNO_ID}', 'aluno.turmac@studentshub.pt'),
      ('${ADMIN_ID}', 'admin.turmac@studentshub.pt')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.profiles (id, full_name, class_name, school_year, is_public_leaderboard)
    VALUES 
      ('${ALUNO_ID}', 'João Estudante', 'Turma C', '10º Ano', true),
      ('${ADMIN_ID}', 'Professor Coordenador', 'Turma C', '12º Ano', true)
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.user_roles (user_id, role)
    VALUES 
      ('${ALUNO_ID}', 'student'),
      ('${ADMIN_ID}', 'admin')
    ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role;
  `);

  console.log('\n--- 1. AUTENTICAÇÃO E AUTORIZAÇÃO ADMINISTRATIVA ---');

  // Teste 1.1: Aluno tenta criar apontamento oficial diretamente via RPC
  try {
    await db.exec(`SET request.jwt.claim.sub = '${ALUNO_ID}';`);
    await db.exec(`SET ROLE authenticated;`);
    let studentRpcFailed = false;
    try {
      await db.query(`
        SELECT public.create_official_note_atomic(
          'matematica-a',
          'P1',
          'Trigonometria',
          'Apontamento Forjado por Aluno',
          '<h1>Forjado</h1>',
          '<h1>Forjado</h1>',
          'Forjado'
        );
      `);
    } catch (e: any) {
      studentRpcFailed = e.message.includes('Acesso Negado');
    }

    recordTest(
      'TB-1.1',
      '1. Autenticação Administrativa',
      'Aluno autenticado impedido de invocar create_official_note_atomic',
      studentRpcFailed ? 'PASSOU' : 'FALHOU',
      studentRpcFailed ? 'RPC rejeitou aluno com exceção de Acesso Negado' : 'Aluno conseguiu invocar RPC'
    );
  } finally {
    await db.exec(`RESET ROLE;`);
  }

  // Teste 1.2: Aluno tenta INSERT direto em official_notes via SQL
  try {
    await db.exec(`SET request.jwt.claim.sub = '${ALUNO_ID}';`);
    await db.exec(`SET ROLE authenticated;`);
    let directInsertBlocked = false;
    try {
      await db.query(`
        INSERT INTO public.official_notes (subject_id, academic_period, theme, title, created_by)
        VALUES ('matematica-a', 'P1', 'Fraude', 'Injeção Direta de Aluno', '${ALUNO_ID}');
      `);
    } catch (e: any) {
      directInsertBlocked = true;
    }

    recordTest(
      'TB-1.2',
      '1. Autenticação Administrativa',
      'RLS bloqueia INSERT direto de alunos em official_notes',
      directInsertBlocked ? 'PASSOU' : 'FALHOU',
      directInsertBlocked ? 'RLS violada como esperado para inserção de aluno' : 'Aluno conseguiu inserir em official_notes'
    );
  } finally {
    await db.exec(`RESET ROLE;`);
  }

  // Teste 1.3: Aluno tenta INSERT direto em official_note_versions
  try {
    await db.exec(`SET request.jwt.claim.sub = '${ALUNO_ID}';`);
    await db.exec(`SET ROLE authenticated;`);
    let versionInsertBlocked = false;
    try {
      await db.query(`
        INSERT INTO public.official_note_versions (note_id, version_number, raw_html, sanitized_html, created_by)
        VALUES (gen_random_uuid(), 1, '<p>fraude</p>', '<p>fraude</p>', '${ALUNO_ID}');
      `);
    } catch (e: any) {
      versionInsertBlocked = true;
    }

    recordTest(
      'TB-1.3',
      '1. Autenticação Administrativa',
      'RLS bloqueia INSERT direto de alunos em official_note_versions',
      versionInsertBlocked ? 'PASSOU' : 'FALHOU',
      versionInsertBlocked ? 'RLS violada para inserção não autorizada em versões' : 'Aluno conseguiu inserir versão'
    );
  } finally {
    await db.exec(`RESET ROLE;`);
  }

  console.log('\n--- 2. VALIDAÇÃO E SANITIZAÇÃO RIGOROSA DE HTML ---');

  // Teste 2.1: Sanitização elimina tags de script executáveis
  const maliciousScript = `
    <h1>Limites Notáveis</h1>
    <p>O limite de sin(x)/x quando x tende para 0 é 1.</p>
    <script>fetch('/api/steal-tokens?cookie=' + document.cookie);</script>
    <script src="https://evil-site.com/exploit.js"></script>
  `;
  const valScript = validateAndSanitizeOfficialHtml(maliciousScript);
  const scriptStripped =
    valScript.valid &&
    !valScript.sanitizedHtml?.includes('<script') &&
    !valScript.sanitizedHtml?.includes('evil-site.com') &&
    !valScript.sanitizedHtml?.includes('steal-tokens') &&
    (valScript.sanitizedHtml?.includes('Limites Notáveis') ?? false);

  recordTest(
    'TB-2.1',
    '2. Sanitização HTML',
    'Eliminação completa de tags <script> e links para scripts externos',
    scriptStripped ? 'PASSOU' : 'FALHOU',
    scriptStripped ? 'Scripts removidos integralmente preservando o texto legítimo' : 'Script vazou para sanitized_html'
  );

  // Teste 2.2: Sanitização elimina event handlers inline (on*, onload, onerror, onclick)
  const maliciousEvents = `
    <h2>Fórmula Resolvente</h2>
    <p onclick="alert('hack')">Clique aqui para ver a raiz.</p>
    <img src="x" onerror="window.location='https://phishing.com'" />
    <span onmouseover="console.log('spy')">Passar rato</span>
  `;
  const valEvents = validateAndSanitizeOfficialHtml(maliciousEvents);
  const eventsStripped =
    valEvents.valid &&
    !valEvents.sanitizedHtml?.includes('onclick') &&
    !valEvents.sanitizedHtml?.includes('onerror') &&
    !valEvents.sanitizedHtml?.includes('onmouseover') &&
    !valEvents.sanitizedHtml?.includes('phishing.com');

  recordTest(
    'TB-2.2',
    '2. Sanitização HTML',
    'Eliminação rigorosa de event handlers inline (onclick, onerror, onmouseover)',
    eventsStripped ? 'PASSOU' : 'FALHOU',
    eventsStripped ? 'Todos os atributos on* foram expurgados pelo sanitizador' : 'Atributos perigosos permaneceram'
  );

  // Teste 2.3: Sanitização elimina iframes, formulários, inputs e objetos
  const maliciousFrames = `
    <h2>Teorema de Pitágoras</h2>
    <iframe src="https://attacker.com/login"></iframe>
    <form action="/steal"><input type="password" name="pass" /></form>
    <object data="malware.swf"></object>
  `;
  const valFrames = validateAndSanitizeOfficialHtml(maliciousFrames);
  const framesStripped =
    valFrames.valid &&
    !valFrames.sanitizedHtml?.includes('<iframe') &&
    !valFrames.sanitizedHtml?.includes('<form') &&
    !valFrames.sanitizedHtml?.includes('<input') &&
    !valFrames.sanitizedHtml?.includes('<object');

  recordTest(
    'TB-2.3',
    '2. Sanitização HTML',
    'Eliminação completa de <iframe>, <form>, <input> e <object>',
    framesStripped ? 'PASSOU' : 'FALHOU',
    framesStripped ? 'Tags ativas de captura e frames bloqueadas' : 'Vazamento de iframe ou formulário'
  );

  // Teste 2.4: Preservação de elementos curriculares ricos (tabelas, títulos, listas, blockquote, code)
  const richOfficialHtml = `
    <h1>Funções Polinomiais</h1>
    <p>Estudo do sinal e da derivada de <strong>f(x) = x³ - 3x</strong>.</p>
    <table class="w-full border">
      <thead>
        <tr><th>x</th><th>f'(x)</th><th>f(x)</th></tr>
      </thead>
      <tbody>
        <tr><td>-1</td><td>0</td><td>2 (Máximo local)</td></tr>
        <tr><td>1</td><td>0</td><td>-2 (Mínimo local)</td></tr>
      </tbody>
    </table>
    <blockquote>O gráfico muda de concavidade no ponto de inflexão (0, 0).</blockquote>
    <code>f''(x) = 6x</code>
  `;
  const valRich = validateAndSanitizeOfficialHtml(richOfficialHtml);
  const richPreserved =
    valRich.valid &&
    (valRich.sanitizedHtml?.includes('<table') ?? false) &&
    (valRich.sanitizedHtml?.includes('<th>x</th>') ?? false) &&
    (valRich.sanitizedHtml?.includes('<blockquote>') ?? false) &&
    (valRich.sanitizedHtml?.includes('<code>') ?? false) &&
    (valRich.plainText?.includes('Funções Polinomiais') ?? false);

  recordTest(
    'TB-2.4',
    '2. Sanitização HTML',
    'Preservação fidedigna de formatação tabular, citações, código e ênfases',
    richPreserved ? 'PASSOU' : 'FALHOU',
    richPreserved ? 'Tabelas, blocos de código e destaques tipográficos intactos' : 'Tags permitidas foram corrompidas'
  );

  // Teste 2.5: Extração limpa de plain_text_content sem resíduos HTML
  const extractedText = extractPlainTextFromHtml(richOfficialHtml);
  const cleanTextOk =
    !extractedText.includes('<') &&
    !extractedText.includes('>') &&
    extractedText.includes('Funções Polinomiais') &&
    extractedText.includes('Máximo local');

  recordTest(
    'TB-2.5',
    '2. Sanitização HTML',
    'Extração de plain_text_content estritamente livre de tags HTML para pesquisa curricular',
    cleanTextOk ? 'PASSOU' : 'FALHOU',
    cleanTextOk ? `Texto limpo com ${extractedText.length} caracteres gerado sem resíduos` : 'Tags HTML detectadas no texto'
  );

  // Teste 2.6: Rejeição de ficheiro vazio ou com apenas scripts maliciosos
  const onlyScript = '<script>alert(1);</script>';
  const valEmpty = validateAndSanitizeOfficialHtml(onlyScript);
  const emptyRejected = !valEmpty.valid;

  recordTest(
    'TB-2.6',
    '2. Sanitização HTML',
    'Rejeição de ficheiro cujo conteúdo após sanitização fica sem texto curricular',
    emptyRejected ? 'PASSOU' : 'FALHOU',
    emptyRejected ? 'Ficheiro sem conteúdo textual curricular foi devidamente rejeitado' : 'Ficheiro vazio aceite indevidamente'
  );

  console.log('\n--- 3. ISOLAMENTO E CICLO DE VIDA (DRAFT -> PREVIEW -> PUBLISHED) ---');

  let testNoteId: string = '';
  let testVersion1Id: string = '';

  // Teste 3.1: Admin cria apontamento oficial v1 em Draft
  try {
    await db.exec(`SET request.jwt.claim.sub = '${ADMIN_ID}';`);
    await db.exec(`SET ROLE authenticated;`);

    const sanitizedSample = validateAndSanitizeOfficialHtml(`
      <h1>Trigonometria e Funções Circulares</h1>
      <p>Relação fundamental: sin²(x) + cos²(x) = 1 para todo o x em ℝ.</p>
    `);

    const res = await db.query(`
      SELECT public.create_official_note_atomic(
        'matematica-a',
        'P1',
        'Trigonometria',
        'Fórmulas Trigonométricas e Resolução de Triângulos',
        '<p>Raw Original</p>',
        $1,
        $2,
        'Versão inicial homologada para o 1.º Período.'
      ) AS result;
    `, [sanitizedSample.sanitizedHtml, sanitizedSample.plainText]);

    const row = (res.rows[0] as any).result;
    testNoteId = row.note_id;
    testVersion1Id = row.version_id;

    const createdDraftOk = !!testNoteId && !!testVersion1Id && row.is_published === false;

    recordTest(
      'TB-3.1',
      '3. Ciclo de Vida Documental',
      'Admin cria novo apontamento oficial atomicamente em estado de rascunho (Draft)',
      createdDraftOk ? 'PASSOU' : 'FALHOU',
      createdDraftOk ? `Nota ${testNoteId} e Versão 1 criadas com is_published = false` : 'Falha na criação atómica de rascunho'
    );
  } finally {
    await db.exec(`RESET ROLE;`);
  }

  // Teste 3.2: Rascunho é completamente invisível para alunos em official_notes
  try {
    await db.exec(`SET request.jwt.claim.sub = '${ALUNO_ID}';`);
    await db.exec(`SET ROLE authenticated;`);

    const studentNotesQuery = await db.query(`
      SELECT * FROM public.official_notes WHERE id = $1;
    `, [testNoteId]);

    const draftHiddenInNotes = studentNotesQuery.rows.length === 0;

    recordTest(
      'TB-3.2',
      '3. Ciclo de Vida Documental',
      'Isolamento estrito: Alunos NÃO conseguem aceder ao apontamento em estado de rascunho',
      draftHiddenInNotes ? 'PASSOU' : 'FALHOU',
      draftHiddenInNotes ? 'Consulta do aluno retornou 0 linhas em official_notes' : 'Aluno conseguiu ler rascunho'
    );
  } finally {
    await db.exec(`RESET ROLE;`);
  }

  // Teste 3.3: Rascunho é completamente invisível para alunos em official_note_versions
  try {
    await db.exec(`SET request.jwt.claim.sub = '${ALUNO_ID}';`);
    await db.exec(`SET ROLE authenticated;`);

    const studentVersionsQuery = await db.query(`
      SELECT * FROM public.official_note_versions WHERE id = $1;
    `, [testVersion1Id]);

    const draftHiddenInVersions = studentVersionsQuery.rows.length === 0;

    recordTest(
      'TB-3.3',
      '3. Ciclo de Vida Documental',
      'Isolamento estrito: Alunos NÃO conseguem ler versões em estado de rascunho',
      draftHiddenInVersions ? 'PASSOU' : 'FALHOU',
      draftHiddenInVersions ? 'Consulta do aluno retornou 0 linhas em official_note_versions' : 'Aluno conseguiu ler versão rascunho'
    );
  } finally {
    await db.exec(`RESET ROLE;`);
  }

  // Teste 3.4: Admin publica atomicamente a versão 1
  try {
    await db.exec(`SET request.jwt.claim.sub = '${ADMIN_ID}';`);
    await db.exec(`SET ROLE authenticated;`);

    const pubRes = await db.query(`
      SELECT public.publish_official_note_version_atomic($1) AS result;
    `, [testVersion1Id]);

    const pubData = (pubRes.rows[0] as any).result;
    const publishedOk = pubData.is_published === true && pubData.version_number === 1;

    recordTest(
      'TB-3.4',
      '3. Ciclo de Vida Documental',
      'Admin publica atomicamente a versão de apontamento oficial',
      publishedOk ? 'PASSOU' : 'FALHOU',
      publishedOk ? 'Versão e apontamento pai marcados como publicados com timestamp' : 'Falha na publicação atómica'
    );
  } finally {
    await db.exec(`RESET ROLE;`);
  }

  // Teste 3.5: Aluno agora tem acesso de leitura ao apontamento publicado e à versão publicada
  try {
    await db.exec(`SET request.jwt.claim.sub = '${ALUNO_ID}';`);
    await db.exec(`SET ROLE authenticated;`);

    const studentNotesQuery = await db.query(`
      SELECT id, title, is_published, current_version_id FROM public.official_notes WHERE id = $1;
    `, [testNoteId]);

    const studentVersionQuery = await db.query(`
      SELECT id, version_number, sanitized_html, is_published FROM public.official_note_versions WHERE id = $1;
    `, [testVersion1Id]);

    const readableOk =
      studentNotesQuery.rows.length === 1 &&
      studentVersionQuery.rows.length === 1 &&
      (studentVersionQuery.rows[0] as any).is_published === true;

    recordTest(
      'TB-3.5',
      '3. Ciclo de Vida Documental',
      'Aluno acede imediatamente aos apontamentos publicados na Turma C',
      readableOk ? 'PASSOU' : 'FALHOU',
      readableOk ? 'Aluno leu o registo publicado com o sanitized_html associado' : 'Aluno não conseguiu ler apontamento publicado'
    );
  } finally {
    await db.exec(`RESET ROLE;`);
  }

  console.log('\n--- 4. VERSIONAMENTO ATÓMICO E IMUTABILIDADE ---');

  // Teste 4.1: Imutabilidade de versões publicadas (Trigger bloqueia alteração de HTML publicado)
  try {
    await db.exec(`SET request.jwt.claim.sub = '${ADMIN_ID}';`);
    await db.exec(`SET ROLE authenticated;`);

    let updateBlocked = false;
    try {
      await db.query(`
        UPDATE public.official_note_versions
        SET sanitized_html = '<p>Tentativa de adulterar versão publicada v1</p>'
        WHERE id = $1;
      `, [testVersion1Id]);
    } catch (e: any) {
      updateBlocked = e.message.includes('Violação de Imutabilidade Documental');
    }

    recordTest(
      'TB-4.1',
      '4. Versionamento e Imutabilidade',
      'Trigger de imutabilidade bloqueia estritamente alteração retroativa de conteúdo em versão publicada',
      updateBlocked ? 'PASSOU' : 'FALHOU',
      updateBlocked ? 'Trigger protegeu versão publicada lançando exceção de imutabilidade documental' : 'Versão publicada foi alterada indevidamente'
    );
  } finally {
    await db.exec(`RESET ROLE;`);
  }

  // Teste 4.2: Trigger bloqueia eliminação de versão publicada
  try {
    await db.exec(`SET request.jwt.claim.sub = '${ADMIN_ID}';`);
    await db.exec(`SET ROLE authenticated;`);

    let deleteBlocked = false;
    try {
      await db.query(`
        DELETE FROM public.official_note_versions WHERE id = $1;
      `, [testVersion1Id]);
    } catch (e: any) {
      deleteBlocked = e.message.includes('Violação de Integridade');
    }

    recordTest(
      'TB-4.2',
      '4. Versionamento e Imutabilidade',
      'Trigger bloqueia eliminação física de versões de apontamentos que já foram publicadas',
      deleteBlocked ? 'PASSOU' : 'FALHOU',
      deleteBlocked ? 'Exclusão bloqueada para salvaguardar integridade e rastreabilidade' : 'Versão publicada foi apagada'
    );
  } finally {
    await db.exec(`RESET ROLE;`);
  }

  // Teste 4.3: Criação de Nova Versão (v2) sequencial em modo Draft
  let testVersion2Id: string = '';
  try {
    await db.exec(`SET request.jwt.claim.sub = '${ADMIN_ID}';`);
    await db.exec(`SET ROLE authenticated;`);

    const v2Sanitized = validateAndSanitizeOfficialHtml(`
      <h1>Trigonometria (Revisão Alargada)</h1>
      <p>Relação fundamental: sin²(x) + cos²(x) = 1.</p>
      <p>Fórmulas de Carnot: cos(2x) = cos²(x) - sin²(x).</p>
    `);

    const v2Res = await db.query(`
      SELECT public.create_official_note_version_atomic(
        $1,
        '<p>Raw v2</p>',
        $2,
        $3,
        'Adicionadas fórmulas de duplicação e exemplos práticos.'
      ) AS result;
    `, [testNoteId, v2Sanitized.sanitizedHtml, v2Sanitized.plainText]);

    const v2Data = (v2Res.rows[0] as any).result;
    testVersion2Id = v2Data.version_id;
    const v2CreatedOk = v2Data.version_number === 2 && v2Data.is_published === false;

    recordTest(
      'TB-4.3',
      '4. Versionamento e Imutabilidade',
      'Criação atómica da Versão 2 (v2.0) com número incremental e estado inicial de rascunho',
      v2CreatedOk ? 'PASSOU' : 'FALHOU',
      v2CreatedOk ? `Versão 2 criada com id ${testVersion2Id} e is_published = false` : 'Falha na criação da versão 2'
    );
  } finally {
    await db.exec(`RESET ROLE;`);
  }

  // Teste 4.4: Enquanto a v2 está em Draft, o aluno continua a ver exclusivamente a v1 ativa
  try {
    await db.exec(`SET request.jwt.claim.sub = '${ALUNO_ID}';`);
    await db.exec(`SET ROLE authenticated;`);

    const noteCheck = await db.query(`
      SELECT current_version_id FROM public.official_notes WHERE id = $1;
    `, [testNoteId]);

    const v2StudentQuery = await db.query(`
      SELECT * FROM public.official_note_versions WHERE id = $1;
    `, [testVersion2Id]);

    const isolationV2Ok =
      (noteCheck.rows[0] as any).current_version_id === testVersion1Id &&
      v2StudentQuery.rows.length === 0;

    recordTest(
      'TB-4.4',
      '4. Versionamento e Imutabilidade',
      'Versão 1 permanece ativa e visível para alunos enquanto a Versão 2 está em rascunho',
      isolationV2Ok ? 'PASSOU' : 'FALHOU',
      isolationV2Ok ? 'current_version_id aponta para v1 e v2 está oculta dos alunos' : 'Inconsistência de versão ativa'
    );
  } finally {
    await db.exec(`RESET ROLE;`);
  }

  // Teste 4.5: Publicação da Versão 2 atualiza current_version_id atomicamente
  try {
    await db.exec(`SET request.jwt.claim.sub = '${ADMIN_ID}';`);
    await db.exec(`SET ROLE authenticated;`);

    await db.query(`
      SELECT public.publish_official_note_version_atomic($1);
    `, [testVersion2Id]);

    const noteCheck = await db.query(`
      SELECT current_version_id FROM public.official_notes WHERE id = $1;
    `, [testNoteId]);

    const switchedToV2 = (noteCheck.rows[0] as any).current_version_id === testVersion2Id;

    recordTest(
      'TB-4.5',
      '4. Versionamento e Imutabilidade',
      'Publicação da Versão 2 transfere o apontador current_version_id atomicamente para v2',
      switchedToV2 ? 'PASSOU' : 'FALHOU',
      switchedToV2 ? 'Apontamento oficial agora referencia v2 como versão ativa' : 'Falha na atualização de versão ativa'
    );
  } finally {
    await db.exec(`RESET ROLE;`);
  }

  console.log('\n--- 5. DESPUBLICAÇÃO SEGURA E AUDITORIA IMUTÁVEL ---');

  // Teste 5.1: Despublicação retira visibilidade aos alunos sem apagar o histórico
  try {
    await db.exec(`SET request.jwt.claim.sub = '${ADMIN_ID}';`);
    await db.exec(`SET ROLE authenticated;`);

    await db.query(`
      SELECT public.unpublish_official_note_atomic($1);
    `, [testNoteId]);

    // Verificar que aluno não vê mais a nota
    await db.exec(`SET request.jwt.claim.sub = '${ALUNO_ID}';`);
    const studentCheck = await db.query(`
      SELECT * FROM public.official_notes WHERE id = $1;
    `, [testNoteId]);

    const hiddenAfterUnpublish = studentCheck.rows.length === 0;

    // Verificar que na base de dados as versões continuam intactas
    await db.exec(`RESET ROLE;`);
    const countVersions = await db.query(`
      SELECT COUNT(*) as total FROM public.official_note_versions WHERE note_id = $1;
    `, [testNoteId]);

    const historyPreserved = Number((countVersions.rows[0] as any).total) === 2;

    const unpublishOk = hiddenAfterUnpublish && historyPreserved;

    recordTest(
      'TB-5.1',
      '5. Despublicação e Auditoria',
      'Despublicação oculta o apontamento dos alunos mas preserva integralmente o histórico de versões',
      unpublishOk ? 'PASSOU' : 'FALHOU',
      unpublishOk ? 'Ocultado de alunos mantendo as 2 versões intactas no repositório histórico' : 'Falha na despublicação'
    );
  } finally {
    await db.exec(`RESET ROLE;`);
  }

  // Teste 5.2: Tabela de auditoria official_note_audit_logs regista todas as ações
  try {
    await db.exec(`SET request.jwt.claim.sub = '${ADMIN_ID}';`);
    await db.exec(`SET ROLE authenticated;`);

    const auditQuery = await db.query(`
      SELECT action, performed_by FROM public.official_note_audit_logs
      WHERE note_id = $1
      ORDER BY created_at ASC;
    `, [testNoteId]);

    const actions = auditQuery.rows.map((r: any) => r.action);
    const hasCreateNote = actions.includes('create_note');
    const hasPublish = actions.includes('publish_version');
    const hasCreateVer = actions.includes('create_version');
    const hasUnpublish = actions.includes('unpublish_note');

    const auditLogsComplete = hasCreateNote && hasPublish && hasCreateVer && hasUnpublish;

    recordTest(
      'TB-5.2',
      '5. Despublicação e Auditoria',
      'Registo imutável em official_note_audit_logs cobre create, version, publish e unpublish',
      auditLogsComplete ? 'PASSOU' : 'FALHOU',
      auditLogsComplete ? `4 ações auditadas com sucesso: ${actions.join(' -> ')}` : 'Ações em falta na auditoria'
    );
  } finally {
    await db.exec(`RESET ROLE;`);
  }

  // Teste 5.3: Aluno não tem permissão para aceder à tabela de auditoria
  try {
    await db.exec(`SET request.jwt.claim.sub = '${ALUNO_ID}';`);
    await db.exec(`SET ROLE authenticated;`);

    const studentAudit = await db.query(`
      SELECT * FROM public.official_note_audit_logs;
    `);

    const auditRestricted = studentAudit.rows.length === 0;

    recordTest(
      'TB-5.3',
      '5. Despublicação e Auditoria',
      'RLS restringe consulta a official_note_audit_logs exclusivamente a administradores',
      auditRestricted ? 'PASSOU' : 'FALHOU',
      auditRestricted ? 'Aluno retornou 0 registos da tabela de auditoria' : 'Aluno conseguiu ler logs de auditoria'
    );
  } finally {
    await db.exec(`RESET ROLE;`);
  }

  // Teste 5.4: Tentativa de adulterar ou apagar logs de auditoria é bloqueada
  try {
    await db.exec(`SET request.jwt.claim.sub = '${ADMIN_ID}';`);
    await db.exec(`SET ROLE authenticated;`);

    let auditTamperBlocked = false;
    try {
      await db.query(`
        DELETE FROM public.official_note_audit_logs WHERE note_id = $1;
      `, [testNoteId]);
    } catch (e: any) {
      auditTamperBlocked = true;
    }

    recordTest(
      'TB-5.4',
      '5. Despublicação e Auditoria',
      'Registos em official_note_audit_logs são estritamente imutáveis (DELETE bloqueado)',
      auditTamperBlocked ? 'PASSOU' : 'FALHOU',
      auditTamperBlocked ? 'Privilégios de DELETE revogados para assegurar imutabilidade do log' : 'Log de auditoria foi apagado'
    );
  } finally {
    await db.exec(`RESET ROLE;`);
  }

  // Sumário Final
  console.log('\n================================================================');
  console.log('SUMÁRIO DA BATERIA DE TESTES — FASE B');
  console.log('================================================================');
  const passed = testResults.filter((r) => r.status === 'PASSOU').length;
  const failed = testResults.filter((r) => r.status === 'FALHOU').length;
  const total = testResults.length;

  console.log(`Total de Verificações: ${total}`);
  console.log(`Sucesso: ${passed}/${total} (${Math.round((passed / total) * 100)}%)`);
  console.log(`Falhas:  ${failed}/${total}`);

  if (failed > 0) {
    console.error(`\n❌ ATENÇÃO: ${failed} verificações falharam!`);
    process.exit(1);
  } else {
    console.log(`\n🎉 TODAS AS ${passed} VERIFICAÇÕES DA FASE B PASSARAM COM SUCESSO!`);
  }
}

// Execução se invocado diretamente via tsx
if (import.meta.url.endsWith(process.argv[1]) || process.argv[1]?.includes('phase-b-notes')) {
  runPhaseBTests().catch((err) => {
    console.error('Erro fatal durante a execução dos testes da Fase B:', err);
    process.exit(1);
  });
}
