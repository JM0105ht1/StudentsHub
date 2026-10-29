import React, { useState, useEffect } from 'react';
import { supabase, isSupabaseConfigured } from '../../services/supabaseClient';
import { useAuth } from '../../services/authContext';
import { OfficialNote } from '../../services/officialNotesService';
import {
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  X,
  Quote,
  Eye,
  Save,
  Check,
  Send,
  HelpCircle,
  FileText,
  Sliders,
  ShieldCheck,
} from 'lucide-react';

interface AdminExerciseReviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  note: OfficialNote | null;
  onExercisesUpdated?: () => void;
}

export interface OfficialDraftExercise {
  id: string;
  prompt: string;
  question_type: string;
  options: string[] | null;
  correct_answer: string;
  scoring_rubric: {
    criteria?: string[];
    explanation?: string;
  } | null;
  max_points: number;
  difficulty: string;
  status: 'draft' | 'published';
  is_official: boolean;
  quote_excerpt?: string;
  content_hash?: string;
  official_section?: string;
}

export const AdminExerciseReviewModal: React.FC<AdminExerciseReviewModalProps> = ({
  isOpen,
  onClose,
  note,
  onExercisesUpdated,
}) => {
  const { userSession } = useAuth();
  const [exercises, setExercises] = useState<OfficialDraftExercise[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Parâmetros do gerador
  // Quantidade por tipo de pergunta (0 = não gerar). Total máximo: 20.
  const MAX_TOTAL = 20;
  const [typeCounts, setTypeCounts] = useState<Record<string, number>>({
    multiple_choice: 3,
    true_false: 0,
    open_answer: 0,
    calculation: 0,
  });
  const totalCount: number = (Object.values(typeCounts) as number[]).reduce((a: number, b: number) => a + b, 0);
  const setTypeCount = (typeId: string, value: number) => {
    const others = totalCount - (typeCounts[typeId] || 0);
    const clamped = Math.max(0, Math.min(value, MAX_TOTAL - others));
    setTypeCounts((prev) => ({ ...prev, [typeId]: clamped }));
  };
  const typeOptions = [
    { id: 'multiple_choice', label: 'Escolha múltipla' },
    { id: 'true_false', label: 'Verdadeiro / Falso' },
    { id: 'open_answer', label: 'Resposta aberta' },
    { id: 'calculation', label: 'Cálculo / Resolução' },
  ];
  const [difficulty, setDifficulty] = useState<string>('medio');

  // Estado de edição de exercício
  const [editingExerciseId, setEditingExerciseId] = useState<string | null>(null);
  const [editPrompt, setEditPrompt] = useState<string>('');
  const [editOptions, setEditOptions] = useState<string>('');
  const [editCorrectAnswer, setEditCorrectAnswer] = useState<string>('');
  const [editExplanation, setEditExplanation] = useState<string>('');
  const [isSavingEdit, setIsSavingEdit] = useState<boolean>(false);

  // Carregar exercícios associados a esta nota oficial
  const loadExercises = async () => {
    if (!note || !isSupabaseConfigured()) return;
    setIsLoading(true);
    setError(null);

    try {
      // 1. Obter referências de proveniência para esta nota
      const { data: refs, error: refsErr } = await supabase
        .from('exercise_source_references')
        .select('exercise_id, quote_excerpt, content_hash, official_section')
        .eq('official_note_id', note.id);

      if (refsErr) throw refsErr;

      if (!refs || refs.length === 0) {
        setExercises([]);
        setIsLoading(false);
        return;
      }

      const exerciseIds = refs.map((r: any) => r.exercise_id);

      // 2. Obter exercícios correspondentes
      const { data: exData, error: exErr } = await supabase
        .from('exercises')
        .select('*')
        .in('id', exerciseIds)
        .order('created_at', { ascending: false });

      if (exErr) throw exErr;

      const refMap = new Map(refs.map((r: any) => [r.exercise_id, r]));

      const mapped: OfficialDraftExercise[] = (exData || []).map((ex: any) => {
        const ref = refMap.get(ex.id);
        let parsedOptions: string[] | null = null;
        if (ex.options) {
          try {
            parsedOptions = typeof ex.options === 'string' ? JSON.parse(ex.options) : ex.options;
          } catch {
            parsedOptions = null;
          }
        }

        return {
          id: ex.id,
          prompt: ex.prompt,
          question_type: ex.question_type,
          options: parsedOptions,
          correct_answer: ex.correct_answer,
          scoring_rubric: ex.scoring_rubric,
          max_points: Number(ex.max_points || 20),
          difficulty: ex.difficulty || 'medio',
          status: ex.status,
          is_official: ex.is_official,
          quote_excerpt: ref?.quote_excerpt,
          content_hash: ref?.content_hash,
          official_section: ref?.official_section,
        };
      });

      setExercises(mapped);
    } catch (err: any) {
      console.error('Erro ao carregar exercícios oficiais:', err);
      setError(err?.message || 'Erro ao carregar exercícios desta nota.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && note) {
      loadExercises();
    }
  }, [isOpen, note?.id]);

  if (!isOpen || !note) return null;

  // Iniciar geração via Netlify Function / API
  const handleGenerate = async () => {
    setIsGenerating(true);
    setError(null);
    setSuccessMessage(null);

    try {
      let token = userSession?.token;
      if (!token && isSupabaseConfigured()) {
        const { data: s } = await supabase.auth.getSession();
        token = s?.session?.access_token;
      }
      if (!token) {
        token = userSession?.id || 'mock-admin-token';
      }

      const res = await fetch('/api/generate-exercises', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          note_id: note.id,
          version_id: note.current_version_id,
          type_counts: typeCounts,
          difficulty,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || `Erro de geração: status ${res.status}`);
      }

      if (data.code === 'INSUFFICIENT_NOTES_CONTENT') {
        setError(data.message || 'O apontamento oficial não contém matéria textual suficiente para formular questões.');
      } else {
        setSuccessMessage(data.message || `${data.exercises?.length || totalCount} exercícios gerados com sucesso em rascunho.`);
        await loadExercises();
        if (onExercisesUpdated) onExercisesUpdated();
      }
    } catch (err: any) {
      console.error('Falha na geração de exercícios oficiais:', err);
      setError(err?.message || 'Falha ao comunicar com o gerador Gemini.');
    } finally {
      setIsGenerating(false);
    }
  };

  // Iniciar edição de um rascunho
  const startEditing = (ex: OfficialDraftExercise) => {
    setEditingExerciseId(ex.id);
    setEditPrompt(ex.prompt);
    setEditOptions(ex.options ? ex.options.join('\n') : '');
    setEditCorrectAnswer(ex.correct_answer);
    setEditExplanation(ex.scoring_rubric?.explanation || '');
  };

  // Gravar edições do administrador
  const saveEditing = async (exerciseId: string) => {
    setIsSavingEdit(true);
    setError(null);

    try {
      const optionsArray = editOptions
        .split('\n')
        .map((o) => o.trim())
        .filter((o) => o.length > 0);

      const updatedPayload: any = {
        prompt: editPrompt.trim(),
        correct_answer: editCorrectAnswer.trim(),
        options: optionsArray.length > 0 ? JSON.stringify(optionsArray) : null,
      };

      if (editExplanation.trim()) {
        updatedPayload.scoring_rubric = {
          criteria: ['Demonstra compreensão estrita da matéria descrita no apontamento oficial.'],
          explanation: editExplanation.trim(),
        };
      }

      const { error: updErr } = await supabase
        .from('exercises')
        .update(updatedPayload)
        .eq('id', exerciseId);

      if (updErr) throw updErr;

      setSuccessMessage('Exercício atualizado e gravado com sucesso.');
      setEditingExerciseId(null);
      await loadExercises();
    } catch (err: any) {
      setError(err?.message || 'Erro ao gravar alterações no exercício.');
    } finally {
      setIsSavingEdit(false);
    }
  };

  // Alternar estado de publicação (Draft <-> Published)
  const togglePublishStatus = async (ex: OfficialDraftExercise) => {
    const nextStatus = ex.status === 'published' ? 'draft' : 'published';
    try {
      const { error: statusErr } = await supabase
        .from('exercises')
        .update({ status: nextStatus })
        .eq('id', ex.id);

      if (statusErr) throw statusErr;

      setSuccessMessage(
        nextStatus === 'published'
          ? 'Exercício homologado e publicado! Já se encontra acessível aos alunos.'
          : 'Exercício revertido para rascunho (oculto dos alunos).'
      );
      await loadExercises();
      if (onExercisesUpdated) onExercisesUpdated();
    } catch (err: any) {
      setError(err?.message || 'Erro ao alterar estado de publicação.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Cabeçalho */}
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-400/20 text-amber-400 flex items-center justify-center border border-amber-400/30">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-white">
                  Motor de Exercícios Oficiais Grounded com Gemini
                </h2>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-amber-400/20 text-amber-300 border border-amber-400/30">
                  Fase C
                </span>
              </div>
              <p className="text-xs text-slate-300">
                {note.title} · {note.theme} · v{note.current_version?.version_number || 1}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Notificações */}
        {error && (
          <div className="mx-6 mt-4 p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
              <span>{error}</span>
            </div>
            <button onClick={() => setError(null)} className="text-red-600 font-bold hover:underline">
              Fechar
            </button>
          </div>
        )}

        {successMessage && (
          <div className="mx-6 mt-4 p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{successMessage}</span>
            </div>
            <button onClick={() => setSuccessMessage(null)} className="text-emerald-600 font-bold hover:underline">
              Fechar
            </button>
          </div>
        )}

        {/* Conteúdo Principal */}
        <div className="p-6 overflow-y-auto flex-1 space-y-6">
          {/* Caixa de Princípio Sagrado e Informação Curricular */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
                <span className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                  Princípio Sagrado da Turma C
                </span>
              </div>
              <p className="text-xs text-slate-600 mt-1">
                «SEMPRE COM BASE NOS APONTAMENTOS OFICIAIS!!!» Toda e qualquer questão é grounded estritamente no texto oficial da versão homologada ativa.
              </p>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span className="text-slate-500">Estado da Nota:</span>
              <span
                className={`px-2 py-0.5 rounded font-bold ${
                  note.is_published
                    ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                    : 'bg-amber-100 text-amber-800 border border-amber-200'
                }`}
              >
                {note.is_published ? 'Publicada' : 'Rascunho'}
              </span>
            </div>
          </div>

          {/* Painel do Gerador Gemini */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-xs">
            <div className="flex items-center gap-2 mb-3">
              <Sliders className="w-4 h-4 text-slate-700" />
              <h3 className="text-sm font-bold text-slate-900">
                Parâmetros de Geração Curricular (Gemini API)
              </h3>
            </div>

            {/* Quantidade por tipo de pergunta */}
            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-semibold text-slate-700">
                  Quantas perguntas de cada tipo?
                </label>
                <span
                  className={`text-xs font-bold font-mono px-2 py-0.5 rounded ${
                    totalCount === 0
                      ? 'bg-rose-50 text-rose-700'
                      : totalCount >= MAX_TOTAL
                      ? 'bg-amber-50 text-amber-800'
                      : 'bg-slate-100 text-slate-700'
                  }`}
                >
                  Total: {totalCount} / {MAX_TOTAL}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {typeOptions.map((t) => {
                  const value = typeCounts[t.id] || 0;
                  const maxForThis = value + (MAX_TOTAL - totalCount);
                  return (
                    <div
                      key={t.id}
                      className={`p-3 rounded-xl border transition-all ${
                        value > 0 ? 'border-slate-900 bg-slate-50' : 'border-slate-200 bg-white'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-bold text-slate-800">{t.label}</span>
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
                        max={MAX_TOTAL}
                        value={value}
                        disabled={isGenerating}
                        onChange={(e) => setTypeCount(t.id, Math.min(parseInt(e.target.value, 10), maxForThis))}
                        className="w-full accent-slate-900 cursor-pointer"
                        aria-label={`Número de perguntas: ${t.label}`}
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
            </div>

            {/* Dificuldade */}
            <div className="mb-4">
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Nível de Dificuldade
              </label>
              <select
                value={difficulty}
                onChange={(e) => setDifficulty(e.target.value)}
                disabled={isGenerating}
                className="w-full text-xs rounded-lg border border-slate-300 p-2 focus:ring-2 focus:ring-slate-900 focus:outline-hidden"
              >
                <option value="medio">Média</option>
                <option value="facil">Fácil</option>
                <option value="dificil">Difícil</option>
                <option value="mixed">Mista</option>
              </select>
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-slate-100">
              <span className="text-[11px] text-slate-500">
                Os novos exercícios serão gerados em <strong>Rascunho</strong> e aguardarão a sua revisão humana antes de ficarem visíveis aos alunos.
              </span>
              <button
                onClick={handleGenerate}
                disabled={isGenerating || !note.is_published || totalCount < 1}
                className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-xl text-xs font-bold hover:bg-slate-800 disabled:opacity-50 transition-colors shadow-xs"
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-amber-400" />
                    <span>A formular no Gemini...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 text-amber-400" />
                    <span>Gerar Exercícios Oficiais</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Lista de Exercícios Grounded Registados para Revisão */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <span>Exercícios Oficiais Vinculados ({exercises.length})</span>
                {isLoading && <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-400" />}
              </h3>
              <span className="text-xs text-slate-500">
                {exercises.filter((e) => e.status === 'published').length} publicados ·{' '}
                {exercises.filter((e) => e.status === 'draft').length} em rascunho
              </span>
            </div>

            {exercises.length === 0 && !isLoading && (
              <div className="p-8 text-center border-2 border-dashed border-slate-200 rounded-2xl bg-slate-50 text-slate-500 text-xs">
                <FileText className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                <p className="font-semibold text-slate-700">Ainda não existem exercícios gerados para esta nota oficial.</p>
                <p className="text-slate-400 mt-1">
                  Clique no botão &quot;Gerar Exercícios Oficiais&quot; acima para formular o primeiro lote grounded no Gemini.
                </p>
              </div>
            )}

            {exercises.map((ex, idx) => {
              const isEditing = editingExerciseId === ex.id;

              return (
                <div
                  key={ex.id}
                  className={`border rounded-xl p-4 transition-all ${
                    ex.status === 'published'
                      ? 'border-emerald-200 bg-emerald-50/20'
                      : 'border-slate-200 bg-white'
                  }`}
                >
                  {/* Cabeçalho do Exercício */}
                  <div className="flex items-start justify-between gap-4 mb-3">
                    <div className="flex items-center gap-2">
                      <span className="w-6 h-6 rounded-full bg-slate-900 text-white text-xs font-bold flex items-center justify-center">
                        {idx + 1}
                      </span>
                      <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                        {ex.question_type.replace('_', ' ')}
                      </span>
                      <span className="text-slate-300">·</span>
                      <span className="text-xs text-slate-500 capitalize">{ex.difficulty}</span>
                      <span className="text-slate-300">·</span>
                      <span className="text-xs text-slate-500">{ex.max_points} pts</span>
                    </div>

                    <div className="flex items-center gap-2">
                      <span
                        className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                          ex.status === 'published'
                            ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                            : 'bg-amber-100 text-amber-800 border border-amber-200'
                        }`}
                      >
                        {ex.status === 'published' ? 'Publicado (Alunos Podem Treinar)' : 'Rascunho (Oculto)'}
                      </span>
                    </div>
                  </div>

                  {/* Citação Literal Grounded */}
                  {ex.quote_excerpt && (
                    <div className="mb-3 p-2.5 rounded-lg bg-amber-50/70 border border-amber-200 text-xs text-amber-900 flex items-start gap-2">
                      <Quote className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                      <div className="leading-relaxed">
                        <span className="font-bold">Excerto Literal Comprovativo dos Apontamentos:</span>{' '}
                        <span className="italic font-mono text-[11px]">&quot;{ex.quote_excerpt}&quot;</span>
                      </div>
                    </div>
                  )}

                  {/* Modo de Edição vs Visualização */}
                  {isEditing ? (
                    <div className="space-y-3 pt-2">
                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          Enunciado
                        </label>
                        <textarea
                          value={editPrompt}
                          onChange={(e) => setEditPrompt(e.target.value)}
                          rows={3}
                          className="w-full text-xs p-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-slate-900 focus:outline-hidden"
                        />
                      </div>

                      {ex.question_type === 'multiple_choice' && (
                        <div>
                          <label className="block text-xs font-semibold text-slate-700 mb-1">
                            Opções (uma por linha)
                          </label>
                          <textarea
                            value={editOptions}
                            onChange={(e) => setEditOptions(e.target.value)}
                            rows={4}
                            className="w-full text-xs p-2 font-mono rounded-lg border border-slate-300 focus:ring-2 focus:ring-slate-900 focus:outline-hidden"
                          />
                        </div>
                      )}

                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          Resposta Correta / Solução Oficial
                        </label>
                        <input
                          type="text"
                          value={editCorrectAnswer}
                          onChange={(e) => setEditCorrectAnswer(e.target.value)}
                          className="w-full text-xs p-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-slate-900 focus:outline-hidden"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-slate-700 mb-1">
                          Critérios / Explicação da Solução
                        </label>
                        <textarea
                          value={editExplanation}
                          onChange={(e) => setEditExplanation(e.target.value)}
                          rows={2}
                          className="w-full text-xs p-2 rounded-lg border border-slate-300 focus:ring-2 focus:ring-slate-900 focus:outline-hidden"
                        />
                      </div>

                      <div className="flex items-center justify-end gap-2 pt-2">
                        <button
                          onClick={() => setEditingExerciseId(null)}
                          className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-100"
                        >
                          Cancelar
                        </button>
                        <button
                          onClick={() => saveEditing(ex.id)}
                          disabled={isSavingEdit}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-bold hover:bg-slate-800"
                        >
                          {isSavingEdit ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Save className="w-3.5 h-3.5" />
                          )}
                          <span>Guardar Alterações</span>
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <p className="text-xs font-semibold text-slate-900 leading-relaxed">
                        {ex.prompt}
                      </p>

                      {/* Opções */}
                      {ex.options && ex.options.length > 0 && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                          {ex.options.map((opt, oIdx) => (
                            <div
                              key={oIdx}
                              className={`p-2 rounded-lg border text-xs flex items-center justify-between ${
                                opt.trim() === ex.correct_answer.trim()
                                  ? 'bg-emerald-50 border-emerald-300 font-bold text-emerald-900'
                                  : 'bg-slate-50 border-slate-200 text-slate-700'
                              }`}
                            >
                              <span>{opt}</span>
                              {opt.trim() === ex.correct_answer.trim() && (
                                <span className="text-[10px] text-emerald-700 uppercase font-black tracking-wider">
                                  Correta
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Solução não-múltipla */}
                      {(!ex.options || ex.options.length === 0) && (
                        <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-xs">
                          <span className="font-bold text-slate-700">Resposta Oficial:</span>{' '}
                          <span className="text-slate-900 font-mono">{ex.correct_answer}</span>
                        </div>
                      )}

                      {/* Critérios */}
                      {ex.scoring_rubric?.explanation && (
                        <div className="text-[11px] text-slate-500 bg-slate-50/50 p-2 rounded-lg border border-slate-100">
                          <span className="font-bold text-slate-600">Explicação Oficial:</span>{' '}
                          {ex.scoring_rubric.explanation}
                        </div>
                      )}

                      {/* Botões de Ação do Administrador */}
                      <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                        <button
                          onClick={() => startEditing(ex)}
                          className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-100 transition-colors"
                        >
                          Rever e Editar
                        </button>

                        <button
                          onClick={() => togglePublishStatus(ex)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors shadow-xs ${
                            ex.status === 'published'
                              ? 'bg-amber-50 text-amber-800 border border-amber-200 hover:bg-amber-100'
                              : 'bg-emerald-600 text-white hover:bg-emerald-700'
                          }`}
                        >
                          {ex.status === 'published' ? 'Despublicar' : 'Homologar e Publicar'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Rodapé */}
        <div className="px-6 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between text-xs text-slate-500">
          <span>
            Turma C · Os alunos só têm acesso a exercícios marcados como <strong>Publicados</strong>.
          </span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-slate-900 text-white text-xs font-bold hover:bg-slate-800"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
};
