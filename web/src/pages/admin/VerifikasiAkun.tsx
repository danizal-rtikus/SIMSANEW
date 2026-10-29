import { useMemo, useState } from 'react';
import { useAsync } from '../../lib/useAsync';
import { must, supabase } from '../../lib/supabase';
import { rpc } from '../../lib/queries';
import { api } from '../../lib/api';
import { fmtDateTime } from '../../lib/format';
import { useQueryState } from '../../lib/shell';
import { Badge, Button, Empty, ErrorNote, Loading, PageHeader, Panel, Tabs } from '../../components/ui';
import { useDialog } from '../../components/Dialog';
import { useToast } from '../../components/Toast';

interface Req {
  id: string;
  user_id: string;
  nama: string;
  nim: string;
  prodi_id: string;
  prodi_kode: string;
  prodi_nama: string;
  angkatan: number | null;
  email: string;
  telepon: string;
  status: 'menunggu' | 'disetujui' | 'ditolak';
  alasan: string | null;
  created_at: string;
  diputuskan_at: string | null;
  nim_terdaftar: string | null;
  nim_ganda: number;
  email_mirip: string | null;
  nama_mirip: string | null;
}

type Tab = 'menunggu' | 'ditolak' | 'disetujui';

/** Antrean pendaftaran akun mahasiswa. Hanya Admin. */
export function VerifikasiAkun() {
  const dialog = useDialog();
  const toast = useToast();
  const [tab, setTab] = useQueryState<Tab>('tab', 'menunggu');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  const st = useAsync(async () => (await must(supabase.rpc('antrean_verifikasi', { p_status: 'semua' }))) as Req[], []);
  const all = st.data ?? [];
  const count = (s: Tab) => all.filter((r) => r.status === s).length;
  const rows = useMemo(() => {
    const k = q.trim().toLowerCase();
    return all.filter((r) => r.status === tab && (!k || `${r.nama} ${r.nim} ${r.email} ${r.prodi_kode}`.toLowerCase().includes(k)));
  }, [all, tab, q]);
  const picked = rows.filter((r) => sel.has(r.id));

  const reload = () => {
    setSel(new Set());
    st.reload();
  };

  const approve = async (list: Req[]) => {
    const flagged = list.filter(warnings);
    const ok = await dialog.confirm({
      title: list.length > 1 ? `Setujui ${list.length} pendaftar?` : `Setujui ${list[0].nama}?`,
      message: (
        <>
          Akun diberi peran Mahasiswa dan dapat langsung dipakai.
          {flagged.length > 0 && <div className="note warn small" style={{ marginTop: 10 }}>{flagged.length} pendaftar memiliki peringatan. Pastikan sudah diperiksa.</div>}
        </>
      ),
      confirmLabel: 'Setujui',
    });
    if (!ok) return;
    setBusy(true);
    try {
      const n = await rpc<number>('verifikasi_akun', { p_ids: list.map((r) => r.id), p_setuju: true, p_alasan: null });
      toast.show(`${n} akun disetujui`, 'ok');
      reload();
    } catch (e) {
      toast.show((e as Error).message, 'bad');
    } finally {
      setBusy(false);
    }
  };

  const reject = async (list: Req[]) => {
    const alasan = await dialog.prompt({
      title: list.length > 1 ? `Tolak ${list.length} pendaftar?` : `Tolak ${list[0].nama}?`,
      message: 'Alasan tampil kepada pendaftar. Pendaftar dapat memperbaiki data lalu mengajukan ulang.',
      label: 'Alasan penolakan',
      multiline: true,
      required: true,
      confirmLabel: 'Tolak',
      danger: true,
    });
    if (!alasan) return;
    setBusy(true);
    try {
      const n = await rpc<number>('verifikasi_akun', { p_ids: list.map((r) => r.id), p_setuju: false, p_alasan: alasan });
      toast.show(`${n} pendaftaran ditolak`, 'ok');
      reload();
    } catch (e) {
      toast.show((e as Error).message, 'bad');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (r: Req) => {
    const ok = await dialog.confirm({
      title: `Hapus akun ${r.nama}?`,
      message: `Akun ${r.email} dan data pendaftarannya dihapus permanen. Pendaftar perlu mendaftar ulang bila ingin memakai SIMSA.`,
      confirmLabel: 'Hapus akun',
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/admin/users/${r.user_id}`, { method: 'DELETE' });
      toast.show('Akun dihapus', 'ok');
      reload();
    } catch (e) {
      toast.show((e as Error).message, 'bad');
    }
  };

  const toggle = (id: string) =>
    setSel((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const allOn = rows.length > 0 && rows.every((r) => sel.has(r.id));

  return (
    <>
      <PageHeader title="Verifikasi akun" description="Pendaftaran akun mahasiswa dari halaman masuk. Akun baru dapat dipakai setelah disetujui; penolakan wajib disertai alasan." />
      <div className="row filterbar">
        <input style={{ maxWidth: 300 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Cari nama, NIM, email, prodi" aria-label="Cari pendaftar" />
      </div>
      <Tabs<Tab>
        value={tab}
        onChange={(t) => {
          setTab(t);
          setSel(new Set());
        }}
        items={[
          { value: 'menunggu', label: `Menunggu (${count('menunggu')})` },
          { value: 'ditolak', label: `Ditolak (${count('ditolak')})` },
          { value: 'disetujui', label: `Disetujui (${count('disetujui')})` },
        ]}
      />
      {st.loading && !st.data ? (
        <Loading variant="table" />
      ) : st.error ? (
        <ErrorNote error={st.error} onRetry={st.reload} />
      ) : rows.length === 0 ? (
        <Panel>
          <Empty title={tab === 'menunggu' ? 'Tidak ada pendaftar yang menunggu' : 'Belum ada data'}>
            {tab === 'menunggu' ? 'Pendaftaran baru dari halaman masuk akan tampil di sini.' : 'Coba tab lain atau ubah pencarian.'}
          </Empty>
        </Panel>
      ) : (
        <Panel flush>
          {tab === 'menunggu' && picked.length > 0 && (
            <div className="bulkbar">
              <span className="strong small">{picked.length} dipilih</span>
              <span style={{ flex: 1 }} />
              <Button size="sm" onClick={() => reject(picked)} disabled={busy}>
                Tolak
              </Button>
              <Button size="sm" variant="primary" onClick={() => approve(picked)} loading={busy}>
                Setujui {picked.length}
              </Button>
            </div>
          )}
          <div className="table-wrap">
            <table className="table has-check">
              <thead>
                <tr>
                  {tab === 'menunggu' && (
                    <th style={{ width: 36 }}>
                      <input type="checkbox" aria-label="Pilih semua" checked={allOn} onChange={() => setSel(allOn ? new Set() : new Set(rows.map((r) => r.id)))} />
                    </th>
                  )}
                  <th>Pendaftar</th>
                  <th>NIM</th>
                  <th>Program studi</th>
                  <th>{tab === 'menunggu' ? 'Didaftarkan' : 'Diputuskan'}</th>
                  <th>{tab === 'ditolak' ? 'Alasan' : 'Pemeriksaan'}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className={sel.has(r.id) ? 'selected' : ''}>
                    {tab === 'menunggu' && (
                      <td>
                        <input type="checkbox" aria-label={`Pilih ${r.nama}`} checked={sel.has(r.id)} onChange={() => toggle(r.id)} />
                      </td>
                    )}
                    <td>
                      <div className="strong">{r.nama}</div>
                      <div className="muted small">{r.email}</div>
                      <div className="muted small mono-num">{r.telepon}</div>
                    </td>
                    <td className="mono-num">
                      {r.nim}
                      <div className="muted small">{r.angkatan ? `Angkatan ${r.angkatan}` : 'Angkatan tidak terbaca'}</div>
                    </td>
                    <td className="small">
                      {r.prodi_nama}
                      <div className="muted">{r.prodi_kode}</div>
                    </td>
                    <td className="small mono-num" style={{ whiteSpace: 'nowrap' }}>
                      {fmtDateTime(tab === 'menunggu' ? r.created_at : r.diputuskan_at ?? r.created_at)}
                    </td>
                    <td className="small" style={{ maxWidth: 280 }}>
                      {tab === 'ditolak' ? r.alasan : <Warnings r={r} />}
                    </td>
                    <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                      {tab === 'menunggu' && (
                        <span className="row" style={{ gap: 6, justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                          <Button size="sm" variant="ghost" onClick={() => reject([r])} disabled={busy}>
                            Tolak
                          </Button>
                          <Button size="sm" variant="primary" onClick={() => approve([r])} disabled={busy}>
                            Setujui
                          </Button>
                        </span>
                      )}
                      {tab === 'ditolak' && (
                        <Button size="sm" variant="ghost" onClick={() => remove(r)}>
                          Hapus akun
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </>
  );
}

const warnings = (r: Req) => !!(r.nim_terdaftar || r.nim_ganda > 0 || r.email_mirip || r.nama_mirip || !r.angkatan);

function Warnings({ r }: { r: Req }) {
  if (!warnings(r)) return <Badge tone="ok">Tidak ada peringatan</Badge>;
  return (
    <div className="stack-xs">
      {r.nim_terdaftar && (
        <div>
          <Badge tone="bad">NIM sudah terdaftar</Badge> <span className="muted">{r.nim_terdaftar}</span>
        </div>
      )}
      {r.nim_ganda > 0 && (
        <div>
          <Badge tone="warn">NIM dipakai {r.nim_ganda} pendaftar lain</Badge>
        </div>
      )}
      {r.email_mirip && (
        <div>
          <Badge tone="warn">Email serupa</Badge> <span className="muted">{r.email_mirip}</span>
        </div>
      )}
      {r.nama_mirip && (
        <div>
          <Badge tone="warn">Nama mirip</Badge> <span className="muted">{r.nama_mirip}</span>
        </div>
      )}
      {!r.angkatan && (
        <div>
          <Badge tone="warn">Angkatan tidak terbaca dari NIM</Badge>
        </div>
      )}
    </div>
  );
}
