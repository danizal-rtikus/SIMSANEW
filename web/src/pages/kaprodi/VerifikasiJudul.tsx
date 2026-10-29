import { useEffect, useState } from 'react';
import { useAuth } from '../../lib/auth';
import { useAsync } from '../../lib/useAsync';
import { must, supabase } from '../../lib/supabase';
import { rpc } from '../../lib/queries';
import { fmtDate } from '../../lib/format';
import { openFile } from '../../lib/files';
import { useDosenLoad } from '../../lib/dosen';
import { useQueryState } from '../../lib/shell';
import type { TitleSubmission } from '../../lib/types';
import { Badge, Button, Empty, ErrorNote, Field, Loading, PageHeader, Panel, Tabs } from '../../components/ui';
import { TitleBadge } from '../../components/StatusBits';
import { Modal, useDialog } from '../../components/Dialog';
import { DosenSelect } from '../../components/DosenSelect';
import { useToast } from '../../components/Toast';

const SELECT = '*, mahasiswa:profiles!title_submissions_mahasiswa_id_fkey(nama, nim, angkatan)';

interface Similar {
  sumber: string;
  id: string;
  judul: string;
  tahun: number;
  status: string;
  skor: number;
}

export function VerifikasiJudul() {
  const { active } = useAuth();
  const prodiId = active!.prodi_id!;
  const [tab, setTab] = useQueryState<'antrean' | 'riwayat'>('tab', 'antrean');
  const [accept, setAccept] = useState<TitleSubmission | null>(null);
  const st = useAsync(async () => {
    const q = supabase.from('title_submissions').select(SELECT).eq('prodi_id', prodiId);
    return (await must(
      tab === 'antrean' ? q.eq('status', 'diajukan').order('created_at') : q.neq('status', 'diajukan').order('diputuskan_at', { ascending: false }).limit(200),
    )) as TitleSubmission[];
  }, [prodiId, tab]);

  const rows = st.data ?? [];

  return (
    <>
      <PageHeader
        title="Pendaftaran tugas akhir"
        description="Periksa judul sementara dan sinopsis. Menerima pendaftaran sekaligus menetapkan Pembimbing 1 dan Pembimbing 2; milestone mahasiswa langsung terbentuk."
      />
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { value: 'antrean', label: 'Menunggu keputusan' },
          { value: 'riwayat', label: 'Riwayat keputusan' },
        ]}
      />
      {st.loading && !st.data ? (
        <Loading variant="cards" />
      ) : st.error ? (
        <ErrorNote error={st.error} onRetry={st.reload} />
      ) : rows.length === 0 ? (
        <Panel>
          <Empty title={tab === 'antrean' ? 'Tidak ada pendaftaran yang menunggu' : 'Belum ada riwayat'}>
            {tab === 'antrean' ? 'Pendaftaran baru dari mahasiswa akan muncul di sini dan Anda akan menerima notifikasi.' : undefined}
          </Empty>
        </Panel>
      ) : tab === 'antrean' ? (
        <div className="stack">
          {rows.map((s) => (
            <RegistrationCard key={s.id} s={s} onAccept={() => setAccept(s)} onDone={st.reload} />
          ))}
        </div>
      ) : (
        <Panel flush>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Mahasiswa</th>
                  <th>Judul</th>
                  <th>Keputusan</th>
                  <th>Tanggal</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.id}>
                    <td className="small">
                      {s.mahasiswa?.nama}
                      <div className="muted">{s.mahasiswa?.nim}</div>
                    </td>
                    <td>
                      {s.judul}
                      {s.catatan_kaprodi && <div className="muted small">{s.catatan_kaprodi}</div>}
                    </td>
                    <td>
                      <TitleBadge s={s.status} />
                    </td>
                    <td className="small">{fmtDate(s.diputuskan_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
      <AcceptModal
        sub={accept}
        prodiId={prodiId}
        onClose={() => setAccept(null)}
        onDone={() => {
          setAccept(null);
          st.reload();
        }}
      />
    </>
  );
}

function RegistrationCard({ s, onAccept, onDone }: { s: TitleSubmission; onAccept: () => void; onDone: () => void }) {
  const dialog = useDialog();
  const toast = useToast();
  const [similar, setSimilar] = useState<Similar[] | null>(null);

  useEffect(() => {
    let alive = true;
    rpc<Similar[]>('cek_kemiripan_judul', { p_judul: s.judul, p_prodi: s.prodi_id, p_kecuali: s.id })
      .then((r) => alive && setSimilar(r))
      .catch(() => alive && setSimilar([]));
    return () => {
      alive = false;
    };
  }, [s.id, s.judul, s.prodi_id]);

  const reject = async (status: 'revisi' | 'ditolak') => {
    const catatan = await dialog.prompt({
      title: status === 'revisi' ? 'Minta perbaikan pendaftaran' : 'Tolak pendaftaran',
      label: 'Catatan untuk mahasiswa',
      required: true,
      multiline: true,
      confirmLabel: status === 'revisi' ? 'Minta perbaikan' : 'Tolak pendaftaran',
      danger: status === 'ditolak',
    });
    if (!catatan) return;
    try {
      await rpc('putuskan_judul', { p_id: s.id, p_status: status, p_catatan: catatan });
      toast.show(status === 'revisi' ? 'Permintaan perbaikan terkirim' : 'Pendaftaran ditolak', 'ok');
      onDone();
    } catch (e) {
      toast.show((e as Error).message, 'bad');
    }
  };

  return (
    <Panel title={s.mahasiswa?.nama ?? 'Mahasiswa'} sub={`NIM ${s.mahasiswa?.nim ?? '—'}, angkatan ${s.mahasiswa?.angkatan ?? '—'}. Mendaftar ${fmtDate(s.created_at)}.`}
      actions={
        <>
          <Button size="sm" variant="primary" onClick={onAccept}>
            Terima dan tetapkan pembimbing
          </Button>
          <Button size="sm" onClick={() => reject('revisi')}>
            Minta perbaikan
          </Button>
          <Button size="sm" variant="danger" onClick={() => reject('ditolak')}>
            Tolak
          </Button>
        </>
      }
    >
      <div className="muted small">{s.bidang_kajian ? `Bidang kajian: ${s.bidang_kajian}` : 'Judul sementara'}</div>
      <div className="strong" style={{ fontSize: 17, marginTop: 2 }}>{s.judul}</div>
      {s.abstrak && <p className="pre small" style={{ marginTop: 10, maxWidth: '80ch' }}>{s.abstrak}</p>}
      <div className="row" style={{ gap: 6, marginTop: 10 }}>
        {s.kata_kunci?.map((k) => (
          <Badge key={k}>{k}</Badge>
        ))}
        {s.sinopsis_path && (
          <Button size="sm" onClick={() => openFile('pendaftaran', s.sinopsis_path!).catch((e) => toast.show(e.message, 'bad'))}>
            Buka sinopsis
          </Button>
        )}
      </div>
      <div style={{ marginTop: 12 }} className="small">
        {similar === null ? (
          <span className="muted">Memeriksa kemiripan dengan judul terdahulu…</span>
        ) : similar.length === 0 ? (
          <span style={{ color: 'var(--ok)' }}>Tidak ada judul serupa di prodi ini.</span>
        ) : (
          <div className="note warn">
            <div className="strong">Mirip dengan {similar.length} judul</div>
            <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
              {similar.map((x) => (
                <li key={x.id}>
                  {x.judul} <span className="muted">({x.sumber === 'studi_akhir' ? 'tugas akhir' : 'pendaftaran'} {x.tahun}, {(x.skor * 100).toFixed(0)}%)</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Panel>
  );
}

function AcceptModal({ sub, prodiId, onClose, onDone }: { sub: TitleSubmission | null; prodiId: string; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [allProdi, setAllProdi] = useState(false);
  const { list } = useDosenLoad(allProdi ? null : prodiId, !!sub);
  const [p1, setP1] = useState('');
  const [p2, setP2] = useState('');
  const [catatan, setCatatan] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (sub) {
      setP1('');
      setP2('');
      setCatatan('');
      setErr(null);
    }
  }, [sub]);

  const save = async () => {
    setErr(null);
    if (!p1 || !p2) return setErr('Pilih Pembimbing 1 dan Pembimbing 2');
    setBusy(true);
    try {
      await rpc('terima_pendaftaran', { p_id: sub!.id, p_p1: p1, p_p2: p2, p_catatan: catatan.trim() || null });
      toast.show('Pendaftaran diterima dan pembimbing ditetapkan', 'ok');
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={!!sub}
      onClose={onClose}
      wide
      title="Terima pendaftaran"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Batal
          </Button>
          <Button variant="primary" loading={busy} onClick={save}>
            Terima dan tetapkan
          </Button>
        </>
      }
    >
      <div className="stack-sm">
        <p>
          <span className="strong">{sub?.mahasiswa?.nama}</span>: {sub?.judul}
        </p>
        <Field label="Pembimbing 1">
          <DosenSelect value={p1} onChange={setP1} list={list} exclude={[p2]} ariaLabel="Pembimbing 1" />
        </Field>
        <Field label="Pembimbing 2">
          <DosenSelect value={p2} onChange={setP2} list={list} exclude={[p1]} ariaLabel="Pembimbing 2" />
        </Field>
        <label className="check small">
          <input type="checkbox" checked={allProdi} onChange={(e) => setAllProdi(e.target.checked)} /> Tampilkan dosen prodi lain
        </label>
        <Field label="Catatan untuk mahasiswa (opsional)">
          <textarea style={{ minHeight: 56 }} value={catatan} onChange={(e) => setCatatan(e.target.value)} />
        </Field>
        <p className="muted small">Penguji seminar dan tim pendadaran dapat diploting kemudian di menu Ploting dosen.</p>
        {err && <div className="note bad">{err}</div>}
      </div>
    </Modal>
  );
}
