import { supabase } from './supabase';

const base = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');

/** Memanggil server Node.js SIMSA dengan token sesi Supabase. */
export async function api<T = unknown>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  let res: Response;
  try {
    res = await fetch(`${base}/api${path}`, {
      method: options.method || (options.body ? 'POST' : 'GET'),
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    throw new Error('Server SIMSA tidak dapat dihubungi. Pastikan server Node.js berjalan.');
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((json as { error?: string }).error || `Permintaan gagal (${res.status})`);
  return json as T;
}
