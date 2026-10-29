import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { EditorContent, useEditor } from '@tiptap/react';
import { useAuth } from '../../lib/auth';
import { useAsync } from '../../lib/useAsync';
import { must, supabase } from '../../lib/supabase';
import { getThesis, rpc } from '../../lib/queries';
import { fmtDateTime } from '../../lib/format';
import { useQueryState, useRegisterEntity } from '../../lib/shell';
import { naskahExtensions } from '../../lib/naskah/extensions';
import { quoteAt } from '../../lib/naskah/anchor';
import { roman, type PmNode } from '../../lib/naskah/struktur';
import { anchorComments, loadReviewData, SUBMISSION_COLS, threads, type CommentThread, type ReviewData } from '../../lib/naskah/review';
import type { ChapterSubmission, Thesis } from '../../lib/types';
import { Badge, Button, ErrorNote, Loading, Tabs } from '../../components/ui';
import { useDialog } from '../../components/Dialog';
import { useToast } from '../../components/Toast';
import { IconArrowLeft } from '../../components/Icons';
import { imageView } from './Naskah';
import { CommentPanel } from './CommentPanel';
import { AisysReviewPanel } from './Aisys';
import { FocusButton, SideDock, sideStyle, useSideWidth } from './Workspace';
import { DiffView } from './DiffView';
import { citedIds, loadCiteStyle, loadReferences } from '../../lib/pustaka/data';
import type { Reference } from '../../lib/pustaka/csl';
import type { CiteStyle } from '../../lib/pustaka/format';

type Tab = 'naskah' | 'perubahan';

export function ReviewBab() {
  const { thesisId, submissionId } = useParams();
  const { userId } = useAuth();
  const st = useAsync<Loaded>(async () => {
    // Semua yang hanya butuh id diambil bersamaan pada tahap pertama.
    const [thesis, sub, data, refs, full] = await Promise.all([
      getThesis(thesisId!),
      must(supabase.from('chapter_submissions').select(`${SUBMISSION_COLS}, konten`).eq('id', submissionId!).maybeSingle()),
      loadReviewData(thesisId!),
      loadReferences(thesisId!).catch(() => [] as Reference[]),
      // Urutan sitasi naskah lengkap, agar nomor IEEE di potongan bab sama dengan naskah.
      supabase.from('thesis_manuscripts').select('konten').eq('thesis_id', thesisId!).maybeSingle().then((r) => (r.data as { konten: PmNode } | null)?.konten ?? null),
    ]);
    if (!thesis || !sub) throw new Error('Pengajuan tidak ditemukan atau Anda tidak berhak melihatnya');
    const s = sub as unknown as ChapterSubmission & { konten: PmNode };
    const prevMeta = data.submissions.filter((x) => x.bab === s.bab && x.nomor < s.nomor && x.status !== 'ditarik').pop() ?? null;
    const [prev, mhs, approvals, gaya] = await Promise.all([
      prevMeta ? must(supabase.from('chapter_submissions').select('konten').eq('id', prevMeta.id).single()) : Promise.resolve(null),
      must(supabase.from('profiles').select('nama, nim').eq('id', thesis.mahasiswa_id).maybeSingle()),
      s.milestone_id ? must(supabase.from('milestone_approvals').select('dosen_id, peran, created_at').eq('milestone_id', s.milestone_id)) : Promise.resolve([]),
      loadCiteStyle(thesis.prodi_id),
    ]);
    return {
      thesis,
      sub: s,
      prevMeta,
      prevKonten: (prev as { konten: PmNode } | null)?.konten ?? null,
      mhs: mhs as { nama: string; nim: string | null } | null,
      approvals: approvals as { dosen_id: string; peran: 'P1' | 'P2'; created_at: string }[],
      data,
      pustaka: { refs, style: gaya.style, order: citedIds(full) },
    };
  }, [thesisId, submissionId]);

  useRegisterEntity(
    st.data && st.data.thesis.mahasiswa_id !== userId
      ? { kind: 'thesis', id: thesisId!, title: st.data.mhs?.nama ?? 'Mahasiswa', sub: st.data.mhs?.nim ?? undefined, basePath: `/mahasiswa-bimbingan/${thesisId}` }
      : null,
  );

  if (st.loading && !st.data) return <Loading variant="editor" />;
  if (st.error) return <ErrorNote error={st.error} onRetry={st.reload} />;
  return <ReviewView key={submissionId} d={st.data!} reload={st.reload} />;
}

