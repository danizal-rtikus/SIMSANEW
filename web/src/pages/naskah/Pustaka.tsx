import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Editor } from '@tiptap/react';
import { useAsync } from '../../lib/useAsync';
import { TYPE_LABEL, cleanTitle, normalizeDoi, parseName, yearOf, type CslItem, type CslName, type Reference } from '../../lib/pustaka/csl';
import { buildContext, formatBibliography, shortLabel, STYLE_LABEL, type CiteStyle, type Seg } from '../../lib/pustaka/format';
import { parseReferences } from '../../lib/pustaka/parse';
import { lookupDoi, searchCrossref, type SearchHit } from '../../lib/pustaka/sources';
import { checkPustaka } from '../../lib/pustaka/check';
import { addReferences, deleteReference, loadCiteStyle, loadReferences, pustakaError, updateReference, type RefSource } from '../../lib/pustaka/data';
import { docCitedIds } from '../../lib/naskah/citation';
import { Button, Field, Tabs } from '../../components/ui';
import { Modal, useDialog } from '../../components/Dialog';
import { useToast } from '../../components/Toast';
import { IconChevronDown, IconMore, IconPlus, IconSearch, IconUpload } from '../../components/Icons';

/* ------------------------------------------------------------------ */
/* Data                                                                */
/* ------------------------------------------------------------------ */

export interface PustakaState {
  refs: Reference[];
  style: CiteStyle;
}

/** Muat pustaka dan gaya sitasi. `setRefs` memperbarui daftar tanpa memuat ulang. */
export function usePustaka(thesisId: string, prodiId: string | null | undefined) {
  const st = useAsync(async () => {
    const [refs, gaya] = await Promise.all([loadReferences(thesisId), loadCiteStyle(prodiId)]);
    return { refs, style: gaya.style };
  }, [thesisId, prodiId]);
  const [local, setLocal] = useState<Reference[] | null>(null);
  useEffect(() => setLocal(null), [st.data]);
  const refs = local ?? st.data?.refs ?? null;
  return {
    refs,
    style: st.data?.style ?? ('apa' as CiteStyle),
    loading: st.loading,
    error: st.error,
    reload: st.reload,
    setRefs: setLocal,
  };
}

/** Teks rujukan bergaya (miring sebagai <em>). */
export function Segs({ segs }: { segs: Seg[] }) {
  return (
    <>
      {segs.map((s, i) => (s.i ? <em key={i}>{s.t}</em> : <span key={i}>{s.t}</span>))}
    </>
  );
}

function citeCounts(editor: Editor | null): Map<string, number> {
  const m = new Map<string, number>();
  editor?.state.doc.descendants((n) => {
    if (n.type.name === 'citation') {
      for (const id of (n.attrs.refs as string[]) ?? []) m.set(id, (m.get(id) ?? 0) + 1);
      return false;
    }
    return true;
  });
  return m;
}

function authorsLine(a?: CslName[]): string {
  if (!a?.length) return '';
  const names = a.map((n) => n.literal ?? [n.given, n.family].filter(Boolean).join(' '));
  return names.length > 3 ? `${names.slice(0, 3).join(', ')}, dkk.` : names.join(', ');
}

/* ------------------------------------------------------------------ */
/* Panel pustaka (kolom kanan editor)                                  */
/* ------------------------------------------------------------------ */

