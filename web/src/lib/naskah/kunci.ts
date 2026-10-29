import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PmNodeType } from '@tiptap/pm/model';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    naskahKunci: { setBabTerkunci: (bab: number[]) => ReturnType };
  }
}

/**
 * Kunci bab yang sudah di-ACC Pembimbing 1 dan 2.
 *
 * Pembagian bab sama dengan server (priv.slice_bab): bab ke-n dimulai dari judul
 * level 1 bernomor ke-n sampai sebelum judul level 1 berikutnya. Perubahan yang
 * menyentuh isi bab terkunci ditolak di editor; server menolak hal yang sama saat
 * menyimpan. Perubahan atribut tampilan saja (perataan, inden) tetap diizinkan,
 * sama seperti pemeriksaan server.
 */

export const kunciKey = new PluginKey<KunciState>('naskahKunci');

interface KunciState {
  bab: Set<number>;
  deco: DecorationSet;
}

export interface BabRange {
  bab: number;
  from: number;
  to: number;
}

/** Rentang setiap bab bernomor pada tingkat atas dokumen. */
export function babRanges(doc: PmNodeType): BabRange[] {
  const out: BabRange[] = [];
  let n = 0;
  let cur: BabRange | null = null;
  doc.forEach((node, pos) => {
    if (node.type.name === 'heading' && (Number(node.attrs.level) || 1) === 1) {
      if (cur) {
        cur.to = pos;
        out.push(cur);
        cur = null;
      }
      if (node.attrs.bernomor !== false) {
        n += 1;
        cur = { bab: n, from: pos, to: doc.content.size };
      }
    }
  });
  if (cur) out.push(cur);
  return out;
}

/** Tanda tangan isi: jenis node, teks, rujukan sitasi, dan berkas gambar. Atribut tampilan diabaikan. */
function sig(doc: PmNodeType, r: BabRange | undefined): string {
  if (!r) return '';
  const parts: string[] = [];
  doc.nodesBetween(r.from, r.to, (node) => {
    parts.push(node.type.name, '(', node.text ?? '');
    if (node.attrs?.refs) parts.push(JSON.stringify(node.attrs.refs));
    if (node.attrs?.path) parts.push(String(node.attrs.path));
    parts.push(')');
    return true;
  });
  return parts.join('');
}

function buildDeco(doc: PmNodeType, bab: Set<number>): DecorationSet {
  if (!bab.size) return DecorationSet.empty;
  const decos: Decoration[] = [];
  for (const r of babRanges(doc)) {
    if (!bab.has(r.bab)) continue;
    doc.nodesBetween(r.from, r.to, (node, pos) => {
      if (pos < r.from || pos >= r.to) return false;
      const head = pos === r.from;
      decos.push(Decoration.node(pos, pos + node.nodeSize, head ? { class: 'nk-locked nk-locked-head', 'data-kunci': 'Terkunci, ACC P1 dan P2' } : { class: 'nk-locked' }));
      return false;
    });
  }
  return DecorationSet.create(doc, decos);
}

/** Apakah transaksi mengubah isi bab terkunci? Mengembalikan nomor bab atau null. */
export function touchesLocked(tr: Transaction, bab: Set<number>): number | null {
  if (!bab.size || !tr.docChanged) return null;
  const before = tr.before;
  const oldR = babRanges(before).filter((r) => bab.has(r.bab));
  if (!oldR.length) return null;
  const newR = new Map(babRanges(tr.doc).map((r) => [r.bab, r]));
  for (const r of oldR) {
    const nr = newR.get(r.bab);
    if (!nr) return r.bab;
    // Jalur cepat: tidak ada langkah yang menyentuh rentang bab (termasuk batasnya)
    // dan awal bab hanya bergeser karena perubahan di depannya.
    // Hanya untuk transaksi satu langkah: koordinat langkah berikutnya sudah bukan koordinat dokumen lama.
    let touched = tr.mapping.maps.length !== 1;
    if (!touched)
      tr.mapping.maps[0].forEach((oldStart, oldEnd) => {
        if (oldStart <= r.to && oldEnd >= r.from) touched = true;
      });
    if (!touched && tr.mapping.map(r.from) === nr.from && tr.mapping.map(r.to, -1) === nr.to) continue;
    if (sig(before, r) !== sig(tr.doc, nr)) return r.bab;
  }
  return null;
}

/**
 * Gunakan tr.setMeta('kunciLewati', true) untuk transaksi yang memuat ulang naskah
 * dari server (bukan suntingan pengguna).
 */
export const BabLock = Extension.create<{ onBlocked?: (bab: number) => void }>({
  name: 'naskahKunci',
  addOptions() {
    return { onBlocked: undefined };
  },
  addCommands() {
    return {
      setBabTerkunci:
        (bab: number[]) =>
        ({ tr, dispatch }: { tr: Transaction; dispatch?: unknown }) => {
          if (dispatch) tr.setMeta(kunciKey, new Set(bab)).setMeta('addToHistory', false);
          return true;
        },
    } as any;
  },
  addProseMirrorPlugins() {
    const opts = this.options;
    let lastWarn = 0;
    return [
      new Plugin<KunciState>({
        key: kunciKey,
        state: {
          init: () => ({ bab: new Set(), deco: DecorationSet.empty }),
          apply: (tr, old) => {
            const next = tr.getMeta(kunciKey) as Set<number> | undefined;
            if (next) return { bab: next, deco: buildDeco(tr.doc, next) };
            if (!old.bab.size) return old;
            return { bab: old.bab, deco: tr.docChanged ? buildDeco(tr.doc, old.bab) : old.deco };
          },
        },
        filterTransaction(tr, state) {
          if (!tr.docChanged || tr.getMeta('kunciLewati')) return true;
          const st = kunciKey.getState(state);
          if (!st?.bab.size) return true;
          const hit = touchesLocked(tr, st.bab);
          if (hit === null) return true;
          const now = Date.now();
          if (now - lastWarn > 2500) {
            lastWarn = now;
            opts.onBlocked?.(hit);
          }
          return false;
        },
        props: {
          decorations: (state) => kunciKey.getState(state)?.deco,
        },
      }),
    ];
  },
});
