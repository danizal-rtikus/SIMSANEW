import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { EditorContent, NodeViewWrapper, ReactNodeViewRenderer, useEditor, type Editor, type NodeViewProps } from '@tiptap/react';
import { useAuth } from '../../lib/auth';
import { useAsync } from '../../lib/useAsync';
import { must, supabase } from '../../lib/supabase';
import { getMyThesis, getThesis, rpc } from '../../lib/queries';
import { loadProdi } from '../../lib/master';
import { fmtDateTime } from '../../lib/format';
import { BRAND } from '../../lib/brand';
import { useRegisterEntity } from '../../lib/shell';
import { naskahExtensions } from '../../lib/naskah/extensions';
import { analyzeBlocks, countWords, initialDoc, type PmNode } from '../../lib/naskah/struktur';
import { anchorComments, babState, loadReviewData, threads } from '../../lib/naskah/review';
import { CommentPanel } from './CommentPanel';
import { AjukanBabModal, ImportWordModal } from './NaskahDialogs';
import { CiteDialog, PustakaPanel, usePustaka, type CiteMode } from './Pustaka';
import { AisysPanel } from './Aisys';
import type { CiteStyle } from '../../lib/pustaka/format';
import type { Reference } from '../../lib/pustaka/csl';
import type { ResolvedImage } from '../../lib/naskah/docx';
import type { Thesis } from '../../lib/types';
import { Badge, Button, Empty, ErrorNote, Loading, Panel } from '../../components/ui';
import { Modal, useDialog } from '../../components/Dialog';
import { useToast } from '../../components/Toast';
import {
  IconAlignCenter,
  IconAlignJustify,
  IconAlignLeft,
  IconAlignRight,
  IconBook,
  IconDownload,
  IconHistory,
  IconImage,
  IconIndent,
  IconListBullet,
  IconListNumber,
  IconOutdent,
  IconPageBreak,
  IconPrinter,
  IconQuote,
  IconRedo,
  IconTable,
  IconUndo,
  IconUpload,
} from '../../components/Icons';

interface ManuscriptRow {
  thesis_id: string;
  konten: PmNode;
  revisi: number;
  jumlah_kata: number;
  updated_at: string;
}
interface VersionRow {
  id: string;
  nomor: number;
  jumlah_kata: number;
  catatan: string | null;
  sumber: 'editor' | 'word';
  created_at: string;
  pembuat?: { nama: string } | null;
}

/* ------------------------------------------------------------------ */
/* Halaman                                                             */
/* ------------------------------------------------------------------ */

export function MyNaskah() {
  const { userId } = useAuth();
  const navigate = useNavigate();
  const st = useAsync(() => getMyThesis(userId!), [userId]);
  if (st.loading && !st.data) return <Loading />;
  if (st.error) return <ErrorNote error={st.error} onRetry={st.reload} />;
  if (!st.data)
    return (
      <Panel>
        <Empty title="Naskah tersedia setelah pendaftaran diterima" action={<Button onClick={() => navigate('/judul')}>Daftar tugas akhir</Button>}>
          Setelah Ka. Prodi menerima pendaftaran Anda, kerangka naskah sesuai pedoman disiapkan di sini.
        </Empty>
      </Panel>
    );
  return <NaskahView thesisId={st.data.id} self />;
}

export function NaskahPage() {
  const { thesisId } = useParams();
  return <NaskahView thesisId={thesisId!} />;
}

function NaskahView({ thesisId, self }: { thesisId: string; self?: boolean }) {
  const { userId } = useAuth();
  const st = useAsync(async () => {
    const thesis = await getThesis(thesisId);
    if (!thesis) throw new Error('Studi akhir tidak ditemukan atau Anda tidak berhak melihatnya');
    const [row, mhs, prodi] = await Promise.all([
      must(supabase.from('thesis_manuscripts').select('thesis_id, konten, revisi, jumlah_kata, updated_at').eq('thesis_id', thesisId).maybeSingle()),
      must(supabase.from('profiles').select('nama, nim').eq('id', thesis.mahasiswa_id).maybeSingle()),
      loadProdi(),
    ]);
    return {
      thesis,
      row: row as ManuscriptRow | null,
      mhs: mhs as { nama: string; nim: string | null } | null,
      prodiNama: prodi.find((p) => p.id === thesis.prodi_id)?.nama ?? '',
    };
  }, [thesisId]);

  useRegisterEntity(
    !self && st.data
      ? {
          kind: 'thesis',
          id: thesisId,
          title: st.data.mhs?.nama ?? 'Mahasiswa',
          sub: st.data.mhs?.nim ?? undefined,
          basePath: `/mahasiswa-bimbingan/${thesisId}`,
        }
      : null,
  );

  if (st.loading && !st.data) return <Loading />;
  if (st.error) return <ErrorNote error={st.error} onRetry={st.reload} />;
  const { thesis, row, mhs, prodiNama } = st.data!;
  const canEdit = thesis.mahasiswa_id === userId && thesis.status === 'aktif';

  if (!row && !canEdit) {
    return (
      <Panel>
        <Empty
          title="Mahasiswa belum menulis naskah di SIMSA"
          action={
            <Link className="btn" to={`/mahasiswa-bimbingan/${thesisId}?tab=draf`}>
              Lihat draf unggahan
            </Link>
          }
        >
          Mahasiswa yang memakai file Word mengunggah drafnya di tab Draf.
        </Empty>
      </Panel>
    );
  }

  return (
    <NaskahWorkspace
      key={thesisId}
      thesis={thesis}
      initial={row?.konten ?? initialDoc(thesis.jenjang)}
      revisi={row?.revisi ?? null}
      updatedAt={row?.updated_at ?? null}
      canEdit={canEdit}
      self={!!self}
      meta={{ nama: mhs?.nama ?? '', nim: mhs?.nim ?? '', prodi: prodiNama }}
    />
  );
}

