/**
 * Format sitasi dan daftar pustaka: APA 7 (penulis-tahun) dan IEEE (bernomor).
 * Hasil berupa potongan teks dengan penanda miring, sehingga dapat dipakai di
 * editor, tampilan review, dan ekspor DOCX dengan aturan yang sama.
 */
import { cleanTitle, dateParts, nameKey, yearOf, type CslItem, type CslName } from './csl';

export type CiteStyle = 'apa' | 'ieee';
export interface Seg {
  t: string;
  i?: boolean;
}
export interface RefLike {
  id: string;
  csl: CslItem;
}

export function styleFrom(gaya?: string | null): CiteStyle {
  return /ieee/i.test(gaya ?? '') ? 'ieee' : 'apa';
}
export const STYLE_LABEL: Record<CiteStyle, string> = { apa: 'APA 7', ieee: 'IEEE' };

const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
const MON = ['Jan.', 'Feb.', 'Mar.', 'Apr.', 'May', 'Jun.', 'Jul.', 'Aug.', 'Sep.', 'Oct.', 'Nov.', 'Dec.'];

function initials(given?: string, withSpace = true): string {
  if (!given) return '';
  return given
    .split(/\s+/)
    .filter(Boolean)
    .map((w) =>
      w
        .split('-')
        .map((p) => (p ? `${p[0].toUpperCase()}.` : ''))
        .join('-'),
    )
    .join(withSpace ? ' ' : '');
}

function pages(p?: string): string {
  return (p ?? '').replace(/\s*-+\s*/g, '–');
}

function doiUrl(it: CslItem): string {
  if (it.DOI) return `https://doi.org/${String(it.DOI).replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')}`;
  return it.URL ?? '';
}

