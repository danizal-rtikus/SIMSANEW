import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { useAsync } from '../../lib/useAsync';
import { api } from '../../lib/api';
import { useProdi } from '../../lib/master';
import { ROLE_LABEL } from '../../lib/labels';
import { useQueryState } from '../../lib/shell';
import { fmtDate, fmtDateTime } from '../../lib/format';
import type { AppRole, Profile, RoleRow } from '../../lib/types';
import { Badge, Button, Empty, ErrorNote, Field, Loading, PageHeader, Panel, Progress, Tabs } from '../../components/ui';
import { Modal, useDialog } from '../../components/Dialog';
import { useToast } from '../../components/Toast';
import { Dropdown } from '../../components/Dropdown';
import { IconClose, IconMore } from '../../components/Icons';
import { RiskLabel, ThesisBadge } from '../../components/StatusBits';
import type { Risk } from '../../lib/types';

interface Studi {
  thesis_id: string;
  status: string;
  milestone_nama: string | null;
  persen: number;
  risiko: Risk;
  p1_nama: string | null;
  p2_nama: string | null;
}
type UserRow = Profile & {
  user_roles: RoleRow[];
  created_at: string;
  prodi?: (Profile['prodi'] & { kuota_bimbingan_default?: number }) | null;
  studi?: Studi | null;
  bimbingan?: { p1: number; p2: number } | null;
};
const ALL_ROLES: AppRole[] = ['mahasiswa', 'dosen', 'kaprodi', 'baak', 'pimpinan', 'admin'];
type Tab = 'semua' | AppRole;
const SIZE = 25;

