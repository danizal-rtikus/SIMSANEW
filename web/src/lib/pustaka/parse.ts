/**
 * Pembaca BibTeX dan RIS menjadi CSL-JSON. Kedua format ini adalah ekspor
 * standar Mendeley, Zotero, Google Scholar, dan basis data jurnal.
 */
import { cleanTitle, normalizeDoi, parseName, type CslDate, type CslItem, type CslName } from './csl';

export interface ParseResult {
  items: CslItem[];
  warnings: string[];
}

/* ------------------------------------------------------------------ */
/* BibTeX                                                              */
/* ------------------------------------------------------------------ */

const LATEX: Record<string, string> = {
  '\\"a': 'ä', '\\"o': 'ö', '\\"u': 'ü', '\\"A': 'Ä', '\\"O': 'Ö', '\\"U': 'Ü',
  "\\'a": 'á', "\\'e": 'é', "\\'i": 'í', "\\'o": 'ó', "\\'u": 'ú', "\\'E": 'É',
  '\\`a': 'à', '\\`e': 'è', '\\`o': 'ò', '\\~n': 'ñ', '\\~a': 'ã', '\\~o': 'õ',
  '\\^a': 'â', '\\^e': 'ê', '\\^o': 'ô', '\\c c': 'ç', '\\cc': 'ç', '\\ss': 'ß',
  '\\&': '&', '\\%': '%', '\\$': '$', '\\_': '_', '\\#': '#', '--': '–',
};

