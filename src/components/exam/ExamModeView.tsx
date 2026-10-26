import React, { useEffect, useState } from 'react';
import { OFFICIAL_SUBJECTS } from '../../data/subjects';
import { SubjectId } from '../../types';
import { Layers, GraduationCap, Clock, Award, Info, ArrowRight, Loader2 } from 'lucide-react';
import { useAuth } from '../../services/authContext';
import { supabase, isSupabaseConfigured } from '../../services/supabaseClient';
import {
  listOfficialAssessments,
  startOfficialAssessment,
  fetchSessionQuestions,
  submitExerciseSession,
  toRunnerQuestions,
  OfficialAssessmentItem,
} from '../../services/exerciseService';
import { TestRunnerUI, QuestionData } from '../exercises/TestRunnerUI';
import { TestResultUI } from '../exercises/TestResultUI';
import { SessionResultData } from '../../types/exercises';

interface ExamModeViewProps {
  onNavigateTab?: (tab: any) => void;
}

export const ExamModeView: React.FC<ExamModeViewProps> = ({ onNavigateTab }) => {
  const { userSession } = useAuth();
  const [selectedSubjectId, setSelectedSubjectId] = useState<SubjectId>('matematica-a');
  const [assessments, setAssessments] = useState<OfficialAssessmentItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [screen, setScreen] = useState<'list' | 'runner' | 'results'>('list');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [activeTitle, setActiveTitle] = useState('');
  const [questions, setQuestions] = useState<QuestionData[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [result, setResult] = useState<(SessionResultData & { official?: { recorded?: boolean; reason?: string } }) | null>(null);

  const getToken = async (): Promise<string | null> => {
    if (userSession?.token) return userSession.token;
    if (!isSupabaseConfigured()) return null;
    const { data } = await supabase.auth.getSession();
    return data?.session?.access_token || null;
  };

  const loadAssessments = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) {
        setAssessments([]);
        setError('Inicia sessão para ver os exames e conjuntos oficiais.');
        return;
      }
      setAssessments(await listOfficialAssessments(token, selectedSubjectId));
    } catch (e: any) {
      setError(e.message || 'Erro ao carregar avaliações oficiais.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadAssessments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSubjectId, userSession?.id]);

  const handleStart = async (a: OfficialAssessmentItem) => {
    setError(null);
    setIsLoading(true);
    try {
      const token = await getToken();
      if (!token) throw new Error('Inicia sessão para realizar avaliações oficiais.');
      const started = await startOfficialAssessment(token, a.assessment_type, a.id);
      const serverQuestions = await fetchSessionQuestions(token, started.session_id);
      setSessionId(started.session_id);
      setActiveTitle(a.title);
      setQuestions(toRunnerQuestions(serverQuestions));
      setSubmissionError(null);
      setScreen('runner');
    } catch (e: any) {
      setError(e.message || 'Não foi possível iniciar a avaliação.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleFinish = async (answers: Record<string, string>) => {
    if (!sessionId) return;
    setIsSubmitting(true);
    setSubmissionError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error('Sessão expirada. Inicia sessão novamente.');
      const res: any = await submitExerciseSession(token, {
        session_id: sessionId,
        answers: questions.map((q) => ({ exercise_id: q.id, student_answer: answers[q.id] || '' })),
      });
      if (!res.success) {
        setSubmissionError(res.error || 'Erro ao submeter e corrigir a avaliação.');
        return;
      }
      setResult(res);
      setScreen('results');
      loadAssessments();
    } catch (e: any) {
      setSubmissionError(e.message || 'Falha de comunicação com o servidor.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const currentSubject =
    OFFICIAL_SUBJECTS.find((s) => s.id === selectedSubjectId) || OFFICIAL_SUBJECTS[0];

  if (screen === 'runner') {
    return (
      <TestRunnerUI
        subject={currentSubject}
        testTitle={activeTitle}
        questions={questions}
        isSubmitting={isSubmitting}
        submissionError={submissionError}
        onFinishTest={handleFinish}
        onExit={() => setScreen('list')}
      />
    );
  }

  if (screen === 'results' && result) {
    return (
      <div className="space-y-4">
        {result.official?.recorded === true && (
          <div className="max-w-4xl mx-auto p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-800 font-semibold">
            Primeira tentativa oficial registada: esta nota conta para a tua média e para o leaderboard.
          </div>
        )}
        {result.official?.reason === 'repeat_attempt' && (
          <div className="max-w-4xl mx-auto p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-700">
            Repetição de treino: a tua primeira tentativa oficial mantém-se inalterada.
          </div>
        )}
        {result.official?.reason === 'pending_review' && (
          <div className="max-w-4xl mx-auto p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800">
            Existem respostas por rever: a primeira tentativa só é registada com nota final.
          </div>
        )}
        <TestResultUI
          subject={currentSubject}
          testTitle={activeTitle}
          scoreScale20={result.score_scale_20 || 0}
          totalScore={result.total_score || 0}
          maxScore={result.max_score || 0}
          correctCount={result.correct_count || 0}
          incorrectCount={result.incorrect_count || 0}
          pendingCount={result.pending_count || 0}
          reviewItems={result.exercises || []}
          onRestart={() => {
            setResult(null);
            setSessionId(null);
            setScreen('list');
          }}
          onBackToNotebook={() => onNavigateTab?.('notes')}
        />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* 1. Cabeçalho de Modo Exame */}
      <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-6">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
              Simulação Global
            </span>
            <span className="text-slate-300">/</span>
            <span className="text-xs font-bold text-slate-900">Preparação de Exames</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight mt-1">
            Modo Exame
          </h1>
          <p className="text-xs text-slate-600 mt-1 max-w-xl leading-relaxed">
            Exames oficiais com exercícios de P1, P2 e P3, baseados exclusivamente nos apontamentos oficiais da turma.
          </p>
        </div>

        <div className="w-14 h-14 rounded-2xl bg-slate-900 text-white flex items-center justify-center shrink-0 shadow-xs">
          <Layers className="w-7 h-7" />
        </div>
      </div>

      {/* 2. Seleção de Disciplina para o Exame */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-4">
        <div>
          <h2 className="text-base font-bold text-slate-900">Seleciona a Disciplina do Exame</h2>
          <p className="text-xs text-slate-500">
            Mostramos os exames e conjuntos oficiais publicados para a disciplina escolhida.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
          {OFFICIAL_SUBJECTS.map((subj) => (
            <button
              key={subj.id}
              type="button"
              onClick={() => setSelectedSubjectId(subj.id)}
              className={`p-4 rounded-xl border text-left transition-all flex flex-col justify-between ${
                selectedSubjectId === subj.id
                  ? 'border-slate-900 bg-slate-50 ring-1 ring-slate-900 shadow-xs'
                  : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50/50'
              }`}
            >
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-bold border ${subj.color_badge}`}
                  >
                    {subj.code}
                  </span>
                  <span className="text-[10px] text-slate-400">{subj.grade_level}</span>
                </div>
                <div className="text-sm font-bold text-slate-900 pt-1">{subj.name}</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* 3. Exames e Conjuntos Oficiais Publicados */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-8 shadow-xs space-y-6">
        <div className="border-b border-slate-100 pb-4">
          <h3 className="text-base font-bold text-slate-900">
            Avaliações Oficiais: {currentSubject.name}
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Exames (P1 + P2 + P3) e conjuntos de exercícios baseados exclusivamente nos apontamentos oficiais.
            A tua primeira tentativa conta para a média e para o leaderboard; podes repetir para treinar.
          </p>
        </div>

        {error && (
          <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700">{error}</div>
        )}

        {isLoading && (
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>A carregar…</span>
          </div>
        )}

        {!isLoading && !error && assessments.length === 0 && (
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600 flex items-start gap-2">
            <Info className="w-4 h-4 text-blue-800 shrink-0 mt-0.5" />
            <p className="leading-relaxed">
              Ainda não há exames ou conjuntos oficiais publicados para esta disciplina.
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {assessments.map((a) => (
            <div key={`${a.assessment_type}:${a.id}`} className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="px-2 py-0.5 rounded text-[10px] font-bold border border-slate-300 text-slate-700 bg-white">
                  {a.assessment_type === 'exam' ? 'EXAME P1+P2+P3' : 'CONJUNTO'}
                </span>
                <span className="flex items-center gap-1 text-[11px] text-slate-500">
                  <Award className="w-3.5 h-3.5" />
                  {a.total_points} pts
                </span>
              </div>
              <div className="text-sm font-bold text-slate-900">{a.title}</div>
              {a.first_attempt ? (
                <div className="text-[11px] text-slate-600">
                  1.ª tentativa: <span className="font-bold text-slate-900">{a.first_attempt.score_percentage}%</span>{' '}
                  ({a.first_attempt.score_scale_20}/20) · repetir é treino
                </div>
              ) : (
                <div className="text-[11px] text-slate-500">Ainda não realizaste esta avaliação.</div>
              )}
              <button
                type="button"
                onClick={() => handleStart(a)}
                disabled={isLoading}
                className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-slate-900 text-white text-xs font-bold hover:bg-slate-800 disabled:opacity-50 transition-colors"
              >
                <span>{a.first_attempt ? 'Repetir' : 'Iniciar'}</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
