/**
 * Jangkar komentar berbasis kutipan teks (seperti "text quote selector" W3C):
 * kutipan + sedikit konteks sebelum dan sesudahnya. Dengan cara ini komentar
 * tetap menemukan tempatnya di naskah yang sudah direvisi, selama kalimat
 * yang dikomentari masih ada.
 */
import type { Node as PMNode } from '@tiptap/pm/model';

export interface TextIndex {
  text: string;
  /** Posisi dokumen untuk tiap karakter `text`, atau -1 untuk pemisah antarblok. */
  map: number[];
}

export interface Quote {
  kutipan: string;
  prefix: string;
  suffix: string;
}

const CONTEXT = 40;

export function normalize(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** Teks datar dokumen (spasi diringkas) beserta peta posisi. */
export function buildIndex(doc: PMNode, from = 0, to = doc.content.size): TextIndex {
  let text = '';
  const map: number[] = [];
  const push = (ch: string, pos: number) => {
    const space = /\s/.test(ch);
    if (space) {
      if (!text.length || text.endsWith(' ')) return;
      text += ' ';
      map.push(pos);
      return;
    }
    text += ch;
    map.push(pos);
  };
  doc.nodesBetween(from, to, (node, pos) => {
    if (node.isText) {
      const t = node.text ?? '';
      const s = Math.max(from, pos);
      const e = Math.min(to, pos + t.length);
      for (let p = s; p < e; p++) push(t[p - pos], p);
      return false;
    }
    if (node.isBlock || node.type.name === 'hardBreak') {
      if (text.length && !text.endsWith(' ')) {
        text += ' ';
        map.push(-1);
      }
    }
    return true;
  });
  return { text, map };
}

function charRange(index: TextIndex, from: number, to: number): [number, number] | null {
  let a = -1;
  let b = -1;
  for (let i = 0; i < index.map.length; i++) {
    const p = index.map[i];
    if (p < 0) continue;
    if (a < 0 && p >= from) a = i;
    if (p < to) b = i;
  }
  if (a < 0 || b < a) return null;
  return [a, b + 1];
}

/** Ambil kutipan dan konteks untuk rentang seleksi. */
export function quoteAt(doc: PMNode, from: number, to: number): Quote | null {
  const index = buildIndex(doc);
  const r = charRange(index, from, to);
  if (!r) return null;
  const kutipan = index.text.slice(r[0], r[1]).trim();
  if (!kutipan) return null;
  return {
    kutipan,
    prefix: index.text.slice(Math.max(0, r[0] - CONTEXT), r[0]),
    suffix: index.text.slice(r[1], r[1] + CONTEXT),
  };
}

function commonSuffix(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}
function commonPrefix(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

/** Cari tempat kutipan di indeks; pilih kemunculan dengan konteks paling cocok. */
export function findQuote(index: TextIndex, q: Quote): { from: number; to: number } | null {
  const needle = normalize(q.kutipan);
  if (!needle) return null;
  const pre = normalize(q.prefix ?? '');
  const suf = normalize(q.suffix ?? '');
  let best = -1;
  let bestScore = -1;
  let i = index.text.indexOf(needle);
  while (i >= 0) {
    const score = commonSuffix(normalize(index.text.slice(Math.max(0, i - CONTEXT - 5), i)), pre) + commonPrefix(normalize(index.text.slice(i + needle.length, i + needle.length + CONTEXT + 5)), suf);
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
    i = index.text.indexOf(needle, i + 1);
  }
  if (best < 0) return findPartial(index, needle);
  let s = best;
  let e = best + needle.length - 1;
  while (s <= e && index.map[s] < 0) s++;
  while (e >= s && index.map[e] < 0) e--;
  if (s > e) return null;
  return { from: index.map[s], to: index.map[e] + 1 };
}

/** Rentang posisi dokumen untuk satu bab (dari judul bab bernomor ke-n sampai judul bab berikutnya). */
export function chapterRange(doc: PMNode, bab: number): { from: number; to: number } | null {
  let count = 0;
  let from = -1;
  let to = doc.content.size;
  let done = false;
  doc.forEach((node, offset) => {
    if (done) return;
    if (node.type.name === 'heading' && node.attrs.level === 1) {
      if (from >= 0) {
        to = offset;
        done = true;
        return;
      }
      if (node.attrs.bernomor !== false) {
        count += 1;
        if (count === bab) from = offset;
      }
    }
  });
  return from < 0 ? null : { from, to };
}

/**
 * Kutipan panjang sering ikut berubah saat mahasiswa merevisi sebagian kalimat.
 * Bila kutipan utuh tidak ditemukan, cari awal dan akhir kutipan (masing-masing
 * sekitar 40 karakter) lalu tambatkan pada rentang di antaranya.
 */
function findPartial(index: TextIndex, needle: string): { from: number; to: number } | null {
  if (needle.length < 60) return null;
  const head = needle.slice(0, 40);
  const tail = needle.slice(-40);
  const h = index.text.indexOf(head);
  const toRange = (a: number, b: number) => {
    let s = a;
    let e = b;
    while (s <= e && index.map[s] < 0) s++;
    while (e >= s && index.map[e] < 0) e--;
    return s > e ? null : { from: index.map[s], to: index.map[e] + 1 };
  };
  if (h >= 0) {
    const t = index.text.indexOf(tail, h + head.length);
    if (t >= 0 && t + tail.length - h <= needle.length * 2) return toRange(h, t + tail.length - 1);
    return toRange(h, h + head.length - 1);
  }
  const t = index.text.indexOf(tail);
  return t >= 0 ? toRange(t, t + tail.length - 1) : null;
}
