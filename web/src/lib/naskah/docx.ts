/**
 * Ekspor naskah ke DOCX dengan format pedoman:
 * kertas A4, margin kiri 4 cm dan atas/kanan/bawah 3 cm, Times New Roman 12,
 * spasi 1,5, paragraf rata kiri-kanan dengan inden baris pertama 1,25 cm,
 * setiap BAB dimulai di halaman baru, nomor halaman di tengah bawah,
 * halaman sampul dan daftar isi otomatis (diperbarui saat dibuka di Word).
 */
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  LineRuleType,
  NumberFormat,
  PageNumber,
  Paragraph,
  Table,
  TableCell,
  TableOfContents,
  TableRow,
  TextRun,
  WidthType,
  type IParagraphOptions,
  type ParagraphChild,
} from 'docx';
import { analyze, nodeText, type PmNode } from './struktur';

export interface ResolvedImage {
  data: ArrayBuffer | Uint8Array;
  type: 'png' | 'jpg' | 'gif';
  width: number;
  height: number;
}

export interface DocxInput {
  doc: PmNode;
  judul: string;
  jenis: string; // "SKRIPSI" / "TUGAS AKHIR"
  nama: string;
  nim: string;
  prodi: string;
  institusi: string;
  tahun: number;
  logo?: ResolvedImage | null;
  resolveImage?: (path: string) => Promise<ResolvedImage | null>;
}

const FONT = 'Times New Roman';
const SIZE = 24; // half-points = 12 pt
const LINE_15 = 360;
const LINE_1 = 240;
const INDENT_FIRST = 709; // 1,25 cm
const TEXT_WIDTH_PX = 529; // 14 cm pada 96 dpi (21 - 4 - 3)
const ALIGN: Record<string, (typeof AlignmentType)[keyof typeof AlignmentType]> = {
  left: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
  justify: AlignmentType.JUSTIFIED,
};

interface Ctx {
  input: DocxInput;
  listInstance: number;
  images: Map<string, ResolvedImage | null>;
}

function runs(nodes: PmNode[] | undefined, extra: { bold?: boolean } = {}): ParagraphChild[] {
  const out: ParagraphChild[] = [];
  for (const n of nodes ?? []) {
    if (n.type === 'hardBreak') {
      out.push(new TextRun({ text: '', break: 1 }));
      continue;
    }
    if (n.type !== 'text' || !n.text) continue;
    const m = new Set((n.marks ?? []).map((x) => x.type));
    out.push(
      new TextRun({
        text: n.text,
        bold: extra.bold || m.has('bold') || undefined,
        italics: m.has('italic') || undefined,
        underline: m.has('underline') ? {} : undefined,
        strike: m.has('strike') || undefined,
        superScript: m.has('superscript') || undefined,
        subScript: m.has('subscript') || undefined,
      }),
    );
  }
  return out;
}

function alignOf(n: PmNode, fallback: (typeof AlignmentType)[keyof typeof AlignmentType]) {
  const a = n.attrs?.textAlign as string | undefined;
  return (a && ALIGN[a]) || fallback;
}

function bodyParagraph(n: PmNode, opts: Partial<IParagraphOptions> = {}): Paragraph {
  return new Paragraph({
    children: runs(n.content),
    alignment: alignOf(n, AlignmentType.JUSTIFIED),
    indent: { firstLine: INDENT_FIRST, left: (Number(n.attrs?.indent) || 0) * INDENT_FIRST || undefined },
    spacing: { lineRule: LineRuleType.AUTO, line: LINE_15, after: 0 },
    ...opts,
  });
}

