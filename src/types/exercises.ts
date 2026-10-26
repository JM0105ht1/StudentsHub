/**
 * Students Hub — Tipos para o Motor de Exercícios Grounded (Fase 5)
 * Princípio Sagrado: «SEMPRE COM BASE NOS APONTAMENTOS!!!»
 */

export type ExerciseQuestionType =
  | 'multiple_choice'
  | 'open_answer'
  | 'calculation'
  | 'true_false';

export type ExerciseDifficulty = 'easy' | 'medium' | 'hard' | 'mixed';

export interface ExerciseSourceReference {
  chunk_id: string;
  note_id?: string;
  page_id?: string;
  citation_excerpt: string;
  test_title?: string;
  note_title?: string;
  page_number?: number;
}

export interface ExerciseStudentView {
  id: string;
  session_id: string;
  subject_id: string;
  prompt: string;
  question_type: ExerciseQuestionType;
  options?: string[] | null;
  max_points: number;
  source_references: ExerciseSourceReference[];
  source_note_ref?: string;
}

export interface ExerciseInternalRecord {
  prompt: string;
  question_type: ExerciseQuestionType;
  options?: string[] | null;
  correct_answer: string;
  scoring_rubric: {
    criteria?: string[];
    explanation?: string;
    points_breakdown?: Record<string, number>;
  };
  max_points: number;
  source_references: Array<{
    chunk_id: string;
    citation_excerpt: string;
  }>;
}

export interface GenerateExercisesRequest {
  subject_id?: string;
  test_ids?: string[];
  note_id?: string;
  version_id?: string;
  question_type?: string;
  difficulty?: string;
  count?: number;
}

export interface AdminExerciseItem {
  id: string;
  prompt: string;
  question_type: ExerciseQuestionType;
  options?: string[] | null;
  correct_answer: string;
  scoring_rubric: {
    criteria?: string[];
    explanation?: string;
  };
  max_points: number;
  difficulty: 'facil' | 'medio' | 'dificil';
  status: 'draft' | 'published' | 'archived';
  quote_excerpt?: string;
  official_note_id?: string;
  official_version_id?: string;
  official_section?: string;
  subject_id?: string;
  academic_period?: string;
  created_at?: string;
}

export interface GenerateOfficialExercisesResponse {
  success: boolean;
  message?: string;
  note_title?: string;
  version_number?: number;
  subject_id?: string;
  academic_period?: string;
  exercises?: AdminExerciseItem[];
  code?: string;
  error?: string;
}

export interface GenerateExercisesResponse {
  success: boolean;
  session_id?: string;
  subject_id?: string;
  count?: number;
  exercises?: ExerciseStudentView[];
  code?: 'INSUFFICIENT_NOTES_CONTENT' | 'VALIDATION_ERROR' | 'CROSS_TENANT_DENIED' | 'SERVER_ERROR';
  message?: string;
  error?: string;
}

// ==============================================================================
// FASE 6 — TIPOS PARA SUBMISSÃO, CORREÇÃO E RESULTADOS
// ==============================================================================

export interface StudentAnswerSubmission {
  exercise_id: string;
  student_answer: string | number | null;
}

export interface SubmitSessionRequest {
  session_id: string;
  answers: StudentAnswerSubmission[];
}

export interface ExerciseReviewItem {
  exercise_id: string;
  prompt: string;
  question_type: ExerciseQuestionType;
  options?: string[] | null;
  student_answer: string;
  correct_answer: string;
  is_correct: boolean | null;
  review_status: 'evaluated' | 'pending_review';
  awarded_points: number;
  max_points: number;
  feedback?: string;
  source_note_ref?: string;
  citation_excerpt?: string;
}

export interface SessionResultData {
  session_id: string;
  subject_id: string;
  title: string;
  status: 'completed' | 'in_progress';
  total_score: number;
  max_score: number;
  score_scale_20: number;
  correct_count: number;
  incorrect_count: number;
  pending_count: number;
  exercises: ExerciseReviewItem[];
}

export interface SubmitSessionResponse extends Partial<SessionResultData> {
  success: boolean;
  code?: 'CROSS_TENANT_DENIED' | 'ALREADY_COMPLETED' | 'INTEGRITY_VIOLATION' | 'EVALUATION_ERROR';
  error?: string;
}

