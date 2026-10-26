import React, { useState } from 'react';
import { SubjectInfo } from '../../types';
import { ExerciseQuestionType } from '../../types/exercises';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  AlertCircle,
  Loader2,
  HelpCircle,
} from 'lucide-react';

export interface QuestionData {
  id: string;
  questionNumber: number;
  totalQuestions: number;
  prompt: string;
  questionType: ExerciseQuestionType;
  options?: string[] | null;
  maxPoints?: number;
  sourceNoteRef: string;
}

/**
 * Progresso real: perguntas efetivamente respondidas (resposta não vazia) / total.
 * Só conta ids de perguntas desta prova; alterar uma resposta não duplica a contagem.
 */
export function computeAnswerProgress(
  questions: { id: string }[],
  selectedAnswers: Record<string, string>
): { answeredCount: number; progressPercent: number } {
  const answeredCount = questions.filter((q) => (selectedAnswers[q.id] ?? '').trim().length > 0).length;
  const progressPercent = questions.length > 0 ? (answeredCount / questions.length) * 100 : 0;
  return { answeredCount, progressPercent };
}

interface TestRunnerUIProps {
  subject: SubjectInfo;
  testTitle: string;
  questions: QuestionData[];
  isSubmitting?: boolean;
  submissionError?: string | null;
  onFinishTest: (answers: Record<string, string>) => void;
  onExit: () => void;
}

