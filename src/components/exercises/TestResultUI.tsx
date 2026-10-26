import React from 'react';
import { SubjectInfo } from '../../types';
import { ExerciseReviewItem } from '../../types/exercises';
import {
  CheckCircle2,
  XCircle,
  HelpCircle,
  Clock,
  RotateCcw,
  BookOpen,
  ArrowRight,
  BookmarkCheck,
} from 'lucide-react';

interface TestResultUIProps {
  subject: SubjectInfo;
  testTitle: string;
  scoreScale20: number; // Ex: 16.00
  totalScore: number;
  maxScore: number;
  correctCount: number;
  incorrectCount: number;
  pendingCount: number;
  reviewItems: ExerciseReviewItem[];
  onRestart: () => void;
  onBackToNotebook: () => void;
}

export const TestResultUI: React.FC<TestResultUIProps> = ({
  subject,
  testTitle,
  scoreScale20,
  totalScore,
  maxScore,
  correctCount,
  incorrectCount,
  pendingCount,
  reviewItems,
  onRestart,
  onBackToNotebook,
}) => {
  const evaluatedCount = correctCount + incorrectCount;
  const percentage = maxScore > 0 ? Math.round((totalScore / maxScore) * 100) : 0;

  const isHighGrade = scoreScale20 >= 16;
  const isPassingGrade = scoreScale20 >= 10;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* 1. Cartão Principal de Classificação Oficial (Escala 0 a 20) */}
      <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-10 shadow-xs text-center space-y-6">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-100 text-slate-700 text-xs font-semibold">
          <span>{subject.name}</span>
          <span>·</span>
          <span>{testTitle}</span>
        </div>

        <div className="space-y-2">
          <div className="text-xs uppercase font-bold tracking-widest text-slate-400">
            Classificação Final Oficial
          </div>
          <div className="flex items-baseline justify-center gap-2">
            <span
              className={`text-5xl sm:text-6xl font-black font-mono tracking-tight ${
                isHighGrade
                  ? 'text-emerald-700'
                  : isPassingGrade
                  ? 'text-slate-900'
                  : 'text-rose-700'
              }`}
            >
              {scoreScale20.toFixed(1)}
            </span>
            <span className="text-2xl sm:text-3xl font-bold text-slate-400 font-mono">
              / 20
            </span>
          </div>

          <p className="text-sm font-semibold text-slate-600">
            {isHighGrade
              ? 'Excelente domínio da matéria. Rumo ao 20!'
              : isPassingGrade
              ? 'Bom trabalho. Revê os pontos assinalados para consolidar.'
              : 'Precisas de rever os apontamentos desta matéria antes do teste oficial.'}
          </p>
          <div className="text-xs text-slate-400 font-mono">
            Pontuação bruta calculada no servidor: {totalScore.toFixed(1)} / {maxScore.toFixed(1)} pts ({percentage}%)
          </div>
        </div>

        {/* Resumo de Métricas (Acertos, Erros, Pendentes) */}
        <div
          className={`grid gap-3 max-w-md mx-auto pt-4 border-t border-slate-100 ${
            pendingCount > 0 ? 'grid-cols-3' : 'grid-cols-2'
          }`}
        >
          <div className="bg-emerald-50/70 border border-emerald-100 p-3 rounded-xl">
            <div className="flex items-center justify-center gap-1 text-emerald-800 text-xs font-bold mb-1">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Acertos</span>
            </div>
            <div className="text-xl font-black text-emerald-950 font-mono">
              {correctCount}
            </div>
          </div>

          <div className="bg-rose-50/70 border border-rose-100 p-3 rounded-xl">
            <div className="flex items-center justify-center gap-1 text-rose-800 text-xs font-bold mb-1">
              <XCircle className="w-3.5 h-3.5" />
              <span>Erros</span>
            </div>
            <div className="text-xl font-black text-rose-950 font-mono">
              {incorrectCount}
            </div>
          </div>

          {pendingCount > 0 && (
            <div className="bg-amber-50/70 border border-amber-100 p-3 rounded-xl">
              <div className="flex items-center justify-center gap-1 text-amber-800 text-xs font-bold mb-1">
                <Clock className="w-3.5 h-3.5" />
                <span>Pendentes</span>
              </div>
              <div className="text-xl font-black text-amber-950 font-mono">
                {pendingCount}
              </div>
            </div>
          )}
        </div>

        {/* Botões de Ação */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-4">
          <button
            onClick={onRestart}
            className="w-full sm:w-auto px-5 py-2.5 rounded-xl border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-bold transition-all flex items-center justify-center gap-2"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Repetir Exercícios</span>
          </button>
          <button
            onClick={onBackToNotebook}
            className="w-full sm:w-auto px-6 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition-all shadow-xs flex items-center justify-center gap-2"
          >
            <BookOpen className="w-3.5 h-3.5" />
            <span>Voltar aos Apontamentos</span>
          </button>
        </div>
      </div>

      {/* 2. Revisão Oficial e Detalhada das Questões */}
      <div className="space-y-4">
        <div>
          <h3 className="text-base font-bold text-slate-900">
            Revisão das Respostas ({reviewItems.length} questões)
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            O gabarito oficial é exibido abaixo com base estrita nos apontamentos após a conclusão da sessão.
          </p>
        </div>

        <div className="space-y-3">
          {reviewItems.map((item, idx) => {
            const isPending = item.review_status === 'pending_review';
            const isCorrect = item.is_correct === true;

            return (
              <div
                key={item.exercise_id}
                className={`bg-white rounded-2xl border p-5 shadow-xs space-y-4 transition-all ${
                  isCorrect
                    ? 'border-emerald-200'
                    : isPending
                    ? 'border-amber-200'
                    : 'border-rose-200'
                }`}
              >
                {/* Cabeçalho da Questão */}
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                          isCorrect
                            ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                            : isPending
                            ? 'bg-amber-50 text-amber-800 border-amber-200'
                            : 'bg-rose-50 text-rose-800 border-rose-200'
                        }`}
                      >
                        {isCorrect
                          ? `Pergunta ${idx + 1} · Correta`
                          : isPending
                          ? `Pergunta ${idx + 1} · Pendente de Avaliação`
                          : `Pergunta ${idx + 1} · Incorreta`}
                      </span>
                    </div>
                    <h4 className="text-sm font-bold text-slate-900 pt-1 leading-snug">
                      {item.prompt}
                    </h4>
                  </div>

                  <span className="text-xs font-mono font-bold text-slate-600 shrink-0">
                    {item.awarded_points.toFixed(1)} / {item.max_points.toFixed(1)} pts
                  </span>
                </div>

                {/* Comparação: Resposta Dada vs Gabarito Oficial */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                  <div
                    className={`p-3 rounded-xl border ${
                      isCorrect
                        ? 'bg-emerald-50/50 border-emerald-100 text-emerald-950'
                        : isPending
                        ? 'bg-amber-50/50 border-amber-100 text-amber-950'
                        : 'bg-rose-50/50 border-rose-100 text-rose-950'
                    }`}
                  >
                    <span className="font-bold block text-[10px] uppercase opacity-75">
                      A tua resposta:
                    </span>
                    <span className="font-medium mt-0.5 block break-words">
                      {item.student_answer?.trim() ? item.student_answer : '(Em branco)'}
                    </span>
                  </div>

                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-slate-900">
                    <span className="font-bold block text-[10px] uppercase text-slate-500">
                      Solução oficial dos apontamentos:
                    </span>
                    <span className="font-medium mt-0.5 block break-words">
                      {item.correct_answer}
                    </span>
                  </div>
                </div>

                {/* Feedback Determinístico */}
                {item.feedback && (
                  <div className="text-xs text-slate-600 bg-slate-50 p-2.5 rounded-lg border border-slate-100">
                    <span className="font-bold text-slate-700">Avaliação do servidor: </span>
                    <span>{item.feedback}</span>
                  </div>
                )}

                {/* Evidência Documental Autorizada */}
                <div className="text-[11px] text-slate-500 flex items-start gap-1.5 pt-1 border-t border-slate-100">
                  <BookmarkCheck className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold text-slate-700">Fonte documental: </span>
                    <span>{item.source_note_ref || 'Apontamentos'}</span>
                    {item.citation_excerpt && (
                      <span className="italic text-slate-400 block mt-0.5">
                        «{item.citation_excerpt}»
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
