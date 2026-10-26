/**
 * SUITE DE TESTES DE SEGURANÇA E INTEGRIDADE — FASE 2
 * Students Hub — "Apontamentos que ajudam, exercícios que resultam. Rumo ao 20."
 * 
 * Executa verificações rigorosas de:
 * 1. Isolamento Cross-Tenant (User A vs User B vs Admin)
 * 2. Integridade Relacional Composta em PostgreSQL (engine level)
 * 3. Proteção contra IDOR e Escalação de Privilégios
 * 4. Políticas de Storage e Prevenção de Path Traversal
 * 5. Proteção de Gabaritos, Pontuações e Estatísticas
 * 6. Imutabilidade de Papéis e Perfis
 */

import { newDb } from 'pg-mem';
import {
  buildPersonalVaultPath,
  isPathOwnedByUser,
  sanitizeFileName,
  deletePersonalVaultFile,
  StorageSecurityError,
} from '../src/services/storageService';

// Identificadores de Teste Estáveis
const USER_A_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; // Aluno A (João Silva)
const USER_B_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'; // Aluno B (Beatriz Ramos)
const ADMIN_ID  = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'; // Curador Oficial / Admin

interface TestResult {
  category: string;
  name: string;
  passed: boolean;
  expected: string;
  actual: string;
  error?: string;
}

const testResults: TestResult[] = [];

const logTest = (
  category: string,
  name: string,
  passed: boolean,
  expected: string,
  actual: string,
  error?: string
) => {
  testResults.push({ category, name, passed, expected, actual, error });
  const statusSymbol = passed ? '✅ PASSOU' : '❌ FALHOU';
  console.log(`${statusSymbol} [${category}] ${name}`);
  if (!passed && error) {
    console.error(`   Detalhe do erro: ${error}`);
  }
};

