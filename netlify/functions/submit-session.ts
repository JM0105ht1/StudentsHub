import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { authenticateRequest } from './auth-check';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const jsonHeaders: Record<string, string> = { 'Content-Type': 'application/json' };

export interface SubmittedAnswer {
  exercise_id: string;
  student_answer: string | number | null;
}

export interface SubmitSessionPayload {
  session_id: string;
  answers: SubmittedAnswer[];
}

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: jsonHeaders,
      body: JSON.stringify({ error: 'Método não permitido. Utilize POST.' }),
    };
  }

  // 1. Autenticação Server-Side Estrita (O ID é SEMPRE obtido do token verificado)
  const auth = await authenticateRequest(event.headers.authorization);
  if (!auth.authenticated || !auth.userId) {
    return {
      statusCode: 401,
      headers: jsonHeaders,
      body: JSON.stringify({ error: auth.error || 'Sessão não autorizada.' }),
    };
  }
  const verifiedUserId = auth.userId;

  // 2. Leitura e Validação de Integridade do Payload
  let body: any;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return {
      statusCode: 400,
      headers: jsonHeaders,
      body: JSON.stringify({ error: 'Corpo da requisição não é um JSON válido.' }),
    };
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return {
      statusCode: 400,
      headers: jsonHeaders,
      body: JSON.stringify({ error: 'O corpo do pedido deve ser um objeto JSON.' }),
    };
  }

  const { session_id, answers } = body as SubmitSessionPayload;

  // 3. Validação de identificador da sessão
  if (!session_id || typeof session_id !== 'string' || !UUID_REGEX.test(session_id.trim())) {
    return {
      statusCode: 400,
      headers: jsonHeaders,
      body: JSON.stringify({
        error: 'Identificador de sessão ("session_id") em falta ou inválido.',
      }),
    };
  }

  // 4. Validação da lista de respostas
  if (!answers || !Array.isArray(answers) || answers.length === 0) {
    return {
      statusCode: 400,
      headers: jsonHeaders,
      body: JSON.stringify({
        error: 'A lista de respostas ("answers") é obrigatória e deve conter pelo menos uma resposta.',
      }),
    };
  }

  // Sanitizar array de respostas (ignora campos espúrios como is_correct, points, user_id enviados pelo cliente)
  const sanitizedAnswers: Array<{ exercise_id: string; student_answer: string }> = [];
  for (let i = 0; i < answers.length; i++) {
    const item = answers[i];
    if (!item || typeof item !== 'object') {
      return {
        statusCode: 400,
        headers: jsonHeaders,
        body: JSON.stringify({ error: `Item de resposta no índice ${i} é inválido.` }),
      };
    }
    if (!item.exercise_id || typeof item.exercise_id !== 'string' || !UUID_REGEX.test(item.exercise_id.trim())) {
      return {
        statusCode: 400,
        headers: jsonHeaders,
        body: JSON.stringify({ error: `Identificador de exercício inválido no índice ${i}.` }),
      };
    }

    sanitizedAnswers.push({
      exercise_id: item.exercise_id.trim(),
      student_answer: item.student_answer !== null && item.student_answer !== undefined ? String(item.student_answer) : '',
    });
  }

  // 5. Execução Segura via Supabase Client com o Token do Utilizador
  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return {
      statusCode: 500,
      headers: jsonHeaders,
      body: JSON.stringify({ error: 'Configuração do Supabase ausente no servidor.' }),
    };
  }

  // Usar o token Bearer do utilizador para que o contexto auth.uid() seja propagado à base de dados
  const token = event.headers.authorization!.replace('Bearer ', '').trim();
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  });

  try {
    const { data, error } = await supabase.rpc('submit_session_and_record_first_attempt', {
      p_session_id: session_id.trim(),
      p_answers: sanitizedAnswers,
    });

    if (error) {
      const msg = error.message || '';
      if (msg.includes('Violação de Isolamento')) {
        return {
          statusCode: 403,
          headers: jsonHeaders,
          body: JSON.stringify({ error: msg, code: 'CROSS_TENANT_DENIED' }),
        };
      }
      if (msg.includes('Sessão já concluída')) {
        return {
          statusCode: 409,
          headers: jsonHeaders,
          body: JSON.stringify({ error: msg, code: 'ALREADY_COMPLETED' }),
        };
      }
      if (msg.includes('Violação de Integridade') || msg.includes('inexistente')) {
        return {
          statusCode: 400,
          headers: jsonHeaders,
          body: JSON.stringify({ error: msg, code: 'INTEGRITY_VIOLATION' }),
        };
      }

      return {
        statusCode: 500,
        headers: jsonHeaders,
        body: JSON.stringify({ error: `Erro na correção server-side: ${msg}`, code: 'EVALUATION_ERROR' }),
      };
    }

    return {
      statusCode: 200,
      headers: jsonHeaders,
      body: JSON.stringify({
        success: true,
        session_id: data?.session_id,
        subject_id: data?.subject_id,
        title: data?.title,
        status: data?.status,
        total_score: data?.total_score,
        max_score: data?.max_score,
        score_scale_20: data?.score_scale_20,
        correct_count: data?.correct_count,
        incorrect_count: data?.incorrect_count,
        pending_count: data?.pending_count,
        exercises: data?.exercises,
      }),
    };
  } catch (err: any) {
    return {
      statusCode: 500,
      headers: jsonHeaders,
      body: JSON.stringify({
        error: err.message || 'Erro inesperado ao processar a submissão dos exercícios.',
      }),
    };
  }
};
