/**
 * Students Hub — Tipos Oficiais da Base de Dados PostgreSQL (Supabase)
 * FASE 2: SEGURANÇA E BASE DE DADOS
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

export type ChunkType = 'theory' | 'formula' | 'example' | 'exercise' | 'summary';
export type SessionMode = 'study' | 'exam' | 'flashcards';
export type SessionStatus = 'in_progress' | 'completed' | 'abandoned';
export type QuestionType = 'multiple_choice' | 'open_answer' | 'calculation' | 'true_false';

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          full_name: string;
          avatar_url: string | null;
          school_year: SchoolYear;
          is_public_leaderboard: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          full_name: string;
          avatar_url?: string | null;
          school_year: SchoolYear;
          is_public_leaderboard?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          full_name?: string;
          avatar_url?: string | null;
          school_year?: SchoolYear;
          is_public_leaderboard?: boolean;
          updated_at?: string;
        };
      };
      user_roles: {
        Row: {
          id: string;
          user_id: string;
          role: AppRole;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          role?: AppRole;
          created_at?: string;
        };
        Update: {
          role?: AppRole;
        };
      };
      subjects: {
        Row: {
          id: SubjectId;
          name: string;
          code: string;
          grade_level: string;
          description: string;
          created_at: string;
        };
        Insert: {
          id: SubjectId;
          name: string;
          code: string;
          grade_level: string;
          description: string;
          created_at?: string;
        };
        Update: {
          name?: string;
          code?: string;
          grade_level?: string;
          description?: string;
        };
      };
      tests: {
        Row: {
          id: string;
          user_id: string;
          subject_id: SubjectId;
          title: string;
          academic_term: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          subject_id: SubjectId;
          title: string;
          academic_term: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          subject_id?: SubjectId;
          title?: string;
          academic_term?: string;
          updated_at?: string;
        };
      };
      personal_notes: {
        Row: {
          id: string;
          user_id: string;
          test_id: string | null;
          subject_id: SubjectId;
          title: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          test_id?: string | null;
          subject_id: SubjectId;
          title: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          test_id?: string | null;
          subject_id?: SubjectId;
          title?: string;
          updated_at?: string;
        };
      };
      note_pages: {
        Row: {
          id: string;
          note_id: string;
          user_id: string;
          document_id: string;
          document_name: string;
          document_page_number: number;
          page_number: number;
          storage_file_path: string;
          file_sha256: string;
          raw_ocr_text: string | null;
          confirmed_text: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          note_id: string;
          user_id: string;
          document_id?: string;
          document_name: string;
          document_page_number?: number;
          page_number: number;
          storage_file_path: string;
          file_sha256: string;
          raw_ocr_text?: string | null;
          confirmed_text?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          document_name?: string;
          page_number?: number;
          raw_ocr_text?: string | null;
          confirmed_text?: string | null;
          updated_at?: string;
        };
      };
      note_chunks: {
        Row: {
          id: string;
          page_id: string;
          note_id: string;
          user_id: string;
          chunk_index: number;
          chunk_type: ChunkType;
          content: string;
          token_count: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          page_id: string;
          note_id: string;
          user_id: string;
          chunk_index: number;
          chunk_type: ChunkType;
          content: string;
          token_count?: number;
          created_at?: string;
        };
        Update: {
          chunk_index?: number;
          chunk_type?: ChunkType;
          content?: string;
          token_count?: number;
        };
      };
      public_notes: {
        Row: {
          id: string;
          curator_admin_id: string;
          subject_id: SubjectId;
          title: string;
          canonical_markdown: string;
          clean_print_ast: Record<string, unknown> | null;
          topics: string[];
          is_published: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          curator_admin_id: string;
          subject_id: SubjectId;
          title: string;
          canonical_markdown: string;
          clean_print_ast?: Record<string, unknown> | null;
          topics?: string[];
          is_published?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          subject_id?: SubjectId;
          title?: string;
          canonical_markdown?: string;
          clean_print_ast?: Record<string, unknown> | null;
          topics?: string[];
          is_published?: boolean;
          updated_at?: string;
        };
      };
      exercise_sessions: {
        Row: {
          id: string;
          user_id: string;
          subject_id: SubjectId;
          title: string;
          mode: SessionMode;
          status: SessionStatus;
          created_at: string;
          completed_at: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          subject_id: SubjectId;
          title: string;
          mode: SessionMode;
          status?: SessionStatus;
          created_at?: string;
          completed_at?: string | null;
        };
        Update: {
          title?: string;
          status?: SessionStatus;
          completed_at?: string | null;
        };
      };
      session_tests: {
        Row: {
          session_id: string;
          test_id: string;
          user_id: string;
          created_at: string;
        };
        Insert: {
          session_id: string;
          test_id: string;
          user_id: string;
          created_at?: string;
        };
        Update: {
          session_id?: string;
          test_id?: string;
        };
      };
      exercises: {
        Row: {
          id: string;
          session_id: string | null;
          user_id: string;
          subject_id: SubjectId;
          prompt: string;
          question_type: QuestionType;
          options: Record<string, unknown> | null;
          correct_answer: string;
          scoring_rubric: Record<string, unknown>;
          max_points: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          session_id?: string | null;
          user_id: string;
          subject_id: SubjectId;
          prompt: string;
          question_type: QuestionType;
          options?: Record<string, unknown> | null;
          correct_answer: string;
          scoring_rubric?: Record<string, unknown>;
          max_points?: number;
          created_at?: string;
        };
        Update: {
          prompt?: string;
          options?: Record<string, unknown> | null;
          // NOTA: correct_answer e scoring_rubric protegidos por trigger no PostgreSQL
        };
      };
      exercise_source_references: {
        Row: {
          id: string;
          exercise_id: string;
          user_id: string;
          note_id: string;
          page_id: string | null;
          chunk_id: string | null;
          citation_excerpt: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          exercise_id: string;
          user_id: string;
          note_id: string;
          page_id?: string | null;
          chunk_id?: string | null;
          citation_excerpt?: string | null;
          created_at?: string;
        };
        Update: {
          citation_excerpt?: string | null;
        };
      };
      exercise_attempts: {
        Row: {
          id: string;
          exercise_id: string;
          user_id: string;
          student_answer: string;
          awarded_points: number | null;
          feedback: string | null;
          is_correct: boolean | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          exercise_id: string;
          user_id: string;
          student_answer: string;
          awarded_points?: number | null;
          feedback?: string | null;
          is_correct?: boolean | null;
          created_at?: string;
        };
        Update: {
          student_answer?: string;
          // NOTA: awarded_points e is_correct protegidos por trigger no PostgreSQL
        };
      };
      study_stats: {
        Row: {
          user_id: string;
          streak_days: number;
          last_study_date: string | null;
          exercises_solved: number;
          correct_answers: number;
          success_rate: number;
          average_score_scale_20: number;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          streak_days?: number;
          last_study_date?: string | null;
          exercises_solved?: number;
          correct_answers?: number;
          success_rate?: number;
          average_score_scale_20?: number;
          updated_at?: string;
        };
        Update: {
          streak_days?: number;
          last_study_date?: string | null;
          exercises_solved?: number;
          correct_answers?: number;
          success_rate?: number;
          average_score_scale_20?: number;
          updated_at?: string;
        };
      };
    };
    Views: {
      leaderboard_public_view: {
        Row: {
          full_name: string;
          avatar_url: string | null;
          school_year: SchoolYear;
          streak_days: number;
          exercises_solved: number;
          success_rate: number;
          average_score_scale_20: number;
        };
      };
    };
    Functions: {
      is_admin: {
        Args: Record<string, never>;
        Returns: boolean;
      };
      get_public_leaderboard: {
        Args: Record<string, never>;
        Returns: {
          full_name: string;
          avatar_url: string | null;
          school_year: string;
          streak_days: number;
          exercises_solved: number;
          success_rate: number;
          average_score_scale_20: number;
        }[];
      };
    };
  };
}
