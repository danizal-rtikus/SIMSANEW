/**
 * Impor file Word (.docx) menjadi dokumen editor naskah.
 *
 * Yang dikenali:
 *   - Heading 1/2/3 (style Word, termasuk versi bahasa Indonesia "Judul 1") dan
 *     outline level paragraf.
 *   - Pola teks biasa: "BAB I" (+ judul di baris yang sama atau berikutnya),
 *     "1.1 Judul" / "1.1.1 Judul" yang pendek, "DAFTAR PUSTAKA" dan sejenisnya.
 *   - Penomoran heading otomatis dari daftar bertingkat Word (mis. "%1.%2").
 *   - Daftar berpoin/bernomor (termasuk huruf dan romawi) beserta tingkatnya.
 *   - Tabel (gabungan kolom), gambar (PNG/JPG/GIF/WEBP), keterangan "Gambar 2.1 ..."
 *     dan "Tabel 2.1 ...", tebal/miring/garis bawah/coret/super-/subskrip.
 *
 * Yang diabaikan (dilaporkan sebagai peringatan): catatan kaki, rumus Equation,
 * kotak teks, gambar format EMF/WMF. Font, margin, dan spasi tidak dibawa karena
 * format mengikuti pedoman saat ekspor.
 */
import JSZip from 'jszip';
import type { PmMark, PmNode } from './struktur';

export interface ImportedImage {
  key: string;
  name: string;
  data: Uint8Array;
  contentType: string;
}

export interface ImportResult {
  doc: PmNode;
  images: ImportedImage[];
  warnings: string[];
  stats: { bab: number; subbab: number; paragraf: number; tabel: number; gambar: number; daftar: number };
}

export interface ImportOptions {
  /** Buang isi sebelum BAB pertama (sampul, pengesahan, kata pengantar, daftar isi). */
  abaikanAwal?: boolean;
}

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const TEXT_WIDTH_EMU = 5040000; // 14 cm

/* ------------------------------------------------------------------ */
/* Utilitas XML                                                        */
/* ------------------------------------------------------------------ */

function kids(el: Element | null | undefined, name?: string): Element[] {
  if (!el) return [];
  const out: Element[] = [];
  for (let n = el.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 1 && (!name || (n as Element).localName === name)) out.push(n as Element);
  }
  return out;
}
function kid(el: Element | null | undefined, name: string): Element | null {
  return kids(el, name)[0] ?? null;
}
function wAttr(el: Element | null | undefined, name: string): string | null {
  if (!el) return null;
  return el.getAttributeNS(W, name) ?? el.getAttribute(`w:${name}`);
}
function descendants(el: Element, name: string): Element[] {
  return Array.from(el.getElementsByTagNameNS('*', name));
}
function parseXml(s: string): Document {
  return new DOMParser().parseFromString(s, 'application/xml');
}
/** Atribut boolean Word: <w:b/> atau <w:b w:val="true|1|on"/>; "0/false/off" berarti mati. */
function onOff(el: Element | null): boolean {
  if (!el) return false;
  const v = wAttr(el, 'val');
  return v === null || !['0', 'false', 'off', 'none'].includes(v);
}

/* ------------------------------------------------------------------ */
/* Style dan penomoran                                                 */
/* ------------------------------------------------------------------ */

interface StyleInfo {
  name: string;
  basedOn: string | null;
  outline: number | null;
  bold: boolean;
  numId: string | null;
  ilvl: number;
}

function readStyles(doc: Document | null): Map<string, StyleInfo> {
  const map = new Map<string, StyleInfo>();
  if (!doc) return map;
  for (const s of descendants(doc.documentElement, 'style')) {
    const id = wAttr(s, 'styleId');
    if (!id) continue;
    const pPr = kid(s, 'pPr');
    const rPr = kid(s, 'rPr');
    const numPr = kid(pPr, 'numPr');
    const ol = wAttr(kid(pPr, 'outlineLvl'), 'val');
    map.set(id, {
      name: (wAttr(kid(s, 'name'), 'val') ?? id).toLowerCase(),
      basedOn: wAttr(kid(s, 'basedOn'), 'val'),
      outline: ol !== null ? Number(ol) : null,
      bold: onOff(kid(rPr, 'b')),
      numId: wAttr(kid(numPr, 'numId'), 'val'),
      ilvl: Number(wAttr(kid(numPr, 'ilvl'), 'val') ?? 0),
    });
  }
  return map;
}

