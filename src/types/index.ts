/**
 * Students Hub — Tipos Centrais da Aplicação
 * Slogan: "Apontamentos que ajudam, exercícios que resultam. Rumo ao 20."
 */

export type AppRole = 'student' | 'admin';

export type SchoolYear = '10º Ano' | '11º Ano' | '12º Ano';

export type SubjectId =
  | 'matematica-a'
  | 'fisica-quimica-a'
  | 'filosofia'
  | 'portugues'
  | 'ingles'
  | 'geometria-descritiva-a';

export interface Profile {
  id: string; // Corresponde a auth.users.id
  full_name: string;
  avatar_url?: string | null;
  school_year: SchoolYear;
  is_public_leaderboard: boolean;
  created_at: string;
  updated_at: string;
}

export interface UserRoleRecord {
  id: string;
  user_id: string;
  role: AppRole;
  created_at: string;
}

export interface StudyStats {
  user_id: string;
  streak_days: number;
  last_study_date: string | null;
  exercises_solved: number;
  correct_answers: number;
  success_rate: number;
  average_score_scale_20: number; // 0.00 a 20.00
  updated_at: string;
}

export interface SubjectInfo {
  id: SubjectId;
  name: string;
  code: string;
  grade_level: string;
  color_badge: string;
  color_border: string;
  description: string;
}

export interface AuthUserSession {
  id: string;
  email: string;
  role: AppRole;
  profile: Profile;
  stats: StudyStats;
  token?: string;
}
