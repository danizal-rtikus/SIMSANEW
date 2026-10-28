import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useAsync } from '../lib/useAsync';
import { must, supabase } from '../lib/supabase';
import { api } from '../lib/api';
import {
  SESSION_SELECT,
  getMilestones,
  getMyThesis,
  getMyTitleSubmissions,
  getProgress,
  getSupervisedProgress,
  rpc,
} from '../lib/queries';
import type { Progress, Session } from '../lib/types';
import { fmtDate, fmtDateTime, fmtDay, relativeDays } from '../lib/format';
import { ROLE_LABEL, SESSION_STATUS, TITLE_STATUS } from '../lib/labels';

const TITLE_LABEL = Object.fromEntries(Object.entries(TITLE_STATUS).map(([k, v]) => [k, v.label])) as Record<string, string>;
import { Badge, Button, Empty, ErrorNote, Facts, Loading, Panel, Progress as Bar } from '../components/ui';
import { MilestoneToc } from '../components/MilestoneToc';
import { RiskLabel, SessionBadge, ThesisBadge, TitleBadge } from '../components/StatusBits';
import { useProdi } from '../lib/master';
import { HomeHero } from '../components/HomeHero';

export function Dashboard() {
  const { active } = useAuth();
  switch (active?.role) {
    case 'mahasiswa':
      return <MahasiswaHome />;
    case 'dosen':
      return <DosenHome />;
    case 'kaprodi':
      return <KaprodiHome prodiId={active.prodi_id!} />;
    case 'baak':
      return <BaakHome />;
    case 'pimpinan':
      return <PimpinanHome />;
    case 'admin':
      return <AdminHome />;
    default:
      return <Loading />;
  }
}

function greeting(nama?: string) {
  const h = new Date().getHours();
  const w = h < 11 ? 'Selamat pagi' : h < 15 ? 'Selamat siang' : h < 18 ? 'Selamat sore' : 'Selamat malam';
  const first = (nama || '')
    .replace(/,.*$/, '')
    .split(/\s+/)
    .find((t) => t && !/^(dr|drs|dra|ir|prof|h|hj)\.?$/i.test(t));
  return `${w}, ${first || 'Anda'}`;
}

/* =====================================================================
   Mahasiswa
   ===================================================================== */