function endDot(s: string): string {
  return /[.?!]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`;
}

/* ------------------------------------------------------------------ */
/* Konteks: nomor IEEE dan pembeda tahun APA (2024a, 2024b)            */
/* ------------------------------------------------------------------ */

export interface CiteContext {
  style: CiteStyle;
  byId: Map<string, RefLike>;
  /** IEEE: nomor menurut urutan pertama dikutip. */
  order: Map<string, number>;
  /** APA: akhiran huruf bila penulis dan tahun sama. */
  suffix: Map<string, string>;
  /** Rujukan yang muncul sebagai sitasi di naskah. */
  cited: Set<string>;
}

function apaAuthorKey(it: CslItem): string {
  const a = it.author ?? [];
  if (!a.length) return cleanTitle(it.title).toLowerCase();
  if (a.length === 1) return nameKey(a[0]).toLowerCase();
  if (a.length === 2) return `${nameKey(a[0])}&${nameKey(a[1])}`.toLowerCase();
  return `${nameKey(a[0])}etal`.toLowerCase();
}

export function buildContext(refs: RefLike[], style: CiteStyle, citedOrder: string[] = []): CiteContext {
  const byId = new Map(refs.map((r) => [r.id, r]));
  const order = new Map<string, number>();
  citedOrder.forEach((id) => {
    if (byId.has(id) && !order.has(id)) order.set(id, order.size + 1);
  });
  // Rujukan yang belum dikutip mendapat nomor sesudahnya (urutan daftar).
  refs.forEach((r) => {
    if (!order.has(r.id)) order.set(r.id, order.size + 1);
  });
  const suffix = new Map<string, string>();
  if (style === 'apa') {
    const groups = new Map<string, RefLike[]>();
    for (const r of refs) {
      const k = `${apaAuthorKey(r.csl)}|${yearOf(r.csl) ?? 'nd'}`;
      groups.set(k, [...(groups.get(k) ?? []), r]);
    }
    groups.forEach((g) => {
      if (g.length < 2) return;
      g.sort((a, b) => cleanTitle(a.csl.title).localeCompare(cleanTitle(b.csl.title), 'id'));
      g.forEach((r, i) => suffix.set(r.id, String.fromCharCode(97 + i)));
    });
  }
  return { style, byId, order, suffix, cited: new Set(citedOrder.filter((id) => byId.has(id))) };
}

/* ------------------------------------------------------------------ */
/* Sitasi dalam teks                                                   */
/* ------------------------------------------------------------------ */

function apaWho(it: CslItem, naratif: boolean): string {
  const a = it.author ?? [];
  if (!a.length) {
    const t = cleanTitle(it.title);
    const w = t.split(/\s+/);
    return `"${w.slice(0, 4).join(' ')}${w.length > 4 ? '…' : ''}"`;
  }
  if (a.length === 1) return nameKey(a[0]);
  if (a.length === 2) return `${nameKey(a[0])} ${naratif ? 'dan' : '&'} ${nameKey(a[1])}`;
  return `${nameKey(a[0])} et al.`;
}

/**
 * Teks sitasi.
 *  APA  : "(Lestari et al., 2024; Santoso, 2023)"; naratif "Lestari et al. (2024)".
 *  IEEE : "[1], [3]" atau "[1, hlm. 45]" (naratif tidak mengubah bentuk).
 */
export function formatCitation(ids: string[], ctx: CiteContext, halaman?: string | null, naratif = false): string {
  const refs = ids.map((id) => ctx.byId.get(id)).filter(Boolean) as RefLike[];
  if (!refs.length) return ctx.style === 'ieee' ? '[?]' : '(rujukan dihapus)';
  const hal = halaman?.trim();
  if (ctx.style === 'ieee') {
    const nums = refs.map((r) => ctx.order.get(r.id) ?? 0).sort((a, b) => a - b);
    const body = nums.map((n) => `[${n || '?'}]`).join(', ');
    return hal && nums.length === 1 ? `[${nums[0] || '?'}, hlm. ${hal}]` : body;
  }
  const items = refs
    .map((r) => ({ who: apaWho(r.csl, naratif), year: `${yearOf(r.csl) ?? 't.t.'}${ctx.suffix.get(r.id) ?? ''}` }))
    .sort((a, b) => a.who.localeCompare(b.who, 'id') || a.year.localeCompare(b.year));
  if (naratif) {
    const parts = items.map((x, i) => `${x.who} (${x.year}${hal && i === items.length - 1 ? `, hlm. ${hal}` : ''})`);
    return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} dan ${parts[parts.length - 1]}` : parts[0];
  }
  return `(${items.map((x) => `${x.who}, ${x.year}`).join('; ')}${hal ? `, hlm. ${hal}` : ''})`;
}

/* ------------------------------------------------------------------ */
/* Daftar pustaka                                                      */
/* ------------------------------------------------------------------ */

function apaName(n: CslName): string {
  if (n.literal) return n.literal;
  const ini = initials(n.given);
  return ini ? `${n.family ?? ''}, ${ini}` : (n.family ?? '');
}

function apaAuthors(a: CslName[]): string {
  if (!a.length) return '';
  const names = a.map(apaName);
  if (names.length === 1) return names[0];
  if (names.length <= 20) return `${names.slice(0, -1).join(', ')}, & ${names[names.length - 1]}`;
  return `${names.slice(0, 19).join(', ')}, … ${names[names.length - 1]}`;
}

function apaEditors(e: CslName[]): string {
  if (!e.length) return '';
  const names = e.map((n) => (n.literal ? n.literal : `${initials(n.given)} ${n.family ?? ''}`.trim()));
  const s = names.length === 1 ? names[0] : names.length === 2 ? `${names[0]} & ${names[1]}` : `${names.slice(0, -1).join(', ')}, & ${names[names.length - 1]}`;
  return `${s} (${e.length > 1 ? 'Eds.' : 'Ed.'})`;
}

