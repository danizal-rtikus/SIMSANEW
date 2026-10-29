/**
 * Pendaftaran akun mahasiswa (publik, tanpa login).
 * Akun dibuat lewat API admin Supabase sehingga tidak bergantung pada pengaturan
 * "Allow new users to sign up" maupun konfirmasi email. Akun belum memiliki peran
 * sampai Admin menyetujuinya di menu Verifikasi akun.
 */
import crypto from 'node:crypto';
import { Router, type NextFunction, type Request, type Response } from 'express';
import { admin, audit } from '../supabase.js';
import { env } from '../env.js';
import { UserError } from '../users.js';

export const daftarRouter = Router();

type Handler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;
const wrap = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => fn(req, res, next).catch(next);

const BATAS_PER_JAM = 5;

function clientIp(req: Request): string {
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return fwd || (req as unknown as { socket?: { remoteAddress?: string } }).socket?.remoteAddress || 'tidak-diketahui';
}

const hashIp = (ip: string) => crypto.createHash('sha256').update(`${env.serviceRoleKey.slice(-12)}|${ip}`).digest('hex').slice(0, 32);

function angkatanDariNim(nim: string): number | null {
  const y = Number(nim.slice(0, 4));
  return Number.isInteger(y) && y >= 1990 && y <= new Date().getFullYear() + 1 ? y : null;
}

// Daftar prodi untuk formulir pendaftaran.
daftarRouter.get(
  '/prodi',
  wrap(async (_req, res) => {
    const { data, error } = await admin.from('prodi').select('id, kode, nama, jenjang').order('jenjang').order('nama');
    if (error) throw new UserError(error.message);
    res.json({ data });
  }),
);

daftarRouter.post(
  '/',
  wrap(async (req, res) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const nama = String(b.nama ?? '').trim().replace(/\s+/g, ' ');
    const nim = String(b.nim ?? '').trim();
    const prodiId = String(b.prodi_id ?? '').trim();
    const email = String(b.email ?? '').trim().toLowerCase();
    const telepon = String(b.telepon ?? '').replace(/[\s-]/g, '');
    const password = String(b.password ?? '');

    if (nama.length < 3 || nama.length > 120) throw new UserError('Nama lengkap minimal 3 huruf');
    if (!/^[0-9]{6,20}$/.test(nim)) throw new UserError('NIM hanya berisi angka (6 sampai 20 digit)');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new UserError('Format email tidak valid');
    if (!/^\+?[0-9]{8,15}$/.test(telepon)) throw new UserError('Nomor HP tidak valid (8 sampai 15 angka)');
    if (password.length < 8) throw new UserError('Kata sandi minimal 8 karakter');
    if (password.length > 72) throw new UserError('Kata sandi terlalu panjang');

    const { data: prodi } = await admin.from('prodi').select('id').eq('id', prodiId).maybeSingle();
    if (!prodi) throw new UserError('Pilih program studi');

    // Batasi pendaftaran dari alamat yang sama.
    const ipHash = hashIp(clientIp(req));
    const sejam = new Date(Date.now() - 3600_000).toISOString();
    const { count } = await admin.from('account_requests').select('id', { count: 'exact', head: true }).eq('ip_hash', ipHash).gte('created_at', sejam);
    if ((count ?? 0) >= BATAS_PER_JAM) {
      const e = new UserError('Terlalu banyak pendaftaran dari jaringan ini. Coba lagi dalam satu jam.');
      e.status = 429;
      throw e;
    }

    // NIM yang sudah dipakai akun aktif: arahkan untuk masuk, bukan mendaftar lagi.
    const { data: owner } = await admin.from('profiles').select('id, aktif').eq('nim', nim).maybeSingle();
    if (owner) throw new UserError('NIM ini sudah memiliki akun SIMSA. Masuk dengan email akun tersebut, atau hubungi Admin bila Anda tidak mengenalinya.');

    const { data: created, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { nama } });
    if (error || !created.user) {
      if (/already been registered|already exists/i.test(error?.message ?? '')) throw new UserError('Email sudah terdaftar. Silakan masuk, atau gunakan Lupa kata sandi.');
      throw new UserError(error?.message ?? 'Akun tidak dapat dibuat');
    }
    const id = created.user.id;
    try {
      const { error: pErr } = await admin.from('profiles').upsert({ id, email, nama, aktif: false });
      if (pErr) throw new UserError(pErr.message);
      const { error: rErr } = await admin.from('account_requests').insert({
        user_id: id,
        nama,
        nim,
        prodi_id: prodiId,
        angkatan: angkatanDariNim(nim),
        email,
        telepon,
        ip_hash: ipHash,
      });
      if (rErr) throw new UserError(rErr.message);
    } catch (e) {
      await admin.auth.admin.deleteUser(id);
      throw e;
    }
    await audit(id, 'daftar_akun', 'account_requests', id, null, { nim, prodi_id: prodiId });
    res.status(201).json({ ok: true });
  }),
);
