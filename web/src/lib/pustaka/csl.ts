/** Tipe dan utilitas CSL-JSON (format rujukan standar Mendeley, Zotero, Crossref). */

export interface CslName {
  family?: string;
  given?: string;
  literal?: string;
}

export interface CslDate {
  'date-parts'?: (number | string)[][];
  raw?: string;
  literal?: string;
}

export type CslType =
  | 'article-journal'
  | 'article'
  | 'book'
  | 'chapter'
  | 'paper-conference'
  | 'thesis'
  | 'report'
  | 'webpage'
  | 'dataset'
  | 'software';

export interface CslItem {
  type?: CslType | string;
  title?: string;
  author?: CslName[];
  editor?: CslName[];
  issued?: CslDate;
  accessed?: CslDate;
  'container-title'?: string;
  'collection-title'?: string;
  volume?: string | number;
  issue?: string | number;
  page?: string;
  edition?: string | number;
  publisher?: string;
  'publisher-place'?: string;
  genre?: string;
  DOI?: string;
  URL?: string;
  ISBN?: string;
  ISSN?: string;
  note?: string;
  [k: string]: unknown;
}

export interface Reference {
  id: string;
  thesis_id: string;
  csl: CslItem;
  doi: string | null;
  sumber: 'doi' | 'cari' | 'bibtex' | 'ris' | 'manual' | 'mendeley';
  created_at: string;
  updated_at: string;
}

export const TYPE_LABEL: Record<string, string> = {
  'article-journal': 'Artikel jurnal',
  article: 'Artikel',
  book: 'Buku',
  chapter: 'Bab buku',
  'paper-conference': 'Prosiding',
  thesis: 'Skripsi / tesis',
  report: 'Laporan',
  webpage: 'Laman web',
  dataset: 'Dataset',
  software: 'Perangkat lunak',
};

/** Normalisasi DOI: buang awalan https://doi.org/, "doi:", spasi. Huruf asli dipertahankan;
 *  pembandingan (duplikat) memakai huruf kecil. */
export function normalizeDoi(v: string | null | undefined): string | null {
  if (!v) return null;
  const m = String(v)
    .trim()
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')
    .replace(/^doi:\s*/i, '')
    .match(/10\.\d{4,9}\/\S+/);
  return m ? m[0].replace(/[.,;)\]]+$/, '') : null;
}

export function yearOf(it: CslItem): number | null {
  const p = it.issued?.['date-parts']?.[0]?.[0];
  if (p !== undefined && p !== null && String(p).trim() !== '') {
    const n = Number(p);
    return Number.isFinite(n) ? n : null;
  }
  const raw = it.issued?.raw ?? it.issued?.literal;
  const m = raw?.match(/\d{4}/);
  return m ? Number(m[0]) : null;
}

export function dateParts(d?: CslDate): number[] {
  const p = d?.['date-parts']?.[0] ?? [];
  return p.map((x) => Number(x)).filter((x) => Number.isFinite(x));
}

export function nameKey(n: CslName): string {
  return (n.family || n.literal || n.given || '').trim();
}

/** "Saputra, Andi" / "Andi Saputra" / "Badan Pusat Statistik" menjadi CslName. */
export function parseName(s: string): CslName {
  const v = s.replace(/\s+/g, ' ').trim();
  if (!v) return {};
  if (v.includes(',')) {
    const [family, ...rest] = v.split(',');
    return { family: family.trim(), given: rest.join(',').trim() || undefined };
  }
  const parts = v.split(' ');
  if (parts.length === 1) return { family: v };
  // Nama lembaga (banyak kata, diawali kata umum) dibiarkan utuh.
  if (/^(badan|kementerian|dinas|universitas|institut|world|united|pusat|direktorat|lembaga|komisi)\b/i.test(v)) return { literal: v };
  return { family: parts[parts.length - 1], given: parts.slice(0, -1).join(' ') };
}

export function cleanTitle(s?: string): string {
  return (s ?? '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