async function imageParagraph(n: PmNode, ctx: Ctx): Promise<Paragraph> {
  const path = n.attrs?.path as string | undefined;
  let img: ResolvedImage | null = null;
  if (path) {
    if (!ctx.images.has(path)) ctx.images.set(path, ctx.input.resolveImage ? await ctx.input.resolveImage(path).catch(() => null) : null);
    img = ctx.images.get(path) ?? null;
  }
  if (!img) {
    return new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: '[Gambar tidak dapat dimuat]', italics: true })] });
  }
  const lebar = Math.min(100, Math.max(20, Number(n.attrs?.lebar) || 100));
  const w = Math.min(TEXT_WIDTH_PX * (lebar / 100), img.width || TEXT_WIDTH_PX);
  const h = img.width ? (w * img.height) / img.width : w * 0.6;
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { lineRule: LineRuleType.AUTO, line: LINE_1, before: 120, after: 60 },
    children: [new ImageRun({ type: img.type, data: img.data, transformation: { width: Math.round(w), height: Math.round(h) } })],
  });
}

/** Penomoran daftar: jenis dari atribut daftar (1, a, A, i); tanpa atribut mengikuti tingkat (1 → a → i). */
const NUMBER_FORMATS = {
  'naskah-angka': LevelFormat.DECIMAL,
  'naskah-huruf': LevelFormat.LOWER_LETTER,
  'naskah-huruf-besar': LevelFormat.UPPER_LETTER,
  'naskah-romawi': LevelFormat.LOWER_ROMAN,
  'naskah-romawi-besar': LevelFormat.UPPER_ROMAN,
} as const;
function listReference(type: string | undefined, level: number): keyof typeof NUMBER_FORMATS {
  switch (type) {
    case 'a':
      return 'naskah-huruf';
    case 'A':
      return 'naskah-huruf-besar';
    case 'i':
      return 'naskah-romawi';
    case 'I':
      return 'naskah-romawi-besar';
    case '1':
      return 'naskah-angka';
    default:
      return (['naskah-angka', 'naskah-huruf', 'naskah-romawi'] as const)[Math.min(level, 2)];
  }
}

function listParagraphs(n: PmNode, ctx: Ctx, level: number, out: (Paragraph | Table)[], instance: number) {
  const reference = n.type === 'orderedList' ? listReference(n.attrs?.type as string | undefined, level) : 'naskah-poin';
  for (const item of n.content ?? []) {
    let first = true;
    for (const child of item.content ?? []) {
      if (child.type === 'bulletList' || child.type === 'orderedList') {
        ctx.listInstance += 1;
        listParagraphs(child, ctx, Math.min(level + 1, 2), out, ctx.listInstance);
      } else if (first) {
        out.push(
          new Paragraph({
            children: runs(child.content),
            alignment: alignOf(child, AlignmentType.JUSTIFIED),
            numbering: { reference, level, instance },
            spacing: { lineRule: LineRuleType.AUTO, line: LINE_15, after: 0 },
          }),
        );
        first = false;
      } else {
        out.push(bodyParagraph(child, { indent: { left: 720 * (level + 1) } }));
      }
    }
  }
}

function tableBlock(n: PmNode): Table {
  const border = { style: BorderStyle.SINGLE, size: 4, color: '000000' };
  const rows = (n.content ?? []).map(
    (r) =>
      new TableRow({
        tableHeader: (r.content ?? []).every((c) => c.type === 'tableHeader') || undefined,
        children: (r.content ?? []).map(
          (c) =>
            new TableCell({
              columnSpan: (c.attrs?.colspan ?? 1) > 1 ? c.attrs?.colspan : undefined,
              rowSpan: (c.attrs?.rowspan ?? 1) > 1 ? c.attrs?.rowspan : undefined,
              borders: { top: border, bottom: border, left: border, right: border },
              children: (c.content?.length ? c.content : [{ type: 'paragraph' } as PmNode]).map(
                (p) =>
                  new Paragraph({
                    children: runs(p.content, { bold: c.type === 'tableHeader' }),
                    alignment: c.type === 'tableHeader' ? AlignmentType.CENTER : alignOf(p, AlignmentType.LEFT),
                    spacing: { lineRule: LineRuleType.AUTO, line: LINE_1, before: 40, after: 40 },
                  }),
              ),
            }),
        ),
      }),
  );
  return new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } });
}

