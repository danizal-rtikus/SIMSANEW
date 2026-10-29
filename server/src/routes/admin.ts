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

// Daftar pengguna + peran, dengan ringkasan studi akhir (mahasiswa) dan beban bimbingan (dosen)
adminRouter.get(
  '/users',
  wrap(async (req, res) => {
    const q = String(req.query.q || '').trim();
    const role = String(req.query.role || '').trim();
    const prodi = String(req.query.prodi_id || '').trim();
    const status = String(req.query.status || '').trim();
    const angkatan = Number(req.query.angkatan || 0);
    const page = Math.max(1, Number(req.query.page || 1));
    const size = Math.min(100, Math.max(10, Number(req.query.size || 25)));

    let userIds: string[] | null = null;
    if (role) {
      // Ka. Prodi dan BAAK disaring menurut prodi yang dipegang, bukan prodi profil.
      let rq = admin.from('user_roles').select('user_id').eq('role', role);
      if (prodi && (role === 'kaprodi' || role === 'baak')) rq = rq.eq('prodi_id', prodi);
      const { data } = await rq;
      userIds = [...new Set(((data ?? []) as { user_id: string }[]).map((r) => r.user_id))];
      if (userIds.length === 0) return res.json({ data: [], total: 0 });
    }

    let query = admin
      .from('profiles')
      .select('id, email, nama, nim, nidn, prodi_id, angkatan, telepon, aktif, kuota_bimbingan, bidang_keahlian, created_at, prodi:prodi_id(kode, nama, jenjang, kuota_bimbingan_default), user_roles(role, prodi_id)', { count: 'exact' })
      .order('nama')
      .range((page - 1) * size, page * size - 1);
    if (q) {
      const safe = q.replace(/[%,()]/g, ' ');
      query = query.or(`nama.ilike.%${safe}%,email.ilike.%${safe}%,nim.ilike.%${safe}%,nidn.ilike.%${safe}%`);
    }
    if (prodi && role !== 'kaprodi' && role !== 'baak') query = query.eq('prodi_id', prodi);
    if (status === 'aktif') query = query.eq('aktif', true);
    if (status === 'nonaktif') query = query.eq('aktif', false);
    if (angkatan) query = query.eq('angkatan', angkatan);
    if (userIds) query = query.in('id', userIds);

    const { data, error, count } = await query;
    if (error) throw new UserError(error.message);
    const rows = (data ?? []) as unknown as { id: string; user_roles: { role: string }[] }[];
    const ids = rows.map((r) => r.id);
    const mhsIds = rows.filter((r) => r.user_roles.some((x) => x.role === 'mahasiswa')).map((r) => r.id);
    const dsnIds = rows.filter((r) => r.user_roles.some((x) => x.role === 'dosen')).map((r) => r.id);

    const [studi, bimb] = await Promise.all([
      mhsIds.length
        ? admin.from('v_thesis_progress').select('thesis_id, mahasiswa_id, status, milestone_nama, persen, risiko, p1_nama, p2_nama, mulai').in('mahasiswa_id', mhsIds).order('mulai', { ascending: false })
        : Promise.resolve({ data: [] }),
      dsnIds.length
        ? admin.from('thesis_supervisors').select('dosen_id, peran, thesis:thesis_id(status)').eq('aktif', true).in('dosen_id', dsnIds)
        : Promise.resolve({ data: [] }),
    ]);
    const studiBy = new Map<string, unknown>();
    for (const t of (studi.data ?? []) as { mahasiswa_id: string }[]) if (!studiBy.has(t.mahasiswa_id)) studiBy.set(t.mahasiswa_id, t);
    const bimbBy = new Map<string, { p1: number; p2: number }>();
    for (const s of (bimb.data ?? []) as unknown as { dosen_id: string; peran: string; thesis: { status: string } | null }[]) {
      if (!s.thesis || !['aktif', 'cuti'].includes(s.thesis.status)) continue;
      const c = bimbBy.get(s.dosen_id) ?? { p1: 0, p2: 0 };
      if (s.peran === 'P1') c.p1++;
      else c.p2++;
      bimbBy.set(s.dosen_id, c);
    }
    res.json({
      data: rows.map((r) => ({ ...r, studi: studiBy.get(r.id) ?? null, bimbingan: bimbBy.get(r.id) ?? (dsnIds.includes(r.id) ? { p1: 0, p2: 0 } : null) })),
      total: count ?? 0,
      ids,
    });
  }),
);

