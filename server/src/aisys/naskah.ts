/** Mengubah JSON naskah (Tiptap/ProseMirror) menjadi teks untuk AISYS. */

export interface PmNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PmNode[];
  text?: string;
}

const ROMAN: [number, string][] = [
  [10, 'X'],
  [9, 'IX'],
  [5, 'V'],
  [4, 'IV'],
  [1, 'I'],
];
function roman(n: number): string {
  let out = '';
  for (const [v, s] of ROMAN) while (n >= v) {
    out += s;
    n -= v;
  }
  return out;
}

export function inlineText(n: PmNode, cite?: (ids: string[]) => string): string {
  if (n.type === 'text') return n.text ?? '';
  if (n.type === 'hardBreak') return ' ';
  if (n.type === 'citation') return cite ? cite((n.attrs?.refs as string[]) ?? []) : '';
  return (n.content ?? []).map((c) => inlineText(c, cite)).join('');
}

/** Potong satu bab (heading level 1 bernomor ke-N sampai heading level 1 berikutnya). */
export function sliceBab(doc: PmNode | null | undefined, bab: number): PmNode[] | null {
  const blocks = doc?.content ?? [];
  let count = 0;
  let start = -1;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.type === 'heading' && Number(b.attrs?.level ?? 1) === 1) {
      if (start >= 0) return blocks.slice(start, i);
      if (b.attrs?.bernomor !== false) {
        count++;
        if (count === bab) start = i;
      }
    }
  }
  return start >= 0 ? blocks.slice(start) : null;
}

/**
 * Teks bab berstruktur: judul bab dan subbab bernomor, daftar, tabel, keterangan.
 * `cite` mengubah sitasi menjadi penanda, mis. "[sitasi: Lestari 2024]".
 */
export function blocksToText(blocks: PmNode[], bab: number, cite?: (ids: string[]) => string): string {
  const lines: string[] = [];
  let sub = 0;
  let subsub = 0;
  const list = (n: PmNode, depth: number) => {
    let i = 0;
    for (const item of n.content ?? []) {
      i++;
      const pad = '  '.repeat(depth);
      const mark = n.type === 'orderedList' ? `${i}.` : '-';
      let first = true;
      for (const c of item.content ?? []) {
        if (c.type === 'bulletList' || c.type === 'orderedList') list(c, depth + 1);
        else {
          lines.push(`${pad}${first ? mark : ' '.repeat(mark.length)} ${inlineText(c, cite).trim()}`);
          first = false;
        }
      }
    }
  };
  for (const b of blocks) {
    switch (b.type) {
      case 'heading': {
        const level = Number(b.attrs?.level ?? 1);
        const t = inlineText(b).trim();
        if (level === 1) lines.push(`BAB ${roman(bab)} ${t.toUpperCase()}`, '');
        else if (level === 2) {
          sub++;
          subsub = 0;
          lines.push('', `${bab}.${sub} ${t}`);
        } else {
          subsub++;
          lines.push('', `${bab}.${sub}.${subsub} ${t}`);
        }
        break;
      }
      case 'paragraph': {
        const t = inlineText(b, cite).trim();
        if (!t) break;
        const k = b.attrs?.keterangan;
        lines.push(k ? `[Keterangan ${k}] ${t}` : t);
        break;
      }
      case 'blockquote':
        for (const c of b.content ?? []) lines.push(`> ${inlineText(c, cite).trim()}`);
        break;
      case 'bulletList':
      case 'orderedList':
        list(b, 0);
        break;
      case 'table':
        lines.push('[Tabel]');
        for (const r of b.content ?? []) lines.push(`| ${(r.content ?? []).map((c) => inlineText(c, cite).trim()).join(' | ')} |`);
        break;
      case 'image':
        lines.push('[Gambar]');
        break;
      default:
        break;
    }
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function normalize(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

export function countWords(s: string): number {
  return (s.match(/\S+/g) ?? []).length;
}

/** Batasi panjang teks (karakter) dengan menyisakan awal dan akhir. */
export function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  const head = Math.floor(max * 0.75);
  return `${s.slice(0, head)}\n\n[... bagian tengah dipotong karena terlalu panjang ...]\n\n${s.slice(s.length - (max - head))}`;
}
