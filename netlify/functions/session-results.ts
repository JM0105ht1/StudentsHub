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
    const { data, error } = await supabase.rpc('get_session_results_for_student', {
      p_session_id: sessionId.trim(),
    });

    if (error) {
      const msg = error.message || '';
      if (msg.includes('Violação de Isolamento') || msg.includes('permissão')) {
        return {
          statusCode: 403,
          headers: jsonHeaders,
          body: JSON.stringify({ error: msg, code: 'CROSS_TENANT_DENIED' }),
        };
      }
      if (msg.includes('Acesso Antecipado Bloqueado')) {
        return {
          statusCode: 403,
          headers: jsonHeaders,
          body: JSON.stringify({ error: msg, code: 'EARLY_ACCESS_BLOCKED' }),
        };
      }
      if (msg.includes('inexistente')) {
        return {
          statusCode: 404,
          headers: jsonHeaders,
          body: JSON.stringify({ error: msg, code: 'SESSION_NOT_FOUND' }),
        };
      }
      return {
        statusCode: 500,
        headers: jsonHeaders,
        body: JSON.stringify({ error: msg, code: 'SERVER_ERROR' }),
      };
    }

    return {
      statusCode: 200,
      headers: jsonHeaders,
      body: JSON.stringify({
        success: true,
        ...data,
      }),
    };
  } catch (err: any) {
    return {
      statusCode: 500,
      headers: jsonHeaders,
      body: JSON.stringify({ error: err.message || 'Erro ao consultar resultados da sessão.' }),
    };
  }
};
