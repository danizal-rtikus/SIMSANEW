import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { useAsync } from '../../lib/useAsync';
import { getSupervisedProgress } from '../../lib/queries';
import { ErrorNote, Loading, PageHeader, Panel } from '../../components/ui';
import { ProgressTable } from '../Dashboard';

export function DosenMahasiswa() {
  const { userId } = useAuth();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [risk, setRisk] = useState('');
  const st = useAsync(() => getSupervisedProgress(userId!), [userId]);

  if (st.loading && !st.data) return <Loading variant="table" />;
  if (st.error) return <ErrorNote error={st.error} onRetry={st.reload} />;
  const rows = (st.data ?? []).filter(
    (r) =>
      (!q || `${r.mahasiswa_nama} ${r.nim ?? ''} ${r.judul}`.toLowerCase().includes(q.toLowerCase())) &&
      (!risk || r.risiko === risk),
  );
  const peran = (r: { p1_id: string | null }) => (r.p1_id === userId ? 'P1' : 'P2');

  return (
    <>
      <PageHeader title="Mahasiswa bimbingan" description="Mahasiswa yang Anda bimbing sebagai Pembimbing 1 atau 2." />
      <div className="row" style={{ marginBottom: 14 }}>
        <input style={{ maxWidth: 320 }} placeholder="Cari nama, NIM, atau judul" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Cari mahasiswa" />
        <select style={{ maxWidth: 200 }} value={risk} onChange={(e) => setRisk(e.target.value)} aria-label="Filter status">
          <option value="">Semua status</option>
          <option value="merah">Kritis</option>
          <option value="kuning">Waspada</option>
          <option value="hijau">Sesuai jadwal</option>
        </select>
        <span className="muted small">
          {rows.length} mahasiswa, {rows.filter((r) => peran(r) === 'P1').length} sebagai P1
        </span>
      </div>
      <Panel flush>
        <ProgressTable rows={rows} onOpen={(r) => navigate(`/mahasiswa-bimbingan/${r.thesis_id}`)} emptyText="Tidak ada mahasiswa yang sesuai." />
      </Panel>
    </>
  );
}
