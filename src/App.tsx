import React, { useState, useEffect } from 'react';
import { useAuth } from './services/authContext';
import { Header } from './components/layout/Header';
import { DashboardHome } from './components/dashboard/DashboardHome';
import { OfficialNotesReader } from './components/notes/OfficialNotesReader';
import { AdminNotesManagement } from './components/admin/AdminNotesManagement';
import { ExerciseGeneratorUI } from './components/exercises/ExerciseGeneratorUI';
import { ExamModeView } from './components/exam/ExamModeView';
import { LeaderboardView } from './components/leaderboard/LeaderboardView';
import { ProfileView } from './components/profile/ProfileView';
import { AuthModal } from './components/auth/AuthModal';
import { OFFICIAL_SUBJECTS } from './data/subjects';
import { SubjectId } from './types';
import { BookOpen, ArrowLeft, ArrowRight, ShieldCheck } from 'lucide-react';

export function App() {
  const { userSession } = useAuth();
  const [activeTab, setActiveTab] = useState<
    'home' | 'subjects' | 'notes' | 'exercises' | 'exam' | 'leaderboard' | 'profile' | 'admin-notes'
  >('home');

  const [selectedSubjectId, setSelectedSubjectId] = useState<SubjectId>('matematica-a');
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const isAdmin = userSession?.role === 'admin';

  // Defesa de interface: se alguém sem permissões ficar na aba de administração
  // (ex.: terminou sessão), volta ao início. A segurança real está no servidor/RLS.
  useEffect(() => {
    if ((activeTab === 'admin-notes' || activeTab === 'exercises') && !isAdmin) setActiveTab('home');
  }, [activeTab, isAdmin]);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col text-slate-900 font-sans selection:bg-slate-200 selection:text-slate-900">
      {/* 1. Header Oficial do Students Hub */}
      <Header
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onOpenAuth={() => setIsAuthModalOpen(true)}
      />

      {/* 2. Área de Conteúdo Principal */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {activeTab === 'home' && (
          <DashboardHome
            onSelectSubject={(subjId) => {
              setSelectedSubjectId(subjId);
              setActiveTab('notes');
            }}
            onNavigateTab={setActiveTab}
          />
        )}

        {/* Apontamentos da Turma C — A Fonte Canónica e Única */}
        {activeTab === 'notes' && (
          <OfficialNotesReader
            initialSubjectId={selectedSubjectId}
            onNavigateToExercises={
              isAdmin
                ? (subjId) => {
                    setSelectedSubjectId(subjId);
                    setActiveTab('exercises');
                  }
                : undefined
            }
          />
        )}

        {/* Catálogo de Disciplinas Oficiais */}
        {activeTab === 'subjects' && (
          <div className="space-y-6 max-w-5xl mx-auto">
            <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs flex items-center justify-between">
              <div>
                <h1 className="text-2xl font-black text-slate-900 tracking-tight">
                  Disciplinas Oficiais
                </h1>
                <p className="text-xs text-slate-500 mt-1">
                  As 6 disciplinas do Ensino Secundário em Portugal com programas curriculares integrados.
                </p>
              </div>
              <button
                onClick={() => setActiveTab('home')}
                className="p-2 rounded-xl text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors"
                title="Voltar ao Início"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {OFFICIAL_SUBJECTS.map((subj) => (
                <div
                  key={subj.id}
                  onClick={() => {
                    setSelectedSubjectId(subj.id);
                    setActiveTab('notes');
                  }}
                  className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs hover:border-slate-300 hover:shadow-sm transition-all cursor-pointer space-y-3 group"
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={`px-2.5 py-0.5 rounded text-xs font-bold border ${subj.color_badge}`}
                    >
                      {subj.code}
                    </span>
                    <span className="text-xs text-slate-400 font-medium">{subj.grade_level}</span>
                  </div>
                  <h3 className="text-lg font-bold text-slate-900 group-hover:text-blue-900 transition-colors">
                    {subj.name}
                  </h3>
                  <p className="text-xs text-slate-600 leading-relaxed">{subj.description}</p>
                  <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs font-bold text-slate-900 group-hover:text-blue-900">
                    <span>Aceder aos apontamentos oficiais</span>
                    <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Área de Criação e Resolução de Exercícios */}
        {activeTab === 'exercises' && isAdmin && (
          <ExerciseGeneratorUI
            initialSubjectId={selectedSubjectId}
            onNavigateTab={setActiveTab}
          />
        )}

        {/* Modo Exame */}
        {activeTab === 'exam' && <ExamModeView onNavigateTab={setActiveTab} />}

        {/* Leaderboard Oficial */}
        {activeTab === 'leaderboard' && <LeaderboardView />}

        {/* Perfil e Privacidade do Aluno */}
        {activeTab === 'profile' && <ProfileView />}

        {/* Administração (apenas admin): apontamentos e exercícios */}
        {activeTab === 'admin-notes' && isAdmin && <AdminNotesManagement />}
      </main>

      {/* 3. Rodapé Oficial */}
      <footer className="border-t border-slate-200 bg-white py-6 mt-12 text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="font-black text-slate-900">Students Hub</span>
            <span className="text-slate-300">·</span>
            <span>Apontamentos que ajudam, exercícios que resultam. Rumo ao 20.</span>
          </div>
          <div className="flex items-center gap-3 text-slate-400 text-[11px]">
            <span>Ensino Secundário em Portugal</span>
            <span>·</span>
            <span>Fase 3: Design, UI e Experiência</span>
          </div>
        </div>
      </footer>

      {/* Modal de Autenticação */}
      <AuthModal isOpen={isAuthModalOpen} onClose={() => setIsAuthModalOpen(false)} />
    </div>
  );
}

export default App;
