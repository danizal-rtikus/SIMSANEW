import { must, supabase } from './supabase';
import type { DocumentRow, Milestone, Progress, Session, Supervisor, Thesis, TitleSubmission } from './types';

export const SESSION_SELECT =
  '*, dosen:profiles!guidance_sessions_dosen_id_fkey(nama), mahasiswa:profiles!guidance_sessions_mahasiswa_id_fkey(nama, nim), milestone:thesis_milestones(nama), submission:chapter_submissions!guidance_sessions_submission_id_fkey(id, bab, nomor, judul, status)';

export async function getMyThesis(uid: string): Promise<Thesis | null> {
  const rows = await must(
    supabase.from('thesis').select('*').eq('mahasiswa_id', uid).order('created_at', { ascending: false }).limit(1),
  );
  return (rows?.[0] as Thesis) ?? null;
}

export async function getThesis(id: string): Promise<Thesis | null> {
  return (await must(supabase.from('thesis').select('*').eq('id', id).maybeSingle())) as Thesis | null;
}

export async function getProgress(thesisId: string): Promise<Progress | null> {
  return (await must(supabase.from('v_thesis_progress').select('*').eq('thesis_id', thesisId).maybeSingle())) as Progress | null;
}

export async function getMilestones(thesisId: string): Promise<Milestone[]> {
  return (await must(supabase.from('thesis_milestones').select('*').eq('thesis_id', thesisId).order('urutan'))) as Milestone[];
}

export async function getSupervisors(thesisId: string): Promise<Supervisor[]> {
  return (await must(
    supabase
      .from('thesis_supervisors')
      .select('*, dosen:profiles!thesis_supervisors_dosen_id_fkey(nama, nidn, email)')
      .eq('thesis_id', thesisId)
      .eq('aktif', true)
      .order('peran'),
  )) as Supervisor[];
}

export async function getSessionsForThesis(thesisId: string): Promise<Session[]> {
  return (await must(
    supabase.from('guidance_sessions').select(SESSION_SELECT).eq('thesis_id', thesisId).order('tanggal_usulan', { ascending: false }),
  )) as Session[];
}

export async function getDocuments(thesisId: string): Promise<DocumentRow[]> {
  return (await must(
    supabase.from('documents').select('*, pengunggah:profiles(nama)').eq('thesis_id', thesisId).order('created_at', { ascending: false }),
  )) as DocumentRow[];
}

export async function getMyTitleSubmissions(uid: string): Promise<TitleSubmission[]> {
  return (await must(
    supabase.from('title_submissions').select('*').eq('mahasiswa_id', uid).order('created_at', { ascending: false }).order('prioritas'),
  )) as TitleSubmission[];
}

/** Daftar progres mahasiswa yang dibimbing oleh dosen tertentu. */
export async function getSupervisedProgress(dosenId: string): Promise<Progress[]> {
  return (await must(
    supabase.from('v_thesis_progress').select('*').or(`p1_id.eq.${dosenId},p2_id.eq.${dosenId}`).order('mahasiswa_nama'),
  )) as Progress[];
}

export async function rpc<T = unknown>(fn: string, args: Record<string, unknown>): Promise<T> {
  return (await must(supabase.rpc(fn, args) as unknown as PromiseLike<{ data: T; error: { message: string; code?: string } | null }>)) as T;
}
