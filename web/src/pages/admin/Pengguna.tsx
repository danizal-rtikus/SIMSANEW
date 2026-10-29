import { useEffect, useState } from 'react';
import { useAuth } from '../../lib/auth';
import { useAsync } from '../../lib/useAsync';
import { api } from '../../lib/api';
import { useProdi } from '../../lib/master';
import { ROLE_LABEL } from '../../lib/labels';
import type { AppRole, Profile, RoleRow } from '../../lib/types';
import { Badge, Button, ErrorNote, Field, Loading, PageHeader, Panel, Tabs } from '../../components/ui';
import { Modal, useDialog } from '../../components/Dialog';
import { useToast } from '../../components/Toast';

type UserRow = Profile & { user_roles: RoleRow[]; created_at: string };
const ALL_ROLES: AppRole[] = ['mahasiswa', 'dosen', 'kaprodi', 'baak', 'pimpinan', 'admin'];

export function Pengguna() {
  const { userId } = useAuth();
  const dialog = useDialog();
  const toast = useToast();
  const prodiList = useProdi();
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [role, setRole] = useState('');
  const [page, setPage] = useState(1);
  const [edit, setEdit] = useState<Partial<UserRow> | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const st = useAsync(async () => {
    const params = new URLSearchParams({ q: query, role, page: String(page), size: '25' });
    return api<{ data: UserRow[]; total: number }>(`/admin/users?${params}`);
  }, [query, role, page]);

  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(q.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const toggleActive = async (u: UserRow) => {
    const ok = await dialog.confirm({
      title: u.aktif ? `Nonaktifkan ${u.nama}?` : `Aktifkan kembali ${u.nama}?`,
      message: u.aktif ? 'Pengguna tidak dapat login sampai diaktifkan kembali. Data tetap tersimpan.' : 'Pengguna dapat login kembali.',
      confirmLabel: u.aktif ? 'Nonaktifkan' : 'Aktifkan',
      danger: u.aktif,
    });
    if (!ok) return;
    try {
      await api(`/admin/users/${u.id}/status`, { body: { aktif: !u.aktif } });
      toast.show(u.aktif ? 'Akun dinonaktifkan' : 'Akun diaktifkan', 'ok');
      st.reload();
    } catch (e) {
      toast.show((e as Error).message, 'bad');
    }
  };

  const resetPassword = async (u: UserRow) => {
    const ok = await dialog.confirm({ title: `Buat kata sandi baru untuk ${u.nama}?`, message: 'Kata sandi lama tidak berlaku lagi. Kata sandi baru ditampilkan sekali untuk Anda sampaikan.', confirmLabel: 'Buat kata sandi baru' });
    if (!ok) return;
    try {
      const r = await api<{ password: string }>(`/admin/users/${u.id}/reset-password`, { body: {} });
      await dialog.alert({ title: 'Kata sandi baru', message: <PasswordReveal email={u.email ?? ''} password={r.password} /> });
    } catch (e) {
      toast.show((e as Error).message, 'bad');
    }
  };

  const total = st.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / 25));

  return (
    <>
      <PageHeader
        title="Pengguna"
        description="Kelola akun, peran, dan prodi. Satu akun dapat memiliki beberapa peran, mis. Dosen sekaligus Ka. Prodi."
        actions={
          <>
            <Button onClick={() => setImportOpen(true)}>Impor CSV</Button>
            <Button variant="primary" onClick={() => setEdit({ aktif: true, user_roles: [{ role: 'mahasiswa', prodi_id: null }] })}>
              Tambah pengguna
            </Button>
          </>
        }
      />
      <div className="row filterbar">
        <input style={{ maxWidth: 320 }} placeholder="Cari nama, email, NIM, NIDN" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Cari pengguna" />
        <select
          style={{ maxWidth: 180 }}
          value={role}
          onChange={(e) => {
            setRole(e.target.value);
            setPage(1);
          }}
          aria-label="Filter peran"
        >
          <option value="">Semua peran</option>
          {ALL_ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r]}
            </option>
          ))}
        </select>
        <span className="muted small">{total} pengguna</span>
      </div>
      {st.error ? (
        <ErrorNote error={st.error} onRetry={st.reload} />
      ) : st.loading && !st.data ? (
        <Loading variant="table" />
      ) : (
        <Panel flush>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Nama</th>
                  <th>Identitas</th>
                  <th>Prodi</th>
                  <th>Peran</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {(st.data?.data ?? []).map((u) => (
                  <tr key={u.id}>
                    <td>
                      <div className="strong">{u.nama}</div>
                      <div className="muted small">{u.email}</div>
                    </td>
                    <td className="small">{u.nim ? `NIM ${u.nim}` : u.nidn ? `NIDN ${u.nidn}` : <span className="muted">—</span>}</td>
                    <td className="small">{u.prodi ? `${u.prodi.kode}` : <span className="muted">—</span>}</td>
                    <td>
                      <div className="row" style={{ gap: 4 }}>
                        {u.user_roles.map((r) => (
                          <Badge key={`${r.role}${r.prodi_id}`} tone={r.role === 'admin' ? 'brand' : 'neutral'}>
                            {ROLE_LABEL[r.role]}
                            {r.prodi_id ? ` ${prodiList.find((p) => p.id === r.prodi_id)?.kode ?? ''}` : ''}
                          </Badge>
                        ))}
                      </div>
                    </td>
                    <td>{u.aktif ? <Badge tone="ok">Aktif</Badge> : <Badge tone="bad">Nonaktif</Badge>}</td>
                    <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                      <Button size="sm" variant="ghost" onClick={() => setEdit(u)}>
                        Ubah
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => resetPassword(u)}>
                        Kata sandi
                      </Button>
                      {u.id !== userId && (
                        <Button size="sm" variant="ghost" onClick={() => toggleActive(u)}>
                          {u.aktif ? 'Nonaktifkan' : 'Aktifkan'}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="row-between" style={{ padding: '10px 14px', borderTop: '1px solid var(--line)' }}>
            <span className="small muted">
              Halaman {page} dari {pages}
            </span>
            <span className="row">
              <Button size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                Sebelumnya
              </Button>
              <Button size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>
                Berikutnya
              </Button>
            </span>
          </div>
        </Panel>
      )}
      <UserModal value={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); st.reload(); }} />
      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} onDone={st.reload} />
    </>
  );
}

