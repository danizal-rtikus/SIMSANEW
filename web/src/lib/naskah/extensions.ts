import { Extension, Node, mergeAttributes, type Extensions } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Heading from '@tiptap/extension-heading';
import Underline from '@tiptap/extension-underline';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import TextAlign from '@tiptap/extension-text-align';
import Placeholder from '@tiptap/extension-placeholder';
import CharacterCount from '@tiptap/extension-character-count';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import Image from '@tiptap/extension-image';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PmNodeType } from '@tiptap/pm/model';
import { analyzeBlocks } from './struktur';
import { Bibliography, Citation } from './citation';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    naskahPageBreak: { setPageBreak: () => ReturnType };
    naskahCaption: { setCaption: (jenis: CaptionKind | null) => ReturnType };
    naskahImage: { setNaskahImage: (attrs: { path: string; alt?: string; lebar?: number }) => ReturnType };
    naskahIndent: { indentBlock: () => ReturnType; outdentBlock: () => ReturnType };
    naskahComments: { setCommentMarks: (list: CommentMark[]) => ReturnType };
  }
}

export type CaptionKind = 'gambar' | 'tabel';

/**
 * Heading naskah: level 1 = BAB, 2 = subbab, 3 = sub-subbab.
 * Atribut `bernomor` false dipakai untuk bagian tanpa nomor bab (mis. DAFTAR PUSTAKA).
 * Nomor ditampilkan otomatis (CSS counter di layar, dihitung ulang saat ekspor).
 */
export const NaskahHeading = Heading.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      bernomor: {
        default: true,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-bernomor') !== 'false',
        renderHTML: (attrs: { bernomor?: boolean }) => ({ 'data-bernomor': attrs.bernomor === false ? 'false' : 'true' }),
      },
    };
  },
}).configure({ levels: [1, 2, 3] });

/** Paragraf keterangan gambar/tabel ("Gambar 2.1 ..."), bernomor otomatis per bab. */
export const Caption = Extension.create({
  name: 'naskahCaption',
  addGlobalAttributes() {
    return [
      {
        types: ['paragraph'],
        attributes: {
          keterangan: {
            default: null,
            parseHTML: (el: HTMLElement) => el.getAttribute('data-keterangan'),
            renderHTML: (attrs: { keterangan?: string | null }) => (attrs.keterangan ? { 'data-keterangan': attrs.keterangan } : {}),
          },
        },
      },
    ];
  },
  addCommands() {
    return {
      setCaption:
        (jenis) =>
        ({ commands }) =>
          commands.setNode('paragraph', { keterangan: jenis }),
    };
  },
});

export const MAX_INDENT = 5;

/**
 * Inden blok paragraf (maju/mundur), masing-masing 1,25 cm. Di dalam daftar,
 * tombol yang sama menurunkan atau menaikkan tingkat butir daftar.
 * Tab / Shift+Tab melakukan hal yang sama (kecuali di dalam tabel).
 */
export const BlockIndent = Extension.create({
  name: 'naskahIndent',
  addGlobalAttributes() {
    return [
      {
        types: ['paragraph'],
        attributes: {
          indent: {
            default: 0,
            parseHTML: (el: HTMLElement) => Math.min(MAX_INDENT, Math.max(0, Number(el.getAttribute('data-indent')) || 0)),
            renderHTML: (attrs: { indent?: number }) => (attrs.indent ? { 'data-indent': String(attrs.indent) } : {}),
          },
        },
      },
    ];
  },
  addCommands() {
    const shift =
      (delta: number) =>
      () =>
      ({ state, tr, dispatch }: { state: any; tr: any; dispatch: any }) => {
        const { from, to } = state.selection;
        let changed = false;
        state.doc.nodesBetween(from, to, (node: any, pos: number) => {
          if (node.type.name !== 'paragraph') return true;
          const cur = Number(node.attrs.indent) || 0;
          const next = Math.min(MAX_INDENT, Math.max(0, cur + delta));
          if (next !== cur) {
            changed = true;
            if (dispatch) tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: next });
          }
          return false;
        });
        return changed;
      };
    return { indentBlock: shift(1), outdentBlock: shift(-1) };
  },
  addKeyboardShortcuts() {
    const run = (dir: 1 | -1) => () => {
      const e = this.editor;
      if (e.isActive('table')) return false;
      if (e.isActive('listItem')) {
        if (dir === 1) return e.commands.sinkListItem('listItem') || true;
        return e.commands.liftListItem('listItem');
      }
      return dir === 1 ? e.commands.indentBlock() || true : e.commands.outdentBlock();
    };
    return { Tab: run(1), 'Shift-Tab': run(-1) };
  },
});

