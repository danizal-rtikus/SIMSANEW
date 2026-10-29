import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { useAsync } from '../../lib/useAsync';
import { must, supabase } from '../../lib/supabase';
import { rpc } from '../../lib/queries';
import { useRecordRecent } from '../../lib/shell';
import { fmtDateTime, fromLocalInput, toLocalInput } from '../../lib/format';
import { EXAM_LABEL, EXAM_RESULT, EXAM_STATUS, examHasRevision, examResultsFor } from '../../lib/labels';
import type { AssessmentItem, Exam, ExamResult, GradeRow, PanelMember, RevisionNote } from '../../lib/types';
import { Badge, Button, ErrorNote, Facts, Field, Loading, PageHeader, Panel } from '../../components/ui';
import { Modal, useDialog } from '../../components/Dialog';
import { useToast } from '../../components/Toast';
import { EXAM_SELECT } from './UjianList';
import { TitleRequestList, useTitleRequests } from '../../components/TitleRequest';

interface Score {
  dosen_id: string;
  item_id: string;
  skor: number;
}

function gradeOf(nilai: number, scale: GradeRow[]): string {
  return [...scale].sort((a, b) => b.nilai_min - a.nilai_min).find((g) => nilai >= g.nilai_min)?.huruf ?? '—';
}