function apaReference(it: CslItem, sfx = ''): Seg[] {
  const segs: Seg[] = [];
  const a = it.author ?? [];
  const title = cleanTitle(it.title) || 'Tanpa judul';
  const dp = dateParts(it.issued);
  const year = `${dp[0] ?? 't.t.'}${sfx}`;
  const type = it.type ?? 'article-journal';
  const cont = cleanTitle(it['container-title']);
  const link = doiUrl(it);
  const isItalicTitle = ['book', 'report', 'thesis', 'webpage', 'dataset', 'software'].includes(type);
  const dateStr = type === 'webpage' && dp[1] ? `${year}, ${dp[2] ? `${dp[2]} ` : ''}${BULAN[dp[1] - 1]}` : year;

  if (a.length) segs.push({ t: `${endDot(apaAuthors(a))} (${dateStr}). ` });
  else segs.push(isItalicTitle ? { t: endDot(title), i: true } : { t: endDot(title) }, { t: ` (${dateStr}). ` });

  if (a.length) {
    if (isItalicTitle) segs.push({ t: title, i: true });
    else segs.push({ t: title });
  }
  if (type === 'book' && it.edition) segs.push({ t: ` (Ed. ke-${it.edition})` });
  if (type === 'thesis') segs.push({ t: ` [${it.genre || 'Skripsi'}${it.publisher ? `, ${it.publisher}` : ''}]` });
  if (a.length) segs.push({ t: /[.?!]$/.test(title) ? ' ' : '. ' });

  if (type === 'article-journal' || type === 'article') {
    if (cont) {
      segs.push({ t: cont, i: true });
      if (it.volume) segs.push({ t: ', ' }, { t: String(it.volume), i: true });
      if (it.issue) segs.push({ t: `(${it.issue})` });
      if (it.page) segs.push({ t: `, ${pages(it.page)}` });
      segs.push({ t: '. ' });
    }
  } else if (type === 'chapter' || type === 'paper-conference') {
    if (cont) {
      const ed = apaEditors(it.editor ?? []);
      segs.push({ t: `Dalam ${ed ? `${ed}, ` : ''}` }, { t: cont, i: true });
      if (it.page) segs.push({ t: ` (hlm. ${pages(it.page)})` });
      segs.push({ t: '. ' });
    }
    if (it.publisher) segs.push({ t: `${endDot(it.publisher)} ` });
  } else if (type === 'book' || type === 'report') {
    if (it.publisher) segs.push({ t: `${endDot(it.publisher)} ` });
  } else if (type === 'webpage') {
    if (cont) segs.push({ t: `${endDot(cont)} ` });
  } else if (it.publisher && type !== 'thesis') {
    segs.push({ t: `${endDot(it.publisher)} ` });
  }
  if (link) segs.push({ t: link });
  return trimSegs(segs);
}

function ieeeName(n: CslName): string {
  if (n.literal) return n.literal;
  return `${initials(n.given)} ${n.family ?? ''}`.trim();
}

function ieeeAuthors(a: CslName[]): string {
  if (!a.length) return '';
  const names = a.map(ieeeName);
  if (names.length > 6) return `${names[0]} et al.`;
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
}

