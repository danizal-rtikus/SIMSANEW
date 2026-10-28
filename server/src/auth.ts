import type { NextFunction, Request, Response } from 'express';
import { admin } from './supabase.js';
import { checkSupabase } from './check.js';

export type AppRole = 'admin' | 'pimpinan' | 'kaprodi' | 'baak' | 'dosen' | 'mahasiswa';

export interface AuthUser {
  id: string;
  email: string | undefined;
  roles: { role: AppRole; prodi_id: string | null }[];
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

/** Memverifikasi JWT Supabase dari header Authorization dan memuat peran pengguna. */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'Silakan login terlebih dahulu' });

  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) {
    console.error('[SIMSA] Verifikasi sesi gagal:', error?.status, error?.message);
    // Sesi pengguna benar-benar kedaluwarsa vs. server salah konfigurasi
    const cfg = await checkSupabase();
    if (!cfg.ok) {
      return res.status(500).json({ error: `Server SIMSA salah konfigurasi: ${cfg.problems[0]} Periksa server/.env lalu jalankan ulang server.` });
    }
    return res.status(401).json({ error: 'Sesi Anda kedaluwarsa. Keluar lalu masuk kembali.' });
  }

  const [{ data: roles }, { data: profile }] = await Promise.all([
    admin.from('user_roles').select('role, prodi_id').eq('user_id', data.user.id),
    admin.from('profiles').select('aktif').eq('id', data.user.id).maybeSingle(),
  ]);
  if (profile && profile.aktif === false) return res.status(403).json({ error: 'Akun Anda dinonaktifkan' });

  req.user = { id: data.user.id, email: data.user.email, roles: (roles ?? []) as AuthUser['roles'] };
  next();
}

export function requireRole(...allowed: AppRole[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user?.roles.some((r) => allowed.includes(r.role))) {
      return res.status(403).json({ error: 'Anda tidak memiliki akses untuk tindakan ini' });
    }
    next();
  };
}
