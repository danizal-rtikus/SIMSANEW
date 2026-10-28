import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { useAsync } from '../../lib/useAsync';
import { must, supabase } from '../../lib/supabase';
import { rpc } from '../../lib/queries';
import { useDosenLoad } from '../../lib/dosen';
import { useQueryState } from '../../lib/shell';
import type { Examiner, Progress } from '../../lib/types';
import { Badge, Button, ErrorNote, Field, Loading, PageHeader, Panel, Tabs } from '../../components/ui';
import { Modal } from '../../components/Dialog';
import { DosenSelect } from '../../components/DosenSelect';
import { useToast } from '../../components/Toast';

interface Row extends Progress {
  wakil: 'P1' | 'P2';
  seminar: Examiner[];
  pendadaran: Examiner[];
}

function incomplete(r: Row): boolean {
  if (!r.p1_id || !r.p2_id) return true;
  if (r.jenjang === 'S1' && (r.seminar.length < 1 || r.pendadaran.length < 2)) return true;
  return false;
}

export function PenetapanPembimbing() {
  const { active } = useAuth();
  const prodiId = active!.prodi_id!;
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useQueryState<'belum' | 'semua'>('tab', 'belum');
  const [q, setQ] = useState('');
  const [target, setTarget] = useState<Row | null>(null);

  const st = useAsync(async () => {
    const prog = (await must(supabase.from('v_thesis_progress').select('*').eq('prodi_id', prodiId).eq('status', 'aktif').order('mahasiswa_nama'))) as Progress[];
    const ids = prog.map((p) => p.thesis_id);
    if (!ids.length) return [] as Row[];
    const [ex, th] = await Promise.all([
      must(supabase.from('thesis_examiners').select('*, dosen:profiles!thesis_examiners_dosen_id_fkey(nama)').in('thesis_id', ids).eq('aktif', true).order('urutan')),
      must(supabase.from('thesis').select('id, pendadaran_wakil').in('id', ids)),
    ]);
    const exs = ex as Examiner[];
    const wakil = new Map((th as { id: string; pendadaran_wakil: 'P1' | 'P2' }[]).map((t) => [t.id, t.pendadaran_wakil]));
    return prog.map((p) => ({
      ...p,
      wakil: wakil.get(p.thesis_id) ?? 'P1',
      seminar: exs.filter((e) => e.thesis_id === p.thesis_id && e.tahap === 'seminar'),
      pendadaran: exs.filter((e) => e.thesis_id === p.thesis_id && e.tahap === 'pendadaran'),
    })) as Row[];
  }, [prodiId]);

  useEffect(() => {
    const id = params.get('thesis');
    if (id && st.data) {
      const t = st.data.find((r) => r.thesis_id === id);
      if (t) setTarget(t);
      params.delete('thesis');
      setParams(params, { replace: true });
    }
  }, [params, setParams, st.data]);

  if (st.loading && !st.data) return <Loading />;
  if (st.error) return <ErrorNote error={st.error} onRetry={st.reload} />;
  const all = st.data ?? [];
  const belum = all.filter(incomplete);
  const rows = (filter === 'belum' ? belum : all).filter((r) => !q || `${r.mahasiswa_nama} ${r.nim} ${r.judul}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <>
      <PageHeader
        title="Ploting dosen"
        description="Tetapkan Pembimbing 1 dan 2, penguji Seminar Proposal dan Seminar Hasil, serta tim penguji Pendadaran (satu wakil pembimbing dan dua dosen di luar pembimbing)."
      />
      <Tabs
        value={filter}
        onChange={setFilter}
        items={[
          { value: 'belum', label: `Belum lengkap (${belum.length})` },
          { value: 'semua', label: `Semua mahasiswa aktif (${all.length})` },
        ]}
      />
      <div className="row" style={{ marginBottom: 14 }}>
        <input style={{ maxWidth: 340 }} placeholder="Cari nama, NIM, atau judul" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Cari" />
      </div>
      <Panel flush>
        {rows.length === 0 ? (
          <p className="muted small" style={{ padding: 18 }}>
            {filter === 'belum' ? 'Ploting semua mahasiswa aktif sudah lengkap.' : 'Tidak ada data.'}
          </p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Mahasiswa</th>
                  <th>Pembimbing</th>
                  <th>Penguji seminar</th>
                  <th>Tim pendadaran</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.thesis_id}>
                    <td>
                      <Link to={`/mahasiswa-bimbingan/${r.thesis_id}`} className="strong">
                        {r.mahasiswa_nama}
                      </Link>
                      <div className="muted small">
                        {r.nim}, {r.jenjang}
                      </div>
                    </td>
                    <td className="small">
                      <div>P1: {r.p1_nama ?? <Badge tone="warn">Belum</Badge>}</div>
                      <div>P2: {r.p2_nama ?? <Badge tone="warn">Belum</Badge>}</div>
                    </td>
                    <td className="small">
                      {r.jenjang === 'D3' ? <span className="muted">Tidak diperlukan</span> : r.seminar[0]?.dosen?.nama ?? <Badge tone="warn">Belum</Badge>}
                    </td>
                    <td className="small">
                      {r.jenjang === 'D3' ? (
                        <span className="muted">Tidak diperlukan</span>
                      ) : r.pendadaran.length === 2 ? (
                        <>
                          <div>{r.pendadaran.map((e) => e.dosen?.nama).join(', ')}</div>
                          <div className="muted">Wakil pembimbing: {r.wakil === 'P1' ? r.p1_nama : r.p2_nama}</div>
                        </>
                      ) : (
                        <Badge tone="warn">Belum</Badge>
                      )}
                    </td>
                    <td>
                      <Button size="sm" onClick={() => setTarget(r)}>
                        Atur ploting
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <PlotModal
        row={target}
        prodiId={prodiId}
        onClose={() => setTarget(null)}
        onDone={() => {
          setTarget(null);
          st.reload();
        }}
      />
    </>
  );
}

function PlotModal({ row, prodiId, onClose, onDone }: { row: Row | null; prodiId: string; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [allProdi, setAllProdi] = useState(false);
  const { list } = useDosenLoad(allProdi ? null : prodiId, !!row);
  const [p1, setP1] = useState('');
  const [p2, setP2] = useState('');
  const [alasan, setAlasan] = useState('');
  const [pg, setPg] = useState('');
  const [pd1, setPd1] = useState('');
  const [pd2, setPd2] = useState('');
  const [wakil, setWakil] = useState<'P1' | 'P2'>('P1');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!row) return;
    setP1(row.p1_id ?? '');
    setP2(row.p2_id ?? '');
    setAlasan('');
    setPg(row.seminar[0]?.dosen_id ?? '');
    setPd1(row.pendadaran[0]?.dosen_id ?? '');
    setPd2(row.pendadaran[1]?.dosen_id ?? '');
    setWakil(row.wakil);
    setErr(null);
  }, [row]);

  if (!row) return null;
  const s1 = row.jenjang === 'S1';
  const replacing = (row.p1_id && p1 !== row.p1_id) || (row.p2_id && p2 !== row.p2_id);
  const seminarChanged = s1 && pg && pg !== (row.seminar[0]?.dosen_id ?? '');
  const pendChanged =
    s1 && pd1 && pd2 && (pd1 !== (row.pendadaran[0]?.dosen_id ?? '') || pd2 !== (row.pendadaran[1]?.dosen_id ?? '') || wakil !== row.wakil);

  const save = async () => {
    setErr(null);
    if (!p1 || !p2) return setErr('Pembimbing 1 dan Pembimbing 2 wajib diisi');
    if (p1 === p2) return setErr('Pembimbing 1 dan 2 harus berbeda');
    if (replacing && !alasan.trim()) return setErr('Alasan wajib diisi saat mengganti pembimbing');
    if (s1 && pg && (pg === p1 || pg === p2)) return setErr('Penguji seminar harus di luar Pembimbing 1 dan 2');
    if (s1 && (pd1 || pd2) && (!pd1 || !pd2 || pd1 === pd2)) return setErr('Pilih dua penguji pendadaran yang berbeda');
    if (s1 && [pd1, pd2].some((d) => d && (d === p1 || d === p2))) return setErr('Penguji pendadaran harus di luar Pembimbing 1 dan 2');
    setBusy(true);
    try {
      if (p1 !== (row.p1_id ?? '')) await rpc('tetapkan_pembimbing', { p_thesis: row.thesis_id, p_dosen: p1, p_peran: 'P1', p_alasan: alasan.trim() || null });
      if (p2 !== (row.p2_id ?? '')) await rpc('tetapkan_pembimbing', { p_thesis: row.thesis_id, p_dosen: p2, p_peran: 'P2', p_alasan: alasan.trim() || null });
      if (seminarChanged) await rpc('tetapkan_penguji', { p_thesis: row.thesis_id, p_tahap: 'seminar', p_dosen: [pg], p_wakil: null });
      if (pendChanged) await rpc('tetapkan_penguji', { p_thesis: row.thesis_id, p_tahap: 'pendadaran', p_dosen: [pd1, pd2], p_wakil: wakil });
      toast.show('Ploting disimpan', 'ok');
      onDone();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      wide
      title={`Ploting dosen untuk ${row.mahasiswa_nama}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Batal
          </Button>
          <Button variant="primary" loading={busy} onClick={save}>
            Simpan ploting
          </Button>
        </>
      }
    >
      <div className="stack">
        <p className="small muted">{row.judul}</p>
        <section className="stack-sm">
          <div className="label">Pembimbing</div>
          <div className="form-grid">
            <Field label="Pembimbing 1">
              <DosenSelect value={p1} onChange={setP1} list={list} exclude={[p2, pg, pd1, pd2]} ariaLabel="Pembimbing 1" />
            </Field>
            <Field label="Pembimbing 2">
              <DosenSelect value={p2} onChange={setP2} list={list} exclude={[p1, pg, pd1, pd2]} ariaLabel="Pembimbing 2" />
            </Field>
          </div>
          {replacing && (
            <Field label="Alasan penggantian pembimbing" hint="Wajib. Dikirim ke dosen sebelumnya dan tercatat di audit log.">
              <input value={alasan} onChange={(e) => setAlasan(e.target.value)} />
            </Field>
          )}
        </section>

        {s1 ? (
          <>
            <section className="stack-sm">
              <div className="label">Penguji Seminar Proposal dan Seminar Hasil</div>
              <DosenSelect value={pg} onChange={setPg} list={list} exclude={[p1, p2]} placeholder="Pilih penguji (di luar pembimbing)" ariaLabel="Penguji seminar" />
            </section>
            <section className="stack-sm">
              <div className="label">Tim penguji Pendadaran</div>
              <div className="row">
                <span className="small">Wakil pembimbing:</span>
                <label className="check small">
                  <input type="radio" name="wakil" checked={wakil === 'P1'} onChange={() => setWakil('P1')} /> Pembimbing 1
                </label>
                <label className="check small">
                  <input type="radio" name="wakil" checked={wakil === 'P2'} onChange={() => setWakil('P2')} /> Pembimbing 2
                </label>
              </div>
              <div className="form-grid">
                <Field label="Penguji 1 (di luar pembimbing)">
                  <DosenSelect value={pd1} onChange={setPd1} list={list} exclude={[p1, p2, pd2]} ariaLabel="Penguji pendadaran 1" />
                </Field>
                <Field label="Penguji 2 (di luar pembimbing)">
                  <DosenSelect value={pd2} onChange={setPd2} list={list} exclude={[p1, p2, pd1]} ariaLabel="Penguji pendadaran 2" />
                </Field>
              </div>
            </section>
          </>
        ) : (
          <div className="note small">Ujian D3 (Seminar Tertutup dan Komprehensif) dinilai oleh Pembimbing 1 dan 2, sehingga tidak memerlukan ploting penguji.</div>
        )}
        <label className="check small">
          <input type="checkbox" checked={allProdi} onChange={(e) => setAllProdi(e.target.checked)} /> Tampilkan dosen prodi lain
        </label>
        {err && <div className="note bad">{err}</div>}
      </div>
    </Modal>
  );
}
