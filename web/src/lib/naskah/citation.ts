/**
 * Sitasi dan daftar pustaka di editor naskah.
 *  - `citation`     : node inline atom, atribut `refs` (id pustaka) dan `halaman`.
 *  - `bibliography` : blok atom yang menampilkan daftar pustaka otomatis.
 * Teks keduanya tidak disimpan di naskah; dihitung dari pustaka dan gaya
 * sitasi saat ditampilkan atau diekspor, sehingga selalu konsisten.
 */
import { Node, mergeAttributes } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { Node as PmNodeType } from '@tiptap/pm/model';
import { buildContext, formatBibliography, formatCitation, type CiteContext, type CiteStyle, type RefLike, type Seg } from '../pustaka/format';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    naskahCitation: {
      insertCitation: (attrs: CitationAttrs) => ReturnType;
      updateCitationAt: (pos: number, attrs: CitationAttrs) => ReturnType;
      setPustaka: (refs: RefLike[], style: CiteStyle, baseOrder?: string[]) => ReturnType;
    };
    naskahBibliography: { insertBibliography: () => ReturnType };
  }
}

export interface CitationAttrs {
  refs: string[];
  halaman?: string | null;
  naratif?: boolean;
}

interface View {
  render: () => void;
}

export interface PustakaStorage {
  refs: RefLike[];
  style: CiteStyle;
  ctx: CiteContext;
  order: string[];
  /** Urutan sitasi naskah lengkap; dipakai tampilan potongan bab agar nomor IEEE sama. */
  baseOrder: string[];
  views: Set<View>;
}

export function docCitedIds(doc: PmNodeType): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  doc.descendants((n) => {
    if (n.type.name === 'citation') {
      for (const id of (n.attrs.refs as string[]) ?? []) {
        if (!seen.has(id)) {
          seen.add(id);
          out.push(id);
        }
      }
      return false;
    }
    return true;
  });
  return out;
}

function refresh(store: PustakaStorage, doc: PmNodeType, force: boolean) {
  const order = [...new Set([...store.baseOrder, ...docCitedIds(doc)])];
  const changed = force || order.join('|') !== store.order.join('|');
  if (!changed) return;
  store.order = order;
  store.ctx = buildContext(store.refs, store.style, order);
  store.views.forEach((v) => v.render());
}

export function renderSegs(el: HTMLElement, segs: Seg[]) {
  el.textContent = '';
  for (const s of segs) {
    if (s.i) {
      const em = document.createElement('em');
      em.textContent = s.t;
      el.appendChild(em);
    } else el.appendChild(document.createTextNode(s.t));
  }
}

const refreshKey = new PluginKey('naskahPustaka');