export function PustakaPanel({
  editor,
  refs,
  style,
  canEdit,
  onRefs,
  onAdd,
}: {
  editor: Editor;
  refs: Reference[];
  style: CiteStyle;
  canEdit: boolean;
  onRefs: (refs: Reference[]) => void;
  onAdd: () => void;
}) {
  const dialog = useDialog();
  const toast = useToast();
  const [editRef, setEditRef] = useState<Reference | null>(null);
  const [issuesOpen, setIssuesOpen] = useState(false);
  const doc = editor.state.doc;
  const order = useMemo(() => docCitedIds(doc), [doc]);
  const counts = useMemo(() => citeCounts(editor), [editor, doc]);
  const ctx = useMemo(() => buildContext(refs, style, order), [refs, style, order]);
  const entries = useMemo(() => formatBibliography(refs, ctx), [refs, ctx]);
  const byId = useMemo(() => new Map(refs.map((r) => [r.id, r])), [refs]);
  const { stats, issues } = useMemo(() => checkPustaka(refs, order), [refs, order]);
  const hasBib = useMemo(() => {
    let found = false;
    doc.forEach((n) => {
      if (n.type.name === 'bibliography') found = true;
    });
    return found;
  }, [doc]);

  const remove = async (r: Reference) => {
    const n = counts.get(r.id) ?? 0;
    const ok = await dialog.confirm({
      title: 'Hapus rujukan dari pustaka?',
      message: `${shortLabel(r.csl)}. ${cleanTitle(r.csl.title)}.${n ? ` Rujukan ini dikutip ${n} kali di naskah; sitasi tersebut akan ditandai merah sampai diganti atau dihapus.` : ''}`,
      confirmLabel: 'Hapus',
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteReference(r.id);
      onRefs(refs.filter((x) => x.id !== r.id));
      toast.show('Rujukan dihapus', 'ok');
    } catch (e) {
      toast.show(pustakaError(e), 'bad');
    }
  };

  const insertBibliography = () => {
    let at: number | null = null;
    doc.forEach((n, pos) => {
      if (at === null && n.type.name === 'heading' && n.attrs.level === 1 && /daftar\s+pustaka|referensi/i.test(n.textContent)) at = pos + n.nodeSize;
    });
    const chain = editor.chain().focus();
    if (at !== null) chain.insertContentAt(at, { type: 'bibliography' }).run();
    else chain.insertBibliography().run();
    toast.show('Daftar pustaka otomatis disisipkan', 'ok');
  };

  const jumpBibliography = () => {
    doc.forEach((n, pos) => {
      if (n.type.name === 'bibliography') (editor.view.nodeDOM(pos) as HTMLElement | null)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  return (
    <aside className="nk-comments nk-pustaka has-footer" aria-label="Pustaka">
      <div className="nk-comments-head">
        <div className="row-between">
          <span className="strong">Pustaka</span>
          <span className="nk-tag">{STYLE_LABEL[style]}</span>
        </div>
        <div className="nk-pk-stats small">
          <span>
            <b>{stats.total}</b> rujukan
          </span>
          <span>
            <b>{stats.dikutip}</b> dikutip
          </span>
          <span title="Terbit dalam 10 tahun terakhir">
            <b>{stats.persenTerbaru}%</b> 10 tahun terakhir
          </span>
          <span title="Artikel jurnal dan prosiding">
            <b>{stats.persenJurnal}%</b> jurnal
          </span>
        </div>
      </div>

      <div className="nk-comments-body">
        {issues.length > 0 && (
          <section className="nk-cgroup">
            <button type="button" className="nk-cgroup-head" aria-expanded={issuesOpen} onClick={() => setIssuesOpen(!issuesOpen)}>
              <IconChevronDown size={14} style={{ transform: issuesOpen ? undefined : 'rotate(-90deg)' }} />
              <span>Perlu diperiksa ({issues.length})</span>
            </button>
            {issuesOpen && (
              <ul className="nk-pk-issues small">
                {issues.map((x, i) => (
                  <li key={i} className={x.kind}>
                    {x.pesan}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
        {entries.length === 0 ? (
          <p className="muted small nk-comments-empty">
            Belum ada rujukan. Tambahkan lewat DOI, pencarian judul, impor BibTeX/RIS dari Mendeley atau Zotero, atau isi manual.
          </p>
        ) : (
          <ul className="nk-pk-list">
            {entries.map((e) => {
              const r = byId.get(e.id)!;
              const n = counts.get(e.id) ?? 0;
              return (
                <RefCard key={e.id} num={e.num} segs={e.segs} label={TYPE_LABEL[r.csl.type ?? ''] ?? 'Rujukan'} cited={n} canEdit={canEdit} onEdit={() => setEditRef(r)} onDelete={() => void remove(r)} />
              );
            })}
          </ul>
        )}
      </div>

      <div className="nk-comments-foot nk-pk-foot">
        {canEdit && (
          <Button variant="primary" onClick={onAdd}>
            <IconPlus size={16} /> Tambah rujukan
          </Button>
        )}
        {canEdit && !hasBib && <Button onClick={insertBibliography}>Sisipkan daftar pustaka</Button>}
        {hasBib && (
          <button type="button" className="link-btn" onClick={jumpBibliography}>
            Lihat daftar pustaka di naskah
          </button>
        )}
      </div>

      <RefFormModal
        open={!!editRef}
        initial={editRef?.csl ?? null}
        title="Ubah rujukan"
        onClose={() => setEditRef(null)}
        onSave={async (csl) => {
          const row = await updateReference(editRef!.id, csl);
          onRefs(refs.map((x) => (x.id === row.id ? row : x)));
          setEditRef(null);
          toast.show('Rujukan diperbarui', 'ok');
        }}
      />
    </aside>
  );
}

function RefCard({ num, segs, label, cited, canEdit, onEdit, onDelete }: { num?: number; segs: Seg[]; label: string; cited: number; canEdit: boolean; onEdit: () => void; onDelete: () => void }) {
  const [menu, setMenu] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menu]);
  return (
    <li className={`nk-pk-item ${cited ? '' : 'uncited'}`}>
      <div className="nk-pk-top">
        {num ? <span className="nk-pk-num">[{num}]</span> : null}
        <span className="muted small">{label}</span>
        <span className={`nk-tag ${cited ? '' : 'warn'}`}>{cited ? `Dikutip ${cited}x` : 'Belum dikutip'}</span>
        {canEdit && (
          <div className="nk-menu" ref={ref}>
            <button type="button" className="nk-menu-btn" aria-label="Pilihan rujukan" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>
              <IconMore size={16} />
            </button>
            {menu && (
              <div className="nk-menu-pop" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenu(false);
                    onEdit();
                  }}
                >
                  Ubah
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="danger"
                  onClick={() => {
                    setMenu(false);
                    onDelete();
                  }}
                >
                  Hapus
                </button>
              </div>
            )}
          </div>
        )}
      </div>
      <p className="nk-pk-text">
        <Segs segs={segs} />
      </p>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Dialog sitasi: pilih dari pustaka atau tambah rujukan baru          */
/* ------------------------------------------------------------------ */

export type CiteMode = { kind: 'insert' } | { kind: 'edit'; pos: number; refs: string[]; halaman: string | null; naratif: boolean } | { kind: 'add' };
export interface CiteChoice {
  refs: string[];
  halaman: string | null;
  naratif: boolean;
}
type Tab = 'pustaka' | 'doi' | 'cari' | 'impor' | 'manual';

export function CiteDialog({
  mode,
  onClose,
  thesisId,
  refs,
  style,
  onRefs,
  onInsert,
  onUpdate,
}: {
  mode: CiteMode | null;
  onClose: () => void;
  thesisId: string;
  refs: Reference[];
  style: CiteStyle;
  onRefs: (refs: Reference[]) => void;
  onInsert: (c: CiteChoice) => void;
  onUpdate: (pos: number, c: CiteChoice) => void;
}) {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('pustaka');
  const [selected, setSelected] = useState<string[]>([]);
  const [halaman, setHalaman] = useState('');
  const [filter, setFilter] = useState('');
  const [naratif, setNaratif] = useState(false);
  const open = !!mode;

  useEffect(() => {
    if (!mode) return;
    setTab(mode.kind === 'add' ? 'doi' : refs.length ? 'pustaka' : 'doi');
    setSelected(mode.kind === 'edit' ? mode.refs : []);
    setHalaman(mode.kind === 'edit' ? mode.halaman ?? '' : '');
    setNaratif(mode.kind === 'edit' ? mode.naratif : false);
    setFilter('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const ctx = useMemo(() => buildContext(refs, style), [refs, style]);
  const formatted = useMemo(() => new Map(formatBibliography(refs, ctx).map((e) => [e.id, e.segs])), [refs, ctx]);
  const haveDoi = useMemo(() => new Set(refs.map((r) => r.doi?.toLowerCase()).filter(Boolean) as string[]), [refs]);

  const added = (rows: Reference[], skipped: number) => {
    if (rows.length) onRefs([...refs, ...rows]);
    const msg = rows.length ? `${rows.length} rujukan ditambahkan${skipped ? `, ${skipped} sudah ada` : ''}` : skipped ? 'Rujukan sudah ada di pustaka' : 'Tidak ada rujukan yang ditambahkan';
    toast.show(msg, rows.length ? 'ok' : 'neutral');
    if (mode?.kind !== 'add' && rows.length) {
      setSelected((s) => [...new Set([...s, ...rows.map((r) => r.id)])]);
      setTab('pustaka');
    }
  };

  const add = async (items: CslItem[], sumber: RefSource) => {
    try {
      const r = await addReferences(thesisId, items, sumber);
      added(r.added, r.skipped);
      return r;
    } catch (e) {
      toast.show(pustakaError(e), 'bad');
      return null;
    }
  };

  const q = filter.trim().toLowerCase();
  const shown = refs.filter((r) => !q || `${cleanTitle(r.csl.title)} ${authorsLine(r.csl.author)} ${yearOf(r.csl) ?? ''} ${r.csl['container-title'] ?? ''}`.toLowerCase().includes(q));

  const items: { value: Tab; label: ReactNode }[] = [
    ...(mode?.kind !== 'add' ? [{ value: 'pustaka' as Tab, label: `Pustaka saya (${refs.length})` }] : []),
    { value: 'doi', label: 'DOI' },
    { value: 'cari', label: 'Cari judul' },
    { value: 'impor', label: 'Impor BibTeX/RIS' },
    { value: 'manual', label: 'Isi manual' },
  ];

  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const footer =
    mode?.kind === 'add' ? (
      <Button onClick={onClose}>Selesai</Button>
    ) : tab === 'pustaka' ? (
      <>
        {mode?.kind === 'edit' && (
          <Button variant="danger" onClick={() => onUpdate(mode.pos, { refs: [], halaman: null, naratif: false })}>
            Hapus sitasi
          </Button>
        )}
        <span style={{ flex: 1 }} />
        <Button onClick={onClose}>Batal</Button>
        <Button
          variant="primary"
          disabled={!selected.length}
          onClick={() => {
            const c = { refs: selected, halaman: halaman.trim() || null, naratif };
            if (mode?.kind === 'edit') onUpdate(mode.pos, c);
            else onInsert(c);
          }}
        >
          {mode?.kind === 'edit' ? 'Simpan sitasi' : `Sisipkan sitasi${selected.length > 1 ? ` (${selected.length})` : ''}`}
        </Button>
      </>
    ) : (
      <Button onClick={onClose}>Tutup</Button>
    );

  return (
    <Modal open={open} onClose={onClose} wide title={mode?.kind === 'add' ? 'Tambah rujukan ke pustaka' : mode?.kind === 'edit' ? 'Ubah sitasi' : 'Sisipkan sitasi'} footer={footer}>
      <Tabs value={tab} onChange={setTab} items={items} />
      <div className="nk-cite-body">
        {tab === 'pustaka' && (
          <>
            <div className="nk-cite-search">
              <IconSearch size={16} />
              <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Saring menurut judul, penulis, atau tahun" aria-label="Saring pustaka" />
            </div>
            {refs.length === 0 ? (
              <p className="muted">Pustaka masih kosong. Tambahkan rujukan lewat tab DOI, Cari judul, Impor, atau Isi manual.</p>
            ) : (
              <ul className="nk-cite-pick">
                {shown.map((r) => (
                  <li key={r.id}>
                    <label className={selected.includes(r.id) ? 'on' : ''}>
                      <input type="checkbox" checked={selected.includes(r.id)} onChange={() => toggle(r.id)} />
                      <span>
                        <span className="strong">{shortLabel(r.csl)}</span>
                        <span className="nk-cite-ref small">
                          <Segs segs={formatted.get(r.id) ?? []} />
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
                {shown.length === 0 && <li className="muted small">Tidak ada rujukan yang cocok.</li>}
              </ul>
            )}
            <div className="nk-cite-opts">
              <Field label="Halaman (opsional)" hint="Untuk kutipan langsung, mis. 45 atau 45-47.">
                <input value={halaman} onChange={(e) => setHalaman(e.target.value)} placeholder="45" style={{ maxWidth: 160 }} />
              </Field>
              {style === 'apa' && (
                <label className="nk-cite-check small">
                  <input type="checkbox" checked={naratif} onChange={(e) => setNaratif(e.target.checked)} />
                  <span>
                    Sitasi naratif, nama penulis menjadi bagian kalimat
                    <span className="muted"> {naratif ? 'Lestari et al. (2024)' : '(Lestari et al., 2024)'}</span>
                  </span>
                </label>
              )}
              <p className="muted small">
                Gaya {STYLE_LABEL[style]} mengikuti pedoman prodi. {selected.length > 1 ? 'Beberapa rujukan digabung dalam satu sitasi.' : 'Pilih lebih dari satu untuk sitasi gabungan.'}
              </p>
            </div>
          </>
        )}
        {tab === 'doi' && <DoiTab style={style} haveDoi={haveDoi} onAdd={(it) => add([it], 'doi')} />}
        {tab === 'cari' && <SearchTab style={style} haveDoi={haveDoi} onAdd={(it) => add([it], 'cari')} />}
        {tab === 'impor' && <ImportTab onAdd={add} />}
        {tab === 'manual' && (
          <RefForm
            initial={null}
            submitLabel="Tambah ke pustaka"
            onSubmit={async (csl) => {
              const r = await add([csl], 'manual');
              return !!r?.added.length;
            }}
          />
        )}
      </div>
    </Modal>
  );
}

function Preview({ csl, style }: { csl: CslItem; style: CiteStyle }) {
  const ref = { id: 'x', csl };
  const e = formatBibliography([ref], buildContext([ref], style))[0];
  return (
    <div className="nk-cite-preview">
      <span className="muted small">{TYPE_LABEL[csl.type ?? ''] ?? 'Rujukan'}</span>
      <p>
        <Segs segs={e.segs} />
      </p>
    </div>
  );
}

function DoiTab({ style, haveDoi, onAdd }: { style: CiteStyle; haveDoi: Set<string>; onAdd: (it: CslItem) => Promise<unknown> }) {
  const [v, setV] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [item, setItem] = useState<CslItem | null>(null);
  const [adding, setAdding] = useState(false);
  const run = async () => {
    setBusy(true);
    setErr(null);
    setItem(null);
    try {
      setItem(await lookupDoi(v));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const doi = item ? normalizeDoi(item.DOI) : null;
  const exists = !!doi && haveDoi.has(doi.toLowerCase());
  return (
    <div className="stack">
      <form
        className="nk-cite-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (v.trim()) void run();
        }}
      >
        <input value={v} onChange={(e) => setV(e.target.value)} placeholder="10.1016/j.eswa.2023.120001 atau https://doi.org/…" aria-label="DOI" />
        <Button type="submit" variant="primary" loading={busy} disabled={!v.trim()}>
          Cari DOI
        </Button>
      </form>
      <p className="muted small">Metadata diambil dari Crossref. DOI biasanya tercantum di halaman pertama artikel atau laman jurnal.</p>
      {err && <div className="note bad">{err}</div>}
      {item && (
        <>
          <Preview csl={item} style={style} />
          <div className="row" style={{ gap: 8 }}>
            <Button
              variant="primary"
              loading={adding}
              disabled={exists}
              onClick={async () => {
                setAdding(true);
                await onAdd(item);
                setAdding(false);
                setItem(null);
                setV('');
              }}
            >
              {exists ? 'Sudah ada di pustaka' : 'Tambah ke pustaka'}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function SearchTab({ style, haveDoi, onAdd }: { style: CiteStyle; haveDoi: Set<string>; onAdd: (it: CslItem) => Promise<unknown> }) {
  const [v, setV] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const run = async () => {
    setBusy(true);
    setErr(null);
    try {
      setHits(await searchCrossref(v));
      setOpen(null);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="stack">
      <form
        className="nk-cite-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (v.trim().length >= 3) void run();
        }}
      >
        <input value={v} onChange={(e) => setV(e.target.value)} placeholder="Judul artikel, kata kunci, atau nama penulis" aria-label="Kata kunci" />
        <Button type="submit" variant="primary" loading={busy} disabled={v.trim().length < 3}>
          Cari
        </Button>
      </form>
      <p className="muted small">Pencarian di Crossref (artikel jurnal, prosiding, dan buku ber-DOI). Periksa kecocokan judul dan tahun sebelum menambahkan.</p>
      {err && <div className="note bad">{err}</div>}
      {hits && hits.length === 0 && <p className="muted">Tidak ada hasil. Coba kata kunci lain atau isi manual.</p>}
      {hits && hits.length > 0 && (
        <ul className="nk-cite-hits">
          {hits.map((h, i) => {
            const exists = !!h.doi && haveDoi.has(h.doi.toLowerCase());
            return (
              <li key={`${h.doi ?? i}`}>
                <div className="nk-cite-hit-main">
                  <button type="button" className="nk-cite-hit-title" onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i}>
                    {cleanTitle(h.csl.title)}
                  </button>
                  <div className="muted small">
                    {[authorsLine(h.csl.author), yearOf(h.csl), h.csl['container-title']].filter(Boolean).join(' · ')}
                    {h.doi ? ` · DOI ${h.doi}` : ''}
                  </div>
                  {open === i && <Preview csl={h.csl} style={style} />}
                </div>
                <Button
                  size="sm"
                  variant={exists ? 'ghost' : 'secondary'}
                  disabled={exists}
                  loading={adding === (h.doi ?? String(i))}
                  onClick={async () => {
                    setAdding(h.doi ?? String(i));
                    await onAdd(h.csl);
                    setAdding(null);
                  }}
                >
                  {exists ? 'Sudah ada' : 'Tambah'}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function ImportTab({ onAdd }: { onAdd: (items: CslItem[], sumber: RefSource) => Promise<{ added: Reference[]; skipped: number } | null> }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const parsed = useMemo(() => (text.trim() ? parseReferences(text) : null), [text]);
  return (
    <div className="stack">
      <div className="note info small">
        Dari Mendeley: pilih rujukan, lalu <b>File, Export</b>, pilih format BibTeX (.bib) atau RIS. Dari Zotero: klik kanan koleksi, <b>Export Collection</b>. Dari Google Scholar: klik Kutip lalu BibTeX.
      </div>
      <div className="row" style={{ gap: 8 }}>
        <Button onClick={() => fileRef.current?.click()}>
          <IconUpload size={16} /> Pilih berkas .bib atau .ris
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".bib,.ris,.txt,.bibtex"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) setText(await f.text());
          }}
        />
        <span className="muted small">atau tempel isinya di bawah</span>
      </div>
      <textarea className="nk-cite-paste" value={text} onChange={(e) => setText(e.target.value)} placeholder={'@article{kunci,\n  author = {Lestari, Dewi},\n  title = {Judul artikel},\n  ...\n}'} spellCheck={false} />
      {parsed && (
        <div className="stack">
          <div className="small">
            {parsed.items.length ? (
              <span>
                Terbaca <b>{parsed.items.length}</b> rujukan ({parsed.format === 'ris' ? 'RIS' : 'BibTeX'}).
              </span>
            ) : null}
            {parsed.warnings.map((w, i) => (
              <div key={i} className="muted">
                {w}
              </div>
            ))}
          </div>
          {parsed.items.length > 0 && (
            <ul className="nk-cite-mini small">
              {parsed.items.slice(0, 50).map((it, i) => (
                <li key={i}>
                  <span className="strong">{shortLabel(it)}</span> {cleanTitle(it.title)}
                </li>
              ))}
              {parsed.items.length > 50 && <li className="muted">dan {parsed.items.length - 50} lainnya</li>}
            </ul>
          )}
          <div>
            <Button
              variant="primary"
              loading={busy}
              disabled={!parsed.items.length}
              onClick={async () => {
                setBusy(true);
                const r = await onAdd(parsed.items, parsed.format === 'ris' ? 'ris' : 'bibtex');
                setBusy(false);
                if (r) setText('');
              }}
            >
              Tambah {parsed.items.length} rujukan
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Formulir rujukan manual                                             */
/* ------------------------------------------------------------------ */

interface FormState {
  type: string;
  penulis: string;
  judul: string;
  tahun: string;
  wadah: string;
  volume: string;
  nomor: string;
  halaman: string;
  edisi: string;
  penerbit: string;
  kota: string;
  jenis: string;
  doi: string;
  url: string;
  diakses: string;
}

function toForm(c: CslItem | null): FormState {
  const ad = c?.accessed?.['date-parts']?.[0];
  return {
    type: c?.type ?? 'article-journal',
    penulis: (c?.author ?? []).map((n) => n.literal ?? [n.family, n.given].filter(Boolean).join(', ')).join('\n'),
    judul: cleanTitle(c?.title),
    tahun: c ? String(yearOf(c) ?? '') : '',
    wadah: c?.['container-title'] ?? '',
    volume: c?.volume ? String(c.volume) : '',
    nomor: c?.issue ? String(c.issue) : '',
    halaman: c?.page ?? '',
    edisi: c?.edition ? String(c.edition) : '',
    penerbit: c?.publisher ?? '',
    kota: c?.['publisher-place'] ?? '',
    jenis: c?.genre ?? '',
    doi: c?.DOI ?? '',
    url: c?.URL ?? '',
    diakses: ad && ad.length >= 3 ? `${ad[0]}-${String(ad[1]).padStart(2, '0')}-${String(ad[2]).padStart(2, '0')}` : '',
  };
}

function fromForm(f: FormState, base: CslItem | null): CslItem {
  const it: CslItem = { ...(base ?? {}) };
  const set = (k: string, v: unknown) => {
    if (v === '' || v === undefined || v === null) delete it[k];
    else it[k] = v;
  };
  it.type = f.type;
  const authors = f.penulis
    .split(/\n|;/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => (s.startsWith('=') ? { literal: s.slice(1).trim() } : parseName(s)));
  set('author', authors.length ? authors : '');
  it.title = f.judul.trim();
  const baseParts = base?.issued?.['date-parts']?.[0] ?? [];
  const y = Number(f.tahun);
  if (f.tahun.trim() && Number.isFinite(y)) {
    const keep = Number(baseParts[0]) === y ? baseParts.slice(1).map(Number) : [];
    it.issued = { 'date-parts': [[y, ...keep]] };
  } else delete it.issued;
  set('container-title', f.wadah.trim());
  set('volume', f.volume.trim());
  set('issue', f.nomor.trim());
  set('page', f.halaman.trim());
  set('edition', f.edisi.trim());
  set('publisher', f.penerbit.trim());
  set('publisher-place', f.kota.trim());
  set('genre', f.type === 'thesis' ? f.jenis.trim() : '');
  set('DOI', normalizeDoi(f.doi) ?? '');
  set('URL', f.url.trim());
  const d = f.diakses.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  set('accessed', d ? { 'date-parts': [[Number(d[1]), Number(d[2]), Number(d[3])]] } : '');
  return it;
}

const WADAH_LABEL: Record<string, string> = {
  'article-journal': 'Nama jurnal',
  'paper-conference': 'Nama prosiding atau konferensi',
  chapter: 'Judul buku',
  webpage: 'Nama situs',
  article: 'Nama media',
};

function RefForm({ initial, submitLabel, onSubmit, onCancel }: { initial: CslItem | null; submitLabel: string; onSubmit: (csl: CslItem) => Promise<boolean | void>; onCancel?: () => void }) {
  const toast = useToast();
  const [f, setF] = useState<FormState>(() => toForm(initial));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => setF(toForm(initial)), [initial]);
  const up = (k: keyof FormState) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const t = f.type;
  const showWadah = t in WADAH_LABEL;
  const showVol = t === 'article-journal' || t === 'article';
  const showPub = ['book', 'chapter', 'report', 'thesis', 'paper-conference', 'dataset', 'software'].includes(t);

  const submit = async () => {
    if (!f.judul.trim()) return setErr('Judul wajib diisi.');
    if (f.tahun.trim() && !/^\d{4}$/.test(f.tahun.trim())) return setErr('Tahun ditulis empat angka, mis. 2024.');
    setErr(null);
    setBusy(true);
    try {
      const ok = await onSubmit(fromForm(f, initial));
      if (ok !== false && !initial) setF(toForm(null));
    } catch (e) {
      toast.show(pustakaError(e), 'bad');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="nk-ref-form">
      <Field label="Jenis rujukan">
        <select value={t} onChange={up('type')}>
          {Object.entries(TYPE_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Penulis" hint="Satu penulis per baris, format: Nama Belakang, Nama Depan. Untuk lembaga, awali dengan tanda = (mis. =Badan Pusat Statistik).">
        <textarea rows={3} value={f.penulis} onChange={up('penulis')} placeholder={'Lestari, Dewi\nSantoso, Budi'} />
      </Field>
      <Field label="Judul" className="span2">
        <input value={f.judul} onChange={up('judul')} />
      </Field>
      <Field label="Tahun terbit">
        <input value={f.tahun} onChange={up('tahun')} inputMode="numeric" placeholder="2024" />
      </Field>
      {showWadah && (
        <Field label={WADAH_LABEL[t]}>
          <input value={f.wadah} onChange={up('wadah')} />
        </Field>
      )}
      {showVol && (
        <>
          <Field label="Volume">
            <input value={f.volume} onChange={up('volume')} />
          </Field>
          <Field label="Nomor (issue)">
            <input value={f.nomor} onChange={up('nomor')} />
          </Field>
        </>
      )}
      {(showVol || t === 'chapter' || t === 'paper-conference') && (
        <Field label="Halaman">
          <input value={f.halaman} onChange={up('halaman')} placeholder="101-115" />
        </Field>
      )}
      {t === 'book' && (
        <Field label="Edisi">
          <input value={f.edisi} onChange={up('edisi')} placeholder="3" />
        </Field>
      )}
      {t === 'thesis' && (
        <Field label="Jenis karya">
          <input value={f.jenis} onChange={up('jenis')} placeholder="Skripsi, Tesis, Disertasi" />
        </Field>
      )}
      {showPub && (
        <>
          <Field label={t === 'thesis' ? 'Perguruan tinggi' : 'Penerbit'}>
            <input value={f.penerbit} onChange={up('penerbit')} />
          </Field>
          <Field label="Kota terbit">
            <input value={f.kota} onChange={up('kota')} />
          </Field>
        </>
      )}
      <Field label="DOI">
        <input value={f.doi} onChange={up('doi')} placeholder="10.xxxx/xxxxx" />
      </Field>
      <Field label="URL">
        <input value={f.url} onChange={up('url')} placeholder="https://" />
      </Field>
      {t === 'webpage' && (
        <Field label="Tanggal diakses">
          <input type="date" value={f.diakses} onChange={up('diakses')} />
        </Field>
      )}
      {err && <div className="note bad span2">{err}</div>}
      <div className="row span2" style={{ gap: 8, justifyContent: 'flex-end' }}>
        {onCancel && <Button onClick={onCancel}>Batal</Button>}
        <Button variant="primary" loading={busy} onClick={submit}>
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}

function RefFormModal({ open, initial, title, onClose, onSave }: { open: boolean; initial: CslItem | null; title: string; onClose: () => void; onSave: (csl: CslItem) => Promise<void> }) {
  return (
    <Modal open={open} onClose={onClose} wide title={title}>
      {open && <RefForm initial={initial} submitLabel="Simpan" onSubmit={async (c) => onSave(c)} onCancel={onClose} />}
    </Modal>
  );
}