async function bodyBlocks(ctx: Ctx): Promise<(Paragraph | Table | TableOfContents)[]> {
  const { doc } = ctx.input;
  const { outline, captions } = analyze(doc);
  const nomorByIndex = new Map(outline.map((o) => [o.index, o.nomor]));
  const out: (Paragraph | Table | TableOfContents)[] = [];
  let firstBab = true;
  let breakNext = false;

  const blocks = doc.content ?? [];
  for (let i = 0; i < blocks.length; i++) {
    const n = blocks[i];
    const pageBreakBefore = breakNext || undefined;
    breakNext = false;
    switch (n.type) {
      case 'heading': {
        const level = n.attrs?.level ?? 1;
        const nomor = nomorByIndex.get(i) ?? '';
        const judul = nodeText(n).trim();
        if (level === 1) {
          const children: ParagraphChild[] = nomor
            ? [new TextRun({ text: nomor, bold: true }), new TextRun({ text: judul.toUpperCase(), bold: true, break: 1 })]
            : [new TextRun({ text: judul.toUpperCase(), bold: true })];
          out.push(
            new Paragraph({
              heading: HeadingLevel.HEADING_1,
              alignment: AlignmentType.CENTER,
              pageBreakBefore: firstBab ? undefined : true,
              spacing: { lineRule: LineRuleType.AUTO, line: LINE_15, after: 480 },
              children,
            }),
          );
          firstBab = false;
        } else {
          out.push(
            new Paragraph({
              heading: level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3,
              alignment: alignOf(n, AlignmentType.LEFT),
              pageBreakBefore,
              spacing: { lineRule: LineRuleType.AUTO, line: LINE_15, before: 240, after: 0 },
              keepNext: true,
              children: [new TextRun({ text: nomor ? `${nomor} ${judul}` : judul, bold: true })],
            }),
          );
        }
        break;
      }
      case 'paragraph': {
        const label = captions.get(i);
        if (label) {
          out.push(
            new Paragraph({
              alignment: alignOf(n, AlignmentType.CENTER),
              pageBreakBefore,
              spacing: { lineRule: LineRuleType.AUTO, line: LINE_1, before: 120, after: 240 },
              keepNext: n.attrs?.keterangan === 'tabel' || undefined,
              children: [new TextRun({ text: `${label} ` }), ...runs(n.content)],
            }),
          );
        } else {
          out.push(bodyParagraph(n, { pageBreakBefore }));
        }
        break;
      }
      case 'blockquote':
        for (const c of n.content ?? []) {
          out.push(new Paragraph({ children: runs(c.content), alignment: AlignmentType.JUSTIFIED, indent: { left: INDENT_FIRST }, spacing: { lineRule: LineRuleType.AUTO, line: LINE_1, after: 240 } }));
        }
        break;
      case 'bulletList':
      case 'orderedList': {
        ctx.listInstance += 1;
        const tmp: (Paragraph | Table)[] = [];
        listParagraphs(n, ctx, 0, tmp, ctx.listInstance);
        out.push(...tmp);
        break;
      }
      case 'table':
        out.push(tableBlock(n));
        break;
      case 'image':
        out.push(await imageParagraph(n, ctx));
        break;
      case 'pageBreak':
        breakNext = true;
        break;
      default: {
        const t = nodeText(n);
        if (t) out.push(new Paragraph({ children: [new TextRun(t)] }));
      }
    }
  }
  return out;
}