export function Pengguna() {
  const { userId } = useAuth();
  const dialog = useDialog();
  const toast = useToast();
  const prodiList = useProdi();
  const [tab, setTab] = useQueryState<Tab>('peran', 'semua');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [prodi, setProdi] = useState('');
  const [status, setStatus] = useState('');
  const [angkatan, setAngkatan] = useState('');
  const [page, setPage] = useState(1);
  const [edit, setEdit] = useState<Partial<UserRow> | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [detail, setDetail] = useState<string | null>(null);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [massal, setMassal] = useState<'prodi' | 'angkatan' | null>(null);
  const [ver, setVer] = useState(0);

  const role = tab === 'semua' ? '' : tab;
  const st = useAsync(async () => {
    const params = new URLSearchParams({ q: query, role, prodi_id: prodi, status, angkatan: role === 'mahasiswa' ? angkatan : '', page: String(page), size: String(SIZE) });
    return api<{ data: UserRow[]; total: number }>(`/admin/users?${params}`);
  }, [query, role, prodi, status, angkatan, page]);
  const stats = useAsync(() => api<{ semua: number; nonaktif: number; peran: Partial<Record<AppRole, number>> }>('/admin/users/stats'), []);

  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(q.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => setSel(new Set()), [query, role, prodi, status, angkatan, page]);

  const reload = () => {
    st.reload();
    stats.reload();
    setVer((v) => v + 1);
  };

  const toggleActive = async (u: UserRow) => {
    const ok = await dialog.confirm({
      title: u.aktif ? `Nonaktifkan ${u.nama}?` : `Aktifkan kembali ${u.nama}?`,
      message: u.aktif ? 'Pengguna tidak dapat login sampai diaktifkan kembali. Data tetap tersimpan.' : 'Pengguna dapat login kembali.',
      confirmLabel: u.aktif ? 'Nonaktifkan' : 'Aktifkan',
      danger: u.aktif,
    });
    if (!ok) return false;
    try {
      await api(`/admin/users/${u.id}/status`, { body: { aktif: !u.aktif } });
      toast.show(u.aktif ? 'Akun dinonaktifkan' : 'Akun diaktifkan', 'ok');
      reload();
      return true;
    } catch (e) {
      toast.show((e as Error).message, 'bad');
      return false;
    }
  };

  const remove = async (u: UserRow) => {
    const ok = await dialog.confirm({
      title: `Hapus akun ${u.nama}?`,
      message: 'Akun dihapus permanen dan tidak dapat dipulihkan. Akun yang sudah memiliki data studi akhir atau bimbingan tidak dapat dihapus; nonaktifkan saja.',
      confirmLabel: 'Hapus akun',
      danger: true,
    });
    if (!ok) return false;
    try {
      await api(`/admin/users/${u.id}`, { method: 'DELETE' });
      toast.show('Akun dihapus', 'ok');
      reload();
      return true;
    } catch (e) {
      toast.show((e as Error).message, 'bad');
      return false;
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

  const bulk = async (aksi: 'nonaktifkan' | 'aktifkan' | 'prodi' | 'angkatan', nilai?: string | number | null) => {
    const ids = [...sel];
    if (aksi === 'nonaktifkan' || aksi === 'aktifkan') {
      const ok = await dialog.confirm({
        title: aksi === 'nonaktifkan' ? `Nonaktifkan ${ids.length} akun?` : `Aktifkan ${ids.length} akun?`,
        message: aksi === 'nonaktifkan' ? 'Akun yang dinonaktifkan tidak dapat login sampai diaktifkan kembali. Data tetap tersimpan.' : 'Akun dapat login kembali.',
        confirmLabel: aksi === 'nonaktifkan' ? 'Nonaktifkan' : 'Aktifkan',
        danger: aksi === 'nonaktifkan',
      });
      if (!ok) return;
    }
    try {
      const r = await api<{ berhasil: number; dilewati: string[] }>('/admin/users/bulk', { body: { ids, aksi, nilai } });
      toast.show(`${r.berhasil} akun diperbarui${r.dilewati.length ? `, ${r.dilewati.length} dilewati` : ''}`, 'ok');
      setSel(new Set());
      setMassal(null);
      reload();
    } catch (e) {
      toast.show((e as Error).message, 'bad');
    }
  };

  const rows = st.data?.data ?? [];
  const total = st.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / SIZE));
  const allOn = rows.length > 0 && rows.every((r) => sel.has(r.id));
  const picked = rows.filter((r) => sel.has(r.id));
  const kode = (id: string | null) => prodiList.find((p) => p.id === id)?.kode ?? '';
  const angkatanList = useMemo(() => {
    const y = new Date().getFullYear();
    return Array.from({ length: 10 }, (_, i) => y - i);
  }, []);
  const c = stats.data;

  const cols = columnsFor(tab);

  return (
    <>
      <PageHeader
        title="Daftar pengguna"
        description="Kelola akun, peran, dan prodi. Satu akun dapat memiliki beberapa peran, mis. Dosen sekaligus Ka. Prodi. Klik baris untuk melihat rincian."
        actions={
          <>
            <Button onClick={() => setImportOpen(true)}>Impor CSV</Button>
            <Button variant="primary" onClick={() => setEdit({ aktif: true, user_roles: [{ role: tab === 'semua' ? 'mahasiswa' : tab, prodi_id: null }] })}>
              Tambah pengguna
            </Button>
          </>
        }
      />
      <Tabs<Tab>
        value={tab}
        onChange={(t) => {
          setTab(t);
          setPage(1);
        }}
        items={[
          { value: 'semua', label: <TabLabel label="Semua" n={c?.semua} /> },
          ...ALL_ROLES.map((r) => ({ value: r as Tab, label: <TabLabel label={ROLE_LABEL[r]} n={c?.peran[r] ?? (c ? 0 : undefined)} /> })),
        ]}
      />
      <div className="row filterbar">
        <input style={{ maxWidth: 300 }} placeholder="Cari nama, email, NIM, NIDN" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Cari pengguna" />
        <select style={{ maxWidth: 220 }} value={prodi} onChange={(e) => { setProdi(e.target.value); setPage(1); }} aria-label="Filter prodi">
          <option value="">{tab === 'kaprodi' || tab === 'baak' ? 'Semua prodi yang dipegang' : 'Semua prodi'}</option>
          {prodiList.map((p) => (
            <option key={p.id} value={p.id}>
              {p.jenjang} {p.nama}
            </option>
          ))}
        </select>
        {tab === 'mahasiswa' && (
          <select style={{ maxWidth: 160 }} value={angkatan} onChange={(e) => { setAngkatan(e.target.value); setPage(1); }} aria-label="Filter angkatan">
            <option value="">Semua angkatan</option>
            {angkatanList.map((y) => (
              <option key={y} value={y}>
                Angkatan {y}
              </option>
            ))}
          </select>
        )}
        <select style={{ maxWidth: 160 }} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Filter status">
          <option value="">Semua status</option>
          <option value="aktif">Aktif</option>
          <option value="nonaktif">Nonaktif{c ? ` (${c.nonaktif})` : ''}</option>
        </select>
        <span className="muted small">{total} pengguna</span>
      </div>
      {st.error ? (
        <ErrorNote error={st.error} onRetry={st.reload} />
      ) : st.loading && !st.data ? (
        <Loading variant="table" />
      ) : rows.length === 0 ? (
        <Panel>
          <Empty title="Tidak ada pengguna">Ubah pencarian atau filter, atau pilih tab lain.</Empty>
        </Panel>
      ) : (
        <Panel flush>
          {picked.length > 0 && (
            <div className="bulkbar">
              <span className="strong small">{picked.length} dipilih</span>
              <button type="button" className="link-btn small" onClick={() => setSel(new Set())}>
                Batal pilih
              </button>
              <span style={{ flex: 1 }} />
              <Button size="sm" onClick={() => setMassal('prodi')}>
                Ubah prodi
              </Button>
              {tab === 'mahasiswa' && (
                <Button size="sm" onClick={() => setMassal('angkatan')}>
                  Ubah angkatan
                </Button>
              )}
              <Button size="sm" onClick={() => bulk('aktifkan')}>
                Aktifkan
              </Button>
              <Button size="sm" variant="danger" onClick={() => bulk('nonaktifkan')}>
                Nonaktifkan
              </Button>
            </div>
          )}
          <div className="table-wrap">
            <table className="table pg-table has-check">
              <thead>
                <tr>
                  <th style={{ width: 36 }}>
                    <input type="checkbox" aria-label="Pilih semua di halaman ini" checked={allOn} onChange={() => setSel(allOn ? new Set() : new Set(rows.map((r) => r.id)))} />
                  </th>
                  {cols.map((k) => (
                    <th key={k} className={k === 'bimbingan' ? 'num' : undefined}>
                      {COL_LABEL[k]}
                    </th>
                  ))}
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((u, i) => (
                  <tr key={u.id} className={`clickable ${sel.has(u.id) ? 'selected' : ''} ${detail === u.id ? 'is-open' : ''}`} onClick={() => setDetail(u.id)}>
                    <td onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        aria-label={`Pilih ${u.nama}`}
                        checked={sel.has(u.id)}
                        onChange={() =>
                          setSel((s) => {
                            const n = new Set(s);
                            if (n.has(u.id)) n.delete(u.id);
                            else n.add(u.id);
                            return n;
                          })
                        }
                      />
                    </td>
                    {cols.map((k) => (
                      <td key={k} className={k === 'bimbingan' ? 'num' : k === 'nama' ? undefined : 'small'}>
                        <Cell k={k} u={u} tab={tab} kode={kode} />
                      </td>
                    ))}
                    <td className="pg-actions" onClick={(e) => e.stopPropagation()}>
                      <Button size="sm" variant="ghost" onClick={() => setEdit(u)}>
                        Ubah
                      </Button>
                      <RowMenu
                        up={rows.length > 4 && i >= rows.length - 3}
                        self={u.id === userId}
                        aktif={u.aktif}
                        onPassword={() => resetPassword(u)}
                        onToggle={() => toggleActive(u)}
                        onDelete={() => remove(u)}
                      />
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
      {detail && (
        <UserDrawer
          id={detail}
          self={detail === userId}
          onClose={() => setDetail(null)}
          onEdit={(u) => setEdit(u)}
          onPassword={(u) => resetPassword(u)}
          onToggle={(u) => void toggleActive(u)}
          onDelete={async (u) => (await remove(u)) && setDetail(null)}
          version={ver}
        />
      )}
      {massal && <BulkModal kind={massal} count={picked.length} angkatanList={angkatanList} onClose={() => setMassal(null)} onApply={(v) => bulk(massal, v)} />}
      <UserModal value={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />
      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} onDone={reload} />
    </>
  );
}

function TabLabel({ label, n }: { label: string; n?: number }) {
  return (
    <>
      {label}
      {n !== undefined && <span className="tab-count">{n}</span>}
    </>
  );
}

type Col = 'nama' | 'identitas' | 'nim' | 'nidn' | 'prodi' | 'homebase' | 'prodi_dipegang' | 'peran' | 'peran_lain' | 'studi' | 'pembimbing' | 'bimbingan' | 'status';
const COL_LABEL: Record<Col, string> = {
  nama: 'Nama',
  identitas: 'Identitas',
  nim: 'NIM',
  nidn: 'NIDN',
  prodi: 'Prodi',
  homebase: 'Homebase',
  prodi_dipegang: 'Prodi yang dipegang',
  peran: 'Peran',
  peran_lain: 'Peran lain',
  studi: 'Studi akhir',
  pembimbing: 'Pembimbing',
  bimbingan: 'Bimbingan aktif',
  status: 'Status',
};
function columnsFor(tab: Tab): Col[] {
  switch (tab) {
    case 'mahasiswa':
      return ['nama', 'nim', 'prodi', 'studi', 'pembimbing', 'status'];
    case 'dosen':
      return ['nama', 'nidn', 'homebase', 'bimbingan', 'peran_lain', 'status'];
    case 'kaprodi':
    case 'baak':
      return ['nama', 'identitas', 'prodi_dipegang', 'peran_lain', 'status'];
    case 'pimpinan':
    case 'admin':
      return ['nama', 'identitas', 'peran_lain', 'status'];
    default:
      return ['nama', 'identitas', 'prodi', 'peran', 'status'];
  }
}

function RoleBadges({ roles, kode, except }: { roles: RoleRow[]; kode: (id: string | null) => string; except?: AppRole }) {
  const list = roles.filter((r) => r.role !== except);
  if (!list.length) return <span className="muted">—</span>;
  return (
    <div className="row" style={{ gap: 4 }}>
      {list.map((r) => (
        <Badge key={`${r.role}${r.prodi_id}`} tone={r.role === 'admin' ? 'brand' : 'neutral'}>
          {ROLE_LABEL[r.role]}
          {r.prodi_id ? ` ${kode(r.prodi_id)}` : ''}
        </Badge>
      ))}
    </div>
  );
}

function Cell({ k, u, tab, kode }: { k: Col; u: UserRow; tab: Tab; kode: (id: string | null) => string }): ReactNode {
  const none = <span className="muted">—</span>;
  switch (k) {
    case 'nama':
      return (
        <>
          <div className="strong">{u.nama}</div>
          <div className="muted small">{u.email}</div>
        </>
      );
    case 'identitas':
      return u.nim ? `NIM ${u.nim}` : u.nidn ? `NIDN ${u.nidn}` : none;
    case 'nim':
      return u.nim ? (
        <>
          <span className="mono-num">{u.nim}</span>
          <div className="muted">{u.angkatan ? `Angkatan ${u.angkatan}` : 'Angkatan belum diisi'}</div>
        </>
      ) : (
        none
      );
    case 'nidn':
      return u.nidn ? <span className="mono-num">{u.nidn}</span> : none;
    case 'prodi':
    case 'homebase':
      return u.prodi ? (
        <>
          {u.prodi.kode}
          <div className="muted">{u.prodi.jenjang}</div>
        </>
      ) : (
        none
      );
    case 'prodi_dipegang': {
      const r = u.user_roles.filter((x) => x.role === tab);
      return r.length ? r.map((x) => (x.prodi_id ? kode(x.prodi_id) : 'Semua prodi')).join(', ') : none;
    }
    case 'peran':
      return <RoleBadges roles={u.user_roles} kode={kode} />;
    case 'peran_lain':
      return <RoleBadges roles={u.user_roles} kode={kode} except={tab === 'semua' ? undefined : tab} />;
    case 'studi':
      if (!u.studi) return <span className="muted">Belum mendaftar TA</span>;
      return (
        <div className="pg-studi">
          <div className="row" style={{ gap: 6 }}>
            <ThesisBadge s={u.studi.status} />
            {u.studi.status === 'aktif' && <RiskLabel r={u.studi.risiko} />}
          </div>
          <div className="muted">{u.studi.status === 'lulus' ? 'Selesai' : u.studi.milestone_nama ?? '-'}</div>
          <Progress value={u.studi.persen} thin />
        </div>
      );
    case 'pembimbing':
      if (!u.studi) return none;
      if (!u.studi.p1_nama && !u.studi.p2_nama) return <Badge tone="warn">Belum ditetapkan</Badge>;
      return (
        <>
          <div>P1: {u.studi.p1_nama ?? <span className="muted">belum</span>}</div>
          <div>P2: {u.studi.p2_nama ?? <span className="muted">belum</span>}</div>
        </>
      );
    case 'bimbingan': {
      const b = u.bimbingan ?? { p1: 0, p2: 0 };
      const kuota = u.kuota_bimbingan ?? u.prodi?.kuota_bimbingan_default ?? null;
      const n = b.p1 + b.p2;
      return (
        <>
          <span className={kuota !== null && n > kuota ? 'pg-over' : 'strong'}>{n}</span>
          {kuota !== null && <span className="muted"> / {kuota}</span>}
          <div className="muted small">
            P1 {b.p1} · P2 {b.p2}
          </div>
        </>
      );
    }
    case 'status':
      return u.aktif ? <Badge tone="ok">Aktif</Badge> : <Badge tone="bad">Nonaktif</Badge>;
  }
}

function RowMenu({ up, self, aktif, onPassword, onToggle, onDelete }: { up: boolean; self: boolean; aktif: boolean; onPassword: () => void; onToggle: () => void; onDelete: () => void }) {
  return (
    <Dropdown
      align={up ? 'up' : 'right'}
      className={`pg-more ${up ? 'up-right' : ''}`}
      trigger={(open, toggle) => (
        <button type="button" className="icon-btn" aria-label="Aksi lainnya" aria-haspopup="menu" aria-expanded={open} onClick={toggle} title="Aksi lainnya">
          <IconMore size={18} />
        </button>
      )}
    >
      {(close) => (
        <>
          <button type="button" className="dd-item" role="menuitem" onClick={() => { close(); onPassword(); }}>
            Buat kata sandi baru
          </button>
          {!self && (
            <button type="button" className="dd-item" role="menuitem" onClick={() => { close(); onToggle(); }}>
              {aktif ? 'Nonaktifkan akun' : 'Aktifkan akun'}
            </button>
          )}
          {!self && (
            <>
              <div className="dd-sep" />
              <button type="button" className="dd-item danger" role="menuitem" onClick={() => { close(); onDelete(); }}>
                Hapus akun
              </button>
            </>
          )}
        </>
      )}
    </Dropdown>
  );
}

function BulkModal({ kind, count, angkatanList, onClose, onApply }: { kind: 'prodi' | 'angkatan'; count: number; angkatanList: number[]; onClose: () => void; onApply: (v: string | number | null) => Promise<void> }) {
  const prodiList = useProdi();
  const [v, setV] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open
      title={kind === 'prodi' ? `Ubah prodi ${count} akun` : `Ubah angkatan ${count} mahasiswa`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Batal
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={kind === 'angkatan' && !v}
            onClick={async () => {
              setBusy(true);
              await onApply(kind === 'angkatan' ? Number(v) : v || null);
              setBusy(false);
            }}
          >
            Terapkan
          </Button>
        </>
      }
    >
      {kind === 'prodi' ? (
        <Field label="Prodi baru" hint="Mengubah prodi profil (homebase). Prodi yang dipegang Ka. Prodi atau BAAK diubah melalui Ubah.">
          <select value={v} onChange={(e) => setV(e.target.value)}>
            <option value="">Tidak terkait prodi</option>
            {prodiList.map((p) => (
              <option key={p.id} value={p.id}>
                {p.jenjang} {p.nama}
              </option>
            ))}
          </select>
        </Field>
      ) : (
        <Field label="Angkatan baru">
          <select value={v} onChange={(e) => setV(e.target.value)}>
            <option value="">Pilih angkatan</option>
            {angkatanList.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </Field>
      )}
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Panel detail pengguna                                               */
/* ------------------------------------------------------------------ */

interface Detail {
  profil: UserRow;
  studi: (Studi & { judul: string; mulai: string; jumlah_bimbingan: number; bimbingan_terakhir: string | null })[];
  bimbingan: (Studi & { mahasiswa_nama: string; nim: string | null; prodi_kode: string; p1_id: string | null; p2_id: string | null })[];
  penguji: number;
  riwayat: { id: number; aksi: string; entitas: string; created_at: string; aktor_nama: string | null }[];
  pendaftaran: { status: string; created_at: string; diputuskan_at: string | null; alasan: string | null } | null;
  login_terakhir: string | null;
}

const AKSI_LABEL: Record<string, string> = {
  buat_pengguna: 'Akun dibuat',
  ubah_peran: 'Peran diubah',
  reset_kata_sandi: 'Kata sandi baru dibuat',
  hapus_pengguna: 'Akun dihapus',
  update: 'Data diubah',
  insert: 'Data ditambahkan',
};

function UserDrawer({
  id,
  self,
  onClose,
  onEdit,
  onPassword,
  onToggle,
  onDelete,
  version,
}: {
  id: string;
  self: boolean;
  onClose: () => void;
  onEdit: (u: UserRow) => void;
  onPassword: (u: UserRow) => void;
  onToggle: (u: UserRow) => void;
  onDelete: (u: UserRow) => void;
  version: number;
}) {
  const prodiList = useProdi();
  const st = useAsync(() => api<Detail>(`/admin/users/${id}/detail`), [id, version]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  const d = st.data;
  const u = d?.profil;
  const kode = (pid: string | null) => prodiList.find((p) => p.id === pid)?.kode ?? '';
  const isMhs = u?.user_roles.some((r) => r.role === 'mahasiswa');
  const isDsn = u?.user_roles.some((r) => r.role === 'dosen');
  const kuota = u ? u.kuota_bimbingan ?? u.prodi?.kuota_bimbingan_default ?? null : null;

  return (
    <>
      <div className="pg-scrim" onClick={onClose} />
      <aside className="pg-drawer" role="dialog" aria-modal="true" aria-label={u ? `Rincian ${u.nama}` : 'Rincian pengguna'}>
        <div className="pg-drawer-head">
          <div style={{ minWidth: 0 }}>
            <div className="strong pg-drawer-title">{u?.nama ?? 'Memuat'}</div>
            <div className="muted small">{u?.email}</div>
          </div>
          <button type="button" className="icon-btn" aria-label="Tutup" onClick={onClose}>
            <IconClose size={18} />
          </button>
        </div>
        <div className="pg-drawer-body">
          {st.error ? (
            <ErrorNote error={st.error} onRetry={st.reload} />
          ) : !d || !u ? (
            <Loading variant="detail" />
          ) : (
            <>
              <section>
                <div className="row" style={{ gap: 6, marginBottom: 10 }}>
                  {u.aktif ? <Badge tone="ok">Aktif</Badge> : <Badge tone="bad">Nonaktif</Badge>}
                  <RoleBadges roles={u.user_roles} kode={kode} />
                </div>
                <dl className="kv">
                  {u.nim && (
                    <>
                      <dt>NIM</dt>
                      <dd className="mono-num">{u.nim}</dd>
                    </>
                  )}
                  {u.nidn && (
                    <>
                      <dt>NIDN</dt>
                      <dd className="mono-num">{u.nidn}</dd>
                    </>
                  )}
                  <dt>Prodi</dt>
                  <dd>{u.prodi ? `${u.prodi.jenjang} ${u.prodi.nama}` : '—'}</dd>
                  {isMhs && (
                    <>
                      <dt>Angkatan</dt>
                      <dd>{u.angkatan ?? '—'}</dd>
                    </>
                  )}
                  <dt>Nomor HP</dt>
                  <dd>{u.telepon || '—'}</dd>
                  {isDsn && (
                    <>
                      <dt>Bidang keahlian</dt>
                      <dd>{u.bidang_keahlian?.length ? u.bidang_keahlian.join(', ') : '—'}</dd>
                    </>
                  )}
                  <dt>Akun dibuat</dt>
                  <dd>{fmtDate(u.created_at)}</dd>
                  <dt>Login terakhir</dt>
                  <dd>{d.login_terakhir ? fmtDateTime(d.login_terakhir) : 'Belum pernah'}</dd>
                  {d.pendaftaran && (
                    <>
                      <dt>Pendaftaran</dt>
                      <dd>
                        Daftar sendiri {fmtDate(d.pendaftaran.created_at)}, {d.pendaftaran.status}
                        {d.pendaftaran.diputuskan_at ? ` ${fmtDate(d.pendaftaran.diputuskan_at)}` : ''}
                      </dd>
                    </>
                  )}
                </dl>
              </section>

              {isMhs && (
                <section>
                  <h3 className="pg-h">Studi akhir</h3>
                  {d.studi.length === 0 ? (
                    <p className="muted small">Belum mendaftar tugas akhir.</p>
                  ) : (
                    d.studi.map((t) => (
                      <div key={t.thesis_id} className="pg-card">
                        <div className="row" style={{ gap: 6 }}>
                          <ThesisBadge s={t.status} />
                          {t.status === 'aktif' && <RiskLabel r={t.risiko} />}
                        </div>
                        <div className="strong small">{t.judul}</div>
                        <div className="muted small">
                          {t.status === 'lulus' ? 'Selesai' : `Tahap: ${t.milestone_nama ?? '-'}`} · {t.jumlah_bimbingan} sesi bimbingan
                        </div>
                        <Progress value={t.persen} thin />
                        <div className="small">
                          P1: {t.p1_nama ?? <span className="muted">belum ditetapkan</span>}
                          <br />
                          P2: {t.p2_nama ?? <span className="muted">belum ditetapkan</span>}
                        </div>
                        <Link to={`/mahasiswa-bimbingan/${t.thesis_id}`} className="small">
                          Buka studi akhir
                        </Link>
                      </div>
                    ))
                  )}
                </section>
              )}

              {isDsn && (
                <section>
                  <h3 className="pg-h">
                    Mahasiswa bimbingan aktif{' '}
                    <span className="muted small">
                      {d.bimbingan.length}
                      {kuota !== null ? ` dari kuota ${kuota}` : ''} · menguji {d.penguji} ujian
                    </span>
                  </h3>
                  {d.bimbingan.length === 0 ? (
                    <p className="muted small">Belum ada mahasiswa bimbingan aktif.</p>
                  ) : (
                    <ul className="pg-list">
                      {d.bimbingan.map((t) => (
                        <li key={t.thesis_id}>
                          <Link to={`/mahasiswa-bimbingan/${t.thesis_id}`} className="strong small">
                            {t.mahasiswa_nama}
                          </Link>
                          <span className="muted small">
                            {' '}
                            · {t.p1_id === id ? 'P1' : 'P2'} · {t.prodi_kode}
                          </span>
                          <div className="muted small">{t.milestone_nama ?? '-'}</div>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              )}

              <section>
                <h3 className="pg-h">Riwayat</h3>
                {d.riwayat.length === 0 ? (
                  <p className="muted small">Belum ada catatan perubahan.</p>
                ) : (
                  <ul className="pg-list">
                    {d.riwayat.map((r) => (
                      <li key={r.id} className="small">
                        <span className="strong">{AKSI_LABEL[r.aksi] ?? r.aksi.replace(/_/g, ' ')}</span>
                        <span className="muted">
                          {' '}
                          · {fmtDateTime(r.created_at)}
                          {r.aktor_nama ? ` · oleh ${r.aktor_nama}` : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}
        </div>
        {u && (
          <div className="pg-drawer-foot">
            <Button variant="primary" onClick={() => onEdit(u)}>
              Ubah
            </Button>
            <Button onClick={() => onPassword(u)}>Kata sandi baru</Button>
            <span style={{ flex: 1 }} />
            {!self && <Button onClick={() => onToggle(u)}>{u.aktif ? 'Nonaktifkan' : 'Aktifkan'}</Button>}
            {!self && (
              <Button variant="danger" onClick={() => onDelete(u)}>
                Hapus
              </Button>
            )}
          </div>
        )}
      </aside>
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
