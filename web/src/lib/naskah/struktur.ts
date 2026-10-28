/**
 * Struktur naskah dari JSON dokumen editor (tanpa ketergantungan pada editor),
 * dipakai oleh outline, ekspor DOCX, dan (nantinya) review per bab.
 */

export interface PmMark {
  type: string;
  attrs?: Record<string, unknown>;
}
export interface PmNode {
  type: string;
  attrs?: Record<string, any>;
  content?: PmNode[];
  text?: string;
  marks?: PmMark[];
}

export interface OutlineItem {
  /** Indeks blok tingkat atas di dokumen. */
  index: number;
  level: 1 | 2 | 3;
  /** "BAB I", "1.2", "1.2.3", atau "" bila tidak bernomor. */
  nomor: string;
  judul: string;
  /** Nomor bab (1-based) tempat heading berada; 0 bila sebelum bab pertama atau bab tanpa nomor. */
  bab: number;
}

export interface CaptionLabel {
  index: number;
  label: string; // "Gambar 2.1" / "Tabel 3.2"
}

export function roman(n: number): string {
  const map: [number, string][] = [
    [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
    [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
  ];
  let out = '';
  for (const [v, s] of map) while (n >= v) { out += s; n -= v; }
  return out;
}

export function nodeText(n: PmNode): string {
  if (n.type === 'text') return n.text ?? '';
  if (n.type === 'hardBreak') return ' ';
  return (n.content ?? []).map(nodeText).join('');
}

export interface Block {
  type: string;
  attrs?: Record<string, any> | null;
  text: string;
}

/** Hitung nomor heading dan keterangan. Dipakai editor (dekorasi) dan ekspor, jadi hasilnya selalu sama. */
export function analyzeBlocks(blocks: Block[], opts: { babAwal?: number } = {}): { outline: OutlineItem[]; captions: Map<number, string> } {
  const outline: OutlineItem[] = [];
  const captions = new Map<number, string>();
  let bab = Math.max(1, opts.babAwal ?? 1) - 1;
  let sub = 0;
  let subsub = 0;
  let gambar = 0;
  let tabel = 0;
  let babAktif = 0;
  blocks.forEach((n, index) => {
    if (n.type === 'heading') {
      const level = (n.attrs?.level ?? 1) as 1 | 2 | 3;
      const bernomor = n.attrs?.bernomor !== false;
      const judul = n.text.trim();
      let nomor = '';
      if (level === 1) {
        if (bernomor) {
          bab += 1;
          babAktif = bab;
          nomor = `BAB ${roman(bab)}`;
        } else {
          babAktif = 0;
        }
        sub = 0;
        subsub = 0;
        gambar = 0;
        tabel = 0;
      } else if (level === 2) {
        if (bernomor && babAktif) {
          sub += 1;
          subsub = 0;
          nomor = `${babAktif}.${sub}`;
        }
      } else if (bernomor && babAktif && sub) {
        subsub += 1;
        nomor = `${babAktif}.${sub}.${subsub}`;
      }
      outline.push({ index, level, nomor, judul, bab: babAktif });
    } else if (n.type === 'paragraph' && n.attrs?.keterangan) {
      const prefix = babAktif ? `${babAktif}.` : '';
      if (n.attrs.keterangan === 'gambar') captions.set(index, `Gambar ${prefix}${++gambar}`);
      else captions.set(index, `Tabel ${prefix}${++tabel}`);
    }
  });
  return { outline, captions };
}

export function analyze(doc: PmNode | null | undefined, opts: { babAwal?: number } = {}) {
  return analyzeBlocks((doc?.content ?? []).map((n) => ({ type: n.type, attrs: n.attrs, text: nodeText(n) })), opts);
}

export interface ChapterInfo {
  bab: number;
  judul: string;
  /** Indeks blok judul bab dan indeks blok setelah bab (eksklusif). */
  start: number;
  end: number;
  /** Jumlah kata isi bab (tanpa judul). */
  kata: number;
}

/** Daftar bab bernomor beserta rentang bloknya, sama dengan pemotongan di database (priv.slice_bab). */
export function chapters(doc: PmNode | null | undefined): ChapterInfo[] {
  const blocks = doc?.content ?? [];
  const out: ChapterInfo[] = [];
  let cur: ChapterInfo | null = null;
  blocks.forEach((n, i) => {
    if (n.type === 'heading' && (n.attrs?.level ?? 1) === 1) {
      if (cur) {
        cur.end = i;
        out.push(cur);
        cur = null;
      }
      if (n.attrs?.bernomor !== false) cur = { bab: out.length + 1, judul: nodeText(n).trim(), start: i, end: blocks.length, kata: 0 };
    } else if (cur) {
      cur.kata += countWords({ type: 'doc', content: [n] });
    }
  });
  if (cur) out.push(cur);
  return out;
}

/** Potong satu bab menjadi dokumen tersendiri. */
export function sliceChapter(doc: PmNode, bab: number): PmNode | null {
  const c = chapters(doc).find((x) => x.bab === bab);
  if (!c) return null;
  return { type: 'doc', content: (doc.content ?? []).slice(c.start, c.end) };
}

export function countWords(doc: PmNode | null | undefined): number {
  const t = (doc?.content ?? []).map(nodeText).join(' ');
  const m = t.match(/[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*/gu);
  return m ? m.length : 0;
}

/* ------------------------------------------------------------------ */
/* Kerangka awal naskah sesuai jenjang                                 */
/* ------------------------------------------------------------------ */

const h = (level: 1 | 2 | 3, text: string, bernomor = true): PmNode => ({
  type: 'heading',
  attrs: { level, bernomor, textAlign: level === 1 ? 'center' : 'left' },
  content: [{ type: 'text', text }],
});
const p = (): PmNode => ({ type: 'paragraph' });

const KERANGKA: Record<'S1' | 'D3', [string, string[]][]> = {
  S1: [
    ['PENDAHULUAN', ['Latar Belakang', 'Rumusan Masalah', 'Batasan Masalah', 'Tujuan Penelitian', 'Manfaat Penelitian', 'Sistematika Penulisan']],
    ['TINJAUAN PUSTAKA', ['Penelitian Terdahulu', 'Landasan Teori']],
    ['METODOLOGI PENELITIAN', ['Kerangka Penelitian', 'Metode Pengumpulan Data', 'Metode Analisis dan Pengembangan']],
    ['HASIL DAN PEMBAHASAN', ['Hasil', 'Pembahasan']],
    ['PENUTUP', ['Kesimpulan', 'Saran']],
  ],
  D3: [
    ['PENDAHULUAN', ['Latar Belakang', 'Rumusan Masalah', 'Batasan Masalah', 'Tujuan', 'Manfaat', 'Sistematika Penulisan']],
    ['LANDASAN TEORI', ['Tinjauan Pustaka', 'Dasar Teori']],
    ['ANALISIS DAN PERANCANGAN', ['Analisis Sistem Berjalan', 'Analisis Kebutuhan', 'Perancangan Sistem']],
    ['IMPLEMENTASI DAN PENGUJIAN', ['Implementasi', 'Pengujian']],
    ['PENUTUP', ['Kesimpulan', 'Saran']],
  ],
};

export function initialDoc(jenjang: 'S1' | 'D3'): PmNode {
  const content: PmNode[] = [];
  for (const [bab, subs] of KERANGKA[jenjang]) {
    content.push(h(1, bab));
    for (const s of subs) {
      content.push(h(2, s));
      content.push(p());
    }
  }
  content.push(h(1, 'DAFTAR PUSTAKA', false));
  content.push({ type: 'bibliography' });
  content.push(p());
  return { type: 'doc', content };
}
