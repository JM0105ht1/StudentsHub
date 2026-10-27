import { NoteHtmlFrame } from './NoteHtmlFrame';
import React, { useState, useEffect } from 'react';
import { SubjectId } from '../../types';
import { OFFICIAL_SUBJECTS } from '../../data/subjects';
import { AcademicPeriod } from '../../lib/htmlSanitizer';
import { useAuth } from '../../services/authContext';
import {
  getPublishedOfficialNotes,
  OfficialNote,
} from '../../services/officialNotesService';
import {
  BookOpen,
  Calendar,
  CheckCircle2,
  FileText,
  Filter,
  Sparkles,
  ArrowRight,
  ShieldCheck,
  Search,
  Eye,
  EyeOff,
} from 'lucide-react';

interface OfficialNotesReaderProps {
  initialSubjectId?: SubjectId;
  onNavigateToExercises?: (subjectId: SubjectId, noteId?: string) => void;
}

export const OfficialNotesReader: React.FC<OfficialNotesReaderProps> = ({
  initialSubjectId = 'matematica-a',
  onNavigateToExercises,
}) => {
  const [selectedSubjectId, setSelectedSubjectId] = useState<SubjectId>(initialSubjectId);
  const [selectedPeriod, setSelectedPeriod] = useState<AcademicPeriod | 'ALL'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [notes, setNotes] = useState<OfficialNote[]>([]);
  const [selectedNote, setSelectedNote] = useState<OfficialNote | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Apontamentos que ESTE aluno escondeu do seu ecrã (não afeta mais ninguém)
  const { userSession } = useAuth();
  const hiddenStorageKey = `students-hub:apontamentos-ocultos:${userSession?.id || 'visitante'}`;
  const [hiddenIds, setHiddenIds] = useState<string[]>([]);
  const [showHidden, setShowHidden] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(hiddenStorageKey);
      const parsed = raw ? JSON.parse(raw) : [];
      setHiddenIds(Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : []);
    } catch {
      setHiddenIds([]);
    }
    setShowHidden(false);
  }, [hiddenStorageKey]);

  const saveHiddenIds = (ids: string[]) => {
    setHiddenIds(ids);
    try {
      localStorage.setItem(hiddenStorageKey, JSON.stringify(ids));
    } catch {
      // armazenamento indisponível: a escolha vale só até recarregar a página
    }
  };

  const hideNote = (noteId: string) => {
    const next = hiddenIds.includes(noteId) ? hiddenIds : [...hiddenIds, noteId];
    saveHiddenIds(next);
    if (selectedNote?.id === noteId && !showHidden) {
      const nextVisible = notes.find((n) => n.id !== noteId && !next.includes(n.id));
      setSelectedNote(nextVisible || null);
    }
  };

  const unhideNote = (noteId: string) => {
    saveHiddenIds(hiddenIds.filter((id) => id !== noteId));
  };

  const currentSubject =
    OFFICIAL_SUBJECTS.find((s) => s.id === selectedSubjectId) || OFFICIAL_SUBJECTS[0];

  // Carregar apontamentos oficiais publicados
  useEffect(() => {
    let isMounted = true;
    async function loadNotes() {
      setIsLoading(true);
      setError(null);
      const res = await getPublishedOfficialNotes(
        selectedSubjectId,
        selectedPeriod === 'ALL' ? undefined : selectedPeriod
      );
      if (isMounted) {
        if (res.error) {
          setError(res.error);
        }
        setNotes(res.notes);
        // Selecionar o primeiro apontamento por defeito se nenhum estiver selecionado
        if (res.notes.length > 0) {
          setSelectedNote(res.notes[0]);
        } else {
          setSelectedNote(null);
        }
        setIsLoading(false);
      }
    }
    loadNotes();
    return () => {
      isMounted = false;
    };
  }, [selectedSubjectId, selectedPeriod]);

  // Filtragem local por texto
  const hiddenCount = notes.filter((n) => hiddenIds.includes(n.id)).length;

  const filteredNotes = notes.filter((n) => {
    if (!showHidden && hiddenIds.includes(n.id)) return false;
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      n.title.toLowerCase().includes(q) ||
      n.theme.toLowerCase().includes(q) ||
      (n.current_version?.plain_text_content?.toLowerCase().includes(q) ?? false)
    );
  });

  // Se o apontamento aberto for um dos ocultos, passa para o primeiro visível
  useEffect(() => {
    if (!showHidden && selectedNote && hiddenIds.includes(selectedNote.id)) {
      setSelectedNote(notes.find((n) => !hiddenIds.includes(n.id)) || null);
    }
  }, [hiddenIds, showHidden, selectedNote, notes]);

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* 1. Cabeçalho Académico da Turma C */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded text-[11px] font-bold bg-slate-900 text-white uppercase tracking-wider">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                Turma C · Apontamentos
              </span>
              <span className="text-xs text-slate-400 font-mono">
                Homologado pela Comunidade
              </span>
            </div>
            <h1 className="text-2xl font-black text-slate-900 tracking-tight">
              Apontamentos Oficiais de Estudo
            </h1>
            <p className="text-xs text-slate-600 mt-1 max-w-3xl leading-relaxed">
              «Apontamentos que ajudam, exercícios que resultam. Rumo ao 20.» — Conteúdos curriculares oficiais publicados e versionados, base estrita e sagrada para todas as avaliações da turma.
            </p>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <span className="px-3 py-1.5 rounded-xl bg-slate-100 border border-slate-200 text-slate-700 font-medium">
              Princípio Sagrado:
              <strong className="ml-1 text-slate-900">SEMPRE COM BASE NOS APONTAMENTOS OFICIAIS</strong>
            </span>
          </div>
        </div>

        {/* 2. Seleção de Disciplina (6 Disciplinas Oficiais) */}
        <div className="flex items-center gap-2 overflow-x-auto pt-5 mt-5 border-t border-slate-100 pb-1 scrollbar-none">
          {OFFICIAL_SUBJECTS.map((subj) => {
            const isSelected = subj.id === selectedSubjectId;
            return (
              <button
                key={subj.id}
                onClick={() => {
                  setSelectedSubjectId(subj.id);
                  setSearchQuery('');
                }}
                className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap shrink-0 border ${
                  isSelected
                    ? 'bg-slate-900 text-white border-slate-900 shadow-xs'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                }`}
              >
                <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${
                  isSelected ? 'border-white/20 bg-white/10 text-white' : subj.color_badge
                }`}>
                  {subj.code}
                </span>
                <span>{subj.name}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 3. Filtros por Período e Pesquisa */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-white p-3 rounded-2xl border border-slate-200 shadow-xs">
        {/* Filtro de Períodos Letivos */}
        <div className="flex items-center gap-1.5 w-full sm:w-auto">
          <span className="text-xs font-semibold text-slate-400 flex items-center gap-1 mr-1">
            <Filter className="w-3.5 h-3.5" />
            Período:
          </span>
          {(['ALL', 'P1', 'P2', 'P3'] as const).map((p) => {
            const label = p === 'ALL' ? 'Todos' : p === 'P1' ? '1.º Período' : p === 'P2' ? '2.º Período' : '3.º Período';
            const isActive = selectedPeriod === p;
            return (
              <button
                key={p}
                onClick={() => setSelectedPeriod(p)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                  isActive
                    ? 'bg-slate-900 text-white'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>

        {/* Campo de Pesquisa Textual */}
        <div className="relative w-full sm:w-72">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Pesquisar conceitos ou temas..."
            className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-slate-900/10 focus:border-slate-400"
          />
        </div>
      </div>

      {/* 4. Layout Principal: Lista de Apontamentos + Leitor Editorial */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Painel Esquerdo: Lista de Apontamentos da Disciplina */}
        <div className="lg:col-span-4 space-y-3">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Apontamentos Publicados ({filteredNotes.length})
            </h2>
            <span className="text-[11px] font-mono text-slate-400">
              {currentSubject.code}
            </span>
          </div>

          {hiddenCount > 0 && (
            <button
              type="button"
              onClick={() => setShowHidden((v) => !v)}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white text-[11px] font-bold text-slate-600 hover:bg-slate-50 transition-colors"
            >
              {showHidden ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              {showHidden ? 'Esconder os ocultos' : `Ver ocultos (${hiddenCount})`}
            </button>
          )}

          {isLoading ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-xs text-slate-400">
              A carregar apontamentos oficiais homologados...
            </div>
          ) : filteredNotes.length === 0 ? (
            <div className="bg-white rounded-2xl border border-dashed border-slate-200 p-8 text-center space-y-2">
              <FileText className="w-8 h-8 text-slate-300 mx-auto" />
              <p className="text-xs font-semibold text-slate-700">
                Nenhum apontamento oficial encontrado
              </p>
              <p className="text-[11px] text-slate-400">
                {searchQuery
                  ? 'Tenta ajustar a pesquisa textual ou o período letivo.'
                  : notes.length > 0 && hiddenCount > 0
                  ? 'Ocultaste todos os apontamentos desta disciplina. Toca em «Ver ocultos» para os voltares a mostrar.'
                  : 'Os apontamentos para esta disciplina serão publicados pelo administrador.'}
              </p>
            </div>
          ) : (
            <div className="space-y-2 max-h-[750px] overflow-y-auto pr-1">
              {filteredNotes.map((note) => {
                const isSelected = selectedNote?.id === note.id;
                const isHidden = hiddenIds.includes(note.id);
                const versionNumber = note.current_version?.version_number || 1;

                return (
                  <div
                    key={note.id}
                    onClick={() => setSelectedNote(note)}
                    className={`p-4 rounded-xl border text-left cursor-pointer transition-all ${
                      isHidden ? 'opacity-60 ' : ''
                    }${
                      isSelected
                        ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
                        : 'bg-white text-slate-800 border-slate-200 hover:border-slate-300 hover:shadow-xs'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                          isSelected
                            ? 'bg-white/20 text-white'
                            : 'bg-slate-100 text-slate-700 border border-slate-200'
                        }`}
                      >
                        {note.academic_period} · {note.theme}
                      </span>
                      <span
                        className={`text-[10px] font-mono font-bold ${
                          isSelected ? 'text-emerald-300' : 'text-slate-500'
                        }`}
                      >
                        v{versionNumber}.0
                      </span>
                    </div>

                    <h3 className="text-sm font-bold leading-snug line-clamp-2">
                      {note.title}
                    </h3>

                    <div
                      className={`flex items-center justify-between text-[11px] mt-3 pt-2 border-t ${
                        isSelected ? 'border-white/10 text-slate-300' : 'border-slate-100 text-slate-400'
                      }`}
                    >
                      <span className="flex items-center gap-1 font-mono text-[10px]">
                        <Calendar className="w-3 h-3" />
                        {note.published_at
                          ? new Date(note.published_at).toLocaleDateString('pt-PT')
                          : 'Oficial'}
                      </span>
                      <span className="flex items-center gap-1 font-semibold">
                        Ler apontamento
                        <ArrowRight className="w-3 h-3" />
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (isHidden) {
                          unhideNote(note.id);
                        } else {
                          hideNote(note.id);
                        }
                      }}
                      className={`mt-3 w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[11px] font-bold border transition-colors ${
                        isSelected
                          ? 'border-white/20 text-white hover:bg-white/10'
                          : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {isHidden ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                      {isHidden ? 'Mostrar de novo' : 'Ocultar'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Painel Direito: Leitor Editorial Sanitizado */}
        <div className="lg:col-span-8">
          {selectedNote ? (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
              {/* Cabeçalho do Documento */}
              <div className="p-6 sm:p-8 border-b border-slate-200 bg-slate-50/50">
                <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                  <div className="flex items-center gap-2">
                    <span className="px-2.5 py-1 rounded-md text-xs font-bold bg-slate-900 text-white">
                      {currentSubject.name}
                    </span>
                    <span className="px-2.5 py-1 rounded-md text-xs font-bold bg-white border border-slate-200 text-slate-700">
                      {selectedNote.academic_period} · {selectedNote.theme}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-mono font-bold bg-emerald-50 border border-emerald-200 text-emerald-800">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                      Versão Oficial Homologada v{selectedNote.current_version?.version_number || 1}.0
                    </span>
                  </div>
                </div>

                <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight leading-snug">
                  {selectedNote.title}
                </h1>

                <div className="flex flex-wrap items-center justify-between gap-4 mt-4 pt-4 border-t border-slate-200/80 text-xs text-slate-500">
                  <div className="flex items-center gap-4">
                    <span>
                      Publicado em:{' '}
                      <strong className="text-slate-700 font-mono">
                        {selectedNote.published_at
                          ? new Date(selectedNote.published_at).toLocaleDateString('pt-PT', {
                              day: '2-digit',
                              month: 'long',
                              year: 'numeric',
                            })
                          : 'Data oficial'}
                      </strong>
                    </span>
                    {selectedNote.current_version?.change_summary && (
                      <span className="italic text-slate-400">
                        Nota: {selectedNote.current_version.change_summary}
                      </span>
                    )}
                  </div>

                  {onNavigateToExercises && (
                    <button
                      onClick={() =>
                        onNavigateToExercises(selectedNote.subject_id, selectedNote.id)
                      }
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 text-white rounded-xl text-xs font-bold hover:bg-slate-800 transition-colors shadow-xs"
                    >
                      <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                      Exercícios Deste Apontamento
                    </button>
                  )}
                </div>
              </div>

              {/* Corpo do Apontamento: Renderizado EXCLUSIVAMENTE via sanitized_html */}
              <div className="bg-white">
                <NoteHtmlFrame
                  html={selectedNote.current_version?.sanitized_html || '<p>Sem conteúdo disponível.</p>'}
                  minHeight={300}
                />
              </div>

              {/* Rodapé de Validação e Imutabilidade */}
              <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-600" />
                  <span>Conteúdo oficial estritamente verificado contra adulterações e injeções.</span>
                </div>
                <span className="font-mono text-[10px]">
                  ID: {selectedNote.id.substring(0, 8)}… · Versão Imutável
                </span>
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center space-y-3">
              <BookOpen className="w-10 h-10 text-slate-300 mx-auto" />
              <h3 className="text-sm font-bold text-slate-700">Nenhum apontamento selecionado</h3>
              <p className="text-xs text-slate-400 max-w-sm mx-auto">
                Seleciona um dos apontamentos oficiais da lista ao lado para visualizares o documento curricular homologado.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
