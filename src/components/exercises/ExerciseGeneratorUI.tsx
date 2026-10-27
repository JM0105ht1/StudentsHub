import React, { useState, useEffect } from 'react';
import { OFFICIAL_SUBJECTS } from '../../data/subjects';
import { SubjectId } from '../../types';
import { TestRunnerUI, QuestionData } from './TestRunnerUI';
import { TestResultUI } from './TestResultUI';
import { useAuth } from '../../services/authContext';
import { supabase, isSupabaseConfigured } from '../../services/supabaseClient';
import {
  submitExerciseSession,
  startPracticeSession,
  fetchSessionQuestions,
  toRunnerQuestions,
} from '../../services/exerciseService';
import { SessionResultData } from '../../types/exercises';
import {
  BookOpen,
  Filter,
  CheckCircle2,
  Layers,
  Sparkles,
  Play,
  Info,
  Sliders,
  AlertTriangle,
  Loader2,
  ArrowRight,
} from 'lucide-react';

interface ExerciseGeneratorUIProps {
  initialSubjectId?: SubjectId;
  initialTestId?: string;
  onNavigateTab: (tab: any) => void;
}

interface TestOption {
  id: string;
  title: string;
  academicTerm: string;
}

export const ExerciseGeneratorUI: React.FC<ExerciseGeneratorUIProps> = ({
  initialSubjectId = 'matematica-a',
  initialTestId,
  onNavigateTab,
}) => {
  const { userSession } = useAuth();
  const [selectedSubjectId, setSelectedSubjectId] = useState<SubjectId>(initialSubjectId);
  const [selectedDifficulty, setSelectedDifficulty] = useState<string>('media');
  // Quantidade de perguntas por tipo (0 = não incluir). Total máximo: 20.
  const MAX_TOTAL_QUESTIONS = 20;
  const [typeCounts, setTypeCounts] = useState<Record<string, number>>({
    multiple_choice: 5,
    true_false: 0,
    open_answer: 0,
    calculation: 0,
  });
  const totalQuestions: number = (Object.values(typeCounts) as number[]).reduce((a: number, b: number) => a + b, 0);
  const setTypeCount = (typeId: string, value: number) => {
    const others = totalQuestions - (typeCounts[typeId] || 0);
    const clamped = Math.max(0, Math.min(value, MAX_TOTAL_QUESTIONS - others));
    setTypeCounts((prev) => ({ ...prev, [typeId]: clamped }));
  };
  const [selectedSource, setSelectedSource] = useState<string>(initialTestId || 'all');

  // Testes reais do utilizador obtidos da base de dados
  const [availableTests, setAvailableTests] = useState<TestOption[]>([]);
  const [isLoadingTests, setIsLoadingTests] = useState<boolean>(false);

  // Estados de execução e geração do backend
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [insufficientMessage, setInsufficientMessage] = useState<string | null>(null);

  // Sessão ativa e submissão (Fase 6)
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [isSubmittingTest, setIsSubmittingTest] = useState<boolean>(false);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [sessionResult, setSessionResult] = useState<SessionResultData | null>(null);

  // Questões geradas pelo motor Grounded
  const [generatedQuestions, setGeneratedQuestions] = useState<QuestionData[] | null>(null);

  // Estado do fluxo de teste interativo
  const [activeScreen, setActiveScreen] = useState<'config' | 'runner' | 'results'>('config');
  const [testScore, setTestScore] = useState<number>(16.0);

  const currentSubject =
    OFFICIAL_SUBJECTS.find((s) => s.id === selectedSubjectId) || OFFICIAL_SUBJECTS[0];

  // Carregar testes da disciplina pertencentes ao aluno
  useEffect(() => {
    let isMounted = true;
    async function loadNotes() {
      if (!isSupabaseConfigured()) {
        setAvailableTests([
          { id: 'all', title: 'Todos os Apontamentos Oficiais', academicTerm: '1º Período' },
        ]);
        return;
      }

      setIsLoadingTests(true);
      try {
        const { data, error } = await supabase
          .from('official_notes')
          .select('id, title, academic_period, theme')
          .eq('subject_id', selectedSubjectId)
          .eq('is_published', true)
          .order('academic_period', { ascending: true });

        if (!error && data && isMounted) {
          setAvailableTests(data.map((t: any) => ({
            id: t.id,
            title: `${t.title} (${t.theme})`,
            academicTerm: t.academic_period || 'Geral',
          })));
        }
      } catch (err) {
        console.warn('Erro ao carregar apontamentos oficiais:', err);
      } finally {
        if (isMounted) setIsLoadingTests(false);
      }
    }

    loadNotes();
    return () => {
      isMounted = false;
    };
  }, [selectedSubjectId]);

  const questionTypes = [
    { id: 'multiple_choice', label: 'Escolha múltipla' },
    { id: 'true_false', label: 'Verdadeiro / Falso' },
    { id: 'open_answer', label: 'Resposta aberta (curta / desenvolvimento)' },
    { id: 'calculation', label: 'Cálculo' },
  ];

  const difficultyLevels = [
    { id: 'facil', label: 'Fácil' },
    { id: 'media', label: 'Média' },
    { id: 'dificil', label: 'Difícil' },
    { id: 'mista', label: 'Mista' },
  ];

  // Função principal de geração Grounded
  const handleStartWorkout = async () => {
    setIsGenerating(true);
    setGenerationError(null);
    setInsufficientMessage(null);

    try {
      if (isSupabaseConfigured()) {
        let authToken = userSession?.token;
        if (!authToken) {
          const { data: sessionData } = await supabase.auth.getSession();
          authToken = sessionData?.session?.access_token;
        }
        if (!authToken) {
          setGenerationError('Inicia sessão para treinar com os exercícios oficiais.');
          setIsGenerating(false);
          return;
        }

        // O servidor cria a sessão REAL e as cópias dos exercícios oficiais publicados
        const diffMap: Record<string, string> = { facil: 'facil', media: 'medio', dificil: 'dificil', mista: 'mixed' };

        const started = await startPracticeSession(authToken, {
          subject_id: selectedSubjectId,
          type_counts: typeCounts,
          difficulty: diffMap[selectedDifficulty] || 'mixed',
        });

        if (started.success && started.session_id) {
          const serverQuestions = await fetchSessionQuestions(authToken, started.session_id);
          setCurrentSessionId(started.session_id);
          setGeneratedQuestions(toRunnerQuestions(serverQuestions));
          setActiveScreen('runner');
          setIsGenerating(false);
          return;
        }
      }

      // Se ainda não houver exercícios publicados na base de dados
      setInsufficientMessage(
        'Ainda não existem exercícios oficiais homologados e publicados para esta matéria nos Apontamentos da Turma C. Só o administrador pode criar e publicar novos exercícios.'
      );
    } catch (err: any) {
      setGenerationError(err.message || 'Erro ao carregar exercícios oficiais.');
    } finally {
      setIsGenerating(false);
    }
  };

  // Submissão oficial das respostas ao servidor (Fase 6)
  const handleSubmitTest = async (answers: Record<string, string>) => {
    if (!currentSessionId) {
      setSubmissionError('Identificador da sessão não encontrado.');
      return;
    }

    setIsSubmittingTest(true);
    setSubmissionError(null);

    try {
      let authToken = userSession?.token;
      if (!authToken && isSupabaseConfigured()) {
        const { data: sessionData } = await supabase.auth.getSession();
        authToken = sessionData?.session?.access_token;
      }
      if (!authToken) {
        authToken = userSession?.id || 'mock-student-session';
      }

      const payloadAnswers = (generatedQuestions || []).map((q) => ({
        exercise_id: q.id,
        student_answer: answers[q.id] || '',
      }));

      const res = await submitExerciseSession(authToken, {
        session_id: currentSessionId,
        answers: payloadAnswers,
      });

      if (!res.success) {
        setSubmissionError(res.error || 'Erro ao submeter e avaliar exercícios no servidor.');
        setIsSubmittingTest(false);
        return;
      }

      setSessionResult(res as SessionResultData);
      setActiveScreen('results');
    } catch (err: any) {
      setSubmissionError(err.message || 'Falha de comunicação com o servidor de avaliação.');
    } finally {
      setIsSubmittingTest(false);
    }
  };

  if (activeScreen === 'runner') {
    return (
      <TestRunnerUI
        subject={currentSubject}
        testTitle={`Treino de Avaliação · ${currentSubject.name}`}
        questions={generatedQuestions || []}
        isSubmitting={isSubmittingTest}
        submissionError={submissionError}
        onFinishTest={handleSubmitTest}
        onExit={() => setActiveScreen('config')}
      />
    );
  }

  if (activeScreen === 'results' && sessionResult) {
    return (
      <TestResultUI
        subject={currentSubject}
        testTitle={`Treino de Avaliação · ${currentSubject.name}`}
        scoreScale20={sessionResult.score_scale_20 || 0}
        totalScore={sessionResult.total_score || 0}
        maxScore={sessionResult.max_score || 0}
        correctCount={sessionResult.correct_count || 0}
        incorrectCount={sessionResult.incorrect_count || 0}
        pendingCount={sessionResult.pending_count || 0}
        reviewItems={sessionResult.exercises || []}
        onRestart={() => {
          setSessionResult(null);
          setCurrentSessionId(null);
          setActiveScreen('config');
        }}
        onBackToNotebook={() => onNavigateTab('notes')}
      />
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* 1. Cabeçalho Oficial */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-8 shadow-xs space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
            Área de Treino Oficial
          </span>
          <span className="text-slate-300">/</span>
          <span className="text-xs font-bold text-slate-900">Turma C</span>
        </div>
        <h1 className="text-2xl font-black text-slate-900 tracking-tight">
          Treinar Exercícios dos Apontamentos da Turma C
        </h1>
        <p className="text-xs text-slate-600 max-w-2xl leading-relaxed">
          Princípio Sagrado: <strong className="text-slate-900 font-bold">«SEMPRE COM BASE NOS APONTAMENTOS OFICIAIS!!!»</strong>. Os exercícios oficiais são formulados estritamente a partir das matérias homologadas pelos professores curadores, garantindo alinhamento curricular total rumo ao 20.
        </p>
      </div>

      {/* Banner Exclusivo para Administradores / Curadores */}
      {userSession?.role === 'admin' && (
        <div className="p-4 rounded-xl bg-slate-900 text-white flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-xs">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-amber-400/20 text-amber-400 flex items-center justify-center">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <div className="text-xs font-bold text-white flex items-center gap-2">
                <span>Curadoria de Conteúdos da Turma C (Fase C)</span>
                <span className="px-1.5 py-0.2 rounded bg-amber-400/20 text-amber-300 text-[10px] uppercase font-bold">
                  Admin
                </span>
              </div>
              <p className="text-[11px] text-slate-300">
                Podes gerar novos lotes de exercícios com o Gemini e rever enunciados, gabaritos e rubricas antes da publicação.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onNavigateTab('admin-notes')}
            className="px-4 py-2 bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold text-xs rounded-lg transition-colors whitespace-nowrap shadow-xs"
          >
            Criar Exercícios
          </button>
        </div>
      )}

      {/* Alerta de Conteúdo Insuficiente (Grounded Rule) */}
      {insufficientMessage && (
        <div className="p-6 rounded-2xl bg-amber-50 border border-amber-200 text-amber-900 shadow-xs space-y-3 animate-in fade-in duration-300">
          <div className="flex items-center gap-2 font-bold text-sm text-amber-950">
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
            <span>Exercícios Oficiais Pendentes de Homologação</span>
          </div>
          <p className="text-xs leading-relaxed text-amber-800">
            {insufficientMessage}
          </p>
          <div className="pt-2">
            <button
              type="button"
              onClick={() => onNavigateTab('notes')}
              className="px-5 py-2.5 rounded-xl bg-amber-900 hover:bg-amber-800 text-white font-bold text-xs shadow-xs transition-all flex items-center gap-2"
            >
              <BookOpen className="w-4 h-4" />
              <span>Consultar Apontamentos Oficiais Publicados</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Alerta de Erro de Geração */}
      {generationError && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs font-medium space-y-1">
          <div className="font-bold">Não foi possível carregar os exercícios:</div>
          <div>{generationError}</div>
        </div>
      )}

      {/* 2. Painel de Configuração e Filtros */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-8 shadow-xs space-y-6">
        {/* Disciplina Selecionada */}
        <div className="space-y-2">
          <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block">
            1. Seleciona a Disciplina
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
            {OFFICIAL_SUBJECTS.map((subj) => (
              <button
                key={subj.id}
                type="button"
                onClick={() => {
                  setSelectedSubjectId(subj.id);
                  setSelectedSource('all');
                  setInsufficientMessage(null);
                  setGenerationError(null);
                }}
                className={`p-3 rounded-xl border text-center transition-all flex flex-col items-center gap-1 ${
                  selectedSubjectId === subj.id
                    ? 'border-slate-900 bg-slate-900 text-white shadow-xs font-bold'
                    : 'border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                }`}
              >
                <span className="text-xs font-mono font-bold">{subj.code}</span>
                <span className="text-[11px] truncate w-full">{subj.name}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Fonte do Teste */}
        <div className="space-y-2 pt-2 border-t border-slate-100">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block">
              2. Fonte dos Exercícios (Apontamentos)
            </label>
            {isLoadingTests && (
              <span className="text-[11px] text-slate-400 flex items-center gap-1 font-mono">
                <Loader2 className="w-3 h-3 animate-spin" /> a carregar testes...
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => setSelectedSource('all')}
              className={`p-3.5 rounded-xl border text-left transition-all ${
                selectedSource === 'all'
                  ? 'border-slate-900 bg-slate-50 text-slate-900 ring-1 ring-slate-900 font-bold'
                  : 'border-slate-200 text-slate-700 hover:bg-slate-50'
              }`}
            >
              <div className="text-xs font-bold">Todos os Testes da Disciplina</div>
              <div className="text-[11px] text-slate-500 font-normal mt-0.5">
                Revisão Global dos Apontamentos
              </div>
            </button>

            {availableTests.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setSelectedSource(t.id)}
                className={`p-3.5 rounded-xl border text-left transition-all ${
                  selectedSource === t.id
                    ? 'border-slate-900 bg-slate-50 text-slate-900 ring-1 ring-slate-900 font-bold'
                    : 'border-slate-200 text-slate-700 hover:bg-slate-50'
                }`}
              >
                <div className="text-xs font-bold truncate">{t.title}</div>
                <div className="text-[11px] text-slate-500 font-normal mt-0.5">
                  {t.academicTerm}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Quantidade por Tipo de Pergunta */}
        <div className="space-y-3 pt-2 border-t border-slate-100">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block">
              3. Quantas perguntas de cada tipo?
            </label>
            <span
              className={`text-xs font-bold font-mono px-2 py-0.5 rounded ${
                totalQuestions === 0
                  ? 'bg-rose-50 text-rose-700'
                  : totalQuestions >= MAX_TOTAL_QUESTIONS
                  ? 'bg-amber-50 text-amber-800'
                  : 'bg-slate-100 text-slate-700'
              }`}
            >
              Total: {totalQuestions} / {MAX_TOTAL_QUESTIONS}
            </span>
          </div>

          <div className="space-y-3">
            {questionTypes.map((type) => {
              const value = typeCounts[type.id] || 0;
              const maxForThis = value + (MAX_TOTAL_QUESTIONS - totalQuestions);
              return (
                <div
                  key={type.id}
                  className={`p-3.5 rounded-xl border transition-all ${
                    value > 0 ? 'border-slate-900 bg-slate-50' : 'border-slate-200 bg-white'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-slate-800">{type.label}</span>
                    <span
                      className={`min-w-[2rem] text-center text-xs font-bold font-mono px-2 py-0.5 rounded ${
                        value > 0 ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      {value}
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max={MAX_TOTAL_QUESTIONS}
                    value={value}
                    onChange={(e) => setTypeCount(type.id, Math.min(parseInt(e.target.value, 10), maxForThis))}
                    className="w-full accent-slate-900 cursor-pointer"
                    aria-label={`Número de perguntas: ${type.label}`}
                  />
                  <div className="flex justify-between text-[10px] text-slate-400 font-mono">
                    <span>0</span>
                    <span>10</span>
                    <span>20</span>
                  </div>
                </div>
              );
            })}
          </div>
          <p className="text-[11px] text-slate-400">
            Põe a 0 os tipos que não queres. O total máximo é de {MAX_TOTAL_QUESTIONS} perguntas.
          </p>
        </div>

        {/* Dificuldade */}
        <div className="space-y-2 pt-2 border-t border-slate-100">
          <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block">
            4. Grau de Exigência / Dificuldade
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {difficultyLevels.map((diff) => (
              <button
                key={diff.id}
                type="button"
                onClick={() => setSelectedDifficulty(diff.id)}
                className={`p-2.5 rounded-xl border text-xs font-semibold text-center transition-all ${
                  selectedDifficulty === diff.id
                    ? 'border-slate-900 bg-slate-900 text-white font-bold'
                    : 'border-slate-200 text-slate-700 hover:bg-slate-50'
                }`}
              >
                {diff.label}
              </button>
            ))}
          </div>
        </div>

        {/* Regra Sagrada: Apontamentos Confirmados */}
        <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-600 space-y-1">
          <div className="flex items-center gap-1.5 font-bold text-slate-900">
            <Info className="w-4 h-4 text-blue-800" />
            <span>Garantia de Fidelidade aos Apontamentos:</span>
          </div>
          <p className="leading-relaxed">
            O motor compõe os exercícios exclusivamente com base nos apontamentos publicados. Toda a pergunta cita formalmente a página e o excerto de origem.
          </p>
        </div>

        {/* Botão de Criação / Início de Teste */}
        <div className="pt-2 flex flex-col sm:flex-row items-center justify-between gap-4">
          <span className="text-xs text-slate-400">
            Tempo estimado: {totalQuestions * 2} minutos
          </span>
          <button
            type="button"
            disabled={isGenerating || totalQuestions < 1}
            onClick={handleStartWorkout}
            className="w-full sm:w-auto px-7 py-3 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white font-bold text-xs shadow-xs transition-all flex items-center justify-center gap-2 group cursor-pointer"
          >
            {isGenerating ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin text-white" />
                <span>A analisar apontamentos e a gerar...</span>
              </>
            ) : (
              <>
                <Play className="w-4 h-4 fill-white group-hover:translate-x-0.5 transition-transform" />
                <span>Iniciar Treino de Exercícios</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