/** Tingkat heading dari style (mengikuti basedOn), 0 bila bukan heading. */
function styleHeadingLevel(styles: Map<string, StyleInfo>, id: string | null): number {
  let cur = id;
  for (let guard = 0; cur && guard < 10; guard++) {
    const st = styles.get(cur);
    const name = st?.name ?? cur.toLowerCase();
    const m = name.match(/^(?:heading|judul)\s*([1-9])$/) || cur.match(/^(?:Heading|Judul)([1-9])$/);
    if (m) return Number(m[1]);
    if (name === 'title') return 0;
    if (st?.outline !== null && st?.outline !== undefined && st.outline < 9) return st.outline + 1;
    cur = st?.basedOn ?? null;
  }
  return 0;
}
function styleIsCaption(styles: Map<string, StyleInfo>, id: string | null): boolean {
  if (!id) return false;
  const name = styles.get(id)?.name ?? id.toLowerCase();
  return name === 'caption' || name === 'keterangan';
}

interface LevelInfo {
  fmt: string;
  text: string;
}
function readNumbering(doc: Document | null): Map<string, Map<number, LevelInfo>> {
  const out = new Map<string, Map<number, LevelInfo>>();
  if (!doc) return out;
  const abstract = new Map<string, Map<number, LevelInfo>>();
  for (const a of descendants(doc.documentElement, 'abstractNum')) {
    const id = wAttr(a, 'abstractNumId');
    if (id === null) continue;
    const lv = new Map<number, LevelInfo>();
    for (const l of kids(a, 'lvl')) {
      lv.set(Number(wAttr(l, 'ilvl') ?? 0), { fmt: wAttr(kid(l, 'numFmt'), 'val') ?? 'decimal', text: wAttr(kid(l, 'lvlText'), 'val') ?? '' });
    }
    abstract.set(id, lv);
  }
  for (const n of descendants(doc.documentElement, 'num')) {
    const id = wAttr(n, 'numId');
    const abs = wAttr(kid(n, 'abstractNumId'), 'val');
    if (id !== null && abs !== null && abstract.has(abs)) out.set(id, abstract.get(abs)!);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Konversi                                                            */
/* ------------------------------------------------------------------ */

interface ParaItem {
  kind: 'para';
  heading: number; // 0 = bukan heading
  headingFromNumbering: boolean;
  caption: boolean;
  list: { numId: string; ilvl: number; fmt: string } | null;
  align: string | null;
  inline: PmNode[];
  images: PmNode[];
  text: string;
  allBold: boolean;
  pageBreakBefore: boolean;
}
type Item = ParaItem | { kind: 'table'; node: PmNode } | { kind: 'image'; node: PmNode };

const FMT_TYPE: Record<string, string | null> = {
  decimal: null,
  lowerLetter: 'a',
  upperLetter: 'A',
  lowerRoman: 'i',
  upperRoman: 'I',
};

class Converter {
  images: ImportedImage[] = [];
  warnings = new Map<string, number>();
  private imgSeq = 0;
  constructor(
    private zip: JSZip,
    private styles: Map<string, StyleInfo>,
    private numbering: Map<string, Map<number, LevelInfo>>,
    private rels: Map<string, string>,
  ) {}

  warn(key: string) {
    this.warnings.set(key, (this.warnings.get(key) ?? 0) + 1);
  }

  async image(blip: Element, extentCx: number | null): Promise<PmNode | null> {
    const rid = blip.getAttributeNS(R, 'embed') ?? blip.getAttribute('r:embed');
    const target = rid ? this.rels.get(rid) : null;
    if (!target) return null;
    const path = target.startsWith('/') ? target.slice(1) : `word/${target.replace(/^\.\//, '')}`;
    const file = this.zip.file(path);
    if (!file) return null;
    const ext = path.split('.').pop()!.toLowerCase();
    const type = ext === 'png' ? 'image/png' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'gif' ? 'image/gif' : ext === 'webp' ? 'image/webp' : null;
    if (!type) {
      this.warn(`gambar format ${ext.toUpperCase()} tidak didukung`);
      return null;
    }
    const data = await file.async('uint8array');
    const key = `img${++this.imgSeq}`;
    this.images.push({ key, name: path.split('/').pop()!, data, contentType: type });
    let lebar = 100;
    if (extentCx) {
      const pct = (extentCx / TEXT_WIDTH_EMU) * 100;
      lebar = [40, 60, 80, 100].reduce((best, w) => (Math.abs(w - pct) < Math.abs(best - pct) ? w : best), 100);
    }
    return { type: 'image', attrs: { path: `pending:${key}`, alt: null, lebar } };
  }

  /** Kumpulkan isi inline dari paragraf (run, hyperlink, field, sdt, tracked insert). */
  async inline(container: Element, out: { inline: PmNode[]; images: PmNode[]; boldChars: number; chars: number; pageBreak: boolean }, inField = { skip: false }) {
    for (const el of kids(container)) {
      switch (el.localName) {
        case 'r':
          await this.run(el, out, inField);
          break;
        case 'hyperlink':
        case 'smartTag':
        case 'ins':
        case 'customXml':
        case 'fldSimple':
          await this.inline(el, out, inField);
          break;
        case 'sdt':
          await this.inline(kid(el, 'sdtContent') ?? el, out, inField);
          break;
        case 'oMath':
        case 'oMathPara':
          out.inline.push({ type: 'text', text: '[rumus]' });
          this.warn('rumus Equation menjadi teks [rumus]');
          break;
        default:
          break; // del, bookmark, proofErr, pPr, dll.
      }
    }
  }

  async run(r: Element, out: { inline: PmNode[]; images: PmNode[]; boldChars: number; chars: number; pageBreak: boolean }, field: { skip: boolean }) {
    const rPr = kid(r, 'rPr');
    const marks: PmMark[] = [];
    const bold = onOff(kid(rPr, 'b'));
    if (bold) marks.push({ type: 'bold' });
    if (onOff(kid(rPr, 'i'))) marks.push({ type: 'italic' });
    const u = kid(rPr, 'u');
    if (u && wAttr(u, 'val') !== 'none') marks.push({ type: 'underline' });
    if (onOff(kid(rPr, 'strike')) || onOff(kid(rPr, 'dstrike'))) marks.push({ type: 'strike' });
    const va = wAttr(kid(rPr, 'vertAlign'), 'val');
    if (va === 'superscript') marks.push({ type: 'superscript' });
    if (va === 'subscript') marks.push({ type: 'subscript' });
    const pushText = (text: string) => {
      if (!text) return;
      const last = out.inline[out.inline.length - 1];
      const same = last && last.type === 'text' && JSON.stringify(last.marks ?? []) === JSON.stringify(marks);
      if (same) last.text += text;
      else out.inline.push(marks.length ? { type: 'text', text, marks } : { type: 'text', text });
      const n = text.replace(/\s/g, '').length;
      out.chars += n;
      if (bold) out.boldChars += n;
    };
    for (const el of kids(r)) {
      switch (el.localName) {
        case 'fldChar': {
          const t = wAttr(el, 'fldCharType');
          if (t === 'begin') field.skip = true; // lewati instruksi field (mis. ADDIN Mendeley), tampilkan hasilnya saja
          else if (t === 'separate' || t === 'end') field.skip = false;
          break;
        }
        case 'instrText':
          break;
        case 't':
          if (!field.skip) pushText(el.textContent ?? '');
          break;
        case 'tab':
          if (!field.skip) pushText(' ');
          break;
        case 'br': {
          const type = wAttr(el, 'type');
          if (type === 'page') out.pageBreak = true;
          else if (!field.skip) out.inline.push({ type: 'hardBreak' });
          break;
        }
        case 'noBreakHyphen':
          pushText('-');
          break;
        case 'footnoteReference':
        case 'endnoteReference':
          this.warn('catatan kaki diabaikan');
          break;
        case 'drawing':
        case 'pict':
        case 'object': {
          if (descendants(el, 'txbxContent').length) {
            this.warn('kotak teks diabaikan');
            break;
          }
          const blips = descendants(el, 'blip');
          const extent = descendants(el, 'extent')[0];
          const cx = extent ? Number(extent.getAttribute('cx')) : null;
          for (const b of blips) {
            const img = await this.image(b, cx);
            if (img) out.images.push(img);
          }
          if (!blips.length && el.localName !== 'drawing') this.warn('objek tertanam diabaikan');
          break;
        }
        default:
          break;
      }
    }
  }

  async paragraph(p: Element): Promise<ParaItem> {
    const pPr = kid(p, 'pPr');
    const styleId = wAttr(kid(pPr, 'pStyle'), 'val');
    const style = styleId ? this.styles.get(styleId) : undefined;
    let heading = styleHeadingLevel(this.styles, styleId);
    const ol = wAttr(kid(pPr, 'outlineLvl'), 'val');
    if (!heading && ol !== null && Number(ol) < 9) heading = Number(ol) + 1;
    const numPr = kid(pPr, 'numPr');
    const numId = wAttr(kid(numPr, 'numId'), 'val') ?? style?.numId ?? null;
    const ilvl = Number(wAttr(kid(numPr, 'ilvl'), 'val') ?? style?.ilvl ?? 0);
    const out = { inline: [] as PmNode[], images: [] as PmNode[], boldChars: 0, chars: 0, pageBreak: false };
    await this.inline(p, out);
    const text = out.inline.map((n) => n.text ?? ' ').join('').replace(/\s+/g, ' ').trim();
    let list: ParaItem['list'] = null;
    let headingFromNumbering = false;
    if (numId && numId !== '0') {
      const lvl = this.numbering.get(numId)?.get(ilvl);
      const fmt = lvl?.fmt ?? 'decimal';
      // Heading bernomor otomatis: "BAB %1", "%1.%2", "%1.%2.%3"
      const lt = lvl?.text ?? '';
      if (!heading && /^BAB\s*%1/i.test(lt)) {
        heading = 1;
        headingFromNumbering = true;
      } else if (!heading && /^%1\.%2(\.%3)?\.?$/.test(lt) && text.length <= 120 && out.chars > 0 && out.boldChars / out.chars > 0.6) {
        heading = lt.includes('%3') ? 3 : 2;
        headingFromNumbering = true;
      } else if (!heading) {
        list = { numId, ilvl, fmt: fmt === 'bullet' || fmt === 'none' ? 'bullet' : fmt };
      }
    }
    const jc = wAttr(kid(pPr, 'jc'), 'val');
    return {
      kind: 'para',
      heading,
      headingFromNumbering,
      caption: styleIsCaption(this.styles, styleId),
      list,
      align: jc === 'center' ? 'center' : jc === 'right' || jc === 'end' ? 'right' : null,
      inline: out.inline,
      images: out.images,
      text,
      allBold: out.chars > 0 && out.boldChars / out.chars > 0.8,
      pageBreakBefore: out.pageBreak || onOff(kid(pPr, 'pageBreakBefore')),
    };
  }

  async table(tbl: Element): Promise<PmNode> {
    const rows: PmNode[] = [];
    const trs = kids(tbl, 'tr');
    for (let ri = 0; ri < trs.length; ri++) {
      const tr = trs[ri];
      const isHeader = !!kid(kid(tr, 'trPr'), 'tblHeader') || ri === 0;
      const cells: PmNode[] = [];
      for (const tc of kids(tr, 'tc')) {
        const tcPr = kid(tc, 'tcPr');
        const span = Number(wAttr(kid(tcPr, 'gridSpan'), 'val') ?? 1);
        const vm = kid(tcPr, 'vMerge');
        const continued = vm && (wAttr(vm, 'val') ?? 'continue') === 'continue';
        const paras: PmNode[] = [];
        if (!continued) {
          for (const p of kids(tc, 'p')) {
            const it = await this.paragraph(p);
            if (it.inline.length) paras.push({ type: 'paragraph', content: trimInline(it.inline) });
          }
        }
        cells.push({
          type: isHeader ? 'tableHeader' : 'tableCell',
          attrs: span > 1 ? { colspan: span } : undefined,
          content: paras.length ? paras : [{ type: 'paragraph' }],
        });
      }
      if (cells.length) rows.push({ type: 'tableRow', content: cells });
    }
    return { type: 'table', content: rows };
  }

  async body(bodyEl: Element): Promise<Item[]> {
    const items: Item[] = [];
    for (const el of kids(bodyEl)) {
      if (el.localName === 'p') {
        const it = await this.paragraph(el);
        items.push(it);
        // gambar yang berdiri sendiri menjadi blok gambar setelah paragrafnya
        for (const img of it.images) items.push({ kind: 'image', node: img });
      } else if (el.localName === 'tbl') {
        items.push({ kind: 'table', node: await this.table(el) });
      } else if (el.localName === 'sdt') {
        items.push(...(await this.body(kid(el, 'sdtContent') ?? el)));
      }
    }
    return items;
  }
}

function trimInline(nodes: PmNode[]): PmNode[] {
  const out = nodes.map((n) => ({ ...n }));
  while (out.length && out[0].type === 'hardBreak') out.shift();
  while (out.length && out[out.length - 1].type === 'hardBreak') out.pop();
  if (out[0]?.type === 'text') out[0].text = out[0].text!.replace(/^\s+/, '');
  const last = out[out.length - 1];
  if (last?.type === 'text') last.text = last.text!.replace(/\s+$/, '');
  return out.filter((n) => n.type !== 'text' || n.text);
}

/** Hapus awalan teks sepanjang `len` karakter dari isi inline. */
function dropPrefix(nodes: PmNode[], len: number): PmNode[] {
  const out: PmNode[] = [];
  let left = len;
  for (const n of nodes) {
    if (left > 0 && n.type === 'text') {
      const t = n.text ?? '';
      if (t.length <= left) {
        left -= t.length;
        continue;
      }
      out.push({ ...n, text: t.slice(left) });
      left = 0;
    } else if (left > 0 && n.type === 'hardBreak') {
      left -= 1;
    } else out.push(n);
  }
  return trimInline(out);
}

/** Hapus awalan yang cocok dengan pola (dihitung pada teks mentah, bukan teks yang diringkas). */
function dropLeading(nodes: PmNode[], re: RegExp): PmNode[] {
  const raw = nodes.map((n) => (n.type === 'text' ? n.text ?? '' : n.type === 'hardBreak' ? ' ' : '')).join('');
  const m = raw.match(re);
  return m ? dropPrefix(nodes, m[0].length) : trimInline(nodes);
}

const plain = (s: string): PmNode[] => (s ? [{ type: 'text', text: s }] : []);
const UNNUMBERED = /^(DAFTAR PUSTAKA|DAFTAR REFERENSI|REFERENSI|LAMPIRAN(\s+.*)?|KATA PENGANTAR|ABSTRAK|ABSTRACT|DAFTAR ISI|DAFTAR GAMBAR|DAFTAR TABEL|DAFTAR LAMPIRAN|DAFTAR SINGKATAN|INTISARI|HALAMAN PENGESAHAN|LEMBAR PENGESAHAN|PERNYATAAN.*|MOTTO.*|PERSEMBAHAN)$/i;
const BAB_RE = /^BAB\s+([IVXLC]+|\d+)\b\s*[:.\-–]?\s*(.*)$/i;
const SUB_RE = /^(\d+)\.(\d+)(?:\.(\d+))?\.?\s+(\S.{0,118})$/;
const CAP_RE = /^(Gambar|Tabel|Table|Figure)\s+\d+(?:[.\-]\d+)*\.?\s*[:.\-–]?\s*/i;

function postProcess(items: Item[], conv: Converter, opts: ImportOptions): { content: PmNode[]; stats: ImportResult['stats'] } {
  const content: PmNode[] = [];
  const stats = { bab: 0, subbab: 0, paragraf: 0, tabel: 0, gambar: 0, daftar: 0 };
  let seenBab = false;
  // Tumpukan daftar yang sedang terbuka: tiap tingkat menyimpan node daftar.
  let listStack: { node: PmNode; ilvl: number; numId: string }[] = [];
  const closeLists = () => {
    listStack = [];
  };

  const emit = (n: PmNode) => {
    if (opts.abaikanAwal && !seenBab) return;
    content.push(n);
  };

  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (it.kind === 'table') {
      closeLists();
      emit(it.node);
      if (seenBab || !opts.abaikanAwal) stats.tabel++;
      continue;
    }
    if (it.kind === 'image') {
      closeLists();
      emit(it.node);
      if (seenBab || !opts.abaikanAwal) stats.gambar++;
      continue;
    }
    const p = it;
    if (!p.text && !p.inline.some((n) => n.type !== 'text')) {
      // paragraf kosong: pemisah daftar, tidak dibawa
      if (p.pageBreakBefore && seenBab) {
        /* page break kosong sebelum bab tidak perlu: bab baru selalu di halaman baru */
      }
      closeLists();
      continue;
    }

    // ---- Judul bab ----
    const babMatch = p.text.match(BAB_RE);
    if (p.heading === 1 || (babMatch && p.text.length <= 100)) {
      closeLists();
      let judul = '';
      if (babMatch) {
        judul = babMatch[2].trim();
        if (!judul) {
          // judul di paragraf berikutnya ("BAB I" lalu "PENDAHULUAN")
          const next = items[i + 1];
          if (next && next.kind === 'para' && next.text && next.text.length <= 100 && !BAB_RE.test(next.text) && !SUB_RE.test(next.text)) {
            judul = next.text;
            i++;
          }
        }
      } else {
        judul = p.text;
      }
      const isUnnumbered = !babMatch && !p.headingFromNumbering && UNNUMBERED.test(p.text);
      if (!isUnnumbered) {
        seenBab = true;
        stats.bab++;
      }
      emit({ type: 'heading', attrs: { level: 1, bernomor: !isUnnumbered, textAlign: 'center' }, content: plain(judul.toUpperCase() === judul ? judul : judul.toUpperCase()) });
      continue;
    }
    if (!p.heading && UNNUMBERED.test(p.text) && (p.allBold || p.align === 'center') && p.text === p.text.toUpperCase()) {
      closeLists();
      if (seenBab || !opts.abaikanAwal) emit({ type: 'heading', attrs: { level: 1, bernomor: false, textAlign: 'center' }, content: plain(p.text) });
      if (/^DAFTAR (PUSTAKA|REFERENSI)$|^REFERENSI$/i.test(p.text)) seenBab = true;
      continue;
    }

    // ---- Subbab ----
    const sub = p.text.match(SUB_RE);
    const looksSub = sub && p.text.length <= 120 && !/[.;:,]$/.test(p.text) && (p.allBold || p.heading >= 2);
    if (p.heading >= 2 || looksSub) {
      closeLists();
      const level = p.heading >= 2 ? Math.min(3, p.heading) : sub && sub[3] ? 3 : 2;
      const content2 = dropLeading(p.inline, /^\s*\d+(?:\.\d+){1,2}\.?\s+/);
      emit({ type: 'heading', attrs: { level, bernomor: true, textAlign: 'left' }, content: stripMarks(content2) });
      if (seenBab || !opts.abaikanAwal) stats.subbab++;
      continue;
    }

    // ---- Keterangan gambar/tabel ----
    const cap = p.text.match(CAP_RE);
    if ((p.caption || (cap && p.text.length <= 220)) && cap) {
      closeLists();
      const jenis = /^(gambar|figure)/i.test(cap[1]) ? 'gambar' : 'tabel';
      emit({ type: 'paragraph', attrs: { keterangan: jenis, textAlign: 'center' }, content: dropLeading(p.inline, new RegExp('^\\s*' + CAP_RE.source.slice(1), 'i')) });
      continue;
    }

    // ---- Daftar ----
    if (p.list) {
      const para: PmNode = { type: 'paragraph', content: trimInline(p.inline) };
      const item: PmNode = { type: 'listItem', content: [para] };
      const isBullet = p.list.fmt === 'bullet';
      const listType = isBullet ? 'bulletList' : 'orderedList';
      // naik ke tingkat yang sesuai
      while (listStack.length && (listStack[listStack.length - 1].ilvl > p.list.ilvl)) listStack.pop();
      const top = listStack[listStack.length - 1];
      if (top && top.ilvl === p.list.ilvl && top.node.type === listType && top.numId === p.list.numId) {
        top.node.content!.push(item);
      } else if (top && top.ilvl < p.list.ilvl) {
        const parentItem = top.node.content![top.node.content!.length - 1];
        const nested: PmNode = { type: listType, attrs: isBullet ? undefined : { type: FMT_TYPE[p.list.fmt] ?? null }, content: [item] };
        parentItem.content!.push(nested);
        listStack.push({ node: nested, ilvl: p.list.ilvl, numId: p.list.numId });
      } else {
        if (top && top.ilvl === p.list.ilvl) listStack.pop();
        const node: PmNode = { type: listType, attrs: isBullet ? undefined : { type: FMT_TYPE[p.list.fmt] ?? null }, content: [item] };
        if (listStack.length) {
          const parentItem = listStack[listStack.length - 1].node.content!.slice(-1)[0];
          parentItem.content!.push(node);
        } else {
          emit(node);
          if (seenBab || !opts.abaikanAwal) stats.daftar++;
        }
        listStack.push({ node, ilvl: p.list.ilvl, numId: p.list.numId });
      }
      continue;
    }

    // ---- Paragraf biasa ----
    closeLists();
    const attrs = p.align ? { textAlign: p.align } : undefined;
    if (p.inline.length) {
      emit({ type: 'paragraph', attrs, content: trimInline(p.inline) });
      if (seenBab || !opts.abaikanAwal) stats.paragraf++;
    }
  }
  return { content, stats };
}

/** Judul tidak perlu tanda tebal (sudah tebal dari gaya). */
function stripMarks(nodes: PmNode[]): PmNode[] {
  return nodes.map((n) => {
    if (n.type !== 'text' || !n.marks) return n;
    const marks = n.marks.filter((m) => m.type !== 'bold');
    return marks.length ? { ...n, marks } : { type: 'text', text: n.text };
  });
}

export async function importDocx(data: ArrayBuffer | Uint8Array, opts: ImportOptions = {}): Promise<ImportResult> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(data);
  } catch {
    throw new Error('File bukan dokumen Word (.docx) yang valid. File .doc lama perlu disimpan ulang sebagai .docx.');
  }
  const docFile = zip.file('word/document.xml');
  if (!docFile) throw new Error('Isi dokumen Word tidak ditemukan');
  const read = async (p: string) => {
    const f = zip.file(p);
    return f ? parseXml(await f.async('string')) : null;
  };
  const [docXml, stylesXml, numXml, relsXml] = await Promise.all([read('word/document.xml'), read('word/styles.xml'), read('word/numbering.xml'), read('word/_rels/document.xml.rels')]);
  const rels = new Map<string, string>();
  if (relsXml) for (const r of descendants(relsXml.documentElement, 'Relationship')) rels.set(r.getAttribute('Id') ?? '', r.getAttribute('Target') ?? '');
  const conv = new Converter(zip, readStyles(stylesXml), readNumbering(numXml), rels);
  const body = descendants(docXml!.documentElement, 'body')[0];
  if (!body) throw new Error('Isi dokumen Word kosong');
  const items = await conv.body(body);
  let { content, stats } = postProcess(items, conv, opts);
  if (opts.abaikanAwal && !content.length) {
    // tidak ada "BAB": bawa semuanya
    ({ content, stats } = postProcess(items, conv, { ...opts, abaikanAwal: false }));
  }
  // buang gambar yang tidak terpakai karena berada di bagian awal yang diabaikan
  const used = new Set<string>();
  const walk = (n: PmNode) => {
    if (n.type === 'image' && typeof n.attrs?.path === 'string') used.add(n.attrs.path.replace('pending:', ''));
    n.content?.forEach(walk);
  };
  content.forEach(walk);
  const warnings = [...conv.warnings.entries()].map(([k, n]) => (n > 1 ? `${k} (${n} kali)` : k));
  return {
    doc: { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] },
    images: conv.images.filter((im) => used.has(im.key)),
    warnings,
    stats,
  };
}
