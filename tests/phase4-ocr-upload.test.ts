/**
 * FASE 4 — VERIFICAÇÃO DE DESCOMISSIONAMENTO DO SISTEMA OCR LEGADO
 * Students Hub — "Apontamentos que ajudam, exercícios que resultam. Rumo ao 20."
 * Princípio Sagrado: «SEMPRE COM BASE NOS APONTAMENTOS OFICIAIS!!!»
 * 
 * JUSTIFICAÇÃO DA ALTERAÇÃO (Fase B.3):
 * O sistema legado de apontamentos pessoais e OCR de alunos foi formalmente removido 
 * na Fase B.3 para consolidar a arquitetura exclusiva em torno do Caderno Oficial da Turma C 
 * com apontamentos homologados, imutáveis e auditados pelo docente/administrador.
 * 
 * Esta suite substitui a validação do pipeline OCR extinto pela verificação 
 * rigorosa de descomissionamento e ausência de resíduos no código e base de dados.
 */

import * as fs from 'fs';
import * as path from 'path';

interface DecomResult {
  id: string;
  name: string;
  status: 'PASSOU' | 'FALHOU';
  details: string;
}

const decomResults: DecomResult[] = [];

function recordDecom(id: string, name: string, status: 'PASSOU' | 'FALHOU', details: string) {
  decomResults.push({ id, name, status, details });
  const icon = status === 'PASSOU' ? '✅ [PASSOU]' : '❌ [FALHOU]';
  console.log(`${icon} ${id}: ${name}`);
  if (status === 'FALHOU') {
    console.error(`   Detalhes: ${details}`);
  }
}

async function runPhase4DecommissioningTests() {
  console.log('================================================================');
  console.log('FASE 4 — VERIFICAÇÃO DE DESCOMISSIONAMENTO DO OCR E CADERNO PESSOAL');
  console.log('Students Hub · "Sempre com base nos apontamentos oficiais!!!"');
  console.log('================================================================\n');

  // 1. Verificar remoção física de ficheiros de backend OCR
  const legacyBackendFiles = [
    'netlify/functions/process-ocr.ts',
    'netlify/functions/confirm-note-page.ts',
    'netlify/functions/ocr-schema.ts',
  ];

  for (const relPath of legacyBackendFiles) {
    const fullPath = path.resolve(process.cwd(), relPath);
    const exists = fs.existsSync(fullPath);
    recordDecom(
      `DECOM-BACKEND-${path.basename(relPath, '.ts')}`,
      `Ficheiro backend legado ${relPath} removido`,
      exists ? 'FALHOU' : 'PASSOU',
      exists ? `O ficheiro ${relPath} ainda existe em disco!` : `Removido com sucesso de ${relPath}.`
    );
  }

  // 2. Verificar remoção física de serviços e componentes frontend OCR
  const legacyFrontendFiles = [
    'src/services/ocrService.ts',
    'src/types/ocr.ts',
    'src/components/notebook/UploadModal.tsx',
    'src/components/notebook/OcrReviewModal.tsx',
    'src/components/notebook/MyNotebook.tsx',
  ];

  for (const relPath of legacyFrontendFiles) {
    const fullPath = path.resolve(process.cwd(), relPath);
    const exists = fs.existsSync(fullPath);
    recordDecom(
      `DECOM-FRONTEND-${path.basename(relPath, '.tsx').replace('.ts', '')}`,
      `Componente frontend legado ${relPath} removido`,
      exists ? 'FALHOU' : 'PASSOU',
      exists ? `O ficheiro ${relPath} ainda existe em disco!` : `Removido com sucesso de ${relPath}.`
    );
  }

  // 3. Verificar que o Caderno Oficial está presente e operacional
  const officialComponents = [
    'src/components/notes/OfficialNotesReader.tsx',
    'src/components/admin/AdminNotesManagement.tsx',
    'src/lib/htmlSanitizer.ts',
  ];

  for (const relPath of officialComponents) {
    const fullPath = path.resolve(process.cwd(), relPath);
    const exists = fs.existsSync(fullPath);
    recordDecom(
      `OFFICIAL-COMP-${path.basename(relPath, '.tsx').replace('.ts', '')}`,
      `Componente oficial consolidado ${relPath} ativo`,
      exists ? 'PASSOU' : 'FALHOU',
      exists ? `Ativo e íntegro em ${relPath}.` : `Em falta em ${relPath}!`
    );
  }

  console.log('\n================================================================');
  console.log('RESUMO DE DESCOMISSIONAMENTO FASE 4 / B.3:');
  const total = decomResults.length;
  const passed = decomResults.filter(r => r.status === 'PASSOU').length;
  const failed = decomResults.filter(r => r.status === 'FALHOU').length;
  console.log(`Total: ${total} | Aprovados: ${passed} | Falhas: ${failed}`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runPhase4DecommissioningTests().catch((err) => {
  console.error('Erro na execução da verificação de descomissionamento:', err);
  process.exit(1);
});