function delatex(s: string): string {
  let v = s;
  v = v.replace(/\{\\([`'"^~c])\s*\{?([a-zA-Z])\}?\}/g, (_, a, b) => LATEX[`\\${a}${b}`] ?? b);
  v = v.replace(/\\([`'"^~])\{?([a-zA-Z])\}?/g, (_, a, b) => LATEX[`\\${a}${b}`] ?? b);
  for (const [k, r] of Object.entries(LATEX)) v = v.split(k).join(r);
  v = v.replace(/\\(textit|emph|textbf|mathrm|text)\{([^}]*)\}/g, '$2');
  return v.replace(/[{}]/g, '').replace(/\s+/g, ' ').trim();
}

const BIB_TYPE: Record<string, string> = {
  article: 'article-journal',
  book: 'book',
  booklet: 'book',
  inbook: 'chapter',
  incollection: 'chapter',
  inproceedings: 'paper-conference',
  conference: 'paper-conference',
  proceedings: 'book',
  phdthesis: 'thesis',
  mastersthesis: 'thesis',
  thesis: 'thesis',
  techreport: 'report',
  report: 'report',
  online: 'webpage',
  misc: 'article',
  electronic: 'webpage',
  www: 'webpage',
  dataset: 'dataset',
  software: 'software',
  unpublished: 'article',
};

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  mei: 5, agu: 8, agt: 8, okt: 10, des: 12,
};

function monthNum(v?: string): number | undefined {
  if (!v) return undefined;
  const n = Number(v);
  if (Number.isFinite(n) && n >= 1 && n <= 12) return n;
  return MONTHS[v.trim().slice(0, 3).toLowerCase()];
}

function names(v?: string): CslName[] | undefined {
  if (!v) return undefined;
  const raw = v.replace(/\s+/g, ' ').trim();
  // {Badan Pusat Statistik} ditulis dalam kurung kurawal ganda: lembaga utuh.
  const parts = splitTopLevel(raw, ' and ');
  const out = parts
    .map((p) => {
      const t = p.trim();
      if (/^\{.*\}$/.test(t) && !t.slice(1, -1).includes('{')) return { literal: delatex(t) };
      return parseName(delatex(t));
    })
    .filter((n) => n.family || n.literal || n.given);
  return out.length ? out : undefined;
}

/** Pisahkan pada pemisah yang tidak berada di dalam kurung kurawal. */
function splitTopLevel(s: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    if (depth === 0 && s.slice(i, i + sep.length).toLowerCase() === sep) {
      out.push(cur);
      cur = '';
      i += sep.length - 1;
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
}

interface RawEntry {
  type: string;
  key: string;
  fields: Record<string, string>;
}

function readBibEntries(src: string, warnings: string[]): RawEntry[] {
  const out: RawEntry[] = [];
  const strings: Record<string, string> = {};
  let i = 0;
  while (i < src.length) {
    const at = src.indexOf('@', i);
    if (at < 0) break;
    const m = /^@\s*([a-zA-Z]+)\s*([{(])/.exec(src.slice(at));
    if (!m) {
      i = at + 1;
      continue;
    }
    const type = m[1].toLowerCase();
    const open = m[2];
    const close = open === '{' ? '}' : ')';
    let j = at + m[0].length;
    // cari penutup entri dengan memperhatikan kedalaman kurung dan tanda kutip
    let depth = 1;
    let inQuote = false;
    const start = j;
    for (; j < src.length; j++) {
      const ch = src[j];
      if (ch === '\\') {
        j++;
        continue;
      }
      if (ch === '"' && depth === 1) inQuote = !inQuote;
      if (inQuote) continue;
      if (ch === '{' || (open === '(' && ch === '(')) depth++;
      else if (ch === close || (open === '(' && ch === ')') || ch === '}') {
        depth--;
        if (depth === 0) break;
      }
    }
    const body = src.slice(start, j);
    i = j + 1;
    if (type === 'comment' || type === 'preamble') continue;
    if (type === 'string') {
      const sm = /^\s*([\w-]+)\s*=\s*(.*)$/s.exec(body);
      if (sm) strings[sm[1].toLowerCase()] = unwrap(sm[2].trim());
      continue;
    }
    const comma = body.indexOf(',');
    const key = (comma < 0 ? body : body.slice(0, comma)).trim();
    const fields: Record<string, string> = {};
    if (comma >= 0) {
      const rest = body.slice(comma + 1);
      for (const part of splitFields(rest)) {
        const eq = part.indexOf('=');
        if (eq < 0) continue;
        const name = part.slice(0, eq).trim().toLowerCase();
        const val = part.slice(eq + 1).trim();
        if (!name) continue;
        fields[name] = splitTopLevel(val, '#')
          .map((v) => {
            const t = v.trim();
            if (/^[a-zA-Z][\w-]*$/.test(t) && !/^\d+$/.test(t)) return strings[t.toLowerCase()] ?? t;
            return unwrap(t);
          })
          .join('');
      }
    } else warnings.push(`Entri @${type} tanpa isi dilewati.`);
    out.push({ type, key, fields });
  }
  return out;
}

function splitFields(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let inQuote = false;
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\\') {
      cur += ch + (s[i + 1] ?? '');
      i++;
      continue;
    }
    if (ch === '"' && depth === 0) inQuote = !inQuote;
    if (!inQuote) {
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
    }
    if (ch === ',' && depth === 0 && !inQuote) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

function unwrap(v: string): string {
  const t = v.trim();
  if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('"') && t.endsWith('"'))) return t.slice(1, -1);
  return t;
}

export function parseBibtex(src: string): ParseResult {
  const warnings: string[] = [];
  const items: CslItem[] = [];
  for (const e of readBibEntries(src, warnings)) {
    const f = e.fields;
    const title = f.title ? delatex(f.title) : '';
    if (!title) {
      warnings.push(`Entri "${e.key || e.type}" tidak memiliki judul, dilewati.`);
      continue;
    }
    const type = BIB_TYPE[e.type] ?? 'article';
    const it: CslItem = { type, title };
    const author = names(f.author);
    if (author) it.author = author;
    const editor = names(f.editor);
    if (editor) it.editor = editor;
    const y = (f.year ?? f.date ?? '').match(/\d{4}/)?.[0];
    if (y) {
      const parts: number[] = [Number(y)];
      const mo = monthNum(f.month) ?? Number((f.date ?? '').match(/^\d{4}-(\d{2})/)?.[1] ?? NaN);
      if (mo && Number.isFinite(mo)) parts.push(mo);
      it.issued = { 'date-parts': [parts] };
    }
    const cont = f.journal ?? f.journaltitle ?? f.booktitle;
    if (cont) it['container-title'] = delatex(cont);
    if (f.volume) it.volume = delatex(f.volume);
    if (f.number) it.issue = delatex(f.number);
    if (f.pages) it.page = delatex(f.pages).replace(/–/g, '-');
    if (f.edition) it.edition = delatex(f.edition);
    const pub = f.publisher ?? f.school ?? f.institution ?? f.organization;
    if (pub) it.publisher = delatex(pub);
    const place = f.address ?? f.location;
    if (place) it['publisher-place'] = delatex(place);
    if (e.type === 'phdthesis') it.genre = 'Disertasi';
    else if (e.type === 'mastersthesis') it.genre = 'Tesis';
    else if (f.type && type === 'thesis') it.genre = delatex(f.type);
    const doi = normalizeDoi(f.doi);
    if (doi) it.DOI = doi;
    if (f.url) it.URL = f.url.trim();
    if (f.isbn) it.ISBN = f.isbn.trim();
    if (f.issn) it.ISSN = f.issn.trim();
    if (f.urldate) {
      const d = f.urldate.match(/(\d{4})-(\d{2})-(\d{2})/);
      if (d) it.accessed = { 'date-parts': [[Number(d[1]), Number(d[2]), Number(d[3])]] };
    }
    items.push(it);
  }
  if (!items.length && !warnings.length) warnings.push('Tidak ada entri BibTeX yang dikenali.');
  return { items, warnings };
}

/* ------------------------------------------------------------------ */
/* RIS                                                                 */
/* ------------------------------------------------------------------ */

const RIS_TYPE: Record<string, string> = {
  JOUR: 'article-journal',
  EJOUR: 'article-journal',
  JFULL: 'article-journal',
  MGZN: 'article',
  NEWS: 'article',
  BOOK: 'book',
  EBOOK: 'book',
  EDBOOK: 'book',
  CHAP: 'chapter',
  ECHAP: 'chapter',
  CONF: 'paper-conference',
  CPAPER: 'paper-conference',
  THES: 'thesis',
  RPRT: 'report',
  GOVDOC: 'report',
  ELEC: 'webpage',
  WEB: 'webpage',
  DATA: 'dataset',
  COMP: 'software',
  GEN: 'article',
};

function risDate(v: string): CslDate | undefined {
  const m = v.match(/(\d{4})(?:[/-](\d{1,2}))?(?:[/-](\d{1,2}))?/);
  if (!m) return undefined;
  const p = [Number(m[1])];
  if (m[2] && Number(m[2])) p.push(Number(m[2]));
  if (m[3] && Number(m[3])) p.push(Number(m[3]));
  return { 'date-parts': [p] };
}

export function parseRis(src: string): ParseResult {
  const warnings: string[] = [];
  const items: CslItem[] = [];
  let cur: Record<string, string[]> | null = null;
  const flush = () => {
    if (!cur) return;
    const g = (k: string) => cur![k]?.[0]?.trim();
    const title = cleanTitle(g('TI') ?? g('T1') ?? g('CT') ?? g('BT'));
    if (!title) {
      warnings.push('Satu entri RIS tanpa judul dilewati.');
      cur = null;
      return;
    }
    const ty = g('TY')?.toUpperCase() ?? 'GEN';
    const type = RIS_TYPE[ty] ?? 'article';
    const it: CslItem = { type, title };
    const au = [...(cur.AU ?? []), ...(cur.A1 ?? [])].map((a) => parseName(a)).filter((n) => n.family || n.literal);
    if (au.length) it.author = au;
    const ed = [...(cur.ED ?? []), ...(cur.A2 && type !== 'article-journal' ? cur.A2 : [])].map((a) => parseName(a)).filter((n) => n.family || n.literal);
    if (ed.length && type !== 'article-journal') it.editor = ed;
    const date = risDate(g('PY') ?? g('Y1') ?? g('DA') ?? '');
    if (date) it.issued = date;
    const cont = g('T2') ?? g('JO') ?? g('JF') ?? g('JA') ?? (type === 'chapter' ? g('BT') : undefined);
    if (cont && cont !== title) it['container-title'] = cleanTitle(cont);
    if (g('VL')) it.volume = g('VL');
    if (g('IS')) it.issue = g('IS');
    const sp = g('SP');
    const ep = g('EP');
    if (sp) it.page = ep ? `${sp}-${ep}` : sp;
    if (g('ET')) it.edition = g('ET');
    if (g('PB')) it.publisher = g('PB');
    if (g('CY')) it['publisher-place'] = g('CY');
    if (type === 'thesis' && g('M3')) it.genre = g('M3');
    const doi = normalizeDoi(g('DO') ?? cur.UR?.find((u) => /doi\.org/i.test(u)));
    if (doi) it.DOI = doi;
    const url = cur.UR?.find((u) => !/doi\.org/i.test(u)) ?? g('L2');
    if (url) it.URL = url;
    if (g('SN')) it[type === 'book' ? 'ISBN' : 'ISSN'] = g('SN');
    if (g('Y2')) {
      const a = risDate(g('Y2')!);
      if (a) it.accessed = a;
    }
    items.push(it);
    cur = null;
  };
  for (const line of src.split(/\r?\n/)) {
    const m = /^([A-Z][A-Z0-9])\s{1,2}-\s?(.*)$/.exec(line);
    if (!m) continue;
    const [, tag, val] = m;
    if (tag === 'TY') {
      flush();
      cur = { TY: [val] };
      continue;
    }
    if (tag === 'ER') {
      flush();
      continue;
    }
    if (!cur) continue;
    (cur[tag] ??= []).push(val);
  }
  flush();
  if (!items.length && !warnings.length) warnings.push('Tidak ada entri RIS yang dikenali.');
  return { items, warnings };
}

/** Deteksi otomatis BibTeX atau RIS. */
export function parseReferences(src: string): ParseResult & { format: 'bibtex' | 'ris' | null } {
  if (/^\s*TY\s{1,2}-/m.test(src)) return { ...parseRis(src), format: 'ris' };
  if (/@\s*[a-zA-Z]+\s*[{(]/.test(src)) return { ...parseBibtex(src), format: 'bibtex' };
  return { items: [], warnings: ['Format tidak dikenali. Gunakan berkas .bib (BibTeX) atau .ris.'], format: null };
}
