import { useNavigate } from 'react-router-dom';
import { useAsync } from '../../lib/useAsync';
import { rpc } from '../../lib/queries';
import { fmtDateTime } from '../../lib/format';
import { useQueryState } from '../../lib/shell';
import { roman } from '../../lib/naskah/struktur';
import type { ReviewQueueRow } from '../../lib/types';
import { Badge, ErrorNote, Loading, PageHeader, Panel, Tabs } from '../../components/ui';

type Tab = 'perlu' | 'semua';

const STATUS: Record<ReviewQueueRow['status'], { label: string; tone: 'info' | 'warn' | 'ok' | 'neutral' }> = {
  diajukan: { label: 'Menunggu review', tone: 'info' },
  revisi: { label: 'Revisi', tone: 'warn' },
  acc: { label: 'ACC', tone: 'ok' },
  ditarik: { label: 'Ditarik', tone: 'neutral' },
};

/** Antrean review naskah untuk dosen pembimbing. */
export function ReviewList() {
  const navigate = useNavigate();
  const [tab, setTab] = useQueryState<Tab>('f', 'perlu');
  const st = useAsync(async () => (await rpc<ReviewQueueRow[]>('antrean_review', {})) ?? [], []);
  if (st.loading && !st.data) return <Loading />;
  if (st.error) return <ErrorNote error={st.error} onRetry={st.reload} />;
  const all = st.data ?? [];
  const perlu = all.filter((r) => r.perlu_tinjau);
  const rows = tab === 'perlu' ? perlu : all;
  return (
    <>
      <PageHeader title="Review naskah" description="Bab yang diajukan mahasiswa bimbingan Anda. Buka pengajuan untuk memberi sorotan dan komentar, melihat perubahan sejak pengajuan sebelumnya, lalu memutuskan Revisi atau ACC." />
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        items={[
          { value: 'perlu', label: `Perlu ditinjau (${perlu.length})` },
          { value: 'semua', label: 'Semua pengajuan' },
        ]}
      />
      <Panel flush>
        {rows.length === 0 ? (
          <p className="muted small" style={{ padding: 18 }}>
            {tab === 'perlu' ? 'Tidak ada bab yang menunggu review Anda.' : 'Belum ada pengajuan bab dari mahasiswa bimbingan Anda.'}
          </p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Mahasiswa</th>
                  <th>Bab</th>
                  <th>Diajukan</th>
                  <th>Status</th>
                  <th>Peran Anda</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="clickable" onClick={() => navigate(`/naskah/${r.thesis_id}/ajuan/${r.id}`)}>
                    <td>
                      <div className="strong">{r.mahasiswa_nama}</div>
                      <div className="muted small">{r.nim}</div>
                    </td>
                    <td>
                      <span className="strong">BAB {roman(r.bab)}</span> {r.judul}
                      <div className="muted small">Pengajuan ke-{r.nomor}</div>
                    </td>
                    <td className="small mono-num" style={{ whiteSpace: 'nowrap' }}>
                      {fmtDateTime(r.created_at)}
                    </td>
                    <td>
                      <Badge tone={r.perlu_tinjau ? 'info' : STATUS[r.status].tone}>{r.perlu_tinjau ? 'Perlu ditinjau' : STATUS[r.status].label}</Badge>
                    </td>
                    <td className="small">{r.peran}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}
