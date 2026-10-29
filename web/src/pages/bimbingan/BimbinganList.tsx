import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { useAsync } from '../../lib/useAsync';
import { must, supabase } from '../../lib/supabase';
import { SESSION_SELECT, getMilestones, getMyThesis, getSupervisors, rpc } from '../../lib/queries';
import { fmtDateTime, fromLocalInput, toLocalInput } from '../../lib/format';
import { MODE_LABEL, SESSION_RESULT } from '../../lib/labels';
import { DRAFT_TYPES, uploadDraft, validateDraft } from '../../lib/files';
import type { Milestone, Session, SessionStatus, Supervisor, Thesis } from '../../lib/types';
import { Badge, Button, Empty, ErrorNote, Field, Loading, PageHeader, Panel, Tabs } from '../../components/ui';
import { SessionBadge } from '../../components/StatusBits';
import { Modal } from '../../components/Dialog';
import { useToast } from '../../components/Toast';
import { useQueryState } from '../../lib/shell';
import { SplitView, useSplit } from '../../components/SplitView';
import { SessionDetail } from './SessionDetail';

export function BimbinganList() {
  const { active } = useAuth();
  return active?.role === 'dosen' ? <DosenSessions /> : <MahasiswaSessions />;
}

/* ------------------------------------------------------------------ */
function MahasiswaSessions() {
  const { userId } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState(false);
  const split = useSplit();

  const st = useAsync(async () => {
    const thesis = await getMyThesis(userId!);
    if (!thesis) return { thesis: null as Thesis | null, sessions: [] as Session[], sups: [] as Supervisor[], ms: [] as Milestone[] };
    const [sessions, sups, ms] = await Promise.all([
      must(supabase.from('guidance_sessions').select(SESSION_SELECT).eq('thesis_id', thesis.id).order('tanggal_usulan', { ascending: false })),
      getSupervisors(thesis.id),
      getMilestones(thesis.id),
    ]);
    return { thesis, sessions: sessions as Session[], sups, ms };
  }, [userId]);

  useEffect(() => {
    if (params.get('ajukan') && st.data?.thesis && st.data.sups.length) {
      setOpen(true);
      params.delete('ajukan');
      setParams(params, { replace: true });
    }
  }, [params, setParams, st.data]);

  if (st.loading && !st.data) return <Loading variant="table" />;
  if (st.error) return <ErrorNote error={st.error} onRetry={st.reload} />;
  const d = st.data!;

  if (!d.thesis) {
    return (
      <>
        <PageHeader title="Bimbingan" />
        <Panel>
          <Empty title="Bimbingan dimulai setelah pendaftaran diterima" action={<Button onClick={() => navigate('/judul')}>Ke pendaftaran</Button>}>
            Daftar tugas akhir terlebih dahulu. Setelah diterima dan pembimbing ditetapkan, Anda dapat mengajukan sesi bimbingan di sini.
          </Empty>
        </Panel>
      </>
    );
  }

  const noSup = d.sups.length === 0;
  const thesisActive = d.thesis.status === 'aktif';

  return (
    <>
      <PageHeader
        title="Bimbingan"
        description="Ajukan sesi, unggah draf, lalu ikuti catatan dan tindak lanjut dari pembimbing."
        actions={
          <Button variant="primary" disabled={noSup || !thesisActive} onClick={() => setOpen(true)}>
            Ajukan bimbingan
          </Button>
        }
      />
      {noSup && <div className="note info" style={{ marginBottom: 16 }}>Pembimbing belum ditetapkan oleh Ka. Prodi. Pengajuan bimbingan dapat dilakukan setelah penetapan.</div>}
      <SplitView
        open={!!split.id}
        list={
          <Panel flush>
            <SessionTable sessions={d.sessions} who="dosen" empty="Belum ada sesi bimbingan." onOpen={split.wide ? split.open : undefined} activeId={split.id} compact={!!split.id} />
          </Panel>
        }
        detail={split.id && <SessionDetail key={split.id} id={split.id} embedded onClose={split.close} onChanged={st.reload} />}
      />
      <AjukanBimbinganModal
        open={open}
        onClose={() => setOpen(false)}
        thesis={d.thesis}
        sups={d.sups}
        milestones={d.ms}
        onDone={(id) => {
          setOpen(false);
          navigate(`/bimbingan/${id}`);
        }}
      />
    </>
  );
}

