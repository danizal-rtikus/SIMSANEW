import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Editor } from '@tiptap/react';
import type { Node as PMNode } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import { aisys, GAYA_LABEL, KATEGORI_LABEL, type AisysStatus, type GayaParafrase, type HasilPeriksa, type Temuan } from '../../lib/aisys';
import { buildIndex, chapterRange, findQuote, normalize, quoteAt } from '../../lib/naskah/anchor';
import { rpc } from '../../lib/queries';
import { useDialog } from '../../components/Dialog';
import { chapters, type PmNode } from '../../lib/naskah/struktur';
import { crossrefToCsl } from '../../lib/pustaka/sources';
import { cleanTitle, normalizeDoi, yearOf, type Reference } from '../../lib/pustaka/csl';
import { addReferences, pustakaError } from '../../lib/pustaka/data';
import { Button } from '../../components/ui';
import { useToast } from '../../components/Toast';

/* ------------------------------------------------------------------ */
/* Bantuan                                                             */
/* ------------------------------------------------------------------ */

/** Cari kutipan temuan di dokumen (dalam rentang bab bila diberikan). */
export function locateQuote(doc: PMNode, kutipan: string, bab?: number): { from: number; to: number } | null {
  if (!kutipan.trim()) return null;
  const range = bab ? chapterRange(doc, bab) : null;
  const index = buildIndex(doc, range?.from ?? 0, range?.to ?? doc.content.size);
  const hit = findQuote(index, { kutipan, prefix: '', suffix: '' });
  if (hit) return hit;
  // Huruf besar-kecil kadang diubah model: cari tanpa membedakannya.
  const lower = index.text.toLowerCase();
  const needle = normalize(kutipan).toLowerCase();
  const i = lower.indexOf(needle);
  if (i < 0) return null;
  let s = i;
  let e = i + needle.length - 1;
  while (s <= e && index.map[s] < 0) s++;
  while (e >= s && index.map[e] < 0) e--;
  return s > e ? null : { from: index.map[s], to: index.map[e] + 1 };
}

/** Tampilkan rentang teks: seleksi editor bila dapat disunting, seleksi DOM bila hanya baca. */
export function revealRange(editor: Editor, from: number, to: number) {
  const { view } = editor;
  if (editor.isEditable) {
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)));
    view.focus();
  } else {
    try {
      const a = view.domAtPos(from);
      const b = view.domAtPos(to);
      const r = document.createRange();
      r.setStart(a.node, a.offset);
      r.setEnd(b.node, b.offset);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(r);
    } catch {
      /* abaikan */
    }
  }
  const el = view.domAtPos(from).node;
  (el.nodeType === 1 ? (el as HTMLElement) : el.parentElement)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function useStatus() {
  const [st, setSt] = useState<AisysStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    aisys
      .status()
      .then(setSt)
      .catch((e) => setErr((e as Error).message));
  }, []);
  const update = (sisa: number | null) => setSt((s) => (s ? { ...s, sisa, terpakai: s.batas && sisa !== null ? s.batas - sisa : s.terpakai } : s));
  return { st, err, update };
}

function Quota({ st }: { st: AisysStatus | null }) {
  if (!st || st.sisa === null) return null;
  return <span className={`nk-tag ${st.sisa <= 3 ? 'warn' : ''}`}>Sisa hari ini {st.sisa}</span>;
}

export function Disclaimer({ children }: { children?: ReactNode }) {
  return <p className="nk-ai-note">{children ?? 'Hasil AISYS adalah bahan pertimbangan. Periksa dan sesuaikan sebelum dipakai; tanggung jawab isi naskah tetap pada Anda.'}</p>;
}

/* ------------------------------------------------------------------ */
/* Daftar temuan (dipakai mahasiswa dan dosen)                         */
/* ------------------------------------------------------------------ */

