/**
 * Pencarian rujukan dari sumber terbuka:
 *  - Crossref (api.crossref.org): metadata DOI dan pencarian judul.
 *  - doi.org content negotiation: cadangan untuk DOI non-Crossref (DataCite, mEDRA).
 * Keduanya mendukung CORS sehingga dipanggil langsung dari peramban.
 */
import { cleanTitle, normalizeDoi, type CslItem, type CslName } from './csl';

const CROSSREF = 'https://api.crossref.org';
const MAILTO = 'simsa@stikomyos.ac.id';

const CR_TYPE: Record<string, string> = {
  'journal-article': 'article-journal',
  'proceedings-article': 'paper-conference',
  'book-chapter': 'chapter',
  'book-section': 'chapter',
  'book-part': 'chapter',
  book: 'book',
  monograph: 'book',
  'edited-book': 'book',
  'reference-book': 'book',
  report: 'report',
  'report-component': 'report',
  dissertation: 'thesis',
  'posted-content': 'article',
  dataset: 'dataset',
  standard: 'report',
};

interface CrName {
  given?: string;
  family?: string;
  name?: string;
}
interface CrDate {
  'date-parts'?: (number | null)[][];
}
export interface CrWork {
  DOI?: string;
  URL?: string;
  type?: string;
  title?: string[];
  subtitle?: string[];
  author?: CrName[];
  editor?: CrName[];
  'container-title'?: string[];
  issued?: CrDate;
  'published-print'?: CrDate;
  'published-online'?: CrDate;
  volume?: string;
  issue?: string;
  page?: string;
  publisher?: string;
  'publisher-location'?: string;
  ISBN?: string[];
  ISSN?: string[];
  edition?: string;
}

function crNames(list?: CrName[]): CslName[] | undefined {
  const out = (list ?? [])
    .map((n) => (n.family ? { family: n.family, given: n.given } : n.name ? { literal: n.name } : null))
    .filter(Boolean) as CslName[];
  return out.length ? out : undefined;
}

function crDate(w: CrWork) {
  for (const d of [w.issued, w['published-print'], w['published-online']]) {
    const p = d?.['date-parts']?.[0]?.filter((x): x is number => typeof x === 'number');
    if (p && p.length) return { 'date-parts': [p] };
  }
  return undefined;
}

export function crossrefToCsl(w: CrWork): CslItem {
  let title = cleanTitle(w.title?.[0]);
  const sub = cleanTitle(w.subtitle?.[0]);
  if (sub && !title.toLowerCase().includes(sub.toLowerCase())) title = `${title}: ${sub}`;
  const it: CslItem = { type: CR_TYPE[w.type ?? ''] ?? 'article', title };
  const a = crNames(w.author);
  if (a) it.author = a;
  const e = crNames(w.editor);
  if (e) it.editor = e;
  const d = crDate(w);
  if (d) it.issued = d;
  const cont = cleanTitle(w['container-title']?.[0]);
  if (cont) it['container-title'] = cont;
  if (w.volume) it.volume = w.volume;
  if (w.issue) it.issue = w.issue;
  if (w.page) it.page = w.page;
  if (w.publisher) it.publisher = w.publisher;
  if (w['publisher-location']) it['publisher-place'] = w['publisher-location'];
  if (w.edition) it.edition = w.edition;
  if (w.ISBN?.[0]) it.ISBN = w.ISBN[0];
  if (w.ISSN?.[0]) it.ISSN = w.ISSN[0];
  const doi = normalizeDoi(w.DOI);
  if (doi) it.DOI = doi;
  return it;
}

async function fetchJson(url: string, init?: RequestInit, timeout = 12000): Promise<Response> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    return await fetch(url, { ...init, signal: ctl.signal });
  } finally {
    clearTimeout(t);
  }
}

/** Ambil metadata satu DOI. Melempar galat berbahasa Indonesia bila gagal. */
export async function lookupDoi(input: string): Promise<CslItem> {
  const doi = normalizeDoi(input);
  if (!doi) throw new Error('Format DOI tidak dikenali. Contoh: 10.1016/j.eswa.2023.120001');
  try {
    const r = await fetchJson(`${CROSSREF}/works/${encodeURIComponent(doi)}?mailto=${MAILTO}`);
    if (r.ok) {
      const j = (await r.json()) as { message: CrWork };
      return crossrefToCsl(j.message);
    }
  } catch {
    /* lanjut ke doi.org */
  }
  try {
    const r = await fetchJson(`https://doi.org/${doi}`, { headers: { Accept: 'application/vnd.citationstyles.csl+json' } });
    if (r.ok) {
      const j = (await r.json()) as CslItem & { title?: string | string[]; 'container-title'?: string | string[] };
      const it: CslItem = { ...j };
      if (Array.isArray(j.title)) it.title = j.title[0];
      if (Array.isArray(j['container-title'])) it['container-title'] = j['container-title'][0];
      it.title = cleanTitle(it.title as string);
      it.DOI = doi;
      for (const k of ['id', 'source', 'link', 'reference', 'license', 'indexed', 'deposited', 'created', 'member', 'prefix', 'score', 'content-domain', 'abstract', 'funder', 'relation']) delete it[k];
      return it;
    }
    if (r.status === 404) throw new Error('DOI tidak ditemukan. Periksa kembali penulisannya.');
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('DOI tidak')) throw e;
  }
  throw new Error('Tidak dapat menghubungi layanan DOI. Periksa koneksi lalu coba lagi.');
}

export interface SearchHit {
  csl: CslItem;
  doi: string | null;
}

/** Cari berdasarkan judul atau kata kunci (Crossref, 10 hasil teratas). */
export async function searchCrossref(q: string, rows = 10): Promise<SearchHit[]> {
  const query = q.trim();
  if (query.length < 3) return [];
  const url = `${CROSSREF}/works?query.bibliographic=${encodeURIComponent(query)}&rows=${rows}&select=DOI,type,title,subtitle,author,editor,container-title,issued,published-print,published-online,volume,issue,page,publisher,ISBN,ISSN&mailto=${MAILTO}`;
  let r: Response;
  try {
    r = await fetchJson(url, undefined, 15000);
  } catch {
    throw new Error('Pencarian Crossref tidak merespons. Coba lagi sebentar.');
  }
  if (!r.ok) throw new Error(`Pencarian Crossref gagal (${r.status}).`);
  const j = (await r.json()) as { message: { items: CrWork[] } };
  return (j.message.items ?? [])
    .filter((w) => w.title?.[0])
    .map((w) => {
      const csl = crossrefToCsl(w);
      return { csl, doi: normalizeDoi(csl.DOI) };
    });
}
