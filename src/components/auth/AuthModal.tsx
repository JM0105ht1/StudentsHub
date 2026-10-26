import React, { useState } from 'react';
import { useAuth } from '../../services/authContext';
import { LogIn, UserPlus, AlertCircle, CheckCircle2 } from 'lucide-react';

export const AuthModal: React.FC<{ isOpen: boolean; onClose: () => void }> = ({
  isOpen,
  onClose,
}) => {
  const { login, register } = useAuth();
  const [tab, setTab] = useState<'login' | 'register'>('login');

  const [name, setName] = useState('');
  const [password, setPassword] = useState('');

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  if (!isOpen) return null;

  const switchTab = (next: 'login' | 'register') => {
    setTab(next);
    setMessage(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    setLoading(true);

    try {
      if (tab === 'login') {
        const res = await login(name, password);
        if (res.success) {
          setPassword('');
          onClose();
        } else {
          setMessage({ type: 'error', text: res.error || 'Nome ou palavra-passe incorretos.' });
        }
      } else {
        const res = await register(name, password);
        if (res.success) {
          setMessage({ type: 'success', text: 'Conta criada com sucesso! Sessão iniciada.' });
          setPassword('');
          setTimeout(() => onClose(), 1200);
        } else {
          setMessage({ type: 'error', text: res.error || 'Erro ao criar conta.' });
        }
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-md w-full overflow-hidden">
        {/* Cabeçalho */}
        <div className="p-6 bg-slate-900 text-white flex items-center justify-between">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-widest text-blue-400">
              Students Hub
            </div>
            <h2 className="text-xl font-bold mt-0.5">
              {tab === 'login' ? 'Entrar na Conta' : 'Criar Conta'}
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              Rumo ao 20. Foco exclusivo no ensino secundário.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white text-xs font-bold px-2 py-1 rounded"
            aria-label="Fechar"
          >
            ✕
          </button>
        </div>

        {/* Separadores de Alternância */}
        <div className="flex border-b border-slate-100 bg-slate-50 text-xs font-bold">
          <button
            type="button"
            onClick={() => switchTab('login')}
            className={`flex-1 py-3 text-center transition-colors border-b-2 ${
              tab === 'login'
                ? 'border-blue-900 text-blue-950 bg-white'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            Iniciar Sessão
          </button>
          <button
            type="button"
            onClick={() => switchTab('register')}
            className={`flex-1 py-3 text-center transition-colors border-b-2 ${
              tab === 'register'
                ? 'border-blue-900 text-blue-950 bg-white'
                : 'border-transparent text-slate-500 hover:text-slate-900'
            }`}
          >
            Criar Conta
          </button>
        </div>

        {/* Formulário */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4 text-xs">
          {message && (
            <div
              className={`p-3 rounded-xl border flex items-center gap-2 ${
                message.type === 'error'
                  ? 'bg-rose-50 text-rose-800 border-rose-200'
                  : 'bg-emerald-50 text-emerald-800 border-emerald-200'
              }`}
            >
              {message.type === 'error' ? (
                <AlertCircle className="w-4 h-4 shrink-0" />
              ) : (
                <CheckCircle2 className="w-4 h-4 shrink-0" />
              )}
              <span>{message.text}</span>
            </div>
          )}

          <div>
            <label className="block text-slate-700 font-bold mb-1">Nome:</label>
            <input
              type="text"
              required
              autoComplete="username"
              maxLength={30}
              placeholder="Ex: João Silva"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full p-2.5 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-900"
            />
          </div>

          <div>
            <label className="block text-slate-700 font-bold mb-1">Palavra-passe:</label>
            <input
              type="password"
              required
              autoComplete={tab === 'login' ? 'current-password' : 'new-password'}
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full p-2.5 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-900"
            />
            {tab === 'register' && (
              <p className="text-[11px] text-slate-400 mt-1">Mínimo de 6 caracteres.</p>
            )}
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 rounded-xl bg-blue-900 hover:bg-blue-800 disabled:opacity-60 text-white font-bold text-xs shadow-sm transition-all flex items-center justify-center gap-2"
          >
            {loading ? (
              <span>A processar...</span>
            ) : tab === 'login' ? (
              <>
                <LogIn className="w-4 h-4" />
                <span>Entrar</span>
              </>
            ) : (
              <>
                <UserPlus className="w-4 h-4" />
                <span>Criar Conta e Entrar</span>
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
};