// Jumlah pengguna per peran (untuk tab)
adminRouter.get(
  '/users/stats',
  wrap(async (_req, res) => {
    const [{ count: semua }, { count: nonaktif }, { data: roles }] = await Promise.all([
      admin.from('profiles').select('id', { count: 'exact', head: true }),
      admin.from('profiles').select('id', { count: 'exact', head: true }).eq('aktif', false),
      admin.from('user_roles').select('user_id, role').range(0, 49999),
    ]);
    const per: Record<string, Set<string>> = {};
    for (const r of (roles ?? []) as { user_id: string; role: string }[]) (per[r.role] ??= new Set()).add(r.user_id);
    res.json({ semua: semua ?? 0, nonaktif: nonaktif ?? 0, peran: Object.fromEntries(Object.entries(per).map(([k, v]) => [k, v.size])) });
  }),
);

// Detail satu pengguna untuk panel samping
adminRouter.get(
  '/users/:id/detail',
  wrap(async (req, res) => {
    const id = req.params.id;
    const { data: p, error } = await admin
      .from('profiles')
      .select('id, email, nama, nim, nidn, prodi_id, angkatan, telepon, aktif, kuota_bimbingan, bidang_keahlian, created_at, prodi:prodi_id(kode, nama, jenjang, kuota_bimbingan_default), user_roles(role, prodi_id)')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new UserError(error.message);
    if (!p) return res.status(404).json({ error: 'Pengguna tidak ditemukan' });
    const cols = 'thesis_id, mahasiswa_nama, nim, prodi_kode, judul, status, mulai, persen, milestone_nama, risiko, p1_id, p1_nama, p2_id, p2_nama, jumlah_bimbingan, bimbingan_terakhir';
    const [studi, bimb, uji, log, daftar, auth] = await Promise.all([
      admin.from('v_thesis_progress').select(cols).eq('mahasiswa_id', id).order('mulai', { ascending: false }),
      admin.from('v_thesis_progress').select(cols).or(`p1_id.eq.${id},p2_id.eq.${id}`).in('status', ['aktif', 'cuti']).order('mahasiswa_nama'),
      admin.from('exam_panel').select('id', { count: 'exact', head: true }).eq('dosen_id', id),
      admin.from('audit_logs').select('id, aksi, entitas, created_at, aktor').eq('entitas_id', id).order('created_at', { ascending: false }).limit(12),
      admin.from('account_requests').select('status, created_at, diputuskan_at, alasan').eq('user_id', id).maybeSingle(),
      admin.auth.admin.getUserById(id),
    ]);
    const logs = (log.data ?? []) as { aktor: string | null }[];
    const aktorIds = [...new Set(logs.map((l) => l.aktor).filter((x): x is string => !!x))];
    const { data: aktorRows } = aktorIds.length ? await admin.from('profiles').select('id, nama').in('id', aktorIds) : { data: [] };
    const nama = new Map(((aktorRows ?? []) as { id: string; nama: string }[]).map((a) => [a.id, a.nama]));
    res.json({
      profil: p,
      studi: studi.data ?? [],
      bimbingan: bimb.data ?? [],
      penguji: uji.count ?? 0,
      riwayat: logs.map((l) => ({ ...l, aktor_nama: l.aktor ? nama.get(l.aktor) ?? null : null })),
      pendaftaran: daftar.data ?? null,
      login_terakhir: auth.data?.user?.last_sign_in_at ?? null,
    });
  }),
);

