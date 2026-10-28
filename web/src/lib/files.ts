import { supabase, translateError } from './supabase';

export const DRAFT_TYPES = '.pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const MAX_DRAFT_BYTES = 20 * 1024 * 1024;

function safeName(name: string): string {
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot).toLowerCase() : '';
  const stem = (dot > 0 ? name.slice(0, dot) : name)
    .normalize('NFKD')
    .replace(/[^\w-]+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60);
  return `${stem || 'draf'}${ext}`;
}

export function validateDraft(file: File): string | null {
  if (!/\.(pdf|docx?)$/i.test(file.name)) return 'Format draf harus PDF, DOC, atau DOCX';
  if (file.size > MAX_DRAFT_BYTES) return 'Ukuran draf maksimal 20 MB';
  return null;
}

/** Mengunggah draf ke bucket privat lalu mencatatnya (nomor versi dibuat otomatis). */
export async function uploadDraft(params: { thesisId: string; file: File; bab: string; milestoneId?: string | null; catatan?: string | null }): Promise<string> {
  const err = validateDraft(params.file);
  if (err) throw new Error(err);
  const path = `${params.thesisId}/${Date.now()}-${safeName(params.file.name)}`;
  const up = await supabase.storage.from('drafts').upload(path, params.file, {
    contentType: params.file.type || undefined,
    upsert: false,
  });
  if (up.error) throw new Error(translateError(up.error.message));
  const { data, error } = await supabase.rpc('catat_dokumen', {
    p_thesis: params.thesisId,
    p_bab: params.bab,
    p_milestone: params.milestoneId ?? null,
    p_path: path,
    p_nama: params.file.name,
    p_ukuran: params.file.size,
    p_mime: params.file.type || null,
    p_catatan: params.catatan ?? null,
  });
  if (error) throw new Error(translateError(error.message, error.code));
  return data as string;
}

/** Membuka berkas privat lewat signed URL berumur pendek (5 menit). */
export async function openFile(bucket: 'drafts' | 'guidelines' | 'pendaftaran', path: string) {
  // Jendela dibuka langsung saat klik agar tidak diblokir browser, lalu diarahkan ke signed URL
  const win = window.open('', '_blank');
  if (win) win.opener = null;
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 300);
  if (error || !data) {
    win?.close();
    throw new Error(translateError(error?.message || 'Berkas tidak dapat dibuka'));
  }
  if (win) win.location.href = data.signedUrl;
  else window.location.href = data.signedUrl;
}
