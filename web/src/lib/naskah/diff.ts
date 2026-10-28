/**
 * Perbandingan dua versi bab (Track Changes) per blok, lalu per kata untuk
 * blok yang berubah. Tanpa pustaka tambahan: LCS sederhana sudah cukup untuk
 * ukuran satu bab.
 */
import { analyze, nodeText, type PmNode } from './struktur';

type Op = 'same' | 'add' | 'del';

function lcs<T>(a: T[], b: T[], eq: (x: T, y: T) => boolean): { op: Op; a?: T; b?: T }[] {
  const n = a.length;
  const m = b.length;
  if (n * m > 4_000_000) {
    return [...a.map((x) => ({ op: 'del' as Op, a: x })), ...b.map((y) => ({ op: 'add' as Op, b: y }))];
  }
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = eq(a[i], b[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: { op: Op; a?: T; b?: T }[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (eq(a[i], b[j])) {
      out.push({ op: 'same', a: a[i], b: b[j] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ op: 'del', a: a[i++] });
    } else {
      out.push({ op: 'add', b: b[j++] });
    }
  }
  while (i < n) out.push({ op: 'del', a: a[i++] });
  while (j < m) out.push({ op: 'add', b: b[j++] });
  return out;
}

export interface WordPart {
  op: Op;
  text: string;
}

export function wordDiff(oldText: string, newText: string): WordPart[] {
  const tok = (s: string) => s.split(/(\s+)/).filter((x) => x.length);
  const parts = lcs(tok(oldText), tok(newText), (x, y) => x === y);
  const out: WordPart[] = [];
  for (const p of parts) {
    const text = (p.op === 'add' ? p.b : p.a) as string;
    const last = out[out.length - 1];
    if (last && last.op === p.op) last.text += text;
    else out.push({ op: p.op, text });
  }
  return out;
}

export interface DiffBlockInfo {
  type: string;
  level?: number;
  label: string; // nomor bab/subbab/keterangan
  text: string;
  /** Daftar/tabel ditampilkan per baris. */
  lines?: string[];
}

export type DiffEntry =
  | { kind: 'same'; block: DiffBlockInfo }
  | { kind: 'add'; block: DiffBlockInfo }
  | { kind: 'del'; block: DiffBlockInfo }
  | { kind: 'change'; old: DiffBlockInfo; block: DiffBlockInfo; words: WordPart[] };

function linesOf(n: PmNode): string[] {
  if (n.type === 'bulletList' || n.type === 'orderedList') {
    return (n.content ?? []).map((li, i) => `${n.type === 'orderedList' ? `${i + 1}.` : '•'} ${nodeText(li)}`);
  }
  if (n.type === 'table') return (n.content ?? []).map((r) => (r.content ?? []).map((c) => nodeText(c)).join(' | '));
  return [];
}

function blocksOf(doc: PmNode, bab: number): DiffBlockInfo[] {
  const { outline, captions } = analyze(doc, { babAwal: bab });
  const nomor = new Map(outline.map((o) => [o.index, o.nomor]));
  return (doc.content ?? []).map((n, i) => {
    const lines = linesOf(n);
    const label = nomor.get(i) ?? captions.get(i) ?? '';
    const text = n.type === 'image' ? `[Gambar${n.attrs?.alt ? `: ${n.attrs.alt}` : ''}]` : n.type === 'pageBreak' ? '[Halaman baru]' : lines.length ? lines.join('\n') : nodeText(n);
    return { type: n.type, level: n.attrs?.level, label, text, lines: lines.length ? lines : undefined };
  });
}

function similarity(a: string, b: string): number {
  const wa = new Set(a.toLowerCase().split(/\s+/).filter(Boolean));
  const wb = new Set(b.toLowerCase().split(/\s+/).filter(Boolean));
  if (!wa.size && !wb.size) return 1;
  let inter = 0;
  wa.forEach((w) => wb.has(w) && inter++);
  return inter / Math.max(wa.size, wb.size);
}

export function diffChapter(oldDoc: PmNode, newDoc: PmNode, bab: number): DiffEntry[] {
  const a = blocksOf(oldDoc, bab);
  const b = blocksOf(newDoc, bab);
  const ops = lcs(a, b, (x, y) => x.type === y.type && x.text === y.text);
  const out: DiffEntry[] = [];
  // Pasangkan rangkaian hapus+tambah berjenis sama menjadi "berubah" dengan diff per kata.
  let k = 0;
  while (k < ops.length) {
    if (ops[k].op === 'same') {
      out.push({ kind: 'same', block: ops[k].b! });
      k++;
      continue;
    }
    const dels: DiffBlockInfo[] = [];
    const adds: DiffBlockInfo[] = [];
    while (k < ops.length && ops[k].op !== 'same') {
      if (ops[k].op === 'del') dels.push(ops[k].a!);
      else adds.push(ops[k].b!);
      k++;
    }
    // Pasangkan berdasarkan kemiripan kata (greedy, paling mirip dulu).
    const pairOf = new Map<number, number>(); // indeks add -> indeks del
    const used = new Set<number>();
    const cands: { ai: number; di: number; sim: number }[] = [];
    adds.forEach((add, ai) =>
      dels.forEach((d, di) => {
        if (d.type !== add.type || (d.type === 'heading' && d.level !== add.level)) return;
        cands.push({ ai, di, sim: similarity(d.text, add.text) });
      }),
    );
    cands.sort((x, y) => y.sim - x.sim);
    for (const c of cands) {
      if (c.sim < 0.3 || pairOf.has(c.ai) || used.has(c.di)) continue;
      pairOf.set(c.ai, c.di);
      used.add(c.di);
    }
    adds.forEach((add, ai) => {
      const di = pairOf.get(ai);
      if (di !== undefined) out.push({ kind: 'change', old: dels[di], block: add, words: wordDiff(dels[di].text, add.text) });
      else out.push({ kind: 'add', block: add });
    });
    dels.forEach((d, i) => {
      if (!used.has(i)) out.push({ kind: 'del', block: d });
    });
  }
  return out;
}

export function diffStats(entries: DiffEntry[]): { berubah: number; ditambah: number; dihapus: number } {
  return {
    berubah: entries.filter((e) => e.kind === 'change').length,
    ditambah: entries.filter((e) => e.kind === 'add').length,
    dihapus: entries.filter((e) => e.kind === 'del').length,
  };
}
