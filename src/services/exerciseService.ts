/**
 * Serviço de Exercícios Grounded — Fases 5 & 6
 * Students Hub — "Apontamentos que ajudam, exercícios que resultam. Rumo ao 20."
 * Princípio Sagrado: «SEMPRE COM BASE NOS APONTAMENTOS!!!»
 */

import {
  GenerateExercisesRequest,
  GenerateExercisesResponse,
  SubmitSessionRequest,
  SubmitSessionResponse,
  SessionResultData,
  ExerciseStudentView,
} from '../types/exercises';

/**
 * Envia o pedido de geração grounded para /api/generate-exercises
 */
export async function requestExerciseGeneration(
  token: string,
  request: GenerateExercisesRequest
): Promise<GenerateExercisesResponse> {
  const response = await fetch('/api/generate-exercises', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(request),
  });

  const data = await response.json();

  if (!response.ok && data.error && !data.code) {
    throw new Error(data.error || 'Ocorreu um erro ao gerar exercícios a partir dos apontamentos.');
  }

  return data as GenerateExercisesResponse;
}

/**
 * Submete as respostas do aluno ao servidor para correção atómica e cálculo oficial de nota
 * (Gabarito exclusivamente no PostgreSQL; o cliente nunca envia pontuações nem respostas oficiais)
 */
export async function submitExerciseSession(
  token: string,
  request: SubmitSessionRequest
): Promise<SubmitSessionResponse> {
  const response = await fetch('/api/submit-session', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(request),
  });

  const data = await response.json();

  if (!response.ok && data.error && !data.code) {
    throw new Error(data.error || 'Erro ao submeter respostas para correção.');
  }

  return data as SubmitSessionResponse;
}

/**
 * Obtém os resultados oficiais e a revisão das respostas de uma sessão concluída
 * (O gabarito só é revelado após a conclusão e validação de propriedade da sessão)
 */
export async function fetchSessionResults(
  token: string,
  sessionId: string
): Promise<SessionResultData> {
  const response = await fetch(`/api/session-results?session_id=${encodeURIComponent(sessionId)}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || 'Não foi possível obter os resultados da sessão.');
  }

  return data as SessionResultData;
}

/**
 * Obtém as questões da sessão sem gabarito nem pontuações antecipadas
 */
export async function fetchSessionQuestions(
  token: string,
  sessionId: string
): Promise<ExerciseStudentView[]> {
  const response = await fetch(`/api/session-questions?session_id=${encodeURIComponent(sessionId)}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || 'Não foi possível obter as perguntas da sessão.');
  }

  return data.questions as ExerciseStudentView[];
}

/**
 * Geração de Exercícios Oficiais Grounded no Caderno da Turma C (Fase C)
 * Acesso exclusivo a Administradores
 */
export async function generateOfficialExercises(
  token: string,
  request: {
    note_id: string;
    version_id?: string;
    count?: number;
    question_type?: string;
    difficulty?: string;
  }
) {
  const response = await fetch('/api/generate-exercises', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(request),
  });

  const data = await response.json();
  if (!response.ok && data.error && !data.code) {
    throw new Error(data.error || 'Erro ao gerar exercícios oficiais com Gemini.');
  }
  return data;
}

/**
 * Gestão e Revisão Administrativa de Exercícios Oficiais
 */
export async function listAdminExercises(
  token: string,
  filters: { subject_id?: string; status?: string }
) {
  const response = await fetch('/api/admin-exercises', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      action: 'list_exercises',
      payload: filters,
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Erro ao listar exercícios para revisão.');
  }
  return data.exercises || [];
}

export async function updateAdminExercise(
  token: string,
  exerciseId: string,
  payload: any
) {
  const response = await fetch('/api/admin-exercises', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      action: 'update_exercise',
      exercise_id: exerciseId,
      payload,
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Erro ao atualizar exercício em rascunho.');
  }
  return data;
}

export async function publishAdminExercise(token: string, exerciseId: string) {
  const response = await fetch('/api/admin-exercises', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      action: 'publish_exercise',
      exercise_id: exerciseId,
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Erro ao homologar e publicar exercício.');
  }
  return data;
}

export async function archiveAdminExercise(token: string, exerciseId: string) {
  const response = await fetch('/api/admin-exercises', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      action: 'archive_exercise',
      exercise_id: exerciseId,
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Erro ao arquivar exercício.');
  }
  return data;
}


// ==============================================================================
// Sessões de avaliações oficiais e de treino (servidor cria a sessão e as cópias)
// ==============================================================================

export interface OfficialAssessmentItem {
  id: string;
  assessment_type: 'exam' | 'exercise_set';
  subject_id: string;
  title: string;
  total_points: number;
  first_attempt: { score_percentage: number; score_scale_20: number; completed_at: string } | null;
}

export async function listOfficialAssessments(token: string, subjectId: string): Promise<OfficialAssessmentItem[]> {
  const response = await fetch(`/api/official-sessions?subject_id=${encodeURIComponent(subjectId)}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Não foi possível listar as avaliações oficiais.');
  return data.assessments as OfficialAssessmentItem[];
}

async function postOfficialSessions(token: string, payload: Record<string, unknown>) {
  const response = await fetch('/api/official-sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Não foi possível iniciar a sessão.');
  return data;
}

export async function startOfficialAssessment(
  token: string,
  assessmentType: 'exam' | 'exercise_set',
  assessmentId: string
): Promise<{ session_id: string; resumed: boolean }> {
  return postOfficialSessions(token, {
    action: 'start_assessment',
    assessment_type: assessmentType,
    assessment_id: assessmentId,
  });
}

export async function startPracticeSession(
  token: string,
  params: {
    subject_id: string;
    academic_period?: string;
    count?: number;
    question_type?: string;
    difficulty?: string;
    type_counts?: Record<string, number>;
  }
): Promise<{ success: boolean; session_id?: string; message?: string }> {
  return postOfficialSessions(token, { action: 'start_practice', ...params });
}

/** Converte as questões do servidor (sem gabarito) para o formato do TestRunnerUI */
export function toRunnerQuestions(questions: ExerciseStudentView[]) {
  return questions.map((q, idx) => ({
    id: q.id,
    questionNumber: idx + 1,
    totalQuestions: questions.length,
    prompt: q.prompt,
    questionType: q.question_type,
    options: Array.isArray(q.options) ? q.options : undefined,
    maxPoints: q.max_points,
    sourceNoteRef: q.source_note_ref || 'Apontamentos Oficiais',
  }));
}