/** Pemisah halaman manual; pada ekspor menjadi page break. */
export const PageBreak = Node.create({
  name: 'pageBreak',
  group: 'block',
  atom: true,
  selectable: true,
  parseHTML() {
    return [{ tag: 'div[data-page-break]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-page-break': 'true', class: 'nk-page-break' }), ['span', {}, 'Halaman baru']];
  },
  addCommands() {
    return {
      setPageBreak:
        () =>
        ({ commands }) =>
          commands.insertContent({ type: this.name }),
    };
  },
  addKeyboardShortcuts() {
    return { 'Mod-Enter': () => this.editor.commands.setPageBreak() };
  },
});

/**
 * Gambar naskah disimpan di bucket privat `naskah`; atribut `path` adalah lokasi berkas,
 * URL bertanda tangan diambil saat ditampilkan (lihat NaskahImageView).
 */
export const NaskahImage = Image.extend({
  name: 'image',
  addAttributes() {
    return {
      ...this.parent?.(),
      path: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-path'),
        renderHTML: (attrs: { path?: string | null }) => (attrs.path ? { 'data-path': attrs.path } : {}),
      },
      lebar: {
        default: 100,
        parseHTML: (el: HTMLElement) => Number(el.getAttribute('data-lebar')) || 100,
        renderHTML: (attrs: { lebar?: number }) => ({ 'data-lebar': String(attrs.lebar ?? 100) }),
      },
    };
  },
  addCommands() {
    return {
      ...this.parent?.(),
      setNaskahImage:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: 'image', attrs: { src: null, alt: attrs.alt ?? null, path: attrs.path, lebar: attrs.lebar ?? 100 } }),
    };
  },
}).configure({ inline: false, allowBase64: false });

function numberingDecorations(doc: PmNodeType, babAwal: number): DecorationSet {
  const blocks: { type: string; attrs: Record<string, any>; text: string; pos: number; size: number }[] = [];
  doc.forEach((node, offset) => {
    blocks.push({ type: node.type.name, attrs: node.attrs, text: node.type.name === 'heading' ? node.textContent : '', pos: offset, size: node.nodeSize });
  });
  const { outline, captions } = analyzeBlocks(blocks, { babAwal });
  const decos: Decoration[] = [];
  for (const o of outline) {
    if (!o.nomor) continue;
    const b = blocks[o.index];
    decos.push(Decoration.node(b.pos, b.pos + b.size, { 'data-nomor': o.nomor }));
  }
  captions.forEach((label, index) => {
    const b = blocks[index];
    decos.push(Decoration.node(b.pos, b.pos + b.size, { 'data-nomor': label }));
  });
  return DecorationSet.create(doc, decos);
}

/** Nomor bab, subbab, dan keterangan ditampilkan sebagai dekorasi (bukan teks), dihitung ulang tiap perubahan. */
export const Numbering = Extension.create<{ babAwal: number }>({
  name: 'naskahNumbering',
  addOptions() {
    return { babAwal: 1 };
  },
  addProseMirrorPlugins() {
    const babAwal = this.options.babAwal;
    const key = new PluginKey<DecorationSet>('naskahNumbering');
    return [
      new Plugin<DecorationSet>({
        key,
        state: {
          init: (_, state) => numberingDecorations(state.doc, babAwal),
          apply: (tr, old) => (tr.docChanged ? numberingDecorations(tr.doc, babAwal) : old.map(tr.mapping, tr.doc)),
        },
        props: {
          decorations(state) {
            return key.getState(state);
          },
        },
      }),
    ];
  },
});

export interface CommentMark {
  id: string;
  from: number;
  to: number;
  /** Kelas tambahan, mis. 'p1', 'p2', 'draf', 'aktif', 'selesai'. */
  cls?: string;
}
export const commentKey = new PluginKey<DecorationSet>('naskahComments');