/* ------------------------------------------------------------------ */
type Filter = 'diajukan' | 'dijadwalkan' | 'selesai' | 'semua';
function DosenSessions() {
  const { userId } = useAuth();
  const [filter, setFilter] = useQueryState<Filter>('f', 'diajukan');
  const split = useSplit();
  const st = useAsync(
    async () => (await must(supabase.from('guidance_sessions').select(SESSION_SELECT).eq('dosen_id', userId!).order('tanggal_usulan', { ascending: false }).limit(500))) as Session[],
    [userId],
  );
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    (st.data ?? []).forEach((s) => (c[s.status] = (c[s.status] ?? 0) + 1));
    return c;
  }, [st.data]);

  if (st.loading && !st.data) return <Loading variant="table" />;
  if (st.error) return <ErrorNote error={st.error} onRetry={st.reload} />;
  const rows = (st.data ?? []).filter((s) => filter === 'semua' || s.status === filter);
  const ordered = filter === 'dijadwalkan' ? [...rows].sort((a, b) => (a.tanggal_jadwal ?? '').localeCompare(b.tanggal_jadwal ?? '')) : rows;

  return (
    <>
      <PageHeader title="Bimbingan" description="Tanggapi pengajuan, isi catatan bimbingan, dan sahkan sesi." />
      <Tabs<Filter>
        value={filter}
        onChange={setFilter}
        items={[
          { value: 'diajukan', label: `Menunggu tanggapan (${counts.diajukan ?? 0})` },
          { value: 'dijadwalkan', label: `Terjadwal (${counts.dijadwalkan ?? 0})` },
          { value: 'selesai', label: `Selesai (${counts.selesai ?? 0})` },
          { value: 'semua', label: 'Semua' },
        ]}
      />
      <SplitView
        open={!!split.id}
        list={
          <Panel flush>
            <SessionTable sessions={ordered} who="mahasiswa" empty="Tidak ada sesi pada daftar ini." onOpen={split.wide ? split.open : undefined} activeId={split.id} compact={!!split.id} />
          </Panel>
        }
        detail={split.id && <SessionDetail key={split.id} id={split.id} embedded onClose={split.close} onChanged={st.reload} />}
      />
    </>
  );
}

