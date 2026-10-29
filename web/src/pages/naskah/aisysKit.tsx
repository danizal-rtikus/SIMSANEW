import { useEffect, useState, type ReactNode } from 'react';
import type { Editor } from '@tiptap/react';
import type { Node as PMNode } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import { aisys, type AisysStatus } from '../../lib/aisys';
import { buildIndex, chapterRange, findQuote, normalize } from '../../lib/naskah/anchor';
import type { useToast } from '../../components/Toast';

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

export function useStatus() {
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

export function Quota({ st }: { st: AisysStatus | null }) {
  if (!st || st.sisa === null) return null;
  return <span className={`nk-tag ${st.sisa <= 3 ? 'warn' : ''}`}>Sisa hari ini {st.sisa}</span>;
}

export function Disclaimer({ children }: { children?: ReactNode }) {
  return <p className="nk-ai-note">{children ?? 'Hasil AISYS adalah bahan pertimbangan. Periksa dan sesuaikan sebelum dipakai; tanggung jawab isi naskah tetap pada Anda.'}</p>;
}

export interface Snap {
  from: number;
  to: number;
  text: string;
}

export function selectionInfo(editor: Editor) {
  const { from, to, empty } = editor.state.selection;
  if (empty) return { from, to, text: '', citations: false };
  let citations = false;
  editor.state.doc.nodesBetween(from, to, (n) => {
    if (n.type.name === 'citation') citations = true;
  });
  return { from, to, text: editor.state.doc.textBetween(from, to, '\n\n', ' ').trim(), citations };
}

/** Konteks tulisan di posisi kursor: judul bab, subbab, dan paragraf sebelumnya. */
export function contextAt(editor: Editor, pos: number) {
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

export function insertParagraphsAfter(editor: Editor, pos: number, text: string) {
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

export function copy(text: string, toast: ReturnType<typeof useToast>) {
  navigator.clipboard?.writeText(text).then(
    () => toast.show('Disalin', 'ok'),
    () => toast.show('Tidak dapat menyalin', 'bad'),
  );
}