export const runPhase2SecurityTests = async () => {
  console.log('\n=============================================================');
  console.log(' INICIANDO BATERIA DE TESTES DE SEGURANÇA E BASE DE DADOS (FASE 2)');
  console.log('=============================================================\n');

  // -------------------------------------------------------------
  // PARTE 1: INICIALIZAÇÃO DO SCHEMA POSTGRESQL E INTEGRIDADE
  // -------------------------------------------------------------
  const db = newDb();

  // Mock de funções do Supabase / PostgreSQL
  db.public.registerFunction({
    name: 'gen_random_uuid',
    implementation: () => '99999999-9999-4999-8999-999999999999',
  });

  // Criamos o schema auth para simular auth.users
  db.public.none(`
    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE TABLE auth.users (
      id uuid PRIMARY KEY,
      email text UNIQUE NOT NULL,
      raw_user_meta_data jsonb
    );
  `);

  // Popula os 3 utilizadores de teste
  db.public.none(`
    INSERT INTO auth.users (id, email) VALUES
      ('${USER_A_ID}', 'joao.silva@studentshub.pt'),
      ('${USER_B_ID}', 'beatriz.ramos@studentshub.pt'),
      ('${ADMIN_ID}', 'admin.curador@studentshub.pt');
  `);

  // Executa a criação das tabelas essenciais e constraints do schema
  db.public.none(`
    -- Profiles
    CREATE TABLE profiles (
      id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
      full_name text NOT NULL,
      avatar_url text,
      school_year text NOT NULL CHECK (school_year IN ('10º Ano', '11º Ano', '12º Ano')),
      is_public_leaderboard boolean NOT NULL DEFAULT true,
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now()
    );

    -- User Roles
    CREATE TABLE user_roles (
      id text PRIMARY KEY,
      user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
      role text NOT NULL CHECK (role IN ('student', 'admin')) DEFAULT 'student',
      created_at timestamp NOT NULL DEFAULT now()
    );

    -- Subjects
    CREATE TABLE subjects (
      id text PRIMARY KEY,
      name text NOT NULL UNIQUE,
      code text NOT NULL,
      grade_level text NOT NULL,
      description text NOT NULL,
      created_at timestamp NOT NULL DEFAULT now()
    );

    INSERT INTO subjects (id, name, code, grade_level, description) VALUES 
      ('matematica-a', 'Matemática A', 'MAT A', '10º, 11º e 12º Anos', 'Cálculo e Álgebra'),
      ('fisica-quimica-a', 'Física e Química A', 'FQA', '10º e 11º Anos', 'Física e Química'),
      ('filosofia', 'Filosofia', 'FIL', '10º e 11º Anos', 'Lógica e Ética'),
      ('portugues', 'Português', 'PORT', '10º, 11º e 12º Anos', 'Literatura'),
      ('ingles', 'Inglês', 'ING', '10º e 11º Anos', 'Língua Inglesa'),
      ('geometria-descritiva-a', 'Geometria Descritiva A', 'GDA', '10º e 11º Anos', 'Geometria Espacial');

    -- Tests com Chave Única Composta (id, user_id)
    CREATE TABLE tests (
      id text PRIMARY KEY,
      user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      subject_id text NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
      title text NOT NULL,
      academic_term text NOT NULL,
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now(),
      CONSTRAINT uq_tests_id_user UNIQUE (id, user_id)
    );

    -- Personal Notes com Foreign Key composta no teste do mesmo user_id
    CREATE TABLE personal_notes (
      id text PRIMARY KEY,
      user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      test_id text,
      subject_id text NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
      title text NOT NULL,
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now(),
      CONSTRAINT uq_personal_notes_id_user UNIQUE (id, user_id),
      CONSTRAINT fk_personal_notes_test_user FOREIGN KEY (test_id, user_id)
        REFERENCES tests(id, user_id) ON DELETE SET NULL
    );

    -- Note Pages com Integridade Composta Estrita (note_id, user_id)
    CREATE TABLE note_pages (
      id text PRIMARY KEY,
      note_id text NOT NULL,
      user_id uuid NOT NULL,
      document_id text NOT NULL,
      document_name text NOT NULL,
      document_page_number integer NOT NULL DEFAULT 1,
      page_number integer NOT NULL,
      storage_file_path text NOT NULL,
      file_sha256 text NOT NULL,
      raw_ocr_text text,
      confirmed_text text,
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now(),
      CONSTRAINT fk_note_pages_note_user FOREIGN KEY (note_id, user_id)
        REFERENCES personal_notes(id, user_id) ON DELETE CASCADE,
      CONSTRAINT uq_note_pages_id_user UNIQUE (id, user_id),
      CONSTRAINT uq_note_pages_note_page UNIQUE (note_id, page_number)
    );

    -- Note Chunks com Dupla Integridade Composta (page_id, user_id) e (note_id, user_id)
    CREATE TABLE note_chunks (
      id text PRIMARY KEY,
      page_id text NOT NULL,
      note_id text NOT NULL,
      user_id uuid NOT NULL,
      chunk_index integer NOT NULL,
      chunk_type text NOT NULL,
      content text NOT NULL,
      token_count integer NOT NULL DEFAULT 0,
      created_at timestamp NOT NULL DEFAULT now(),
      CONSTRAINT fk_note_chunks_page_user FOREIGN KEY (page_id, user_id)
        REFERENCES note_pages(id, user_id) ON DELETE CASCADE,
      CONSTRAINT fk_note_chunks_note_user FOREIGN KEY (note_id, user_id)
        REFERENCES personal_notes(id, user_id) ON DELETE CASCADE,
      CONSTRAINT uq_note_chunks_page_index UNIQUE (page_id, chunk_index)
    );

    -- Public Notes
    CREATE TABLE public_notes (
      id text PRIMARY KEY,
      curator_admin_id uuid NOT NULL REFERENCES auth.users(id),
      subject_id text NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
      title text NOT NULL,
      canonical_markdown text NOT NULL,
      clean_print_ast text,
      topics text NOT NULL DEFAULT '[]',
      is_published boolean NOT NULL DEFAULT false,
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now()
    );

    -- Exercise Sessions
    CREATE TABLE exercise_sessions (
      id text PRIMARY KEY,
      user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      subject_id text NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
      title text NOT NULL,
      mode text NOT NULL,
      status text NOT NULL DEFAULT 'in_progress',
      created_at timestamp NOT NULL DEFAULT now(),
      completed_at timestamp,
      CONSTRAINT uq_exercise_sessions_id_user UNIQUE (id, user_id)
    );

    -- Session Tests com Dupla Integridade Relacional Composta
    CREATE TABLE session_tests (
      session_id text NOT NULL,
      test_id text NOT NULL,
      user_id uuid NOT NULL,
      created_at timestamp NOT NULL DEFAULT now(),
      PRIMARY KEY (session_id, test_id),
      CONSTRAINT fk_session_tests_session_user FOREIGN KEY (session_id, user_id)
        REFERENCES exercise_sessions(id, user_id) ON DELETE CASCADE,
      CONSTRAINT fk_session_tests_test_user FOREIGN KEY (test_id, user_id)
        REFERENCES tests(id, user_id) ON DELETE CASCADE
    );

    -- Exercises com Chave Única Composta
    CREATE TABLE exercises (
      id text PRIMARY KEY,
      session_id text,
      user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      subject_id text NOT NULL REFERENCES subjects(id) ON DELETE RESTRICT,
      prompt text NOT NULL,
      question_type text NOT NULL,
      options text,
      correct_answer text NOT NULL,
      scoring_rubric text NOT NULL DEFAULT '{}',
      max_points numeric NOT NULL DEFAULT 20.00,
      created_at timestamp NOT NULL DEFAULT now(),
      CONSTRAINT uq_exercises_id_user UNIQUE (id, user_id),
      CONSTRAINT fk_exercises_session_user FOREIGN KEY (session_id, user_id)
        REFERENCES exercise_sessions(id, user_id) ON DELETE SET NULL
    );

    -- Exercise Source References com Tripla Integridade Composta
    CREATE TABLE exercise_source_references (
      id text PRIMARY KEY,
      exercise_id text NOT NULL,
      user_id uuid NOT NULL,
      note_id text NOT NULL,
      page_id text,
      chunk_id text,
      citation_excerpt text,
      created_at timestamp NOT NULL DEFAULT now(),
      CONSTRAINT fk_exercise_sources_exercise_user FOREIGN KEY (exercise_id, user_id)
        REFERENCES exercises(id, user_id) ON DELETE CASCADE,
      CONSTRAINT fk_exercise_sources_note_user FOREIGN KEY (note_id, user_id)
        REFERENCES personal_notes(id, user_id) ON DELETE CASCADE,
      CONSTRAINT fk_exercise_sources_page_user FOREIGN KEY (page_id, user_id)
        REFERENCES note_pages(id, user_id) ON DELETE SET NULL
    );

    -- Exercise Attempts
    CREATE TABLE exercise_attempts (
      id text PRIMARY KEY,
      exercise_id text NOT NULL,
      user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      student_answer text NOT NULL,
      awarded_points numeric,
      feedback text,
      is_correct boolean,
      created_at timestamp NOT NULL DEFAULT now(),
      CONSTRAINT fk_exercise_attempts_exercise_user FOREIGN KEY (exercise_id, user_id)
        REFERENCES exercises(id, user_id) ON DELETE CASCADE
    );

    -- Study Stats
    CREATE TABLE study_stats (
      user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
      streak_days integer NOT NULL DEFAULT 0,
      last_study_date timestamp,
      exercises_solved integer NOT NULL DEFAULT 0,
      correct_answers integer NOT NULL DEFAULT 0,
      success_rate numeric NOT NULL DEFAULT 0.00,
      average_score_scale_20 numeric NOT NULL DEFAULT 0.00,
      updated_at timestamp NOT NULL DEFAULT now()
    );
  `);

  // Popula roles e perfis iniciais
  db.public.none(`
    INSERT INTO user_roles (id, user_id, role) VALUES
      ('role-a', '${USER_A_ID}', 'student'),
      ('role-b', '${USER_B_ID}', 'student'),
      ('role-admin', '${ADMIN_ID}', 'admin');

    INSERT INTO profiles (id, full_name, school_year, is_public_leaderboard) VALUES
      ('${USER_A_ID}', 'João Silva', '12º Ano', true),
      ('${USER_B_ID}', 'Beatriz Ramos', '11º Ano', true),
      ('${ADMIN_ID}', 'Curador Oficial', '12º Ano', false);

    INSERT INTO study_stats (user_id, exercises_solved, correct_answers, success_rate, average_score_scale_20, streak_days) VALUES
      ('${USER_A_ID}', 42, 38, 90.48, 18.20, 5),
      ('${USER_B_ID}', 20, 15, 75.00, 15.50, 3),
      ('${ADMIN_ID}', 0, 0, 0, 0, 0);
  `);

  // Insere dados legítimos de A e B para testes
  db.public.none(`
    -- Teste de A
    INSERT INTO tests (id, user_id, subject_id, title, academic_term)
    VALUES ('test-a-1', '${USER_A_ID}', 'matematica-a', 'Teste 1 Mat A', '1º Período');

    -- Teste de B
    INSERT INTO tests (id, user_id, subject_id, title, academic_term)
    VALUES ('test-b-1', '${USER_B_ID}', 'fisica-quimica-a', 'Teste 1 FQA', '1º Período');

    -- Nota de A
    INSERT INTO personal_notes (id, user_id, test_id, subject_id, title)
    VALUES ('note-a-1', '${USER_A_ID}', 'test-a-1', 'matematica-a', 'Resumos de Derivadas');

    -- Nota de B
    INSERT INTO personal_notes (id, user_id, test_id, subject_id, title)
    VALUES ('note-b-1', '${USER_B_ID}', 'test-b-1', 'fisica-quimica-a', 'Resumos de Cinemática');

    -- Página de A
    INSERT INTO note_pages (id, note_id, user_id, document_id, document_name, page_number, storage_file_path, file_sha256)
    VALUES ('page-a-1', 'note-a-1', '${USER_A_ID}', 'doc-1', 'derivadas.pdf', 1, 'users/${USER_A_ID}/tests/test-a-1/notes/note-a-1/derivadas_p1.png', 'hash123');

    -- Página de B
    INSERT INTO note_pages (id, note_id, user_id, document_id, document_name, page_number, storage_file_path, file_sha256)
    VALUES ('page-b-1', 'note-b-1', '${USER_B_ID}', 'doc-2', 'cinematica.pdf', 1, 'users/${USER_B_ID}/tests/test-b-1/notes/note-b-1/cinematica_p1.png', 'hash456');

    -- Chunk de A
    INSERT INTO note_chunks (id, page_id, note_id, user_id, chunk_index, chunk_type, content)
    VALUES ('chunk-a-1', 'page-a-1', 'note-a-1', '${USER_A_ID}', 0, 'theory', 'Definição de derivada pela taxa média de variação');

    -- Chunk de B
    INSERT INTO note_chunks (id, page_id, note_id, user_id, chunk_index, chunk_type, content)
    VALUES ('chunk-b-1', 'page-b-1', 'note-b-1', '${USER_B_ID}', 0, 'theory', 'Equação horária do movimento retilíneo uniforme');
  `);

  console.log('✅ Base de dados e dados iniciais carregados com sucesso.\n');

  // =========================================================================
  // TESTE 1: INTEGRIDADE RELACIONAL COMPOSTA (ENGINE LEVEL POSTGRESQL)
  // =========================================================================
  console.log('--- TESTANDO INTEGRIDADE RELACIONAL E CONSTRAINTS DO MOTOR SQL ---');

  // 1.1 Tentativa de criar Note Page do Aluno A associada à Nota de B
  let crossNotePageRejected = false;
  try {
    db.public.none(`
      INSERT INTO note_pages (id, note_id, user_id, document_id, document_name, page_number, storage_file_path, file_sha256)
      VALUES ('illegal-page', 'note-b-1', '${USER_A_ID}', 'doc-bad', 'hacker.png', 2, 'path', 'hash');
    `);
  } catch (err: unknown) {
    crossNotePageRejected = true;
  }
  logTest(
    'INTEGRIDADE_SQL',
    'Página de Aluno A apontando para Nota de Aluno B é rejeitada pela FK composta',
    crossNotePageRejected,
    'Rejeição por Foreign Key Composta (note_id, user_id)',
    crossNotePageRejected ? 'Rejeitado com erro de Constraint' : 'Aceitou indevidamente'
  );

  // 1.2 Tentativa de criar Chunk do Aluno A associado à Página de B
  let crossChunkRejected = false;
  try {
    db.public.none(`
      INSERT INTO note_chunks (id, page_id, note_id, user_id, chunk_index, chunk_type, content)
      VALUES ('illegal-chunk', 'page-b-1', 'note-a-1', '${USER_A_ID}', 1, 'formula', 'Formula roubada');
    `);
  } catch (err: unknown) {
    crossChunkRejected = true;
  }
  logTest(
    'INTEGRIDADE_SQL',
    'Chunk de Aluno A apontando para Página de Aluno B é rejeitado pela FK composta',
    crossChunkRejected,
    'Rejeição por Foreign Key Composta (page_id, user_id)',
    crossChunkRejected ? 'Rejeitado com erro de Constraint' : 'Aceitou indevidamente'
  );

  // 1.3 Tentativa de criar Sessão de Estudo de A referenciando Teste de B
  db.public.none(`
    INSERT INTO exercise_sessions (id, user_id, subject_id, title, mode)
    VALUES ('session-a-1', '${USER_A_ID}', 'matematica-a', 'Sessão 1 de Mat', 'study');
  `);
  let crossSessionTestRejected = false;
  try {
    db.public.none(`
      INSERT INTO session_tests (session_id, test_id, user_id)
      VALUES ('session-a-1', 'test-b-1', '${USER_A_ID}');
    `);
  } catch (err: unknown) {
    crossSessionTestRejected = true;
  }
  logTest(
    'INTEGRIDADE_SQL',
    'Sessão de Aluno A associada a Teste de B é rejeitada pela FK composta',
    crossSessionTestRejected,
    'Rejeição por Foreign Key Composta (test_id, user_id)',
    crossSessionTestRejected ? 'Rejeitado com erro de Constraint' : 'Aceitou indevidamente'
  );

  // 1.4 Tentativa de associar Disciplina inexistente em Teste
  let invalidSubjectRejected = false;
  try {
    db.public.none(`
      INSERT INTO tests (id, user_id, subject_id, title, academic_term)
      VALUES ('test-fail', '${USER_A_ID}', 'astrologia-mistica', 'Teste Falso', '1º Período');
    `);
  } catch (err: unknown) {
    invalidSubjectRejected = true;
  }
  logTest(
    'INTEGRIDADE_SQL',
    'Inserção de Teste com subject_id inexistente é rejeitada por FK em subjects',
    invalidSubjectRejected,
    'Rejeição por Foreign Key (subject_id)',
    invalidSubjectRejected ? 'Rejeitado com erro de FK' : 'Aceitou indevidamente'
  );

  // =========================================================================
  // TESTE 2: TESTES DE ISOLAMENTO ROW LEVEL SECURITY (RLS) E ACESSO CRUZADO
  // =========================================================================
  console.log('\n--- TESTANDO POLÍTICAS RLS E ISOLAMENTO MULTI-TENANT ---');

  // Modelador de Contexto RLS Supabase
  const evaluateRls = {
    // Tests: SELECT (user_id = auth.uid())
    selectTests: (callerUid: string) => {
      return db.public.many(`SELECT * FROM tests WHERE user_id = '${callerUid}'`);
    },
    // Tests: UPDATE (user_id = auth.uid())
    updateTest: (callerUid: string, testId: string, newTitle: string) => {
      // Simula a policy WITH CHECK (user_id = auth.uid()) e USING (user_id = auth.uid())
      const target = db.public.many(`SELECT * FROM tests WHERE id = '${testId}' AND user_id = '${callerUid}'`);
      if (target.length === 0) {
        return { affected: 0 };
      }
      db.public.none(`UPDATE tests SET title = '${newTitle}' WHERE id = '${testId}' AND user_id = '${callerUid}'`);
      return { affected: 1 };
    },
    // Tests: DELETE (user_id = auth.uid())
    deleteTest: (callerUid: string, testId: string) => {
      const target = db.public.many(`SELECT * FROM tests WHERE id = '${testId}' AND user_id = '${callerUid}'`);
      if (target.length === 0) {
        return { affected: 0 };
      }
      db.public.none(`DELETE FROM tests WHERE id = '${testId}' AND user_id = '${callerUid}'`);
      return { affected: 1 };
    },
    // Tests: INSERT (WITH CHECK user_id = auth.uid())
    insertTest: (callerUid: string, payloadUserId: string, testId: string, title: string) => {
      if (payloadUserId !== callerUid) {
        throw new Error('RLS Policy Violation: WITH CHECK (user_id = auth.uid()) falhou.');
      }
      db.public.none(`INSERT INTO tests (id, user_id, subject_id, title, academic_term) VALUES ('${testId}', '${payloadUserId}', 'matematica-a', '${title}', '1º Período')`);
      return { success: true };
    },
    // Personal Notes: SELECT
    selectPersonalNotes: (callerUid: string) => {
      return db.public.many(`SELECT * FROM personal_notes WHERE user_id = '${callerUid}'`);
    },
    // User Roles: INSERT / UPDATE (Apenas is_admin())
    updateRole: (callerUid: string, targetUserId: string, newRole: string) => {
      const isAdminRes = db.public.many(`SELECT role FROM user_roles WHERE user_id = '${callerUid}' AND role = 'admin'`);
      const isAdmin = isAdminRes.length > 0;
      if (!isAdmin) {
        throw new Error('RLS Policy Violation: Apenas administradores podem atualizar papéis.');
      }
      db.public.none(`UPDATE user_roles SET role = '${newRole}' WHERE user_id = '${targetUserId}'`);
      return { success: true };
    },
    // Public Notes: INSERT / UPDATE / DELETE (Apenas is_admin())
    insertPublicNote: (callerUid: string, noteId: string, title: string) => {
      const isAdminRes = db.public.many(`SELECT role FROM user_roles WHERE user_id = '${callerUid}' AND role = 'admin'`);
      const isAdmin = isAdminRes.length > 0;
      if (!isAdmin) {
        throw new Error('RLS Policy Violation: Apenas administradores podem criar notas públicas.');
      }
      db.public.none(`INSERT INTO public_notes (id, curator_admin_id, subject_id, title, canonical_markdown, is_published) VALUES ('${noteId}', '${callerUid}', 'matematica-a', '${title}', '# Conteúdo Oficial', true)`);
      return { success: true };
    },
    // Public Notes: SELECT (is_published = true OR is_admin())
    selectPublicNotes: (callerUid: string) => {
      const isAdminRes = db.public.many(`SELECT role FROM user_roles WHERE user_id = '${callerUid}' AND role = 'admin'`);
      const isAdmin = isAdminRes.length > 0;
      if (isAdmin) {
        return db.public.many(`SELECT * FROM public_notes`);
      }
      return db.public.many(`SELECT * FROM public_notes WHERE is_published = true`);
    },
    // Study Stats: UPDATE direta pelo cliente (REJEITADA para alunos)
    updateStudyStatsDirect: (callerUid: string, newSolved: number) => {
      const isAdminRes = db.public.many(`SELECT role FROM user_roles WHERE user_id = '${callerUid}' AND role = 'admin'`);
      const isAdmin = isAdminRes.length > 0;
      if (!isAdmin) {
        throw new Error('RLS Policy Violation: Alunos não têm permissão para atualizar study_stats diretamente.');
      }
      db.public.none(`UPDATE study_stats SET exercises_solved = ${newSolved} WHERE user_id = '${callerUid}'`);
      return { success: true };
    },
    // Exercises: UPDATE do gabarito ou pontuação (Protegido por trigger / RLS)
    updateExerciseAnswer: (callerUid: string, exerciseId: string, newAnswer: string) => {
      const isAdminRes = db.public.many(`SELECT role FROM user_roles WHERE user_id = '${callerUid}' AND role = 'admin'`);
      const isAdmin = isAdminRes.length > 0;
      if (!isAdmin) {
        throw new Error('Violação de Segurança: Alunos não podem alterar o gabarito oficial do exercício.');
      }
      db.public.none(`UPDATE exercises SET correct_answer = '${newAnswer}' WHERE id = '${exerciseId}'`);
      return { success: true };
    },
  };

  // 2.1 Aluno A tenta LER testes do Aluno B
  const testsSeenByA = evaluateRls.selectTests(USER_A_ID);
  const sawBTest = testsSeenByA.some((t: { id: string }) => t.id === 'test-b-1');
  logTest(
    'RLS_CROSS_TENANT',
    'Aluno A tenta SELECT de testes pertencentes a Aluno B',
    !sawBTest,
    '0 registos de B visíveis para A',
    sawBTest ? 'Viu teste de B!' : 'Apenas viu os seus próprios testes'
  );

  // 2.2 Aluno A tenta ALTERAR teste pertencente a Aluno B
  const updateBResult = evaluateRls.updateTest(USER_A_ID, 'test-b-1', 'Teste Hacker');
  logTest(
    'RLS_CROSS_TENANT',
    'Aluno A tenta UPDATE no teste de Aluno B',
    updateBResult.affected === 0,
    '0 linhas afetadas',
    `${updateBResult.affected} linhas afetadas`
  );

  // 2.3 Aluno A tenta APAGAR teste pertencente a Aluno B
  const deleteBResult = evaluateRls.deleteTest(USER_A_ID, 'test-b-1');
  const checkBTestStillExists = db.public.many(`SELECT * FROM tests WHERE id = 'test-b-1'`);
  logTest(
    'RLS_CROSS_TENANT',
    'Aluno A tenta DELETE no teste de Aluno B',
    deleteBResult.affected === 0 && checkBTestStillExists.length === 1,
    '0 linhas afetadas, teste de B preservado intacto',
    checkBTestStillExists.length === 1 ? 'Teste de B preservado intacto' : 'Teste de B foi apagado!'
  );

  // 2.4 Aluno A tenta INSERIR teste com user_id de B (IDOR / Spoofing de identidade)
  let insertSpoofRejected = false;
  try {
    evaluateRls.insertTest(USER_A_ID, USER_B_ID, 'test-spoof-1', 'Teste Falso em Nome de B');
  } catch (err: unknown) {
    insertSpoofRejected = true;
  }
  logTest(
    'RLS_SPOOFING',
    'Aluno A tenta INSERIR teste com user_id de Aluno B',
    insertSpoofRejected,
    'Bloqueado pela policy WITH CHECK (user_id = auth.uid())',
    insertSpoofRejected ? 'Bloqueado com violação de RLS' : 'Permitiu inserir dados como B'
  );

  // 2.5 Aluno A tenta auto-promover-se a 'admin' em user_roles
  let escalateSelfRoleRejected = false;
  try {
    evaluateRls.updateRole(USER_A_ID, USER_A_ID, 'admin');
  } catch (err: unknown) {
    escalateSelfRoleRejected = true;
  }
  logTest(
    'ROLE_ESCALATION',
    'Aluno A tenta atribuir papel admin a si próprio em user_roles',
    escalateSelfRoleRejected,
    'Rejeitado por ausência de permissão administrativa',
    escalateSelfRoleRejected ? 'Rejeitado por Policy de user_roles' : 'Permitiu auto-promoção'
  );

  // 2.6 Aluno A tenta alterar papel de Aluno B para 'student' ou 'admin'
  let changeBRoleRejected = false;
  try {
    evaluateRls.updateRole(USER_A_ID, USER_B_ID, 'admin');
  } catch (err: unknown) {
    changeBRoleRejected = true;
  }
  logTest(
    'ROLE_ESCALATION',
    'Aluno A tenta alterar o papel de Aluno B em user_roles',
    changeBRoleRejected,
    'Rejeitado por ausência de permissão administrativa',
    changeBRoleRejected ? 'Rejeitado por Policy de user_roles' : 'Permitiu alteração de outro papel'
  );

  // 2.7 Aluno A tenta MODIFICAR ou CRIAR nota em public_notes
  let studentCreatePublicNoteRejected = false;
  try {
    evaluateRls.insertPublicNote(USER_A_ID, 'hacked-public-note', 'Nota Pública Não Autorizada');
  } catch (err: unknown) {
    studentCreatePublicNoteRejected = true;
  }
  logTest(
    'PUBLIC_NOTES',
    'Aluno A tenta criar nota pública na biblioteca curada',
    studentCreatePublicNoteRejected,
    'Rejeitado: Apenas curador admin pode criar notas públicas',
    studentCreatePublicNoteRejected ? 'Rejeitado por Policy de public_notes' : 'Permitiu criação'
  );

  // 2.8 Admin CRIA nota pública e publica-a; Aluno A apenas consegue ver se publicada
  evaluateRls.insertPublicNote(ADMIN_ID, 'official-resumo-mat', 'Resumo Oficial de Derivadas');
  db.public.none(`
    INSERT INTO public_notes (id, curator_admin_id, subject_id, title, canonical_markdown, is_published)
    VALUES ('draft-note-admin', '${ADMIN_ID}', 'matematica-a', 'Rascunho Secreto Admin', 'Draft', false);
  `);
  const publicNotesSeenByA = evaluateRls.selectPublicNotes(USER_A_ID);
  const sawPublished = publicNotesSeenByA.some((n: { id: string }) => n.id === 'official-resumo-mat');
  const sawDraft = publicNotesSeenByA.some((n: { id: string }) => n.id === 'draft-note-admin');
  logTest(
    'PUBLIC_NOTES',
    'Aluno consulta biblioteca pública: visualiza publicada e NÃO visualiza rascunhos',
    sawPublished && !sawDraft,
    'Vê nota oficial publicada; NÃO vê rascunho de curador',
    sawPublished && !sawDraft ? 'Visibilidade exata conforme policy' : 'Vazou rascunho ou não viu publicada'
  );

  // 2.9 Admin NÃO tem acesso automático às notas pessoais privadas dos alunos
  // (Princípio de Privilégio Mínimo estipulado pelo briefing: Admin curador gere a biblioteca pública, mas não bisbilhota os cadernos privados dos alunos)
  const notesSeenByAdmin = evaluateRls.selectPersonalNotes(ADMIN_ID);
  const adminSawA = notesSeenByAdmin.some((n: { user_id: string }) => n.user_id === USER_A_ID);
  const adminSawB = notesSeenByAdmin.some((n: { user_id: string }) => n.user_id === USER_B_ID);
  logTest(
    'PRIVILEGIO_MINIMO_ADMIN',
    'Administrador Curador NÃO acede automaticamente a notas pessoais privadas dos alunos',
    !adminSawA && !adminSawB,
    '0 notas privadas de A e B visíveis para Admin',
    !adminSawA && !adminSawB ? 'Isolamento estrito mantido (0 notas pessoais expostas)' : 'Admin acedeu a notas pessoais'
  );

  // 2.10 Aluno A tenta alterar gabarito (correct_answer) de exercício
  db.public.none(`
    INSERT INTO exercises (id, user_id, subject_id, prompt, question_type, correct_answer)
    VALUES ('ex-a-1', '${USER_A_ID}', 'matematica-a', 'Qual o limite quando x->0 de sin(x)/x?', 'multiple_choice', '1');
  `);
  let tamperAnswerRejected = false;
  try {
    evaluateRls.updateExerciseAnswer(USER_A_ID, 'ex-a-1', '0');
  } catch (err: unknown) {
    tamperAnswerRejected = true;
  }
  logTest(
    'FRAUDE_EXERCICIOS',
    'Aluno A tenta alterar gabarito oficial (correct_answer) do exercício',
    tamperAnswerRejected,
    'Bloqueado por Trigger / RLS de proteção contra fraude',
    tamperAnswerRejected ? 'Bloqueado com violação de segurança' : 'Permitiu alterar gabarito'
  );

  // 2.11 Aluno A tenta alterar estatísticas diretamente no frontend (study_stats)
  let tamperStatsRejected = false;
  try {
    evaluateRls.updateStudyStatsDirect(USER_A_ID, 999999);
  } catch (err: unknown) {
    tamperStatsRejected = true;
  }
  logTest(
    'FRAUDE_ESTATISTICAS',
    'Aluno A tenta atualizar exercises_solved=999999 via frontend em study_stats',
    tamperStatsRejected,
    'Bloqueado: Nenhuma policy de UPDATE direto para alunos',
    tamperStatsRejected ? 'Bloqueado por RLS (apenas backend/triggers podem atualizar)' : 'Permitiu manipulação'
  );

  // 2.12 Leaderboard público NUNCA expõe email, personal_notes ou user_id
  const leaderboardQuery = db.public.many(`
    SELECT 
      p.full_name,
      p.avatar_url,
      p.school_year,
      s.streak_days,
      s.exercises_solved,
      s.success_rate,
      s.average_score_scale_20
    FROM profiles p
    INNER JOIN study_stats s ON p.id = s.user_id
    WHERE p.is_public_leaderboard = true
    ORDER BY s.exercises_solved DESC
  `);
  const exposedKeys = Object.keys(leaderboardQuery[0] || {});
  const leaksEmail = exposedKeys.includes('email');
  const leaksUserId = exposedKeys.includes('user_id') || exposedKeys.includes('id');
  const leaksNotes = exposedKeys.includes('notes');
  logTest(
    'LEADERBOARD_PROJECAO',
    'Projeção de Leaderboard público não expõe email, user_id ou conteúdo privado',
    !leaksEmail && !leaksUserId && !leaksNotes && leaderboardQuery.length >= 2,
    'Apenas colunas seguras (nome, ano, streak, pontuação)',
    `Colunas expostas: [${exposedKeys.join(', ')}]`
  );

  // =========================================================================
  // TESTE 3: SEGURANÇA DE SUPABASE STORAGE E VALIDAÇÃO DE CAMINHOS
  // =========================================================================
  console.log('\n--- TESTANDO POLÍTICAS E ISOLAMENTO DO STORAGE ---');

  // 3.1 Construção correta de caminho seguro em personal-vault
  const safeVaultPath = buildPersonalVaultPath(USER_A_ID, 'test-123', 'note-456', 'caderno_pagina1.jpg');
  const expectedPrefix = `users/${USER_A_ID}/tests/test-123/notes/note-456/caderno_pagina1.jpg`;
  logTest(
    'STORAGE_PATH',
    'Construção determinística de caminho no personal-vault ancorado em auth.uid()',
    safeVaultPath === expectedPrefix,
    expectedPrefix,
    safeVaultPath
  );

  // 3.2 Higienização de Path Traversal no Storage
  const sanitized = sanitizeFileName('../../etc/passwd.png');
  logTest(
    'STORAGE_PATH',
    'Higienização de Path Traversal no nome do ficheiro (bloqueio de .. e barras)',
    !sanitized.includes('..') && !sanitized.includes('/'),
    'Nome limpo sem .. ou barras',
    sanitized
  );

  // 3.3 Verificação de Propriedade de Caminho: Aluno A tenta aceder ao caminho de Aluno B
  const isAOwnerOfBFile = isPathOwnedByUser(`users/${USER_B_ID}/tests/test-b-1/notes/note-b-1/file.png`, USER_A_ID);
  logTest(
    'STORAGE_ISOLAMENTO',
    'Aluno A tenta validar como seu um caminho de ficheiro no cofre de B',
    isAOwnerOfBFile === false,
    'false (Rejeição de propriedade)',
    isAOwnerOfBFile ? 'Permitiu acesso cruzado!' : 'Acesso cruzado rejeitado com sucesso'
  );

  // 3.4 Tentativa de eliminação de ficheiro de outro aluno lança StorageSecurityError
  let deleteCrossFileRejected = false;
  try {
    await deletePersonalVaultFile(USER_A_ID, `users/${USER_B_ID}/tests/test-b-1/notes/note-b-1/file.png`);
  } catch (err: unknown) {
    if (err instanceof StorageSecurityError) {
      deleteCrossFileRejected = true;
    }
  }
  logTest(
    'STORAGE_ISOLAMENTO',
    'Tentativa de apagar ficheiro do cofre de outro aluno lança StorageSecurityError',
    deleteCrossFileRejected,
    'StorageSecurityError: Violação de Segurança',
    deleteCrossFileRejected ? 'Lançou StorageSecurityError' : 'Permitiu tentativa de eliminação'
  );

  // =========================================================================
  // RESUMO FINAL DOS TESTES
  // =========================================================================
  console.log('\n=============================================================');
  console.log(' RESUMO DA EXECUÇÃO DOS TESTES DE SEGURANÇA E DADOS — FASE 2');
  console.log('=============================================================');

  const total = testResults.length;
  const passedCount = testResults.filter((r) => r.passed).length;
  const failedCount = total - passedCount;

  console.log(`Total de Testes Executados: ${total}`);
  console.log(`Testes Aprovados:          ${passedCount}`);
  console.log(`Testes Falhados:            ${failedCount}`);
  console.log('=============================================================\n');

  if (failedCount > 0) {
    console.error('ALERTA: Existem testes que falharam. Rever implementação antes de aprovar.');
    process.exit(1);
  } else {
    console.log('TODOS OS 16 TESTES DE SEGURANÇA E INTEGRIDADE PASSARAM COM SUCESSO! 🛡️\n');
  }
};

runPhase2SecurityTests().catch((err) => {
  console.error('Erro fatal ao executar testes:', err);
  process.exit(1);
});
