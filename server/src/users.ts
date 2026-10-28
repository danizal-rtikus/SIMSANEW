import { randomBytes } from 'node:crypto';
import { admin } from './supabase.js';
import type { AppRole } from './auth.js';

export const ROLES: AppRole[] = ['admin', 'pimpinan', 'kaprodi', 'baak', 'dosen', 'mahasiswa'];

export interface RoleInput {
  role: AppRole;
  prodi_id?: string | null;
}

export interface UserInput {
  email: string;
  password?: string;
  nama: string;
  nim?: string | null;
  nidn?: string | null;
  prodi_id?: string | null;
  prodi_kode?: string | null;
  angkatan?: number | string | null;
  telepon?: string | null;
  kuota_bimbingan?: number | string | null;
  bidang_keahlian?: string[] | string | null;
  roles: RoleInput[];
}

export class UserError extends Error {
  status = 400;
}

export function generatePassword(): string {
  // 12 karakter, tanpa karakter yang mudah tertukar (0/O, 1/l)
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const bytes = randomBytes(12);
  let out = '';
  for (const b of bytes) out += chars[b % chars.length];
  return out;
}

const prodiCache = new Map<string, string>();
export async function resolveProdiId(kode?: string | null, id?: string | null): Promise<string | null> {
  if (id) return id;
  if (!kode) return null;
  const key = kode.trim().toUpperCase();
  if (prodiCache.has(key)) return prodiCache.get(key)!;
  const { data } = await admin.from('prodi').select('id').ilike('kode', key).maybeSingle();
  if (!data) throw new UserError(`Kode prodi "${kode}" tidak ditemukan`);
  prodiCache.set(key, data.id);
  return data.id;
}

function emptyToNull(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

function toIntOrNull(v: unknown): number | null {
  const s = emptyToNull(v);
  if (s === null) return null;
  const n = Number(s);
  if (!Number.isInteger(n)) throw new UserError(`Nilai "${s}" harus berupa bilangan bulat`);
  return n;
}

function toArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  const s = emptyToNull(v);
  return s ? s.split(/[|;]/).map((x) => x.trim()).filter(Boolean) : [];
}

function friendlyDbError(message: string): string {
  if (message.includes('profiles_nim_key')) return 'NIM sudah terdaftar';
  if (message.includes('profiles_nidn_key')) return 'NIDN sudah terdaftar';
  if (message.includes('kaprodi_wajib_prodi')) return 'Peran Ka. Prodi wajib memiliki prodi';
  if (message.includes('user_roles_unik')) return 'Peran yang sama tercantum dua kali';
  if (/already been registered|already exists/i.test(message)) return 'Email sudah terdaftar';
  return message;
}

export function normalizeRoles(roles: RoleInput[], fallbackProdi: string | null): RoleInput[] {
  if (!Array.isArray(roles) || roles.length === 0) throw new UserError('Pilih minimal satu peran');
  return roles.map((r) => {
    if (!ROLES.includes(r.role)) throw new UserError(`Peran "${r.role}" tidak dikenal`);
    const prodi = r.prodi_id ?? (r.role === 'kaprodi' ? fallbackProdi : null);
    if (r.role === 'kaprodi' && !prodi) throw new UserError('Peran Ka. Prodi wajib memiliki prodi');
    return { role: r.role, prodi_id: r.role === 'kaprodi' || r.role === 'baak' ? prodi ?? null : null };
  });
}

export async function profilePatch(input: Partial<UserInput>) {
  const patch: Record<string, unknown> = {};
  if (input.nama !== undefined) patch.nama = String(input.nama).trim();
  if (input.nim !== undefined) patch.nim = emptyToNull(input.nim);
  if (input.nidn !== undefined) patch.nidn = emptyToNull(input.nidn);
  if (input.prodi_id !== undefined || input.prodi_kode !== undefined) {
    patch.prodi_id = await resolveProdiId(emptyToNull(input.prodi_kode), emptyToNull(input.prodi_id));
  }
  if (input.angkatan !== undefined) patch.angkatan = toIntOrNull(input.angkatan);
  if (input.telepon !== undefined) patch.telepon = emptyToNull(input.telepon);
  if (input.kuota_bimbingan !== undefined) patch.kuota_bimbingan = toIntOrNull(input.kuota_bimbingan);
  if (input.bidang_keahlian !== undefined) patch.bidang_keahlian = toArray(input.bidang_keahlian);
  return patch;
}

/** Membuat akun Auth + profil + peran. Membatalkan akun bila langkah berikutnya gagal. */
export async function createUserWithRoles(input: UserInput) {
  const email = String(input.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new UserError('Format email tidak valid');
  const nama = String(input.nama || '').trim();
  if (!nama) throw new UserError('Nama wajib diisi');

  const patch = await profilePatch(input);
  const roles = normalizeRoles(input.roles, (patch.prodi_id as string | null) ?? null);
  if (roles.some((r) => r.role === 'mahasiswa') && !patch.prodi_id) throw new UserError('Mahasiswa wajib memiliki prodi');

  const generated = !input.password;
  const password = input.password || generatePassword();
  if (password.length < 8) throw new UserError('Kata sandi minimal 8 karakter');

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { nama },
  });
  if (error || !data.user) throw new UserError(friendlyDbError(error?.message || 'Gagal membuat akun'));
  const id = data.user.id;

  try {
    // Profil dibuat oleh trigger database; pastikan ada lalu lengkapi
    const { error: upErr } = await admin.from('profiles').upsert({ id, email, ...patch, nama });
    if (upErr) throw new UserError(friendlyDbError(upErr.message));
    const { error: roleErr } = await admin.from('user_roles').insert(roles.map((r) => ({ user_id: id, ...r })));
    if (roleErr) throw new UserError(friendlyDbError(roleErr.message));
  } catch (e) {
    await admin.auth.admin.deleteUser(id);
    throw e;
  }

  return { id, email, password: generated ? password : undefined };
}

export async function replaceRoles(userId: string, roles: RoleInput[], fallbackProdi: string | null) {
  const normalized = normalizeRoles(roles, fallbackProdi);
  const { data: before } = await admin.from('user_roles').select('role, prodi_id').eq('user_id', userId);
  const key = (r: { role: string; prodi_id?: string | null }) => `${r.role}:${r.prodi_id ?? ''}`;
  const beforeKeys = new Set((before ?? []).map(key));
  const afterKeys = new Set(normalized.map(key));

  const toDelete = ((before ?? []) as { role: string; prodi_id: string | null }[]).filter((r) => !afterKeys.has(key(r)));
  const toInsert = normalized.filter((r) => !beforeKeys.has(key(r)));

  for (const r of toDelete) {
    let q = admin.from('user_roles').delete().eq('user_id', userId).eq('role', r.role);
    q = r.prodi_id ? q.eq('prodi_id', r.prodi_id) : q.is('prodi_id', null);
    const { error } = await q;
    if (error) throw new UserError(friendlyDbError(error.message));
  }
  if (toInsert.length) {
    const { error } = await admin.from('user_roles').insert(toInsert.map((r) => ({ user_id: userId, ...r })));
    if (error) throw new UserError(friendlyDbError(error.message));
  }
  return { before: before ?? [], after: normalized };
}

export { friendlyDbError };