export const TestRunnerUI: React.FC<TestRunnerUIProps> = ({
  subject,
  testTitle,
  questions,
  isSubmitting = false,
  submissionError = null,
  onFinishTest,
  onExit,
}) => {
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [selectedAnswers, setSelectedAnswers] = useState<Record<string, string>>({});

  const currentQ = questions[currentQuestionIndex] || questions[0];
  const { answeredCount, progressPercent } = computeAnswerProgress(questions, selectedAnswers);

  const currentAnswer = selectedAnswers[currentQ?.id] || '';

  const handleSelectOption = (value: string) => {
    setSelectedAnswers((prev) => ({
      ...prev,
      [currentQ.id]: value,
    }));
  };

  const handleTextChange = (text: string) => {
    setSelectedAnswers((prev) => ({
      ...prev,
      [currentQ.id]: text,
    }));
  };

  const handlePrevious = () => {
    if (currentQuestionIndex > 0) {
      setCurrentQuestionIndex((prev) => prev - 1);
    }
  };

  const handleNext = () => {
    if (currentQuestionIndex < questions.length - 1) {
      setCurrentQuestionIndex((prev) => prev + 1);
    }
  };

  const handleSubmit = () => {
    onFinishTest(selectedAnswers);
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* 1. Barra Superior de Contexto e Saída */}
      <div className="flex items-center justify-between">
        <button
          onClick={onExit}
          disabled={isSubmitting}
          className="flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-slate-900 disabled:opacity-50 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Interromper e Voltar</span>
        </button>

        <div className="flex items-center gap-2">
          <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${subject.color_badge}`}>
            {subject.code}
          </span>
          <span className="text-xs font-bold text-slate-700">{testTitle}</span>
        </div>
      </div>

      {/* 2. Barra de Progresso e Navegação Rápida entre Questões */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 space-y-3">
        <div className="flex items-center justify-between text-xs">
          <span className="font-bold text-slate-900">
            Pergunta {currentQ ? currentQ.questionNumber : 0} de {questions.length}
          </span>
          <span className="text-slate-500 font-medium">
            {answeredCount} de {questions.length} respondidas ({Math.round(progressPercent)}%)
          </span>
        </div>

        <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
          <div
            className="bg-slate-900 h-full rounded-full transition-all duration-300"
            style={{ width: `${progressPercent}%` }}
          />
        </div>

        {/* Marcadores de Navegação Rápida */}
        <div className="flex items-center gap-1.5 pt-1 overflow-x-auto pb-1">
          {questions.map((q, idx) => {
            const isCurrent = idx === currentQuestionIndex;
            const hasAnswer = selectedAnswers[q.id]?.trim().length > 0;
            return (
              <button
                key={q.id}
                type="button"
                onClick={() => setCurrentQuestionIndex(idx)}
                className={`w-7 h-7 rounded-lg text-xs font-bold flex items-center justify-center transition-all shrink-0 border ${
                  isCurrent
                    ? 'border-slate-900 bg-slate-900 text-white shadow-xs'
                    : hasAnswer
                    ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                    : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'
                }`}
              >
                {idx + 1}
              </button>
            );
          })}
        </div>
      </div>

      {/* Alerta de Erro de Submissão */}
      {submissionError && (
        <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 flex items-start gap-3 text-rose-900 text-xs">
          <AlertCircle className="w-5 h-5 text-rose-700 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <span className="font-bold block">Erro na submissão ao servidor:</span>
            <span>{submissionError}</span>
          </div>
        </div>
      )}

      {/* 3. Área Principal da Questão */}
      {currentQ && (
        <div className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-10 shadow-xs space-y-8">
          {/* Cabeçalho da Pergunta */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                {currentQ.questionType === 'multiple_choice' && 'Escolha Múltipla'}
                {currentQ.questionType === 'true_false' && 'Verdadeiro ou Falso'}
                {currentQ.questionType === 'open_answer' && 'Resposta Curta / Aberta'}
                {currentQ.questionType === 'calculation' && 'Cálculo'}
              </span>
              <span className="text-[11px] font-mono text-slate-400">
                {currentQ.maxPoints ? `${currentQ.maxPoints} pts` : '20.00 pts'}
              </span>
            </div>

            <h2 className="text-lg sm:text-xl font-bold text-slate-900 leading-snug font-sans">
              {currentQ.prompt}
            </h2>

            <div className="text-[11px] text-slate-500 flex items-center gap-1.5">
              <span className="font-semibold text-slate-700">Fonte autorizada:</span>
              <span>{currentQ.sourceNoteRef}</span>
            </div>
          </div>

          {/* Área de Resposta: Escolha Múltipla */}
          {currentQ.questionType === 'multiple_choice' && currentQ.options && currentQ.options.length > 0 && (
            <div className="space-y-2.5">
              {currentQ.options.map((option, idx) => {
                const isSelected = currentAnswer === option;
                return (
                  <button
                    key={idx}
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => handleSelectOption(option)}
                    className={`w-full p-4 rounded-xl border text-left text-sm transition-all flex items-center justify-between ${
                      isSelected
                        ? 'border-slate-900 bg-slate-50 font-bold text-slate-900 shadow-xs ring-1 ring-slate-900'
                        : 'border-slate-200 hover:border-slate-300 text-slate-700 hover:bg-slate-50/50'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span
                        className={`w-6 h-6 rounded-lg text-xs font-bold flex items-center justify-center shrink-0 border ${
                          isSelected
                            ? 'bg-slate-900 text-white border-slate-900'
                            : 'bg-white text-slate-600 border-slate-300'
                        }`}
                      >
                        {String.fromCharCode(65 + idx)}
                      </span>
                      <span>{option}</span>
                    </div>
                    {isSelected && <CheckCircle2 className="w-4 h-4 text-slate-900 shrink-0" />}
                  </button>
                );
              })}
            </div>
          )}

          {/* Área de Resposta: Verdadeiro / Falso */}
          {currentQ.questionType === 'true_false' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {['Verdadeiro', 'Falso'].map((val) => {
                const isSelected = currentAnswer.toLowerCase() === val.toLowerCase();
                return (
                  <button
                    key={val}
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => handleSelectOption(val)}
                    className={`p-5 rounded-xl border text-center text-sm font-bold transition-all flex items-center justify-center gap-2 ${
                      isSelected
                        ? 'border-slate-900 bg-slate-900 text-white shadow-xs'
                        : 'border-slate-200 hover:border-slate-300 text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    {isSelected && <CheckCircle2 className="w-4 h-4 text-white" />}
                    <span>{val}</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Área de Resposta: Aberta / Resposta Curta / Cálculo */}
          {(currentQ.questionType === 'open_answer' || currentQ.questionType === 'calculation') && (
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block">
                {currentQ.questionType === 'calculation' ? 'O teu resultado ou valor numérico:' : 'A tua resposta fundamentada nos apontamentos:'}
              </label>
              <textarea
                rows={currentQ.questionType === 'calculation' ? 2 : 4}
                disabled={isSubmitting}
                value={currentAnswer}
                onChange={(e) => handleTextChange(e.target.value)}
                placeholder={currentQ.questionType === 'calculation' ? 'Ex: 4 ou 2.5' : 'Escreve a tua resposta com base estrita nos apontamentos...'}
                className="w-full p-3.5 rounded-xl border border-slate-300 text-sm focus:border-slate-900 focus:ring-1 focus:ring-slate-900 outline-none transition-all disabled:opacity-50"
              />
              <p className="text-[11px] text-slate-400">
                A resposta será corrigida no servidor exclusivamente de acordo com os apontamentos.
              </p>
            </div>
          )}

          {/* Botões de Ação Inferiores */}
          <div className="pt-6 border-t border-slate-100 flex items-center justify-between gap-3">
            <button
              type="button"
              disabled={currentQuestionIndex === 0 || isSubmitting}
              onClick={handlePrevious}
              className="px-4 py-2.5 rounded-xl border border-slate-200 hover:border-slate-300 text-slate-700 font-bold text-xs transition-all disabled:opacity-30 disabled:pointer-events-none flex items-center gap-1.5"
            >
              <ChevronLeft className="w-4 h-4" />
              <span>Anterior</span>
            </button>

            <div className="flex items-center gap-2">
              {currentQuestionIndex < questions.length - 1 ? (
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={handleNext}
                  className="px-5 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs shadow-xs transition-all flex items-center gap-1.5"
                >
                  <span>Seguinte</span>
                  <ChevronRight className="w-4 h-4" />
                </button>
              ) : (
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={handleSubmit}
                  className="px-6 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 text-white font-bold text-xs shadow-xs transition-all flex items-center gap-2"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>A submeter e corrigir no servidor...</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Concluir e Submeter Sessão</span>
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
