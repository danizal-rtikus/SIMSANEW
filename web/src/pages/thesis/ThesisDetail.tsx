import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { useAsync } from '../../lib/useAsync';
import { must, supabase } from '../../lib/supabase';
import { getDocuments, getMilestones, getMyThesis, getProgress, getSessionsForThesis, getSupervisors, getThesis, rpc } from '../../lib/queries';
import { fmtDate, fmtDateTime, fmtSize, relativeDays, toDateInput } from '../../lib/format';
import { EXAM_LABEL, EXAM_RESULT, EXAM_STATUS, MILESTONE_STATUS } from '../../lib/labels';
import { DRAFT_TYPES, openFile, uploadDraft, validateDraft } from '../../lib/files';
import type { Approval, Exam, Examiner, Milestone, MilestoneStatus } from '../../lib/types';
import { Badge, Button, Empty, ErrorNote, Facts, Field, Loading, PageHeader, Panel, Progress, Tabs } from '../../components/ui';
import { MilestoneToc } from '../../components/MilestoneToc';
import { TitleDirections, TitleRequestList, useTitleRequests } from '../../components/TitleRequest';
import { RiskLabel, ThesisBadge } from '../../components/StatusBits';
import { Modal, useDialog } from '../../components/Dialog';
import { useToast } from '../../components/Toast';
import { useQueryState, useRegisterEntity } from '../../lib/shell';
import { SessionTable } from '../bimbingan/BimbinganList';
import { IconFile, IconUpload } from '../../components/Icons';

export function MyThesis() {
  const { userId } = useAuth();
  const navigate = useNavigate();
  const st = useAsync(() => getMyThesis(userId!), [userId]);
  if (st.loading && !st.data) return <Loading variant="detail" />;
  if (st.error) return <ErrorNote error={st.error} onRetry={st.reload} />;
  if (!st.data)
    return (
      <>
        <PageHeader title="Studi akhir saya" />
        <Panel>
          <Empty title="Studi akhir belum dimulai" action={<Button onClick={() => navigate('/judul')}>Daftar tugas akhir</Button>}>
            Milestone dan draf akan muncul di sini setelah pendaftaran Anda diterima Ka. Prodi.
          </Empty>
        </Panel>
      </>
    );
  return <ThesisView thesisId={st.data.id} self />;
}

export function ThesisPage() {
  const { thesisId } = useParams();
  return <ThesisView thesisId={thesisId!} />;
}

type Tab = 'milestone' | 'bimbingan' | 'draf' | 'ujian' | 'riwayat';

interface HistoryRow {
  id: number;
  dari: MilestoneStatus | null;
  ke: MilestoneStatus | null;
  tenggat_lama: string | null;
  tenggat_baru: string | null;
  alasan: string | null;
  created_at: string;
  milestone?: { nama: string } | null;
  aktor_profile?: { nama: string } | null;
}