function coverPage(input: DocxInput): Paragraph[] {
  const c = (text: string, opts: { bold?: boolean; size?: number; before?: number; after?: number } = {}) =>
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { lineRule: LineRuleType.AUTO, line: LINE_1, before: opts.before ?? 0, after: opts.after ?? 0 },
      children: [new TextRun({ text, bold: opts.bold, size: opts.size })],
    });
  const out: Paragraph[] = [
    c(input.jenis.toUpperCase(), { bold: true, size: 28, after: 360 }),
    c(input.judul.toUpperCase(), { bold: true, size: 28, after: 720 }),
  ];
  if (input.logo) {
    const w = 170;
    const h = input.logo.width ? Math.round((w * input.logo.height) / input.logo.width) : w;
    out.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { lineRule: LineRuleType.AUTO, line: LINE_1, after: 720 },
        children: [new ImageRun({ type: input.logo.type, data: input.logo.data, transformation: { width: w, height: h } })],
      }),
    );
  }
  out.push(c('Disusun oleh:', { after: 120 }), c(input.nama, { bold: true }), c(`NIM ${input.nim}`, { after: 960 }));
  out.push(
    c(`PROGRAM STUDI ${input.prodi.toUpperCase()}`, { bold: true }),
    c(input.institusi.toUpperCase(), { bold: true }),
    c(String(input.tahun), { bold: true }),
  );
  return out;
}

const pageMargins = { top: '3cm', right: '3cm', bottom: '3cm', left: '4cm' } as const;
const pageSize = { width: '21cm', height: '29.7cm' } as const;

function footer() {
  return new Footer({
    children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: [PageNumber.CURRENT] })] })],
  });
}

export async function buildDocx(input: DocxInput): Promise<Document> {
  const ctx: Ctx = { input, listInstance: 0, images: new Map() };
  const body = await bodyBlocks(ctx);
  const bulletLevels = ['•', '–', '◦'].map((text, level) => ({
    level,
    format: LevelFormat.BULLET,
    text,
    alignment: AlignmentType.LEFT,
    style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
  }));
  const numberConfigs = (Object.keys(NUMBER_FORMATS) as (keyof typeof NUMBER_FORMATS)[]).map((reference) => ({
    reference,
    levels: [0, 1, 2].map((level) => ({
      level,
      format: NUMBER_FORMATS[reference],
      text: `%${level + 1}.`,
      alignment: AlignmentType.LEFT,
      style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
    })),
  }));

  return new Document({
    creator: input.nama,
    title: input.judul,
    description: `${input.jenis} ${input.nama} (${input.nim})`,
    features: { updateFields: true },
    styles: {
      default: {
        document: { run: { font: FONT, size: SIZE }, paragraph: { spacing: { lineRule: LineRuleType.AUTO, line: LINE_15 } } },
        heading1: { run: { font: FONT, size: SIZE, bold: true, color: '000000' }, paragraph: { alignment: AlignmentType.CENTER } },
        heading2: { run: { font: FONT, size: SIZE, bold: true, color: '000000' } },
        heading3: { run: { font: FONT, size: SIZE, bold: true, color: '000000' } },
      },
    },
    numbering: {
      config: [
        { reference: 'naskah-poin', levels: bulletLevels },
        ...numberConfigs,
      ],
    },
    sections: [
      {
        properties: { page: { size: pageSize, margin: pageMargins } },
        children: coverPage(input),
      },
      {
        properties: { page: { size: pageSize, margin: pageMargins, pageNumbers: { start: 1, formatType: NumberFormat.LOWER_ROMAN } } },
        footers: { default: footer() },
        children: [
          new Paragraph({ alignment: AlignmentType.CENTER, spacing: { lineRule: LineRuleType.AUTO, line: LINE_15, after: 480 }, children: [new TextRun({ text: 'DAFTAR ISI', bold: true })] }),
          new TableOfContents('Daftar Isi', { hyperlink: true, headingStyleRange: '1-3' }),
        ],
      },
      {
        properties: { page: { size: pageSize, margin: pageMargins, pageNumbers: { start: 1, formatType: NumberFormat.DECIMAL } } },
        footers: { default: footer() },
        children: body,
      },
    ],
  });
}
