import { NoteHtmlFrame } from '../notes/NoteHtmlFrame';
import React, { useState, useEffect } from 'react';
import { useAuth } from '../../services/authContext';
import { SubjectId } from '../../types';
import { OFFICIAL_SUBJECTS } from '../../data/subjects';
import {
  AcademicPeriod,
  validateAndSanitizeOfficialHtml,
  ALLOWED_SUBJECT_IDS,
  ALLOWED_PERIODS,
  HtmlValidationResult,
  MAX_HTML_SIZE_BYTES,
} from '../../lib/htmlSanitizer';
import {
  getAdminOfficialNotes,
  uploadOfficialNote,
  uploadOfficialNoteVersion,
  publishOfficialNoteVersion,
  unpublishOfficialNote,
  deleteOfficialNote,
  reactivateHistoricalVersion,
  getOfficialNoteAuditLogs,
  OfficialNote,
  OfficialNoteVersion,
  OfficialNoteAuditLog,
} from '../../services/officialNotesService';
import {
  ShieldAlert,
  Trash2,
  ShieldCheck,
  Upload,
  Plus,
  Eye,
  CheckCircle2,
  XCircle,
  History,
  FileCode,
  FileText,
  AlertTriangle,
  RotateCcw,
  Sparkles,
  Lock,
  ArrowRight,
  Filter,
} from 'lucide-react';

import { AdminExerciseReviewModal } from './AdminExerciseReviewModal';

