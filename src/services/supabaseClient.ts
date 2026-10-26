import { createClient } from '@supabase/supabase-js';

// Variáveis públicas seguras (Client-Safe com fallback para ambiente Node/Testes)
const env = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env : (typeof process !== 'undefined' ? process.env : {});
const supabaseUrl = (env.VITE_SUPABASE_URL as string) || 'https://mock-studentshub.supabase.co';
const supabaseAnonKey = (env.VITE_SUPABASE_ANON_KEY as string) || 'mock-anon-key';

export const isSupabaseConfigured = () => {
  return (
    Boolean(env.VITE_SUPABASE_URL) &&
    env.VITE_SUPABASE_URL !== 'https://your-project-id.supabase.co' &&
    Boolean(env.VITE_SUPABASE_ANON_KEY) &&
    env.VITE_SUPABASE_ANON_KEY !== 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'
  );
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