function ThesisView({ thesisId, self }: { thesisId: string; self?: boolean }) {
  const { userId, active } = useAuth();
  const dialog = useDialog();
  const navigate = useNavigate();
  const toast = useToast();
  const [tab, setTab] = useQueryState<Tab>('tab', 'milestone');
  const [deadlineFor, setDeadlineFor] = useState<Milestone | null>(null);
  const [statusOpen, setStatusOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);

  const st = useAsync(async () => {
    const thesis = await getThesis(thesisId);
    if (!thesis) return null;
    const [progress, milestones, sups, sessions, docs, history, mhs, approvals, examiners, exams] = await Promise.all([
      getProgress(thesisId),
      getMilestones(thesisId),
      getSupervisors(thesisId),
      getSessionsForThesis(thesisId),
      getDocuments(thesisId),
      must(
        supabase
          .from('milestone_history')
          .select('*, milestone:thesis_milestones(nama), aktor_profile:profiles(nama)')
          .eq('thesis_id', thesisId)
          .order('created_at', { ascending: false })
          .limit(200),
      ),
      must(supabase.from('profiles').select('nama, nim, angkatan, email, telepon').eq('id', thesis.mahasiswa_id).maybeSingle()),
      must(supabase.from('milestone_approvals').select('*').eq('thesis_id', thesisId)),
      must(supabase.from('thesis_examiners').select('*, dosen:profiles!thesis_examiners_dosen_id_fkey(nama)').eq('thesis_id', thesisId).eq('aktif', true).order('urutan')),
      must(supabase.from('exams').select('*').eq('thesis_id', thesisId).order('created_at', { ascending: false })),
    ]);
    return {
      thesis,
      progress: progress!,
      milestones,
      sups,
      sessions,
      docs,
      history: history as HistoryRow[],
      mhs: mhs as { nama: string; nim: string | null; angkatan: number | null; email: string | null; telepon: string | null } | null,
      approvals: approvals as Approval[],
      examiners: examiners as Examiner[],
      exams: exams as Exam[],
    };
  }, [thesisId]);

  useRegisterEntity(
    !self && st.data
      ? {
          kind: 'thesis',
          id: thesisId,
          title: st.data.mhs?.nama ?? st.data.progress?.mahasiswa_nama ?? 'Mahasiswa',
          sub: [st.data.mhs?.nim, st.data.progress?.prodi_kode].filter(Boolean).join(', '),
          basePath: `/mahasiswa-bimbingan/${thesisId}`,
        }
      : null,
  );

  if (st.loading && !st.data) return <Loading variant="detail" />;
  if (st.error) return <ErrorNote error={st.error} onRetry={st.reload} />;
  if (!st.data) return <ErrorNote error="Data studi akhir tidak ditemukan atau Anda tidak memiliki akses." />;
  const { thesis, progress: p, milestones, sups, sessions, docs, history, mhs, approvals, examiners, exams } = st.data;

  const role = active?.role;
  const isSupervisor = role === 'dosen' && sups.some((s) => s.dosen_id === userId);
  const isKaprodi = role === 'kaprodi' && active?.prodi_id === thesis.prodi_id;
  const isBaak = role === 'baak' && (!active?.prodi_id || active.prodi_id === thesis.prodi_id);
  const isAdmin = role === 'admin';
  const isOwner = userId === thesis.mahasiswa_id;
  const canDeadline = isSupervisor || isKaprodi || isAdmin;

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast.show(ok, 'ok');
      st.reload();
    } catch (e) {
      toast.show((e as Error).message, 'bad');
    }
  };

  const complete = async (m: Milestone, title: string, label: string) => {
    const catatan = await dialog.prompt({
      title,
      message: `${m.nama}. Bukti yang diharapkan: ${m.bukti}.`,
      label,
      required: true,
      confirmLabel: 'Simpan dan selesaikan',
    });
    if (catatan) run(() => rpc('selesaikan_milestone', { p_id: m.id, p_catatan: catatan }), `${m.nama} selesai`);
  };

  const showSyarat = async (m: Milestone) => {
    try {
      const r = await rpc<{ min_bimbingan: number; jumlah_bimbingan: number; bimbingan_cukup: boolean; milestone_sebelumnya_selesai: boolean; terpenuhi: boolean; catatan: string }>('cek_syarat_milestone', { p_milestone: m.id });
      await dialog.alert({
        title: r.terpenuhi ? 'Syarat terpenuhi' : 'Syarat belum terpenuhi',
        message: (
          <ul style={{ paddingLeft: 18, margin: 0 }}>
            <li>
              Bimbingan selesai: {r.jumlah_bimbingan} dari minimal {r.min_bimbingan} {r.bimbingan_cukup ? '(cukup)' : '(belum cukup)'}
            </li>
            <li>Milestone sebelumnya {r.milestone_sebelumnya_selesai ? 'sudah selesai' : 'belum selesai semua'}</li>
            <li>{r.catatan}</li>
          </ul>
        ),
      });
    } catch (e) {
      toast.show((e as Error).message, 'bad');
    }
  };

  const activeExam = (j: string | null) => exams.find((x) => x.jenis === j && (x.status === 'didaftarkan' || x.status === 'dijadwalkan'));
  const lastExam = (j: string | null) => exams.find((x) => x.jenis === j && x.status === 'selesai');

  const accBab = async (m: Milestone) => {
    const catatan = await dialog.prompt({
      title: `ACC ${m.nama}?`,
      message: 'Bab dinyatakan selesai setelah Pembimbing 1 dan Pembimbing 2 sama-sama memberi ACC.',
      label: 'Catatan (opsional)',
      confirmLabel: 'Beri ACC',
    });
    if (catatan === null) return;
    run(() => rpc('acc_bab', { p_milestone: m.id, p_catatan: catatan || null }), 'ACC tercatat');
  };

  const daftarUjian = async (m: Milestone) => {
    const label = EXAM_LABEL[m.ujian_jenis!];
    const ok = await dialog.confirm({
      title: `Daftar ${label}?`,
      message: 'Ka. Prodi dan BAAK akan menerima pendaftaran Anda lalu menjadwalkan ujian. Pastikan naskah terbaru sudah diunggah.',
      confirmLabel: `Daftar ${label}`,
    });
    if (!ok) return;
    try {
      const id = await rpc<string>('daftar_ujian', { p_thesis: thesis.id, p_jenis: m.ujian_jenis, p_catatan: null });
      toast.show('Pendaftaran ujian terkirim', 'ok');
      navigate(`/ujian/${id}`);
    } catch (e) {
      toast.show((e as Error).message, 'bad');
    }
  };

  const approvalChips = (m: Milestone) => {
    if (m.jenis !== 'pembimbing_setuju' || m.status === 'selesai') return null;
    const got = new Set(approvals.filter((a) => a.milestone_id === m.id).map((a) => a.peran));
    if (m.status === 'belum_mulai' && got.size === 0) return null;
    return (
      <div className="row" style={{ gap: 6, marginTop: 6 }}>
        {(['P1', 'P2'] as const).map((r) => (
          <Badge key={r} tone={got.has(r) ? 'ok' : 'neutral'}>
            {got.has(r) ? `ACC ${r}` : `Menunggu ACC ${r}`}
          </Badge>
        ))}
      </div>
    );
  };

  const actionsFor = (m: Milestone, isCurrent: boolean) => {
    const btns: ReactNode[] = [];
    if ((m.jenis === 'ujian' || m.jenis === 'revisi') && m.ujian_jenis) {
      const ex = activeExam(m.ujian_jenis) ?? lastExam(m.ujian_jenis);
      if (ex && (m.status !== 'selesai' || m.jenis === 'ujian'))
        btns.push(<Link key="ex" className="btn btn-sm" to={`/ujian/${ex.id}`}>{m.jenis === 'revisi' ? 'Lihat revisi' : 'Lihat ujian'}</Link>);
    }
    if (m.status === 'selesai' || thesis.status !== 'aktif') return btns.length ? <>{btns}</> : null;
    if (isCurrent) {
      if (m.jenis === 'pembimbing_setuju' && isSupervisor && !approvals.some((a) => a.milestone_id === m.id && a.dosen_id === userId))
        btns.unshift(<Button key="acc" size="sm" variant="primary" onClick={() => accBab(m)}>ACC bab ini</Button>);
      if (m.jenis === 'ujian' && isOwner && m.ujian_jenis && !activeExam(m.ujian_jenis))
        btns.unshift(<Button key="daftar" size="sm" variant="primary" onClick={() => daftarUjian(m)}>Daftar {EXAM_LABEL[m.ujian_jenis]}</Button>);
      if (m.jenis === 'berkas' && (isBaak || isAdmin))
        btns.push(<Button key="berkas" size="sm" variant="primary" onClick={() => complete(m, 'Nyatakan berkas lengkap', 'Keterangan verifikasi berkas')}>Nyatakan berkas lengkap</Button>);
      if (m.jenis === 'yudisium' && (isBaak || isAdmin || role === 'pimpinan'))
        btns.push(<Button key="yud" size="sm" variant="primary" onClick={() => complete(m, 'Catat hasil rapat yudisium', 'Tanggal rapat dan keputusan')}>Catat hasil yudisium</Button>);
      if (m.jenis === 'sk' && (isBaak || isAdmin || role === 'pimpinan'))
        btns.push(<Button key="sk" size="sm" variant="primary" onClick={() => complete(m, 'Catat SK penetapan', 'Nomor dan tanggal SK Ketua')}>Catat SK</Button>);
      if ((m.jenis === 'seminar' || m.jenis === 'penguji_setuju') && (isBaak || isKaprodi))
        btns.push(<Button key="sem" size="sm" variant="primary" onClick={() => complete(m, 'Catat hasil', 'Nomor berita acara dan hasil')}>Catat hasil</Button>);
      if (m.jenis === 'arsip' && (isBaak || isAdmin))
        btns.push(<Button key="arsip" size="sm" variant="primary" onClick={() => complete(m, 'Catat pengarsipan naskah final', 'Nomor arsip atau keterangan')}>Catat pengarsipan</Button>);
      if (m.jenis === 'syarat_otomatis') btns.push(<Button key="cek" size="sm" onClick={() => showSyarat(m)}>Cek syarat</Button>);
      if (canDeadline) btns.push(<Button key="dl" size="sm" variant="ghost" onClick={() => setDeadlineFor(m)}>Ubah tenggat</Button>);
    }
    return btns.length ? <>{btns}</> : null;
  };

  return (
    <>
      <PageHeader
        title={self ? 'Studi akhir saya' : mhs?.nama ?? p.mahasiswa_nama}
        description={thesis.judul}
        actions={
          <>
            {isOwner && thesis.status === 'aktif' && (
              <Button onClick={() => setUploadOpen(true)}>
                <IconUpload size={16} /> Unggah draf
              </Button>
            )}
            <Link className="btn" to={self ? '/naskah' : `/naskah/${thesis.id}`}>
              Buka naskah
            </Link>
            {isKaprodi && <Link className="btn" to={`/kaprodi/pembimbing?thesis=${thesis.id}&tab=semua`}>Atur ploting</Link>}
            {(isKaprodi || isAdmin) && <Button onClick={() => setStatusOpen(true)}>Ubah status studi</Button>}
          </>
        }
      />
      <div className="stack">
        <Facts
          items={[
            { label: 'Progres', value: `${Number(p.persen).toFixed(0)}%`, note: `${p.milestone_selesai} dari ${p.milestone_total} milestone` },
            { label: 'Tahap sekarang', value: <span style={{ fontSize: 17 }}>{p.milestone_nama ?? 'Semua selesai'}</span>, note: p.milestone_tenggat ? `Tenggat ${fmtDate(p.milestone_tenggat)} (${relativeDays(p.milestone_tenggat)})` : undefined },
            { label: 'Bimbingan selesai', value: p.jumlah_bimbingan, note: p.bimbingan_terakhir ? `Terakhir ${fmtDate(p.bimbingan_terakhir)}` : 'Belum ada' },
            { label: 'Status', value: <span style={{ fontSize: 17 }}>{thesis.status === 'aktif' ? <RiskLabel r={p.risiko} /> : <ThesisBadge s={thesis.status} />}</span>, note: p.hari_tanpa_bimbingan > 0 ? `${p.hari_tanpa_bimbingan} hari sejak bimbingan terakhir` : undefined },
          ]}
        />
        <Panel>
          <dl className="kv">
            {!self && (
              <>
                <dt>Mahasiswa</dt>
                <dd>
                  {mhs?.nama} <span className="muted">{mhs?.nim}</span>
                  {mhs?.angkatan && <span className="muted">, angkatan {mhs.angkatan}</span>}
                  <div className="small muted">{[mhs?.email, mhs?.telepon].filter(Boolean).join(', ')}</div>
                </dd>
              </>
            )}
            <dt>Program studi</dt>
            <dd>
              {p.prodi_nama} ({thesis.jenjang === 'S1' ? 'Skripsi S1' : 'Tugas Akhir D3'})
            </dd>
            <dt>Pembimbing</dt>
            <dd>
              {sups.length === 0 ? (
                <span className="muted">Belum ditetapkan</span>
              ) : (
                sups.map((s) => (
                  <div key={s.id}>
                    {s.peran === 'P1' ? 'Pembimbing 1' : 'Pembimbing 2'}: <span className="strong">{s.dosen?.nama}</span>
                  </div>
                ))
              )}
            </dd>
            {thesis.jenjang === 'S1' && (
              <>
                <dt>Penguji seminar</dt>
                <dd>{examiners.find((x) => x.tahap === 'seminar')?.dosen?.nama ?? <span className="muted">Belum diploting</span>}</dd>
                <dt>Tim pendadaran</dt>
                <dd>
                  {examiners.filter((x) => x.tahap === 'pendadaran').length === 2 ? (
                    <>
                      {examiners.filter((x) => x.tahap === 'pendadaran').map((x) => x.dosen?.nama).join(', ')}
                      <span className="muted">, bersama {thesis.pendadaran_wakil === 'P2' ? 'Pembimbing 2' : 'Pembimbing 1'}</span>
                    </>
                  ) : (
                    <span className="muted">Belum diploting</span>
                  )}
                </dd>
              </>
            )}
            {thesis.kata_kunci?.length > 0 && (
              <>
                <dt>Kata kunci</dt>
                <dd className="row" style={{ gap: 6 }}>
                  {thesis.kata_kunci.map((k) => (
                    <Badge key={k}>{k}</Badge>
                  ))}
                </dd>
              </>
            )}
            <dt>Mulai</dt>
            <dd>{fmtDate(thesis.mulai)}</dd>
          </dl>
        </Panel>

        <div>
          <ThesisTitleRequests thesisId={thesis.id} mode={isSupervisor ? 'pembimbing' : isOwner ? 'mahasiswa' : 'baca'} userId={userId ?? null} onChanged={st.reload} />
          <Tabs<Tab>
            value={tab}
            onChange={setTab}
            items={[
              { value: 'milestone', label: 'Milestone' },
              { value: 'bimbingan', label: `Sesi bimbingan (${sessions.length})` },
              { value: 'draf', label: `Berkas draf, cadangan (${docs.length})` },
              { value: 'ujian', label: `Ujian (${exams.length})` },
              { value: 'riwayat', label: 'Riwayat perubahan' },
            ]}
          />
          {tab === 'milestone' && (
            <Panel flush>
              <div style={{ padding: '14px 18px 4px' }}>
                <Progress value={p.persen} />
              </div>
              <MilestoneToc milestones={milestones} actions={actionsFor} extra={approvalChips} />
            </Panel>
          )}
          {tab === 'bimbingan' && (
            <Panel flush>
              <SessionTable sessions={sessions} who="dosen" empty="Belum ada sesi bimbingan." />
            </Panel>
          )}
          {tab === 'draf' && (
            <Panel flush>
              {docs.length === 0 ? (
                <p className="muted small" style={{ padding: 18 }}>
                  Belum ada draf yang diunggah.
                </p>
              ) : (
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Bab</th>
                        <th>Versi</th>
                        <th>Berkas</th>
                        <th>Diunggah</th>
                      </tr>
                    </thead>
                    <tbody>
                      {docs.map((d) => (
                        <tr key={d.id}>
                          <td>{d.bab}</td>
                          <td>v{d.versi}</td>
                          <td>
                            <button className="btn-link row" style={{ gap: 6 }} onClick={() => openFile('drafts', d.file_path).catch((e) => toast.show(e.message, 'bad'))}>
                              <IconFile size={16} /> {d.nama_file}
                            </button>
                            <div className="muted small">{[fmtSize(d.ukuran), d.catatan].filter(Boolean).join('. ')}</div>
                          </td>
                          <td className="small">
                            {d.pengunggah?.nama}
                            <div className="muted">{fmtDateTime(d.created_at)}</div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          )}
          {tab === 'ujian' && (
            <Panel flush>
              {exams.length === 0 ? (
                <p className="muted small" style={{ padding: 18 }}>Belum ada pendaftaran ujian.</p>
              ) : (
                <ul className="list">
                  {exams.map((x) => (
                    <li key={x.id}>
                      <Link to={`/ujian/${x.id}`} className="item row-between">
                        <span>
                          <span className="strong">{EXAM_LABEL[x.jenis]}</span>
                          {x.percobaan > 1 && <span className="muted"> (ke-{x.percobaan})</span>}
                          <div className="muted small">{x.tanggal ? `${fmtDateTime(x.tanggal)}, ${x.ruang ?? ''}` : 'Belum dijadwalkan'}</div>
                        </span>
                        <span className="row" style={{ gap: 6 }}>
                          {x.hasil ? <Badge tone={EXAM_RESULT[x.hasil].tone}>{EXAM_RESULT[x.hasil].label}</Badge> : <Badge tone={EXAM_STATUS[x.status].tone}>{EXAM_STATUS[x.status].label}</Badge>}
                          {x.nilai_akhir != null && <span className="mono-num small">{Number(x.nilai_akhir).toFixed(2)} ({x.huruf})</span>}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          )}
          {tab === 'riwayat' && (
            <Panel flush>
              <ul className="list">
                {history.map((h) => (
                  <li key={h.id}>
                    <div className="row-between small">
                      <span className="strong">{h.milestone?.nama}</span>
                      <span className="muted">{fmtDateTime(h.created_at)}</span>
                    </div>
                    <div className="small" style={{ marginTop: 4 }}>
                      {h.dari !== h.ke && h.ke && (
                        <>
                          {h.dari ? MILESTONE_STATUS[h.dari].label : '—'} menjadi <span className="strong">{MILESTONE_STATUS[h.ke].label}</span>.{' '}
                        </>
                      )}
                      {h.tenggat_lama !== h.tenggat_baru && (
                        <>
                          Tenggat {fmtDate(h.tenggat_lama)} menjadi <span className="strong">{fmtDate(h.tenggat_baru)}</span>.{' '}
                        </>
                      )}
                      {h.alasan && <span className="muted">{h.alasan}</span>}
                    </div>
                    {h.aktor_profile?.nama && <div className="muted small">oleh {h.aktor_profile.nama}</div>}
                  </li>
                ))}
                {history.length === 0 && <li className="muted small">Belum ada perubahan.</li>}
              </ul>
            </Panel>
          )}
        </div>
      </div>

      <DeadlineModal milestone={deadlineFor} onClose={() => setDeadlineFor(null)} onSubmit={(t, a) => run(() => rpc('ubah_tenggat_milestone', { p_id: deadlineFor!.id, p_tenggat: t, p_alasan: a }), 'Tenggat diperbarui').then(() => setDeadlineFor(null))} />
      <StatusModal open={statusOpen} current={thesis.status} onClose={() => setStatusOpen(false)} onSubmit={(s, a) => run(() => rpc('ubah_status_thesis', { p_thesis: thesis.id, p_status: s, p_alasan: a }), 'Status studi diperbarui').then(() => setStatusOpen(false))} />
      <UploadModal open={uploadOpen} milestones={milestones} onClose={() => setUploadOpen(false)} onSubmit={(file, bab, msId, cat) => run(() => uploadDraft({ thesisId: thesis.id, file, bab, milestoneId: msId, catatan: cat }), 'Draf diunggah').then(() => setUploadOpen(false))} />
    </>
  );
}

function DeadlineModal({ milestone, onClose, onSubmit }: { milestone: Milestone | null; onClose: () => void; onSubmit: (tenggat: string, alasan: string) => Promise<void> }) {
  const [t, setT] = useState('');
  const [a, setA] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<string | null>(null);
  if ((milestone?.id ?? null) !== last) {
    setLast(milestone?.id ?? null);
    setT(milestone?.tenggat ? toDateInput(milestone.tenggat) : '');
    setA('');
    setErr(null);
  }
  return (
    <Modal
      open={!!milestone}
      onClose={onClose}
      title="Ubah tenggat milestone"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Batal
          </Button>
          <Button
            variant="primary"
            loading={busy}
            onClick={async () => {
              if (!t) return setErr('Tanggal wajib diisi');
              if (!a.trim()) return setErr('Alasan wajib diisi');
              setBusy(true);
              await onSubmit(t, a.trim());
              setBusy(false);
            }}
          >
            Simpan tenggat
          </Button>
        </>
      }
    >
      <div className="stack-sm">
        <p className="muted">{milestone?.nama}</p>
        <Field label="Tenggat baru">
          <input type="date" value={t} onChange={(e) => setT(e.target.value)} />
        </Field>
        <Field label="Alasan perubahan" hint="Tercatat di riwayat milestone">
          <textarea style={{ minHeight: 60 }} value={a} onChange={(e) => setA(e.target.value)} />
        </Field>
        {err && <div className="note bad">{err}</div>}
      </div>
    </Modal>
  );
}

function StatusModal({ open, current, onClose, onSubmit }: { open: boolean; current: string; onClose: () => void; onSubmit: (s: string, alasan: string) => Promise<void> }) {
  const [s, setS] = useState(current === 'aktif' ? 'cuti' : 'aktif');
  const [a, setA] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Ubah status studi akhir"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Batal
          </Button>
          <Button
            variant={s === 'berhenti' ? 'danger-solid' : 'primary'}
            loading={busy}
            onClick={async () => {
              if (!a.trim()) return setErr('Alasan wajib diisi');
              setBusy(true);
              await onSubmit(s, a.trim());
              setBusy(false);
              setA('');
            }}
          >
            Simpan status
          </Button>
        </>
      }
    >
      <div className="stack-sm">
        <Field label="Status baru">
          <select value={s} onChange={(e) => setS(e.target.value)}>
            <option value="aktif" disabled={current === 'aktif'}>Aktif</option>
            <option value="cuti" disabled={current === 'cuti'}>Cuti akademik</option>
            <option value="berhenti" disabled={current === 'berhenti'}>Berhenti</option>
          </select>
        </Field>
        <Field label="Alasan">
          <textarea style={{ minHeight: 60 }} value={a} onChange={(e) => setA(e.target.value)} />
        </Field>
        {err && <div className="note bad">{err}</div>}
      </div>
    </Modal>
  );
}

function UploadModal({ open, milestones, onClose, onSubmit }: { open: boolean; milestones: Milestone[]; onClose: () => void; onSubmit: (f: File, bab: string, msId: string | null, catatan: string) => Promise<void> }) {
  const options = milestones.filter((m) => m.jenis === 'pembimbing_setuju' || m.jenis === 'arsip' || m.jenis === 'penguji_setuju');
  const current = milestones.find((m) => m.status !== 'selesai');
  const [ms, setMs] = useState<string>('');
  const [file, setFile] = useState<File | null>(null);
  const [cat, setCat] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastOpen, setLastOpen] = useState(false);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      setMs(current && options.some((o) => o.id === current.id) ? current.id : options[0]?.id ?? '');
      setFile(null);
      setCat('');
      setErr(null);
    }
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Unggah draf"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Batal
          </Button>
          <Button
            variant="primary"
            loading={busy}
            onClick={async () => {
              if (!file) return setErr('Pilih berkas');
              const v = validateDraft(file);
              if (v) return setErr(v);
              const m = milestones.find((x) => x.id === ms);
              setBusy(true);
              await onSubmit(file, m?.nama ?? 'Draf umum', m?.id ?? null, cat.trim());
              setBusy(false);
            }}
          >
            Unggah draf
          </Button>
        </>
      }
    >
      <div className="stack-sm">
        <Field label="Bab atau tahap">
          <select value={ms} onChange={(e) => setMs(e.target.value)}>
            {options.map((m) => (
              <option key={m.id} value={m.id}>
                {m.urutan}. {m.nama}
              </option>
            ))}
            <option value="">Draf umum</option>
          </select>
        </Field>
        <Field label="Berkas" hint="PDF, DOC, atau DOCX, maksimal 20 MB">
          <input type="file" accept={DRAFT_TYPES} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </Field>
        <Field label="Catatan">
          <textarea style={{ minHeight: 60 }} value={cat} onChange={(e) => setCat(e.target.value)} />
        </Field>
        <p className="muted small">Untuk meminta review, ajukan sesi bimbingan dan lampirkan draf di sana.</p>
        {err && <div className="note bad">{err}</div>}
      </div>
    </Modal>
  );
}

/** Usulan perubahan judul yang menunggu tanggapan, beserta arahan penguji. */
function ThesisTitleRequests({ thesisId, mode, userId, onChanged }: { thesisId: string; mode: 'pembimbing' | 'mahasiswa' | 'baca'; userId: string | null; onChanged: () => void }) {
  const tr = useTitleRequests(thesisId);
  const pending = tr.data?.pending;
  const dirs = (tr.data?.directions ?? []).filter((d) => !d.selesai);
  if (!pending && !dirs.length) return null;
  return (
    <Panel title="Perubahan judul" sub={pending ? 'Judul baru berlaku setelah Pembimbing 1 dan 2 menyetujui' : undefined} className="title-req-panel">
      <div className="stack-sm">
        <TitleDirections list={dirs} />
        {pending && (
          <TitleRequestList
            requests={[pending]}
            mode={mode}
            myId={userId}
            onChanged={() => {
              tr.reload();
              onChanged();
            }}
          />
        )}
      </div>
    </Panel>
  );
}