// Aksi massal: aktifkan/nonaktifkan, ubah prodi, ubah angkatan
adminRouter.post(
  '/users/bulk',
  wrap(async (req, res) => {
    const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).filter((x: unknown): x is string => typeof x === 'string' && /^[0-9a-f-]{36}$/i.test(x)).slice(0, 200);
    const aksi = String(req.body?.aksi || '');
    if (!ids.length) throw new UserError('Pilih minimal satu pengguna');
    const self = req.user!.id;
    let ok = 0;
    const lewat: string[] = [];
    if (aksi === 'nonaktifkan' || aksi === 'aktifkan') {
      const aktif = aksi === 'aktifkan';
      for (const id of ids) {
        if (id === self && !aktif) {
          lewat.push('akun Anda sendiri');
          continue;
        }
        const { error: e1 } = await admin.auth.admin.updateUserById(id, { ban_duration: aktif ? 'none' : BAN_FOREVER });
        if (e1) {
          lewat.push(id);
          continue;
        }
        const { error: e2 } = await admin.from('profiles').update({ aktif }).eq('id', id);
        if (e2) lewat.push(id);
        else ok++;
      }
    } else if (aksi === 'prodi') {
      const prodi = req.body?.nilai ? String(req.body.nilai) : null;
      if (prodi) {
        const { data } = await admin.from('prodi').select('id').eq('id', prodi).maybeSingle();
        if (!data) throw new UserError('Prodi tidak ditemukan');
      }
      const { error, count } = await admin.from('profiles').update({ prodi_id: prodi }, { count: 'exact' }).in('id', ids);
      if (error) throw new UserError(friendlyDbError(error.message));
      ok = count ?? ids.length;
    } else if (aksi === 'angkatan') {
      const n = Number(req.body?.nilai);
      if (!Number.isInteger(n) || n < 1990 || n > 2100) throw new UserError('Angkatan tidak valid');
      const { error, count } = await admin.from('profiles').update({ angkatan: n }, { count: 'exact' }).in('id', ids);
      if (error) throw new UserError(friendlyDbError(error.message));
      ok = count ?? ids.length;
    } else throw new UserError('Aksi tidak dikenal');
    await audit(self, `massal_${aksi}`, 'profiles', null, null, { ids, nilai: req.body?.nilai ?? null, berhasil: ok });
    res.json({ berhasil: ok, dilewati: lewat });
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

// Hapus akun (hanya akun tanpa data studi akhir, mis. pendaftar atau akun uji)
adminRouter.delete(
  '/users/:id',
  wrap(async (req, res) => {
    const id = req.params.id;
    if (id === req.user!.id) throw new UserError('Anda tidak dapat menghapus akun sendiri');
    const { data: before } = await admin.from('profiles').select('id, email, nama, nim').eq('id', id).maybeSingle();
    if (!before) return res.status(404).json({ error: 'Pengguna tidak ditemukan' });
    const [{ count: th }, { count: sup }] = await Promise.all([
      admin.from('thesis').select('id', { count: 'exact', head: true }).eq('mahasiswa_id', id),
      admin.from('thesis_supervisors').select('id', { count: 'exact', head: true }).eq('dosen_id', id),
    ]);
    if ((th ?? 0) > 0 || (sup ?? 0) > 0) {
      throw new UserError('Akun ini sudah memiliki data studi akhir atau bimbingan. Nonaktifkan saja agar riwayatnya tetap utuh.');
    }
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) {
      if (/foreign key|violates/i.test(error.message)) throw new UserError('Akun ini masih dirujuk data lain. Nonaktifkan saja agar riwayatnya tetap utuh.');
      throw new UserError(error.message);
    }
    await audit(req.user!.id, 'hapus_pengguna', 'profiles', id, before, null);
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
