/**
 * STUDENTS HUB — TURMA C
 * Sanitizador e Validador Estrito de Apontamentos HTML Oficiais
 * Slogan: "Apontamentos que ajudam, exercícios que resultam. Rumo ao 20."
 * Princípio Sagrado: «SEMPRE COM BASE NOS APONTAMENTOS OFICIAIS!!!»
 */

import sanitizeHtml from 'sanitize-html';

export const MAX_HTML_SIZE_BYTES = 2 * 1024 * 1024; // Limite rigoroso de 2MB
export const ALLOWED_EXTENSIONS = ['.html', '.htm'];
export const ALLOWED_PERIODS = ['P1', 'P2', 'P3'] as const;
export type AcademicPeriod = typeof ALLOWED_PERIODS[number];

export const ALLOWED_SUBJECT_IDS = [
  'matematica-a',
  'fisica-quimica-a',
  'filosofia',
  'portugues',
  'ingles',
  'geometria-descritiva-a',
] as const;

export interface HtmlValidationResult {
  valid: boolean;
  error?: string;
  sanitizedHtml?: string;
  plainText?: string;
  rawSize?: number;
  sanitizedSize?: number;
}

/**
 * Configuração estrita de sanitização de HTML para apontamentos oficiais:
 * - Permite tags estruturais, tipográficas e tabelas
 * - Remove integralmente tags de script, frames, formulários e estilos perigosos
 * - Remove TODOS os manipuladores de eventos on* (onclick, onerror, onload, etc.)
 * - Desativa esquemas perigosos como javascript: e data:
 */
export const SANITIZER_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'p', 'ul', 'ol', 'li', 'strong', 'em', 'b', 'i', 'u', 's',
    'blockquote', 'hr', 'code', 'pre', 'span', 'br',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption',
    'sub', 'sup', 'mark', 'small', 'abbr', 'details', 'summary',
    'dl', 'dt', 'dd', 'figure', 'figcaption'
  ],
  allowedAttributes: {
    '*': ['class', 'id', 'title', 'lang', 'dir'],
    'table': ['border', 'cellpadding', 'cellspacing'],
    'th': ['colspan', 'rowspan', 'scope', 'align', 'valign'],
    'td': ['colspan', 'rowspan', 'align', 'valign'],
    'ol': ['start', 'type', 'reversed'],
    'li': ['value'],
    'details': ['open']
  },
  disallowedTagsMode: 'discard', // descarta por completo a tag e conteúdo não seguro
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesByTag: {},
  allowProtocolRelative: false,
  enforceHtmlBoundary: true,
  parser: {
    lowerCaseTags: true
  }
};

/**
 * Extrai texto limpo sem tags nem entidades HTML
 */
export function extractPlainTextFromHtml(html: string): string {
  const noTags = sanitizeHtml(html, {
    allowedTags: [],
    allowedAttributes: {},
    textFilter: (text) => text,
  });

  // Decodificar entidades HTML comuns para preservação fidedigna de fórmulas e notações (ex: x < y)
  const decoded = noTags
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, ''); // expurgar caracteres de controlo binários

  // Normalizar quebras de linha e múltiplos espaços consecutivos
  return decoded
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
}

/**
 * Validação rigorosa e sanitização server-side de ficheiros HTML de apontamentos
 */
export function validateAndSanitizeOfficialHtml(rawHtml: string): HtmlValidationResult {
  if (typeof rawHtml !== 'string') {
    return { valid: false, error: 'O conteúdo fornecido não é uma string válida.' };
  }

  const rawTrimmed = rawHtml.trim();
  const rawSize = new TextEncoder().encode(rawHtml).length;

  // 1. Verificação de tamanho
  if (rawSize === 0 || rawTrimmed.length === 0) {
    return { valid: false, error: 'O ficheiro HTML está vazio.' };
  }

  if (rawSize > MAX_HTML_SIZE_BYTES) {
    return {
      valid: false,
      error: `O ficheiro excede o limite máximo permitido de 2 MB (tamanho: ${(rawSize / 1024 / 1024).toFixed(2)} MB).`
    };
  }

  // 2. Verificação de bytes nulos ou codificação corrompida
  if (rawHtml.indexOf('\0') !== -1) {
    return { valid: false, error: 'Ficheiro rejeitado: contém bytes nulos ou binários incompatíveis com UTF-8.' };
  }

  // 3. Sanitização estrita
  let sanitizedHtml: string;
  try {
    sanitizedHtml = sanitizeHtml(rawHtml, SANITIZER_OPTIONS);
  } catch (err: any) {
    return { valid: false, error: `Falha no processador de sanitização HTML: ${err?.message || 'HTML malformado'}` };
  }

  // 4. Extração de texto limpo para pesquisa e IA
  const plainText = extractPlainTextFromHtml(sanitizedHtml);

  // 5. Garantir que sobrou conteúdo textual legítimo após sanitização
  if (plainText.length < 5) {
    return {
      valid: false,
      error: 'O ficheiro não contém conteúdo textual curricular válido ou foi integralmente rejeitado pela política de sanitização.'
    };
  }

  return {
    valid: true,
    sanitizedHtml,
    plainText,
    rawSize,
    sanitizedSize: new TextEncoder().encode(sanitizedHtml).length
  };
}
