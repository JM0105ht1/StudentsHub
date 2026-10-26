import React, { useState } from 'react';
import { useAuth } from '../../services/authContext';
import { OFFICIAL_SUBJECTS } from '../../data/subjects';
import {
  User,
  Flame,
  CheckCircle2,
  Trophy,
  GraduationCap,
  Shield,
  Settings,
  Mail,
  Calendar,
  Lock,
} from 'lucide-react';

export const ProfileView: React.FC = () => {
  const { userSession } = useAuth();
  const [isLeaderboardPublic, setIsLeaderboardPublic] = useState(
    userSession?.profile.is_public_leaderboard ?? true
  );

  const studentName = userSession?.profile.full_name || 'Estudante do Secundário';
  const studentYear = userSession?.profile.school_year || '11º Ano';
  const studentRole = userSession?.role === 'admin' ? 'Administrador' : 'Aluno';
  const streakDays = userSession?.stats.streak_days || 0;
  const exercisesSolved = userSession?.stats.exercises_solved || 0;
  const successRate = userSession?.stats.success_rate || 0;
  const avgScore = userSession?.stats.average_score_scale_20 || 0;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* 1. Cartão Principal de Perfil */}
      <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
        <div className="flex items-center gap-5">
          <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-slate-900 text-white font-black text-2xl flex items-center justify-center shadow-xs shrink-0 font-serif">
            {studentName.charAt(0)}
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">
                {studentName}
              </h1>
              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-200">
                {studentYear}
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-500 font-medium">
              <User className="w-3.5 h-3.5" />
              <span>{studentRole}</span>
            </div>
            <div className="text-[11px] text-slate-400">
              Conta de Aluno Protegida sob Row Level Security (RLS)
            </div>
          </div>
        </div>

        {/* Resumo Rápido de Sequência */}
        <div className="flex items-center gap-3 bg-amber-50/80 border border-amber-200/80 p-3.5 rounded-2xl shrink-0">
          <div className="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-600 flex items-center justify-center">
            <Flame className="w-6 h-6 fill-amber-500 text-amber-600" />
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-amber-800">
              Sequência Ativa
            </div>
            <div className="text-xl font-black text-amber-950 font-mono">
              {streakDays} dias
            </div>
          </div>
        </div>
      </div>

      {/* 2. Métricas Globais de Desempenho */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-1">
          <div className="flex items-center justify-between text-xs text-slate-500 font-semibold">
            <span>Exercícios Resolvidos</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-2xl font-black text-slate-900 font-mono">
            {exercisesSolved}
          </div>
          <p className="text-[11px] text-slate-400">Total em todas as disciplinas</p>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-1">
          <div className="flex items-center justify-between text-xs text-slate-500 font-semibold">
            <span>Taxa Média de Sucesso</span>
            <Trophy className="w-4 h-4 text-amber-600" />
          </div>
          <div className="text-2xl font-black text-slate-900 font-mono">
            {successRate.toFixed(1)}%
          </div>
          <p className="text-[11px] text-slate-400">Exercícios respondidos com acerto</p>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-xs space-y-1">
          <div className="flex items-center justify-between text-xs text-slate-500 font-semibold">
            <span>Classificação Média</span>
            <GraduationCap className="w-4 h-4 text-blue-900" />
          </div>
          <div className="text-2xl font-black text-slate-900 font-mono">
            {avgScore.toFixed(1)} <span className="text-sm font-normal text-slate-400">/ 20</span>
          </div>
          <p className="text-[11px] text-slate-400">Escala oficial de avaliação (0 a 20)</p>
        </div>
      </div>

      {/* 3. Desempenho por Disciplina */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-4">
        <div>
          <h2 className="text-base font-bold text-slate-900">Progresso por Disciplina</h2>
          <p className="text-xs text-slate-500">
            Acompanhamento de estudo e resolução de exercícios dos teus apontamentos.
          </p>
        </div>

        <div className="space-y-3">
          {OFFICIAL_SUBJECTS.map((subj) => (
            <div
              key={subj.id}
              className="p-3.5 rounded-xl border border-slate-100 hover:border-slate-200 bg-slate-50/50 flex items-center justify-between gap-4"
            >
              <div className="flex items-center gap-3">
                <span
                  className={`px-2 py-0.5 rounded text-[10px] font-bold border ${subj.color_badge}`}
                >
                  {subj.code}
                </span>
                <span className="text-xs font-bold text-slate-900">{subj.name}</span>
              </div>

              <div className="flex items-center gap-6 text-xs text-slate-500">
                <span className="text-[11px] font-mono">0 testes ativos</span>
                <span className="font-bold text-slate-700 font-mono">0 ex.</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 4. Preferências de Privacidade e Leaderboard */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs space-y-4">
        <div>
          <h2 className="text-base font-bold text-slate-900">Privacidade e Preferências</h2>
          <p className="text-xs text-slate-500">
            Controlo soberano dos teus dados e participação no quadro de honra.
          </p>
        </div>

        <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <div className="text-xs font-bold text-slate-900">
              Participar no Leaderboard Público
            </div>
            <p className="text-[11px] text-slate-500 max-w-md">
              Quando ativado, o teu nome, ano escolar e número de exercícios resolvidos aparecem no ranking geral. O conteúdo dos teus apontamentos nunca é público.
            </p>
          </div>

          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={isLeaderboardPublic}
              onChange={(e) => setIsLeaderboardPublic(e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-11 h-6 bg-slate-200 peer-focus:outline-hidden rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-slate-900"></div>
          </label>
        </div>

        <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-[11px] text-slate-500 flex items-center gap-2">
          <Lock className="w-4 h-4 text-slate-400 shrink-0" />
          <span>
            Os teus apontamentos pessoais, avaliações e resoluções mantêm-se estritamente privados e inacessíveis a outros estudantes.
          </span>
        </div>
      </div>
    </div>
  );
};
