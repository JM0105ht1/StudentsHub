import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

// Os atalhos de teste (token = UUID) NUNCA podem existir num ambiente alojado:
// exigem NODE_ENV=test E ausência de qualquer marcador de runtime Netlify/AWS Lambda.
export const isHostedRuntime = (): boolean =>
  process.env.NETLIFY === 'true' ||
  !!process.env.NETLIFY_LOCAL_DEV_SERVER ||
  !!process.env.AWS_LAMBDA_FUNCTION_NAME ||
  !!process.env.CONTEXT;

export const isTestBypassAllowed = (): boolean =>
  process.env.NODE_ENV === 'test' && !isHostedRuntime();

// Validador de token e autenticação server-side nas Netlify Functions
export const authenticateRequest = async (authHeader?: string) => {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return {
      authenticated: false,
      error: 'Token de autorização em falta ou mal formatado.',
    };
  }

  const token = authHeader.replace('Bearer ', '').trim();

  // Suporte para ambiente de testes automatizados ou desenvolvimento mock
  if (
    isTestBypassAllowed() &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token)
  ) {
    const isAdmin = token === '99999999-9999-4999-8999-999999999999';
    return {
      authenticated: true,
      user: {
        id: token,
        email: isAdmin ? 'admin@studentshub.pt' : `aluno.${token.substring(0, 4)}@studentshub.pt`,
      } as any,
      userId: token,
      role: (isAdmin ? 'admin' : 'student') as 'admin' | 'student',
    };
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || (!supabaseAnonKey && !supabaseServiceKey)) {
    return {
      authenticated: false,
      error: 'Configuração do Supabase ausente no servidor.',
    };
  }

  const authClient = createClient(supabaseUrl, supabaseAnonKey || supabaseServiceKey!);
  const { data: { user }, error } = await authClient.auth.getUser(token);

  if (error || !user) {
    return {
      authenticated: false,
      error: 'Sessão inválida ou expirada.',
    };
  }

  // Fonte de Confiança Autorizada no Servidor:
  // Consulta estrita à tabela user_roles com credenciais de serviço seguras
  // (NUNCA confiando em claims, headers ou payloads do cliente)
  const dbClient = supabaseServiceKey
    ? createClient(supabaseUrl, supabaseServiceKey)
    : authClient;

  const { data: roleRecord } = await dbClient
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id)
    .single();

  const role = (roleRecord?.role === 'admin' ? 'admin' : 'student') as 'admin' | 'student';

  return {
    authenticated: true,
    user,
    userId: user.id, // O ID é SEMPRE o sub do token verificado via getUser, nunca o enviado pelo body
    role,
  };
};

export const handler: Handler = async (event) => {
  const auth = await authenticateRequest(event.headers.authorization);

  if (!auth.authenticated) {
    return {
      statusCode: 401,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: auth.error }),
    };
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: 'Utilizador validado e verificado com sucesso no Netlify Functions.',
      userId: auth.userId,
      role: auth.role,
    }),
  };
};