function MahasiswaHome() {
  const { userId, profile } = useAuth();
  const navigate = useNavigate();
  const st = useAsync(async () => {
    const thesis = await getMyThesis(userId!);
    if (!thesis) return { thesis: null, titles: await getMyTitleSubmissions(userId!) };
    const [progress, milestones, sessions] = await Promise.all([
      getProgress(thesis.id),
      getMilestones(thesis.id),
      must(supabase.from('guidance_sessions').select(SESSION_SELECT).eq('thesis_id', thesis.id).order('tanggal_usulan', { ascending: false }).limit(20)),
    ]);
    return { thesis, progress, milestones, sessions: sessions as Session[], titles: [] };
  }, [userId]);

  if (st.loading && !st.data) return <Loading />;
  if (st.error) return <ErrorNote error={st.error} onRetry={st.reload} />;
  const d = st.data!;

  if (!d.thesis) {
    const pending = d.titles.filter((t) => t.status === 'diajukan');
    const last = d.titles[0];
    return (
      <>
        <HomeHero
          title={greeting(profile?.nama)}
          lead="Langkah pertama studi akhir Anda adalah mendaftar dengan judul sementara dan sinopsis. Judul masih dapat diubah selama bimbingan."
          columns={[
            {
              title: 'Langkah awal',
              empty: '',
              items: [
                { label: 'Daftar tugas akhir', sub: 'Judul sementara dan sinopsis', to: '/judul' },
                { label: 'Baca pedoman penulisan', to: '/pedoman' },
                { label: 'Lengkapi profil', to: '/profil' },
              ],
            },
            {
              title: 'Pendaftaran',
              to: '/judul',
              empty: 'Belum ada pendaftaran.',
              items: d.titles.slice(0, 5).map((t) => ({ label: t.judul, sub: TITLE_LABEL[t.status], to: '/judul' })),
            },
          ]}
        />
        <h2 className="section-title">Status pengajuan</h2>
        <Panel>
          {pending.length > 0 ? (
            <div className="stack">
              <div className="row-between">
                <div>
                  <div className="strong">Pendaftaran menunggu keputusan Ka. Prodi</div>
                  <div className="muted small">Dikirim {fmtDate(pending[0].created_at)}. Anda akan menerima notifikasi setelah ada keputusan.</div>
                </div>
                <Button onClick={() => navigate('/judul')}>Lihat pendaftaran</Button>
              </div>
              <ul className="list" style={{ border: '1px solid var(--line)', borderRadius: 8 }}>
                {pending.map((t) => (
                  <li key={t.id} className="row-between">
                    <span>{t.judul}</span>
                    <TitleBadge s={t.status} />
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <Empty
              title={last && (last.status === 'revisi' || last.status === 'ditolak') ? 'Perbaiki pendaftaran Anda' : 'Belum mendaftar tugas akhir'}
              action={
                <Button variant="primary" onClick={() => navigate('/judul')}>
                  Daftar tugas akhir
                </Button>
              }
            >
              {last?.catatan_kaprodi
                ? `Catatan Ka. Prodi untuk pendaftaran terakhir: ${last.catatan_kaprodi}`
                : 'Siapkan judul sementara, ringkasan, dan file sinopsis (PDF atau Word).'}
            </Empty>
          )}
        </Panel>
      </>
    );
  }

  const p = d.progress!;
  const pendingFollowups = d.sessions.filter((s) => s.status === 'selesai' && s.tindak_lanjut && !s.tindak_lanjut_selesai);
  const upcoming = d.sessions.filter((s) => s.status === 'dijadwalkan' || s.status === 'diajukan');
  const lastDone = d.sessions.find((s) => s.status === 'selesai');

  return (
    <>
      <HomeHero
        title={greeting(profile?.nama)}
        lead={d.thesis.judul}
        columns={[
          {
            title: 'Milestone berikutnya',
            to: '/studi-akhir',
            empty: 'Semua milestone selesai.',
            items: d.milestones
              .filter((m) => m.status !== 'selesai')
              .slice(0, 5)
              .map((m) => ({ label: m.nama, sub: m.tenggat ? fmtDate(m.tenggat) : undefined, to: '/studi-akhir' })),
          },
          {
            title: 'Bimbingan',
            to: '/bimbingan',
            empty: 'Belum ada jadwal bimbingan.',
            items: d.sessions.slice(0, 5).map((s) => ({ label: s.topik, sub: SESSION_STATUS[s.status].label, to: `/bimbingan/${s.id}` })),
          },
        ]}
      />
      <div className="row-between">
        <h2 className="section-title">Ringkasan</h2>
        <Button variant="primary" onClick={() => navigate('/bimbingan?ajukan=1')}>
          Ajukan bimbingan
        </Button>
      </div>
      <div className="stack">
        <Facts
          items={[
            { label: 'Progres', value: `${Number(p.persen).toFixed(0)}%`, note: `${p.milestone_selesai} dari ${p.milestone_total} milestone` },
            { label: 'Tahap sekarang', value: <span style={{ fontSize: 17 }}>{p.milestone_nama ?? 'Selesai'}</span>, note: p.milestone_tenggat ? `Tenggat ${fmtDate(p.milestone_tenggat)} (${relativeDays(p.milestone_tenggat)})` : undefined },
            { label: 'Bimbingan tercatat', value: p.jumlah_bimbingan, note: p.bimbingan_terakhir ? `Terakhir ${fmtDate(p.bimbingan_terakhir)}` : 'Belum ada sesi selesai' },
            { label: 'Status', value: <span style={{ fontSize: 17 }}><RiskLabel r={p.risiko} /></span>, note: p.p1_nama ? `P1: ${p.p1_nama}` : 'Pembimbing belum ditetapkan' },
          ]}
        />
        <div className="grid-main">
          <Panel
            title="Milestone"
            sub={`${d.thesis.jenjang === 'S1' ? 'Skripsi' : 'Tugas Akhir'}, ${p.prodi_nama}`}
            actions={<Link to="/studi-akhir">Lihat semua</Link>}
            flush
          >
            <div style={{ padding: '12px 18px 0' }}>
              <Bar value={p.persen} />
            </div>
            <MilestoneToc milestones={d.milestones} compact />
          </Panel>
          <div className="stack">
            <Panel title="Tindak lanjut tertunda" flush>
              {pendingFollowups.length === 0 ? (
                <p className="muted small" style={{ padding: 18 }}>
                  Tidak ada tindak lanjut yang tertunda.
                </p>
              ) : (
                <ul className="list">
                  {pendingFollowups.map((s) => (
                    <li key={s.id}>
                      <Link to={`/bimbingan/${s.id}`} className="item">
                        <div className="strong">{s.tindak_lanjut}</div>
                        <div className="muted small">
                          {s.dosen?.nama}, {fmtDate(s.tanggal_jadwal)}
                        </div>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
            <Panel title="Jadwal bimbingan" flush>
              {upcoming.length === 0 ? (
                <p className="muted small" style={{ padding: 18 }}>
                  {lastDone ? `Bimbingan terakhir ${fmtDate(lastDone.tanggal_jadwal)} dengan ${lastDone.dosen?.nama}.` : 'Belum ada bimbingan.'}
                </p>
              ) : (
                <ul className="list">
                  {upcoming.map((s) => (
                    <li key={s.id}>
                      <Link to={`/bimbingan/${s.id}`} className="item row-between">
                        <span>
                          <span className="strong">{s.topik}</span>
                          <br />
                          <span className="muted small">
                            {s.dosen?.nama}, {fmtDateTime(s.tanggal_jadwal ?? s.tanggal_usulan)}
                          </span>
                        </span>
                        <SessionBadge s={s.status} />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        </div>
      </div>
    </>
  );
}

/* =====================================================================
   Dosen
   ===================================================================== */
function DosenHome() {
  const { userId, profile } = useAuth();
  const navigate = useNavigate();
  const st = useAsync(async () => {
    const weekEnd = new Date();
    weekEnd.setDate(weekEnd.getDate() + 7);
    const [students, waiting, scheduled, load] = await Promise.all([
      getSupervisedProgress(userId!),
      must(supabase.from('guidance_sessions').select(SESSION_SELECT).eq('dosen_id', userId!).eq('status', 'diajukan').order('tanggal_usulan')),
      must(
        supabase
          .from('guidance_sessions')
          .select(SESSION_SELECT)
          .eq('dosen_id', userId!)
          .eq('status', 'dijadwalkan')
          .lte('tanggal_jadwal', weekEnd.toISOString())
          .order('tanggal_jadwal'),
      ),
      rpc<{ dosen_id: string; kuota: number; bimbingan_aktif: number }[]>('beban_dosen', { p_prodi: null }),
    ]);
    const mine = load.find((x) => x.dosen_id === userId);
    return { students, waiting: waiting as Session[], scheduled: scheduled as Session[], mine };
  }, [userId]);

  if (st.loading && !st.data) return <Loading />;
  if (st.error) return <ErrorNote error={st.error} onRetry={st.reload} />;
  const d = st.data!;
  const red = d.students.filter((s) => s.risiko === 'merah').length;
  const yellow = d.students.filter((s) => s.risiko === 'kuning').length;

  return (
    <>
      <HomeHero
        title={greeting(profile?.nama)}
        lead="Ringkasan bimbingan Anda minggu ini."
        columns={[
          {
            title: 'Menunggu tanggapan',
            to: '/bimbingan',
            empty: 'Tidak ada pengajuan baru.',
            items: d.waiting.slice(0, 5).map((s) => ({ label: s.mahasiswa?.nama ?? s.topik, sub: s.topik, to: `/bimbingan/${s.id}` })),
          },
          {
            title: 'Mahasiswa bimbingan',
            to: '/dosen/mahasiswa',
            empty: 'Belum ada mahasiswa yang ditetapkan.',
            items: d.students.slice(0, 5).map((r) => ({ label: r.mahasiswa_nama, sub: r.milestone_nama ?? 'Selesai', to: `/mahasiswa-bimbingan/${r.thesis_id}` })),
          },
        ]}
      />
      <h2 className="section-title">Ringkasan</h2>
      <div className="stack">
        <Facts
          items={[
            { label: 'Mahasiswa bimbingan aktif', value: d.mine?.bimbingan_aktif ?? d.students.length, note: d.mine ? `Kuota ${d.mine.kuota}` : undefined },
            { label: 'Menunggu tanggapan', value: d.waiting.length, note: 'Pengajuan bimbingan' },
            { label: 'Jadwal 7 hari ke depan', value: d.scheduled.length },
            { label: 'Perlu perhatian', value: red + yellow, note: `${red} kritis, ${yellow} waspada` },
          ]}
        />
        <div className="grid-main">
          <Panel title="Mahasiswa bimbingan" actions={<Link to="/dosen/mahasiswa">Lihat semua</Link>} flush>
            <ProgressTable rows={d.students} onOpen={(r) => navigate(`/mahasiswa-bimbingan/${r.thesis_id}`)} emptyText="Belum ada mahasiswa yang ditetapkan kepada Anda." />
          </Panel>
          <div className="stack">
            <SessionMiniList title="Menunggu tanggapan" items={d.waiting} empty="Tidak ada pengajuan baru." />
            <SessionMiniList title="Jadwal minggu ini" items={d.scheduled} empty="Belum ada jadwal." showDay />
          </div>
        </div>
      </div>
    </>
  );
}

function SessionMiniList({ title, items, empty, showDay }: { title: string; items: Session[]; empty: string; showDay?: boolean }) {
  return (
    <Panel title={title} flush>
      {items.length === 0 ? (
        <p className="muted small" style={{ padding: 18 }}>
          {empty}
        </p>
      ) : (
        <ul className="list">
          {items.map((s) => (
            <li key={s.id}>
              <Link to={`/bimbingan/${s.id}`} className="item">
                <div className="strong">{s.mahasiswa?.nama}</div>
                <div className="small">{s.topik}</div>
                <div className="muted small">{showDay ? fmtDay(s.tanggal_jadwal) : `Usulan ${fmtDateTime(s.tanggal_usulan)}`}</div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export function ProgressTable({ rows, onOpen, emptyText, showProdi }: { rows: Progress[]; onOpen: (r: Progress) => void; emptyText: string; showProdi?: boolean }) {
  if (rows.length === 0) return <p className="muted small" style={{ padding: 18 }}>{emptyText}</p>;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Mahasiswa</th>
            {showProdi && <th>Prodi</th>}
            <th>Tahap</th>
            <th style={{ width: 130 }}>Progres</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.thesis_id} className="clickable" onClick={() => onOpen(r)}>
              <td>
                <div className="strong">{r.mahasiswa_nama}</div>
                <div className="muted small">{r.nim}</div>
              </td>
              {showProdi && <td className="small">{r.prodi_kode}</td>}
              <td className="small">{r.milestone_nama ?? 'Selesai'}</td>
              <td>
                <Bar value={r.persen} thin />
                <span className="small muted mono-num">{Number(r.persen).toFixed(0)}%</span>
              </td>
              <td>{r.status === 'aktif' ? <RiskLabel r={r.risiko} /> : <ThesisBadge s={r.status} />}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* =====================================================================
   Ka. Prodi
   ===================================================================== */
function KaprodiHome({ prodiId }: { prodiId: string }) {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const prodiList = useProdi();
  const prodi = prodiList.find((p) => p.id === prodiId);
  const st = useAsync(async () => {
    const [rows, judul, load, tmpl] = await Promise.all([
      must(supabase.from('v_thesis_progress').select('*').eq('prodi_id', prodiId).order('mahasiswa_nama')) as Promise<Progress[]>,
      must(supabase.from('title_submissions').select('id, judul, mahasiswa:profiles!title_submissions_mahasiswa_id_fkey(nama)').eq('prodi_id', prodiId).eq('status', 'diajukan').order('created_at')),
      rpc<{ dosen_id: string; nama: string; kuota: number; bimbingan_aktif: number; prodi_id: string }[]>('beban_dosen', { p_prodi: prodiId }),
      must(supabase.from('milestone_templates').select('urutan, nama, prodi_id, jenjang').order('urutan')),
    ]);
    const judulList = judul as unknown as { id: string; judul: string; mahasiswa?: { nama: string } | null }[];
    return { rows, judulCount: judulList.length, judulList, load, tmpl: tmpl as { urutan: number; nama: string; prodi_id: string | null; jenjang: string }[] };
  }, [prodiId]);

  if (st.loading && !st.data) return <Loading />;
  if (st.error) return <ErrorNote error={st.error} onRetry={st.reload} />;
  const d = st.data!;
  const aktif = d.rows.filter((r) => r.status === 'aktif');
  const tanpaPembimbing = aktif.filter((r) => !r.p1_id);
  const merah = aktif.filter((r) => r.risiko === 'merah');
  const kuning = aktif.filter((r) => r.risiko === 'kuning');

  // Sebaran tahap memakai template prodi (atau default institusi)
  const jenjang = prodi?.jenjang ?? 'S1';
  const own = d.tmpl.filter((t) => t.prodi_id === prodiId && t.jenjang === jenjang);
  const stages = (own.length ? own : d.tmpl.filter((t) => t.prodi_id === null && t.jenjang === jenjang)).map((t) => ({
    ...t,
    count: aktif.filter((r) => r.milestone_urutan === t.urutan).length,
  }));
  const maxStage = Math.max(1, ...stages.map((s) => s.count));

  return (
    <>
      <HomeHero
        title={greeting(profile?.nama)}
        lead={prodi ? `Program Studi ${prodi.nama} (${prodi.jenjang})` : undefined}
        columns={[
          {
            title: 'Judul menunggu verifikasi',
            to: '/kaprodi/judul',
            empty: 'Tidak ada judul yang menunggu.',
            items: d.judulList.slice(0, 5).map((j) => ({ label: j.mahasiswa?.nama ?? 'Mahasiswa', sub: j.judul, to: '/kaprodi/judul' })),
          },
          {
            title: 'Perlu perhatian',
            to: '/monitoring',
            empty: 'Semua mahasiswa aktif sesuai jadwal.',
            items: [...merah, ...kuning].slice(0, 5).map((r) => ({ label: r.mahasiswa_nama, sub: r.risiko === 'merah' ? 'Kritis' : 'Waspada', to: `/mahasiswa-bimbingan/${r.thesis_id}` })),
          },
        ]}
      />
      <h2 className="section-title">Ringkasan</h2>
      <div className="stack">
        <Facts
          items={[
            { label: 'Mahasiswa aktif', value: aktif.length },
            { label: 'Pendaftaran menunggu', value: d.judulCount },
            { label: 'Belum ada pembimbing', value: tanpaPembimbing.length },
            { label: 'Berisiko', value: merah.length + kuning.length, note: `${merah.length} kritis, ${kuning.length} waspada` },
          ]}
        />
        {(d.judulCount > 0 || tanpaPembimbing.length > 0) && (
          <div className="note info row-between">
            <span>
              Antrean persetujuan: {d.judulCount} pendaftaran dan {tanpaPembimbing.length} mahasiswa tanpa pembimbing.
            </span>
            <span className="row">
              {d.judulCount > 0 && (
                <Button size="sm" onClick={() => navigate('/kaprodi/judul')}>
                  Periksa pendaftaran
                </Button>
              )}
              {tanpaPembimbing.length > 0 && (
                <Button size="sm" onClick={() => navigate('/kaprodi/pembimbing')}>
                  Atur ploting
                </Button>
              )}
            </span>
          </div>
        )}
        <div className="grid-2">
          <Panel title="Sebaran tahap" sub="Jumlah mahasiswa aktif per milestone saat ini">
            <div className="bar-list">
              {stages.map((s) => (
                <div className="bar-row" key={s.urutan}>
                  <span>
                    {s.urutan}. {s.nama}
                  </span>
                  <span className="bar">
                    <span style={{ width: `${(s.count / maxStage) * 100}%` }} />
                  </span>
                  <span className="mono-num num">{s.count}</span>
                </div>
              ))}
            </div>
          </Panel>
          <Panel title="Beban bimbingan dosen" flush>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Dosen</th>
                    <th className="num">Aktif</th>
                    <th className="num">Kuota</th>
                  </tr>
                </thead>
                <tbody>
                  {d.load.map((l) => (
                    <tr key={l.dosen_id}>
                      <td>{l.nama}</td>
                      <td className="num">{l.bimbingan_aktif > l.kuota ? <Badge tone="bad">{l.bimbingan_aktif}</Badge> : l.bimbingan_aktif}</td>
                      <td className="num">{l.kuota}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
        <Panel title="Mahasiswa yang perlu perhatian" sub="Status kritis didahulukan" actions={<Link to="/monitoring">Monitoring lengkap</Link>} flush>
          <ProgressTable rows={[...merah, ...kuning]} onOpen={(r) => navigate(`/mahasiswa-bimbingan/${r.thesis_id}`)} emptyText="Semua mahasiswa aktif sesuai jadwal." />
        </Panel>
      </div>
    </>
  );
}

/* =====================================================================
   BAAK
   ===================================================================== */
function BaakHome() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const st = useAsync(async () => {
    const rows = (await must(supabase.from('v_thesis_progress').select('*').order('mahasiswa_nama'))) as Progress[];
    const ids = rows.map((r) => r.milestone_id).filter(Boolean) as string[];
    const ms = ids.length
      ? ((await must(supabase.from('thesis_milestones').select('id, jenis').in('id', ids))) as { id: string; jenis: string }[])
      : [];
    const kind = new Map(ms.map((m) => [m.id, m.jenis]));
    return { rows, kind };
  }, []);

  if (st.loading && !st.data) return <Loading />;
  if (st.error) return <ErrorNote error={st.error} onRetry={st.reload} />;
  const { rows, kind } = st.data!;
  const aktif = rows.filter((r) => r.status === 'aktif');
  const queue = aktif.filter((r) => r.milestone_id && ['seminar', 'penguji_setuju', 'arsip'].includes(kind.get(r.milestone_id) ?? ''));
  const lulus = rows.filter((r) => r.status === 'lulus');

  return (
    <>
      <HomeHero
        title={greeting(profile?.nama)}
        lead="Pencatatan seminar, ujian, dan arsip studi akhir."
        columns={[
          {
            title: 'Menunggu pencatatan',
            to: '/monitoring',
            empty: 'Tidak ada yang menunggu pencatatan.',
            items: queue.slice(0, 5).map((r) => ({ label: r.mahasiswa_nama, sub: r.milestone_nama ?? undefined, to: `/mahasiswa-bimbingan/${r.thesis_id}` })),
          },
          {
            title: 'Program studi',
            to: '/monitoring',
            empty: 'Belum ada data.',
            items: [...new Map(aktif.map((r) => [r.prodi_id, r])).values()].slice(0, 5).map((r) => ({
              label: r.prodi_nama,
              sub: `${aktif.filter((x) => x.prodi_id === r.prodi_id).length} aktif`,
              to: '/monitoring',
            })),
          },
        ]}
      />
      <h2 className="section-title">Ringkasan</h2>
      <div className="stack">
        <Facts
          items={[
            { label: 'Mahasiswa aktif', value: aktif.length },
            { label: 'Menunggu pencatatan', value: queue.length, note: 'Seminar, ujian, revisi, arsip' },
            { label: 'Lulus', value: lulus.length },
          ]}
        />
        <Panel title="Menunggu pencatatan seminar, ujian, atau arsip" sub="Buka mahasiswa untuk mencatat berita acara pada milestone terkait" flush>
          <ProgressTable rows={queue} showProdi onOpen={(r) => navigate(`/mahasiswa-bimbingan/${r.thesis_id}`)} emptyText="Tidak ada mahasiswa yang menunggu pencatatan." />
        </Panel>
        <div className="note">Penjadwalan ruang, penetapan penguji, dan penerbitan berita acara otomatis tersedia pada Fase 3.</div>
      </div>
    </>
  );
}

/* =====================================================================
   Pimpinan
   ===================================================================== */
function PimpinanHome() {
  const { profile } = useAuth();
  const st = useAsync(async () => (await must(supabase.from('v_thesis_progress').select('*'))) as Progress[], []);
  if (st.loading && !st.data) return <Loading />;
  if (st.error) return <ErrorNote error={st.error} onRetry={st.reload} />;
  const rows = st.data!;
  const byProdi = new Map<string, Progress[]>();
  rows.forEach((r) => byProdi.set(r.prodi_id, [...(byProdi.get(r.prodi_id) ?? []), r]));
  const aktif = rows.filter((r) => r.status === 'aktif');

  return (
    <>
      <HomeHero
        title={greeting(profile?.nama)}
        lead="Ringkasan studi akhir lintas program studi."
        columns={[
          {
            title: 'Program studi',
            to: '/monitoring',
            empty: 'Belum ada data studi akhir.',
            items: [...byProdi.values()].slice(0, 5).map((list) => ({
              label: list[0].prodi_nama,
              sub: `${list.filter((r) => r.status === 'aktif').length} aktif`,
              to: '/monitoring',
            })),
          },
          {
            title: 'Kritis',
            to: '/monitoring',
            empty: 'Tidak ada mahasiswa berstatus kritis.',
            items: aktif.filter((r) => r.risiko === 'merah').slice(0, 5).map((r) => ({ label: r.mahasiswa_nama, sub: r.prodi_kode, to: `/mahasiswa-bimbingan/${r.thesis_id}` })),
          },
        ]}
      />
      <h2 className="section-title">Ringkasan</h2>
      <div className="stack">
        <Facts
          items={[
            { label: 'Mahasiswa aktif', value: aktif.length },
            { label: 'Lulus', value: rows.filter((r) => r.status === 'lulus').length },
            { label: 'Rata-rata progres', value: `${aktif.length ? (aktif.reduce((a, r) => a + Number(r.persen), 0) / aktif.length).toFixed(0) : 0}%` },
            { label: 'Kritis', value: aktif.filter((r) => r.risiko === 'merah').length, note: `${aktif.filter((r) => r.risiko === 'kuning').length} waspada` },
          ]}
        />
        <Panel title="Per program studi" flush>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Program studi</th>
                  <th className="num">Aktif</th>
                  <th className="num">Lulus</th>
                  <th style={{ width: 160 }}>Rata-rata progres</th>
                  <th className="num">Sesuai jadwal</th>
                  <th className="num">Waspada</th>
                  <th className="num">Kritis</th>
                </tr>
              </thead>
              <tbody>
                {[...byProdi.entries()].map(([id, list]) => {
                  const a = list.filter((r) => r.status === 'aktif');
                  const avg = a.length ? a.reduce((s, r) => s + Number(r.persen), 0) / a.length : 0;
                  return (
                    <tr key={id}>
                      <td>
                        <span className="strong">{list[0].prodi_nama}</span> <span className="muted small">{list[0].jenjang}</span>
                      </td>
                      <td className="num">{a.length}</td>
                      <td className="num">{list.filter((r) => r.status === 'lulus').length}</td>
                      <td>
                        <Bar value={avg} thin /> <span className="small muted">{avg.toFixed(0)}%</span>
                      </td>
                      <td className="num">{a.filter((r) => r.risiko === 'hijau').length}</td>
                      <td className="num">{a.filter((r) => r.risiko === 'kuning').length}</td>
                      <td className="num">{a.filter((r) => r.risiko === 'merah').length}</td>
                    </tr>
                  );
                })}
                {byProdi.size === 0 && (
                  <tr>
                    <td colSpan={7} className="muted">
                      Belum ada data studi akhir.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>
    </>
  );
}

/* =====================================================================
   Admin
   ===================================================================== */
function AdminHome() {
  const { profile } = useAuth();
  const st = useAsync(async () => {
    const [roles, prodi, year, logs] = await Promise.all([
      must(supabase.from('user_roles').select('role')),
      must(supabase.from('prodi').select('id', { count: 'exact' })),
      must(supabase.from('academic_years').select('nama').eq('aktif', true).maybeSingle()),
      must(supabase.from('audit_logs').select('id, aksi, entitas, created_at').order('created_at', { ascending: false }).limit(8)),
    ]);
    let health: string;
    let healthProblems: string[] = [];
    try {
      const h = await api<{ supabase?: { ok: boolean; problems: string[] } }>('/health');
      health = h.supabase && !h.supabase.ok ? 'Perlu perbaikan' : 'Berjalan';
      healthProblems = h.supabase?.problems ?? [];
    } catch {
      health = 'Tidak terhubung';
      healthProblems = ['Server Node.js tidak dapat dihubungi. Jalankan "npm run dev" dari folder SIMSANew.'];
    }
    const count: Record<string, number> = {};
    (roles as { role: string }[]).forEach((r) => (count[r.role] = (count[r.role] ?? 0) + 1));
    return { count, prodi: (prodi as unknown[]).length, year: (year as { nama: string } | null)?.nama, logs: logs as { id: number; aksi: string; entitas: string; created_at: string }[], health, healthProblems };
  }, []);

  if (st.loading && !st.data) return <Loading />;
  if (st.error) return <ErrorNote error={st.error} onRetry={st.reload} />;
  const d = st.data!;
  return (
    <>
      <HomeHero
        title={greeting(profile?.nama)}
        lead="Pengelolaan akun, master data, dan konfigurasi SIMSA."
        columns={[
          {
            title: 'Pintasan',
            empty: '',
            items: [
              { label: 'Tambah atau impor pengguna', to: '/admin/pengguna' },
              { label: 'Program studi', to: '/admin/master' },
              { label: 'Tahun akademik', to: '/admin/master?tab=tahun' },
              { label: 'Template milestone', to: '/admin/master?tab=template' },
              { label: 'Kelola pedoman', to: '/pedoman/kelola' },
            ],
          },
          {
            title: 'Aktivitas terbaru',
            to: '/admin/audit',
            empty: 'Belum ada aktivitas.',
            items: d.logs.slice(0, 5).map((l) => ({ label: l.aksi.replace(/_/g, ' '), sub: fmtDateTime(l.created_at), to: '/admin/audit' })),
          },
        ]}
      />
      <h2 className="section-title">Ringkasan</h2>
      <div className="stack">
        <Facts
          items={[
            { label: 'Mahasiswa', value: d.count.mahasiswa ?? 0 },
            { label: 'Dosen', value: d.count.dosen ?? 0 },
            { label: 'Program studi', value: d.prodi },
            { label: 'Tahun akademik aktif', value: <span style={{ fontSize: 17 }}>{d.year ?? 'Belum diatur'}</span> },
            { label: 'Server Node.js', value: <span style={{ fontSize: 17 }}>{d.health}</span> },
          ]}
        />
        {d.healthProblems.length > 0 && (
          <div className="note bad">
            <div className="strong">Server SIMSA belum dapat mengelola akun</div>
            <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
              {d.healthProblems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
            <div style={{ marginTop: 6 }}>Perbaiki server/.env, lalu hentikan dan jalankan ulang "npm run dev".</div>
          </div>
        )}
        {!d.year && <div className="note warn">Belum ada tahun akademik aktif. Atur di Master data agar studi akhir baru tercatat pada tahun akademik yang benar.</div>}
        <div className="grid-2">
          <Panel title="Peran pengguna" flush>
            <table className="table">
              <tbody>
                {(['admin', 'pimpinan', 'kaprodi', 'baak', 'dosen', 'mahasiswa'] as const).map((r) => (
                  <tr key={r}>
                    <td>{ROLE_LABEL[r]}</td>
                    <td className="num">{d.count[r] ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
          <Panel title="Aktivitas terbaru" actions={<Link to="/admin/audit">Audit log</Link>} flush>
            <ul className="list">
              {d.logs.map((l) => (
                <li key={l.id} className="row-between small">
                  <span>
                    {l.aksi.replace(/_/g, ' ')} <span className="muted">pada {l.entitas}</span>
                  </span>
                  <span className="muted">{fmtDateTime(l.created_at)}</span>
                </li>
              ))}
              {d.logs.length === 0 && <li className="muted small">Belum ada aktivitas.</li>}
            </ul>
          </Panel>
        </div>
      </div>
    </>
  );
}
