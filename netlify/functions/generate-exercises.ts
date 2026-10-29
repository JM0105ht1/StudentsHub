import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import * as crypto from 'crypto';
import { authenticateRequest, isTestBypassAllowed } from './auth-check';
import { getGeminiConfig } from './gemini-config';
import {
  OFFICIAL_EXERCISE_SYSTEM_INSTRUCTION,
  validateOfficialExerciseBatch,
  OfficialNoteGroundedContext,
} from './exercise-schema';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const jsonHeaders: Record<string, string> = { 'Content-Type': 'application/json' };

const VALID_QUESTION_TYPES = [
  'multiple_choice',
  'true_false',
  'open_answer',
  'calculation',
  'mixed',
];

const VALID_DIFFICULTIES = ['facil', 'medio', 'dificil', 'mixed', 'easy', 'medium', 'hard'];

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: jsonHeaders,
      body: JSON.stringify({ error: 'Método não permitido. Utilize POST.' }),
    };
  }

  // 1. Autenticação e Autorização Segura no Servidor
  // Fonte de Confiança Autorizada: auth-check valida token com Supabase auth e consulta user_roles no servidor
  const auth = await authenticateRequest(event.headers.authorization);
  if (!auth.authenticated || !auth.userId) {
    return {
      statusCode: 401,
      headers: jsonHeaders,
      body: JSON.stringify({ error: auth.error || 'Sessão não autorizada.' }),
    };
  }

  // REGRA DA FASE C: Apenas Administradores Autenticados podem gerar novos exercícios oficiais
  if (auth.role !== 'admin') {
    return {
      statusCode: 403,
      headers: jsonHeaders,
      body: JSON.stringify({
        error: 'Acesso reservado a administradores. Apenas curadores podem gerar exercícios oficiais para o Caderno da Turma C.',
        code: 'FORBIDDEN_ADMIN_ONLY',
      }),
    };
  }
  const verifiedAdminId = auth.userId;

  // 2. Leitura e Validação do Payload
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

  const {
    note_id,
    version_id,
    count: requestedCount = 5,
    question_type: requestedType = 'mixed',
    difficulty = 'medio',
    type_counts,
  } = body;

  // Validação do UUID do Apontamento Oficial
  if (!note_id || typeof note_id !== 'string' || !UUID_REGEX.test(note_id.trim())) {
    return {
      statusCode: 400,
      headers: jsonHeaders,
      body: JSON.stringify({ error: 'Identificador de apontamento oficial (note_id) inválido ou em falta.' }),
    };
  }
  const cleanNoteId = note_id.trim();

  // Validação opcional do UUID da Versão
  let cleanVersionId: string | null = null;
  if (version_id) {
    if (typeof version_id !== 'string' || !UUID_REGEX.test(version_id.trim())) {
      return {
        statusCode: 400,
        headers: jsonHeaders,
        body: JSON.stringify({ error: 'Identificador de versão oficial (version_id) inválido.' }),
      };
    }
    cleanVersionId = version_id.trim();
  }

  // Plano de geração: quantidade por tipo (type_counts) ou, em alternativa, quantidade + tipologia única
  const MAX_EXERCISES = 20;
  const COUNT_TYPES = ['multiple_choice', 'true_false', 'open_answer', 'calculation'];
  const plan: { type: string; n: number }[] = [];

  if (type_counts && typeof type_counts === 'object' && !Array.isArray(type_counts)) {
    for (const key of COUNT_TYPES) {
      const n = parseInt(String((type_counts as any)[key] ?? 0), 10) || 0;
      if (n < 0 || n > MAX_EXERCISES) {
        return {
          statusCode: 400,
          headers: jsonHeaders,
          body: JSON.stringify({ error: `A quantidade por tipo deve estar entre 0 e ${MAX_EXERCISES}.` }),
        };
      }
      if (n > 0) plan.push({ type: key, n });
    }
  } else {
    if (typeof requestedCount !== 'number' || !Number.isInteger(requestedCount) || requestedCount < 1 || requestedCount > MAX_EXERCISES) {
      return {
        statusCode: 400,
        headers: jsonHeaders,
        body: JSON.stringify({ error: `A quantidade de exercícios deve ser um número inteiro entre 1 e ${MAX_EXERCISES}.` }),
      };
    }
    if (typeof requestedType !== 'string' || !VALID_QUESTION_TYPES.includes(requestedType.toLowerCase().trim())) {
      return {
        statusCode: 400,
        headers: jsonHeaders,
        body: JSON.stringify({ error: `Tipo de questão não suportado: "${requestedType}".` }),
      };
    }
    const t = requestedType.toLowerCase().trim();
    plan.push({ type: t === 'short_answer' || t === 'development' ? 'open_answer' : t, n: requestedCount });
  }

  const count = plan.reduce((acc, p) => acc + p.n, 0);
  if (count < 1 || count > MAX_EXERCISES) {
    return {
      statusCode: 400,
      headers: jsonHeaders,
      body: JSON.stringify({ error: `Escolhe entre 1 e ${MAX_EXERCISES} exercícios no total.` }),
    };
  }
  const question_type = plan.length === 1 ? plan[0].type : 'mixed';

  // Lotes pequenos (até 5 exercícios) pedidos ao Gemini em paralelo: muito mais rápido do que um pedido grande
  const CHUNK_SIZE = 5;
  const tasks: { type: string; n: number }[] = [];
  for (const item of plan) {
    let left = item.n;
    while (left > 0) {
      const n = Math.min(CHUNK_SIZE, left);
      tasks.push({ type: item.type, n });
      left -= n;
    }
  }

  // Validação de Dificuldade
  if (typeof difficulty !== 'string' || !VALID_DIFFICULTIES.includes(difficulty.toLowerCase().trim())) {
    return {
      statusCode: 400,
      headers: jsonHeaders,
      body: JSON.stringify({ error: `Nível de dificuldade não suportado: "${difficulty}".` }),
    };
  }

  // 3. Cliente Supabase com o TOKEN DO ADMINISTRADOR (anon key + Authorization do utilizador).
  // auth.uid() e is_admin() propagam-se à base de dados e as RLS/RPCs aplicam-se como defesa em profundidade.
  // NÃO se usa service role aqui: com a service role auth.uid() é nulo e is_admin() falharia.
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

  // 4. Rate Limiting de Operação Administrativa (FALHA FECHADA: custo Gemini protegido)
  const { data: rateData, error: rateErr } = await supabase.rpc('check_and_consume_admin_rate_limit', {
    p_window_seconds: 60,
    p_max_requests: 15,
  });

  if (rateErr) {
    console.error('Falha no rate limit administrativo:', rateErr.message);
    return {
      statusCode: 503,
      headers: jsonHeaders,
      body: JSON.stringify({
        error: 'Não foi possível verificar o limite de pedidos. Nenhuma chamada ao Gemini foi feita.',
        code: 'RATE_LIMIT_UNAVAILABLE',
      }),
    };
  }

  if (rateData && rateData.allowed === false) {
    return {
      statusCode: 429,
      headers: { ...jsonHeaders, 'Retry-After': String(rateData.retry_after || 60) },
      body: JSON.stringify({
        error: 'Limite de requisições de geração atingido. Por favor, aguarde alguns segundos.',
        code: 'RATE_LIMITED',
      }),
    };
  }

  // 5. Obtenção EXCLUSIVA dos Apontamentos Oficiais Homologados e Publicados
  // Valida que a nota existe e está publicada (is_published = true)
  const { data: noteRecord, error: noteErr } = await supabase
    .from('official_notes')
    .select('id, subject_id, academic_period, theme, title, is_published, current_version_id')
    .eq('id', cleanNoteId)
    .single();

  if (noteErr || !noteRecord) {
    return {
      statusCode: 404,
      headers: jsonHeaders,
      body: JSON.stringify({ error: 'Apontamento oficial não encontrado no Caderno da Turma C.' }),
    };
  }

  if (noteRecord.is_published !== true) {
    return {
      statusCode: 400,
      headers: jsonHeaders,
      body: JSON.stringify({
        error: 'Inconsistência de Estado: O apontamento selecionado está em rascunho. Apenas apontamentos oficiais publicados podem originar exercícios.',
        code: 'NOTE_NOT_PUBLISHED',
      }),
    };
  }

  // Resolver versão ativa homologada
  const targetVersionId = cleanVersionId || noteRecord.current_version_id;
  if (!targetVersionId) {
    return {
      statusCode: 400,
      headers: jsonHeaders,
      body: JSON.stringify({ error: 'O apontamento oficial não tem uma versão ativa homologada.' }),
    };
  }

  // Valida que a versão existe, pertence à nota e está homologada/publicada
  const { data: versionRecord, error: versionErr } = await supabase
    .from('official_note_versions')
    .select('id, note_id, version_number, plain_text_content, sanitized_html, is_published')
    .eq('id', targetVersionId)
    .eq('note_id', cleanNoteId)
    .single();

  if (versionErr || !versionRecord) {
    return {
      statusCode: 404,
      headers: jsonHeaders,
      body: JSON.stringify({ error: 'A versão especificada não pertence ao apontamento oficial ou não foi encontrada.' }),
    };
  }

  if (versionRecord.is_published !== true) {
    return {
      statusCode: 400,
      headers: jsonHeaders,
      body: JSON.stringify({
        error: 'Inconsistência de Versão: A versão indicada ainda está em rascunho. Apenas versões homologadas e publicadas podem ser fonte de exercícios.',
        code: 'VERSION_NOT_PUBLISHED',
      }),
    };
  }

  // Texto curricular oficial = plain_text_content EXATO da versão homologada.
  // (Sem fallback para HTML: a citação literal é validada na BD contra este mesmo texto.)
  const rawPlainText: string = versionRecord.plain_text_content || '';
  const officialContentText = rawPlainText.trim();

  if (officialContentText.length < 30) {
    return {
      statusCode: 200,
      headers: jsonHeaders,
      body: JSON.stringify({
        success: false,
        code: 'INSUFFICIENT_NOTES_CONTENT',
        message: 'O apontamento oficial selecionado não possui conteúdo textual suficiente para gerar exercícios.',
        exercises: [],
      }),
    };
  }

  // Limite de custo/latência: texto oficial demasiado grande não é enviado ao Gemini
  const MAX_NOTE_CHARS = process.env.GEMINI_MAX_NOTE_CHARS
    ? parseInt(process.env.GEMINI_MAX_NOTE_CHARS, 10)
    : 60_000;
  if (officialContentText.length > MAX_NOTE_CHARS) {
    return {
      statusCode: 413,
      headers: jsonHeaders,
      body: JSON.stringify({
        error: `O apontamento oficial excede o limite de ${MAX_NOTE_CHARS} caracteres para geração. Divida-o em temas menores.`,
        code: 'NOTE_TOO_LARGE',
      }),
    };
  }

  // SHA-256 do texto simples exato (a base de dados recalcula e confirma este valor)
  const contentHash = crypto.createHash('sha256').update(rawPlainText, 'utf8').digest('hex');

  const noteContext: OfficialNoteGroundedContext = {
    note_id: noteRecord.id,
    version_id: versionRecord.id,
    version_number: versionRecord.version_number,
    subject_id: noteRecord.subject_id,
    academic_period: noteRecord.academic_period as 'P1' | 'P2' | 'P3',
    theme: noteRecord.theme,
    title: noteRecord.title,
    content_text: officialContentText,
    content_hash: contentHash,
  };

  // 6. Chamada Segura ao Modelo Google Gemini
  let rawAiOutput: any;
  let failedChunks = 0;

  // Suporte de Mock determinístico para ambiente de testes automatizados
  if (isTestBypassAllowed() && (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === 'test-mock-gemini-key')) {
    // Extrai uma frase real do apontamento oficial para servir de citação literal comprovada
    const sampleSentences = officialContentText.split(/[.!?]\s+/).map((s: string) => s.trim()).filter((s: string) => s.length > 15);
    const validExcerpt = sampleSentences[0] || officialContentText.substring(0, 40);

    rawAiOutput = {
      insufficient_content: false,
      exercises: Array.from({ length: count }, (_, i) => ({
        prompt: `Com base no Caderno Oficial sobre "${noteRecord.theme}", seleciona a afirmação correta (Questão ${i + 1}):`,
        question_type: question_type === 'mixed' ? (i % 2 === 0 ? 'multiple_choice' : 'true_false') : question_type,
        options: question_type === 'true_false' || (question_type === 'mixed' && i % 2 !== 0)
          ? ['Verdadeiro', 'Falso']
          : [
              `Afirmação correta: ${validExcerpt}`,
              'Afirmação incorreta A sem fundamento no texto oficial',
              'Afirmação incorreta B contradizendo os apontamentos',
              'Afirmação incorreta C irrelevante para a matéria',
            ],
        correct_answer: question_type === 'true_false' || (question_type === 'mixed' && i % 2 !== 0)
          ? 'Verdadeiro'
          : `Afirmação correta: ${validExcerpt}`,
        scoring_rubric: {
          criteria: ['Demonstra compreensão estrita da matéria descrita no apontamento oficial.'],
          explanation: `A resposta decorre diretamente do excerto: "${validExcerpt}".`,
        },
        quote_excerpt: validExcerpt,
        difficulty: difficulty === 'mixed' ? 'medio' : difficulty,
        max_points: 20.0,
      })),
    };
  } else {
    // Chamada real ao Gemini no Servidor através do SDK Oficial @google/genai
    const geminiConfig = getGeminiConfig();
    const ai = new GoogleGenAI({ apiKey: geminiConfig.apiKey });

    // Máximo de 24 s por lote (as Netlify Functions terminam aos 26 s)
    const envTimeout = process.env.GEMINI_TIMEOUT_MS ? parseInt(process.env.GEMINI_TIMEOUT_MS, 10) : NaN;
    const GEMINI_TIMEOUT_MS = Math.min(Number.isFinite(envTimeout) && envTimeout > 0 ? envTimeout : 22_000, 24_000);

    const runChunk = async (task: { type: string; n: number }, index: number) => {
      const userPrompt = `
<<<METADATA_PEDIDO>>>
Disciplina: ${noteRecord.subject_id}
Período: ${noteRecord.academic_period}
Tema Oficial: ${noteRecord.theme}
Título do Apontamento: ${noteRecord.title}
Versão Homologada: v${versionRecord.version_number}
Tipologia Solicitada: ${task.type}
Dificuldade Pedida: ${difficulty}
Quantidade de Questões: ${task.n}
Lote ${index + 1} de ${tasks.length}: cobre aspetos diferentes do texto, sem repetir perguntas de outros lotes.
Hash de Integridade do Conteúdo: ${contentHash}
<<<END_METADATA>>>

<<<OFFICIAL_NOTE id="${noteRecord.id}" version="${versionRecord.version_number}">>>
${officialContentText}
<<<END_OFFICIAL_NOTE>>>

INSTRUÇÕES FINAIS:
Gera exatamente ${task.n} exercício(s) do tipo "${task.type}", fundamentado(s) EXCLUSIVAMENTE no texto oficial acima.
Cada exercício deve conter "quote_excerpt" com um excerto literal idêntico ao texto oficial.
Se a matéria for insuficiente para formular perguntas sem recorrer a conhecimento externo, define "insufficient_content": true. NUNCA INVENTES.
`.trim();

      let timeoutHandle: any;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          const err: any = new Error('O motor Gemini excedeu o tempo limite de resposta (timeout).');
          err.name = 'TimeoutError';
          err.code = 'GEMINI_TIMEOUT';
          reject(err);
        }, GEMINI_TIMEOUT_MS);
      });

      try {
        const response: any = await Promise.race([
          ai.models.generateContent({
            model: geminiConfig.model,
            contents: userPrompt,
            config: {
              systemInstruction: OFFICIAL_EXERCISE_SYSTEM_INSTRUCTION,
              responseMimeType: 'application/json',
              // Gemini 3: raciocínio "low" (rápido) e temperatura por defeito (recomendada pela Google)
              thinkingConfig: { thinkingLevel: (ThinkingLevel as any)?.LOW ?? 'LOW' },
              maxOutputTokens: 2048 + task.n * 800,
            },
          }),
          timeoutPromise,
        ]);
        return JSON.parse(response.text || '{}');
      } finally {
        clearTimeout(timeoutHandle);
      }
    };

    const settled = await Promise.allSettled(tasks.map((t, i) => runChunk(t, i)));
    const okOutputs: any[] = [];
    let firstError: any = null;
    for (const r of settled) {
      if (r.status === 'fulfilled') okOutputs.push(r.value);
      else if (!firstError) firstError = r.reason;
    }
    failedChunks = settled.length - okOutputs.length;

    if (okOutputs.length === 0) {
      const err: any = firstError || {};
      console.error('Falha na invocação da API Gemini:', err?.message || err);

      if (err.code === 'GEMINI_TIMEOUT' || err.name === 'TimeoutError') {
        return {
          statusCode: 504,
          headers: jsonHeaders,
          body: JSON.stringify({
            error: 'O motor Gemini demorou demasiado a responder. Tenta com menos exercícios ou volta a tentar daqui a pouco. Nenhum exercício foi guardado.',
            code: 'GATEWAY_TIMEOUT',
          }),
        };
      }
      if (err?.status === 429 || err?.message?.includes('429') || err?.message?.includes('RESOURCE_EXHAUSTED')) {
        return {
          statusCode: 429,
          headers: jsonHeaders,
          body: JSON.stringify({
            error: 'Limite de quota da API Gemini atingido. Por favor, aguarde alguns instantes antes de tentar novamente.',
            code: 'GEMINI_RATE_LIMIT',
          }),
        };
      }
      if (err?.status >= 500 || err?.message?.includes('500') || err?.message?.includes('503')) {
        return {
          statusCode: 502,
          headers: jsonHeaders,
          body: JSON.stringify({
            error: 'O serviço Gemini está temporariamente indisponível. Nenhum exercício foi guardado.',
            code: 'GEMINI_UNAVAILABLE',
          }),
        };
      }
      return {
        statusCode: 502,
        headers: jsonHeaders,
        body: JSON.stringify({
          error: `Falha na comunicação com o motor Gemini${err?.message ? `: ${String(err.message).slice(0, 200)}` : ''}. Tenta novamente.`,
          code: 'GEMINI_GATEWAY_ERROR',
        }),
      };
    }

    // Junta os lotes e remove enunciados repetidos
    const seenPrompts = new Set<string>();
    const mergedExercises: any[] = [];
    for (const out of okOutputs) {
      for (const ex of Array.isArray(out?.exercises) ? out.exercises : []) {
        const key = String(ex?.prompt || '').trim().toLowerCase();
        if (key && !seenPrompts.has(key)) {
          seenPrompts.add(key);
          mergedExercises.push(ex);
        }
      }
    }
    rawAiOutput = {
      insufficient_content: mergedExercises.length === 0 && okOutputs.every((o) => o?.insufficient_content === true),
      reason: okOutputs.find((o) => o?.reason)?.reason || '',
      exercises: mergedExercises,
    };
  }

  // 7. Validação Rigorosa de Grounding e Citações Literais
  const validationResult = validateOfficialExerciseBatch(rawAiOutput, noteContext);

  if (validationResult.insufficientContent) {
    return {
      statusCode: 200,
      headers: jsonHeaders,
      body: JSON.stringify({
        success: false,
        code: 'INSUFFICIENT_NOTES_CONTENT',
        message: validationResult.reason || 'O apontamento oficial não contém matéria suficiente para gerar estes exercícios.',
        exercises: [],
      }),
    };
  }

  if (!validationResult.valid || validationResult.exercises.length === 0) {
    return {
      statusCode: 422,
      headers: jsonHeaders,
      body: JSON.stringify({
        error: 'Nenhum exercício gerado cumpriu os critérios estritos de grounding e citação literal do Caderno Oficial.',
        rejectedCount: validationResult.rejectedCount,
      }),
    };
  }

  // 8. Registo Transacional Atómico dos Exercícios em Estado de Rascunho (Draft)
  // - Uma única RPC (uma transação PostgreSQL): exercícios + proveniência de TODO o lote ou nada.
  // - Sem fallbacks por item: um fallback criaria lotes parciais e escritas fora da transação.
  // - status = 'draft': ocultos dos alunos até revisão e publicação pelo administrador.
  // A função da base de dados aceita até 15 por lote: acima disso grava em 2 lotes
  const allExercises = validationResult.exercises;
  const groups: (typeof allExercises)[] = [];
  if (allExercises.length > 15) {
    const half = Math.ceil(allExercises.length / 2);
    groups.push(allExercises.slice(0, half), allExercises.slice(half));
  } else {
    groups.push(allExercises);
  }

  const insertedIds: string[] = [];
  for (const group of groups) {
    const { data: batchResult, error: batchRpcErr } = await supabase.rpc(
      'create_official_exercise_batch_with_provenance',
      {
        p_user_id: verifiedAdminId,
        p_official_note_id: noteRecord.id,
        p_official_version_id: versionRecord.id,
        p_content_hash: contentHash,
        p_exercises: group,
        p_atomic: true,
      }
    );

    const ids: string[] = (batchResult && batchResult.inserted_ids) || [];
    if (batchRpcErr || ids.length !== group.length) {
      console.error('Lote de exercícios revertido:', batchRpcErr?.message || 'contagem inconsistente');
      if (insertedIds.length === 0) {
        return {
          statusCode: 500,
          headers: jsonHeaders,
          body: JSON.stringify({
            error: 'A gravação do lote falhou e foi revertida por inteiro. Nenhum exercício foi guardado.',
            code: 'TRANSACTION_ROLLBACK',
          }),
        };
      }
      break; // o primeiro lote já foi gravado: devolve o que ficou guardado
    }
    insertedIds.push(...ids);
  }

  const savedExercises = allExercises.slice(0, insertedIds.length).map((ex, idx) => ({
    id: insertedIds[idx],
    prompt: ex.prompt,
    question_type: ex.question_type,
    options: ex.options,
    correct_answer: ex.correct_answer,
    scoring_rubric: ex.scoring_rubric,
    max_points: ex.max_points,
    difficulty: ex.difficulty,
    status: 'draft',
    quote_excerpt: ex.quote_excerpt,
    official_note_id: noteRecord.id,
    official_version_id: versionRecord.id,
  }));

  const partialWarning =
    failedChunks > 0 || savedExercises.length < count
      ? ` Pediste ${count}, mas só ${savedExercises.length} passaram na validação; gera de novo para completar.`
      : '';

  return {
    statusCode: 200,
    headers: jsonHeaders,
    body: JSON.stringify({
      success: true,
      message: `${savedExercises.length} exercício(s) oficial(ais) gerado(s) com sucesso em rascunho. Aguardam revisão e publicação pelo administrador.${partialWarning}`,
      note_title: noteRecord.title,
      version_number: versionRecord.version_number,
      subject_id: noteRecord.subject_id,
      academic_period: noteRecord.academic_period,
      exercises: savedExercises,
    }),
  };
};