function PasswordReveal({ email, password }: { email: string; password: string }) {
  const toast = useToast();
  return (
    <div className="stack-sm">
      <span>{email}</span>
      <div className="row" style={{ flexWrap: 'nowrap' }}>
        <input readOnly value={password} className="mono-num" onFocus={(e) => e.target.select()} />
        <Button
          onClick={() =>
            navigator.clipboard
              ?.writeText(password)
              .then(() => toast.show('Kata sandi disalin', 'ok'))
              .catch(() => toast.show('Salin manual dari kotak di samping', 'bad'))
          }
        >
          Salin
        </Button>
      </div>
      <span className="small">Minta pengguna mengganti kata sandi melalui menu Profil setelah login.</span>
    </div>
  );
}

function UserModal({ value, onClose, onSaved }: { value: Partial<UserRow> | null; onClose: () => void; onSaved: () => void }) {
  const dialog = useDialog();
  const prodiList = useProdi();
  const [v, setV] = useState<Partial<UserRow> & { password?: string; bidang?: string }>({});
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (value) {
      setV({ ...value, bidang: (value.bidang_keahlian ?? []).join(', '), password: '' });
      setRoles(value.user_roles ?? []);
      setErr(null);
    }
  }, [value]);

  const hasRole = (r: AppRole) => roles.some((x) => x.role === r);
  const toggleRole = (r: AppRole) =>
    setRoles((xs) => (xs.some((x) => x.role === r) ? xs.filter((x) => x.role !== r) : [...xs, { role: r, prodi_id: r === 'kaprodi' ? v.prodi_id ?? null : null }]));
  const setRoleProdi = (r: AppRole, prodi: string | null) => setRoles((xs) => xs.map((x) => (x.role === r ? { ...x, prodi_id: prodi } : x)));

  const save = async () => {
    setErr(null);
    if (!v.nama?.trim()) return setErr('Nama wajib diisi');
    if (!v.id && !v.email?.trim()) return setErr('Email wajib diisi');
    if (roles.length === 0) return setErr('Pilih minimal satu peran');
    if (roles.some((r) => r.role === 'kaprodi' && !r.prodi_id)) return setErr('Pilih prodi untuk peran Ka. Prodi');
    const body = {
      nama: v.nama.trim(),
      nim: v.nim ?? '',
      nidn: v.nidn ?? '',
      prodi_id: v.prodi_id || null,
      angkatan: v.angkatan ?? '',
      telepon: v.telepon ?? '',
      kuota_bimbingan: v.kuota_bimbingan ?? '',
      bidang_keahlian: (v.bidang ?? '').split(',').map((s) => s.trim()).filter(Boolean),
      roles,
    };
    setBusy(true);
    try {
      if (v.id) {
        await api(`/admin/users/${v.id}`, { method: 'PATCH', body });
        onSaved();
      } else {
        const r = await api<{ email: string; password?: string }>('/admin/users', { body: { ...body, email: v.email!.trim(), password: v.password || undefined } });
        onSaved();
        if (r.password) await dialog.alert({ title: 'Akun dibuat', message: <PasswordReveal email={r.email} password={r.password} /> });
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={!!value}
      onClose={onClose}
      wide
      title={v.id ? `Ubah ${value?.nama ?? 'pengguna'}` : 'Tambah pengguna'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Batal
          </Button>
          <Button variant="primary" loading={busy} onClick={save}>
            {v.id ? 'Simpan perubahan' : 'Buat akun'}
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Nama lengkap dan gelar">
          <input value={v.nama ?? ''} onChange={(e) => setV({ ...v, nama: e.target.value })} />
        </Field>
        <Field label="Email institusi">
          <input type="email" value={v.email ?? ''} disabled={!!v.id} onChange={(e) => setV({ ...v, email: e.target.value })} />
        </Field>
        {!v.id && (
          <Field label="Kata sandi awal" hint="Kosongkan untuk dibuat otomatis">
            <input value={v.password ?? ''} onChange={(e) => setV({ ...v, password: e.target.value })} />
          </Field>
        )}
        <Field label="Prodi">
          <select value={v.prodi_id ?? ''} onChange={(e) => setV({ ...v, prodi_id: e.target.value || null })}>
            <option value="">Tidak terkait prodi</option>
            {prodiList.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nama} ({p.jenjang})
              </option>
            ))}
          </select>
        </Field>
        <Field label="Telepon">
          <input value={v.telepon ?? ''} onChange={(e) => setV({ ...v, telepon: e.target.value })} />
        </Field>

        <fieldset className="full" style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 14 }}>
          <legend className="label" style={{ padding: '0 6px' }}>
            Peran
          </legend>
          <div className="grid-3" style={{ gap: 10 }}>
            {ALL_ROLES.map((r) => (
              <div key={r} className="stack-sm" style={{ gap: 4 }}>
                <label className="check">
                  <input type="checkbox" checked={hasRole(r)} onChange={() => toggleRole(r)} /> {ROLE_LABEL[r]}
                </label>
                {(r === 'kaprodi' || r === 'baak') && hasRole(r) && (
                  <select value={roles.find((x) => x.role === r)?.prodi_id ?? ''} onChange={(e) => setRoleProdi(r, e.target.value || null)} aria-label={`Prodi untuk ${ROLE_LABEL[r]}`}>
                    {r === 'baak' && <option value="">Semua prodi</option>}
                    {r === 'kaprodi' && <option value="">Pilih prodi</option>}
                    {prodiList.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.kode} {p.nama}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            ))}
          </div>
        </fieldset>

        {hasRole('mahasiswa') && (
          <>
            <Field label="NIM">
              <input value={v.nim ?? ''} onChange={(e) => setV({ ...v, nim: e.target.value })} />
            </Field>
            <Field label="Angkatan">
              <input type="number" value={v.angkatan ?? ''} onChange={(e) => setV({ ...v, angkatan: e.target.value ? Number(e.target.value) : null })} />
            </Field>
          </>
        )}
        {hasRole('dosen') && (
          <>
            <Field label="NIDN">
              <input value={v.nidn ?? ''} onChange={(e) => setV({ ...v, nidn: e.target.value })} />
            </Field>
            <Field label="Kuota bimbingan" hint="Kosongkan untuk memakai kuota default prodi">
              <input type="number" value={v.kuota_bimbingan ?? ''} onChange={(e) => setV({ ...v, kuota_bimbingan: e.target.value ? Number(e.target.value) : null })} />
            </Field>
            <Field label="Bidang keahlian" className="full" hint="Pisahkan dengan koma">
              <input value={v.bidang ?? ''} onChange={(e) => setV({ ...v, bidang: e.target.value })} />
            </Field>
          </>
        )}
      </div>
      {err && <div className="note bad" style={{ marginTop: 12 }}>{err}</div>}
    </Modal>
  );
}