function ieeeReference(it: CslItem): Seg[] {
  const segs: Seg[] = [];
  const a = ieeeAuthors(it.author ?? []);
  const title = cleanTitle(it.title) || 'Tanpa judul';
  const dp = dateParts(it.issued);
  const year = dp[0] ? String(dp[0]) : 't.t.';
  const type = it.type ?? 'article-journal';
  const cont = cleanTitle(it['container-title']);
  if (a) segs.push({ t: `${a}, ` });
  if (type === 'book' || type === 'report') {
    segs.push({ t: title, i: true }, { t: it.edition ? `, ed. ke-${it.edition}. ` : '. ' });
    const pub = [it['publisher-place'], it.publisher].filter(Boolean).join(': ');
    segs.push({ t: `${pub ? `${pub}, ` : ''}${year}.` });
  } else if (type === 'thesis') {
    segs.push({ t: `"${title}," ${it.genre || 'Skripsi'}${it.publisher ? `, ${it.publisher}` : ''}${it['publisher-place'] ? `, ${it['publisher-place']}` : ''}, ${year}.` });
  } else if (type === 'webpage') {
    segs.push({ t: `"${title}," ` });
    if (cont) segs.push({ t: `${cont}. ` });
    const ad = dateParts(it.accessed);
    if (ad.length >= 3) segs.push({ t: `Diakses: ${ad[2]} ${BULAN[ad[1] - 1]} ${ad[0]}. ` });
    if (it.URL) segs.push({ t: `[Daring]. Tersedia: ${it.URL}` });
  } else if (type === 'chapter' || type === 'paper-conference') {
    segs.push({ t: `"${title}," in ` }, { t: cont || '', i: true });
    segs.push({ t: `, ${year}${it.page ? `, pp. ${pages(it.page)}` : ''}` });
    segs.push({ t: it.DOI ? `, doi: ${it.DOI}.` : '.' });
  } else {
    segs.push({ t: `"${title}," ` });
    if (cont) segs.push({ t: cont, i: true });
    const bits = [it.volume ? `vol. ${it.volume}` : '', it.issue ? `no. ${it.issue}` : '', it.page ? `pp. ${pages(it.page)}` : '', `${dp[1] ? `${MON[dp[1] - 1]} ` : ''}${year}`].filter(Boolean);
    segs.push({ t: `${cont ? ', ' : ''}${bits.join(', ')}` });
    segs.push({ t: it.DOI ? `, doi: ${it.DOI}.` : it.URL ? `. [Daring]. Tersedia: ${it.URL}` : '.' });
  }
  return trimSegs(segs);
}

function trimSegs(segs: Seg[]): Seg[] {
  const out = segs.filter((s) => s.t);
  if (out.length) out[out.length - 1] = { ...out[out.length - 1], t: out[out.length - 1].t.replace(/\s+$/, '') };
  return out;
}

export interface BibEntry {
  id: string;
  num?: number;
  segs: Seg[];
}

/**
 * Daftar pustaka. APA: semua rujukan, urut penulis-tahun-judul.
 * IEEE: rujukan yang dikutip menurut nomor, lalu yang belum dikutip di akhir.
 * onlyCited: hanya rujukan yang benar-benar dikutip di naskah.
 */
export function formatBibliography(refs: RefLike[], ctx: CiteContext, onlyCited = false): BibEntry[] {
  const list = onlyCited ? refs.filter((r) => ctx.cited.has(r.id)) : [...refs];
  if (ctx.style === 'ieee') {
    return list
      .map((r) => ({ r, n: ctx.order.get(r.id) ?? 0 }))
      .sort((a, b) => a.n - b.n)
      .map(({ r, n }) => ({ id: r.id, num: n, segs: ieeeReference(r.csl) }));
  }
  return list
    .sort((a, b) => {
      const ka = `${(a.csl.author?.[0] ? nameKey(a.csl.author[0]) : cleanTitle(a.csl.title)).toLowerCase()} ${yearOf(a.csl) ?? 0} ${ctx.suffix.get(a.id) ?? ''}`;
      const kb = `${(b.csl.author?.[0] ? nameKey(b.csl.author[0]) : cleanTitle(b.csl.title)).toLowerCase()} ${yearOf(b.csl) ?? 0} ${ctx.suffix.get(b.id) ?? ''}`;
      return ka.localeCompare(kb, 'id');
    })
    .map((r) => ({ id: r.id, segs: apaReference(r.csl, ctx.suffix.get(r.id) ?? '') }));
}

export function segsText(segs: Seg[]): string {
  return segs.map((s) => s.t).join('');
}

/** Ringkasan satu baris untuk daftar pilihan: "Lestari, D. (2024). Judul…" */
export function shortLabel(it: CslItem): string {
  const a = it.author ?? [];
  const who = a.length ? `${nameKey(a[0])}${a.length > 1 ? (a.length === 2 ? ` & ${nameKey(a[1])}` : ' et al.') : ''}` : 'Tanpa penulis';
  return `${who} (${yearOf(it) ?? 't.t.'})`;
}
