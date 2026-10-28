import { Router, type Request, type Response, type NextFunction } from 'express';
import { admin, audit } from '../supabase.js';
import { requireAuth, requireRole } from '../auth.js';
import { parseCsv } from '../csv.js';
import { env } from '../env.js';
import {
  createUserWithRoles,
  friendlyDbError,
  generatePassword,
  profilePatch,
  replaceRoles,
  UserError,
  type RoleInput,
} from '../users.js';

export const adminRouter = Router();
adminRouter.use(requireAuth, requireRole('admin'));

type Handler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;
const wrap = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => fn(req, res, next).catch(next);

const BAN_FOREVER = '876000h'; // ±100 tahun

// Daftar pengguna + peran
adminRouter.get(
  '/users',
  wrap(async (req, res) => {
    const q = String(req.query.q || '').trim();
    const role = String(req.query.role || '').trim();
    const prodi = String(req.query.prodi_id || '').trim();
    const page = Math.max(1, Number(req.query.page || 1));
    const size = Math.min(100, Math.max(10, Number(req.query.size || 25)));

    let userIds: string[] | null = null;
    if (role) {
      const { data } = await admin.from('user_roles').select('user_id').eq('role', role);
      userIds = [...new Set(((data ?? []) as { user_id: string }[]).map((r) => r.user_id))];
      if (userIds.length === 0) return res.json({ data: [], total: 0 });
    }

    let query = admin
      .from('profiles')
      .select('id, email, nama, nim, nidn, prodi_id, angkatan, telepon, aktif, kuota_bimbingan, bidang_keahlian, created_at, prodi:prodi_id(kode, nama, jenjang), user_roles(role, prodi_id)', { count: 'exact' })
      .order('nama')
      .range((page - 1) * size, page * size - 1);
    if (q) {
      const safe = q.replace(/[%,()]/g, ' ');
      query = query.or(`nama.ilike.%${safe}%,email.ilike.%${safe}%,nim.ilike.%${safe}%,nidn.ilike.%${safe}%`);
    }
    if (prodi) query = query.eq('prodi_id', prodi);
    if (userIds) query = query.in('id', userIds);

    const { data, error, count } = await query;
    if (error) throw new UserError(error.message);
    res.json({ data, total: count ?? 0 });
  }),
);

// Buat pengguna
adminRouter.post(
  '/users',
  wrap(async (req, res) => {
    const result = await createUserWithRoles(req.body);
    await audit(req.user!.id, 'buat_pengguna', 'profiles', result.id, null, { email: result.email, roles: req.body.roles });
    res.status(201).json(result);
  }),
);

// Ubah profil dan peran
adminRouter.patch(
  '/users/:id',
  wrap(async (req, res) => {
    const id = req.params.id;
    const { roles, ...rest } = req.body as { roles?: RoleInput[] } & Record<string, unknown>;
    const { data: before } = await admin.from('profiles').select('*').eq('id', id).maybeSingle();
    if (!before) return res.status(404).json({ error: 'Pengguna tidak ditemukan' });

    const patch = await profilePatch(rest);
    if (Object.keys(patch).length) {
      const { error } = await admin.from('profiles').update(patch).eq('id', id);
      if (error) throw new UserError(friendlyDbError(error.message));
      if (patch.nama) await admin.auth.admin.updateUserById(id, { user_metadata: { nama: patch.nama } });
    }

    if (roles) {
      if (id === req.user!.id && !roles.some((r) => r.role === 'admin')) {
        throw new UserError('Anda tidak dapat mencabut peran Admin dari akun sendiri');
      }
      const prodi = (patch.prodi_id as string | null | undefined) ?? before.prodi_id;
      const change = await replaceRoles(id, roles, prodi);
      await audit(req.user!.id, 'ubah_peran', 'user_roles', id, change.before, change.after);
    }
    res.json({ ok: true });
  }),
);

// Aktifkan / nonaktifkan akun
adminRouter.post(
  '/users/:id/status',
  wrap(async (req, res) => {
    const id = req.params.id;
    const aktif = Boolean(req.body?.aktif);
    if (id === req.user!.id && !aktif) throw new UserError('Anda tidak dapat menonaktifkan akun sendiri');
    const { error: banErr } = await admin.auth.admin.updateUserById(id, { ban_duration: aktif ? 'none' : BAN_FOREVER });
    if (banErr) throw new UserError(banErr.message);
    const { error } = await admin.from('profiles').update({ aktif }).eq('id', id);
    if (error) throw new UserError(error.message);
    res.json({ ok: true });
  }),
);

// Reset kata sandi
adminRouter.post(
  '/users/:id/reset-password',
  wrap(async (req, res) => {
    const password = (req.body?.password as string) || generatePassword();
    if (password.length < 8) throw new UserError('Kata sandi minimal 8 karakter');
    const { error } = await admin.auth.admin.updateUserById(req.params.id, { password });
    if (error) throw new UserError(error.message);
    await audit(req.user!.id, 'reset_kata_sandi', 'profiles', req.params.id, null, null);
    res.json({ password });
  }),
);

// Impor CSV mahasiswa/dosen
adminRouter.post(
  '/users/import',
  wrap(async (req, res) => {
    const jenis = req.body?.jenis as 'mahasiswa' | 'dosen';
    if (jenis !== 'mahasiswa' && jenis !== 'dosen') throw new UserError('Jenis impor harus "mahasiswa" atau "dosen"');
    const rows = parseCsv(String(req.body?.csv || ''));
    if (rows.length === 0) throw new UserError('CSV kosong atau tidak memiliki baris data');
    if (rows.length > 1000) throw new UserError('Maksimal 1000 baris per impor');

    const results: { baris: number; email: string; status: 'ok' | 'gagal'; pesan?: string; password?: string }[] = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const baris = i + 2; // baris 1 = header
      try {
        const out = await createUserWithRoles({
          email: r.email,
          nama: r.nama,
          nim: jenis === 'mahasiswa' ? r.nim : undefined,
          nidn: jenis === 'dosen' ? r.nidn : undefined,
          prodi_kode: r.prodi_kode || r.prodi,
          angkatan: jenis === 'mahasiswa' ? r.angkatan : undefined,
          telepon: r.telepon,
          kuota_bimbingan: jenis === 'dosen' ? r.kuota_bimbingan : undefined,
          bidang_keahlian: jenis === 'dosen' ? r.bidang_keahlian : undefined,
          password: r.password || env.defaultImportPassword || undefined,
          roles: [{ role: jenis }],
        });
        results.push({ baris, email: out.email, status: 'ok', password: out.password });
      } catch (e) {
        results.push({ baris, email: r.email || '(kosong)', status: 'gagal', pesan: (e as Error).message });
      }
    }
    const ok = results.filter((r) => r.status === 'ok').length;
    await audit(req.user!.id, 'impor_pengguna', 'profiles', null, null, { jenis, total: rows.length, berhasil: ok });
    res.json({ total: rows.length, berhasil: ok, gagal: rows.length - ok, results });
  }),
);
