import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { authenticateRequest } from './auth-check';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const jsonHeaders: Record<string, string> = { 'Content-Type': 'application/json' };

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers: jsonHeaders,
      body: JSON.stringify({ error: 'Método não permitido. Utilize GET.' }),
    };
  }

  // 1. Autenticação Server-Side Estrita
  const auth = await authenticateRequest(event.headers.authorization);
  if (!auth.authenticated || !auth.userId) {
    return {
      statusCode: 401,
      headers: jsonHeaders,
      body: JSON.stringify({ error: auth.error || 'Sessão não autorizada.' }),
    };
  }

  const sessionId = event.queryStringParameters?.session_id;
  if (!sessionId || !UUID_REGEX.test(sessionId.trim())) {
    return {
      statusCode: 400,
      headers: jsonHeaders,
      body: JSON.stringify({ error: 'Identificador de sessão ("session_id") em falta ou inválido.' }),
    };
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return {
      statusCode: 500,
      headers: jsonHeaders,
      body: JSON.stringify({ error: 'Configuração do Supabase ausente no servidor.' }),
    };
  }

  const token = event.headers.authorization!.replace('Bearer ', '').trim();
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  });

  try {
    const { data, error } = await supabase.rpc('get_session_questions_for_student', {
      p_session_id: sessionId.trim(),
    });

    if (error) {
      return {
        statusCode: 500,
        headers: jsonHeaders,
        body: JSON.stringify({ error: error.message || 'Erro ao carregar questões da sessão.' }),
      };
    }

    // Sanitizar explicitamente para garantia extra (nunca expor gabarito)
    const sanitizedQuestions = (data || []).map((q: any) => ({
      id: q.id,
      session_id: q.session_id,
      subject_id: q.subject_id,
      prompt: q.prompt,
      question_type: q.question_type,
      options: q.options,
      max_points: q.max_points,
      source_note_ref: q.source_note_ref,
    }));

    return {
      statusCode: 200,
      headers: jsonHeaders,
      body: JSON.stringify({
        success: true,
        session_id: sessionId.trim(),
        questions: sanitizedQuestions,
      }),
    };
  } catch (err: any) {
    return {
      statusCode: 500,
      headers: jsonHeaders,
      body: JSON.stringify({ error: err.message || 'Erro inesperado ao obter perguntas.' }),
    };
  }
};