const TEMPLATES = {
  mahasiswa: 'email,nama,nim,prodi_kode,angkatan,telepon,password\nandi@kampus.ac.id,Andi Saputra,2201001,TI,2022,08120000000,\n',
  dosen: 'email,nama,nidn,prodi_kode,bidang_keahlian,kuota_bimbingan,telepon,password\ndewi@kampus.ac.id,"Dewi Lestari, M.Kom.",0601018803,TI,Data Mining|Machine Learning,10,,\n',
};

interface ImportResult {
  total: number;
  berhasil: number;
  gagal: number;
  results: { baris: number; email: string; status: 'ok' | 'gagal'; pesan?: string; password?: string }[];
}

function ImportModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [jenis, setJenis] = useState<'mahasiswa' | 'dosen'>('mahasiswa');
  const [csv, setCsv] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  useEffect(() => {
    if (open) {
      setCsv('');
      setErr(null);
      setResult(null);
    }
  }, [open]);

  const download = (name: string, text: string) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }));
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const run = async () => {
    if (!csv.trim()) return setErr('Pilih berkas CSV atau tempel isinya');
    setBusy(true);
    setErr(null);
    try {
      const r = await api<ImportResult>('/admin/users/import', { body: { jenis, csv } });
      setResult(r);
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const exportResult = () => {
    if (!result) return;
    const lines = ['baris,email,status,pesan,password_awal', ...result.results.map((r) => [r.baris, r.email, r.status, `"${(r.pesan ?? '').replace(/"/g, '""')}"`, r.password ?? ''].join(','))];
    download(`hasil-impor-${jenis}.csv`, lines.join('\n'));
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title="Impor pengguna dari CSV"
      footer={
        result ? (
          <>
            <Button onClick={exportResult}>Unduh hasil impor</Button>
            <Button variant="primary" onClick={onClose}>
              Selesai
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              Batal
            </Button>
            <Button variant="primary" loading={busy} onClick={run}>
              Impor {jenis}
            </Button>
          </>
        )
      }
    >
      {result ? (
        <div className="stack-sm">
          <div className={`note ${result.gagal ? 'warn' : 'ok'}`}>
            {result.berhasil} dari {result.total} akun dibuat{result.gagal ? `, ${result.gagal} gagal` : ''}.
            {result.results.some((r) => r.password) && ' Kata sandi awal yang dibuat otomatis ada di berkas hasil impor.'}
          </div>
          <div className="table-wrap" style={{ maxHeight: 300, overflowY: 'auto' }}>
            <table className="table">
              <tbody>
                {result.results
                  .filter((r) => r.status === 'gagal')
                  .map((r) => (
                    <tr key={r.baris}>
                      <td className="small">Baris {r.baris}</td>
                      <td className="small">{r.email}</td>
                      <td className="small" style={{ color: 'var(--bad)' }}>
                        {r.pesan}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="stack-sm">
          <Tabs<'mahasiswa' | 'dosen'>
            value={jenis}
            onChange={setJenis}
            items={[
              { value: 'mahasiswa', label: 'Mahasiswa' },
              { value: 'dosen', label: 'Dosen' },
            ]}
          />
          <p className="small muted">
            Kolom wajib: email, nama, prodi_kode. Kolom password boleh kosong; sistem membuat kata sandi awal dan menampilkannya di hasil impor.{' '}
            <button className="btn-link" onClick={() => download(`template-${jenis}.csv`, TEMPLATES[jenis])}>
              Unduh template {jenis}
            </button>
          </p>
          <Field label="Berkas CSV">
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) setCsv(await f.text());
              }}
            />
          </Field>
          <Field label="Atau tempel isi CSV">
            <textarea style={{ minHeight: 140, fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 13 }} value={csv} onChange={(e) => setCsv(e.target.value)} />
          </Field>
          {err && <div className="note bad">{err}</div>}
        </div>
      )}
    </Modal>
  );
}
