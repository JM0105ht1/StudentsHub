import React from 'react';
import { useAuth } from '../../services/authContext';
import { OFFICIAL_SUBJECTS } from '../../data/subjects';
import { SubjectId } from '../../types';
import {
  BookOpen,
  CheckCircle2,
  Layers,
  Trophy,
  Flame,
  ArrowRight,
  Clock,
  ChevronRight,
  Info,
} from 'lucide-react';

interface DashboardHomeProps {
  onSelectSubject: (id: SubjectId) => void;
  onNavigateTab: (tab: any) => void;
}

export const DashboardHome: React.FC<DashboardHomeProps> = ({
  onSelectSubject,
  onNavigateTab,
}) => {
  const { userSession } = useAuth();
  const firstName = userSession?.profile.full_name.split(' ')[0] || 'Aluno';
  const streakDays = userSession?.stats.streak_days || 0;
  const exercisesSolved = userSession?.stats.exercises_solved || 0;
  const isAdmin = userSession?.role === 'admin';

  return (
    <div className="space-y-8 max-w-6xl mx-auto py-2">
      {/* 1. Boas-Vindas Académicas Oficiais */}
      <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
              {userSession?.profile.school_year || 'Ensino Secundário'}
            </span>
            <span className="text-slate-300">·</span>
            <span className="text-xs font-medium text-slate-500">Students Hub</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">
            Olá, {firstName} 👋
          </h1>
          <p className="text-sm font-medium text-slate-600 max-w-xl">
            O que vais estudar hoje? Lembra-te: tudo começa nos apontamentos. Rumo ao 20.
          </p>
        </div>

        {/* Indicador de Sequência de Estudo */}
        <div className="flex items-center gap-3.5 bg-amber-50 border border-amber-200/80 p-4 rounded-2xl shrink-0">
          <div className="w-12 h-12 rounded-xl bg-amber-500/20 text-amber-600 flex items-center justify-center">
            <Flame className="w-7 h-7 fill-amber-500 text-amber-600" />
          </div>
          <div>
            <div className="text-[11px] font-bold text-amber-900 uppercase tracking-wider">
              Sequência de Estudo
            </div>
            <div className="text-2xl font-black text-amber-950 font-mono">
              {streakDays} dias
            </div>
            <div className="text-[11px] text-amber-700 font-medium">
              Consistência diária de estudo
            </div>
          </div>
        </div>
      </div>

      {/* 2. Atalhos dos Módulos Principais */}
      <div className={`grid grid-cols-1 sm:grid-cols-2 ${isAdmin ? 'lg:grid-cols-4' : 'lg:grid-cols-3'} gap-4`}>
        {/* Apontamentos */}
        <button
          onClick={() => onNavigateTab('notes')}
          className="p-5 rounded-2xl bg-white border border-slate-200 shadow-xs hover:border-slate-400 hover:shadow-sm transition-all text-left group flex flex-col justify-between"
        >
          <div>
            <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-900 flex items-center justify-center mb-3 group-hover:scale-105 transition-transform">
              <BookOpen className="w-5 h-5" />
            </div>
            <h3 className="text-sm font-bold text-slate-900">Apontamentos</h3>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed">
              Os apontamentos de todas as disciplinas, sempre à mão.
            </p>
          </div>
          <div className="pt-4 text-xs font-bold text-slate-900 flex items-center gap-1 group-hover:translate-x-1 transition-transform">
            <span>Aceder aos Apontamentos</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </div>
        </button>

        {/* Criar Exercícios — visível apenas para administradores */}
        {isAdmin && (
          <button
            onClick={() => onNavigateTab('admin-notes')}
            className="p-5 rounded-2xl bg-white border border-amber-200 shadow-xs hover:border-amber-400 hover:shadow-sm transition-all text-left group flex flex-col justify-between"
          >
            <div>
              <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-700 flex items-center justify-center mb-3 group-hover:scale-105 transition-transform">
                <CheckCircle2 className="w-5 h-5" />
              </div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-slate-900">Criar Exercícios</h3>
                <span className="text-[10px] font-bold text-amber-700 uppercase">Admin</span>
              </div>
              <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                Gera, revê e publica exercícios com base nos apontamentos.
              </p>
            </div>
            <div className="pt-4 text-xs font-bold text-slate-900 flex items-center gap-1 group-hover:translate-x-1 transition-transform">
              <span>Abrir Administração</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </div>
          </button>
        )}

        {/* Modo Exame */}
        <button
          onClick={() => onNavigateTab('exam')}
          className="p-5 rounded-2xl bg-white border border-slate-200 shadow-xs hover:border-slate-400 hover:shadow-sm transition-all text-left group flex flex-col justify-between"
        >
          <div>
            <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-900 flex items-center justify-center mb-3 group-hover:scale-105 transition-transform">
              <Layers className="w-5 h-5" />
            </div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-slate-900">Modo Exame</h3>
              <span className="text-[10px] font-bold text-slate-400 uppercase">Fase 5</span>
            </div>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed">
              Junta todos os testes da disciplina num teste global cronometrado.
            </p>
          </div>
          <div className="pt-4 text-xs font-bold text-slate-900 flex items-center gap-1 group-hover:translate-x-1 transition-transform">
            <span>Ver Configuração</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </div>
        </button>

        {/* Leaderboard */}
        <button
          onClick={() => onNavigateTab('leaderboard')}
          className="p-5 rounded-2xl bg-white border border-slate-200 shadow-xs hover:border-slate-400 hover:shadow-sm transition-all text-left group flex flex-col justify-between"
        >
          <div>
            <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-700 flex items-center justify-center mb-3 group-hover:scale-105 transition-transform">
              <Trophy className="w-5 h-5" />
            </div>
            <h3 className="text-sm font-bold text-slate-900">Leaderboard</h3>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed">
              Quadro de honra de consistência e exercícios resolvidos.
            </p>
          </div>
          <div className="pt-4 text-xs font-bold text-slate-900 flex items-center gap-1 group-hover:translate-x-1 transition-transform">
            <span>Ver Classificação</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </div>
        </button>
      </div>

      {/* 3. Resumo de Progresso por Disciplina */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-900">Progresso por Disciplina</h2>
            <p className="text-xs text-slate-500">
              As 6 disciplinas oficiais do Ensino Secundário em Portugal.
            </p>
          </div>
          <button
            onClick={() => onNavigateTab('subjects')}
            className="text-xs font-bold text-slate-900 hover:underline flex items-center gap-1"
          >
            <span>Ver catálogo completo</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {OFFICIAL_SUBJECTS.map((subj) => (
            <div
              key={subj.id}
              onClick={() => {
                onSelectSubject(subj.id);
                onNavigateTab('notes');
              }}
              className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs hover:border-slate-300 hover:shadow-sm transition-all cursor-pointer flex flex-col justify-between group"
            >
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span
                    className={`px-2.5 py-0.5 rounded text-[11px] font-bold border ${subj.color_badge}`}
                  >
                    {subj.code}
                  </span>
                  <span className="text-[11px] text-slate-400 font-medium">
                    {subj.grade_level}
                  </span>
                </div>
                <h3 className="text-base font-bold text-slate-900 group-hover:text-blue-900 transition-colors">
                  {subj.name}
                </h3>
                <p className="text-xs text-slate-500 line-clamp-2 leading-relaxed">
                  {subj.description}
                </p>
              </div>

              <div className="pt-4 mt-4 border-t border-slate-100 flex items-center justify-between text-xs font-bold text-slate-900 group-hover:text-blue-900 transition-colors">
                <span>Abrir Apontamentos</span>
                <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
