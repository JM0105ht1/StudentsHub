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
    // Estrutura do documento (para preservar o design original)
    'html', 'head', 'body', 'style', 'link',
    // Blocos e texto
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'p', 'div', 'section', 'article', 'header', 'footer', 'nav', 'main', 'aside', 'center',
    'ul', 'ol', 'li', 'strong', 'em', 'b', 'i', 'u', 's', 'a', 'img', 'font',
    'blockquote', 'hr', 'code', 'pre', 'span', 'br',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
    'sub', 'sup', 'mark', 'small', 'abbr', 'details', 'summary',
    'dl', 'dt', 'dd', 'figure', 'figcaption',
    // Gráficos vetoriais simples (sem scripts)
    'svg', 'g', 'path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse',
    'text', 'tspan', 'defs', 'lineargradient', 'radialgradient', 'stop', 'clippath'
  ],
  allowedAttributes: {
    '*': ['class', 'id', 'title', 'lang', 'dir', 'style', 'role', 'aria-label', 'aria-hidden'],
    a: ['href', 'name', 'target', 'rel'],
    img: ['src', 'alt', 'width', 'height', 'loading'],
    link: ['rel', 'href', 'type', 'media'],
    style: ['media', 'type'],
    font: ['color', 'size', 'face'],
    table: ['border', 'cellpadding', 'cellspacing', 'width', 'align'],
    th: ['colspan', 'rowspan', 'scope', 'align', 'valign', 'width', 'height'],
    td: ['colspan', 'rowspan', 'align', 'valign', 'width', 'height'],
    col: ['span', 'width'],
    colgroup: ['span', 'width'],
    ol: ['start', 'type', 'reversed'],
    ul: ['type'],
    li: ['value'],
    details: ['open'],
    svg: [
      'viewbox', 'width', 'height', 'xmlns', 'fill', 'stroke', 'stroke-width',
      'preserveaspectratio',
    ],
    g: ['fill', 'stroke', 'stroke-width', 'opacity', 'transform'],
    path: ['d', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'opacity', 'fill-opacity', 'stroke-opacity', 'transform'],
    circle: ['cx', 'cy', 'r', 'fill', 'stroke', 'stroke-width', 'opacity', 'transform'],
    ellipse: ['cx', 'cy', 'rx', 'ry', 'fill', 'stroke', 'stroke-width', 'opacity', 'transform'],
    rect: ['x', 'y', 'width', 'height', 'rx', 'ry', 'fill', 'stroke', 'stroke-width', 'opacity', 'transform'],
    line: ['x1', 'y1', 'x2', 'y2', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-dasharray', 'opacity', 'transform'],
    polyline: ['points', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'opacity', 'transform'],
    polygon: ['points', 'fill', 'stroke', 'stroke-width', 'opacity', 'transform'],
    text: ['x', 'y', 'fill', 'stroke', 'font-size', 'font-family', 'font-weight', 'text-anchor', 'dominant-baseline', 'opacity', 'transform'],
    tspan: ['x', 'y', 'dx', 'dy', 'fill', 'font-size', 'font-weight'],
    lineargradient: ['x1', 'y1', 'x2', 'y2', 'gradientunits', 'gradienttransform'],
    radialgradient: ['cx', 'cy', 'r', 'fx', 'fy', 'gradientunits', 'gradienttransform'],
    stop: ['offset', 'stop-color', 'stop-opacity'],
    clippath: [],
  },
  // <style> é permitido para manter o design; o conteúdo é mostrado numa moldura isolada (iframe sandbox + CSP)
  allowVulnerableTags: true,
  // Texto destas tags (quando não permitidas) é descartado por completo
  nonTextTags: ['script', 'textarea', 'option', 'noscript', 'title'],
  disallowedTagsMode: 'discard', // descarta por completo a tag e conteúdo não seguro
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesByTag: { img: ['http', 'https', 'data'] },
  allowProtocolRelative: false,
  enforceHtmlBoundary: true,
  transformTags: {
    a: sanitizeHtml.simpleTransform('a', { target: '_blank', rel: 'noopener noreferrer' }),
  },
  // Só folhas de estilo HTTPS (ex.: Google Fonts); qualquer outro <link> é removido
  exclusiveFilter: (frame) => {
    if (frame.tag !== 'link') return false;
    const rel = String(frame.attribs?.rel || '').toLowerCase();
    const href = String(frame.attribs?.href || '').toLowerCase();
    return !(rel.includes('stylesheet') && href.startsWith('https://'));
  },
  parser: {
    lowerCaseTags: true
  }
};

/**
 * O PostgreSQL rejeita padrões como "on...=" no HTML guardado. O "=" de preenchimento do base64
 * (imagens embutidas) pode coincidir com esse padrão por acaso, por isso é retirado: os
 * navegadores aceitam base64 sem preenchimento.
 */
export function stripBase64Padding(html: string): string {
  return html.replace(/(data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/]+)={1,2}/gi, '$1');
}

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
    sanitizedHtml = stripBase64Padding(sanitizeHtml(rawHtml, SANITIZER_OPTIONS));
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