/* ------------------------------------------------------------------ */
/* Gambar: URL bertanda tangan dari bucket privat                      */
/* ------------------------------------------------------------------ */

const urlCache = new Map<string, { url: string; exp: number }>();
async function signedUrl(path: string): Promise<string> {
  const hit = urlCache.get(path);
  if (hit && hit.exp > Date.now()) return hit.url;
  const { data, error } = await supabase.storage.from('naskah').createSignedUrl(path, 3600);
  if (error || !data) throw new Error(error?.message ?? 'Gambar tidak dapat dimuat');
  urlCache.set(path, { url: data.signedUrl, exp: Date.now() + 50 * 60 * 1000 });
  return data.signedUrl;
}

function ImageView({ node, selected, updateAttributes, editor }: NodeViewProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState(false);
  const path = node.attrs.path as string | null;
  useEffect(() => {
    let alive = true;
    if (path) signedUrl(path).then((u) => alive && setUrl(u)).catch(() => alive && setErr(true));
    return () => {
      alive = false;
    };
  }, [path]);
  const lebar = Number(node.attrs.lebar) || 100;
  return (
    <NodeViewWrapper className={`nk-figure ${selected ? 'is-selected' : ''}`} data-drag-handle="">
      {url ? (
        <img src={url} alt={node.attrs.alt ?? ''} style={{ width: `${lebar}%` }} draggable={false} />
      ) : (
        <div className="nk-img-placeholder">{err ? 'Gambar tidak dapat dimuat' : 'Memuat gambar'}</div>
      )}
      {selected && editor.isEditable && (
        <div className="nk-img-tools" contentEditable={false}>
          <span className="muted small">Lebar</span>
          {[40, 60, 80, 100].map((w) => (
            <button key={w} type="button" className={lebar === w ? 'on' : ''} onClick={() => updateAttributes({ lebar: w })}>
              {w}%
            </button>
          ))}
        </div>
      )}
    </NodeViewWrapper>
  );
}

export const imageView = { addNodeView: () => ReactNodeViewRenderer(ImageView) };

/* ------------------------------------------------------------------ */
/* Ruang kerja                                                         */
/* ------------------------------------------------------------------ */

type SaveState = 'tersimpan' | 'belum' | 'menyimpan' | 'gagal' | 'konflik';

