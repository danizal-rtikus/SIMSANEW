import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isConfigured = Boolean(url && anonKey);

export const supabase = createClient(url || 'http://localhost:54321', anonKey || 'belum-dikonfigurasi', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

/** Menjalankan query Supabase dan melempar Error berbahasa Indonesia bila gagal. */
export async function must<T>(query: PromiseLike<{ data: T; error: { message: string; code?: string } | null }>): Promise<T> {
  const { data, error } = await query;
  if (error) throw new Error(translateError(error.message, error.code));
  return data;
}

export function translateError(message: string, code?: string): string {
  if (code === '42501' || /row-level security|permission denied/i.test(message)) {
    return 'Anda tidak memiliki akses untuk tindakan ini';
  }
  if (/Invalid login credentials/i.test(message)) return 'Email atau kata sandi salah';
  if (/Email not confirmed/i.test(message)) return 'Email belum dikonfirmasi';
  if (/User is banned/i.test(message)) return 'Akun Anda dinonaktifkan. Hubungi Admin.';
  if (/Failed to fetch|NetworkError/i.test(message)) return 'Tidak dapat terhubung ke server. Periksa koneksi Anda.';
  if (/duplicate key/i.test(message)) return 'Data yang sama sudah ada';
  return message;
}