interface Loaded {
  thesis: Thesis;
  sub: ChapterSubmission & { konten: PmNode };
  prevMeta: ChapterSubmission | null;
  prevKonten: PmNode | null;
  mhs: { nama: string; nim: string | null } | null;
  approvals: { dosen_id: string; peran: 'P1' | 'P2'; created_at: string }[];
  data: ReviewData;
  pustaka: { refs: Reference[]; style: CiteStyle; order: string[] };
}

function ReviewView({ d, reload }: { d: Loaded; reload: () => void }) {
  const { userId } = useAuth();
  const dialog = useDialog();
  const toast = useToast();
  const { thesis, sub, data } = d;
  const [tab, setTab] = useQueryState<Tab>('tab', 'naskah');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pending, setPending] = useState<{ from: number; to: number; top: number; left: number } | null>(null);
  const [composing, setComposing] = useState<{ from: number; to: number; kutipan: string } | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [sideW, setSideW] = useSideWidth();
  const wrapRef = useRef<HTMLDivElement>(null);

  const myPeran = userId ? data.peran.get(userId) : undefined;
  const isOwner = thesis.mahasiswa_id === userId;
  const mode: 'mahasiswa' | 'dosen' | 'baca' = isOwner ? 'mahasiswa' : myPeran ? 'dosen' : 'baca';
  const canComment = !!myPeran && sub.status !== 'ditarik';

  const babSubs = data.submissions.filter((s) => s.bab === sub.bab);
  const nomorPengajuan = new Map<string, number>(babSubs.map((s) => [s.id, s.nomor]));
  const subIds = new Set(babSubs.filter((s) => s.nomor <= sub.nomor).map((s) => s.id));
  const list: CommentThread[] = useMemo(
    () => threads(data.comments.filter((c) => c.bab === sub.bab && subIds.has(c.submission_id))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.comments, sub.bab, sub.nomor],
  );
  const reviews = data.reviews.filter((r) => r.submission_id === sub.id);
  const myReview = reviews.find((r) => r.dosen_id === userId);
  const accEarlier = !!userId && (d.approvals.some((a) => a.dosen_id === userId) || data.reviews.some((r) => r.dosen_id === userId && r.hasil === 'acc' && babSubs.some((s) => s.id === r.submission_id)));
  const isLatest = !babSubs.some((s) => s.nomor > sub.nomor && s.status !== 'ditarik');
  const canDecide = !!myPeran && !myReview && !accEarlier && isLatest && sub.status === 'diajukan';
  const draftMode = !!myPeran && sub.status === 'diajukan' && !myReview && !accEarlier;
  const otherReviews = reviews.filter((r) => r.dosen_id !== userId);
  const drafts = list.filter((t) => !t.root.terkirim && t.root.penulis_id === userId).length;

  const extensions = useMemo(() => naskahExtensions({ imageView, babAwal: sub.bab, onCommentClick: (id) => setActiveId(id) }), [sub.bab]);
  const editor = useEditor({ extensions, content: sub.konten, editable: false, immediatelyRender: true, editorProps: { attributes: { class: 'nk-doc', lang: 'id' } } }, [sub.id]);
  useEffect(() => {
    if (editor) editor.commands.setPustaka(d.pustaka.refs, d.pustaka.style, d.pustaka.order);
  }, [editor, d.pustaka]);

  const anchored = useMemo(() => {
    if (!editor) return { marks: [], orphans: new Set<string>() };
    return anchorComments(editor.state.doc, list, {
      snapshotOf: sub.id,
      cls: (t) => [data.peran.get(t.root.penulis_id)?.toLowerCase() ?? '', t.root.terkirim ? '' : 'draf', t.root.status, t.root.id === activeId ? 'aktif' : ''].join(' '),
    });
  }, [editor, list, sub.id, activeId, data.peran]);

  useEffect(() => {
    if (editor) editor.commands.setCommentMarks(anchored.marks);
  }, [editor, anchored]);

  const activate = (id: string) => {
    setActiveId(id);
    const el = editor?.view.dom.querySelector(`[data-cmt="${id}"]`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  useEffect(() => {
    if (!activeId) return;
    document.getElementById(`cmt-${activeId}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [activeId]);

  const onMouseUp = () => {
    if (!editor || !canComment || tab !== 'naskah') return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.anchorNode || !sel.focusNode) return setPending(null);
    const dom = editor.view.dom;
    if (!dom.contains(sel.anchorNode) || !dom.contains(sel.focusNode)) return setPending(null);
    try {
      const a = editor.view.posAtDOM(sel.anchorNode, sel.anchorOffset);
      const b = editor.view.posAtDOM(sel.focusNode, sel.focusOffset);
      const from = Math.min(a, b);
      const to = Math.max(a, b);
      if (to - from < 2) return setPending(null);
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      const box = wrapRef.current!.getBoundingClientRect();
      setPending({ from, to, top: rect.bottom - box.top + 6, left: Math.min(Math.max(rect.left - box.left + rect.width / 2 - 70, 8), box.width - 160) });
    } catch {
      setPending(null);
    }
  };

  const startComment = () => {
    if (!editor || !pending) return;
    const q = quoteAt(editor.state.doc, pending.from, pending.to);
    if (!q) return;
    setComposing({ from: pending.from, to: pending.to, kutipan: q.kutipan });
    setText('');
    setPending(null);
    window.getSelection()?.removeAllRanges();
  };

  const saveComment = async () => {
    if (!editor || !composing || !text.trim()) return;
    const q = quoteAt(editor.state.doc, composing.from, composing.to);
    if (!q) return;
    setBusy(true);
    try {
      await rpc('komentar_naskah', { p_submission: sub.id, p_isi: text.trim(), p_kutipan: q.kutipan, p_prefix: q.prefix, p_suffix: q.suffix, p_posisi: { from: composing.from, to: composing.to } });
      setComposing(null);
      setText('');
      reload();
    } catch (e) {
      toast.show((e as Error).message, 'bad');
    } finally {
      setBusy(false);
    }
  };

  const decide = async (hasil: 'revisi' | 'acc') => {
    let catatan: string | null;
    if (hasil === 'revisi') {
      catatan = await dialog.prompt({
        title: `Minta revisi Bab ${sub.bab}`,
        message: drafts ? `${drafts} komentar draf Anda akan dikirim ke mahasiswa bersama keputusan ini.` : 'Belum ada komentar di naskah. Tulis catatan revisi untuk mahasiswa.',
        label: 'Catatan revisi umum',
        multiline: true,
        required: drafts === 0,
        confirmLabel: 'Kirim revisi',
      });
    } else {
      catatan = await dialog.prompt({
        title: `ACC Bab ${sub.bab}?`,
        message: `ACC dicatat dengan kode verifikasi. Bab selesai setelah Pembimbing 1 dan Pembimbing 2 sama-sama ACC.${drafts ? ` ${drafts} komentar draf ikut dikirim sebagai catatan.` : ''}`,
        label: 'Catatan (opsional)',
        confirmLabel: 'Beri ACC',
      });
    }
    if (catatan === null) return;
    setBusy(true);
    try {
      const r = await rpc<string>('tinjau_bab', { p_submission: sub.id, p_hasil: hasil, p_catatan: catatan || null });
      toast.show(hasil === 'revisi' ? 'Revisi dikirim ke mahasiswa' : r === 'selesai' ? `Bab ${sub.bab} selesai: ACC Pembimbing 1 dan 2` : 'ACC tercatat, menunggu pembimbing lainnya', 'ok');
      reload();
    } catch (e) {
      toast.show((e as Error).message, 'bad');
    } finally {
      setBusy(false);
    }
  };

  const sendDrafts = async () => {
    const ok = await dialog.confirm({
      title: `Kirim ${drafts} komentar sekarang?`,
      message: 'Komentar langsung terlihat oleh mahasiswa. Keputusan Revisi atau ACC dapat diberikan kemudian.',
      confirmLabel: 'Kirim komentar',
    });
    if (!ok) return;
    setBusy(true);
    try {
      await rpc('kirim_komentar', { p_submission: sub.id });
      toast.show('Komentar terkirim ke mahasiswa', 'ok');
      reload();
    } catch (e) {
      toast.show((e as Error).message, 'bad');
    } finally {
      setBusy(false);
    }
  };

  const decision = myPeran ? (
    <div className="nk-decide">
      {canDecide ? (
        <>
          <div className="small">
            {drafts ? (
              <>
                <span className="strong">{drafts} draf</span> akan dikirim bersama keputusan Anda ({myPeran}).
              </>
            ) : (
              <>Keputusan Anda sebagai {myPeran} untuk pengajuan ini.</>
            )}
            {otherReviews.length > 0 && (
              <div className="muted">
                {otherReviews.map((r) => `${r.peran} sudah memberi ${r.hasil === 'acc' ? 'ACC' : 'revisi'}`).join(', ')}; keputusan Anda tetap diperlukan.
              </div>
            )}
          </div>
          <div className="nk-decide-actions">
            <Button onClick={() => decide('revisi')} loading={busy}>
              Minta revisi
            </Button>
            <Button variant="primary" onClick={() => decide('acc')} loading={busy}>
              ACC bab ini
            </Button>
          </div>
          {drafts > 0 && (
            <button type="button" className="link-btn small" onClick={sendDrafts} disabled={busy}>
              Kirim {drafts} komentar saja, keputusan menyusul
            </button>
          )}
        </>
      ) : (
        <div className="small muted">
          {myReview
            ? `Keputusan Anda: ${myReview.hasil === 'acc' ? 'ACC' : 'Revisi'} (${fmtDateTime(myReview.created_at)}), kode ${myReview.kode}.`
            : accEarlier
              ? 'Anda sudah memberi ACC untuk bab ini. Komentar tambahan langsung terlihat oleh mahasiswa.'
              : !isLatest
                ? 'Keputusan diberikan pada pengajuan terbaru.'
                : 'Pengajuan ini sudah ditutup.'}
          {drafts > 0 && (
            <div>
              <button type="button" className="link-btn" onClick={sendDrafts} disabled={busy}>
                Kirim {drafts} komentar draf
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  ) : null;

  const back = isOwner ? '/naskah' : `/naskah/${thesis.id}`;
  const babLabel = `BAB ${roman(sub.bab)}`;

  return (
    <div className="nk-shell">
      <div>
        <Link to={back} className="back">
          <IconArrowLeft size={16} /> Naskah
        </Link>
        <div className="nk-head">
          <div style={{ minWidth: 0 }}>
            <h1 className="page-title">
              Review {babLabel} {sub.judul}
            </h1>
            <div className="nk-head-sub">
              <span className="nk-title-line">
                {d.mhs?.nama}
                {d.mhs?.nim ? `, ${d.mhs.nim}` : ''}. Pengajuan ke-{sub.nomor}, {fmtDateTime(sub.created_at)}.
              </span>
              {sub.catatan && <span className="nk-meta">Catatan mahasiswa: {sub.catatan}</span>}
            </div>
          </div>
          <div className="nk-head-actions">
            <FocusButton />
            {myPeran && sub.status !== 'ditarik' && tab === 'naskah' && (
              <Button onClick={() => setAiOpen(!aiOpen)} aria-pressed={aiOpen}>
                Periksa dengan AISYS
              </Button>
            )}
            {(['P1', 'P2'] as const).map((p) => {
              const r = reviews.find((x) => x.peran === p);
              const accOld = d.approvals.find((a) => a.peran === p);
              return (
                <Badge key={p} tone={r?.hasil === 'acc' || accOld ? 'ok' : r?.hasil === 'revisi' ? 'warn' : 'neutral'}>
                  {p}: {r ? (r.hasil === 'acc' ? 'ACC' : 'Revisi') : accOld ? 'ACC sebelumnya' : 'Belum ditinjau'}
                </Badge>
              );
            })}
            <Badge tone={sub.status === 'acc' ? 'ok' : sub.status === 'revisi' ? 'warn' : sub.status === 'ditarik' ? 'neutral' : 'info'}>
              {sub.status === 'diajukan' ? 'Menunggu review' : sub.status === 'acc' ? 'Bab di-ACC' : sub.status === 'revisi' ? 'Perlu revisi' : 'Ditarik'}
            </Badge>
          </div>
        </div>
      </div>

      {!isLatest && <div className="note warn nk-banner">Sudah ada pengajuan yang lebih baru untuk bab ini. Halaman ini menampilkan pengajuan lama.</div>}

      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        items={[
          { value: 'naskah', label: 'Naskah bab' },
          { value: 'perubahan', label: d.prevMeta ? `Perubahan sejak pengajuan ke-${d.prevMeta.nomor}` : 'Perubahan' },
        ]}
      />

      {tab === 'perubahan' ? (
        d.prevKonten ? (
          <div className="nk-review">
            <DiffView oldDoc={d.prevKonten} newDoc={sub.konten} bab={sub.bab} oldLabel={`pengajuan ke-${d.prevMeta!.nomor}`} newLabel={`pengajuan ke-${sub.nomor}`} />
            {decision && <div className="nk-decide-card">{decision}</div>}
          </div>
        ) : (
          <div className="note">Ini pengajuan pertama untuk bab ini, belum ada versi pembanding.</div>
        )
      ) : (
        <div className="nk-review" style={sideStyle(sideW)}>
          <div className="nk-paper-wrap" ref={wrapRef} onMouseUp={onMouseUp} style={{ position: 'relative' }}>
            {canComment && <div className="nk-hint small muted">Blok teks di naskah untuk memberi komentar.</div>}
            <EditorContent editor={editor} className="nk-paper" />
            {pending && (
              <button type="button" className="btn btn-sm btn-primary nk-float" style={{ top: pending.top, left: pending.left }} onMouseDown={(e) => e.preventDefault()} onClick={startComment}>
                Beri komentar
              </button>
            )}
          </div>
          <SideDock width={sideW} onWidth={setSideW} label={aiOpen ? 'AISYS' : 'komentar'}>
          {aiOpen && editor ? (
            <AisysReviewPanel editor={editor} submissionId={sub.id} canComment={canComment} draftMode={draftMode} footer={decision} onClose={() => setAiOpen(false)} onCommented={reload} />
          ) : (
          <CommentPanel
            list={list}
            mode={mode}
            userId={userId}
            peran={data.peran}
            activeId={activeId}
            orphans={anchored.orphans}
            nomorPengajuan={nomorPengajuan}
            onActivate={activate}
            onChanged={reload}
            footer={decision}
            title="Komentar bab ini"
            empty={canComment ? 'Belum ada komentar. Blok teks di naskah untuk menambahkan.' : 'Belum ada komentar.'}
            composer={
              composing && (
                <div className="nk-composer">
                  <blockquote className="nk-quote clamp">{composing.kutipan}</blockquote>
                  {composing.kutipan.length > 300 && (
                    <p className="nk-hint-long small">Sorotan cukup panjang. Sorot kalimat yang dimaksud agar mahasiswa lebih mudah memperbaikinya, atau lanjutkan bila memang satu paragraf.</p>
                  )}
                  <textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="Tulis komentar atau saran perbaikan" />
                  <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                    <Button size="sm" variant="ghost" onClick={() => setComposing(null)}>
                      Batal
                    </Button>
                    <Button size="sm" variant="primary" loading={busy} disabled={!text.trim()} onClick={saveComment}>
                      Simpan komentar
                    </Button>
                  </div>
                  <p className="muted small" style={{ margin: 0 }}>
                    {draftMode ? 'Tersimpan sebagai draf. Terkirim ke mahasiswa bersama keputusan Anda, atau lewat tombol Kirim komentar.' : 'Langsung terlihat oleh mahasiswa.'}
                  </p>
                </div>
              )
            }
          />
          )}
          </SideDock>
        </div>
      )}

    </div>
  );
}