function NaskahWorkspace({
  thesis,
  initial,
  revisi,
  updatedAt,
  canEdit,
  self,
  meta,
}: {
  thesis: Thesis;
  initial: PmNode;
  revisi: number | null;
  updatedAt: string | null;
  canEdit: boolean;
  self: boolean;
  meta: { nama: string; nim: string; prodi: string };
}) {
  const dialog = useDialog();
  const toast = useToast();
  const { userId } = useAuth();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [citeMode, setCiteMode] = useState<CiteMode | null>(null);
  const extensions = useMemo(
    () =>
      naskahExtensions({
        imageView,
        onCommentClick: (id) => setActiveId(id),
        onCitationClick: (pos, a) => setCiteMode({ kind: 'edit', pos, ...a }),
      }),
    [],
  );
  const editor = useEditor({
    extensions,
    content: initial,
    editable: canEdit,
    immediatelyRender: true,
    shouldRerenderOnTransaction: true,
    editorProps: { attributes: { class: 'nk-doc', 'aria-label': 'Isi naskah', lang: 'id', spellcheck: 'false' } },
  });

  /* ---------- pustaka dan sitasi ---------- */
  const pk = usePustaka(thesis.id, thesis.prodi_id);
  useEffect(() => {
    if (editor && pk.refs) editor.commands.setPustaka(pk.refs, pk.style);
  }, [editor, pk.refs, pk.style]);

  /* ---------- simpan otomatis ---------- */
  const revRef = useRef<number | null>(revisi);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saving = useRef<Promise<void> | null>(null);
  const dirty = useRef(false);
  const [save, setSave] = useState<SaveState>('tersimpan');
  const [savedAt, setSavedAt] = useState<string | null>(updatedAt);

  const doSave = useCallback(async (): Promise<void> => {
    if (!editor || !canEdit) return;
    if (saving.current) {
      await saving.current;
      if (!dirty.current) return;
    }
    dirty.current = false;
    const json = editor.getJSON() as PmNode;
    setSave('menyimpan');
    const run = (async () => {
      try {
        const rev = await rpc<number>('simpan_naskah', { p_thesis: thesis.id, p_konten: json, p_revisi: revRef.current, p_kata: countWords(json) });
        revRef.current = rev;
        setSavedAt(new Date().toISOString());
        setSave(dirty.current ? 'belum' : 'tersimpan');
      } catch (e) {
        const msg = (e as Error).message;
        dirty.current = true;
        if (msg.startsWith('KONFLIK')) {
          setSave('konflik');
          const ok = await dialog.confirm({
            title: 'Naskah diubah di tempat lain',
            message: 'Naskah ini baru saja disimpan dari tab atau perangkat lain. Muat ulang untuk melihat versi terbaru. Perubahan di tab ini yang belum tersimpan akan hilang.',
            confirmLabel: 'Muat ulang',
          });
          if (ok) window.location.reload();
        } else {
          setSave('gagal');
        }
      }
    })();
    saving.current = run;
    await run;
    saving.current = null;
  }, [editor, canEdit, thesis.id, dialog]);

  useEffect(() => {
    if (!editor || !canEdit) return;
    const onUpdate = () => {
      dirty.current = true;
      setSave((s) => (s === 'konflik' ? s : 'belum'));
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void doSave(), 1200);
    };
    editor.on('update', onUpdate);
    return () => {
      editor.off('update', onUpdate);
    };
  }, [editor, canEdit, doSave]);

  // Simpan sisa perubahan saat meninggalkan halaman (navigasi di dalam aplikasi).
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      if (dirty.current) void doSave();
    },
    [doSave],
  );

  const flush = async () => {
    if (timer.current) clearTimeout(timer.current);
    if (dirty.current || saving.current) await doSave();
  };

  /* ---------- versi ---------- */
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [viewing, setViewing] = useState<{ v: VersionRow; konten: PmNode } | null>(null);

  const saveVersion = async () => {
    const catatan = await dialog.prompt({
      title: 'Simpan versi naskah',
      message: 'Versi adalah potret naskah saat ini. Dosen dapat melihat setiap versi, dan versi menjadi dasar perbandingan revisi.',
      label: 'Catatan versi (opsional)',
      confirmLabel: 'Simpan versi',
    });
    if (catatan === null) return;
    try {
      await flush();
      await rpc('buat_versi_naskah', { p_thesis: thesis.id, p_catatan: catatan || null });
      toast.show('Versi naskah disimpan', 'ok');
    } catch (e) {
      toast.show((e as Error).message, 'bad');
    }
  };

  /* ---------- ekspor ---------- */
  const [exporting, setExporting] = useState(false);
  const exportDocx = async () => {
    if (!editor) return;
    setExporting(true);
    try {
      const [{ buildDocx }, { Packer }] = await Promise.all([import('../../lib/naskah/docx'), import('docx')]);
      const doc = await buildDocx({
        doc: (viewing?.konten ?? editor.getJSON()) as PmNode,
        judul: thesis.judul,
        jenis: thesis.jenjang === 'S1' ? 'Skripsi' : 'Tugas Akhir',
        nama: meta.nama,
        nim: meta.nim,
        prodi: meta.prodi,
        institusi: BRAND.institutionLong,
        tahun: new Date().getFullYear(),
        logo: await loadImage(BRAND.logo).catch(() => null),
        resolveImage: async (path) => loadImage(await signedUrl(path)),
        pustaka: pk.refs ? { refs: pk.refs, style: pk.style } : null,
      });
      const blob = await Packer.toBlob(doc);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${thesis.jenjang === 'S1' ? 'Skripsi' : 'TA'}_${meta.nim || 'naskah'}${viewing ? `_v${viewing.v.nomor}` : ''}.docx`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      toast.show('DOCX diunduh. Saat dibuka di Word, pilih Ya untuk memperbarui daftar isi.', 'ok');
    } catch (e) {
      toast.show(`Ekspor gagal: ${(e as Error).message}`, 'bad');
    } finally {
      setExporting(false);
    }
  };

  const printPdf = () => {
    document.body.classList.add('nk-printing');
    const done = () => {
      document.body.classList.remove('nk-printing');
      window.removeEventListener('afterprint', done);
    };
    window.addEventListener('afterprint', done);
    window.print();
  };

  /* ---------- outline ---------- */
  const doc = editor?.state.doc;
  const outline = useMemo(() => {
    if (!doc) return [];
    const blocks: { type: string; attrs: Record<string, any>; text: string; pos: number }[] = [];
    doc.forEach((n, pos) => blocks.push({ type: n.type.name, attrs: n.attrs, text: n.type.name === 'heading' ? n.textContent : '', pos }));
    return analyzeBlocks(blocks).outline.map((o) => ({ ...o, pos: blocks[o.index].pos }));
  }, [doc]);
  const words = useMemo(() => (editor ? editor.storage.characterCount?.words?.() ?? 0 : 0), [editor, doc]);

  /* ---------- review: pengajuan dan komentar ---------- */
  const rv = useAsync(() => loadReviewData(thesis.id), [thesis.id]);
  const [ajukanOpen, setAjukanOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const isOwner = thesis.mahasiswa_id === userId;
  const myPeran = userId ? rv.data?.peran.get(userId) : undefined;
  const commentMode: 'mahasiswa' | 'dosen' | 'baca' = isOwner ? 'mahasiswa' : myPeran ? 'dosen' : 'baca';
  const commentList = useMemo(() => threads((rv.data?.comments ?? []).filter((c) => c.terkirim)), [rv.data]);
  const activeCount = commentList.filter((t) => t.root.status !== 'selesai').length;
  const [showComments, setShowComments] = useState<boolean | null>(null);
  const [panel, setPanel] = useState<'pustaka' | 'aisys' | null>(null);
  const pustakaOpen = panel === 'pustaka';
  const aisysOpen = panel === 'aisys' && canEdit;
  const commentsVisible = !panel && (showComments ?? activeCount > 0);
  const sideVisible = (commentsVisible || !!panel) && !viewing;
  const togglePanel = (p: 'pustaka' | 'aisys') => {
    if (panel === p) {
      setPanel(null);
      setShowComments(false);
    } else setPanel(p);
  };
  const nomorPengajuan = useMemo(() => new Map<string, number>((rv.data?.submissions ?? []).map((x) => [x.id, x.nomor])), [rv.data]);
  const [orphans, setOrphans] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!editor || viewing || !rv.data) return;
    const { marks, orphans: o } = anchorComments(editor.state.doc, commentList.filter((t) => t.root.status !== 'selesai'), {
      wholeNaskah: true,
      cls: (t) => [rv.data!.peran.get(t.root.penulis_id)?.toLowerCase() ?? '', t.root.status, t.root.id === activeId ? 'aktif' : ''].join(' '),
    });
    editor.commands.setCommentMarks(marks);
    setOrphans(o);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, rv.data, commentList, activeId, viewing]);

  useEffect(() => {
    if (activeId) document.getElementById(`cmt-${activeId}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [activeId]);

  const activateComment = (id: string) => {
    setActiveId(id);
    editor?.view.dom.querySelector(`[data-cmt="${id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const latestPerBab = useMemo(() => {
    const m = new Map<number, ReturnType<typeof babState>>();
    if (rv.data) for (const o of outline) if (o.level === 1 && o.nomor) m.set(o.bab, babState(rv.data, o.bab));
    return m;
  }, [rv.data, outline]);

  const jumpTo = (pos: number) => {
    if (!editor) return;
    const dom = editor.view.nodeDOM(pos) as HTMLElement | null;
    dom?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (canEdit) editor.commands.setTextSelection(pos + 1);
  };

  if (!editor) return <Loading />;

  return (
    <div className="nk-shell">
      <div className="nk-head">
        <div style={{ minWidth: 0 }}>
          <h1 className="page-title">Naskah</h1>
          <div className="nk-head-sub">
            <span className="nk-title-line">{thesis.judul}</span>
            <span className="nk-meta">
              <SaveBadge state={canEdit ? save : null} savedAt={savedAt} onRetry={() => void doSave()} />
              <span>{words.toLocaleString('id-ID')} kata</span>
            </span>
          </div>
        </div>
        <div className="nk-head-actions">
          {canEdit && (
            <Button onClick={() => setImportOpen(true)}>
              <IconUpload size={16} /> Impor dari Word
            </Button>
          )}
          <Button onClick={() => setVersionsOpen(true)}>
            <IconHistory size={16} /> Riwayat versi
          </Button>
          <Button onClick={printPdf}>
            <IconPrinter size={16} /> Cetak atau PDF
          </Button>
          <Button onClick={exportDocx} loading={exporting}>
            <IconDownload size={16} /> Unduh DOCX
          </Button>
          {canEdit && <Button onClick={saveVersion}>Simpan versi</Button>}
          {canEdit && (
            <Button variant="primary" onClick={() => setAjukanOpen(true)}>
              Ajukan bab
            </Button>
          )}
          {canEdit && (
            <Button onClick={() => togglePanel('aisys')} aria-pressed={aisysOpen}>
              AISYS
            </Button>
          )}
          <Button onClick={() => togglePanel('pustaka')} aria-pressed={pustakaOpen}>
            <IconBook size={16} /> Pustaka{pk.refs?.length ? ` (${pk.refs.length})` : ''}
          </Button>
          {commentList.length > 0 && (
            <Button
              onClick={() => {
                setPanel(null);
                setShowComments(!commentsVisible);
              }}
              aria-pressed={commentsVisible}
            >
              Catatan dosen{activeCount ? ` (${activeCount})` : ''}
            </Button>
          )}
        </div>
      </div>

      {viewing && (
        <div className="note info row-between nk-banner">
          <span>
            Anda melihat <span className="strong">versi {viewing.v.nomor}</span> ({fmtDateTime(viewing.v.created_at)}){viewing.v.catatan ? `: ${viewing.v.catatan}` : ''}. Versi ini hanya dapat dibaca.
          </span>
          <Button size="sm" onClick={() => setViewing(null)}>
            Kembali ke naskah terkini
          </Button>
        </div>
      )}
      {!canEdit && !viewing && thesis.status !== 'aktif' && <div className="note nk-banner">Studi akhir tidak aktif; naskah hanya dapat dibaca.</div>}
      {!isOwner && !viewing && rv.data && (
        <SubmissionStrip data={rv.data} thesisId={thesis.id} userId={userId} />
      )}

      <div className={`nk-body ${sideVisible ? 'with-comments' : ''}`}>
        <aside className="nk-outline" aria-label="Struktur naskah">
          <div className="nk-outline-title">Struktur</div>
          <ul>
            {outline.map((o) => (
              <li key={`${o.index}-${o.pos}`} className={`lv${o.level}`}>
                <button type="button" onClick={() => jumpTo(o.pos)}>
                  {o.nomor && <span className="no">{o.nomor}</span>}
                  <span className="tx">{o.judul || <em className="muted">Tanpa judul</em>}</span>
                  {o.level === 1 && o.nomor && latestPerBab.get(o.bab)?.latest && (
                    <span className={`nk-bab-state ${latestPerBab.get(o.bab)!.tone}`}>{latestPerBab.get(o.bab)!.label}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <div className="nk-main">
          {canEdit && !viewing && <Toolbar editor={editor} thesisId={thesis.id} onCite={() => setCiteMode({ kind: 'insert' })} />}
          <div className="nk-paper-wrap">
            {viewing ? <ReadOnlyDoc konten={viewing.konten} refs={pk.refs} style={pk.style} /> : <EditorContent editor={editor} className="nk-paper" />}
          </div>
        </div>
        {pustakaOpen && !viewing && pk.refs && (
          <PustakaPanel editor={editor} refs={pk.refs} style={pk.style} canEdit={canEdit} onRefs={pk.setRefs} onAdd={() => setCiteMode({ kind: 'add' })} />
        )}
        {aisysOpen && !viewing && pk.refs && <AisysPanel editor={editor} thesisId={thesis.id} judul={thesis.judul} refs={pk.refs} onRefs={pk.setRefs} flush={flush} />}
        {commentsVisible && !viewing && rv.data && (
          <CommentPanel
            list={commentList}
            mode={commentMode}
            userId={userId}
            peran={rv.data.peran}
            activeId={activeId}
            orphans={orphans}
            nomorPengajuan={nomorPengajuan}
            onActivate={activateComment}
            onChanged={rv.reload}
            empty="Komentar dosen muncul di sini setelah bab diajukan dan ditinjau."
          />
        )}
      </div>

      {canEdit && (
        <AjukanBabModal
          open={ajukanOpen}
          onClose={() => setAjukanOpen(false)}
          doc={editor.getJSON() as PmNode}
          data={rv.data ?? null}
          thesisId={thesis.id}
          flush={flush}
          onDone={() => {
            setAjukanOpen(false);
            rv.reload();
          }}
        />
      )}
      {canEdit && pk.refs && (
        <CiteDialog
          mode={citeMode}
          onClose={() => setCiteMode(null)}
          thesisId={thesis.id}
          refs={pk.refs}
          style={pk.style}
          onRefs={pk.setRefs}
          onInsert={(c) => {
            editor.chain().focus().insertCitation(c).run();
            setCiteMode(null);
          }}
          onUpdate={(pos, c) => {
            editor.chain().focus().updateCitationAt(pos, c).run();
            setCiteMode(null);
          }}
        />
      )}
      {canEdit && <ImportWordModal open={importOpen} onClose={() => setImportOpen(false)} editor={editor} thesisId={thesis.id} draftLink={self ? '/studi-akhir?tab=draf' : `/mahasiswa-bimbingan/${thesis.id}?tab=draf`} />}

      <VersionsModal
        open={versionsOpen}
        thesisId={thesis.id}
        onClose={() => setVersionsOpen(false)}
        onOpen={(v, konten) => {
          setViewing({ v, konten });
          setVersionsOpen(false);
          window.scrollTo({ top: 0 });
        }}
      />
    </div>
  );
}

/** Ringkasan pengajuan per bab untuk dosen dan pihak lain yang membuka naskah. */
function SubmissionStrip({ data, thesisId, userId }: { data: Awaited<ReturnType<typeof loadReviewData>>; thesisId: string; userId: string | null }) {
  const babs = [...new Set(data.submissions.filter((s) => s.status !== 'ditarik').map((s) => s.bab))].sort((a, b) => a - b);
  if (!babs.length) return <div className="note nk-banner">Mode baca. Mahasiswa belum mengajukan bab untuk direview.</div>;
  return (
    <div className="nk-strip">
      <span className="small strong">Pengajuan bab</span>
      {babs.map((b) => {
        const st = babState(data, b);
        const mine = userId ? data.reviews.some((r) => r.submission_id === st.latest!.id && r.dosen_id === userId) : false;
        const need = st.latest!.status === 'diajukan' && data.peran.has(userId ?? '') && !mine;
        return (
          <Link key={b} to={`/naskah/${thesisId}/ajuan/${st.latest!.id}`} className={`nk-strip-item ${need ? 'need' : ''}`}>
            <span className="strong">Bab {b}</span>
            <Badge tone={st.tone}>{st.label}</Badge>
            {need && <span className="small">Perlu ditinjau</span>}
          </Link>
        );
      })}
    </div>
  );
}

function SaveBadge({ state, savedAt, onRetry }: { state: SaveState | null; savedAt: string | null; onRetry: () => void }) {
  if (!state) return savedAt ? <span>Diperbarui {fmtDateTime(savedAt)}</span> : null;
  const map: Record<SaveState, ReactNode> = {
    tersimpan: savedAt ? `Tersimpan ${fmtDateTime(savedAt)}` : 'Belum ada perubahan',
    belum: 'Perubahan belum tersimpan',
    menyimpan: 'Menyimpan',
    gagal: (
      <>
        Gagal menyimpan.{' '}
        <button type="button" className="link-btn" onClick={onRetry}>
          Coba lagi
        </button>
      </>
    ),
    konflik: 'Naskah diubah di tempat lain',
  };
  return <span className={`nk-save ${state}`}>{map[state]}</span>;
}

function ReadOnlyDoc({ konten, refs, style }: { konten: PmNode; refs: Reference[] | null; style: CiteStyle }) {
  const extensions = useMemo(() => naskahExtensions({ imageView }), []);
  const editor = useEditor({ extensions, content: konten, editable: false, immediatelyRender: true, editorProps: { attributes: { class: 'nk-doc' } } }, [konten]);
  useEffect(() => {
    if (editor && refs) editor.commands.setPustaka(refs, style);
  }, [editor, refs, style]);
  return <EditorContent editor={editor} className="nk-paper" />;
}

/* ------------------------------------------------------------------ */
/* Toolbar                                                             */
/* ------------------------------------------------------------------ */

type StyleKey = 'p' | 'h1' | 'h2' | 'h3' | 'kg' | 'kt' | 'bq';
const STYLE_LABEL: Record<StyleKey, string> = {
  p: 'Paragraf',
  h1: 'Judul bab',
  h2: 'Subbab',
  h3: 'Sub-subbab',
  kg: 'Keterangan gambar',
  kt: 'Keterangan tabel',
  bq: 'Kutipan panjang',
};

function currentStyle(e: Editor): StyleKey {
  if (e.isActive('heading', { level: 1 })) return 'h1';
  if (e.isActive('heading', { level: 2 })) return 'h2';
  if (e.isActive('heading', { level: 3 })) return 'h3';
  if (e.isActive('blockquote')) return 'bq';
  if (e.isActive('paragraph', { keterangan: 'gambar' })) return 'kg';
  if (e.isActive('paragraph', { keterangan: 'tabel' })) return 'kt';
  return 'p';
}

function applyStyle(e: Editor, k: StyleKey) {
  let c = e.chain().focus();
  if (e.isActive('blockquote') && k !== 'bq') c = c.lift('blockquote');
  switch (k) {
    case 'p':
      c.setNode('paragraph', { keterangan: null, textAlign: null }).run();
      break;
    case 'h1':
      c.setNode('heading', { level: 1, bernomor: true, textAlign: 'center' }).run();
      break;
    case 'h2':
    case 'h3':
      c.setNode('heading', { level: k === 'h2' ? 2 : 3, bernomor: true, textAlign: 'left' }).run();
      break;
    case 'kg':
    case 'kt':
      c.setNode('paragraph', { keterangan: k === 'kg' ? 'gambar' : 'tabel', textAlign: 'center' }).run();
      break;
    case 'bq':
      if (!e.isActive('blockquote')) c.setNode('paragraph', { keterangan: null }).wrapIn('blockquote').run();
      break;
  }
}

function tableJson(rows: number, cols: number): PmNode {
  const cell = (type: string): PmNode => ({ type, content: [{ type: 'paragraph' }] });
  return {
    type: 'table',
    content: Array.from({ length: rows }, (_, r) => ({
      type: 'tableRow',
      content: Array.from({ length: cols }, () => cell(r === 0 ? 'tableHeader' : 'tableCell')),
    })),
  };
}

function TB({ on, title, onClick, disabled, children }: { on?: boolean; title: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      className={`nk-tb-btn ${on ? 'on' : ''}`}
      title={title}
      aria-label={title}
      aria-pressed={on}
      disabled={disabled}
      onMouseDown={(ev) => ev.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function Toolbar({ editor: e, thesisId, onCite }: { editor: Editor; thesisId: string; onCite: () => void }) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const style = currentStyle(e);
  const inTable = e.isActive('table');
  const inList = e.isActive('listItem');
  const inOrdered = e.isActive('orderedList');
  const listType = inOrdered ? ((e.getAttributes('orderedList').type as string | null) || '1') : '';
  const canIndent = inList ? e.can().sinkListItem('listItem') : e.can().indentBlock();
  const canOutdent = inList ? e.can().liftListItem('listItem') : e.can().outdentBlock();
  const setListType = (v: string) => {
    const type = v === '1' ? null : v;
    const c = e.chain().focus();
    (inOrdered ? c : c.toggleOrderedList()).updateAttributes('orderedList', { type }).run();
  };
  const align = (['left', 'center', 'right', 'justify'] as const).find((a) => e.isActive({ textAlign: a })) ?? 'justify';

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type)) return toast.show('Format gambar harus PNG, JPG, WEBP, atau GIF', 'bad');
    if (file.size > 5 * 1024 * 1024) return toast.show('Ukuran gambar maksimal 5 MB', 'bad');
    setUploading(true);
    try {
      const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '');
      const path = `${thesisId}/${crypto.randomUUID()}.${ext}`;
      const up = await supabase.storage.from('naskah').upload(path, file, { contentType: file.type });
      if (up.error) throw new Error(up.error.message);
      const alt = file.name.replace(/\.[^.]+$/, '');
      e.chain()
        .focus()
        .insertContent([
          { type: 'image', attrs: { path, alt, lebar: 80 } },
          { type: 'paragraph', attrs: { keterangan: 'gambar', textAlign: 'center' }, content: [{ type: 'text', text: alt }] },
        ])
        .run();
    } catch (err) {
      toast.show(`Gagal mengunggah gambar: ${(err as Error).message}`, 'bad');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const insertTable = () => {
    e.chain()
      .focus()
      .insertContent([{ type: 'paragraph', attrs: { keterangan: 'tabel', textAlign: 'center' }, content: [{ type: 'text', text: 'Judul tabel' }] }, tableJson(3, 3)])
      .run();
  };

  return (
    <div className="nk-toolbar" role="toolbar" aria-label="Format naskah">
      <div className="nk-tb-group">
        <TB title="Urungkan (Ctrl+Z)" onClick={() => e.chain().focus().undo().run()} disabled={!e.can().undo()}>
          <IconUndo size={16} />
        </TB>
        <TB title="Ulangi (Ctrl+Y)" onClick={() => e.chain().focus().redo().run()} disabled={!e.can().redo()}>
          <IconRedo size={16} />
        </TB>
      </div>
      <div className="nk-tb-group">
        <select className="nk-style" value={style} aria-label="Gaya paragraf" onChange={(ev) => applyStyle(e, ev.target.value as StyleKey)}>
          {(Object.keys(STYLE_LABEL) as StyleKey[]).map((k) => (
            <option key={k} value={k}>
              {STYLE_LABEL[k]}
            </option>
          ))}
        </select>
        {style === 'h1' && (
          <TB
            title={e.getAttributes('heading').bernomor === false ? 'Beri nomor bab' : 'Tanpa nomor bab (mis. Daftar Pustaka)'}
            on={e.getAttributes('heading').bernomor === false}
            onClick={() => e.chain().focus().updateAttributes('heading', { bernomor: e.getAttributes('heading').bernomor === false }).run()}
          >
            <span className="nk-tb-text">Tanpa nomor</span>
          </TB>
        )}
      </div>
      <div className="nk-tb-group">
        <TB title="Tebal (Ctrl+B)" on={e.isActive('bold')} onClick={() => e.chain().focus().toggleBold().run()}>
          <span className="nk-tb-letter b">B</span>
        </TB>
        <TB title="Miring (Ctrl+I)" on={e.isActive('italic')} onClick={() => e.chain().focus().toggleItalic().run()}>
          <span className="nk-tb-letter i">I</span>
        </TB>
        <TB title="Garis bawah (Ctrl+U)" on={e.isActive('underline')} onClick={() => e.chain().focus().toggleUnderline().run()}>
          <span className="nk-tb-letter u">U</span>
        </TB>
        <TB title="Superskrip" on={e.isActive('superscript')} onClick={() => e.chain().focus().toggleSuperscript().run()}>
          <span className="nk-tb-letter">
            x<sup>2</sup>
          </span>
        </TB>
        <TB title="Subskrip" on={e.isActive('subscript')} onClick={() => e.chain().focus().toggleSubscript().run()}>
          <span className="nk-tb-letter">
            x<sub>2</sub>
          </span>
        </TB>
      </div>
      <div className="nk-tb-group">
        <TB title="Rata kiri" on={align === 'left'} onClick={() => e.chain().focus().setTextAlign('left').run()}>
          <IconAlignLeft size={16} />
        </TB>
        <TB title="Rata tengah" on={align === 'center'} onClick={() => e.chain().focus().setTextAlign('center').run()}>
          <IconAlignCenter size={16} />
        </TB>
        <TB title="Rata kanan" on={align === 'right'} onClick={() => e.chain().focus().setTextAlign('right').run()}>
          <IconAlignRight size={16} />
        </TB>
        <TB title="Rata kiri-kanan" on={align === 'justify'} onClick={() => e.chain().focus().setTextAlign('justify').run()}>
          <IconAlignJustify size={16} />
        </TB>
      </div>
      <div className="nk-tb-group">
        <TB title="Daftar berpoin" on={e.isActive('bulletList')} onClick={() => e.chain().focus().toggleBulletList().run()}>
          <IconListBullet size={16} />
        </TB>
        <TB title="Daftar bernomor" on={e.isActive('orderedList')} onClick={() => e.chain().focus().toggleOrderedList().run()}>
          <IconListNumber size={16} />
        </TB>
        <select className="nk-listtype" value={listType} aria-label="Jenis penomoran daftar" title="Jenis penomoran daftar" onChange={(ev) => setListType(ev.target.value)}>
          <option value="" disabled hidden>
            1, a, A, i
          </option>
          <option value="1">1. 2. 3.</option>
          <option value="a">a. b. c.</option>
          <option value="A">A. B. C.</option>
          <option value="i">i. ii. iii.</option>
        </select>
        <TB
          title={inList ? 'Turunkan tingkat butir daftar (Tab)' : 'Inden maju (Tab)'}
          disabled={!canIndent}
          onClick={() => (inList ? e.chain().focus().sinkListItem('listItem').run() : e.chain().focus().indentBlock().run())}
        >
          <IconIndent size={16} />
        </TB>
        <TB
          title={inList ? 'Naikkan tingkat butir daftar (Shift+Tab)' : 'Inden mundur (Shift+Tab)'}
          disabled={!canOutdent}
          onClick={() => (inList ? e.chain().focus().liftListItem('listItem').run() : e.chain().focus().outdentBlock().run())}
        >
          <IconOutdent size={16} />
        </TB>
        <TB title="Kutipan panjang" on={e.isActive('blockquote')} onClick={() => applyStyle(e, e.isActive('blockquote') ? 'p' : 'bq')}>
          <IconQuote size={16} />
        </TB>
      </div>
      <div className="nk-tb-group">
        <TB title="Sisipkan tabel" onClick={insertTable} disabled={inTable}>
          <IconTable size={16} />
        </TB>
        <TB title={uploading ? 'Mengunggah gambar' : 'Sisipkan gambar'} onClick={() => fileRef.current?.click()} disabled={uploading}>
          <IconImage size={16} />
        </TB>
        <TB title="Halaman baru (Ctrl+Enter)" onClick={() => e.chain().focus().setPageBreak().run()}>
          <IconPageBreak size={16} />
        </TB>
      </div>
      <div className="nk-tb-group">
        <TB title="Sisipkan sitasi dari pustaka" onClick={onCite}>
          <span className="nk-tb-text">Sitasi</span>
        </TB>
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(ev) => onFile(ev.target.files?.[0])} />
      </div>
      {inTable && (
        <div className="nk-tb-group nk-tb-table">
          <span className="nk-tb-label">Tabel</span>
          <TB title="Tambah baris di bawah" onClick={() => e.chain().focus().addRowAfter().run()}>
            <span className="nk-tb-text">+ Baris</span>
          </TB>
          <TB title="Tambah kolom di kanan" onClick={() => e.chain().focus().addColumnAfter().run()}>
            <span className="nk-tb-text">+ Kolom</span>
          </TB>
          <TB title="Hapus baris" onClick={() => e.chain().focus().deleteRow().run()}>
            <span className="nk-tb-text">- Baris</span>
          </TB>
          <TB title="Hapus kolom" onClick={() => e.chain().focus().deleteColumn().run()}>
            <span className="nk-tb-text">- Kolom</span>
          </TB>
          <TB title="Gabung atau pisah sel" onClick={() => e.chain().focus().mergeOrSplit().run()} disabled={!e.can().mergeOrSplit()}>
            <span className="nk-tb-text">Gabung sel</span>
          </TB>
          <TB title="Baris pertama sebagai judul kolom" on={e.isActive('tableHeader')} onClick={() => e.chain().focus().toggleHeaderRow().run()}>
            <span className="nk-tb-text">Judul kolom</span>
          </TB>
          <TB title="Hapus tabel" onClick={() => e.chain().focus().deleteTable().run()}>
            <span className="nk-tb-text danger">Hapus tabel</span>
          </TB>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Riwayat versi                                                       */
/* ------------------------------------------------------------------ */

function VersionsModal({ open, thesisId, onClose, onOpen }: { open: boolean; thesisId: string; onClose: () => void; onOpen: (v: VersionRow, konten: PmNode) => void }) {
  const toast = useToast();
  const [rows, setRows] = useState<VersionRow[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setRows(null);
    must(
      supabase
        .from('manuscript_versions')
        .select('id, nomor, jumlah_kata, catatan, sumber, created_at, pembuat:profiles!manuscript_versions_dibuat_oleh_fkey(nama)')
        .eq('thesis_id', thesisId)
        .order('nomor', { ascending: false }),
    )
      .then((r) => setRows(r as unknown as VersionRow[]))
      .catch((e) => {
        toast.show((e as Error).message, 'bad');
        setRows([]);
      });
  }, [open, thesisId, toast]);

  const view = async (v: VersionRow) => {
    setBusy(v.id);
    try {
      const r = (await must(supabase.from('manuscript_versions').select('konten').eq('id', v.id).single())) as { konten: PmNode };
      onOpen(v, r.konten);
    } catch (e) {
      toast.show((e as Error).message, 'bad');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal open={open} onClose={onClose} wide title="Riwayat versi naskah">
      {rows === null ? (
        <Loading />
      ) : rows.length === 0 ? (
        <p className="muted">Belum ada versi tersimpan. Versi dibuat dengan tombol Simpan versi, dan nantinya otomatis saat naskah diajukan untuk direview.</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th className="num">Versi</th>
                <th>Waktu</th>
                <th>Catatan</th>
                <th className="num">Kata</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((v) => (
                <tr key={v.id}>
                  <td className="num strong">{v.nomor}</td>
                  <td className="small mono-num" style={{ whiteSpace: 'nowrap' }}>
                    {fmtDateTime(v.created_at)}
                  </td>
                  <td className="small">{v.catatan ?? <span className="muted">—</span>}</td>
                  <td className="num mono-num">{v.jumlah_kata.toLocaleString('id-ID')}</td>
                  <td style={{ textAlign: 'right' }}>
                    <Button size="sm" onClick={() => view(v)} loading={busy === v.id}>
                      Lihat
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Gambar untuk ekspor                                                 */
/* ------------------------------------------------------------------ */

async function loadImage(url: string): Promise<ResolvedImage> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Gambar tidak dapat diunduh (${res.status})`);
  let blob = await res.blob();
  const bmp = await createImageBitmap(blob);
  let type: ResolvedImage['type'] = blob.type === 'image/jpeg' ? 'jpg' : blob.type === 'image/gif' ? 'gif' : 'png';
  if (!['image/png', 'image/jpeg', 'image/gif'].includes(blob.type)) {
    // WEBP dan format lain diubah ke PNG agar dapat disisipkan ke DOCX.
    const canvas = document.createElement('canvas');
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    canvas.getContext('2d')!.drawImage(bmp, 0, 0);
    blob = await new Promise<Blob>((ok, bad) => canvas.toBlob((b) => (b ? ok(b) : bad(new Error('Konversi gambar gagal'))), 'image/png'));
    type = 'png';
  }
  return { data: await blob.arrayBuffer(), type, width: bmp.width, height: bmp.height };
}