/* ------------------------------------------------------------------ */
export function SessionTable({
  sessions,
  who,
  empty,
  onOpen,
  activeId,
  compact,
}: {
  sessions: Session[];
  who: 'dosen' | 'mahasiswa';
  empty: string;
  /** Bila diisi, baris dibuka di panel samping alih-alih berpindah halaman. */
  onOpen?: (id: string) => void;
  activeId?: string | null;
  /** Ringkas: kolom tambahan disembunyikan saat detail terbuka di samping. */
  compact?: boolean;
}) {
  const navigate = useNavigate();
  const go = (id: string) => (onOpen ? onOpen(id) : navigate(`/bimbingan/${id}`));
  if (sessions.length === 0) return <p className="muted small" style={{ padding: 18 }}>{empty}</p>;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Waktu</th>
            <th>Topik</th>
            <th>{who === 'dosen' ? 'Pembimbing' : 'Mahasiswa'}</th>
            <th>Status</th>
            {!compact && <th>Hasil</th>}
          </tr>
        </thead>
        <tbody>
          {sessions.map((s) => (
            <tr key={s.id} className={`clickable ${activeId === s.id ? 'selected' : ''}`} onClick={() => go(s.id)}>
              <td className="small mono-num" style={{ whiteSpace: 'nowrap' }}>
                {fmtDateTime(s.tanggal_jadwal ?? s.tanggal_usulan)}
                <div className="muted">{MODE_LABEL[s.mode]}</div>
              </td>
              <td>
                <Link
                  to={`/bimbingan/${s.id}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (onOpen) {
                      e.preventDefault();
                      onOpen(s.id);
                    }
                  }}
                  className="strong"
                  style={{ color: 'inherit' }}
                >
                  {s.topik}
                </Link>
                {s.milestone?.nama && <div className="muted small">{s.milestone.nama}</div>}
              </td>
              <td className="small">{who === 'dosen' ? s.dosen?.nama : `${s.mahasiswa?.nama ?? ''}`}</td>
              <td>
                <SessionBadge s={s.status as SessionStatus} />
              </td>
              {!compact && <td>{s.hasil ? <Badge tone={SESSION_RESULT[s.hasil].tone}>{SESSION_RESULT[s.hasil].label.split(',')[0]}</Badge> : <span className="muted">—</span>}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ */
export function AjukanBimbinganModal({
  open,
  onClose,
  thesis,
  sups,
  milestones,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  thesis: Thesis;
  sups: Supervisor[];
  milestones: Milestone[];
  onDone: (id: string) => void;
}) {
  const toast = useToast();
  const current = milestones.find((m) => m.status !== 'selesai');
  const choosable = milestones.filter((m) => m.jenis === 'pembimbing_setuju' && m.status !== 'selesai');
  const [dosen, setDosen] = useState('');
  const [mode, setMode] = useState<'tatap_muka' | 'daring'>('tatap_muka');
  const [tanggal, setTanggal] = useState('');
  const [milestone, setMilestone] = useState('');
  const [topik, setTopik] = useState('');
  const [pesan, setPesan] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const t = new Date();
    t.setDate(t.getDate() + 2);
    t.setHours(9, 0, 0, 0);
    setDosen(sups.find((s) => s.peran === 'P1')?.dosen_id ?? sups[0]?.dosen_id ?? '');
    setMode('tatap_muka');
    setTanggal(toLocalInput(t));
    setMilestone(current && current.jenis === 'pembimbing_setuju' ? current.id : '');
    setTopik(current && current.jenis === 'pembimbing_setuju' ? `Review ${current.nama}` : '');
    setPesan('');
    setFile(null);
    setErr(null);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async () => {
    setErr(null);
    if (!dosen) return setErr('Pilih pembimbing');
    if (!topik.trim()) return setErr('Topik wajib diisi');
    const when = fromLocalInput(tanggal);
    if (!when) return setErr('Tanggal usulan tidak valid');
    if (file) {
      const v = validateDraft(file);
      if (v) return setErr(v);
    }
    setBusy(true);
    try {
      const ms = milestones.find((m) => m.id === milestone);
      let docId: string | null = null;
      if (file) docId = await uploadDraft({ thesisId: thesis.id, file, bab: ms?.nama ?? 'Draf umum', milestoneId: ms?.id ?? null });
      const id = await rpc<string>('ajukan_bimbingan', {
        p_thesis: thesis.id,
        p_dosen: dosen,
        p_mode: mode,
        p_tanggal: when,
        p_topik: topik.trim(),
        p_pesan: pesan.trim() || null,
        p_milestone: milestone || null,
        p_document: docId,
      });
      toast.show('Pengajuan bimbingan terkirim', 'ok');
      onDone(id);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Ajukan bimbingan"
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Batal
          </Button>
          <Button variant="primary" loading={busy} onClick={submit}>
            Kirim pengajuan
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Pembimbing">
          <select value={dosen} onChange={(e) => setDosen(e.target.value)}>
            {sups.map((s) => (
              <option key={s.id} value={s.dosen_id}>
                {s.peran === 'P1' ? 'Pembimbing 1' : 'Pembimbing 2'}: {s.dosen?.nama}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Bentuk">
          <select value={mode} onChange={(e) => setMode(e.target.value as 'tatap_muka' | 'daring')}>
            <option value="tatap_muka">Tatap muka</option>
            <option value="daring">Daring</option>
          </select>
        </Field>
        <Field label="Usulan waktu">
          <input type="datetime-local" value={tanggal} onChange={(e) => setTanggal(e.target.value)} />
        </Field>
        <Field label="Bab atau tahap" hint="Draf yang diajukan akan mengubah status milestone menjadi Menunggu review">
          <select value={milestone} onChange={(e) => setMilestone(e.target.value)}>
            <option value="">Tidak terkait bab tertentu</option>
            {choosable.map((m) => (
              <option key={m.id} value={m.id}>
                {m.urutan}. {m.nama}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Topik" className="full">
          <input value={topik} onChange={(e) => setTopik(e.target.value)} placeholder="mis. Review rumusan masalah Bab 1" />
        </Field>
        <Field label="Pesan untuk pembimbing" className="full">
          <textarea value={pesan} onChange={(e) => setPesan(e.target.value)} placeholder="Bagian yang ingin didiskusikan, kendala, atau pertanyaan" />
        </Field>
        <Field label="Draf (opsional)" className="full" hint="PDF, DOC, atau DOCX, maksimal 20 MB. Versi draf tersimpan otomatis.">
          <input type="file" accept={DRAFT_TYPES} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </Field>
      </div>
      {err && (
        <div className="note bad" style={{ marginTop: 12 }}>
          {err}
        </div>
      )}
    </Modal>
  );
}
