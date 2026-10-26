/**
 * TestRunnerUI — a barra de progresso reflete as perguntas RESPONDIDAS (não a pergunta atual).
 */
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { computeAnswerProgress, TestRunnerUI, QuestionData } from '../src/components/exercises/TestRunnerUI';
import { OFFICIAL_SUBJECTS } from '../src/data/subjects';

let passed = 0, failed = 0;
const check = (id: string, name: string, ok: boolean, d = '') => {
  ok ? passed++ : failed++;
  console.log(`[${ok ? '✅ PASSOU' : '❌ FALHOU'}] ${id}: ${name}`);
  if (!ok && d) console.error(`   Detalhes: ${d}`);
};

const qs = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `q${i + 1}` }));

// P-01: sem respostas → 0% (mesmo estando na 1.ª pergunta, que antes dava 25%)
let r = computeAnswerProgress(qs(4), {});
check('P-01', 'Sem respostas: 0 respondidas e 0%', r.answeredCount === 0 && r.progressPercent === 0, JSON.stringify(r));

// P-02: 1 de 4 → 25%; 3 de 4 → 75%
r = computeAnswerProgress(qs(4), { q1: 'A' });
const r3 = computeAnswerProgress(qs(4), { q1: 'A', q3: 'B', q4: 'C' });
check('P-02', '1/4 = 25% e 3/4 = 75% (answeredCount / questions.length * 100)', r.progressPercent === 25 && r3.progressPercent === 75 && r3.answeredCount === 3, JSON.stringify([r, r3]));

// P-03: navegar não altera o progresso — respostas fora de ordem contam só o que foi respondido
r = computeAnswerProgress(qs(5), { q5: 'x' });
check('P-03', 'Responder só à última pergunta dá 1/5 = 20% (independente da posição)', r.answeredCount === 1 && r.progressPercent === 20, JSON.stringify(r));

// P-04: alterar uma resposta não duplica; apagar (vazia/espaços) desconta
const base = computeAnswerProgress(qs(4), { q1: 'A', q2: 'B' });
const changed = computeAnswerProgress(qs(4), { q1: 'C', q2: 'B' });
const cleared = computeAnswerProgress(qs(4), { q1: '   ', q2: 'B' });
check('P-04', 'Alterar resposta mantém 50%; resposta vazia/espaços deixa de contar (25%)',
  base.progressPercent === 50 && changed.progressPercent === 50 && cleared.progressPercent === 25, JSON.stringify([base, changed, cleared]));

// P-05: chaves de perguntas que não pertencem à prova são ignoradas; 100% quando todas respondidas; lista vazia = 0
const stale = computeAnswerProgress(qs(2), { q1: 'A', q2: 'B', outro: 'Z' });
const empty = computeAnswerProgress([], { q1: 'A' });
check('P-05', 'Ignora ids alheios, 2/2 = 100% e prova vazia = 0% sem divisão por zero',
  stale.answeredCount === 2 && stale.progressPercent === 100 && empty.progressPercent === 0 && Number.isFinite(empty.progressPercent), JSON.stringify([stale, empty]));

// P-06: renderização real — contador "X de Y respondidas" e largura da barra a 0% no arranque
const questions: QuestionData[] = [1, 2, 3, 4].map((n) => ({
  id: `q${n}`, questionNumber: n, totalQuestions: 4, prompt: `Pergunta ${n}`,
  questionType: 'multiple_choice', options: ['A', 'B'], sourceNoteRef: 'Apontamentos Oficiais',
}));
const html = renderToStaticMarkup(
  React.createElement(TestRunnerUI, {
    subject: OFFICIAL_SUBJECTS[0], testTitle: 'Teste', questions,
    onFinishTest: () => {}, onExit: () => {},
  })
);
check('P-06', 'Render inicial: "0 de 4 respondidas (0%)", barra a width:0% e "Pergunta 1 de 4" mantido',
  html.includes('0 de 4 respondidas') && html.includes('(0%)') && html.includes('width:0%') && /Pergunta\s*(<!-- -->)?1(<!-- -->)?\s*de\s*(<!-- -->)?4/.test(html),
  html.slice(0, 600));

console.log(`\nTotal: ${passed + failed} | Aprovados: ${passed} | Falhas: ${failed}`);
if (failed > 0) process.exit(1);