/**
 * Sorotan komentar sebagai dekorasi (bukan bagian isi naskah), sehingga dosen
 * tidak mengubah naskah dan mahasiswa tetap bebas menyunting.
 * Perbarui dengan editor.commands.setCommentMarks(list).
 */
export const CommentHighlights = Extension.create<{ onClick?: (id: string) => void }>({
  name: 'naskahComments',
  addOptions() {
    return { onClick: undefined };
  },
  addCommands() {
    return {
      setCommentMarks:
        (list: CommentMark[]) =>
        ({ tr, dispatch }: { tr: any; dispatch: any }) => {
          if (dispatch) tr.setMeta(commentKey, list).setMeta('addToHistory', false);
          return true;
        },
    } as any;
  },
  addProseMirrorPlugins() {
    const onClick = () => this.options.onClick;
    return [
      new Plugin<DecorationSet>({
        key: commentKey,
        state: {
          init: () => DecorationSet.empty,
          apply: (tr, old) => {
            const list = tr.getMeta(commentKey) as CommentMark[] | undefined;
            if (list) {
              const max = tr.doc.content.size;
              const decos = list
                .filter((c) => c.from >= 0 && c.to <= max && c.to > c.from)
                .map((c) => Decoration.inline(c.from, c.to, { class: `nk-cmt ${c.cls ?? ''}`, 'data-cmt': c.id }, { id: c.id }));
              return DecorationSet.create(tr.doc, decos);
            }
            return old.map(tr.mapping, tr.doc);
          },
        },
        props: {
          decorations(state) {
            return commentKey.getState(state);
          },
          handleClick(view, pos) {
            const cb = onClick();
            if (!cb) return false;
            const set = commentKey.getState(view.state);
            const found = set?.find(pos, pos);
            if (found && found.length) {
              cb((found[found.length - 1].spec as { id: string }).id);
            }
            return false;
          },
        },
      }),
    ];
  },
});

/** Posisi dekorasi komentar saat ini (setelah dipetakan melewati suntingan). */
export function currentCommentRanges(state: any): Map<string, { from: number; to: number }> {
  const out = new Map<string, { from: number; to: number }>();
  const set = commentKey.getState(state) as DecorationSet | undefined;
  set?.find().forEach((d) => out.set((d.spec as { id: string }).id, { from: d.from, to: d.to }));
  return out;
}

/** Daftar ekstensi naskah. `imageView` disuntikkan dari komponen React agar modul ini bebas React. */
export function naskahExtensions(
  opts: {
    placeholder?: string;
    imageView?: Parameters<typeof NaskahImage.extend>[0];
    babAwal?: number;
    onCommentClick?: (id: string) => void;
    onCitationClick?: (pos: number, attrs: { refs: string[]; halaman: string | null; naratif: boolean }) => void;
  } = {},
): Extensions {
  return [
    StarterKit.configure({
      heading: false,
      code: false,
      codeBlock: false,
      horizontalRule: false,
    }),
    NaskahHeading,
    Underline,
    Subscript,
    Superscript,
    TextAlign.configure({ types: ['heading', 'paragraph'], alignments: ['left', 'center', 'right', 'justify'], defaultAlignment: 'justify' }),
    Placeholder.configure({
      placeholder: ({ node }) => {
        if (node.type.name === 'heading') return node.attrs.level === 1 ? 'Judul bab' : 'Judul subbab';
        return opts.placeholder ?? 'Tulis di sini';
      },
      showOnlyCurrent: true,
    }),
    CharacterCount,
    Table.configure({ resizable: false, HTMLAttributes: { class: 'nk-table' } }),
    TableRow,
    TableHeader,
    TableCell,
    opts.imageView ? NaskahImage.extend(opts.imageView) : NaskahImage,
    Caption,
    PageBreak,
    BlockIndent,
    Numbering.configure({ babAwal: opts.babAwal ?? 1 }),
    CommentHighlights.configure({ onClick: opts.onCommentClick }),
    // configure() membuat instans baru, sehingga tiap editor punya penyimpanan pustaka sendiri.
    Citation.configure({ onClick: opts.onCitationClick }),
    Bibliography,
  ];
}
