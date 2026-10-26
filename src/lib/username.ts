/**
 * Students Hub — Autenticação por nome + palavra-passe.
 *
 * O Supabase Auth exige um email, por isso o nome de utilizador é convertido
 * internamente num email técnico (nunca mostrado ao utilizador e nunca usado
 * para enviar mensagens). Ex.: "João Silva" -> "joao.silva@<domínio>".
 *
 * O domínio é configurável em VITE_AUTH_EMAIL_DOMAIN.
 */

const env: Record<string, any> =
  typeof import.meta !== 'undefined' && (import.meta as any).env
    ? (import.meta as any).env
    : typeof process !== 'undefined'
    ? process.env
    : {};

export const AUTH_EMAIL_DOMAIN: string =
  (env.VITE_AUTH_EMAIL_DOMAIN as string) || 'students-hub.app';

export const MIN_NAME_LENGTH = 3;
export const MAX_NAME_LENGTH = 30;
export const MIN_PASSWORD_LENGTH = 6;

/** Normaliza o nome: minúsculas, sem acentos, espaços -> ponto, só [a-z0-9._-]. */
export function normalizeUsername(name: string): string {
  return name
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, '.')
    .replace(/[^a-z0-9._-]/g, '')
    .replace(/\.{2,}/g, '.')
    .replace(/^[._-]+|[._-]+$/g, '');
}

export function usernameToEmail(name: string): string {
  return `${normalizeUsername(name)}@${AUTH_EMAIL_DOMAIN}`;
}

/** Devolve uma mensagem de erro em português de Portugal, ou null se o nome for válido. */
export function validateUsername(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length < MIN_NAME_LENGTH) {
    return `O nome tem de ter pelo menos ${MIN_NAME_LENGTH} caracteres.`;
  }
  if (trimmed.length > MAX_NAME_LENGTH) {
    return `O nome não pode ter mais de ${MAX_NAME_LENGTH} caracteres.`;
  }
  if (normalizeUsername(trimmed).length < MIN_NAME_LENGTH) {
    return 'O nome tem de conter letras ou números.';
  }
  return null;
}

export function validatePassword(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `A palavra-passe tem de ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`;
  }
  return null;
}

/** Traduz erros comuns do Supabase Auth para português de Portugal. */
export function translateAuthError(message: string | undefined): string {
  const m = (message || '').toLowerCase();
  if (m.includes('invalid login credentials')) return 'Nome ou palavra-passe incorretos.';
  if (m.includes('already registered') || m.includes('already been registered')) {
    return 'Esse nome já está em uso. Escolhe outro.';
  }
  if (m.includes('email not confirmed')) {
    return 'Conta por confirmar. O administrador tem de desativar a confirmação por email no Supabase.';
  }
  if (m.includes('email address') && m.includes('invalid')) {
    return 'O domínio de autenticação foi rejeitado pelo Supabase. Define VITE_AUTH_EMAIL_DOMAIN com um domínio válido.';
  }
  if (m.includes('rate limit') || m.includes('too many')) {
    return 'Demasiadas tentativas. Espera um pouco e tenta de novo.';
  }
  if (m.includes('password') && m.includes('characters')) {
    return `A palavra-passe tem de ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`;
  }
  if (m.includes('failed to fetch') || m.includes('network')) {
    return 'Sem ligação ao servidor. Verifica a tua internet.';
  }
  return message || 'Ocorreu um erro. Tenta novamente.';
}
