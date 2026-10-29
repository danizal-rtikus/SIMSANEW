import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../../lib/auth';
import { useAsync } from '../../lib/useAsync';
import { must, supabase } from '../../lib/supabase';
import { SESSION_SELECT, rpc } from '../../lib/queries';
import { fmtDateTime, fmtSize, fromLocalInput, toLocalInput } from '../../lib/format';
import { MODE_LABEL, SESSION_RESULT } from '../../lib/labels';
import { DRAFT_TYPES, openFile, uploadDraft, validateDraft } from '../../lib/files';
import type { DocumentRow, Session, SessionResult } from '../../lib/types';
import { Badge, Button, ErrorNote, Field, Loading, PageHeader, Panel } from '../../components/ui';
import { SessionBadge } from '../../components/StatusBits';
import { Modal, useDialog } from '../../components/Dialog';
import { useToast } from '../../components/Toast';
import { useRecordRecent } from '../../lib/shell';
import { IconClose, IconFile, IconUpload } from '../../components/Icons';

interface CommentRow {
  id: string;
  bagian: string | null;
  isi: string;
  selesai: boolean;
  created_at: string;
  penulis_id: string;
  penulis?: { nama: string } | null;
}

export function SessionDetail({ id: propId, embedded, onClose, onChanged }: { id?: string; embedded?: boolean; onClose?: () => void; onChanged?: () => void } = {}) {
  const params = useParams();
  const id = propId ?? params.id;
  const { userId, active } = useAuth();
  const dialog = useDialog();
  const toast = useToast();
  const [modal, setModal] = useState<null | 'terima' | 'jadwal_ulang' | 'catatan' | 'revisi'>(null);

  const st = useAsync(async () => {
    const s = (await must(supabase.from('guidance_sessions').select(SESSION_SELECT).eq('id', id!).maybeSingle())) as Session | null;
    if (!s) return null;
    const [docs, comments] = await Promise.all([
      must(supabase.from('documents').select('*, pengunggah:profiles(nama)').eq('thesis_id', s.thesis_id).order('created_at', { ascending: false })),
      must(supabase.from('comments').select('*, penulis:profiles(nama)').eq('session_id', s.id).order('created_at')),
    ]);
    return { s, docs: docs as DocumentRow[], comments: comments as CommentRow[] };
  }, [id]);

  useRecordRecent(st.data ? { path: `/bimbingan/${st.data.s.id}`, title: st.data.s.topik, sub: `Sesi bimbingan, ${st.data.s.mahasiswa?.nama ?? ''}` } : null);

  if (st.loading && !st.data) return <Loading variant="detail" />;
  if (st.error) return <ErrorNote error={st.error} onRetry={st.reload} />;
  if (!st.data) return <ErrorNote error="Sesi bimbingan tidak ditemukan atau Anda tidak memiliki akses." />;

  const { s, docs, comments } = st.data;
  const isDosen = userId === s.dosen_id;
  const isMhs = userId === s.mahasiswa_id;
  const attached = docs.find((d) => d.id === s.document_id) ?? null;
  const bab = attached?.bab ?? s.milestone?.nama ?? null;
  const versions = bab ? docs.filter((d) => d.bab === bab) : [];
  const back = active?.role === 'mahasiswa' || active?.role === 'dosen' ? { to: '/bimbingan', label: 'Bimbingan' } : { to: `/mahasiswa-bimbingan/${s.thesis_id}`, label: 'Data mahasiswa' };

  const run = async (fn: () => Promise<unknown>, okText: string) => {
    try {
      await fn();
      toast.show(okText, 'ok');
      setModal(null);
      st.reload();
      onChanged?.();
    } catch (e) {
      toast.show((e as Error).message, 'bad');
    }
  };

  const tolak = async () => {
    const alasan = await dialog.prompt({ title: 'Tolak pengajuan bimbingan', label: 'Alasan penolakan', required: true, multiline: true, confirmLabel: 'Tolak pengajuan', danger: true });
    if (alasan) run(() => rpc('tanggapi_bimbingan', { p_id: s.id, p_aksi: 'tolak', p_tanggal: null, p_lokasi: null, p_alasan: alasan }), 'Pengajuan ditolak');
  };
  const batal = async () => {
    const ok = await dialog.confirm({ title: 'Batalkan pengajuan bimbingan?', message: 'Pembimbing akan menerima pemberitahuan pembatalan.', confirmLabel: 'Batalkan pengajuan', cancelLabel: 'Kembali', danger: true });
    if (ok) run(() => rpc('tanggapi_bimbingan', { p_id: s.id, p_aksi: 'batal', p_tanggal: null, p_lokasi: null, p_alasan: null }), 'Pengajuan dibatalkan');
  };
  const sahkan = async () => {
    const ok = await dialog.confirm({ title: 'Sahkan sesi bimbingan?', message: 'Catatan sesi yang sudah disahkan tidak dapat diubah lagi dan tercatat di Kartu Bimbingan.', confirmLabel: 'Sahkan sesi' });
    if (ok) run(() => rpc('sahkan_bimbingan', { p_id: s.id }), 'Sesi disahkan');
  };

  const actions = (
    <>
      {isDosen && s.status === 'diajukan' && (
        <>
          <Button variant="primary" onClick={() => setModal('terima')}>
            Terima
          </Button>
          <Button onClick={() => setModal('jadwal_ulang')}>Usulkan waktu lain</Button>
          <Button variant="danger" onClick={tolak}>
            Tolak
          </Button>
        </>
      )}
      {isDosen && s.status === 'dijadwalkan' && (
        <>
          <Button variant="primary" onClick={() => setModal('catatan')}>
            Isi catatan bimbingan
          </Button>
          <Button onClick={() => setModal('jadwal_ulang')}>Jadwal ulang</Button>
        </>
      )}
      {isDosen && s.status === 'selesai' && !s.disahkan && (
        <>
          <Button onClick={() => setModal('catatan')}>Ubah catatan</Button>
          <Button variant="primary" onClick={sahkan}>
            Sahkan sesi
          </Button>
        </>
      )}
      {isMhs && (s.status === 'diajukan' || s.status === 'dijadwalkan') && (
        <Button variant="danger" onClick={batal}>
          Batalkan pengajuan
        </Button>
      )}
    </>
  );

  return (
    <>
      <PageHeader
        title={s.topik}
        back={embedded ? undefined : back}
        description={<SessionBadge s={s.status} />}
        actions={
          embedded ? (
            <>
              {actions}
              <Link className="btn" to={`/bimbingan/${s.id}`}>
                Buka penuh
              </Link>
              <button type="button" className="icon-btn" onClick={onClose} aria-label="Tutup detail" title="Tutup detail">
                <IconClose size={17} />
              </button>
            </>
          ) : (
            actions
          )
        }
      />
      <div className="grid-main">
        <div className="stack">
          {s.status === 'selesai' ? (
            <Panel
              title="Catatan bimbingan"
              sub={s.disahkan ? `Disahkan ${fmtDateTime(s.disahkan_at)}` : 'Belum disahkan pembimbing'}
              actions={s.hasil && <Badge tone={SESSION_RESULT[s.hasil].tone}>{SESSION_RESULT[s.hasil].label}</Badge>}
            >
              <dl className="kv">
                <dt>Ringkasan</dt>
                <dd className="pre">{s.ringkasan}</dd>
                {s.saran && (
                  <>
                    <dt>Saran</dt>
                    <dd className="pre">{s.saran}</dd>
                  </>
                )}
                {s.tindak_lanjut && (
                  <>
                    <dt>Tindak lanjut</dt>
                    <dd>
                      <div className="pre">{s.tindak_lanjut}</div>
                      {isMhs ? (
                        <label className="check" style={{ marginTop: 8 }}>
                          <input
                            type="checkbox"
                            checked={s.tindak_lanjut_selesai}
                            onChange={(e) =>
                              run(() => rpc('tandai_tindak_lanjut', { p_id: s.id, p_selesai: e.target.checked }), e.target.checked ? 'Tindak lanjut ditandai selesai' : 'Tanda selesai dibatalkan')
                            }
                          />
                          Tindak lanjut sudah saya kerjakan
                        </label>
                      ) : (
                        <div style={{ marginTop: 6 }}>
                          {s.tindak_lanjut_selesai ? <Badge tone="ok">Dikerjakan mahasiswa</Badge> : <Badge>Belum dikerjakan</Badge>}
                        </div>
                      )}
                    </dd>
                  </>
                )}
              </dl>
            </Panel>
          ) : (
            s.status === 'ditolak' && s.alasan_status && <div className="note bad">Alasan penolakan: {s.alasan_status}</div>
          )}

          <Panel title="Bab yang dibahas" sub="Pengajuan bab dari Naskah. Komentar dan ACC diberikan di halaman review bab.">
            {s.submission ? (
              <div className="row-between" style={{ gap: 12, flexWrap: 'wrap' }}>
                <div>
                  <div className="strong">
                    Bab {s.submission.bab} {s.submission.judul}
                  </div>
                  <div className="small muted">
                    Pengajuan ke-{s.submission.nomor}, {s.submission.status === 'acc' ? 'ACC' : s.submission.status === 'revisi' ? 'perlu revisi' : s.submission.status === 'ditarik' ? 'ditarik' : 'menunggu review'}
                  </div>
                </div>
                <Link className="btn btn-sm" to={`/naskah/${s.thesis_id}/ajuan/${s.submission.id}`}>
                  {isDosen ? 'Buka dan review bab' : 'Buka pengajuan bab'}
                </Link>
              </div>
            ) : isMhs && (s.status === 'diajukan' || s.status === 'dijadwalkan') ? (
              <LinkSubmission sessionId={s.id} thesisId={s.thesis_id} onDone={() => run(async () => undefined, 'Pengajuan bab ditautkan')} />
            ) : (
              <p className="muted small" style={{ margin: 0 }}>
                Sesi ini tidak menautkan pengajuan bab.
              </p>
            )}
          </Panel>

          <Panel
            title="Berkas draf (cadangan)"
            sub={bab ? `Versi untuk ${bab}` : 'Untuk mahasiswa yang tidak menulis naskah di SIMSA'}
            actions={
              isMhs &&
              bab && (
                <Button size="sm" onClick={() => setModal('revisi')}>
                  <IconUpload size={15} /> Unggah revisi
                </Button>
              )
            }
            flush
          >
            {versions.length === 0 ? (
              <p className="muted small" style={{ padding: 18 }}>
                Tidak ada berkas draf untuk sesi ini.
              </p>
            ) : (
              <ul className="list">
                {versions.map((d) => (
                  <li key={d.id} className="row-between">
                    <span className="row" style={{ gap: 10 }}>
                      <IconFile />
                      <span>
                        <button className="btn-link strong" onClick={() => openFile('drafts', d.file_path).catch((e) => toast.show(e.message, 'bad'))}>
                          v{d.versi} {d.nama_file}
                        </button>
                        <div className="muted small">
                          {d.pengunggah?.nama}, {fmtDateTime(d.created_at)} {fmtSize(d.ukuran) && `(${fmtSize(d.ukuran)})`}
                        </div>
                      </span>
                    </span>
                    {d.id === s.document_id && <Badge tone="brand">Diajukan di sesi ini</Badge>}
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Comments sessionId={s.id} thesisId={s.thesis_id} comments={comments} onChange={st.reload} canWrite={isMhs || isDosen || active?.role === 'kaprodi'} userId={userId!} />
        </div>

        <Panel title="Rincian sesi">
          <dl className="kv" style={{ gridTemplateColumns: '120px 1fr' }}>
            <dt>Mahasiswa</dt>
            <dd>
              <Link to={`/mahasiswa-bimbingan/${s.thesis_id}`}>{s.mahasiswa?.nama}</Link>
              <div className="muted small">{s.mahasiswa?.nim}</div>
            </dd>
            <dt>Pembimbing</dt>
            <dd>{s.dosen?.nama}</dd>
            <dt>Bentuk</dt>
            <dd>{MODE_LABEL[s.mode]}</dd>
            <dt>Usulan waktu</dt>
            <dd>{fmtDateTime(s.tanggal_usulan)}</dd>
            {s.tanggal_jadwal && (
              <>
                <dt>Jadwal</dt>
                <dd className="strong">{fmtDateTime(s.tanggal_jadwal)}</dd>
              </>
            )}
            {s.lokasi && (
              <>
                <dt>{s.mode === 'daring' ? 'Tautan' : 'Tempat'}</dt>
                <dd style={{ wordBreak: 'break-all' }}>{/^https?:\/\//.test(s.lokasi) ? <a href={s.lokasi} target="_blank" rel="noreferrer">{s.lokasi}</a> : s.lokasi}</dd>
              </>
            )}
            {s.milestone?.nama && (
              <>
                <dt>Tahap</dt>
                <dd>{s.milestone.nama}</dd>
              </>
            )}
            {s.pesan && (
              <>
                <dt>Pesan</dt>
                <dd className="pre">{s.pesan}</dd>
              </>
            )}
            {s.alasan_status && s.status !== 'ditolak' && (
              <>
                <dt>Keterangan</dt>
                <dd>{s.alasan_status}</dd>
              </>
            )}
          </dl>
        </Panel>
      </div>

      <ScheduleModal
        open={modal === 'terima' || modal === 'jadwal_ulang'}
        mode={modal === 'jadwal_ulang' ? 'jadwal_ulang' : 'terima'}
        session={s}
        onClose={() => setModal(null)}
        onSubmit={(tanggal, lokasi, alasan) =>
          run(
            () => rpc('tanggapi_bimbingan', { p_id: s.id, p_aksi: modal === 'jadwal_ulang' ? 'jadwal_ulang' : 'terima', p_tanggal: tanggal, p_lokasi: lokasi || null, p_alasan: alasan || null }),
            modal === 'jadwal_ulang' ? 'Jadwal baru dikirim ke mahasiswa' : 'Bimbingan dijadwalkan',
          )
        }
      />
      <NotesModal
        open={modal === 'catatan'}
        session={s}
        onClose={() => setModal(null)}
        onSubmit={(v) =>
          run(
            () => rpc('catat_bimbingan', { p_id: s.id, p_ringkasan: v.ringkasan, p_saran: v.saran, p_tindak_lanjut: v.tindak_lanjut, p_hasil: v.hasil, p_sahkan: v.sahkan }),
            'Catatan bimbingan disimpan',
          )
        }
      />
      <RevisionModal
        open={modal === 'revisi'}
        onClose={() => setModal(null)}
        onSubmit={async (file, catatan) => {
          await run(() => uploadDraft({ thesisId: s.thesis_id, file, bab: bab!, milestoneId: s.milestone_id, catatan }), 'Revisi draf diunggah');
        }}
      />
    </>
  );
}

/* ------------------------------------------------------------------ */
function ScheduleModal({ open, mode, session, onClose, onSubmit }: { open: boolean; mode: 'terima' | 'jadwal_ulang'; session: Session; onClose: () => void; onSubmit: (tanggal: string, lokasi: string, alasan: string) => Promise<void> }) {
  const [tanggal, setTanggal] = useState('');
  const [lokasi, setLokasi] = useState('');
  const [alasan, setAlasan] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [lastOpen, setLastOpen] = useState(false);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      setTanggal(toLocalInput(session.tanggal_jadwal ?? session.tanggal_usulan));
      setLokasi(session.lokasi ?? '');
      setAlasan('');
      setErr(null);
    }
  }
  const submit = async () => {
    const iso = fromLocalInput(tanggal);
    if (!iso) return setErr('Tanggal tidak valid');
    setBusy(true);
    await onSubmit(iso, lokasi.trim(), alasan.trim());
    setBusy(false);
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={mode === 'terima' ? 'Terima dan jadwalkan' : 'Usulkan waktu lain'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Batal
          </Button>
          <Button variant="primary" loading={busy} onClick={submit}>
            {mode === 'terima' ? 'Jadwalkan bimbingan' : 'Kirim jadwal baru'}
          </Button>
        </>
      }
    >
      <div className="stack-sm">
        <Field label="Waktu bimbingan">
          <input type="datetime-local" value={tanggal} onChange={(e) => setTanggal(e.target.value)} />
        </Field>
        <Field label={session.mode === 'daring' ? 'Tautan rapat daring' : 'Tempat'}>
          <input value={lokasi} onChange={(e) => setLokasi(e.target.value)} placeholder={session.mode === 'daring' ? 'https://…' : 'mis. Ruang Dosen Lt. 2'} />
        </Field>
        {mode === 'jadwal_ulang' && (
          <Field label="Keterangan untuk mahasiswa">
            <textarea value={alasan} onChange={(e) => setAlasan(e.target.value)} />
          </Field>
        )}
        {err && <div className="note bad">{err}</div>}
      </div>
    </Modal>
  );
}

function NotesModal({
  open,
  session,
  onClose,
  onSubmit,
}: {
  open: boolean;
  session: Session;
  onClose: () => void;
  onSubmit: (v: { ringkasan: string; saran: string; tindak_lanjut: string; hasil: SessionResult; sahkan: boolean }) => Promise<void>;
}) {
  const [v, setV] = useState({ ringkasan: '', saran: '', tindak_lanjut: '', hasil: '' as SessionResult | '', sahkan: false });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastOpen, setLastOpen] = useState(false);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      setV({ ringkasan: session.ringkasan ?? '', saran: session.saran ?? '', tindak_lanjut: session.tindak_lanjut ?? '', hasil: session.hasil ?? '', sahkan: false });
      setErr(null);
    }
  }
  const submit = async () => {
    if (!v.ringkasan.trim()) return setErr('Ringkasan wajib diisi');
    if (!v.hasil) return setErr('Pilih hasil bimbingan');
    setBusy(true);
    await onSubmit({ ...v, hasil: v.hasil as SessionResult });
    setBusy(false);
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Catatan bimbingan"
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Batal
          </Button>
          <Button variant="primary" loading={busy} onClick={submit}>
            Simpan catatan
          </Button>
        </>
      }
    >
      <div className="stack-sm">
        <Field label="Ringkasan pembahasan">
          <textarea value={v.ringkasan} onChange={(e) => setV({ ...v, ringkasan: e.target.value })} />
        </Field>
        <Field label="Saran">
          <textarea value={v.saran} onChange={(e) => setV({ ...v, saran: e.target.value })} />
        </Field>
        <Field label="Tindak lanjut untuk mahasiswa">
          <textarea style={{ minHeight: 60 }} value={v.tindak_lanjut} onChange={(e) => setV({ ...v, tindak_lanjut: e.target.value })} />
        </Field>
        <fieldset style={{ border: 0, padding: 0, margin: '6px 0 0' }}>
          <legend className="label" style={{ marginBottom: 6 }}>
            Hasil bimbingan
          </legend>
          <div className="stack-sm">
            {(Object.keys(SESSION_RESULT) as SessionResult[]).map((k) => (
              <label key={k} className="check" style={{ alignItems: 'flex-start' }}>
                <input type="radio" name="hasil" checked={v.hasil === k} onChange={() => setV({ ...v, hasil: k })} style={{ marginTop: 4 }} />
                <span>
                  <span className="strong">{SESSION_RESULT[k].label}</span>
                  <br />
                  <span className="muted small">{SESSION_RESULT[k].help}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        {!session.milestone_id && <div className="note small">Sesi ini tidak terkait milestone tertentu, sehingga hasilnya tidak mengubah status milestone.</div>}
        <label className="check" style={{ marginTop: 6 }}>
          <input type="checkbox" checked={v.sahkan} onChange={(e) => setV({ ...v, sahkan: e.target.checked })} />
          Sahkan sesi sekarang (catatan tidak dapat diubah lagi)
        </label>
        {err && <div className="note bad">{err}</div>}
      </div>
    </Modal>
  );
}

function RevisionModal({ open, onClose, onSubmit }: { open: boolean; onClose: () => void; onSubmit: (file: File, catatan: string) => Promise<void> }) {
  const [file, setFile] = useState<File | null>(null);
  const [catatan, setCatatan] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!file) return setErr('Pilih berkas draf');
    const v = validateDraft(file);
    if (v) return setErr(v);
    setBusy(true);
    await onSubmit(file, catatan.trim());
    setBusy(false);
    setFile(null);
    setCatatan('');
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Unggah revisi draf"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Batal
          </Button>
          <Button variant="primary" loading={busy} onClick={submit}>
            Unggah revisi
          </Button>
        </>
      }
    >
      <div className="stack-sm">
        <p className="muted small">Revisi tersimpan sebagai versi baru. Untuk meminta review, ajukan sesi bimbingan baru dan lampirkan draf tersebut.</p>
        <Field label="Berkas" hint="PDF, DOC, atau DOCX, maksimal 20 MB">
          <input type="file" accept={DRAFT_TYPES} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </Field>
        <Field label="Catatan perubahan">
          <textarea style={{ minHeight: 60 }} value={catatan} onChange={(e) => setCatatan(e.target.value)} placeholder="mis. Menambahkan data pada latar belakang" />
        </Field>
        {err && <div className="note bad">{err}</div>}
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
function Comments({ sessionId, thesisId, comments, onChange, canWrite, userId }: { sessionId: string; thesisId: string; comments: CommentRow[]; onChange: () => void; canWrite: boolean; userId: string }) {
  const toast = useToast();
  const [bagian, setBagian] = useState('');
  const [isi, setIsi] = useState('');
  const [busy, setBusy] = useState(false);

  const send = async () => {
    if (!isi.trim()) return;
    setBusy(true);
    try {
      await must(supabase.from('comments').insert({ thesis_id: thesisId, session_id: sessionId, bagian: bagian.trim() || null, isi: isi.trim(), penulis_id: userId }));
      setIsi('');
      onChange();
    } catch (e) {
      toast.show((e as Error).message, 'bad');
    } finally {
      setBusy(false);
    }
  };
  const toggle = async (c: CommentRow) => {
    try {
      await must(supabase.from('comments').update({ selesai: !c.selesai }).eq('id', c.id));
      onChange();
    } catch (e) {
      toast.show((e as Error).message, 'bad');
    }
  };

  return (
    <Panel title="Komentar per bagian" sub="Tautkan komentar ke bab atau subbab agar mudah ditindaklanjuti" flush>
      <ul className="list">
        {comments.map((c) => (
          <li key={c.id}>
            <div className="row-between">
              <span className="small">
                <span className="strong">{c.penulis?.nama}</span> <span className="muted">{fmtDateTime(c.created_at)}</span>
              </span>
              <label className="check small">
                <input type="checkbox" checked={c.selesai} onChange={() => toggle(c)} disabled={!canWrite} />
                Selesai
              </label>
            </div>
            {c.bagian && (
              <div style={{ marginTop: 4 }}>
                <Badge tone="brand">{c.bagian}</Badge>
              </div>
            )}
            <div className="pre" style={{ marginTop: 6, textDecoration: c.selesai ? 'line-through' : undefined, color: c.selesai ? 'var(--ink-3)' : undefined }}>
              {c.isi}
            </div>
          </li>
        ))}
        {comments.length === 0 && <li className="muted small">Belum ada komentar.</li>}
      </ul>
      {canWrite && (
        <div className="stack-sm" style={{ padding: 18, borderTop: '1px solid var(--line)' }}>
          <div className="form-grid">
            <Field label="Bagian">
              <input value={bagian} onChange={(e) => setBagian(e.target.value)} placeholder="mis. 1.2 Rumusan Masalah" />
            </Field>
          </div>
          <Field label="Komentar">
            <textarea style={{ minHeight: 70 }} value={isi} onChange={(e) => setIsi(e.target.value)} />
          </Field>
          <div>
            <Button variant="primary" loading={busy} disabled={!isi.trim()} onClick={send}>
              Kirim komentar
            </Button>
          </div>
        </div>
      )}
    </Panel>
  );
}

/** Mahasiswa menautkan pengajuan bab ke sesi yang belum berlangsung. */
function LinkSubmission({ sessionId, thesisId, onDone }: { sessionId: string; thesisId: string; onDone: () => void }) {
  const toast = useToast();
  const [sel, setSel] = useState('');
  const [busy, setBusy] = useState(false);
  const subs = useAsync(
    async () =>
      (await must(supabase.from('chapter_submissions').select('id, bab, nomor, judul, status').eq('thesis_id', thesisId).neq('status', 'ditarik').order('created_at', { ascending: false }).limit(30))) as {
        id: string;
        bab: number;
        nomor: number;
        judul: string;
        status: string;
      }[],
    [thesisId],
  );
  if (!subs.data?.length) {
    return (
      <p className="muted small" style={{ margin: 0 }}>
        Belum ada bab yang diajukan dari Naskah. <Link to="/naskah">Buka Naskah</Link> lalu pilih Ajukan bab agar pembimbing dapat mengomentari isinya langsung.
      </p>
    );
  }
  const save = async () => {
    if (!sel) return;
    setBusy(true);
    try {
      await rpc('tautkan_pengajuan_sesi', { p_session: sessionId, p_submission: sel });
      onDone();
    } catch (e) {
      toast.show((e as Error).message, 'bad');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
      <select value={sel} onChange={(e) => setSel(e.target.value)} style={{ flex: '1 1 260px' }} aria-label="Pengajuan bab">
        <option value="">Pilih pengajuan bab</option>
        {subs.data.map((x) => (
          <option key={x.id} value={x.id}>
            Bab {x.bab} {x.judul}, pengajuan ke-{x.nomor}
          </option>
        ))}
      </select>
      <Button size="sm" variant="primary" loading={busy} disabled={!sel} onClick={save}>
        Tautkan
      </Button>
    </div>
  );
}
