/**
 * STUDENTS HUB — TURMA C
 * Serviço de Apontamentos Oficiais Homologados
 * Slogan: "Apontamentos que ajudam, exercícios que resultam. Rumo ao 20."
 * Princípio Sagrado: «SEMPRE COM BASE NOS APONTAMENTOS OFICIAIS!!!»
 */

import { supabase, isSupabaseConfigured } from './supabaseClient';
import { SubjectId } from '../types';
import { AcademicPeriod } from '../lib/htmlSanitizer';

export interface OfficialNoteVersion {
  id: string;
  note_id: string;
  version_number: number;
  sanitized_html: string;
  plain_text_content: string;
  change_summary?: string;
  is_published: boolean;
  published_at?: string;
  created_at: string;
  raw_html?: string; // Disponível apenas no painel administrativo
}

export interface OfficialNote {
  id: string;
  subject_id: SubjectId;
  academic_period: AcademicPeriod;
  theme: string;
  title: string;
  is_published: boolean;
  published_at?: string;
  created_at: string;
  updated_at: string;
  current_version_id?: string;
  current_version?: OfficialNoteVersion;
  versions?: OfficialNoteVersion[];
}

export interface OfficialNoteAuditLog {
  id: string;
  note_id?: string;
  version_id?: string;
  action: 'create_note' | 'create_version' | 'publish_version' | 'unpublish_note' | 'delete_draft_version';
  performed_by: string;
  details: Record<string, any>;
  created_at: string;
}

/**
 * Consulta de apontamentos oficiais publicados para leitura de alunos.
 * Exclusivamente sanitized_html — raw_html NUNCA é solicitado nem renderizado.
 */
export async function getPublishedOfficialNotes(
  subjectId?: SubjectId,
  period?: AcademicPeriod
): Promise<{ notes: OfficialNote[]; error?: string }> {
  try {
    if (!isSupabaseConfigured()) {
      return { notes: getMockPublishedNotes(subjectId, period) };
    }

    // 1. Consulta prioritária via RPC segura get_published_official_notes_secure (exclusivamente sanitized_html, raw_html omitido)
    const { data: rpcRows, error: rpcErr } = await supabase.rpc('get_published_official_notes_secure', {
      p_subject_id: subjectId || null,
      p_academic_period: period || null,
    });

    if (!rpcErr && Array.isArray(rpcRows)) {
      const notes: OfficialNote[] = rpcRows.map((r: any) => ({
        id: r.note_id,
        subject_id: r.subject_id as SubjectId,
        academic_period: r.academic_period as AcademicPeriod,
        theme: r.theme,
        title: r.title,
        is_published: true,
        published_at: r.published_at,
        created_at: r.created_at,
        updated_at: r.published_at,
        current_version_id: r.version_id,
        current_version: {
          id: r.version_id,
          note_id: r.note_id,
          version_number: r.version_number,
          sanitized_html: r.sanitized_html,
          plain_text_content: r.plain_text_content,
          change_summary: r.change_summary,
          is_published: true,
          published_at: r.published_at,
          created_at: r.created_at,
        },
      }));
      return { notes };
    }

    let query = supabase
      .from('official_notes')
      .select(`
        id,
        subject_id,
        academic_period,
        theme,
        title,
        is_published,
        published_at,
        created_at,
        updated_at,
        current_version_id,
        official_note_versions!official_notes_current_version_id_fkey (
          id,
          note_id,
          version_number,
          sanitized_html,
          plain_text_content,
          change_summary,
          is_published,
          published_at,
          created_at
        )
      `)
      .eq('is_published', true)
      .order('academic_period', { ascending: true })
      .order('theme', { ascending: true });

    if (subjectId) {
      query = query.eq('subject_id', subjectId);
    }
    if (period) {
      query = query.eq('academic_period', period);
    }

    const { data, error } = await query;
    if (error) throw error;

    const notes: OfficialNote[] = (data || []).map((row: any) => ({
      id: row.id,
      subject_id: row.subject_id as SubjectId,
      academic_period: row.academic_period as AcademicPeriod,
      theme: row.theme,
      title: row.title,
      is_published: row.is_published,
      published_at: row.published_at,
      created_at: row.created_at,
      updated_at: row.updated_at,
      current_version_id: row.current_version_id,
      current_version: row.official_note_versions
        ? {
            id: row.official_note_versions.id,
            note_id: row.official_note_versions.note_id,
            version_number: row.official_note_versions.version_number,
            sanitized_html: row.official_note_versions.sanitized_html,
            plain_text_content: row.official_note_versions.plain_text_content,
            change_summary: row.official_note_versions.change_summary,
            is_published: row.official_note_versions.is_published,
            published_at: row.official_note_versions.published_at,
            created_at: row.official_note_versions.created_at,
          }
        : undefined,
    }));

    return { notes };
  } catch (err: any) {
    console.error('Erro ao consultar apontamentos oficiais:', err);
    return { notes: [], error: err.message || 'Erro ao carregar apontamentos.' };
  }
}

/**
 * Consulta administrativa completa (rascunhos + publicados + todas as versões).
 */