export function TemuanList({
  hasil,
  activeIdx,
  onPick,
  action,
}: {
  hasil: HasilPeriksa;
  activeIdx: number | null;
  onPick: (t: Temuan, i: number) => void;
  action?: (t: Temuan, i: number) => ReactNode;
}) {
  const penting = hasil.temuan.filter((t) => t.tingkat === 'penting').length;
  return (
    <div className="nk-ai-result">
      <div className="nk-ai-sum">
        <div className="small muted">
          Bab {hasil.bab} {hasil.judul ? `· ${hasil.judul}` : ''} · {hasil.kata.toLocaleString('id-ID')} kata{hasil.pedoman ? ' · dibandingkan dengan pedoman prodi' : ''}
        </div>
        {hasil.ringkasan && <p>{hasil.ringkasan}</p>}
        {hasil.kekuatan.length > 0 && (
          <ul className="nk-ai-plus small">
            {hasil.kekuatan.map((k, i) => (
              <li key={i}>{k}</li>
            ))}
          </ul>
        )}
      </div>
      <div className="nk-cgroup-head static">
        <span>
          Temuan ({hasil.temuan.length}){penting ? `, ${penting} penting` : ''}
        </span>
      </div>
      {hasil.temuan.length === 0 ? (
        <p className="muted small nk-comments-empty">Tidak ada temuan berarti pada bab ini.</p>
      ) : (
        <ul className="nk-thread-list">
          {hasil.temuan.map((t, i) => (
            <li key={i} className={`nk-thread nk-ai-temuan ${t.tingkat} ${activeIdx === i ? 'active' : ''}`} onClick={() => onPick(t, i)}>
              <div className="nk-thread-top">
                <span className={`nk-tag ${t.tingkat === 'penting' ? 'warn' : ''}`}>{t.tingkat === 'penting' ? 'Penting' : 'Saran'}</span>
                <span className="muted small">{KATEGORI_LABEL[t.kategori] ?? t.kategori}</span>
              </div>
              {t.kutipan ? <blockquote className={`nk-quote ${activeIdx === i ? '' : 'clamp'}`}>{t.kutipan}</blockquote> : <div className="muted small nk-ai-whole">Berlaku untuk seluruh bab</div>}
              <p className="nk-thread-body">
                <span className="strong">{t.masalah}</span>
              </p>
              <p className={`nk-thread-body ${activeIdx === i ? '' : 'clamp'}`}>{t.saran}</p>
              {action && activeIdx === i && (
                <div className="nk-thread-actions" onClick={(e) => e.stopPropagation()}>
                  {action(t, i)}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Panel AISYS di editor naskah (mahasiswa)                            */
/* ------------------------------------------------------------------ */

type Tab = 'tulis' | 'jurnal' | 'periksa';

export function AisysPanel({
  editor,
  thesisId,
  judul,
  refs,
  onRefs,
  flush,
}: {
  editor: Editor;
  thesisId: string;
  judul: string;
  refs: Reference[];
  onRefs: (r: Reference[]) => void;
  flush: () => Promise<void>;
}) {
  const [tab, setTab] = useState<Tab>('tulis');
  const status = useStatus();
  const off = status.st && !status.st.aktif;

  return (
    <aside className="nk-comments nk-ai" aria-label="AISYS">
      <div className="nk-comments-head">
        <div className="row-between">
          <span className="strong">AISYS</span>
          <Quota st={status.st} />
        </div>
        <div className="nk-seg" role="tablist">
          {(
            [
              ['tulis', 'Tulis'],
              ['jurnal', 'Cari jurnal'],
              ['periksa', 'Periksa bab'],
            ] as [Tab, string][]
          ).map(([v, l]) => (
            <button key={v} type="button" role="tab" aria-selected={tab === v} className={tab === v ? 'on' : ''} onClick={() => setTab(v)}>
              {l}
            </button>
          ))}
        </div>
      </div>
      <div className="nk-comments-body">
        {status.err && <div className="note bad small nk-ai-pad">{status.err}</div>}
        {off && <div className="note small nk-ai-pad">AISYS belum diaktifkan. Admin perlu mengisi kunci API AISYS pada server SIMSA.</div>}
        {/* Semua tab tetap terpasang agar hasil tidak hilang saat berpindah tab. */}
        <div hidden={tab !== 'tulis'}>
          <TulisTab editor={editor} thesisId={thesisId} onSisa={status.update} />
        </div>
        <div hidden={tab !== 'jurnal'}>
          <JurnalTab editor={editor} thesisId={thesisId} judul={judul} refs={refs} onRefs={onRefs} onSisa={status.update} />
        </div>
        <div hidden={tab !== 'periksa'}>
          <PeriksaTab editor={editor} thesisId={thesisId} flush={flush} onSisa={status.update} />
        </div>
      </div>
    </aside>
  );
}

interface Snap {
  from: number;
  to: number;
  text: string;
}

function selectionInfo(editor: Editor) {
  const { from, to, empty } = editor.state.selection;
  if (empty) return { from, to, text: '', citations: false };
  let citations = false;
  editor.state.doc.nodesBetween(from, to, (n) => {
    if (n.type.name === 'citation') citations = true;
  });
  return { from, to, text: editor.state.doc.textBetween(from, to, '\n\n', ' ').trim(), citations };
}

/** Konteks tulisan di posisi kursor: judul bab, subbab, dan paragraf sebelumnya. */
function contextAt(editor: Editor, pos: number) {
  let bab = '';
  let subbab = '';
  let sebelum = '';
  editor.state.doc.forEach((n, offset) => {
    if (offset >= pos) return;
    if (n.type.name === 'heading') {
      if (n.attrs.level === 1) {
        bab = n.textContent;
        subbab = '';
      } else if (n.attrs.level === 2) subbab = n.textContent;
      sebelum = '';
    } else if (n.type.name === 'paragraph' && n.textContent.trim() && !n.attrs.keterangan) sebelum = n.textContent;
  });
  return { bab, subbab, sebelum };
}

function insertParagraphsAfter(editor: Editor, pos: number, text: string) {
  const $pos = editor.state.doc.resolve(Math.min(pos, editor.state.doc.content.size));
  // Sisipkan setelah blok tingkat atas yang memuat posisi.
  const after = $pos.depth >= 1 ? $pos.after(1) : editor.state.doc.content.size;
  const paras = text
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s*\n\s*/g, ' ').trim())
    .filter(Boolean)
    .map((p) => ({ type: 'paragraph', content: [{ type: 'text', text: p }] }));
  editor.chain().focus().insertContentAt(after, paras).run();
}

function copy(text: string, toast: ReturnType<typeof useToast>) {
  navigator.clipboard?.writeText(text).then(
    () => toast.show('Disalin', 'ok'),
    () => toast.show('Tidak dapat menyalin', 'bad'),
  );
}

function TulisTab({ editor, thesisId, onSisa }: { editor: Editor; thesisId: string; onSisa: (n: number | null) => void }) {
  const toast = useToast();
  const sel = selectionInfo(editor);
  const [gaya, setGaya] = useState<GayaParafrase>('akademik');
  const [poin, setPoin] = useState('');
  const [busy, setBusy] = useState<'parafrase' | 'susun' | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [res, setRes] = useState<{ kind: 'parafrase' | 'susun'; snap: Snap; citations: boolean; hasil: string[] } | null>(null);

  const doParafrase = async () => {
    const snap = { from: sel.from, to: sel.to, text: sel.text };
    setBusy('parafrase');
    setErr(null);
    try {
      const r = await aisys.parafrase(thesisId, sel.text, gaya);
      onSisa(r.sisa);
      setRes({ kind: 'parafrase', snap, citations: sel.citations, hasil: r.hasil });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const doSusun = async () => {
    const pos = editor.state.selection.to;
    const snap = { from: pos, to: pos, text: '' };
    setBusy('susun');
    setErr(null);
    try {
      const r = await aisys.susun(thesisId, poin, contextAt(editor, pos));
      onSisa(r.sisa);
      setRes({ kind: 'susun', snap, citations: false, hasil: [r.hasil] });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const replace = (text: string) => {
    if (!res) return;
    const { from, to, text: old } = res.snap;
    const max = editor.state.doc.content.size;
    const now = to <= max ? editor.state.doc.textBetween(from, to, '\n\n', ' ').trim() : '';
    if (now !== old) return toast.show('Teks terpilih sudah berubah. Pilih ulang teksnya lalu parafrase lagi.', 'bad');
    editor.chain().focus().insertContentAt({ from, to }, text.replace(/\s*\n+\s*/g, ' ')).run();
    toast.show('Teks diganti. Tekan Ctrl+Z untuk membatalkan.', 'ok');
  };

  const len = sel.text.length;
  return (
    <div className="nk-ai-pad stack-sm">
      <section className="nk-ai-box">
        <div className="strong small">Parafrase teks terpilih</div>
        {len ? (
          <blockquote className="nk-quote clamp">{sel.text}</blockquote>
        ) : (
          <p className="muted small">Blok kalimat atau paragraf di naskah terlebih dahulu.</p>
        )}
        {len > 2500 && <p className="small" style={{ color: 'var(--bad)' }}>Teks terpilih terlalu panjang ({len.toLocaleString('id-ID')} karakter, maksimal 2.500).</p>}
        <div className="nk-ai-row">
          <select value={gaya} onChange={(e) => setGaya(e.target.value as GayaParafrase)} aria-label="Gaya parafrase">
            {(Object.keys(GAYA_LABEL) as GayaParafrase[]).map((g) => (
              <option key={g} value={g}>
                {GAYA_LABEL[g]}
              </option>
            ))}
          </select>
          <Button size="sm" variant="primary" loading={busy === 'parafrase'} disabled={!!busy || len < 20 || len > 2500} onClick={doParafrase}>
            Parafrase
          </Button>
        </div>
      </section>

      <section className="nk-ai-box">
        <div className="strong small">Kembangkan poin menjadi paragraf</div>
        <textarea rows={4} value={poin} onChange={(e) => setPoin(e.target.value)} placeholder={'Tulis poin atau kalimat kasar, mis.\n- data peminjaman 2020-2025 belum dimanfaatkan\n- mahasiswa sulit menemukan buku relevan'} />
        <div className="nk-ai-row">
          {len > 0 && (
            <button type="button" className="link-btn small" onClick={() => setPoin(sel.text)}>
              Pakai teks terpilih
            </button>
          )}
          <span style={{ flex: 1 }} />
          <Button size="sm" variant="primary" loading={busy === 'susun'} disabled={!!busy || poin.trim().length < 10} onClick={doSusun}>
            Susun paragraf
          </Button>
        </div>
        <p className="muted small">Paragraf disisipkan setelah posisi kursor dan mengikuti konteks bab serta subbab.</p>
      </section>

      {err && <div className="note bad small">{err}</div>}

      {res && (
        <section className="stack-sm">
          {res.hasil.map((h, i) => (
            <div key={i} className="nk-ai-out">
              {res.hasil.length > 1 && <div className="muted small">Varian {i + 1}</div>}
              {h.split(/\n{2,}/).map((p, j) => (
                <p key={j}>{p}</p>
              ))}
              <div className="nk-thread-actions">
                {res.kind === 'parafrase' && (
                  <button type="button" className="link-btn" disabled={res.citations} title={res.citations ? 'Teks terpilih memuat sitasi; sisipkan di bawah lalu pindahkan sitasinya' : undefined} onClick={() => replace(h)}>
                    Ganti teks terpilih
                  </button>
                )}
                <button type="button" className="link-btn" onClick={() => insertParagraphsAfter(editor, res.snap.to, h)}>
                  Sisipkan di bawah
                </button>
                <button type="button" className="link-btn" onClick={() => copy(h, toast)}>
                  Salin
                </button>
              </div>
            </div>
          ))}
          {res.citations && <p className="muted small">Teks terpilih memuat sitasi, jadi tidak diganti langsung agar sitasinya tidak hilang.</p>}
          <Disclaimer />
        </section>
      )}
    </div>
  );
}

function JurnalTab({
  editor,
  thesisId,
  judul,
  refs,
  onRefs,
  onSisa,
}: {
  editor: Editor;
  thesisId: string;
  judul: string;
  refs: Reference[];
  onRefs: (r: Reference[]) => void;
  onSisa: (n: number | null) => void;
}) {
  const toast = useToast();
  const sel = selectionInfo(editor);
  const [topik, setTopik] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [res, setRes] = useState<{ kueri: string[]; items: { work: Parameters<typeof crossrefToCsl>[0]; alasan: string }[] } | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const byDoi = useMemo(() => new Map(refs.filter((r) => r.doi).map((r) => [r.doi!.toLowerCase(), r])), [refs]);

  const run = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await aisys.cariJurnal(thesisId, topik.trim() || judul);
      onSisa(r.sisa);
      setRes(r);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const add = async (w: Parameters<typeof crossrefToCsl>[0]) => {
    const key = w.DOI ?? '';
    setAdding(key);
    try {
      const r = await addReferences(thesisId, [crossrefToCsl(w)], 'cari');
      if (r.added.length) {
        onRefs([...refs, ...r.added]);
        toast.show('Ditambahkan ke pustaka', 'ok');
      } else toast.show('Rujukan sudah ada di pustaka', 'neutral');
    } catch (e) {
      toast.show(pustakaError(e), 'bad');
    } finally {
      setAdding(null);
    }
  };

  return (
    <div className="nk-ai-pad stack-sm">
      <section className="nk-ai-box">
        <div className="strong small">Topik yang dicari</div>
        <textarea rows={3} value={topik} onChange={(e) => setTopik(e.target.value)} placeholder={judul} />
        <div className="nk-ai-row">
          {sel.text.length > 0 && (
            <button type="button" className="link-btn small" onClick={() => setTopik(sel.text.slice(0, 1500))}>
              Pakai teks terpilih
            </button>
          )}
          <span style={{ flex: 1 }} />
          <Button size="sm" variant="primary" loading={busy} disabled={busy} onClick={run}>
            Cari jurnal
          </Button>
        </div>
        <p className="muted small">Kosongkan untuk mencari berdasarkan judul penelitian. Literatur diambil dari Crossref sehingga DOI-nya nyata; AISYS memilih yang paling relevan dan memberi alasannya.</p>
      </section>
      {err && <div className="note bad small">{err}</div>}
      {res && (
        <section className="stack-sm">
          <div className="muted small">Kata kunci: {res.kueri.join('; ')}</div>
          {res.items.length === 0 && <p className="muted small">Tidak ditemukan literatur yang relevan. Coba rumuskan topik dengan kata kunci lain.</p>}
          {res.items.map(({ work, alasan }) => {
            const doi = normalizeDoi(work.DOI);
            const have = doi ? byDoi.get(doi.toLowerCase()) : undefined;
            const csl = crossrefToCsl(work);
            const authors = (csl.author ?? []).map((a) => a.literal ?? a.family).filter(Boolean);
            return (
              <div key={doi ?? cleanTitle(csl.title)} className="nk-ai-out">
                <div className="strong small">{cleanTitle(csl.title)}</div>
                <div className="muted small">
                  {[authors.length > 2 ? `${authors[0]} et al.` : authors.join(' & '), yearOf(csl), csl['container-title']].filter(Boolean).join(' · ')}
                </div>
                {doi && (
                  <a className="small nk-ai-doi" href={`https://doi.org/${doi}`} target="_blank" rel="noreferrer">
                    doi.org/{doi}
                  </a>
                )}
                {alasan && <p className="small">{alasan}</p>}
                <div className="nk-thread-actions">
                  {have ? (
                    <>
                      <span className="nk-tag">Sudah di pustaka</span>
                      <button type="button" className="link-btn" onClick={() => editor.chain().focus().insertCitation({ refs: [have.id] }).run()}>
                        Sisipkan sitasi
                      </button>
                    </>
                  ) : (
                    <button type="button" className="link-btn" disabled={adding === (work.DOI ?? '')} onClick={() => void add(work)}>
                      {adding === (work.DOI ?? '') ? 'Menambahkan' : 'Tambah ke pustaka'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
          <Disclaimer>Baca abstrak atau isi artikel sebelum mengutip. Relevansi dinilai AISYS dari judul dan abstrak saja.</Disclaimer>
        </section>
      )}
    </div>
  );
}

function PeriksaTab({ editor, thesisId, flush, onSisa }: { editor: Editor; thesisId: string; flush: () => Promise<void>; onSisa: (n: number | null) => void }) {
  const toast = useToast();
  const list = chapters(editor.getJSON() as PmNode);
  const [bab, setBab] = useState(list[0]?.bab ?? 1);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [hasil, setHasil] = useState<Map<number, HasilPeriksa>>(new Map());
  const [active, setActive] = useState<number | null>(null);
  const cur = hasil.get(bab);

  const run = async () => {
    setBusy(true);
    setErr(null);
    try {
      await flush();
      const r = await aisys.periksaBab(thesisId, bab);
      onSisa(r.sisa);
      setHasil((m) => new Map(m).set(bab, r));
      setActive(null);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const pick = (t: Temuan, i: number) => {
    setActive(i);
    if (!t.kutipan) return;
    const hit = locateQuote(editor.state.doc, t.kutipan, bab);
    if (!hit) return toast.show('Bagian yang dimaksud sudah berubah atau tidak ditemukan.', 'neutral');
    revealRange(editor, hit.from, hit.to);
  };

  return (
    <div className="stack-sm">
      <section className="nk-ai-box nk-ai-pad-in">
        <div className="nk-ai-row">
          <select value={bab} onChange={(e) => setBab(Number(e.target.value))} aria-label="Bab yang diperiksa">
            {list.map((c) => (
              <option key={c.bab} value={c.bab}>
                Bab {c.bab} {c.judul}
              </option>
            ))}
          </select>
          <Button size="sm" variant="primary" loading={busy} disabled={busy || !list.length} onClick={run}>
            {cur ? 'Periksa ulang' : 'Periksa'}
          </Button>
        </div>
        <p className="muted small">AISYS membaca bab yang tersimpan, membandingkannya dengan pedoman prodi, lalu menunjukkan bagian yang masih kurang. Klik temuan untuk menuju teksnya.</p>
      </section>
      {err && <div className="note bad small nk-ai-pad">{err}</div>}
      {cur && (
        <>
          <TemuanList hasil={cur} activeIdx={active} onPick={pick} />
          <div className="nk-ai-pad">
            <Disclaimer>Temuan AISYS tidak menggantikan arahan dosen pembimbing.</Disclaimer>
          </div>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Review bab oleh dosen                                               */
/* ------------------------------------------------------------------ */

export function AisysReviewPanel({
  editor,
  submissionId,
  canComment,
  draftMode,
  footer,
  onClose,
  onCommented,
}: {
  editor: Editor;
  submissionId: string;
  canComment: boolean;
  draftMode: boolean;
  footer?: ReactNode;
  onClose: () => void;
  onCommented: () => void;
}) {
  const toast = useToast();
  const dialog = useDialog();
  const status = useStatus();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [hasil, setHasil] = useState<HasilPeriksa | null>(null);
  const [active, setActive] = useState<number | null>(null);
  const [dipakai, setDipakai] = useState<Set<number>>(new Set());

  const run = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await aisys.reviewBab(submissionId);
      status.update(r.sisa);
      setHasil(r);
      setActive(null);
      setDipakai(new Set());
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const rangeOf = (t: Temuan) => {
    const doc = editor.state.doc;
    if (t.kutipan) return locateQuote(doc, t.kutipan);
    // Temuan untuk seluruh bab ditambatkan pada judul bab.
    const first = doc.firstChild;
    return first ? { from: 1, to: first.nodeSize - 1 } : null;
  };

  const pick = (t: Temuan, i: number) => {
    setActive(i);
    const hit = t.kutipan ? locateQuote(editor.state.doc, t.kutipan) : null;
    if (hit) revealRange(editor, hit.from, hit.to);
  };

  const toComment = async (t: Temuan, i: number) => {
    const r = rangeOf(t);
    const q = r ? quoteAt(editor.state.doc, r.from, r.to) : null;
    if (!r || !q) return toast.show('Bagian naskah untuk temuan ini tidak ditemukan. Sorot teksnya secara manual.', 'bad');
    const isi = await dialog.prompt({
      title: 'Jadikan komentar',
      message: `Pada: "${q.kutipan.slice(0, 140)}${q.kutipan.length > 140 ? '…' : ''}". Sunting dulu bila perlu; komentar tercatat atas nama Anda.`,
      label: 'Komentar',
      multiline: true,
      required: true,
      initial: [t.masalah, t.saran].filter(Boolean).join(' '),
      confirmLabel: draftMode ? 'Simpan sebagai draf' : 'Kirim komentar',
    });
    if (!isi) return;
    try {
      await rpc('komentar_naskah', { p_submission: submissionId, p_isi: isi.trim(), p_kutipan: q.kutipan, p_prefix: q.prefix, p_suffix: q.suffix, p_posisi: { from: r.from, to: r.to } });
      setDipakai((s) => new Set(s).add(i));
      toast.show(draftMode ? 'Disimpan sebagai komentar draf' : 'Komentar terkirim', 'ok');
      onCommented();
    } catch (e) {
      toast.show((e as Error).message, 'bad');
    }
  };

  return (
    <aside className={`nk-comments nk-ai ${footer ? 'has-footer' : ''}`} aria-label="Review AISYS">
      <div className="nk-comments-head">
        <div className="row-between">
          <span className="strong">Review AISYS</span>
          <Quota st={status.st} />
        </div>
        <button type="button" className="link-btn small" style={{ alignSelf: 'flex-start' }} onClick={onClose}>
          Kembali ke komentar
        </button>
      </div>
      <div className="nk-comments-body">
        <div className="nk-ai-pad stack-sm">
          {status.st && !status.st.aktif && <div className="note small">AISYS belum diaktifkan. Admin perlu mengisi kunci API AISYS pada server SIMSA.</div>}
          <p className="muted small" style={{ margin: 0 }}>
            AISYS membaca bab yang diajukan, membandingkannya dengan pedoman prodi, lalu menyusun usulan catatan. Pilih temuan yang Anda setujui untuk dijadikan komentar; mahasiswa hanya melihat komentar yang Anda simpan.
          </p>
          <Button size="sm" variant="primary" loading={busy} disabled={busy} onClick={run}>
            {hasil ? 'Periksa ulang' : 'Periksa bab ini'}
          </Button>
          {err && <div className="note bad small">{err}</div>}
        </div>
        {hasil && (
          <TemuanList
            hasil={hasil}
            activeIdx={active}
            onPick={pick}
            action={(t, i) =>
              canComment ? (
                dipakai.has(i) ? (
                  <span className="nk-tag">Sudah dijadikan komentar</span>
                ) : (
                  <button type="button" className="link-btn" onClick={() => void toComment(t, i)}>
                    Jadikan komentar
                  </button>
                )
              ) : null
            }
          />
        )}
      </div>
      {footer && <div className="nk-comments-foot">{footer}</div>}
    </aside>
  );
}
