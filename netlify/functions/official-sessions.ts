import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { authenticateRequest } from './auth-check';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const jsonHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
const PERIODS = ['P1', 'P2', 'P3'];
const TYPES = ['multiple_choice', 'open_answer', 'calculation', 'true_false', 'mixed'];
const DIFFICULTIES = ['facil', 'medio', 'dificil', 'mixed'];
const COUNT_TYPES = ['multiple_choice', 'true_false', 'open_answer', 'calculation'];
const MAX_EXERCISES = 20;

const reply = (statusCode: number, body: unknown) => ({ statusCode, headers: jsonHeaders, body: JSON.stringify(body) });

/**
 * Sessões de avaliações oficiais (alunos autenticados).
 *  GET  ?subject_id=...            -> lista exames e conjuntos oficiais PUBLICADOS (RLS)
 *  POST {action:'start_assessment'} -> inicia/retoma sessão de exame ou conjunto
 *  POST {action:'start_practice'}   -> inicia sessão de treino com exercícios oficiais publicados
 * Todas as escritas passam por RPCs transacionais; o cliente nunca envia notas nem gabaritos.
 */
export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') {
    return reply(405, { error: 'Método não permitido.' });
  }

  const auth = await authenticateRequest(event.headers.authorization);
  if (!auth.authenticated || !auth.userId) {
    return reply(401, { error: auth.error || 'Sessão não autorizada.' });
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    return reply(500, { error: 'Configuração da base de dados ausente no servidor.' });
  }

  const token = (event.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    if (event.httpMethod === 'GET') {
      const subjectId = event.queryStringParameters?.subject_id;
      let q = supabase
        .from('official_assessments')
        .select('id, assessment_type, subject_id, title, total_points')
        .eq('is_published', true)
        .order('assessment_type', { ascending: true })
        .order('title', { ascending: true })
        .limit(100);
      if (subjectId) q = q.eq('subject_id', subjectId);
      const { data: assessments, error } = await q;
      if (error) return reply(500, { error: 'Erro ao listar avaliações oficiais.' });

      // Primeira tentativa já registada (histórico do próprio aluno, por RLS)
      const { data: attempts } = await supabase
        .from('official_first_attempts')
        .select('assessment_id, assessment_type, score_percentage, score_scale_20, completed_at')
        .eq('user_id', auth.userId);

      const byKey = new Map((attempts || []).map((a: any) => [`${a.assessment_type}:${a.assessment_id}`, a]));
      return reply(200, {
        assessments: (assessments || []).map((a: any) => ({
          ...a,
          first_attempt: byKey.get(`${a.assessment_type}:${a.id}`) || null,
        })),
      });
    }

    let body: any;
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return reply(400, { error: 'Corpo do pedido inválido.' });
    }

    if (body.action === 'start_assessment') {
      const type = body.assessment_type;
      const id = typeof body.assessment_id === 'string' ? body.assessment_id.trim() : '';
      if (!['exam', 'exercise_set'].includes(type) || !UUID_REGEX.test(id)) {
        return reply(400, { error: 'Avaliação inválida.' });
      }
      const { data, error } = await supabase.rpc('start_official_assessment_session', {
        p_assessment_type: type,
        p_assessment_id: id,
      });
      if (error) {
        console.error('start_official_assessment_session:', error.message);
        return reply(422, { error: 'Não foi possível iniciar esta avaliação oficial.', code: 'START_REJECTED' });
      }
      return reply(200, { success: true, ...data });
    }

    if (body.action === 'start_practice') {
      const count = Math.min(MAX_EXERCISES, Math.max(1, parseInt(String(body.count ?? 5), 10) || 5));

      // Quantidade por tipo de pergunta (ex.: { multiple_choice: 5, true_false: 3 })
      let typeCounts: Record<string, number> | null = null;
      if (body.type_counts && typeof body.type_counts === 'object' && !Array.isArray(body.type_counts)) {
        const cleaned: Record<string, number> = {};
        let total = 0;
        for (const key of COUNT_TYPES) {
          const n = Math.min(MAX_EXERCISES, Math.max(0, parseInt(String(body.type_counts[key] ?? 0), 10) || 0));
          if (n > 0) {
            cleaned[key] = n;
            total += n;
          }
        }
        if (total < 1 || total > MAX_EXERCISES) {
          return reply(400, { error: `Escolhe entre 1 e ${MAX_EXERCISES} exercícios no total.` });
        }
        typeCounts = cleaned;
      }
      const subject = typeof body.subject_id === 'string' ? body.subject_id.trim() : '';
      const period = PERIODS.includes(body.academic_period) ? body.academic_period : null;
      const qType = TYPES.includes(body.question_type) ? body.question_type : null;
      const diff = DIFFICULTIES.includes(body.difficulty) ? body.difficulty : null;
      if (!subject) return reply(400, { error: 'Disciplina em falta.' });

      const { data, error } = await supabase.rpc('start_official_practice_session', {
        p_subject_id: subject,
        p_academic_period: period,
        p_count: count,
        p_question_type: qType,
        p_difficulty: diff,
        ...(typeCounts ? { p_type_counts: typeCounts } : {}),
      });
      if (error) {
        const none = (error.message || '').includes('Sem exercícios oficiais');
        return reply(none ? 200 : 422, {
          success: false,
          code: none ? 'NO_PUBLISHED_EXERCISES' : 'START_REJECTED',
          message: none
            ? 'Ainda não existem exercícios oficiais publicados para estes filtros nos apontamentos oficiais.'
            : 'Não foi possível iniciar o treino.',
        });
      }
      return reply(200, { success: true, ...data });
    }

    return reply(400, { error: 'Ação inválida.' });
  } catch (err) {
    console.error('official-sessions:', (err as Error)?.message);
    return reply(500, { error: 'Erro interno ao processar o pedido.' });
  }
};
