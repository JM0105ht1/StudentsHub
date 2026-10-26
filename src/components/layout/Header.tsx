import React, { useState } from 'react';
import { useAuth } from '../../services/authContext';
import { Logo } from '../common/Logo';
import {
  BookOpen,
  User,
  Flame,
  LogOut,
  LogIn,
  Settings,
  Menu,
  X,
  Layers,
  CheckCircle2,
  Trophy,
  Lock,
} from 'lucide-react';

interface HeaderProps {
  activeTab: 'home' | 'subjects' | 'notes' | 'exercises' | 'exam' | 'leaderboard' | 'profile' | 'admin-notes';
  setActiveTab: (tab: any) => void;
  onOpenAuth: () => void;
}

export const Header: React.FC<HeaderProps> = ({ activeTab, setActiveTab, onOpenAuth }) => {
  const { userSession, logout } = useAuth();
  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const streakDays = userSession?.stats.streak_days || 0;

  const handleNavClick = (tab: any) => {
    setActiveTab(tab);
    setMobileMenuOpen(false);
    setProfileDropdownOpen(false);
  };

  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* 1. Logótipo Oficial do Students Hub com Área de Asset Reservada */}
          <button
            onClick={() => handleNavClick('home')}
            className="text-left group transition-opacity hover:opacity-90"
          >
            <Logo size="md" />
          </button>

          {/* 2. Navegação Desktop Académica & Discreta */}
          <nav className="hidden lg:flex items-center gap-1 text-xs font-semibold">
            <button
              onClick={() => handleNavClick('home')}
              className={`px-3 py-1.5 rounded-lg transition-colors ${
                activeTab === 'home'
                  ? 'bg-slate-900 text-white font-bold'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              Início
            </button>
            <button
              onClick={() => handleNavClick('notes')}
              className={`px-3 py-1.5 rounded-lg transition-colors ${
                activeTab === 'notes'
                  ? 'bg-slate-900 text-white font-bold'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              Apontamentos
            </button>
            <button
              onClick={() => handleNavClick('subjects')}
              className={`px-3 py-1.5 rounded-lg transition-colors ${
                activeTab === 'subjects'
                  ? 'bg-slate-900 text-white font-bold'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              Disciplinas
            </button>
            {userSession?.role === 'admin' && (
            <button
              onClick={() => handleNavClick('exercises')}
              className={`px-3 py-1.5 rounded-lg transition-colors ${
                activeTab === 'exercises'
                  ? 'bg-slate-900 text-white font-bold'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              Exercícios
            </button>
            )}
            <button
              onClick={() => handleNavClick('exam')}
              className={`px-3 py-1.5 rounded-lg transition-colors ${
                activeTab === 'exam'
                  ? 'bg-slate-900 text-white font-bold'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              Modo Exame
            </button>
            <button
              onClick={() => handleNavClick('leaderboard')}
              className={`px-3 py-1.5 rounded-lg transition-colors ${
                activeTab === 'leaderboard'
                  ? 'bg-slate-900 text-white font-bold'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              Leaderboard
            </button>
            {userSession?.role === 'admin' && (
              <button
                onClick={() => handleNavClick('admin-notes')}
                className={`px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 ${
                  activeTab === 'admin-notes'
                    ? 'bg-amber-600 text-white font-bold shadow-xs'
                    : 'text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200'
                }`}
              >
                <span>Administração</span>
              </button>
            )}
          </nav>

          {/* 3. Indicador de Sequência de Estudo e Menu de Conta */}
          <div className="flex items-center gap-3">
            {userSession ? (
              <>
                {/* Indicador de Sequência Discreto */}
                <div
                  className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-amber-50 border border-amber-200/80 text-amber-950 text-xs font-bold"
                  title="Dias consecutivos de estudo ativo"
                >
                  <Flame className="w-3.5 h-3.5 text-amber-600 fill-amber-500" />
                  <span className="font-mono">{streakDays} dias</span>
                </div>

                {/* Dropdown de Conta */}
                <div className="relative">
                  <button
                    onClick={() => setProfileDropdownOpen(!profileDropdownOpen)}
                    className="flex items-center gap-2 p-1 rounded-xl hover:bg-slate-100 transition-colors"
                    aria-label="Abrir menu de utilizador"
                  >
                    <div className="w-8 h-8 rounded-xl bg-slate-900 text-white font-bold text-xs flex items-center justify-center font-serif">
                      {userSession.profile.full_name.charAt(0)}
                    </div>
                    <div className="hidden sm:block text-left pr-1">
                      <div className="text-xs font-bold text-slate-900 leading-tight">
                        {userSession.profile.full_name}
                      </div>
                      <div className="text-[10px] text-slate-500 leading-tight">
                        {userSession.profile.school_year}
                      </div>
                    </div>
                  </button>

                  {profileDropdownOpen && (
                    <div className="absolute right-0 mt-2 w-60 bg-white rounded-2xl shadow-xl border border-slate-200 p-2 z-50 text-xs animate-in fade-in zoom-in-95 duration-100">
                      <div className="p-3 border-b border-slate-100">
                        <div className="font-bold text-slate-900">
                          {userSession.profile.full_name}
                        </div>
                        <div className="text-[11px] text-slate-500 mt-0.5">
                          {userSession.role === 'admin' ? 'Administrador' : 'Aluno'}
                        </div>
                        <div className="text-[10px] text-slate-400 mt-1">
                          {userSession.profile.school_year}
                        </div>
                      </div>

                      <div className="py-1">
                        {userSession.role === 'admin' && (
                          <button
                            onClick={() => handleNavClick('admin-notes')}
                            className="w-full text-left px-3 py-2 rounded-lg bg-amber-50 hover:bg-amber-100 font-bold text-amber-900 flex items-center gap-2 mb-1"
                          >
                            <Lock className="w-3.5 h-3.5 text-amber-600" />
                            <span>Gestão de Apontamentos</span>
                          </button>
                        )}
                        <button
                          onClick={() => handleNavClick('profile')}
                          className="w-full text-left px-3 py-2 rounded-lg hover:bg-slate-50 font-medium text-slate-700 flex items-center gap-2"
                        >
                          <User className="w-3.5 h-3.5 text-slate-500" />
                          <span>O Meu Perfil</span>
                        </button>
                        <button
                          onClick={() => handleNavClick('profile')}
                          className="w-full text-left px-3 py-2 rounded-lg hover:bg-slate-50 font-medium text-slate-700 flex items-center gap-2"
                        >
                          <Settings className="w-3.5 h-3.5 text-slate-500" />
                          <span>Definições & Privacidade</span>
                        </button>
                      </div>

                      <div className="border-t border-slate-100 pt-1 mt-1">
                        <button
                          onClick={() => {
                            logout();
                            setProfileDropdownOpen(false);
                          }}
                          className="w-full text-left px-3 py-2 rounded-lg text-rose-700 hover:bg-rose-50 font-bold flex items-center gap-2"
                        >
                          <LogOut className="w-3.5 h-3.5" />
                          <span>Terminar Sessão</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <button
                onClick={onOpenAuth}
                className="px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs shadow-xs transition-all flex items-center gap-1.5"
              >
                <LogIn className="w-3.5 h-3.5" />
                <span>Entrar</span>
              </button>
            )}

            {/* Botão de Menu Mobile */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="lg:hidden p-2 rounded-xl text-slate-600 hover:bg-slate-100"
              aria-label="Abrir menu de navegação"
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* Menu Mobile Retrátil */}
        {mobileMenuOpen && (
          <div className="lg:hidden py-3 border-t border-slate-200 space-y-1 text-xs font-semibold">
            <button
              onClick={() => handleNavClick('home')}
              className={`w-full text-left px-3 py-2 rounded-lg ${
                activeTab === 'home' ? 'bg-slate-900 text-white font-bold' : 'text-slate-700'
              }`}
            >
              Início
            </button>
            <button
              onClick={() => handleNavClick('notes')}
              className={`w-full text-left px-3 py-2 rounded-lg ${
                activeTab === 'notes' ? 'bg-slate-900 text-white font-bold' : 'text-slate-700'
              }`}
            >
              Apontamentos
            </button>
            <button
              onClick={() => handleNavClick('subjects')}
              className={`w-full text-left px-3 py-2 rounded-lg ${
                activeTab === 'subjects' ? 'bg-slate-900 text-white font-bold' : 'text-slate-700'
              }`}
            >
              Disciplinas
            </button>
            {userSession?.role === 'admin' && (
            <button
              onClick={() => handleNavClick('exercises')}
              className={`w-full text-left px-3 py-2 rounded-lg ${
                activeTab === 'exercises' ? 'bg-slate-900 text-white font-bold' : 'text-slate-700'
              }`}
            >
              Exercícios
            </button>
            )}
            <button
              onClick={() => handleNavClick('exam')}
              className={`w-full text-left px-3 py-2 rounded-lg ${
                activeTab === 'exam' ? 'bg-slate-900 text-white font-bold' : 'text-slate-700'
              }`}
            >
              Modo Exame
            </button>
            <button
              onClick={() => handleNavClick('leaderboard')}
              className={`w-full text-left px-3 py-2 rounded-lg ${
                activeTab === 'leaderboard' ? 'bg-slate-900 text-white font-bold' : 'text-slate-700'
              }`}
            >
              Leaderboard
            </button>
            {userSession?.role === 'admin' && (
              <button
                onClick={() => handleNavClick('admin-notes')}
                className={`w-full text-left px-3 py-2 rounded-lg font-bold ${
                  activeTab === 'admin-notes'
                    ? 'bg-amber-600 text-white'
                    : 'text-amber-800 bg-amber-50'
                }`}
              >
                Administração
              </button>
            )}
            {userSession && (
              <button
                onClick={() => handleNavClick('profile')}
                className={`w-full text-left px-3 py-2 rounded-lg ${
                  activeTab === 'profile' ? 'bg-slate-900 text-white font-bold' : 'text-slate-700'
                }`}
              >
                O Meu Perfil
              </button>
            )}
          </div>
        )}
      </div>
    </header>
  );
};
