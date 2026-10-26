import React, { createContext, useContext, useState, useEffect } from 'react';
import { AuthUserSession, Profile, StudyStats, AppRole } from '../types';
import { supabase, isSupabaseConfigured } from './supabaseClient';
import {
  usernameToEmail,
  validateUsername,
  validatePassword,
  translateAuthError,
} from '../lib/username';

interface AuthContextType {
  userSession: AuthUserSession | null;
  isLoading: boolean;
  error: string | null;
  login: (name: string, pass: string) => Promise<{ success: boolean; error?: string }>;
  register: (name: string, pass: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [userSession, setUserSession] = useState<AuthUserSession | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Carregar dados complementares do utilizador autenticado
  const fetchUserData = async (userId: string, email: string) => {
    try {
      const [profileRes, roleRes, statsRes] = await Promise.all([
        supabase.from('profiles').select('*').eq('id', userId).single(),
        supabase.from('user_roles').select('role').eq('user_id', userId).single(),
        supabase.from('study_stats').select('*').eq('user_id', userId).single(),
      ]);

      const role: AppRole = roleRes.data?.role || 'student';
      const profile: Profile = profileRes.data || {
        id: userId,
        full_name: email.split('@')[0] || 'Aluno',
        school_year: '12º Ano',
        is_public_leaderboard: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      const stats: StudyStats = statsRes.data || {
        user_id: userId,
        streak_days: 0,
        last_study_date: null,
        exercises_solved: 0,
        correct_answers: 0,
        success_rate: 0,
        average_score_scale_20: 0,
        updated_at: new Date().toISOString(),
      };

      setUserSession({
        id: userId,
        email,
        role,
        profile,
        stats,
      });
    } catch (err: any) {
      console.error('Erro ao carregar dados do utilizador:', err);
    }
  };

  useEffect(() => {
    const initializeAuth = async () => {
      try {
        if (isSupabaseConfigured()) {
          const { data: { session }, error: sessionError } = await supabase.auth.getSession();
          if (sessionError) throw sessionError;

          if (session?.user) {
            await fetchUserData(session.user.id, session.user.email || '');
          } else {
            setUserSession(null);
          }

          // Listener de alterações de sessão
          const { data: { subscription } } = supabase.auth.onAuthStateChange(
            async (_event, currentSession) => {
              if (currentSession?.user) {
                await fetchUserData(currentSession.user.id, currentSession.user.email || '');
              } else {
                setUserSession(null);
              }
            }
          );

          return () => {
            subscription.unsubscribe();
          };
        } else {
          // Quando não configurado, o estado inicial é desautenticado (null)
          setUserSession(null);
        }
      } catch (err: any) {
        console.error('Erro ao inicializar autenticação:', err);
        setError(err.message || 'Erro na autenticação.');
      } finally {
        setIsLoading(false);
      }
    };

    initializeAuth();
  }, []);

  const login = async (name: string, pass: string) => {
    setError(null);
    try {
      if (!isSupabaseConfigured()) {
        return {
          success: false,
          error: 'Supabase não configurado. Define VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no ambiente.',
        };
      }

      const nameError = validateUsername(name);
      if (nameError) return { success: false, error: nameError };

      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: usernameToEmail(name),
        password: pass,
      });

      if (signInError) throw signInError;
      if (data.user) {
        await fetchUserData(data.user.id, data.user.email || '');
      }

      return { success: true };
    } catch (err: any) {
      const msg = translateAuthError(err.message);
      setError(msg);
      return { success: false, error: msg };
    }
  };

  const register = async (name: string, pass: string) => {
    setError(null);
    try {
      if (!isSupabaseConfigured()) {
        return {
          success: false,
          error: 'Supabase não configurado. Define VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY no ambiente.',
        };
      }

      const nameError = validateUsername(name);
      if (nameError) return { success: false, error: nameError };
      const passError = validatePassword(pass);
      if (passError) return { success: false, error: passError };

      const { data, error: signUpError } = await supabase.auth.signUp({
        email: usernameToEmail(name),
        password: pass,
        options: {
          data: {
            full_name: name.trim(),
          },
        },
      });

      if (signUpError) throw signUpError;

      // Com a confirmação por email ligada, o Supabase não devolve sessão.
      if (!data.session) {
        return {
          success: false,
          error: 'Conta criada, mas o Supabase exige confirmação por email. Desativa "Confirm email" em Authentication → Providers → Email.',
        };
      }

      if (data.user) {
        await fetchUserData(data.user.id, data.user.email || '');
      }

      return { success: true };
    } catch (err: any) {
      const msg = translateAuthError(err.message);
      setError(msg);
      return { success: false, error: msg };
    }
  };

  const logout = async () => {
    try {
      if (isSupabaseConfigured()) {
        await supabase.auth.signOut();
      }
      setUserSession(null);
    } catch (err) {
      console.error('Erro no logout:', err);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        userSession,
        isLoading,
        error,
        login,
        register,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth deve ser utilizado dentro de um AuthProvider');
  }
  return context;
};