export const AdminNotesManagement: React.FC = () => {
  const { userSession } = useAuth();
  const isAdmin = userSession?.role === 'admin';

  const [notes, setNotes] = useState<OfficialNote[]>([]);
  const [auditLogs, setAuditLogs] = useState<OfficialNoteAuditLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Filtros
  const [filterSubject, setFilterSubject] = useState<SubjectId | 'ALL'>('ALL');
  const [filterPeriod, setFilterPeriod] = useState<AcademicPeriod | 'ALL'>('ALL');
  const [filterStatus, setFilterStatus] = useState<'ALL' | 'published' | 'draft'>('ALL');

  // Modais
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [isNewVersionModalOpen, setIsNewVersionModalOpen] = useState(false);
  const [isPreviewModalOpen, setIsPreviewModalOpen] = useState(false);
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
  const [isAuditModalOpen, setIsAuditModalOpen] = useState(false);
  const [isExerciseModalOpen, setIsExerciseModalOpen] = useState(false);

  // Estados dos formulários de upload
  const [selectedNoteForAction, setSelectedNoteForAction] = useState<OfficialNote | null>(null);
  const [uploadSubjectId, setUploadSubjectId] = useState<SubjectId>('matematica-a');
  const [uploadPeriod, setUploadPeriod] = useState<AcademicPeriod>('P1');
  const [uploadTheme, setUploadTheme] = useState('');
  const [uploadTitle, setUploadTitle] = useState('');
  const [uploadChangeSummary, setUploadChangeSummary] = useState('');
  const [rawHtmlFileContent, setRawHtmlFileContent] = useState<string>('');
  const [fileName, setFileName] = useState<string>('');
  const [validationResult, setValidationResult] = useState<HtmlValidationResult | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Carregar dados
  const loadData = async () => {
    setIsLoading(true);
    setError(null);
    const res = await getAdminOfficialNotes(
      filterSubject === 'ALL' ? undefined : filterSubject
    );
    if (res.error) {
      setError(res.error);
    } else {
      setNotes(res.notes);
    }
    setIsLoading(false);
  };

  useEffect(() => {
    if (isAdmin) {
      loadData();
    }
  }, [isAdmin, filterSubject]);

  // Se não for admin, bloqueia com mensagem categórica
  if (!isAdmin) {
    return (
      <div className="max-w-2xl mx-auto my-12 bg-white rounded-2xl border border-red-200 p-8 shadow-xs text-center space-y-4">
        <div className="w-12 h-12 rounded-2xl bg-red-50 text-red-600 flex items-center justify-center mx-auto">
          <ShieldAlert className="w-6 h-6" />
        </div>
        <h2 className="text-xl font-black text-slate-900">
          Acesso Restrito a Administradores
        </h2>
        <p className="text-xs text-slate-600 leading-relaxed max-w-md mx-auto">
          A gestão, upload, versionamento e publicação de apontamentos oficiais homologados da Turma C é restrita a utilizadores com o papel <code>admin</code> verificado no servidor.
        </p>
        <div className="pt-2">
          <span className="px-3 py-1 rounded text-[11px] font-mono bg-slate-100 text-slate-700">
            Sessão atual: {userSession?.email || 'Desautenticado'} (papel: {userSession?.role || 'nenhum'})
          </span>
        </div>
      </div>
    );
  }

  // Manipulador de upload de ficheiro .html/.htm
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const ext = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();
    if (ext !== '.html' && ext !== '.htm') {
      setError('Apenas ficheiros com extensão .html ou .htm são permitidos.');
      return;
    }

    if (file.size > MAX_HTML_SIZE_BYTES) {
      setError(`O ficheiro excede o limite máximo de 2 MB (tamanho: ${(file.size / 1024 / 1024).toFixed(2)} MB).`);
      return;
    }

    setFileName(file.name);
    setError(null);

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const content = event.target?.result as string;
        setRawHtmlFileContent(content);
        const val = validateAndSanitizeOfficialHtml(content);
        setValidationResult(val);
        if (!val.valid) {
          setError(val.error || 'Ficheiro HTML inválido.');
        }
      } catch (err: any) {
        setValidationResult({ valid: false, error: `Erro ao validar o ficheiro: ${err?.message || 'desconhecido'}` });
        setError(`Erro ao validar o ficheiro: ${err?.message || 'desconhecido'}`);
      }
    };
    reader.readAsText(file, 'utf-8');
  };

  // Submeter Novo Apontamento
  const handleCreateNoteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validationResult || !validationResult.valid || !rawHtmlFileContent) {
      setError('Por favor carrega um ficheiro HTML válido antes de submeter.');
      return;
    }

    if (!uploadTheme.trim() || !uploadTitle.trim()) {
      setError('O tema e o título do apontamento são obrigatórios.');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    const res = await uploadOfficialNote({
      subject_id: uploadSubjectId,
      academic_period: uploadPeriod,
      theme: uploadTheme.trim(),
      title: uploadTitle.trim(),
      raw_html: rawHtmlFileContent,
      change_summary: uploadChangeSummary.trim() || 'Versão inicial homologada.',
    });

    setIsSubmitting(false);

    if (!res.success) {
      setError(res.error || 'Erro ao carregar apontamento.');
    } else {
      setSuccessMessage('Apontamento oficial criado com sucesso no estado de rascunho (v1)!');
      setIsUploadModalOpen(false);
      resetForm();
      loadData();
    }
  };

  // Submeter Nova Versão para Apontamento Existente
  const handleCreateVersionSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedNoteForAction) return;

    if (!validationResult || !validationResult.valid || !rawHtmlFileContent) {
      setError('Por favor carrega um ficheiro HTML válido antes de submeter.');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    const res = await uploadOfficialNoteVersion({
      note_id: selectedNoteForAction.id,
      raw_html: rawHtmlFileContent,
      change_summary: uploadChangeSummary.trim() || 'Nova revisão de apontamento.',
    });

    setIsSubmitting(false);

    if (!res.success) {
      setError(res.error || 'Erro ao criar nova versão.');
    } else {
      setSuccessMessage('Nova versão criada com sucesso em estado de rascunho!');
      setIsNewVersionModalOpen(false);
      resetForm();
      loadData();
    }
  };

  // Publicar Versão Ativa
  const handlePublishVersion = async (versionId: string) => {
    setError(null);
    const res = await publishOfficialNoteVersion(versionId);
    if (!res.success) {
      setError(res.error || 'Erro ao publicar versão.');
    } else {
      setSuccessMessage('Versão de apontamento oficial publicada com sucesso! Agora está visível para a Turma C.');
      loadData();
    }
  };

  // Reativar Versão Histórica Homologada
  const handleReactivateVersion = async (noteId: string, versionId: string, verNum: number) => {
    setError(null);
    const res = await reactivateHistoricalVersion({
      note_id: noteId,
      version_id: versionId,
      reason: `Reativação formal de versão histórica v${verNum}.0 como versão ativa.`,
    });
    if (!res.success) {
      setError(res.error || 'Erro ao reativar versão histórica.');
    } else {
      setSuccessMessage(`Versão histórica v${verNum}.0 reativada com sucesso como versão oficial ativa.`);
      setIsHistoryModalOpen(false);
      loadData();
    }
  };

  // Despublicar Apontamento
  const handleUnpublishNote = async (noteId: string) => {
    if (!window.confirm('Tens a certeza que desejas despublicar este apontamento? Deixará de estar visível para os alunos, mas o histórico permanece preservado.')) {
      return;
    }
    setError(null);
    const res = await unpublishOfficialNote(noteId);
    if (!res.success) {
      setError(res.error || 'Erro ao despublicar apontamento.');
    } else {
      setSuccessMessage('Apontamento oficial despublicado com sucesso.');
      loadData();
    }
  };

  // Apagar Apontamento
  const handleDeleteNote = async (note: OfficialNote) => {
    if (!window.confirm(`Apagar "${note.title}" definitivamente? Todas as versões serão eliminadas e não é possível desfazer.`)) {
      return;
    }
    setError(null);
    const res = await deleteOfficialNote(note.id);
    if (!res.success) {
      setError(res.error || 'Erro ao apagar apontamento.');
    } else {
      setSuccessMessage('Apontamento apagado com sucesso.');
      loadData();
    }
  };

  // Carregar e abrir Auditoria
  const handleOpenAuditLogs = async () => {
    const res = await getOfficialNoteAuditLogs();
    if (res.error) {
      setError(res.error);
    } else {
      setAuditLogs(res.logs);
      setIsAuditModalOpen(true);
    }
  };

  const resetForm = () => {
    setRawHtmlFileContent('');
    setFileName('');
    setValidationResult(null);
    setUploadTheme('');
    setUploadTitle('');
    setUploadChangeSummary('');
  };

  // Estatísticas do painel
  const totalNotes = notes.length;
  const publishedNotes = notes.filter((n) => n.is_published).length;
  const draftNotes = totalNotes - publishedNotes;

  // Filtragem da lista
  const filteredNotes = notes.filter((n) => {
    if (filterPeriod !== 'ALL' && n.academic_period !== filterPeriod) return false;
    if (filterStatus === 'published' && !n.is_published) return false;
    if (filterStatus === 'draft' && n.is_published) return false;
    return true;
  });

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* 1. Banner de Cabeçalho do Administrador */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded text-[11px] font-bold bg-amber-600 text-white uppercase tracking-wider">
              <Lock className="w-3.5 h-3.5" />
              Painel de Administração · Turma C
            </span>
            <span className="text-xs text-slate-400 font-mono">
              Fase B · Apontamentos HTML
            </span>
          </div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">
            Gestão Segura de Apontamentos Oficiais
          </h1>
          <p className="text-xs text-slate-600 mt-1 max-w-2xl leading-relaxed">
            Upload de documentos HTML curriculares, validação server-side com sanitização estrita, versionamento atómico e publicação para a Turma C.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleOpenAuditLogs}
            className="px-3.5 py-2 rounded-xl text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-800 transition-colors flex items-center gap-1.5"
          >
            <History className="w-3.5 h-3.5 text-slate-600" />
            Auditoria
          </button>
          <button
            onClick={() => {
              resetForm();
              setIsUploadModalOpen(true);
            }}
            className="px-4 py-2 rounded-xl text-xs font-bold bg-slate-900 hover:bg-slate-800 text-white transition-colors flex items-center gap-1.5 shadow-xs"
          >
            <Upload className="w-3.5 h-3.5 text-amber-300" />
            Carregar Novo Apontamento
          </button>
        </div>
      </div>

      {/* Alertas de Notificação */}
      {successMessage && (
        <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs font-medium flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{successMessage}</span>
          </div>
          <button onClick={() => setSuccessMessage(null)} className="text-emerald-700 hover:text-emerald-900">
            ×
          </button>
        </div>
      )}

      {error && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-900 text-xs font-medium flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
            <span>{error}</span>
          </div>
          <button onClick={() => setError(null)} className="text-red-700 hover:text-red-900">
            ×
          </button>
        </div>
      )}

      {/* 2. Métricas do Painel de Apontamentos */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs">
          <div className="text-xs font-bold uppercase tracking-wider text-slate-400">
            Total Apontamentos
          </div>
          <div className="text-2xl font-black text-slate-900 mt-1 font-mono">
            {totalNotes}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            Nas 6 disciplinas oficiais da Turma C
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs">
          <div className="text-xs font-bold uppercase tracking-wider text-emerald-600">
            Publicados (Ativos na Turma C)
          </div>
          <div className="text-2xl font-black text-slate-900 mt-1 font-mono">
            {publishedNotes}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            Visíveis e disponíveis para os alunos
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs">
          <div className="text-xs font-bold uppercase tracking-wider text-amber-600">
            Rascunhos (Drafts em Revisão)
          </div>
          <div className="text-2xl font-black text-slate-900 mt-1 font-mono">
            {draftNotes}
          </div>
          <div className="text-[11px] text-slate-500 mt-1">
            Isolados de alunos até aprovação formal
          </div>
        </div>
      </div>

      {/* 3. Filtros */}
      <div className="bg-white p-3 rounded-2xl border border-slate-200 shadow-xs flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex flex-wrap items-center gap-3">
          {/* Disciplina */}
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-slate-500">Disciplina:</span>
            <select
              value={filterSubject}
              onChange={(e) => setFilterSubject(e.target.value as any)}
              className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1 text-slate-800 font-medium focus:outline-none"
            >
              <option value="ALL">Todas as 6 Disciplinas</option>
              {OFFICIAL_SUBJECTS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code} — {s.name}
                </option>
              ))}
            </select>
          </div>

          {/* Período */}
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-slate-500">Período:</span>
            <select
              value={filterPeriod}
              onChange={(e) => setFilterPeriod(e.target.value as any)}
              className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1 text-slate-800 font-medium focus:outline-none"
            >
              <option value="ALL">Todos os Períodos</option>
              <option value="P1">P1 (1.º Período)</option>
              <option value="P2">P2 (2.º Período)</option>
              <option value="P3">P3 (3.º Período)</option>
            </select>
          </div>

          {/* Estado */}
          <div className="flex items-center gap-1.5">
            <span className="font-semibold text-slate-500">Estado:</span>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value as any)}
              className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1 text-slate-800 font-medium focus:outline-none"
            >
              <option value="ALL">Todos os Estados</option>
              <option value="published">Apenas Publicados</option>
              <option value="draft">Apenas Rascunhos</option>
            </select>
          </div>
        </div>

        <button
          onClick={loadData}
          className="text-slate-500 hover:text-slate-800 flex items-center gap-1"
          title="Recarregar"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>Atualizar</span>
        </button>
      </div>

      {/* 4. Tabela de Gestão de Apontamentos */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center text-xs text-slate-400">
            A carregar base de apontamentos oficiais...
          </div>
        ) : filteredNotes.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <FileCode className="w-8 h-8 text-slate-300 mx-auto" />
            <div className="text-xs font-bold text-slate-700">
              Nenhum apontamento corresponde aos filtros selecionados
            </div>
            <p className="text-[11px] text-slate-400 max-w-sm mx-auto">
              Utiliza o botão "Carregar Novo Apontamento" no topo para importar um ficheiro .html homologado.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50/80 border-b border-slate-200 text-slate-500 font-semibold uppercase tracking-wider text-[10px]">
                  <th className="py-3 px-4">Disciplina & Período</th>
                  <th className="py-3 px-4">Tema & Título</th>
                  <th className="py-3 px-4">Versão Ativa</th>
                  <th className="py-3 px-4">Estado</th>
                  <th className="py-3 px-4">Data Publicação</th>
                  <th className="py-3 px-4 text-right">Ações de Gestão</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredNotes.map((note) => {
                  const currentVer = note.current_version;
                  const verNumber = currentVer?.version_number || 1;
                  const totalVers = note.versions?.length || 1;

                  return (
                    <tr key={note.id} className="hover:bg-slate-50/60 transition-colors">
                      {/* Disciplina & Período */}
                      <td className="py-3 px-4 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono font-bold text-[10px] px-1.5 py-0.5 rounded bg-slate-100 border border-slate-200 text-slate-700">
                            {note.subject_id}
                          </span>
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-900 text-white">
                            {note.academic_period}
                          </span>
                        </div>
                      </td>

                      {/* Tema & Título */}
                      <td className="py-3 px-4">
                        <div className="font-bold text-slate-900 max-w-md line-clamp-1">
                          {note.title}
                        </div>
                        <div className="text-[11px] text-slate-500 line-clamp-1">
                          {note.theme}
                        </div>
                      </td>

                      {/* Versão Ativa */}
                      <td className="py-3 px-4 whitespace-nowrap">
                        <div className="flex items-center gap-1">
                          <span className="font-mono font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-800 border border-slate-200 text-[11px]">
                            v{verNumber}.0
                          </span>
                          {totalVers > 1 && (
                            <span className="text-[10px] text-slate-400">
                              ({totalVers} rev.)
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Estado */}
                      <td className="py-3 px-4 whitespace-nowrap">
                        {note.is_published ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
                            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                            Publicado
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
                            <Lock className="w-3 h-3 text-amber-600" />
                            Rascunho
                          </span>
                        )}
                      </td>

                      {/* Data Publicação */}
                      <td className="py-3 px-4 whitespace-nowrap text-slate-500 font-mono text-[11px]">
                        {note.published_at
                          ? new Date(note.published_at).toLocaleDateString('pt-PT')
                          : '—'}
                      </td>

                      {/* Ações */}
                      <td className="py-3 px-4 whitespace-nowrap text-right">
                        <div className="flex items-center justify-end gap-1">
                          {/* Pré-visualizar */}
                          <button
                            onClick={() => {
                              setSelectedNoteForAction(note);
                              setIsPreviewModalOpen(true);
                            }}
                            className="p-1.5 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors"
                            title="Pré-visualizar HTML Sanitizado"
                          >
                            <Eye className="w-4 h-4" />
                          </button>

                          {/* Publicar ou Despublicar */}
                          {note.is_published ? (
                            <button
                              onClick={() => handleUnpublishNote(note.id)}
                              className="px-2 py-1 rounded-lg text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-200 hover:bg-amber-100 transition-colors"
                              title="Retirar visibilidade aos alunos"
                            >
                              Despublicar
                            </button>
                          ) : (
                            <button
                              onClick={() => {
                                if (currentVer) {
                                  handlePublishVersion(currentVer.id);
                                }
                              }}
                              className="px-2.5 py-1 rounded-lg text-[11px] font-bold text-white bg-slate-900 hover:bg-slate-800 transition-colors shadow-xs"
                              title="Publicar na Turma C"
                            >
                              Publicar
                            </button>
                          )}

                          {/* Nova Versão */}
                          <button
                            onClick={() => {
                              setSelectedNoteForAction(note);
                              resetForm();
                              setIsNewVersionModalOpen(true);
                            }}
                            className="p-1.5 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors"
                            title="Carregar Nova Versão (.html)"
                          >
                            <Plus className="w-4 h-4" />
                          </button>

                          {/* Apagar */}
                          <button
                            onClick={() => handleDeleteNote(note)}
                            className="p-1.5 rounded-lg text-red-600 hover:text-red-800 hover:bg-red-50 transition-colors"
                            title="Apagar apontamento"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>

                          {/* Histórico */}
                          <button
                            onClick={() => {
                              setSelectedNoteForAction(note);
                              setIsHistoryModalOpen(true);
                            }}
                            className="p-1.5 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition-colors"
                            title="Ver Histórico de Versões"
                          >
                            <History className="w-4 h-4" />
                          </button>

                          {/* Gerar e Rever Exercícios Grounded (Fase C) */}
                          {note.is_published && (
                            <button
                              onClick={() => {
                                setSelectedNoteForAction(note);
                                setIsExerciseModalOpen(true);
                              }}
                              className="p-1.5 rounded-lg text-amber-600 hover:text-amber-800 hover:bg-amber-50 transition-colors"
                              title="Gerar e Rever Exercícios Oficiais com Gemini (Fase C)"
                            >
                              <Sparkles className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 5. MODAL DE UPLOAD DE NOVO APONTAMENTO */}
      {isUploadModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-2xl w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div>
                <h3 className="text-lg font-black text-slate-900">
                  Carregar Novo Apontamento Oficial (.html / .htm)
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Validação no servidor, sanitização estrita e criação como rascunho.
                </p>
              </div>
              <button
                onClick={() => setIsUploadModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 text-lg"
              >
                ×
              </button>
            </div>

            <form onSubmit={handleCreateNoteSubmit} className="space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Disciplina */}
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    Disciplina Oficial
                  </label>
                  <select
                    value={uploadSubjectId}
                    onChange={(e) => setUploadSubjectId(e.target.value as any)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-900 font-medium focus:bg-white focus:outline-none"
                  >
                    {OFFICIAL_SUBJECTS.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.code} — {s.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Período */}
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    Período Letivo
                  </label>
                  <select
                    value={uploadPeriod}
                    onChange={(e) => setUploadPeriod(e.target.value as any)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-900 font-medium focus:bg-white focus:outline-none"
                  >
                    <option value="P1">P1 (1.º Período)</option>
                    <option value="P2">P2 (2.º Período)</option>
                    <option value="P3">P3 (3.º Período)</option>
                  </select>
                </div>
              </div>

              {/* Tema Curricular */}
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  Tema Curricular Homologado
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Limites e Continuidade, Mecânica dos Fluidos, Teoria da Ação..."
                  value={uploadTheme}
                  onChange={(e) => setUploadTheme(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-900 font-medium focus:bg-white focus:outline-none"
                />
              </div>

              {/* Título */}
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  Título da Aula / Apontamento
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Teorema de Bolzano-Cauchy e Assíntotas ao Gráfico..."
                  value={uploadTitle}
                  onChange={(e) => setUploadTitle(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-900 font-medium focus:bg-white focus:outline-none"
                />
              </div>

              {/* Resumo da Versão */}
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  Resumo de Alterações / Nota Editorial (Opcional)
                </label>
                <input
                  type="text"
                  placeholder="Ex: Versão inicial revista com exemplos e tabelas."
                  value={uploadChangeSummary}
                  onChange={(e) => setUploadChangeSummary(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-900 font-medium focus:bg-white focus:outline-none"
                />
              </div>

              {/* File Input */}
              <div className="border-2 border-dashed border-slate-200 rounded-2xl p-6 text-center space-y-2 hover:border-slate-300 transition-colors bg-slate-50/50">
                <FileCode className="w-8 h-8 text-slate-400 mx-auto" />
                <div className="font-bold text-slate-700">
                  {fileName ? fileName : 'Seleciona o ficheiro .html ou .htm'}
                </div>
                <p className="text-[11px] text-slate-400">
                  Codificação UTF-8 · Limite máximo estrito de 2 MB
                </p>
                <label className="inline-block mt-2 px-3 py-1.5 rounded-xl bg-white border border-slate-300 text-slate-700 font-bold cursor-pointer hover:bg-slate-100 transition-colors shadow-2xs">
                  Procurar Ficheiro HTML
                  <input
                    type="file"
                    accept=".html,.htm"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                </label>
              </div>

              {/* Painel de Diagnóstico da Sanitização em Tempo Real */}
              {validationResult && (
                <div
                  className={`p-4 rounded-xl border text-xs space-y-2 ${
                    validationResult.valid
                      ? 'bg-emerald-50/80 border-emerald-200 text-emerald-950'
                      : 'bg-red-50 border-red-200 text-red-950'
                  }`}
                >
                  <div className="flex items-center gap-2 font-bold">
                    {validationResult.valid ? (
                      <>
                        <ShieldCheck className="w-4 h-4 text-emerald-600" />
                        <span>Ficheiro Validado e Sanitizado com Sucesso</span>
                      </>
                    ) : (
                      <>
                        <AlertTriangle className="w-4 h-4 text-red-600" />
                        <span>Ficheiro Rejeitado</span>
                      </>
                    )}
                  </div>

                  {validationResult.valid ? (
                    <div className="grid grid-cols-2 gap-2 text-[11px] pt-1">
                      <div>
                        Tamanho original: <strong>{validationResult.rawSize} bytes</strong>
                      </div>
                      <div>
                        Tamanho sanitizado: <strong>{validationResult.sanitizedSize} bytes</strong>
                      </div>
                      <div className="col-span-2 text-slate-600">
                        Texto limpo extraído: {validationResult.plainText?.length || 0} caracteres
                        para pesquisa curricular e futura geração de exercícios.
                      </div>
                    </div>
                  ) : (
                    <div className="text-[11px] text-red-700">{validationResult.error}</div>
                  )}
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsUploadModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-slate-600 font-bold hover:bg-slate-100"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={!validationResult?.valid || isSubmitting}
                  className="px-5 py-2 rounded-xl bg-slate-900 text-white font-bold hover:bg-slate-800 disabled:opacity-50 transition-colors"
                >
                  {isSubmitting ? 'A processar e a gravar...' : 'Criar Rascunho Oficial'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 6. MODAL DE UPLOAD DE NOVA VERSÃO */}
      {isNewVersionModalOpen && selectedNoteForAction && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-xl w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div>
                <h3 className="text-lg font-black text-slate-900">
                  Carregar Nova Versão de Apontamento
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Apontamento: <strong>{selectedNoteForAction.title}</strong>
                </p>
              </div>
              <button
                onClick={() => setIsNewVersionModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 text-lg"
              >
                ×
              </button>
            </div>

            <form onSubmit={handleCreateVersionSubmit} className="space-y-4 text-xs">
              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  Resumo das Alterações Desta Revisão
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Correção de gralha na fórmula de cinemática e novo exemplo..."
                  value={uploadChangeSummary}
                  onChange={(e) => setUploadChangeSummary(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-900 font-medium focus:bg-white focus:outline-none"
                />
              </div>

              {/* File Input */}
              <div className="border-2 border-dashed border-slate-200 rounded-2xl p-6 text-center space-y-2 hover:border-slate-300 transition-colors bg-slate-50/50">
                <FileCode className="w-8 h-8 text-slate-400 mx-auto" />
                <div className="font-bold text-slate-700">
                  {fileName ? fileName : 'Seleciona o ficheiro .html da nova versão'}
                </div>
                <label className="inline-block mt-2 px-3 py-1.5 rounded-xl bg-white border border-slate-300 text-slate-700 font-bold cursor-pointer hover:bg-slate-100 transition-colors shadow-2xs">
                  Procurar Ficheiro HTML
                  <input
                    type="file"
                    accept=".html,.htm"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                </label>
              </div>

              {validationResult && (
                <div
                  className={`p-3 rounded-xl border text-xs ${
                    validationResult.valid
                      ? 'bg-emerald-50/80 border-emerald-200 text-emerald-950'
                      : 'bg-red-50 border-red-200 text-red-950'
                  }`}
                >
                  {validationResult.valid ? (
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="w-4 h-4 text-emerald-600" />
                      <span>Ficheiro válido e sanitizado ({validationResult.sanitizedSize} bytes).</span>
                    </div>
                  ) : (
                    <span>{validationResult.error}</span>
                  )}
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsNewVersionModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-slate-600 font-bold hover:bg-slate-100"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={!validationResult?.valid || isSubmitting}
                  className="px-5 py-2 rounded-xl bg-slate-900 text-white font-bold hover:bg-slate-800 disabled:opacity-50 transition-colors"
                >
                  {isSubmitting ? 'A gravar nova versão...' : 'Gravar Nova Versão (Draft)'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 7. MODAL DE PRÉ-VISUALIZAÇÃO DE APONTAMENTO */}
      {isPreviewModalOpen && selectedNoteForAction && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-4xl w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 border text-slate-700">
                  Pré-visualização Segura (Sanitized HTML)
                </span>
                <h3 className="text-lg font-black text-slate-900 mt-1">
                  {selectedNoteForAction.title}
                </h3>
              </div>
              <button
                onClick={() => setIsPreviewModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 text-lg"
              >
                ×
              </button>
            </div>

            <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 text-xs flex items-center justify-between">
              <div>
                Disciplina: <strong>{selectedNoteForAction.subject_id}</strong> · Período:{' '}
                <strong>{selectedNoteForAction.academic_period}</strong> · Tema:{' '}
                <strong>{selectedNoteForAction.theme}</strong>
              </div>
              <div className="font-mono text-emerald-700 font-bold">
                Versão: v{selectedNoteForAction.current_version?.version_number || 1}.0
              </div>
            </div>

            {/* Container sanitizado */}
            <div className="border border-slate-200 rounded-xl bg-white max-h-[450px] overflow-y-auto">
              <NoteHtmlFrame
                html={selectedNoteForAction.current_version?.sanitized_html || '<p>Sem conteúdo.</p>'}
                minHeight={200}
              />
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-slate-100">
              <span className="text-[11px] text-slate-400 font-mono">
                ID: {selectedNoteForAction.id}
              </span>
              <button
                onClick={() => setIsPreviewModalOpen(false)}
                className="px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold hover:bg-slate-800"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 8. MODAL DE HISTÓRICO DE VERSÕES */}
      {isHistoryModalOpen && selectedNoteForAction && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-2xl w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div>
                <h3 className="text-lg font-black text-slate-900">
                  Histórico e Rastreabilidade Documental
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Apontamento: <strong>{selectedNoteForAction.title}</strong>
                </p>
              </div>
              <button
                onClick={() => setIsHistoryModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 text-lg"
              >
                ×
              </button>
            </div>

            <div className="space-y-3">
              {(selectedNoteForAction.versions || [selectedNoteForAction.current_version]).map(
                (v, idx) => {
                  if (!v) return null;
                  const isCurrent = v.id === selectedNoteForAction.current_version_id;

                  return (
                    <div
                      key={v.id || idx}
                      className={`p-4 rounded-xl border text-xs space-y-2 ${
                        isCurrent
                          ? 'border-slate-900 bg-slate-50/70'
                          : 'border-slate-200 bg-white'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold px-2 py-0.5 rounded bg-slate-900 text-white text-[11px]">
                            v{v.version_number}.0
                          </span>
                          {isCurrent && (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                              Versão Ativa Atual
                            </span>
                          )}
                          {v.is_published ? (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                              Publicada
                            </span>
                          ) : (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                              Rascunho
                            </span>
                          )}
                        </div>

                        {!isCurrent && (
                          <button
                            onClick={async () => {
                              if (v.is_published) {
                                await handleReactivateVersion(
                                  selectedNoteForAction.id,
                                  v.id,
                                  v.version_number
                                );
                              } else {
                                await handlePublishVersion(v.id);
                                setIsHistoryModalOpen(false);
                              }
                            }}
                            className="px-2.5 py-1 rounded-lg bg-slate-900 text-white text-[10px] font-bold hover:bg-slate-800"
                          >
                            {v.is_published
                              ? `Reativar Versão v${v.version_number}.0`
                              : `Publicar Versão v${v.version_number}.0`}
                          </button>
                        )}
                      </div>

                      <div className="text-slate-700 italic">
                        "{v.change_summary || 'Sem resumo de alterações.'}"
                      </div>

                      <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono pt-2 border-t border-slate-100">
                        <span>Criada em: {new Date(v.created_at).toLocaleString('pt-PT')}</span>
                        <span>ID: {v.id.substring(0, 8)}…</span>
                      </div>
                    </div>
                  );
                }
              )}
            </div>

            <div className="flex justify-end pt-3 border-t border-slate-100">
              <button
                onClick={() => setIsHistoryModalOpen(false)}
                className="px-4 py-2 rounded-xl bg-slate-100 text-slate-700 text-xs font-bold hover:bg-slate-200"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 9. MODAL DE AUDITORIA */}
      {isAuditModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-3xl w-full p-6 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div>
                <h3 className="text-lg font-black text-slate-900">
                  Registos de Auditoria de Apontamentos
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Log imutável de todas as ações administrativas sobre conteúdos oficiais.
                </p>
              </div>
              <button
                onClick={() => setIsAuditModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 text-lg"
              >
                ×
              </button>
            </div>

            {auditLogs.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-400">
                Nenhum registo de auditoria encontrado.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold uppercase tracking-wider text-[10px]">
                      <th className="py-2.5 px-3">Data & Hora</th>
                      <th className="py-2.5 px-3">Ação</th>
                      <th className="py-2.5 px-3">Detalhes</th>
                      <th className="py-2.5 px-3">Executado Por</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {auditLogs.map((log) => (
                      <tr key={log.id} className="hover:bg-slate-50">
                        <td className="py-2.5 px-3 whitespace-nowrap font-mono text-[11px] text-slate-500">
                          {new Date(log.created_at).toLocaleString('pt-PT')}
                        </td>
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-slate-100 border text-slate-700 font-bold">
                            {log.action}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-slate-700 text-[11px]">
                          {JSON.stringify(log.details)}
                        </td>
                        <td className="py-2.5 px-3 whitespace-nowrap font-mono text-[10px] text-slate-400">
                          {log.performed_by.substring(0, 8)}…
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex justify-end pt-3 border-t border-slate-100">
              <button
                onClick={() => setIsAuditModalOpen(false)}
                className="px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold hover:bg-slate-800"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Geração e Revisão de Exercícios Oficiais (Fase C) */}
      <AdminExerciseReviewModal
        isOpen={isExerciseModalOpen}
        onClose={() => setIsExerciseModalOpen(false)}
        note={selectedNoteForAction}
        onExercisesUpdated={loadData}
      />
    </div>
  );
};
