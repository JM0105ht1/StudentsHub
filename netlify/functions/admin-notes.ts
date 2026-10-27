import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { authenticateRequest } from './auth-check';
import {
  validateAndSanitizeOfficialHtml,
  ALLOWED_SUBJECT_IDS,
  ALLOWED_PERIODS,
  MAX_HTML_SIZE_BYTES
} from '../../src/lib/htmlSanitizer';

// Rate Limiter em memória para proteção contra abuso de endpoints de upload
interface RateLimitBucket {
  count: number;
  resetAt: number;
}
const rateLimitMap = new Map<string, RateLimitBucket>();

function checkRateLimit(key: string, maxRequests = 40, windowMs = 60_000): { allowed: boolean; remaining: number } {
  const now = Date.now();
  const bucket = rateLimitMap.get(key);

  if (!bucket || bucket.resetAt <= now) {
    rateLimitMap.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: maxRequests - 1 };
  }

  if (bucket.count >= maxRequests) {
    return { allowed: false, remaining: 0 };
  }

  bucket.count += 1;
  return { allowed: true, remaining: maxRequests - bucket.count };
}

export const handler: Handler = async (event) => {
  // Configuração padrão de cabeçalhos JSON e CORS
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Método não permitido. Utilize POST.' }),
    };
  }

  // 1. Autenticação e Autorização Server-Side Estrita
  const auth = await authenticateRequest(event.headers.authorization);
  if (!auth.authenticated || !auth.userId) {
    return {
      statusCode: 401,
      headers,
      body: JSON.stringify({ error: auth.error || 'Sessão não autorizada ou expirada.' }),
    };
  }

  // 2. Verificação de Perfil de Administrador (Garantia Absoluta)
  if (auth.role !== 'admin') {
    return {
      statusCode: 403,
      headers,
      body: JSON.stringify({
        error: 'Acesso Negado: A gestão de apontamentos oficiais da Turma C é restrita a administradores.',
      }),
    };
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  const rawToken = (event.headers.authorization || '').replace('Bearer ', '').trim();
  const supabase = (supabaseUrl && supabaseKey)
    ? createClient(supabaseUrl, supabaseKey, {
        global: { headers: rawToken ? { Authorization: `Bearer ${rawToken}` } : {} },
      })
    : null;

  // 3. Rate Limiting Distribuído e Persistente (Supabase / PostgreSQL)
  // Identifica o admin exclusivamente via auth.userId validado pelo servidor
  if (supabase) {
    const { data: rateData, error: rateErr } = await supabase.rpc('check_and_consume_admin_rate_limit', {
      p_max_requests: 40,
      p_window_seconds: 60,
    });

    if (rateErr) {
      console.error('Falha no rate limiting distribuído:', rateErr.message);
      if (rateErr.message?.includes('Acesso Negado') || rateErr.message?.includes('não é administrador')) {
        return {
          statusCode: 403,
          headers,
          body: JSON.stringify({ error: 'Acesso Negado: Apenas administradores podem executar esta operação.' }),
        };
      }
      if (rateErr.message?.includes('Não autenticado')) {
        return {
          statusCode: 401,
          headers,
          body: JSON.stringify({ error: 'Sessão inválida ou não autenticada.' }),
        };
      }
      // Decisão segura e explícita (Fail-Closed): Não permitir mutações administrativas sem rate limiting ativo
      return {
        statusCode: 503,
        headers: { ...headers, 'Retry-After': '30' },
        body: JSON.stringify({
          error: 'Serviço de validação de taxa temporariamente indisponível. Operação administrativa abortada por segurança.',
        }),
      };
    } else if (rateData && !rateData.allowed) {
      const retrySecs = rateData.retry_after || 60;
      return {
        statusCode: 429,
        headers: { ...headers, 'Retry-After': String(retrySecs) },
        body: JSON.stringify({
          error: `Limite de operações administrativas excedido (${rateData.current_count}/${rateData.limit}). Aguarde ${retrySecs} segundos.`,
          retry_after: retrySecs,
        }),
      };
    }
  } else {
    // Fallback em ambiente de teste desacoplado de base de dados real
    const rateKey = `admin_${auth.userId}`;
    const rateStatus = checkRateLimit(rateKey, 40, 60_000);
    if (!rateStatus.allowed) {
      return {
        statusCode: 429,
        headers: { ...headers, 'Retry-After': '60' },
        body: JSON.stringify({ error: 'Limite de pedidos excedido. Por favor aguarde um minuto.' }),
      };
    }
  }

  // 4. Parse do Payload
  let body: any;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ error: 'Corpo da requisição não é um JSON válido.' }),
    };
  }

  const { action } = body;

  try {
    switch (action) {
      // PREVIEW DE SANITIZAÇÃO (Sem persistir no banco)
      case 'preview_sanitized': {
        const { raw_html } = body;
        if (!raw_html || typeof raw_html !== 'string') {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'Conteúdo raw_html em falta.' }),
          };
        }

        const validation = validateAndSanitizeOfficialHtml(raw_html);
        if (!validation.valid) {
          return {
            statusCode: 422,
            headers,
            body: JSON.stringify({ error: validation.error }),
          };
        }

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            sanitized_html: validation.sanitizedHtml,
            plain_text: validation.plainText,
            raw_size: validation.rawSize,
            sanitized_size: validation.sanitizedSize,
          }),
        };
      }

      // UPLOAD DE NOVO APONTAMENTO (Versão 1 em Draft)
      case 'upload_new_note': {
        const { subject_id, academic_period, theme, title, raw_html, change_summary } = body;

        // Validações dos metadados curriculares
        if (!ALLOWED_SUBJECT_IDS.includes(subject_id)) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({
              error: `Disciplina inválida (${subject_id}). Deve ser uma das 6 disciplinas oficiais da Turma C.`,
            }),
          };
        }

        if (!ALLOWED_PERIODS.includes(academic_period)) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'Período letivo inválido. Valores aceites: P1, P2 ou P3.' }),
          };
        }

        if (!theme || typeof theme !== 'string' || theme.trim().length === 0) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'O tema do apontamento é obrigatório.' }),
          };
        }

        if (!title || typeof title !== 'string' || title.trim().length === 0) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'O título do apontamento é obrigatório.' }),
          };
        }

        // Sanitização e validação de HTML
        const validation = validateAndSanitizeOfficialHtml(raw_html);
        if (!validation.valid) {
          return {
            statusCode: 422,
            headers,
            body: JSON.stringify({ error: validation.error }),
          };
        }

        if (!supabase) {
          // Fallback mock para ambiente de teste sem supabase online
          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
              success: true,
              note_id: `mock-note-${Date.now()}`,
              version_id: `mock-ver-1`,
              version_number: 1,
              is_published: false,
              message: 'Apontamento oficial criado como rascunho (mock).',
            }),
          };
        }

        // Executar RPC atómica no PostgreSQL
        const { data: rpcData, error: rpcError } = await supabase.rpc('create_official_note_atomic', {
          p_subject_id: subject_id,
          p_academic_period: academic_period,
          p_theme: theme.trim(),
          p_title: title.trim(),
          p_raw_html: raw_html,
          p_sanitized_html: validation.sanitizedHtml,
          p_plain_text: validation.plainText,
          p_change_summary: change_summary ? String(change_summary).trim() : 'Versão inicial homologada.',
        });

        if (rpcError) {
          return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: `Erro na base de dados: ${rpcError.message}` }),
          };
        }

        return {
          statusCode: 201,
          headers,
          body: JSON.stringify({
            success: true,
            note: rpcData,
            message: 'Apontamento oficial criado com sucesso no estado de rascunho.',
          }),
        };
      }

      // UPLOAD DE NOVA VERSÃO (v2, v3... em Draft)
      case 'upload_new_version': {
        const { note_id, raw_html, change_summary } = body;

        if (!note_id || typeof note_id !== 'string') {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'Identificador do apontamento (note_id) em falta.' }),
          };
        }

        const validation = validateAndSanitizeOfficialHtml(raw_html);
        if (!validation.valid) {
          return {
            statusCode: 422,
            headers,
            body: JSON.stringify({ error: validation.error }),
          };
        }

        if (!supabase) {
          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
              success: true,
              note_id,
              version_id: `mock-ver-${Date.now()}`,
              version_number: 2,
              is_published: false,
              message: 'Nova versão criada em rascunho (mock).',
            }),
          };
        }

        const { data: rpcData, error: rpcError } = await supabase.rpc('create_official_note_version_atomic', {
          p_note_id: note_id,
          p_raw_html: raw_html,
          p_sanitized_html: validation.sanitizedHtml,
          p_plain_text: validation.plainText,
          p_change_summary: change_summary ? String(change_summary).trim() : 'Nova revisão.',
        });

        if (rpcError) {
          return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: `Erro ao criar nova versão: ${rpcError.message}` }),
          };
        }

        return {
          statusCode: 201,
          headers,
          body: JSON.stringify({
            success: true,
            version: rpcData,
            message: 'Nova versão de apontamento criada com sucesso em estado de rascunho.',
          }),
        };
      }

      // PUBLICAR VERSÃO
      case 'publish_version': {
        const { version_id } = body;
        if (!version_id || typeof version_id !== 'string') {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'Identificador da versão (version_id) em falta.' }),
          };
        }

        if (!supabase) {
          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
              success: true,
              version_id,
              is_published: true,
              message: 'Versão publicada com sucesso (mock).',
            }),
          };
        }

        const { data: rpcData, error: rpcError } = await supabase.rpc('publish_official_note_version_atomic', {
          p_version_id: version_id,
        });

        if (rpcError) {
          return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: `Erro ao publicar versão: ${rpcError.message}` }),
          };
        }

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            result: rpcData,
            message: 'Versão oficial publicada com sucesso.',
          }),
        };
      }

      // DESPUBLICAR APONTAMENTO
      case 'unpublish_note': {
        const { note_id } = body;
        if (!note_id || typeof note_id !== 'string') {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'Identificador do apontamento (note_id) em falta.' }),
          };
        }

        if (!supabase) {
          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
              success: true,
              note_id,
              is_published: false,
              message: 'Apontamento despublicado com sucesso (mock).',
            }),
          };
        }

        const { data: rpcData, error: rpcError } = await supabase.rpc('unpublish_official_note_atomic', {
          p_note_id: note_id,
        });

        if (rpcError) {
          return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: `Erro ao despublicar apontamento: ${rpcError.message}` }),
          };
        }

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            result: rpcData,
            message: 'Apontamento oficial despublicado com sucesso.',
          }),
        };
      }

      // APAGAR APONTAMENTO (e todas as suas versões)
      case 'delete_note': {
        const { note_id } = body;
        if (!note_id || typeof note_id !== 'string') {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'Identificador do apontamento (note_id) em falta.' }),
          };
        }

        if (!supabase) {
          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ success: true, note_id, message: 'Apontamento apagado com sucesso (mock).' }),
          };
        }

        // Um apontamento publicado é despublicado primeiro, para o apagar de forma limpa
        const { data: noteRow } = await supabase
          .from('official_notes')
          .select('id, is_published')
          .eq('id', note_id)
          .maybeSingle();

        if (!noteRow) {
          return {
            statusCode: 404,
            headers,
            body: JSON.stringify({ error: 'Apontamento não encontrado.' }),
          };
        }

        if (noteRow.is_published) {
          await supabase.rpc('unpublish_official_note_atomic', { p_note_id: note_id });
        }

        const { data: deleted, error: deleteError } = await supabase
          .from('official_notes')
          .delete()
          .eq('id', note_id)
          .select('id');

        if (deleteError) {
          const msg = deleteError.message || '';
          if (msg.includes('Rastreabilidade') || msg.toLowerCase().includes('referenc')) {
            return {
              statusCode: 409,
              headers,
              body: JSON.stringify({
                error:
                  'Este apontamento tem exercícios associados e não pode ser apagado. Podes despublicá-lo para deixar de aparecer aos alunos.',
              }),
            };
          }
          return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: `Erro ao apagar apontamento: ${msg}` }),
          };
        }

        if (!deleted || deleted.length === 0) {
          return {
            statusCode: 403,
            headers,
            body: JSON.stringify({ error: 'Não foi possível apagar o apontamento (sem permissões ou já apagado).' }),
          };
        }

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ success: true, note_id, message: 'Apontamento apagado com sucesso.' }),
        };
      }

      // REATIVAR VERSÃO HISTÓRICA
      case 'reactivate_version': {
        const { note_id, version_id, reason } = body;
        if (!note_id || !version_id) {
          return {
            statusCode: 400,
            headers,
            body: JSON.stringify({ error: 'Campos note_id e version_id são obrigatórios.' }),
          };
        }

        if (!supabase) {
          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
              success: true,
              message: 'Versão histórica reativada com sucesso (mock).',
            }),
          };
        }

        const { data: rpcData, error: rpcError } = await supabase.rpc(
          'reactivate_historical_official_note_version_atomic',
          {
            p_note_id: note_id,
            p_version_id: version_id,
            p_reason: reason || 'Reativação formal de versão histórica homologada.',
          }
        );

        if (rpcError) {
          return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: `Erro ao reativar versão histórica: ${rpcError.message}` }),
          };
        }

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            result: rpcData,
            message: 'Versão histórica reativada com sucesso.',
          }),
        };
      }

      // LISTAR REGISTOS DE AUDITORIA DE APONTAMENTOS
      case 'get_audit_logs': {
        if (!supabase) {
          return { statusCode: 200, headers, body: JSON.stringify({ logs: [] }) };
        }

        const { data: logs, error: logsError } = await supabase
          .from('official_note_audit_logs')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(50);

        if (logsError) {
          return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: logsError.message }),
          };
        }

        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({ logs }),
        };
      }

      default:
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: `Ação não reconhecida: ${action}` }),
        };
    }
  } catch (err: any) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Ocorreu um erro interno no processamento do apontamento oficial.',
      }),
    };
  }
};
