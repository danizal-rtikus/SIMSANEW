import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { useAsync } from '../../lib/useAsync';
import { must, supabase } from '../../lib/supabase';
import { useProdi } from '../../lib/master';
import { effectiveStatus, MILESTONE_STATUS, RISK_LABEL } from '../../lib/labels';
import { fmtDate } from '../../lib/format';
import type { Milestone, Progress } from '../../lib/types';
import { Button, ErrorNote, Loading, PageHeader, Panel, Tabs } from '../../components/ui';
import { ProgressTable } from '../Dashboard';
import { useQueryState } from '../../lib/shell';

type View = 'tabel' | 'peta';

export function Monitoring() {
  const { active, userId } = useAuth();
  const navigate = useNavigate();
  const prodiList = useProdi();
  const scopedProdi = active?.role === 'kaprodi' ? active.prodi_id : active?.role === 'baak' ? active.prodi_id : null;
  const [view, setView] = useQueryState<View>('view', 'tabel');
  const [f, setF] = useState({ prodi: '', jenjang: '', angkatan: '', risiko: '', status: 'aktif', q: '' });

  const st = useAsync(async () => {
    let q = supabase.from('v_thesis_progress').select('*').order('prodi_kode').order('mahasiswa_nama');
    if (scopedProdi) q = q.eq('prodi_id', scopedProdi);
    if (active?.role === 'dosen') q = q.or(`p1_id.eq.${userId},p2_id.eq.${userId}`);
    return (await must(q.limit(2000))) as Progress[];
  }, [scopedProdi, active?.role, userId]);

  const rows = useMemo(
    () =>
      (st.data ?? []).filter(
        (r) =>
          (!f.prodi || r.prodi_id === f.prodi) &&
          (!f.jenjang || r.jenjang === f.jenjang) &&
          (!f.angkatan || String(r.angkatan) === f.angkatan) &&
          (!f.risiko || r.risiko === f.risiko) &&
          (!f.status || r.status === f.status) &&
          (!f.q || `${r.mahasiswa_nama} ${r.nim ?? ''} ${r.judul} ${r.p1_nama ?? ''} ${r.p2_nama ?? ''}`.toLowerCase().includes(f.q.toLowerCase())),
      ),
    [st.data, f],
  );
  const angkatan = [...new Set((st.data ?? []).map((r) => r.angkatan).filter(Boolean))].sort();

  const exportCsv = () => {
    const head = ['NIM', 'Nama', 'Prodi', 'Jenjang', 'Angkatan', 'Judul', 'Pembimbing 1', 'Pembimbing 2', 'Tahap', 'Tenggat', 'Progres (%)', 'Jumlah bimbingan', 'Bimbingan terakhir', 'Status', 'Risiko'];
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = rows.map((r) =>
      [r.nim, r.mahasiswa_nama, r.prodi_kode, r.jenjang, r.angkatan, r.judul, r.p1_nama, r.p2_nama, r.milestone_nama, fmtDate(r.milestone_tenggat), r.persen, r.jumlah_bimbingan, fmtDate(r.bimbingan_terakhir), r.status, RISK_LABEL[r.risiko]]
        .map(esc)
        .join(','),
    );
    const blob = new Blob(['﻿' + [head.map(esc).join(','), ...lines].join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `simsa-progres-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  return (
    <>
      <PageHeader
        title="Monitoring progres"
        description="Progres dan status risiko mahasiswa. Warna mengikuti ambang tiap prodi: lama tanpa bimbingan dan keterlambatan milestone."
        actions={<Button onClick={exportCsv} disabled={!rows.length}>Ekspor CSV</Button>}
      />
      <div className="row" style={{ marginBottom: 14 }}>
        <input style={{ maxWidth: 260 }} placeholder="Cari nama, NIM, judul, pembimbing" value={f.q} onChange={set('q')} aria-label="Cari" />
        {!scopedProdi && active?.role !== 'dosen' && (
          <select style={{ maxWidth: 220 }} value={f.prodi} onChange={set('prodi')} aria-label="Prodi">
            <option value="">Semua prodi</option>
            {prodiList.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nama} ({p.jenjang})
              </option>
            ))}
          </select>
        )}
        <select style={{ maxWidth: 130 }} value={f.jenjang} onChange={set('jenjang')} aria-label="Jenjang">
          <option value="">S1 dan D3</option>
          <option value="S1">S1</option>
          <option value="D3">D3</option>
        </select>
        <select style={{ maxWidth: 150 }} value={f.angkatan} onChange={set('angkatan')} aria-label="Angkatan">
          <option value="">Semua angkatan</option>
          {angkatan.map((a) => (
            <option key={String(a)} value={String(a)}>
              {a}
            </option>
          ))}
        </select>
        <select style={{ maxWidth: 160 }} value={f.risiko} onChange={set('risiko')} aria-label="Risiko">
          <option value="">Semua risiko</option>
          <option value="merah">Kritis</option>
          <option value="kuning">Waspada</option>
          <option value="hijau">Sesuai jadwal</option>
        </select>
        <select style={{ maxWidth: 150 }} value={f.status} onChange={set('status')} aria-label="Status studi">
          <option value="">Semua status</option>
          <option value="aktif">Aktif</option>
          <option value="cuti">Cuti</option>
          <option value="lulus">Lulus</option>
          <option value="berhenti">Berhenti</option>
        </select>
      </div>
      <Tabs<View>
        value={view}
        onChange={setView}
        items={[
          { value: 'tabel', label: `Tabel (${rows.length})` },
          { value: 'peta', label: 'Peta tahap' },
        ]}
      />
      {st.loading && !st.data ? (
        <Loading />
      ) : st.error ? (
        <ErrorNote error={st.error} onRetry={st.reload} />
      ) : view === 'tabel' ? (
        <Panel flush>
          <ProgressTable rows={rows} showProdi={!scopedProdi} onOpen={(r) => navigate(`/mahasiswa-bimbingan/${r.thesis_id}`)} emptyText="Tidak ada mahasiswa yang sesuai filter." />
        </Panel>
      ) : (
        <Heatmap rows={rows} />
      )}
    </>
  );
}

type MRow = Pick<Milestone, 'thesis_id' | 'urutan' | 'status' | 'tenggat' | 'nama'>;

function Heatmap({ rows }: { rows: Progress[] }) {
  const navigate = useNavigate();
  const ids = rows.slice(0, 300).map((r) => r.thesis_id);
  const st = useAsync(async () => {
    const out: MRow[] = [];
    for (let i = 0; i < ids.length; i += 100) {
      const part = await must(supabase.from('thesis_milestones').select('thesis_id, urutan, status, tenggat, nama').in('thesis_id', ids.slice(i, i + 100)));
      out.push(...(part as typeof out));
    }
    return out;
  }, [ids.join(',')]);

  if (st.loading && !st.data) return <Loading />;
  if (st.error) return <ErrorNote error={st.error} onRetry={st.reload} />;
  const byThesis = new Map<string, Map<number, MRow>>();
  (st.data ?? []).forEach((m) => {
    if (!byThesis.has(m.thesis_id)) byThesis.set(m.thesis_id, new Map());
    byThesis.get(m.thesis_id)!.set(m.urutan, m);
  });
  const maxCol = Math.max(0, ...(st.data ?? []).map((m) => m.urutan));
  const cols = Array.from({ length: maxCol }, (_, i) => i + 1);

  return (
    <Panel sub={rows.length > 300 ? 'Menampilkan 300 mahasiswa pertama. Persempit filter untuk melihat yang lain.' : 'Kolom adalah nomor milestone. Arahkan kursor ke kotak untuk nama tahap.'}>
      <div className="legend" style={{ marginBottom: 12 }}>
        {(['selesai', 'dikerjakan', 'menunggu_review', 'revisi', 'terlambat', 'belum_mulai'] as const).map((s) => (
          <span key={s}>
            <i className={`s-${s}`} />
            {MILESTONE_STATUS[s].label}
          </span>
        ))}
      </div>
      <div className="table-wrap">
        <table className="heat">
          <thead>
            <tr>
              <th className="name">Mahasiswa</th>
              {cols.map((c) => (
                <th key={c}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 300).map((r) => (
              <tr key={r.thesis_id}>
                <td className="name">
                  <button className="btn-link" onClick={() => navigate(`/mahasiswa-bimbingan/${r.thesis_id}`)}>
                    {r.mahasiswa_nama}
                  </button>{' '}
                  <span className="muted">{r.jenjang}</span>
                </td>
                {cols.map((c) => {
                  const m = byThesis.get(r.thesis_id)?.get(c);
                  if (!m) return <td key={c} />;
                  const s = effectiveStatus(m);
                  return <td key={c} className={`cell s-${s}`} title={`${m.nama}: ${MILESTONE_STATUS[s].label}`} />;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