export const Citation = Node.create<{ onClick?: (pos: number, attrs: { refs: string[]; halaman: string | null; naratif: boolean }) => void }>({
  name: 'citation',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addOptions() {
    return { onClick: undefined };
  },

  addStorage(): PustakaStorage {
    return { refs: [], style: 'apa', ctx: buildContext([], 'apa'), order: [], baseOrder: [], views: new Set() };
  },

  addAttributes() {
    return {
      refs: {
        default: [],
        parseHTML: (el: HTMLElement) => {
          try {
            return JSON.parse(el.getAttribute('data-refs') ?? '[]');
          } catch {
            return [];
          }
        },
        renderHTML: (a: { refs?: string[] }) => ({ 'data-refs': JSON.stringify(a.refs ?? []) }),
      },
      halaman: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-halaman'),
        renderHTML: (a: { halaman?: string | null }) => (a.halaman ? { 'data-halaman': a.halaman } : {}),
      },
      naratif: {
        default: false,
        parseHTML: (el: HTMLElement) => el.hasAttribute('data-naratif'),
        renderHTML: (a: { naratif?: boolean }) => (a.naratif ? { 'data-naratif': '' } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-citation]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-citation': '', class: 'nk-cite' })];
  },

  addNodeView() {
    return ({ node, editor, getPos }) => {
      const store = editor.storage.citation as PustakaStorage;
      const dom = document.createElement('span');
      dom.className = 'nk-cite';
      dom.setAttribute('data-citation', '');
      dom.contentEditable = 'false';
      let cur = node;
      const view: View = {
        render: () => {
          const refs = (cur.attrs.refs as string[]) ?? [];
          dom.textContent = formatCitation(refs, store.ctx, cur.attrs.halaman as string | null, !!cur.attrs.naratif);
          const missing = refs.some((id) => !store.ctx.byId.has(id));
          dom.classList.toggle('broken', refs.length === 0 || (store.refs.length > 0 && missing));
          dom.title = missing && store.refs.length ? 'Sebagian rujukan sudah dihapus dari pustaka' : editor.isEditable ? 'Klik untuk mengubah sitasi' : '';
        },
      };
      store.views.add(view);
      view.render();
      dom.addEventListener('click', (e) => {
        const cb = this.options.onClick;
        if (!cb || !editor.isEditable || typeof getPos !== 'function') return;
        e.preventDefault();
        cb(getPos(), { refs: cur.attrs.refs as string[], halaman: (cur.attrs.halaman as string | null) ?? null, naratif: !!cur.attrs.naratif });
      });
      return {
        dom,
        update: (n) => {
          if (n.type !== cur.type) return false;
          cur = n;
          view.render();
          return true;
        },
        selectNode: () => dom.classList.add('selected'),
        deselectNode: () => dom.classList.remove('selected'),
        ignoreMutation: () => true,
        destroy: () => {
          store.views.delete(view);
        },
      };
    };
  },

  addCommands() {
    return {
      insertCitation:
        ({ refs, halaman, naratif }) =>
        ({ state, commands }) => {
          // Beri spasi bila sitasi langsung menempel pada kata sebelumnya.
          const { $from } = state.selection;
          const before = $from.parent.textBetween(Math.max(0, $from.parentOffset - 1), $from.parentOffset, undefined, '\ufffc');
          const node = { type: 'citation', attrs: { refs, halaman: halaman || null, naratif: !!naratif } };
          return commands.insertContent(before && /[^\s([\u00a0]/.test(before) ? [{ type: 'text', text: ' ' }, node] : node);
        },
      updateCitationAt:
        (pos, { refs, halaman, naratif }) =>
        ({ tr, dispatch }) => {
          const n = tr.doc.nodeAt(pos);
          if (!n || n.type.name !== 'citation') return false;
          if (dispatch) {
            if (!refs.length) tr.delete(pos, pos + n.nodeSize);
            else tr.setNodeMarkup(pos, undefined, { refs, halaman: halaman || null, naratif: !!naratif });
          }
          return true;
        },
      setPustaka:
        (refs, style, baseOrder) =>
        ({ editor }) => {
          const store = editor.storage.citation as PustakaStorage;
          store.refs = refs;
          store.style = style;
          store.baseOrder = baseOrder ?? [];
          refresh(store, editor.state.doc, true);
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    const store = this.storage as PustakaStorage;
    return [
      new Plugin({
        key: refreshKey,
        view: (v) => {
          refresh(store, v.state.doc, true);
          return {
            update: (view, prev) => {
              if (view.state.doc !== prev.doc) refresh(store, view.state.doc, false);
            },
          };
        },
      }),
    ];
  },
});

/** Daftar pustaka otomatis. Disisipkan sekali, di bawah judul DAFTAR PUSTAKA. */
export const Bibliography = Node.create({
  name: 'bibliography',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  parseHTML() {
    return [{ tag: 'div[data-bibliography]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-bibliography': '', class: 'nk-bib' })];
  },

  addNodeView() {
    return ({ editor }) => {
      const store = editor.storage.citation as PustakaStorage | undefined;
      const dom = document.createElement('div');
      dom.className = 'nk-bib';
      dom.setAttribute('data-bibliography', '');
      dom.contentEditable = 'false';
      const view: View = {
        render: () => {
          dom.textContent = '';
          const list = store ? formatBibliography(store.refs, store.ctx) : [];
          dom.classList.toggle('ieee', store?.style === 'ieee');
          if (!list.length) {
            const p = document.createElement('p');
            p.className = 'nk-bib-empty';
            p.textContent = 'Daftar pustaka tersusun otomatis dari rujukan di panel Pustaka.';
            dom.appendChild(p);
            return;
          }
          for (const e of list) {
            const p = document.createElement('p');
            p.className = 'nk-bib-item';
            if (e.num) {
              const n = document.createElement('span');
              n.className = 'nk-bib-num';
              n.textContent = `[${e.num}]`;
              p.appendChild(n);
            }
            const body = document.createElement('span');
            renderSegs(body, e.segs);
            p.appendChild(body);
            dom.appendChild(p);
          }
        },
      };
      store?.views.add(view);
      view.render();
      return {
        dom,
        update: (n) => n.type.name === 'bibliography',
        selectNode: () => dom.classList.add('selected'),
        deselectNode: () => dom.classList.remove('selected'),
        ignoreMutation: () => true,
        destroy: () => {
          store?.views.delete(view);
        },
      };
    };
  },

  addCommands() {
    return {
      insertBibliography:
        () =>
        ({ commands }) =>
          commands.insertContent({ type: 'bibliography' }),
    };
  },
});
