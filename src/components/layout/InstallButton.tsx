import React, { useEffect, useState } from 'react';
import { Download, Share, X } from 'lucide-react';

/**
 * Botão "Instalar app": instala o site no ecrã inicial, como um atalho/app.
 * - Android/Chrome/Edge/Samsung: abre o pedido de instalação do navegador.
 * - iPhone/iPad e navegadores sem pedido automático: mostra instruções.
 * - Desaparece quando o site já está instalado.
 */
function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (navigator as any).standalone === true
  );
}

function isIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  return (
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

export const InstallButton: React.FC<{ className?: string }> = ({ className = '' }) => {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [installed, setInstalled] = useState<boolean>(isStandalone());
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferredPrompt(null);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (installed) return null;

  const handleClick = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      try {
        await deferredPrompt.userChoice;
      } finally {
        setDeferredPrompt(null);
      }
      return;
    }
    setHelpOpen(true);
  };

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        className={`items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold text-blue-900 bg-blue-50 border border-blue-200 hover:bg-blue-100 transition-colors ${className}`}
        title="Instalar o Students Hub como app no teu dispositivo"
      >
        <Download className="w-3.5 h-3.5" />
        <span>Instalar app</span>
      </button>

      {helpOpen && (
        <div
          className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-slate-900/60 p-4"
          onClick={() => setHelpOpen(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-sm w-full p-5 text-xs text-slate-700"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-3">
              <h3 className="text-sm font-bold text-slate-900">Instalar o Students Hub</h3>
              <button
                type="button"
                onClick={() => setHelpOpen(false)}
                aria-label="Fechar"
                className="text-slate-400 hover:text-slate-700"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {isIos() ? (
              <ol className="list-decimal pl-4 space-y-2">
                <li className="leading-relaxed">
                  Abre o site no <strong>Safari</strong> e toca em <strong>Partilhar</strong>{' '}
                  <Share className="inline w-3.5 h-3.5 -mt-0.5" />.
                </li>
                <li className="leading-relaxed">
                  Escolhe <strong>«Adicionar ao ecrã principal»</strong>.
                </li>
                <li className="leading-relaxed">Toca em <strong>Adicionar</strong>.</li>
              </ol>
            ) : (
              <ol className="list-decimal pl-4 space-y-2">
                <li className="leading-relaxed">
                  Abre o menu do navegador (os três pontos <strong>⋮</strong> ou as três linhas{' '}
                  <strong>☰</strong>).
                </li>
                <li className="leading-relaxed">
                  Toca em <strong>«Adicionar ao ecrã inicial»</strong> ou{' '}
                  <strong>«Instalar aplicação»</strong>.
                </li>
                <li className="leading-relaxed">Confirma. O atalho fica no ecrã inicial.</li>
              </ol>
            )}

            <button
              type="button"
              onClick={() => setHelpOpen(false)}
              className="mt-4 w-full py-2.5 rounded-xl bg-slate-900 text-white font-bold hover:bg-slate-800 transition-colors"
            >
              Percebi
            </button>
          </div>
        </div>
      )}
    </>
  );
};
