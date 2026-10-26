import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { authenticateRequest } from './auth-check';

const jsonHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: jsonHeaders,
      body: JSON.stringify({ error: 'Método não permitido. Utilize POST.' }),
    };
  }

  // 1. Autenticação e Autorização Server-Side Estrita
  const auth = await authenticateRequest(event.headers.authorization);
  if (!auth.authenticated || !auth.userId) {
    return {
      statusCode: 401,
      headers: jsonHeaders,
      body: JSON.stringify({ error: auth.error || 'Sessão não autorizada.' }),
    };
  }

  if (auth.role !== 'admin') {
    return {
      statusCode: 403,
      headers: jsonHeaders,
      body: JSON.stringify({
        error: 'Acesso reservado a administradores para revisão de exercícios oficiais.',
        code: 'FORBIDDEN_ADMIN_ONLY',
      }),
    };
  }

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

  const { action, exercise_id, payload } = body;

  // Cliente com o TOKEN DO ADMINISTRADOR (anon key + Authorization): RLS, triggers e is_admin() aplicam-se.
  // Sem service role e sem fallback entre chaves.
  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return {
      statusCode: 500,
      headers: jsonHeaders,
      body: JSON.stringify({ error: 'Configuração da base de dados ausente no servidor.' }),
    };
  }

  const adminToken = (event.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${adminToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // AÇÃO 1: Listar Exercícios (com filtro de status e disciplina)
  if (action === 'list_exercises') {
    const { subject_id, status = 'draft', note_id } = payload || {};

    let query = supabase
      .from('exercises')
      .select(`
        id,
        prompt,
        question_type,
        options,
        correct_answer,
        scoring_rubric,
        max_points,
        difficulty,
        status,
        subject_id,
        academic_period,
        created_at,
        exercise_source_references (
          official_note_id,
          official_version_id,
          quote_excerpt,
          official_section,
          content_hash
        )
      `)
      .eq('is_official', true)
      .order('created_at', { ascending: false });

    if (status && status !== 'all') {
      query = query.eq('status', status);
    }
    if (subject_id) {
      query = query.eq('subject_id', subject_id);
    }

    const { data: exercises, error: listErr } = await query;

    if (listErr) {
      return {
        statusCode: 500,
        headers: jsonHeaders,
        body: JSON.stringify({ error: 'Erro ao listar exercícios.' }),
      };
    }

    return {
      statusCode: 200,
      headers: jsonHeaders,
      body: JSON.stringify({ success: true, exercises: exercises || [] }),
    };
  }

  // AÇÃO 2: Atualizar / Editar Exercício em Rascunho
  if (action === 'update_exercise') {
    if (!exercise_id || !UUID_REGEX.test(exercise_id)) {
      return {
        statusCode: 400,
        headers: jsonHeaders,
        body: JSON.stringify({ error: 'Identificador de exercício inválido.' }),
      };
    }

    const {
      prompt,
      options,
      correct_answer,
      scoring_rubric,
      max_points,
      difficulty,
    } = payload || {};

    const updateFields: Record<string, any> = {};

    if (prompt && typeof prompt === 'string' && prompt.trim().length > 5) {
      updateFields.prompt = prompt.trim();
    }
    if (correct_answer && typeof correct_answer === 'string' && correct_answer.trim().length > 0) {
      updateFields.correct_answer = correct_answer.trim();
    }
    if (Array.isArray(options)) {
      const cleaned = options.map((o: any) => String(o ?? '').trim()).filter((o: string) => o.length > 0);
      if (cleaned.length < 2 || new Set(cleaned.map((o: string) => o.toLowerCase())).size !== cleaned.length) {
        return {
          statusCode: 400,
          headers: jsonHeaders,
          body: JSON.stringify({ error: 'As opções devem ser pelo menos 2 e distintas entre si.' }),
        };
      }
      updateFields.options = cleaned; // jsonb nativo: nunca JSON.stringify
    }
    if (scoring_rubric && typeof scoring_rubric === 'object') {
      updateFields.scoring_rubric = scoring_rubric;
    }
    if (typeof max_points === 'number' && max_points > 0) {
      updateFields.max_points = max_points;
    }
    if (['facil', 'medio', 'dificil'].includes(difficulty)) {
      updateFields.difficulty = difficulty;
    }

    if (Object.keys(updateFields).length === 0) {
      return {
        statusCode: 400,
        headers: jsonHeaders,
        body: JSON.stringify({ error: 'Nenhum campo válido para atualização fornecido.' }),
      };
    }

    // Edição apenas em rascunho: publicados/arquivados são imutáveis (resultados e exames dependem deles)
    const { data: updated, error: updateErr } = await supabase
      .from('exercises')
      .update(updateFields)
      .eq('id', exercise_id)
      .eq('is_official', true)
      .eq('status', 'draft')
      .select()
      .maybeSingle();

    if (!updateErr && !updated) {
      return {
        statusCode: 409,
        headers: jsonHeaders,
        body: JSON.stringify({
          error: 'Só é possível editar exercícios oficiais em rascunho. Arquive o exercício e gere outro.',
          code: 'NOT_EDITABLE',
        }),
      };
    }

    if (updateErr) {
      return {
        statusCode: 500,
        headers: jsonHeaders,
        body: JSON.stringify({ error: 'Erro ao atualizar exercício.' }),
      };
    }

    return {
      statusCode: 200,
      headers: jsonHeaders,
      body: JSON.stringify({ success: true, exercise: updated }),
    };
  }

  // AÇÃO 3: Publicar Exercício (Homologação Humana)
  if (action === 'publish_exercise') {
    if (!exercise_id || !UUID_REGEX.test(exercise_id)) {
      return {
        statusCode: 400,
        headers: jsonHeaders,
        body: JSON.stringify({ error: 'Identificador de exercício inválido.' }),
      };
    }

    // Verifica se possui proveniência oficial antes de publicar
    const { data: srcRef } = await supabase
      .from('exercise_source_references')
      .select('official_note_id, official_version_id')
      .eq('exercise_id', exercise_id)
      .eq('source_type', 'official')
      .limit(1)
      .maybeSingle();

    if (!srcRef || !srcRef.official_note_id || !srcRef.official_version_id) {
      return {
        statusCode: 400,
        headers: jsonHeaders,
        body: JSON.stringify({
          error: 'Não é possível publicar: O exercício não possui proveniência oficial devidamente referenciada.',
        }),
      };
    }

    const { data: published, error: pubErr } = await supabase
      .from('exercises')
      .update({ status: 'published' })
      .eq('id', exercise_id)
      .eq('is_official', true)
      .eq('status', 'draft')
      .select()
      .maybeSingle();

    if (pubErr || !published) {
      return {
        statusCode: pubErr ? 500 : 409,
        headers: jsonHeaders,
        body: JSON.stringify({
          error: pubErr
            ? 'Erro ao publicar exercício.'
            : 'Só é possível publicar exercícios oficiais que estejam em rascunho.',
          code: pubErr ? 'PUBLISH_ERROR' : 'NOT_PUBLISHABLE',
        }),
      };
    }

    return {
      statusCode: 200,
      headers: jsonHeaders,
      body: JSON.stringify({
        success: true,
        message: 'Exercício oficial homologado e publicado com sucesso para a Turma C.',
        exercise: published,
      }),
    };
  }

  // AÇÃO 4: Arquivar Exercício (Soft Archiving)
  if (action === 'archive_exercise') {
    if (!exercise_id || !UUID_REGEX.test(exercise_id)) {
      return {
        statusCode: 400,
        headers: jsonHeaders,
        body: JSON.stringify({ error: 'Identificador de exercício inválido.' }),
      };
    }

    const { data: archived, error: archErr } = await supabase
      .from('exercises')
      .update({ status: 'archived' })
      .eq('id', exercise_id)
      .eq('is_official', true)
      .select()
      .maybeSingle();

    if (archErr || !archived) {
      return {
        statusCode: archErr ? 500 : 404,
        headers: jsonHeaders,
        body: JSON.stringify({ error: archErr ? 'Erro ao arquivar exercício.' : 'Exercício oficial não encontrado.' }),
      };
    }

    return {
      statusCode: 200,
      headers: jsonHeaders,
      body: JSON.stringify({
        success: true,
        message: 'Exercício arquivado com sucesso (soft archiving).',
        exercise: archived,
      }),
    };
  }

  return {
    statusCode: 400,
    headers: jsonHeaders,
    body: JSON.stringify({ error: `Ação desconhecida: "${action}".` }),
  };
};