export async function getAdminOfficialNotes(
  subjectId?: SubjectId
): Promise<{ notes: OfficialNote[]; error?: string }> {
  try {
    if (!isSupabaseConfigured()) {
      return { notes: getMockAdminNotes(subjectId) };
    }

    let query = supabase
      .from('official_notes')
      .select(`
        id,
        subject_id,
        academic_period,
        theme,
        title,
        is_published,
        published_at,
        created_at,
        updated_at,
        current_version_id,
        official_note_versions!official_note_versions_note_id_fkey (
          id,
          note_id,
          version_number,
          sanitized_html,
          plain_text_content,
          change_summary,
          is_published,
          published_at,
          created_at
        )
      `)
      .order('created_at', { ascending: false });

    if (subjectId) {
      query = query.eq('subject_id', subjectId);
    }

    const { data, error } = await query;
    if (error) throw error;

    const notes: OfficialNote[] = (data || []).map((row: any) => {
      const versions: OfficialNoteVersion[] = (row.official_note_versions || []).sort(
        (a: any, b: any) => b.version_number - a.version_number
      );
      const currentVer = versions.find((v) => v.id === row.current_version_id) || versions[0];

      return {
        id: row.id,
        subject_id: row.subject_id as SubjectId,
        academic_period: row.academic_period as AcademicPeriod,
        theme: row.theme,
        title: row.title,
        is_published: row.is_published,
        published_at: row.published_at,
        created_at: row.created_at,
        updated_at: row.updated_at,
        current_version_id: row.current_version_id,
        current_version: currentVer,
        versions,
      };
    });

    return { notes };
  } catch (err: any) {
    return { notes: [], error: err.message || 'Erro ao carregar lista administrativa.' };
  }
}

/**
 * Envio de novo apontamento oficial HTML para o backend administrativo
 */
export async function uploadOfficialNote(params: {
  subject_id: SubjectId;
  academic_period: AcademicPeriod;
  theme: string;
  title: string;
  raw_html: string;
  change_summary?: string;
}): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;

    const response = await fetch('/.netlify/functions/admin-notes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: token ? `Bearer ${token}` : '',
      },
      body: JSON.stringify({
        action: 'upload_new_note',
        ...params,
      }),
    });

    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || `Erro HTTP ${response.status}`);
    }

    return { success: true, data: result };
  } catch (err: any) {
    return { success: false, error: err.message || 'Erro no envio do apontamento.' };
  }
}

/**
 * Envio de nova revisão/versão para apontamento existente
 */
export async function uploadOfficialNoteVersion(params: {
  note_id: string;
  raw_html: string;
  change_summary?: string;
}): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;

    const response = await fetch('/.netlify/functions/admin-notes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: token ? `Bearer ${token}` : '',
      },
      body: JSON.stringify({
        action: 'upload_new_version',
        ...params,
      }),
    });

    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || `Erro HTTP ${response.status}`);
    }

    return { success: true, data: result };
  } catch (err: any) {
    return { success: false, error: err.message || 'Erro no envio da nova versão.' };
  }
}

/**
 * Publicação de versão oficial de apontamento
 */
export async function publishOfficialNoteVersion(
  versionId: string
): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;

    const response = await fetch('/.netlify/functions/admin-notes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: token ? `Bearer ${token}` : '',
      },
      body: JSON.stringify({
        action: 'publish_version',
        version_id: versionId,
      }),
    });

    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || `Erro HTTP ${response.status}`);
    }

    return { success: true, data: result };
  } catch (err: any) {
    return { success: false, error: err.message || 'Erro ao publicar versão.' };
  }
}

/**
 * Despublicar apontamento oficial
 */
export async function unpublishOfficialNote(
  noteId: string
): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;

    const response = await fetch('/.netlify/functions/admin-notes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: token ? `Bearer ${token}` : '',
      },
      body: JSON.stringify({
        action: 'unpublish_note',
        note_id: noteId,
      }),
    });

    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || `Erro HTTP ${response.status}`);
    }

    return { success: true, data: result };
  } catch (err: any) {
    return { success: false, error: err.message || 'Erro ao despublicar apontamento.' };
  }
}

/**
 * Reativação formal de versão histórica de apontamento oficial
 */
export async function reactivateHistoricalVersion(params: {
  note_id: string;
  version_id: string;
  reason?: string;
}): Promise<{ success: boolean; data?: any; error?: string }> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;

    const response = await fetch('/.netlify/functions/admin-notes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: token ? `Bearer ${token}` : '',
      },
      body: JSON.stringify({
        action: 'reactivate_version',
        ...params,
      }),
    });

    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || `Erro HTTP ${response.status}`);
    }

    return { success: true, data: result };
  } catch (err: any) {
    return { success: false, error: err.message || 'Erro ao reativar versão histórica.' };
  }
}

/**
 * Obter logs de auditoria
 */
export async function getOfficialNoteAuditLogs(): Promise<{
  logs: OfficialNoteAuditLog[];
  error?: string;
}> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;

    const response = await fetch('/.netlify/functions/admin-notes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: token ? `Bearer ${token}` : '',
      },
      body: JSON.stringify({ action: 'get_audit_logs' }),
    });

    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || `Erro HTTP ${response.status}`);
    }

    return { logs: result.logs || [] };
  } catch (err: any) {
    return { logs: [], error: err.message || 'Erro ao carregar registos de auditoria.' };
  }
}

// Fallbacks de demonstração estáticos caso Supabase não esteja conectado

function getMockPublishedNotes(_subjectId?: SubjectId, _period?: AcademicPeriod): OfficialNote[] {
  // Sem dados de teste: os apontamentos vêm exclusivamente da base de dados.
  return [];
}

function getMockAdminNotes(_subjectId?: SubjectId): OfficialNote[] {
  return [];
}
