import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { useAsync } from '../../lib/useAsync';
import { must, supabase } from '../../lib/supabase';
import { useQueryState } from '../../lib/shell';
import { fmtDateTime } from '../../lib/format';
import { EXAM_LABEL, EXAM_RESULT, EXAM_STATUS, examHasRevision } from '../../lib/labels';
import type { Exam, PanelMember } from '../../lib/types';
import { Badge, ErrorNote, Loading, PageHeader, Panel, Tabs } from '../../components/ui';

export const EXAM_SELECT = '*, thesis:thesis_id(id, judul, jenjang, prodi_id, mahasiswa_id, mahasiswa:profiles(nama, nim))';

type StaffTab = 'didaftarkan' | 'dijadwalkan' | 'selesai' | 'dibatalkan';
type DosenTab = 'nilai' | 'putuskan' | 'revisi' | 'riwayat';

export function UjianList() {
  const { active } = useAuth();
  if (active?.role === 'dosen') return <DosenExams />;
  if (active?.role === 'mahasiswa') return <MyExams />;
  return <StaffExams />;
}

function ExamTable({ rows, extra }: { rows: Exam[]; extra?: (e: Exam) => ReactNode }) {
  const navigate = useNavigate();
  if (rows.length === 0) return <p className="muted small" style={{ padding: 18 }}>Tidak ada ujian pada daftar ini.</p>;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Mahasiswa</th>
            <th>Ujian</th>
            <th>Jadwal</th>
            <th>Status</th>
            <th>Hasil</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => (
            <tr key={e.id} className="clickable" onClick={() => navigate(`/ujian/${e.id}`)}>
              <td>
                <div className="strong">{e.thesis?.mahasiswa?.nama}</div>
                <div className="muted small">{e.thesis?.mahasiswa?.nim}</div>
              </td>
              <td>
                {EXAM_LABEL[e.jenis]}
                {e.percobaan > 1 && <span className="muted small"> (ke-{e.percobaan})</span>}
                {extra && <div className="small">{extra(e)}</div>}
              </td>
              <td className="small mono-num" style={{ whiteSpace: 'nowrap' }}>
                {e.tanggal ? fmtDateTime(e.tanggal) : <span className="muted">Belum dijadwalkan</span>}
                {e.ruang && <div className="muted">{e.ruang}</div>}
              </td>
              <td>
                <Badge tone={EXAM_STATUS[e.status].tone}>{EXAM_STATUS[e.status].label}</Badge>
              </td>
              <td className="small">
                {e.hasil ? (
                  <>
                    <Badge tone={EXAM_RESULT[e.hasil].tone}>{EXAM_RESULT[e.hasil].label}</Badge>
                    <div className="muted mono-num">
                      {Number(e.nilai_akhir).toFixed(2)} ({e.huruf})
                    </div>
                  </>
                ) : (
                  <span className="muted">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StaffExams() {
  const { active } = useAuth();
  const [tab, setTab] = useQueryState<StaffTab>('f', 'didaftarkan');
  const st = useAsync(async () => {
    let rows = (await must(supabase.from('exams').select(EXAM_SELECT).order('tanggal', { ascending: true, nullsFirst: true }).limit(1000))) as Exam[];
    if (active?.role === 'kaprodi') rows = rows.filter((r) => r.thesis?.prodi_id === active.prodi_id);
    return rows;
  }, [active?.role, active?.prodi_id]);
  if (st.loading && !st.data) return <Loading variant="table" />;
  if (st.error) return <ErrorNote error={st.error} onRetry={st.reload} />;
  const all = st.data ?? [];
  const count = (s: StaffTab) => all.filter((e) => e.status === s).length;
  const rows = all.filter((e) => e.status === tab);
  if (tab === 'selesai' || tab === 'dibatalkan') rows.reverse();
  return (
    <>
      <PageHeader title="Ujian" description="Jadwalkan Seminar Proposal, Seminar Hasil, Pendadaran, dan ujian D3. Panel penguji diambil dari ploting Ka. Prodi." />
      <Tabs<StaffTab>
        value={tab}
        onChange={setTab}
        items={[
          { value: 'didaftarkan', label: `Perlu dijadwalkan (${count('didaftarkan')})` },
          { value: 'dijadwalkan', label: `Terjadwal (${count('dijadwalkan')})` },
          { value: 'selesai', label: `Selesai (${count('selesai')})` },
          { value: 'dibatalkan', label: 'Dibatalkan' },
        ]}
      />
      <Panel flush>
        <ExamTable
          rows={rows}
          extra={(e) => (e.status === 'selesai' && e.hasil && examHasRevision(e.jenis) && e.hasil !== 'mengulang' ? (e.revisi_selesai_at ? 'Revisi selesai' : 'Revisi berjalan') : null)}
        />
      </Panel>
    </>
  );
}

function DosenExams() {
  const { userId } = useAuth();
  const [tab, setTab] = useQueryState<DosenTab>('f', 'nilai');
  const st = useAsync(async () => {
    const panel = (await must(supabase.from('exam_panel').select('*').eq('dosen_id', userId!))) as PanelMember[];
    if (!panel.length) return { panel, exams: [] as Exam[] };
    const exams = (await must(supabase.from('exams').select(EXAM_SELECT).in('id', panel.map((p) => p.exam_id)).order('tanggal'))) as Exam[];
    return { panel, exams };
  }, [userId]);
  if (st.loading && !st.data) return <Loading variant="table" />;
  if (st.error) return <ErrorNote error={st.error} onRetry={st.reload} />;
  const { panel, exams } = st.data!;
  const mine = new Map(panel.map((p) => [p.exam_id, p]));
  const groups: Record<DosenTab, Exam[]> = {
    nilai: exams.filter((e) => e.status === 'dijadwalkan' && !mine.get(e.id)?.dinilai_at),
    putuskan: exams.filter((e) => e.status === 'dijadwalkan' && mine.get(e.id)?.ketua && mine.get(e.id)?.dinilai_at),
    revisi: exams.filter((e) => e.status === 'selesai' && (e.hasil === 'lulus_minor' || e.hasil === 'lulus_mayor') && !e.revisi_selesai_at && !mine.get(e.id)?.acc_revisi_at),
    riwayat: [...exams].reverse(),
  };
  return (
    <>
      <PageHeader title="Ujian saya" description="Ujian yang Anda nilai sebagai pembimbing atau penguji, keputusan hasil sebagai ketua sidang, dan ACC revisi." />
      <Tabs<DosenTab>
        value={tab}
        onChange={setTab}
        items={[
          { value: 'nilai', label: `Perlu dinilai (${groups.nilai.length})` },
          { value: 'putuskan', label: `Ketua sidang (${groups.putuskan.length})` },
          { value: 'revisi', label: `Revisi menunggu ACC (${groups.revisi.length})` },
          { value: 'riwayat', label: 'Semua' },
        ]}
      />
      <Panel flush>
        <ExamTable rows={groups[tab]} extra={(e) => <span className="muted">{mine.get(e.id)?.peran}{mine.get(e.id)?.ketua ? ', ketua sidang' : ''}</span>} />
      </Panel>
    </>
  );
}

function MyExams() {
  const { userId } = useAuth();
  const st = useAsync(async () => {
    const rows = (await must(supabase.from('exams').select(EXAM_SELECT).order('created_at', { ascending: false }))) as Exam[];
    return rows.filter((r) => r.thesis?.mahasiswa_id === userId);
  }, [userId]);
  if (st.loading && !st.data) return <Loading variant="table" />;
  if (st.error) return <ErrorNote error={st.error} onRetry={st.reload} />;
  return (
    <>
      <PageHeader title="Ujian" description="Pendaftaran ujian dibuka dari halaman Studi akhir saya ketika semua bab sebelumnya sudah di-ACC Pembimbing 1 dan 2." />
      <Panel flush>
        <ExamTable rows={st.data ?? []} />
      </Panel>
    </>
  );
}
