import { createRoot } from 'react-dom/client';
import { AuthProvider } from './services/authContext';
import App from './App';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <AuthProvider>
    <App />
  </AuthProvider>
);

// Regista o service worker (necessário para poder instalar o site como app)
if ('serviceWorker' in navigator && (import.meta as any).env?.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
