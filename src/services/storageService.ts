/**
 * Students Hub — Serviço de Gestão Segura de Armazenamento (Supabase Storage)
 * 
 * Regras Estritas:
 * 1. O caminho em "personal-vault" é gerado exclusivamente com o ID verificado da sessão:
 *    users/{authenticated_user_id}/tests/{test_id}/notes/{note_id}/{file_name}
 * 2. Proteção contra Path Traversal (rejeita .., barras duplicadas, etc.)
 * 3. Eliminação explícita de ficheiros Storage quando notas ou páginas são apagadas.
 *    (O "ON DELETE CASCADE" do PostgreSQL NÃO apaga ficheiros no Storage)
 */

import { supabase } from './supabaseClient';

export const STORAGE_BUCKETS = {
  PERSONAL_VAULT: 'personal-vault',
  CURATED_LIBRARY: 'curated-library',
} as const;

export class StorageSecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageSecurityError';
  }
}

/**
 * Higieniza o nome de ficheiro para prevenir path traversal e caracteres perigosos
 */
export const sanitizeFileName = (fileName: string): string => {
  const sanitized = fileName
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/\.{2,}/g, '_'); // remove ..
  if (!sanitized || sanitized === '.' || sanitized === '..') {
    return `file_${Date.now()}`;
  }
  return sanitized;
};

/**
 * Constrói o caminho seguro para o personal-vault baseado na identidade do utilizador
 */
export const buildPersonalVaultPath = (
  authenticatedUserId: string,
  testId: string,
  noteId: string,
  fileName: string
): string => {
  if (!authenticatedUserId || authenticatedUserId.includes('/') || authenticatedUserId.includes('..')) {
    throw new StorageSecurityError('Identificador de utilizador inválido para armazenamento.');
  }
  const safeTestId = testId.replace(/[^a-zA-Z0-9_-]/g, '');
  const safeNoteId = noteId.replace(/[^a-zA-Z0-9_-]/g, '');
  const safeFile = sanitizeFileName(fileName);

  return `users/${authenticatedUserId}/tests/${safeTestId}/notes/${safeNoteId}/${safeFile}`;
};

/**
 * Valida se um determinado caminho pertence inequivocamente ao utilizador autenticado
 */
export const isPathOwnedByUser = (storagePath: string, authenticatedUserId: string): boolean => {
  const parts = storagePath.split('/');
  return parts.length >= 2 && parts[0] === 'users' && parts[1] === authenticatedUserId;
};

/**
 * Eliminação explícita e segura de ficheiro do bucket pessoal
 */
export const deletePersonalVaultFile = async (
  authenticatedUserId: string,
  storageFilePath: string
): Promise<{ success: boolean; error?: string }> => {
  if (!isPathOwnedByUser(storageFilePath, authenticatedUserId)) {
    throw new StorageSecurityError(
      'Violação de Segurança: Tentativa de apagar ficheiro de outro utilizador ou fora do cofre pessoal.'
    );
  }

  const { error } = await supabase.storage
    .from(STORAGE_BUCKETS.PERSONAL_VAULT)
    .remove([storageFilePath]);

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
};
