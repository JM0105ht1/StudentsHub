/**
 * TESTE DE SEGURANÇA E BLOQUEIO DO ENDPOINT LEGADO DE GERAÇÃO
 * Valida a proteção mínima pré-Fase C em netlify/functions/generate-exercises.ts
 */

process.env.NODE_ENV = 'test';

import { handler as generateExercisesHandler } from '../netlify/functions/generate-exercises';

const ALUNO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ADMIN_ID = '99999999-9999-4999-8999-999999999999';

async function runSecurityTests() {
  console.log('================================================================');
  console.log('TESTES DE SEGURANÇA DO ENDPOINT LEGADO DE GERAÇÃO (PRÉ-FASE C)');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  // 1. Chamada sem autenticação (deve rejeitar com 401)
  const noAuthRes = await generateExercisesHandler(
    {
      httpMethod: 'POST',
      headers: {},
      body: JSON.stringify({ subject_id: 'matematica-a', count: 5 }),
    } as any,
    {} as any,
    () => {}
  ) as any;

  if (noAuthRes.statusCode === 401) {
    console.log('✅ [PASSOU] SEC-GEN-01: Chamada não autenticada bloqueada com HTTP 401');
    passed++;
  } else {
    console.error('❌ [FALHOU] SEC-GEN-01: Esperava 401, recebeu:', noAuthRes.statusCode);
    failed++;
  }

  // 2. Chamada por aluno (403 FORBIDDEN_ADMIN_ONLY: apenas administradores geram exercícios oficiais — Fase C)
  const studentRes = await generateExercisesHandler(
    {
      httpMethod: 'POST',
      headers: { authorization: `Bearer ${ALUNO_ID}` },
      body: JSON.stringify({ subject_id: 'matematica-a', count: 5 }),
    } as any,
    {} as any,
    () => {}
  ) as any;

  const studentBody = JSON.parse(studentRes.body || '{}');
  if (
    studentRes.statusCode === 403 &&
    studentBody.code === 'FORBIDDEN_ADMIN_ONLY'
  ) {
    console.log('✅ [PASSOU] SEC-GEN-02: Chamada por aluno bloqueada com HTTP 403 (FORBIDDEN_ADMIN_ONLY)');
    passed++;
  } else {
    console.error('❌ [FALHOU] SEC-GEN-02: Esperava 403 com FORBIDDEN_ADMIN_ONLY, recebeu:', studentRes);
    failed++;
  }

  // 3. Método HTTP inválido (GET deve rejeitar com 405)
  const getRes = await generateExercisesHandler(
    {
      httpMethod: 'GET',
      headers: { authorization: `Bearer ${ALUNO_ID}` },
    } as any,
    {} as any,
    () => {}
  ) as any;

  if (getRes.statusCode === 405) {
    console.log('✅ [PASSOU] SEC-GEN-03: Método HTTP GET rejeitado com HTTP 405');
    passed++;
  } else {
    console.error('❌ [FALHOU] SEC-GEN-03: Esperava 405, recebeu:', getRes.statusCode);
    failed++;
  }

  console.log('\n================================================================');
  console.log(`Total: ${passed + failed} | Aprovados: ${passed} | Falhas: ${failed}`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runSecurityTests().catch((err) => {
  console.error('Erro ao executar testes:', err);
  process.exit(1);
});
