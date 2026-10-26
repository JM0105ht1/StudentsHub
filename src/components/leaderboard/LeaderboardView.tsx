import React, { useState, useEffect } from 'react';
import { Flame } from 'lucide-react';
import { SchoolYear } from '../../types';
import { supabase, isSupabaseConfigured } from '../../services/supabaseClient';

interface LeaderboardEntry {
  position: number;
  fullName: string;
  avatarUrl?: string;
  schoolYear: SchoolYear;
  streakDays: number;
  exercisesSolved: number;
  averageScore: number;
}

export const LeaderboardView: React.FC = () => {
  const [selectedYearFilter, setSelectedYearFilter] = useState<'all' | SchoolYear>('all');
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Classificação real, através da RPC segura get_public_leaderboard()
  useEffect(() => {
    let isMounted = true;
    async function load() {
      setIsLoading(true);
      setError(null);

      if (!isSupabaseConfigured()) {
        if (isMounted) {
          setEntries([]);
          setIsLoading(false);
        }
        return;
      }

      const { data, error: rpcError } = await supabase.rpc('get_public_leaderboard');
      if (!isMounted) return;

      if (rpcError) {
        setError('Não foi possível carregar a classificação.');
        setEntries([]);
      } else {
        setEntries(
          (data || []).map((r: any, i: number) => ({
            position: i + 1,
            fullName: r.full_name,
            avatarUrl: r.avatar_url ?? undefined,
            schoolYear: r.school_year as SchoolYear,
            streakDays: r.streak_days ?? 0,
            exercisesSolved: r.exercises_solved ?? 0,
            averageScore: Number(r.average_score_scale_20 ?? 0),
          }))
        );
      }
      setIsLoading(false);
    }
    load();
    return () => {
      isMounted = false;
    };
  }, []);

  const filteredEntries =
    selectedYearFilter === 'all'
      ? entries
      : entries
          .filter((entry) => entry.schoolYear === selectedYearFilter)
          .map((entry, i) => ({ ...entry, position: i + 1 }));

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* 1. Cabeçalho do Leaderboard */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-8 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
              Quadro de Honra
            </span>
            <span className="text-slate-300">/</span>
            <span className="text-xs font-bold text-slate-900">Ensino Secundário</span>
          </div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight mt-1">
            Leaderboard de Estudo e Consistência
          </h1>
          <p className="text-xs text-slate-600 mt-1 max-w-xl">
            Reconhecimento da disciplina e do trabalho contínuo. Critérios: exercícios resolvidos e média de acertos.
          </p>
        </div>

        <div className="flex items-center gap-1.5 p-1 bg-slate-100 rounded-xl border border-slate-200 self-start sm:self-auto text-xs font-semibold">
          <button
            onClick={() => setSelectedYearFilter('all')}
            className={`px-3 py-1.5 rounded-lg transition-colors ${
              selectedYearFilter === 'all'
                ? 'bg-white text-slate-900 shadow-xs font-bold'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Todos
          </button>
          <button
            onClick={() => setSelectedYearFilter('10º Ano')}
            className={`px-3 py-1.5 rounded-lg transition-colors ${
              selectedYearFilter === '10º Ano'
                ? 'bg-white text-slate-900 shadow-xs font-bold'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            10º Ano
          </button>
          <button
            onClick={() => setSelectedYearFilter('11º Ano')}
            className={`px-3 py-1.5 rounded-lg transition-colors ${
              selectedYearFilter === '11º Ano'
                ? 'bg-white text-slate-900 shadow-xs font-bold'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            11º Ano
          </button>
          <button
            onClick={() => setSelectedYearFilter('12º Ano')}
            className={`px-3 py-1.5 rounded-lg transition-colors ${
              selectedYearFilter === '12º Ano'
                ? 'bg-white text-slate-900 shadow-xs font-bold'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            12º Ano
          </button>
        </div>
      </div>

      {/* 2. Tabela Académica de Classificação */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50/80 border-b border-slate-200 text-slate-500 font-bold uppercase tracking-wider text-[10px]">
              <tr>
                <th className="py-3 px-4 w-12 text-center">Pos.</th>
                <th className="py-3 px-4">Estudante</th>
                <th className="py-3 px-4">Ano</th>
                <th className="py-3 px-4 text-center">Sequência</th>
                <th className="py-3 px-4 text-right">Exercícios</th>
                <th className="py-3 px-4 text-right">Média</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-medium">
              {(isLoading || error || filteredEntries.length === 0) && (
                <tr>
                  <td colSpan={6} className="py-10 px-4 text-center text-xs text-slate-400">
                    {isLoading
                      ? 'A carregar classificação...'
                      : error
                      ? error
                      : 'Ainda não há ninguém na classificação. Resolve exercícios para aparecer aqui!'}
                  </td>
                </tr>
              )}
              {filteredEntries.map((student) => {
                const isTop3 = student.position <= 3;
                return (
                  <tr
                    key={student.position}
                    className={`hover:bg-slate-50/80 transition-colors ${
                      student.position === 1 ? 'bg-amber-50/20' : ''
                    }`}
                  >
                    <td className="py-3.5 px-4 text-center">
                      <span
                        className={`inline-flex items-center justify-center w-6 h-6 rounded-md font-mono text-xs font-bold ${
                          student.position === 1
                            ? 'bg-amber-500 text-white'
                            : student.position === 2
                            ? 'bg-slate-400 text-white'
                            : student.position === 3
                            ? 'bg-amber-700 text-white'
                            : 'text-slate-500'
                        }`}
                      >
                        {student.position}
                      </span>
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-full bg-slate-200 text-slate-700 font-bold text-xs flex items-center justify-center">
                          {student.fullName.charAt(0)}
                        </div>
                        <span className="font-bold text-slate-900">
                          {student.fullName}
                        </span>
                      </div>
                    </td>
                    <td className="py-3.5 px-4 text-slate-600">
                      <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-700 border border-slate-200">
                        {student.schoolYear}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-center">
                      <div className="inline-flex items-center gap-1 font-mono font-bold text-amber-900 bg-amber-50 px-2 py-0.5 rounded border border-amber-200/60">
                        <Flame className="w-3.5 h-3.5 fill-amber-500 text-amber-600" />
                        <span>{student.streakDays}d</span>
                      </div>
                    </td>
                    <td className="py-3.5 px-4 text-right font-mono font-bold text-slate-900">
                      {student.exercisesSolved}
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <span className="font-mono font-bold text-slate-900">
                        {student.averageScore.toFixed(1)}
                      </span>
                      <span className="text-[10px] text-slate-400 font-mono"> / 20</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