export function UjianDetail() {
  const { id } = useParams();
  const { userId, active } = useAuth();
  const dialog = useDialog();
  const toast = useToast();
  const [schedOpen, setSchedOpen] = useState(false);

  const st = useAsync(async () => {
    const exam = (await must(supabase.from('exams').select(EXAM_SELECT).eq('id', id!).maybeSingle())) as Exam | null;
    if (!exam) return null;
    const [panel, items, scores, notes, scale] = await Promise.all([
      must(supabase.from('exam_panel').select('*, dosen:profiles!exam_panel_dosen_id_fkey(nama)').eq('exam_id', exam.id).order('urutan')),
      must(supabase.from('assessment_items').select('*').eq('jenis', exam.jenis).eq('aktif', true).order('urutan')),
      must(supabase.from('exam_scores').select('dosen_id, item_id, skor').eq('exam_id', exam.id)),
      must(supabase.from('exam_revision_notes').select('*').eq('exam_id', exam.id).order('created_at')),
      must(supabase.from('grade_scale').select('*').order('nilai_min', { ascending: false })),
    ]);
    return { exam, panel: panel as PanelMember[], items: items as AssessmentItem[], scores: scores as Score[], notes: notes as RevisionNote[], scale: scale as GradeRow[] };
  }, [id]);

  useRecordRecent(st.data ? { path: `/ujian/${st.data.exam.id}`, title: `${EXAM_LABEL[st.data.exam.jenis]}: ${st.data.exam.thesis?.mahasiswa?.nama ?? ''}`, sub: 'Ujian' } : null);

  if (st.loading && !st.data) return <Loading variant="detail" />;
  if (st.error) return <ErrorNote error={st.error} onRetry={st.reload} />;
  if (!st.data) return <ErrorNote error="Ujian tidak ditemukan atau Anda tidak memiliki akses." />;
  const { exam: e, panel, items, scores, notes, scale } = st.data;

  const me = panel.find((p) => p.dosen_id === userId);
  const isOwner = e.thesis?.mahasiswa_id === userId;
  const staff = (active?.role === 'kaprodi' && active.prodi_id === e.thesis?.prodi_id) || active?.role === 'baak' || active?.role === 'admin';
  const allScored = panel.length > 0 && panel.every((p) => p.dinilai_at);
  const canDecide = e.status === 'dijadwalkan' && allScored && (me?.ketua || (active?.role === 'kaprodi' && staff) || active?.role === 'admin');
  const avg = allScored ? panel.reduce((s, p) => s + Number(p.nilai), 0) / panel.length : null;
  const revisiOn = e.status === 'selesai' && (e.hasil === 'lulus_minor' || e.hasil === 'lulus_mayor');

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast.show(ok, 'ok');
      st.reload();
    } catch (err) {
      toast.show((err as Error).message, 'bad');
    }
  };

  const batal = async () => {
    const alasan = await dialog.prompt({ title: `Batalkan ${EXAM_LABEL[e.jenis]}?`, label: 'Alasan pembatalan', required: true, confirmLabel: 'Batalkan ujian', danger: true });
    if (alasan) run(() => rpc('batalkan_ujian', { p_exam: e.id, p_alasan: alasan }), 'Ujian dibatalkan');
  };

  const decide = async (hasil: ExamResult) => {
    const ok = await dialog.confirm({
      title: `Putuskan hasil: ${EXAM_RESULT[hasil].label}?`,
      message: `Nilai akhir ${avg?.toFixed(2)} (${gradeOf(avg ?? 0, scale)}), rata-rata dari ${panel.length} dosen. Keputusan tidak dapat diubah.`,
      confirmLabel: 'Putuskan hasil',
      danger: hasil === 'mengulang',
    });
    if (ok) run(() => rpc('putuskan_ujian', { p_exam: e.id, p_hasil: hasil }), 'Hasil ujian diputuskan');
  };

  const accRevisi = async () => {
    const ok = await dialog.confirm({
      title: 'Beri ACC revisi?',
      message: 'ACC Anda tercatat sebagai tanda tangan digital dengan kode verifikasi pada Berita Acara Hasil Revisi.',
      confirmLabel: 'ACC revisi',
    });
    if (ok) run(() => rpc('acc_revisi', { p_exam: e.id }), 'ACC revisi tercatat');
  };

  return (
    <>
      <PageHeader
        back={{ to: '/ujian', label: 'Ujian' }}
        title={`${EXAM_LABEL[e.jenis]}${e.percobaan > 1 ? ` (ke-${e.percobaan})` : ''}`}
        description={
          <>
            <Link to={`/mahasiswa-bimbingan/${e.thesis_id}`}>{e.thesis?.mahasiswa?.nama}</Link>
            {e.thesis?.mahasiswa?.nim ? `, ${e.thesis.mahasiswa.nim}` : ''}. {e.thesis?.judul}
          </>
        }
        actions={
          <>
            {staff && (e.status === 'didaftarkan' || e.status === 'dijadwalkan') && (
              <Button variant={e.status === 'didaftarkan' ? 'primary' : 'secondary'} onClick={() => setSchedOpen(true)}>
                {e.status === 'didaftarkan' ? 'Jadwalkan ujian' : 'Ubah jadwal'}
              </Button>
            )}
            {((staff && e.status !== 'selesai' && e.status !== 'dibatalkan') || (isOwner && e.status === 'didaftarkan')) && (
              <Button variant="danger" onClick={batal}>
                Batalkan
              </Button>
            )}
          </>
        }
      />
      <div className="stack">
        <Facts
          items={[
            { label: 'Status', value: <span style={{ fontSize: 17 }}><Badge tone={EXAM_STATUS[e.status].tone}>{EXAM_STATUS[e.status].label}</Badge></span> },
            { label: 'Jadwal', value: <span style={{ fontSize: 17 }}>{e.tanggal ? fmtDateTime(e.tanggal) : 'Belum dijadwalkan'}</span>, note: e.ruang ? `${e.ruang}, ${e.durasi_menit} menit` : undefined },
            {
              label: 'Nilai akhir',
              value: e.nilai_akhir != null ? `${Number(e.nilai_akhir).toFixed(2)}` : avg != null && staff ? `${avg.toFixed(2)}` : '—',
              note: e.huruf ? `Huruf ${e.huruf}` : e.status === 'dijadwalkan' ? `${panel.filter((p) => p.dinilai_at).length} dari ${panel.length} dosen sudah menilai` : undefined,
            },
            { label: 'Hasil', value: <span style={{ fontSize: 17 }}>{e.hasil ? <Badge tone={EXAM_RESULT[e.hasil].tone}>{EXAM_RESULT[e.hasil].label}</Badge> : '—'}</span>, note: e.kode_ba ? `Kode berita acara ${e.kode_ba}` : undefined },
          ]}
        />

        {e.status === 'didaftarkan' && (
          <div className="note info">
            {staff
              ? 'Mahasiswa sudah mendaftar. Pastikan ploting penguji lengkap, lalu jadwalkan ujian. Panel penilai disusun otomatis dari ploting.'
              : 'Pendaftaran Anda sedang diproses. Jadwal dan panel penguji akan diberitahukan melalui notifikasi.'}
          </div>
        )}

        <Panel title="Panel penilai" sub="Nilai akhir adalah rata-rata nilai seluruh dosen" flush>
          {panel.length === 0 ? (
            <p className="muted small" style={{ padding: 18 }}>Panel disusun saat ujian dijadwalkan.</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Dosen</th>
                  <th>Peran</th>
                  <th className="num">Nilai</th>
                  <th>Penilaian</th>
                  {examHasRevision(e.jenis) && e.status === 'selesai' && e.hasil !== 'mengulang' && <th>ACC revisi</th>}
                </tr>
              </thead>
              <tbody>
                {panel.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <span className="strong">{p.dosen?.nama}</span>
                      {p.ketua && <span className="muted small"> (ketua sidang)</span>}
                    </td>
                    <td className="small">{p.peran}</td>
                    <td className="num mono-num">{p.nilai != null ? Number(p.nilai).toFixed(2) : '—'}</td>
                    <td className="small">
                      {p.dinilai_at ? (
                        <span className="row" style={{ gap: 6 }}>
                          <Badge tone="ok">Sudah</Badge>
                          <span className="muted">{p.kode_nilai}</span>
                        </span>
                      ) : (
                        <Badge>Belum</Badge>
                      )}
                    </td>
                    {examHasRevision(e.jenis) && e.status === 'selesai' && e.hasil !== 'mengulang' && (
                      <td className="small">
                        {p.acc_revisi_at ? (
                          <span className="row" style={{ gap: 6 }}>
                            <Badge tone="ok">ACC</Badge>
                            <span className="muted">{p.kode_acc}</span>
                          </span>
                        ) : (
                          <Badge>Menunggu</Badge>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>

        {me && e.status === 'dijadwalkan' && <ScoreForm exam={e} items={items} myScores={scores.filter((s) => s.dosen_id === userId)} me={me} myNotes={notes.filter((n) => n.dosen_id === userId)} onSaved={st.reload} />}

        {canDecide && avg != null && (
          <Panel title="Keputusan ketua sidang" sub={`Rata-rata ${avg.toFixed(2)}, huruf ${gradeOf(avg, scale)}`}>
            <div className="row">
              {examResultsFor(e.jenis).map((h) => (
                <Button key={h} variant={h === 'mengulang' ? 'danger' : 'primary'} onClick={() => decide(h)}>
                  {EXAM_RESULT[h].label}
                </Button>
              ))}
            </div>
          </Panel>
        )}
        {e.status === 'dijadwalkan' && !allScored && me?.ketua && <div className="note small">Keputusan hasil dapat diambil setelah seluruh dosen panel mengisi penilaian.</div>}

        {examHasRevision(e.jenis) && (e.status === 'dijadwalkan' || e.status === 'selesai') && e.hasil !== 'mengulang' && (me || panel.some((p) => p.ubah_judul)) && (
          <ExamTitle exam={e} panel={panel} me={me ?? null} isOwner={isOwner} onChanged={st.reload} />
        )}

        {e.status === 'selesai' && scores.length > 0 && <ScoreTable items={items} panel={panel} scores={scores} />}

        {examHasRevision(e.jenis) && (revisiOn || notes.length > 0) && (
          <Panel
            title="Revisi"
            sub={
              e.revisi_selesai_at
                ? `Selesai ${fmtDateTime(e.revisi_selesai_at)}. Kode Berita Acara Hasil Revisi ${e.kode_ba_revisi}.`
                : revisiOn
                  ? 'Kerjakan catatan revisi, unggah naskah revisi di Studi akhir, lalu minta ACC seluruh dosen panel.'
                  : 'Catatan revisi dari dosen panel'
            }
            actions={
              revisiOn && me && !me.acc_revisi_at && !e.revisi_selesai_at ? (
                <Button variant="primary" onClick={accRevisi}>
                  ACC revisi
                </Button>
              ) : undefined
            }
            flush
          >
            {e.revisi_selesai_at && (
              <div className="note ok" style={{ margin: 14 }}>
                {e.jenis === 'sempro' ? 'Proposal dinyatakan selesai.' : 'Skripsi dinyatakan selesai.'} Seluruh dosen panel sudah memberi ACC.
              </div>
            )}
            <ul className="list">
              {panel.map((p) => {
                const own = notes.filter((n) => n.dosen_id === p.dosen_id);
                if (!own.length) return null;
                return (
                  <li key={p.id}>
                    <div className="strong small" style={{ marginBottom: 6 }}>
                      {p.dosen?.nama} <span className="muted">({p.peran})</span>
                    </div>
                    <div className="stack-sm">
                      {own.map((n) => (
                        <label key={n.id} className="check" style={{ alignItems: 'flex-start' }}>
                          <input
                            type="checkbox"
                            checked={n.selesai}
                            disabled={!isOwner || !!e.revisi_selesai_at}
                            onChange={(ev) => run(() => rpc('tandai_revisi', { p_note: n.id, p_selesai: ev.target.checked }), ev.target.checked ? 'Ditandai selesai' : 'Tanda selesai dibatalkan')}
                            style={{ marginTop: 3 }}
                          />
                          <span style={{ textDecoration: n.selesai ? 'line-through' : undefined, color: n.selesai ? 'var(--ink-3)' : undefined }}>{n.isi}</span>
                        </label>
                      ))}
                    </div>
                  </li>
                );
              })}
              {notes.length === 0 && <li className="muted small">Tidak ada catatan revisi tertulis.</li>}
            </ul>
          </Panel>
        )}
      </div>
      <ScheduleModal open={schedOpen} exam={e} panel={panel} onClose={() => setSchedOpen(false)} onDone={() => { setSchedOpen(false); st.reload(); }} />
    </>
  );
}

function ScoreForm({ exam, items, myScores, me, myNotes, onSaved }: { exam: Exam; items: AssessmentItem[]; myScores: Score[]; me: PanelMember; myNotes: RevisionNote[]; onSaved: () => void }) {
  const toast = useToast();
  const [vals, setVals] = useState<Record<string, string>>({});
  const [catatan, setCatatan] = useState('');
  const [revisi, setRevisi] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const v: Record<string, string> = {};
    myScores.forEach((s) => (v[s.item_id] = String(s.skor)));
    setVals(v);
    setCatatan(me.catatan ?? '');
    setRevisi(myNotes.map((n) => n.isi).join('\n'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exam.id, me.dinilai_at]);

  const total = useMemo(() => {
    let sum = 0;
    let w = 0;
    for (const it of items) {
      const n = Number(vals[it.id]);
      if (!vals[it.id] || isNaN(n)) return null;
      sum += n * Number(it.bobot);
      w += Number(it.bobot);
    }
    return w ? sum / w : null;
  }, [vals, items]);

  const save = async () => {
    setErr(null);
    for (const it of items) {
      const n = Number(vals[it.id]);
      if (!vals[it.id] || isNaN(n) || n < 40 || n > 100) return setErr(`Nilai "${it.nama}" harus 40 sampai 100`);
    }
    setBusy(true);
    try {
      const skor: Record<string, number> = {};
      items.forEach((it) => (skor[it.id] = Number(vals[it.id])));
      await rpc('nilai_ujian', {
        p_exam: exam.id,
        p_skor: skor,
        p_catatan: catatan.trim() || null,
        p_revisi: revisi.split('\n').map((s) => s.trim()).filter(Boolean),
      });
      toast.show('Penilaian disimpan', 'ok');
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (items.length === 0) return <div className="note warn">Butir penilaian untuk {EXAM_LABEL[exam.jenis]} belum diatur Admin (Master data, Form penilaian).</div>;

  return (
    <Panel
      title={me.dinilai_at ? 'Penilaian Anda (dapat diubah sebelum hasil diputuskan)' : 'Isi penilaian Anda'}
      sub={`Sebagai ${me.peran}. Skala 40 sampai 100 per butir; nilai Anda adalah rata-rata berbobot.`}
      actions={<Button variant="primary" loading={busy} onClick={save}>{me.dinilai_at ? 'Perbarui penilaian' : 'Simpan penilaian'}</Button>}
    >
      <div className="stack-sm">
        <table className="table">
          <thead>
            <tr>
              <th>Butir penilaian</th>
              <th className="num">Bobot</th>
              <th style={{ width: 130 }}>Nilai (40–100)</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id} style={{ verticalAlign: 'middle' }}>
                <td>
                  {it.nama}
                  {it.keterangan && <div className="muted small">{it.keterangan}</div>}
                </td>
                <td className="num">{Number(it.bobot)}</td>
                <td>
                  <input type="number" min={40} max={100} step="0.5" value={vals[it.id] ?? ''} onChange={(e) => setVals({ ...vals, [it.id]: e.target.value })} aria-label={it.nama} />
                </td>
              </tr>
            ))}
            <tr>
              <td className="strong">Nilai Anda</td>
              <td />
              <td className="strong mono-num">{total != null ? total.toFixed(2) : '—'}</td>
            </tr>
          </tbody>
        </table>
        <Field label="Catatan penilaian (opsional)">
          <textarea style={{ minHeight: 56 }} value={catatan} onChange={(e) => setCatatan(e.target.value)} />
        </Field>
        {examHasRevision(exam.jenis) && (
          <Field label="Catatan revisi untuk mahasiswa" hint="Satu catatan per baris. Mahasiswa akan mencentang tiap catatan yang sudah dikerjakan.">
            <textarea style={{ minHeight: 100 }} value={revisi} onChange={(e) => setRevisi(e.target.value)} />
          </Field>
        )}
        {err && <div className="note bad">{err}</div>}
      </div>
    </Panel>
  );
}

function ScoreTable({ items, panel, scores }: { items: AssessmentItem[]; panel: PanelMember[]; scores: Score[] }) {
  const get = (d: string, i: string) => scores.find((s) => s.dosen_id === d && s.item_id === i)?.skor;
  return (
    <Panel title="Rincian penilaian" flush>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Butir</th>
              <th className="num">Bobot</th>
              {panel.map((p) => (
                <th key={p.id} className="num">{p.peran}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id}>
                <td>{it.nama}</td>
                <td className="num">{Number(it.bobot)}</td>
                {panel.map((p) => (
                  <td key={p.id} className="num mono-num">{get(p.dosen_id, it.id) ?? '—'}</td>
                ))}
              </tr>
            ))}
            <tr>
              <td className="strong">Nilai dosen</td>
              <td />
              {panel.map((p) => (
                <td key={p.id} className="num strong mono-num">{p.nilai != null ? Number(p.nilai).toFixed(2) : '—'}</td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function ScheduleModal({ open, exam, panel, onClose, onDone }: { open: boolean; exam: Exam; panel: PanelMember[]; onClose: () => void; onDone: () => void }) {
  const dialog = useDialog();
  const toast = useToast();
  const [tanggal, setTanggal] = useState('');
  const [ruang, setRuang] = useState('');
  const [durasi, setDurasi] = useState('120');
  const [ketua, setKetua] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const t = exam.tanggal ? new Date(exam.tanggal) : (() => { const d = new Date(); d.setDate(d.getDate() + 7); d.setHours(9, 0, 0, 0); return d; })();
    setTanggal(toLocalInput(t));
    setRuang(exam.ruang ?? '');
    setDurasi(String(exam.durasi_menit ?? 120));
    setKetua(panel.find((p) => p.ketua)?.dosen_id ?? '');
    setErr(null);
  }, [open, exam, panel]);

  const save = async (paksa = false) => {
    setErr(null);
    const iso = fromLocalInput(tanggal);
    if (!iso) return setErr('Tanggal dan jam tidak valid');
    if (!ruang.trim()) return setErr('Ruang wajib diisi');
    setBusy(true);
    try {
      await rpc('jadwalkan_ujian', { p_exam: exam.id, p_tanggal: iso, p_ruang: ruang.trim(), p_durasi: Number(durasi) || 120, p_ketua: ketua || null, p_paksa: paksa });
      toast.show('Ujian dijadwalkan', 'ok');
      onDone();
    } catch (e) {
      const msg = (e as Error).message;
      if (/^Bentrok jadwal/.test(msg) && !paksa) {
        setBusy(false);
        const ok = await dialog.confirm({ title: 'Jadwal bentrok', message: msg.replace(/^Bentrok jadwal:\s*/, '').split('; ').join('. ') + '.', confirmLabel: 'Tetap jadwalkan', cancelLabel: 'Ubah jadwal' });
        if (ok) return save(true);
        return;
      }
      setErr(msg);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={exam.status === 'didaftarkan' ? 'Jadwalkan ujian' : 'Ubah jadwal ujian'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Batal
          </Button>
          <Button variant="primary" loading={busy} onClick={() => save(false)}>
            Simpan jadwal
          </Button>
        </>
      }
    >
      <div className="form-grid">
        <Field label="Tanggal dan jam" className="full">
          <input type="datetime-local" value={tanggal} onChange={(e) => setTanggal(e.target.value)} />
        </Field>
        <Field label="Ruang">
          <input value={ruang} onChange={(e) => setRuang(e.target.value)} placeholder="mis. Lab Komputer 1" />
        </Field>
        <Field label="Durasi (menit)">
          <input type="number" min={15} max={600} value={durasi} onChange={(e) => setDurasi(e.target.value)} />
        </Field>
        {panel.length > 0 && (
          <Field label="Ketua sidang" className="full">
            <select value={ketua} onChange={(e) => setKetua(e.target.value)}>
              {panel.map((p) => (
                <option key={p.dosen_id} value={p.dosen_id}>
                  {p.dosen?.nama} ({p.peran})
                </option>
              ))}
            </select>
          </Field>
        )}
      </div>
      <p className="muted small" style={{ marginTop: 10 }}>
        {panel.length === 0
          ? 'Panel penilai disusun otomatis dari ploting: Seminar memakai P1, P2, dan Penguji; Pendadaran memakai tim pendadaran; ujian D3 memakai P1 dan P2. Ketua sidang bawaan adalah anggota pertama panel.'
          : 'Sistem memeriksa bentrok ruang dan jadwal dosen panel sebelum menyimpan.'}
      </p>
      {err && <div className="note bad" style={{ marginTop: 10 }}>{err}</div>}
    </Modal>
  );
}


/** Arahan perubahan judul dari panel dan status usulan judul mahasiswa. */
function ExamTitle({ exam, panel, me, isOwner, onChanged }: { exam: Exam; panel: PanelMember[]; me: PanelMember | null; isOwner: boolean; onChanged: () => void }) {
  const dialog = useDialog();
  const toast = useToast();
  const { userId } = useAuth();
  const tr = useTitleRequests(exam.thesis_id);
  const flagged = panel.filter((p) => p.ubah_judul);
  const closed = !!exam.revisi_selesai_at;
  const after = exam.tanggal ?? exam.created_at;
  const reqs = (tr.data?.requests ?? []).filter((r) => new Date(r.created_at) >= new Date(after) && r.status !== 'dibatalkan');
  const approved = reqs.some((r) => r.status === 'disetujui');

  const setFlag = async (perlu: boolean) => {
    let arahan: string | null = null;
    if (perlu) {
      arahan = await dialog.prompt({
        title: 'Minta perubahan judul',
        message: 'Mahasiswa mengusulkan judul baru sesuai arahan ini. Revisi baru dapat dinyatakan selesai setelah judul baru disetujui Pembimbing 1 dan 2.',
        label: 'Arahan perubahan judul',
        multiline: true,
        required: true,
        initial: me?.arahan_judul ?? '',
        confirmLabel: 'Simpan arahan',
      });
      if (arahan === null) return;
    } else {
      const ok = await dialog.confirm({ title: 'Batalkan permintaan perubahan judul?', message: 'Judul tidak wajib diubah untuk menyelesaikan revisi.', confirmLabel: 'Batalkan permintaan' });
      if (!ok) return;
    }
    try {
      await rpc('arahan_judul_ujian', { p_exam: exam.id, p_perlu: perlu, p_arahan: arahan });
      toast.show(perlu ? 'Arahan perubahan judul dikirim ke mahasiswa' : 'Permintaan perubahan judul dibatalkan', 'ok');
      onChanged();
    } catch (err) {
      toast.show((err as Error).message, 'bad');
    }
  };

  return (
    <Panel
      title="Judul"
      sub={
        flagged.length
          ? approved
            ? 'Judul baru sudah disetujui Pembimbing 1 dan 2.'
            : 'Panel meminta perubahan judul. Revisi selesai setelah judul baru disetujui Pembimbing 1 dan 2.'
          : 'Tandai bila judul perlu diubah sebagai bagian dari revisi.'
      }
      actions={
        me && !closed ? (
          me.ubah_judul ? (
            <>
              <Button size="sm" variant="ghost" onClick={() => setFlag(false)}>
                Batalkan permintaan
              </Button>
              <Button size="sm" onClick={() => setFlag(true)}>
                Ubah arahan
              </Button>
            </>
          ) : (
            <Button size="sm" onClick={() => setFlag(true)}>
              Perlu perubahan judul
            </Button>
          )
        ) : undefined
      }
    >
      <div className="stack-sm">
        <div className="small">
          Judul saat ini: <span className="strong">{exam.thesis?.judul}</span>
        </div>
        {flagged.length > 0 && (
          <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
            {flagged.map((p) => (
              <li key={p.id}>
                {p.arahan_judul} <span className="muted">({p.dosen?.nama})</span>
              </li>
            ))}
          </ul>
        )}
        {reqs.length > 0 && <TitleRequestList requests={reqs} mode={isOwner ? 'mahasiswa' : 'baca'} myId={userId} onChanged={tr.reload} />}
        {isOwner && flagged.length > 0 && !approved && !reqs.some((r) => r.status === 'diajukan') && (
          <div className="note info small">
            Ajukan judul baru di halaman <Link to="/judul">Pendaftaran TA</Link>.
          </div>
        )}
      </div>
    </Panel>
  );
}
