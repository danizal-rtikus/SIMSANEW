/**
 * AISYS (Akal Imitasi STIKOM Yos Sudarso).
 *  Mahasiswa pemilik naskah : parafrase, susun paragraf, cari jurnal, periksa bab,
 *                             tanggapi catatan dosen, keselarasan antarbab, kerangka subbab,
 *                             tabel penelitian terdahulu, cocokkan rujukan, ejaan, abstrak,
 *                             persiapan seminar.
 *  Pembimbing / penguji     : review bab yang diajukan.
 * Setiap pemakaian dicatat di ai_usage_logs (hanya Admin yang dapat membaca).
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import { admin } from '../supabase.js';
import { requireAuth } from '../auth.js';
import { env } from '../env.js';
import { UserError } from '../users.js';
import { AiError, aiReady, chat, parseJson, type ChatResult } from '../aisys/llm.js';
import { blocksToText, clip, countWords, inlineText, normalize, sliceBab, type PmNode } from '../aisys/naskah.js';
import * as P from '../aisys/prompts.js';

export const aisysRouter = Router();
aisysRouter.use(requireAuth);

type Fitur =
  | 'parafrase'
  | 'susun'
  | 'cari_jurnal'
  | 'periksa_bab'
  | 'review_bab'
  | 'tanggapi_catatan'
  | 'keselarasan'
  | 'kerangka'
  | 'tabel_terdahulu'
  | 'cocok_rujukan'
  | 'ejaan'
  | 'abstrak'
  | 'persiapan_seminar';
type Peran = 'mahasiswa' | 'dosen';

interface ThesisRow {
  id: string;
  mahasiswa_id: string;
  prodi_id: string;
  guideline_id: string | null;
  judul: string;
  jenjang: string;
  status: string;
}

/* ------------------------------------------------------------------ */
/* Akses, batas harian, dan catatan pemakaian                          */
/* ------------------------------------------------------------------ */

async function loadThesis(id: unknown): Promise<ThesisRow> {
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) throw new UserError('Studi akhir tidak valid');
  const { data } = await admin.from('thesis').select('id, mahasiswa_id, prodi_id, guideline_id, judul, jenjang, status').eq('id', id).maybeSingle();
  if (!data) throw new UserError('Studi akhir tidak ditemukan');
  return data as ThesisRow;
}

function forbid(msg: string): never {
  const e = new UserError(msg);
  e.status = 403;
  throw e;
}

function requireOwner(t: ThesisRow, userId: string) {
  if (t.mahasiswa_id !== userId) forbid('Fitur ini hanya untuk mahasiswa pemilik naskah');
  if (t.status !== 'aktif') forbid('Studi akhir tidak aktif');
}

async function requireReviewer(t: ThesisRow, userId: string) {
  const [sup, exa, pan] = await Promise.all([
    admin.from('thesis_supervisors').select('id').eq('thesis_id', t.id).eq('dosen_id', userId).eq('aktif', true).limit(1),
    admin.from('thesis_examiners').select('id').eq('thesis_id', t.id).eq('dosen_id', userId).eq('aktif', true).limit(1),
    admin.from('exam_panel').select('id').eq('thesis_id', t.id).eq('dosen_id', userId).limit(1),
  ]);
  if (!(sup.data?.length || exa.data?.length || pan.data?.length)) forbid('Hanya pembimbing atau penguji mahasiswa ini yang dapat memakai review AISYS');
}

/** Awal hari ini menurut WIB (UTC+7), dalam ISO UTC. */
function startOfDayWib(): string {
  const now = Date.now() + 7 * 3600_000;
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  return new Date(d.getTime() - 7 * 3600_000).toISOString();
}

async function usedToday(userId: string): Promise<number> {
  const { count } = await admin.from('ai_usage_logs').select('id', { count: 'exact', head: true }).eq('user_id', userId).neq('status', 'ditolak').gte('created_at', startOfDayWib());
  return count ?? 0;
}

async function checkQuota(userId: string): Promise<number> {
  if (!env.ai.dailyLimit) return Infinity;
  const used = await usedToday(userId);
  if (used >= env.ai.dailyLimit) {
    const e = new UserError(`Batas pemakaian AISYS hari ini (${env.ai.dailyLimit} kali) sudah tercapai. Coba lagi besok.`);
    e.status = 429;
    throw e;
  }
  return env.ai.dailyLimit - used - 1;
}

async function log(row: { user_id: string; peran: Peran; thesis_id: string | null; fitur: Fitur; token_masuk?: number; token_keluar?: number; durasi_ms: number; status: 'ok' | 'gagal' | 'ditolak'; galat?: string | null; cuplikan?: string | null }) {
  const { error } = await admin.from('ai_usage_logs').insert({ model: env.ai.model, ...row, cuplikan: row.cuplikan ? row.cuplikan.replace(/\s+/g, ' ').slice(0, 200) : null });
  if (error) console.error('[AISYS log]', error.message);
}

/** Jalankan satu fitur: cek kuota, ukur waktu, jumlahkan token, catat hasil. */
async function run<T>(
  req: Request,
  meta: { peran: Peran; thesisId: string | null; fitur: Fitur; cuplikan?: string | null },
  fn: (call: typeof chat) => Promise<T>,
): Promise<T & { sisa: number | null }> {
  const userId = req.user!.id;
  const t0 = Date.now();
  let tin = 0;
  let tout = 0;
  const call: typeof chat = async (m, o) => {
    try {
      const r: ChatResult = await chat(m, o);
      tin += r.tokenMasuk;
      tout += r.tokenKeluar;
      return r;
    } catch (e) {
      if (e instanceof AiError && e.usage) {
        tin += e.usage.tokenMasuk;
        tout += e.usage.tokenKeluar;
      }
      throw e;
    }
  };
  let sisa: number;
  try {
    sisa = await checkQuota(userId);
  } catch (e) {
    await log({ user_id: userId, peran: meta.peran, thesis_id: meta.thesisId, fitur: meta.fitur, durasi_ms: 0, status: 'ditolak', galat: (e as Error).message, cuplikan: meta.cuplikan });
    throw e;
  }
  try {
    const out = await fn(call);
    await log({ user_id: userId, peran: meta.peran, thesis_id: meta.thesisId, fitur: meta.fitur, token_masuk: tin, token_keluar: tout, durasi_ms: Date.now() - t0, status: 'ok', cuplikan: meta.cuplikan });
    return { ...out, sisa: Number.isFinite(sisa) ? sisa : null };
  } catch (e) {
    await log({ user_id: userId, peran: meta.peran, thesis_id: meta.thesisId, fitur: meta.fitur, token_masuk: tin, token_keluar: tout, durasi_ms: Date.now() - t0, status: 'gagal', galat: (e as Error).message.slice(0, 300), cuplikan: meta.cuplikan });
    throw e;
  }
}

type Handler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;
const wrap = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => fn(req, res, next).catch(next);

function str(v: unknown, max: number, name: string, min = 1): string {
  const s = typeof v === 'string' ? v.trim() : '';
  if (s.length < min) throw new UserError(`${name} masih kosong`);
  if (s.length > max) throw new UserError(`${name} terlalu panjang (maksimal ${max.toLocaleString('id-ID')} karakter)`);
  return s;
}

/* ------------------------------------------------------------------ */
/* Status                                                              */
/* ------------------------------------------------------------------ */

aisysRouter.get(
  '/status',
  wrap(async (req, res) => {
    const used = await usedToday(req.user!.id);
    res.json({ aktif: aiReady(), batas: env.ai.dailyLimit || null, terpakai: used, sisa: env.ai.dailyLimit ? Math.max(0, env.ai.dailyLimit - used) : null });
  }),
);

/* ------------------------------------------------------------------ */
/* Mahasiswa: parafrase dan susun paragraf                             */
/* ------------------------------------------------------------------ */

aisysRouter.post(
  '/parafrase',
  wrap(async (req, res) => {
    const t = await loadThesis(req.body?.thesis_id);
    requireOwner(t, req.user!.id);
    const teks = str(req.body?.teks, 2500, 'Teks', 20);
    const gaya = P.GAYA_PARAFRASE[String(req.body?.gaya)] ? String(req.body.gaya) : 'akademik';
    const out = await run(req, { peran: 'mahasiswa', thesisId: t.id, fitur: 'parafrase', cuplikan: teks }, async (call) => {
      const r = await call(
        [
          { role: 'system', content: P.PARAFRASE },
          { role: 'user', content: `Gaya: ${P.GAYA_PARAFRASE[gaya]}\n\nTeks:\n${teks}` },
        ],
        { json: true, temperature: 0.7, maxTokens: 4000 },
      );
      const j = parseJson<{ hasil?: unknown }>(r.text);
      const hasil = (Array.isArray(j.hasil) ? j.hasil : [j.hasil]).filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((x) => x.trim()).slice(0, 3);
      if (!hasil.length) throw new AiError('AISYS tidak menghasilkan parafrase. Coba lagi.');
      return { hasil };
    });
    res.json(out);
  }),
);

aisysRouter.post(
  '/susun',
  wrap(async (req, res) => {
    const t = await loadThesis(req.body?.thesis_id);
    requireOwner(t, req.user!.id);
    const poin = str(req.body?.poin, 2500, 'Poin atau kalimat kasar', 10);
    const k = (req.body?.konteks ?? {}) as { bab?: string; subbab?: string; sebelum?: string };
    const konteks = [
      `Judul penelitian: ${t.judul}`,
      k.bab ? `Bab: ${String(k.bab).slice(0, 120)}` : '',
      k.subbab ? `Subbab: ${String(k.subbab).slice(0, 160)}` : '',
      k.sebelum ? `Paragraf sebelumnya:\n${String(k.sebelum).slice(0, 1200)}` : '',
    ]
      .filter(Boolean)
      .join('\n');
    const out = await run(req, { peran: 'mahasiswa', thesisId: t.id, fitur: 'susun', cuplikan: poin }, async (call) => {
      const r = await call(
        [
          { role: 'system', content: P.SUSUN },
          { role: 'user', content: `${konteks}\n\nPoin yang dikembangkan:\n${poin}` },
        ],
        { json: true, temperature: 0.6, maxTokens: 4000 },
      );
      const j = parseJson<{ hasil?: unknown }>(r.text);
      const hasil = typeof j.hasil === 'string' ? j.hasil.trim() : Array.isArray(j.hasil) ? j.hasil.filter((x) => typeof x === 'string').join('\n\n') : '';
      if (!hasil) throw new AiError('AISYS tidak menghasilkan paragraf. Coba lagi.');
      return { hasil };
    });
    res.json(out);
  }),
);

/* ------------------------------------------------------------------ */
/* Mahasiswa: cari jurnal relevan (DOI asli dari Crossref)             */
/* ------------------------------------------------------------------ */

interface CrWork {
  DOI?: string;
  type?: string;
  title?: string[];
  subtitle?: string[];
  author?: { given?: string; family?: string; name?: string }[];
  'container-title'?: string[];
  issued?: { 'date-parts'?: (number | null)[][] };
  abstract?: string;
  [k: string]: unknown;
}

const CR_FIELDS = 'DOI,type,title,subtitle,author,editor,container-title,issued,published-print,published-online,volume,issue,page,publisher,ISBN,ISSN,abstract';
const CR_TYPES = new Set(['journal-article', 'proceedings-article', 'book-chapter', 'book', 'monograph', 'posted-content', 'report']);

async function crossref(q: string): Promise<CrWork[]> {
  const url = `https://api.crossref.org/works?query.bibliographic=${encodeURIComponent(q)}&rows=12&select=${CR_FIELDS}&mailto=simsa@stikomyos.ac.id`;
  const ctl = new AbortController();
  const tm = setTimeout(() => ctl.abort(), 15000);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { 'User-Agent': 'SIMSA/1.0 (mailto:simsa@stikomyos.ac.id)' } });
    if (!r.ok) return [];
    const j = (await r.json()) as { message?: { items?: CrWork[] } };
    return j.message?.items ?? [];
  } catch {
    return [];
  } finally {
    clearTimeout(tm);
  }
}

const yearOf = (w: CrWork) => w.issued?.['date-parts']?.[0]?.[0] ?? null;

aisysRouter.post(
  '/cari-jurnal',
  wrap(async (req, res) => {
    const t = await loadThesis(req.body?.thesis_id);
    requireOwner(t, req.user!.id);
    const topik = str(req.body?.topik, 1500, 'Topik', 5);
    const out = await run(req, { peran: 'mahasiswa', thesisId: t.id, fitur: 'cari_jurnal', cuplikan: topik }, async (call) => {
      const r1 = await call(
        [
          { role: 'system', content: P.KUERI_JURNAL },
          { role: 'user', content: `Judul penelitian: ${t.judul}\n\nTopik yang dicari:\n${topik}` },
        ],
        { json: true, temperature: 0.3, maxTokens: 2000 },
      );
      const kueri = (parseJson<{ kueri?: unknown }>(r1.text).kueri as unknown[] | undefined ?? [])
        .filter((x): x is string => typeof x === 'string' && x.trim().length > 2)
        .map((x) => x.trim())
        .slice(0, 3);
      if (!kueri.length) kueri.push(topik.slice(0, 120));

      const lists = await Promise.all(kueri.map(crossref));
      const seen = new Set<string>();
      const now = new Date().getFullYear();
      const cand: CrWork[] = [];
      for (let i = 0; i < 12; i++) {
        for (const l of lists) {
          const w = l[i];
          if (!w?.DOI || !w.title?.[0] || !CR_TYPES.has(w.type ?? '')) continue;
          const k = w.DOI.toLowerCase();
          if (seen.has(k)) continue;
          seen.add(k);
          cand.push(w);
        }
      }
      // Utamakan terbitan 10 tahun terakhir, lalu batasi 24 kandidat.
      cand.sort((a, b) => Number((yearOf(b) ?? 0) >= now - 10) - Number((yearOf(a) ?? 0) >= now - 10));
      const pool = cand.slice(0, 24);
      if (!pool.length) return { kueri, items: [] as { work: CrWork; alasan: string }[] };

      const daftar = pool
        .map((w, i) => {
          const abs = (w.abstract ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 280);
          return `${i + 1}. ${w.title![0].replace(/<[^>]+>/g, '')} (${yearOf(w) ?? 't.t.'}; ${w['container-title']?.[0] ?? w.type})${abs ? `\n   Abstrak: ${abs}` : ''}`;
        })
        .join('\n');
      const r2 = await call(
        [
          { role: 'system', content: P.PILIH_JURNAL },
          { role: 'user', content: `Judul penelitian: ${t.judul}\nTopik: ${topik}\n\nDaftar hasil pencarian:\n${daftar}` },
        ],
        { json: true, temperature: 0.2, maxTokens: 4000, timeoutMs: 90000 },
      );
      const pilihan = (parseJson<{ pilihan?: { no?: unknown; alasan?: unknown }[] }>(r2.text).pilihan ?? [])
        .map((p) => ({ i: Number(p.no) - 1, alasan: typeof p.alasan === 'string' ? p.alasan.trim() : '' }))
        .filter((p) => Number.isInteger(p.i) && p.i >= 0 && p.i < pool.length);
      const used = new Set<number>();
      const items = pilihan
        .filter((p) => (used.has(p.i) ? false : (used.add(p.i), true)))
        .slice(0, 8)
        .map((p) => {
          const { abstract: _a, ...work } = pool[p.i];
          return { work, alasan: p.alasan };
        });
      return { kueri, items };
    });
    res.json(out);
  }),
);

/* ------------------------------------------------------------------ */
/* Periksa bab (mahasiswa) dan review bab (dosen)                      */
/* ------------------------------------------------------------------ */

interface Temuan {
  kategori: string;
  tingkat: 'penting' | 'saran';
  kutipan: string;
  masalah: string;
  saran: string;
}

async function citeLabeler(thesisId: string): Promise<(ids: string[]) => string> {
  const { data } = await admin.from('thesis_references').select('id, csl').eq('thesis_id', thesisId);
  const map = new Map<string, string>();
  for (const r of (data ?? []) as { id: string; csl: { author?: { family?: string; literal?: string }[]; issued?: { 'date-parts'?: unknown[][] }; title?: string } }[]) {
    const a = r.csl.author?.[0];
    const who = a?.family || a?.literal || (r.csl.title ?? '').split(/\s+/).slice(0, 3).join(' ') || 'rujukan';
    const y = r.csl.issued?.['date-parts']?.[0]?.[0] ?? 't.t.';
    map.set(r.id, `${who}${(r.csl.author?.length ?? 0) > 2 ? ' et al.' : ''} ${y}`);
  }
  return (ids) => `[sitasi: ${ids.map((id) => map.get(id) ?? 'rujukan dihapus').join('; ')}]`;
}

async function pedoman(t: ThesisRow, bab: number, judulBab: string): Promise<string> {
  let gid = t.guideline_id;
  if (!gid) {
    const { data } = await admin.from('guidelines').select('id').eq('prodi_id', t.prodi_id).eq('aktif', true).order('berlaku_mulai', { ascending: false }).limit(1).maybeSingle();
    gid = (data as { id: string } | null)?.id ?? null;
  }
  if (!gid) return '';
  const { data } = await admin.from('guideline_sections').select('nomor, judul, isi, kategori').eq('guideline_id', gid).in('kategori', ['sistematika', 'aturan']).order('urutan');
  const rows = (data ?? []) as { nomor: string | null; judul: string; isi: string; kategori: string }[];
  const kata = judulBab.toLowerCase().split(/\s+/).filter((w) => w.length > 4);
  const babRe = new RegExp(`\\bbab\\s*(${bab}|${['', 'i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii'][bab] ?? '#'})\\b`, 'i');
  const relevan = rows.filter((r) => r.kategori === 'sistematika' && (babRe.test(r.judul) || kata.some((w) => r.judul.toLowerCase().includes(w))));
  const aturan = rows.filter((r) => r.kategori === 'aturan' && /sitasi|kutip|rujuk|pustaka|bahasa|istilah/i.test(`${r.judul} ${r.isi}`));
  const all = [...relevan, ...aturan];
  if (!all.length) return '';
  return clip(all.map((r) => `${r.nomor ? `${r.nomor} ` : ''}${r.judul}: ${r.isi}`).join('\n'), 5000);
}

/** Saring temuan: kutipan harus benar-benar ada di teks bab (tanpa penanda sitasi). */
function cleanTemuan(raw: unknown, plain: string): Temuan[] {
  const hay = normalize(plain);
  const list = Array.isArray(raw) ? raw : [];
  const out: Temuan[] = [];
  for (const x of list as Record<string, unknown>[]) {
    const masalah = typeof x.masalah === 'string' ? x.masalah.trim() : '';
    const saran = typeof x.saran === 'string' ? x.saran.trim() : '';
    if (!masalah && !saran) continue;
    let kutipan = typeof x.kutipan === 'string' ? x.kutipan.replace(/\[sitasi:[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim() : '';
    if (kutipan && !hay.includes(normalize(kutipan))) {
      // Coba potongan awal kutipan (model kadang menambah kata di akhir).
      const words = kutipan.split(' ');
      let ok = '';
      for (let n = words.length - 1; n >= 5; n--) {
        const part = words.slice(0, n).join(' ');
        if (hay.includes(normalize(part))) {
          ok = part;
          break;
        }
      }
      kutipan = ok;
    }
    out.push({
      kategori: typeof x.kategori === 'string' ? x.kategori : 'isi',
      tingkat: x.tingkat === 'penting' ? 'penting' : 'saran',
      kutipan,
      masalah,
      saran,
    });
  }
  return out.slice(0, 12);
}

async function analyzeBab(call: typeof chat, system: string, t: ThesisRow, blocks: PmNode[], bab: number) {
  const cite = await citeLabeler(t.id);
  const withCite = blocksToText(blocks, bab, cite);
  const plain = blocksToText(blocks, bab);
  const judulBab = inlineText(blocks[0] ?? { type: 'text' }).trim();
  if (countWords(plain) < 60) throw new UserError('Isi bab masih terlalu sedikit untuk diperiksa (minimal sekitar 60 kata).');
  const ped = await pedoman(t, bab, judulBab);
  const user = [
    `Jenjang: ${t.jenjang}. Judul penelitian: ${t.judul}`,
    ped ? `Ketentuan pedoman prodi yang relevan:\n${ped}` : 'Pedoman prodi untuk bab ini tidak tersedia; gunakan kelaziman penulisan skripsi di Indonesia.',
    `Teks Bab ${bab}:\n${clip(withCite, 24000)}`,
  ].join('\n\n');
  type Out = { ringkasan?: unknown; kekuatan?: unknown; temuan?: unknown };
  const ask = async (extra: string, maxTokens: number): Promise<Out> => {
    const r = await call(
      [
        { role: 'system', content: system + extra },
        { role: 'user', content: user },
      ],
      { json: true, temperature: 0.3, maxTokens, timeoutMs: 110000 },
    );
    return parseJson<Out>(r.text);
  };
  let j: Out;
  try {
    j = await ask('', 8000);
  } catch (e) {
    // Jawaban kosong, terpotong, atau tidak terbaca: ulangi sekali dengan keluaran lebih ringkas.
    if (!(e instanceof AiError) || e.status === 503 || e.status === 429 || e.status === 504) throw e;
    j = await ask('\n\nPENTING: jawab ringkas. Paling banyak 6 temuan, setiap bidang paling banyak 30 kata. Langsung keluarkan objek JSON saja.', 8000);
  }
  return {
    bab,
    judul: judulBab,
    kata: countWords(plain),
    ringkasan: typeof j.ringkasan === 'string' ? j.ringkasan.trim() : '',
    kekuatan: (Array.isArray(j.kekuatan) ? j.kekuatan : []).filter((x): x is string => typeof x === 'string').slice(0, 3),
    temuan: cleanTemuan(j.temuan, plain),
    pedoman: !!ped,
  };
}

aisysRouter.post(
  '/periksa-bab',
  wrap(async (req, res) => {
    const t = await loadThesis(req.body?.thesis_id);
    requireOwner(t, req.user!.id);
    const bab = Number(req.body?.bab);
    if (!Number.isInteger(bab) || bab < 1 || bab > 20) throw new UserError('Nomor bab tidak valid');
    const { data } = await admin.from('thesis_manuscripts').select('konten').eq('thesis_id', t.id).maybeSingle();
    const blocks = sliceBab((data as { konten: PmNode } | null)?.konten, bab);
    if (!blocks) throw new UserError(`Bab ${bab} tidak ditemukan di naskah tersimpan`);
    const out = await run(req, { peran: 'mahasiswa', thesisId: t.id, fitur: 'periksa_bab', cuplikan: `Bab ${bab}` }, (call) => analyzeBab(call, P.PERIKSA_BAB, t, blocks, bab));
    res.json(out);
  }),
);

aisysRouter.post(
  '/review-bab',
  wrap(async (req, res) => {
    const sid = req.body?.submission_id;
    if (typeof sid !== 'string' || !/^[0-9a-f-]{36}$/i.test(sid)) throw new UserError('Pengajuan tidak valid');
    const { data: sub } = await admin.from('chapter_submissions').select('id, thesis_id, bab, nomor, konten').eq('id', sid).maybeSingle();
    if (!sub) throw new UserError('Pengajuan tidak ditemukan');
    const s = sub as { id: string; thesis_id: string; bab: number; nomor: number; konten: PmNode };
    const t = await loadThesis(s.thesis_id);
    await requireReviewer(t, req.user!.id);
    const out = await run(req, { peran: 'dosen', thesisId: t.id, fitur: 'review_bab', cuplikan: `Bab ${s.bab}, pengajuan ke-${s.nomor}` }, (call) => analyzeBab(call, P.REVIEW_BAB, t, s.konten?.content ?? [], s.bab));
    res.json(out);
  }),
);

/* ------------------------------------------------------------------ */
/* Peneliti senior: fitur lanjutan untuk mahasiswa                     */
/* ------------------------------------------------------------------ */

interface BabText {
  bab: number;
  judul: string;
  blocks: PmNode[];
  plain: string;
}

async function loadManuscript(t: ThesisRow): Promise<PmNode | null> {
  const { data } = await admin.from('thesis_manuscripts').select('konten').eq('thesis_id', t.id).maybeSingle();
  return (data as { konten: PmNode } | null)?.konten ?? null;
}

/** Semua bab bernomor yang ada di naskah tersimpan. */
function allBabs(doc: PmNode | null): BabText[] {
  const out: BabText[] = [];
  for (let b = 1; b <= 20; b++) {
    const blocks = sliceBab(doc, b);
    if (!blocks) break;
    out.push({ bab: b, judul: inlineText(blocks[0] ?? { type: 'text' }).trim(), blocks, plain: blocksToText(blocks, b) });
  }
  return out;
}

/** Gabungkan teks beberapa bab dengan anggaran karakter per bab. */
function babsText(babs: BabText[], budget: number, cite?: (ids: string[]) => string): string {
  const per = Math.max(2500, Math.floor(budget / Math.max(1, babs.length)));
  return babs.map((b) => clip(cite ? blocksToText(b.blocks, b.bab, cite) : b.plain, per)).join('\n\n');
}

function babParam(v: unknown): number {
  const bab = Number(v);
  if (!Number.isInteger(bab) || bab < 1 || bab > 20) throw new UserError('Nomor bab tidak valid');
  return bab;
}

/** Minta JSON; bila jawaban kosong, terpotong, atau tidak terbaca, ulangi sekali dengan instruksi ringkas. */
async function askJson<T>(call: typeof chat, system: string, user: string, o: { maxTokens: number; temperature?: number; ringkas: string }): Promise<T> {
  const ask = async (extra: string) => {
    const r = await call(
      [
        { role: 'system', content: system + extra },
        { role: 'user', content: user },
      ],
      { json: true, temperature: o.temperature ?? 0.3, maxTokens: o.maxTokens, timeoutMs: 110000 },
    );
    return parseJson<T>(r.text);
  };
  try {
    return await ask('');
  } catch (e) {
    if (!(e instanceof AiError) || e.status === 503 || e.status === 429 || e.status === 504) throw e;
    return ask(`\n\nPENTING: jawab ringkas. ${o.ringkas} Langsung keluarkan objek JSON saja.`);
  }
}

const s = (v: unknown, max = 600) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const arr = (v: unknown, max: number, len = 400) =>
  (Array.isArray(v) ? v : [])
    .map((x) => s(x, len))
    .filter(Boolean)
    .slice(0, max);

/** Kutipan harus ada di teks; kembalikan potongan yang benar-benar ada atau string kosong. */
function verifyQuote(kutipan: string, hay: string): string {
  let k = kutipan.replace(/\[sitasi:[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!k) return '';
  if (hay.includes(normalize(k))) return k;
  const words = k.split(' ');
  for (let n = words.length - 1; n >= 5; n--) {
    const part = words.slice(0, n).join(' ');
    if (hay.includes(normalize(part))) return part;
  }
  for (let st = 1; st <= words.length - 5; st++) {
    const part = words.slice(st).join(' ');
    if (hay.includes(normalize(part))) return part;
  }
  k = '';
  return k;
}

/* 1. Tanggapi catatan dosen ------------------------------------------- */

aisysRouter.post(
  '/tanggapi-catatan',
  wrap(async (req, res) => {
    const t = await loadThesis(req.body?.thesis_id);
    requireOwner(t, req.user!.id);
    const cid = req.body?.comment_id;
    if (typeof cid !== 'string' || !/^[0-9a-f-]{36}$/i.test(cid)) throw new UserError('Catatan tidak valid');
    const { data: c } = await admin.from('review_comments').select('id, thesis_id, bab, isi, kutipan, penulis_id, parent_id, terkirim').eq('id', cid).maybeSingle();
    const cm = c as { id: string; thesis_id: string; bab: number; isi: string; kutipan: string | null; penulis_id: string; parent_id: string | null; terkirim: boolean } | null;
    if (!cm || cm.thesis_id !== t.id || cm.parent_id || !cm.terkirim) throw new UserError('Catatan dosen tidak ditemukan');
    const [{ data: replies }, { data: sup }, doc] = await Promise.all([
      admin.from('review_comments').select('isi, penulis_id, created_at').eq('parent_id', cm.id).order('created_at'),
      admin.from('thesis_supervisors').select('dosen_id, peran').eq('thesis_id', t.id).eq('aktif', true),
      loadManuscript(t),
    ]);
    const peran = new Map(((sup ?? []) as { dosen_id: string; peran: string }[]).map((x) => [x.dosen_id, x.peran]));
    const who = (id: string) => (id === t.mahasiswa_id ? 'Mahasiswa' : peran.get(id) === 'P1' ? 'Pembimbing 1' : peran.get(id) === 'P2' ? 'Pembimbing 2' : 'Dosen');
    const blocks = sliceBab(doc, cm.bab);
    const babText = blocks ? blocksToText(blocks, cm.bab) : '';
    // Paragraf yang memuat kutipan (bila masih ada di naskah).
    let paragraf = '';
    if (cm.kutipan) {
      const k = normalize(cm.kutipan);
      paragraf = babText.split('\n').find((l) => normalize(l).includes(k)) ?? '';
      if (!paragraf) {
        const head = normalize(cm.kutipan.split(/\s+/).slice(0, 6).join(' '));
        paragraf = babText.split('\n').find((l) => normalize(l).includes(head)) ?? '';
      }
    }
    const user = [
      `Jenjang: ${t.jenjang}. Judul penelitian: ${t.judul}`,
      `Catatan ${who(cm.penulis_id)} pada Bab ${cm.bab}:\n${cm.isi}`,
      cm.kutipan ? `Teks yang dikomentari:\n"${cm.kutipan}"` : 'Catatan berlaku umum untuk bab ini.',
      paragraf ? `Paragraf terkait di naskah saat ini:\n${paragraf}` : cm.kutipan ? 'Teks yang dikomentari sudah tidak ditemukan di naskah saat ini (mungkin sudah diubah).' : '',
      ((replies ?? []) as { isi: string; penulis_id: string }[]).length
        ? `Percakapan lanjutan:\n${((replies ?? []) as { isi: string; penulis_id: string }[]).map((r) => `${who(r.penulis_id)}: ${r.isi}`).join('\n')}`
        : '',
      babText ? `Konteks Bab ${cm.bab} (dipotong):\n${clip(babText, 9000)}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');
    const out = await run(req, { peran: 'mahasiswa', thesisId: t.id, fitur: 'tanggapi_catatan', cuplikan: cm.isi }, async (call) => {
      const j = await askJson<{ maksud?: unknown; langkah?: unknown; contoh?: unknown; balasan?: unknown }>(call, P.TANGGAPI_CATATAN, user, {
        maxTokens: 5000,
        temperature: 0.4,
        ringkas: 'Paling banyak 4 langkah; contoh revisi paling banyak 120 kata.',
      });
      const maksud = s(j.maksud);
      if (!maksud) throw new AiError('AISYS tidak dapat menafsirkan catatan ini. Coba lagi.');
      return { maksud, langkah: arr(j.langkah, 5), contoh: s(j.contoh, 2500), balasan: s(j.balasan, 800), paragraf, bab: cm.bab };
    });
    res.json(out);
  }),
);

/* 2. Keselarasan antarbab ---------------------------------------------- */

aisysRouter.post(
  '/keselarasan',
  wrap(async (req, res) => {
    const t = await loadThesis(req.body?.thesis_id);
    requireOwner(t, req.user!.id);
    const babs = allBabs(await loadManuscript(t)).filter((b) => countWords(b.plain) > 15);
    const total = babs.reduce((n, b) => n + countWords(b.plain), 0);
    if (!babs.length || total < 150) throw new UserError('Naskah masih terlalu sedikit untuk diperiksa keselarasannya (minimal sekitar 150 kata, termasuk Bab 1).');
    const user = [
      `Jenjang: ${t.jenjang}. Judul penelitian: ${t.judul}`,
      `Bab yang tersedia: ${babs.map((b) => `Bab ${b.bab} ${b.judul}`).join('; ')}`,
      `Teks naskah:\n${babsText(babs, 30000)}`,
    ].join('\n\n');
    const out = await run(req, { peran: 'mahasiswa', thesisId: t.id, fitur: 'keselarasan', cuplikan: `${babs.length} bab, ${total} kata` }, async (call) => {
      const j = await askJson<{ ringkasan?: unknown; butir?: unknown; temuan?: unknown }>(call, P.KESELARASAN, user, {
        maxTokens: 8000,
        ringkas: 'Paling banyak 5 butir dan 5 temuan; setiap sel paling banyak 12 kata.',
      });
      const butir = (Array.isArray(j.butir) ? j.butir : []).slice(0, 8).map((x: Record<string, unknown>) => ({
        rumusan: s(x.rumusan, 300),
        tujuan: s(x.tujuan, 300),
        metode: s(x.metode, 300),
        hasil: s(x.hasil, 300),
        kesimpulan: s(x.kesimpulan, 300),
        status: x.status === 'selaras' || x.status === 'tidak' ? (x.status as string) : 'sebagian',
        catatan: s(x.catatan, 400),
      }));
      const byBab = new Map(babs.map((b) => [b.bab, normalize(b.plain)]));
      const temuan = (Array.isArray(j.temuan) ? j.temuan : []).slice(0, 10).flatMap((x: Record<string, unknown>) => {
        const masalah = s(x.masalah);
        const saran = s(x.saran);
        if (!masalah && !saran) return [];
        let bab = Number(x.bab);
        let kutipan = s(x.kutipan, 400);
        if (kutipan) {
          const own = byBab.get(bab);
          const ok = own ? verifyQuote(kutipan, own) : '';
          if (ok) kutipan = ok;
          else {
            // Model kadang salah menyebut nomor bab: cari di bab lain.
            const other = babs.find((b) => verifyQuote(kutipan, normalize(b.plain)));
            kutipan = other ? verifyQuote(kutipan, normalize(other.plain)) : '';
            if (other) bab = other.bab;
          }
        }
        if (!byBab.has(bab)) bab = babs[0].bab;
        return [{ bab, kategori: s(x.kategori, 20) || 'isi', tingkat: x.tingkat === 'penting' ? 'penting' : 'saran', kutipan, masalah, saran }];
      });
      return { ringkasan: s(j.ringkasan, 800), butir, temuan, bab: babs.map((b) => ({ bab: b.bab, judul: b.judul, kata: countWords(b.plain) })) };
    });
    res.json(out);
  }),
);

/* 3. Kerangka subbab ----------------------------------------------------- */

aisysRouter.post(
  '/kerangka',
  wrap(async (req, res) => {
    const t = await loadThesis(req.body?.thesis_id);
    requireOwner(t, req.user!.id);
    const bab = babParam(req.body?.bab);
    const catatan = typeof req.body?.catatan === 'string' ? req.body.catatan.trim().slice(0, 600) : '';
    const doc = await loadManuscript(t);
    const babs = allBabs(doc);
    const cur = babs.find((b) => b.bab === bab);
    if (!cur) throw new UserError(`Bab ${bab} tidak ditemukan di naskah tersimpan. Tambahkan judul bab terlebih dahulu.`);
    const heads = cur.blocks.filter((b) => b.type === 'heading' && Number(b.attrs?.level ?? 1) > 1).map((b) => `${Number(b.attrs?.level) === 2 ? '-' : '  -'} ${inlineText(b).trim()}`);
    const ped = await pedoman(t, bab, cur.judul);
    const bab1 = bab !== 1 ? babs.find((b) => b.bab === 1) : undefined;
    const user = [
      `Jenjang: ${t.jenjang}. Judul penelitian: ${t.judul}`,
      `Bab yang disusun: Bab ${bab} ${cur.judul}`,
      `Daftar bab naskah: ${babs.map((b) => `Bab ${b.bab} ${b.judul}`).join('; ')}`,
      ped ? `Ketentuan pedoman prodi yang relevan:\n${ped}` : 'Pedoman prodi untuk bab ini tidak tersedia.',
      heads.length ? `Subbab yang sudah ditulis mahasiswa:\n${heads.join('\n')}` : 'Bab ini belum memiliki subbab.',
      bab1 && countWords(bab1.plain) > 40 ? `Ringkasan Bab 1 (konteks penelitian):\n${clip(bab1.plain, 3500)}` : '',
      countWords(cur.plain) > 40 ? `Isi bab saat ini (dipotong):\n${clip(cur.plain, 4000)}` : '',
      catatan ? `Catatan mahasiswa: ${catatan}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');
    const out = await run(req, { peran: 'mahasiswa', thesisId: t.id, fitur: 'kerangka', cuplikan: `Bab ${bab} ${cur.judul}` }, async (call) => {
      const j = await askJson<{ subbab?: unknown; catatan?: unknown }>(call, P.KERANGKA, user, { maxTokens: 5000, temperature: 0.4, ringkas: 'Paling banyak 8 subbab, 2 butir panduan per subbab.' });
      const existing = new Set(cur.blocks.filter((b) => b.type === 'heading' && Number(b.attrs?.level ?? 1) > 1).map((b) => normalize(inlineText(b))));
      const clean = (x: Record<string, unknown>) => ({ judul: s(x.judul, 160).replace(/^\d+(\.\d+)*\.?\s*/, ''), panduan: arr(x.panduan, 4, 300) });
      const subbab = (Array.isArray(j.subbab) ? j.subbab : [])
        .slice(0, 10)
        .map((x: Record<string, unknown>) => ({
          ...clean(x),
          anak: (Array.isArray(x.anak) ? x.anak : []).slice(0, 8).map(clean).filter((a: { judul: string }) => a.judul),
        }))
        .filter((x) => x.judul)
        .map((x) => ({ ...x, ada: existing.has(normalize(x.judul)) }));
      if (!subbab.length) throw new AiError('AISYS tidak menghasilkan kerangka. Coba lagi.');
      return { bab, judul: cur.judul, subbab, catatan: s(j.catatan, 600), pedoman: !!ped };
    });
    res.json(out);
  }),
);

/* 4. Tabel penelitian terdahulu ---------------------------------------- */

interface Csl {
  title?: string;
  author?: { family?: string; given?: string; literal?: string }[];
  issued?: { 'date-parts'?: (number | null)[][] };
  'container-title'?: string;
  abstract?: string;
  DOI?: string;
}

async function crossrefAbstract(doi: string): Promise<string> {
  const ctl = new AbortController();
  const tm = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}?mailto=simsa@stikomyos.ac.id`, { signal: ctl.signal, headers: { 'User-Agent': 'SIMSA/1.0 (mailto:simsa@stikomyos.ac.id)' } });
    if (!r.ok) return '';
    const j = (await r.json()) as { message?: { abstract?: string } };
    return (j.message?.abstract ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  } catch {
    return '';
  } finally {
    clearTimeout(tm);
  }
}

const cslAuthors = (c: Csl) => {
  const a = (c.author ?? []).map((x) => x.family || x.literal || '').filter(Boolean);
  return a.length > 2 ? `${a[0]} et al.` : a.join(' & ') || 'Tanpa penulis';
};
const cslYear = (c: Csl) => c.issued?.['date-parts']?.[0]?.[0] ?? null;

aisysRouter.post(
  '/tabel-terdahulu',
  wrap(async (req, res) => {
    const t = await loadThesis(req.body?.thesis_id);
    requireOwner(t, req.user!.id);
    const ids = (Array.isArray(req.body?.ref_ids) ? req.body.ref_ids : []).filter((x: unknown): x is string => typeof x === 'string' && /^[0-9a-f-]{36}$/i.test(x));
    if (ids.length < 1) throw new UserError('Pilih minimal satu rujukan');
    if (ids.length > 10) throw new UserError('Pilih paling banyak 10 rujukan sekaligus');
    const [{ data: rows }, doc] = await Promise.all([admin.from('thesis_references').select('id, csl, doi').eq('thesis_id', t.id).in('id', ids), loadManuscript(t)]);
    const refs = ((rows ?? []) as { id: string; csl: Csl; doi: string | null }[]).sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
    if (!refs.length) throw new UserError('Rujukan tidak ditemukan di pustaka');
    // Lengkapi abstrak dari Crossref bila belum tersimpan.
    const abstracts = await Promise.all(
      refs.map(async (r) => {
        const own = (r.csl.abstract ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        if (own.length > 80) return own;
        const doi = r.doi || r.csl.DOI;
        return doi ? crossrefAbstract(doi) : '';
      }),
    );
    const babs = allBabs(doc);
    const ringkas = [babs.find((b) => b.bab === 1), babs.find((b) => /metod/i.test(b.judul))].filter(Boolean) as BabText[];
    const user = [
      `Judul penelitian mahasiswa: ${t.judul}`,
      ringkas.length ? `Ringkasan penelitian mahasiswa (dari naskah):\n${ringkas.map((b) => clip(b.plain, 3000)).join('\n\n')}` : 'Naskah mahasiswa belum memuat Bab 1; tentukan perbedaan dari judul saja.',
      `Rujukan:\n${refs
        .map((r, i) => `${i + 1}. ${cslAuthors(r.csl)} (${cslYear(r.csl) ?? 't.t.'}). ${r.csl.title ?? ''}. ${r.csl['container-title'] ?? ''}\n   Abstrak: ${abstracts[i] ? clip(abstracts[i], 1600) : '(tidak tersedia)'}`)
        .join('\n')}`,
    ].join('\n\n');
    const out = await run(req, { peran: 'mahasiswa', thesisId: t.id, fitur: 'tabel_terdahulu', cuplikan: `${refs.length} rujukan` }, async (call) => {
      const j = await askJson<{ baris?: unknown; posisi?: unknown }>(call, P.TABEL_TERDAHULU, user, { maxTokens: 6000, temperature: 0.2, ringkas: 'Setiap sel paling banyak 12 kata.' });
      const got = new Map<number, Record<string, unknown>>();
      for (const x of (Array.isArray(j.baris) ? j.baris : []) as Record<string, unknown>[]) got.set(Number(x.no), x);
      const baris = refs.map((r, i) => {
        const x = got.get(i + 1) ?? {};
        return {
          id: r.id,
          penulis: cslAuthors(r.csl),
          tahun: cslYear(r.csl),
          judul: (r.csl.title ?? '').replace(/<[^>]+>/g, ''),
          tujuan: s(x.tujuan, 300),
          metode: s(x.metode, 300),
          hasil: s(x.hasil, 400),
          perbedaan: s(x.perbedaan, 400),
          abstrak: !!abstracts[i],
        };
      });
      return { baris, posisi: s(j.posisi, 600) };
    });
    res.json(out);
  }),
);

/* 5. Cocokkan rujukan ---------------------------------------------------- */

aisysRouter.post(
  '/cocok-rujukan',
  wrap(async (req, res) => {
    const t = await loadThesis(req.body?.thesis_id);
    requireOwner(t, req.user!.id);
    const bab = babParam(req.body?.bab);
    const [doc, { data: rows }] = await Promise.all([loadManuscript(t), admin.from('thesis_references').select('id, csl').eq('thesis_id', t.id).order('created_at').limit(120)]);
    const blocks = sliceBab(doc, bab);
    if (!blocks) throw new UserError(`Bab ${bab} tidak ditemukan di naskah tersimpan`);
    const plain = blocksToText(blocks, bab);
    if (countWords(plain) < 60) throw new UserError('Isi bab masih terlalu sedikit (minimal sekitar 60 kata).');
    const refs = (rows ?? []) as { id: string; csl: Csl }[];
    const cite = await citeLabeler(t.id);
    const daftar = refs.length
      ? refs
          .map((r, i) => {
            const abs = (r.csl.abstract ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 220);
            return `R${i + 1}. ${cslAuthors(r.csl)} (${cslYear(r.csl) ?? 't.t.'}). ${r.csl.title ?? ''}${abs ? `\n    Abstrak: ${abs}` : ''}`;
          })
          .join('\n')
      : '(pustaka masih kosong)';
    const user = [`Judul penelitian: ${t.judul}`, `Pustaka mahasiswa:\n${clip(daftar, 14000)}`, `Teks Bab ${bab}:\n${clip(blocksToText(blocks, bab, cite), 20000)}`].join('\n\n');
    const out = await run(req, { peran: 'mahasiswa', thesisId: t.id, fitur: 'cocok_rujukan', cuplikan: `Bab ${bab}` }, async (call) => {
      const j = await askJson<{ butir?: unknown }>(call, P.COCOK_RUJUKAN, user, { maxTokens: 5000, temperature: 0.2, ringkas: 'Paling banyak 6 butir.' });
      const hay = normalize(plain);
      const butir = (Array.isArray(j.butir) ? j.butir : []).slice(0, 12).flatMap((x: Record<string, unknown>) => {
        const kutipan = verifyQuote(s(x.kutipan, 400), hay);
        if (!kutipan) return [];
        const rujukan = arr(x.rujukan, 3, 10)
          .map((k) => Number(k.replace(/^R/i, '')) - 1)
          .filter((i) => Number.isInteger(i) && i >= 0 && i < refs.length)
          .map((i) => refs[i].id);
        return [{ kutipan, alasan: s(x.alasan, 300), rujukan: [...new Set(rujukan)], kesesuaian: rujukan.length ? s(x.kesesuaian, 300) : '', kata_kunci: s(x.kata_kunci, 120) }];
      });
      return { bab, butir, pustaka: refs.length };
    });
    res.json(out);
  }),
);

/* 6. Ejaan dan kalimat efektif ------------------------------------------- */

/** Paragraf teks (paragraf, butir daftar, kutipan blok) dalam satu bab, tanpa sitasi. */
function babParagraphs(blocks: PmNode[]): string[] {
  const out: string[] = [];
  const walk = (n: PmNode) => {
    if (n.type === 'paragraph') {
      const t = inlineText(n).replace(/\s+/g, ' ').trim();
      if (t && !n.attrs?.keterangan) out.push(t);
      return;
    }
    if (n.type === 'heading' || n.type === 'table' || n.type === 'image') return;
    for (const c of n.content ?? []) walk(c);
  };
  for (const b of blocks) walk(b);
  return out;
}

const JENIS_EJAAN = new Set(['ejaan', 'tanda_baca', 'kata_baku', 'kalimat_efektif']);

aisysRouter.post(
  '/ejaan',
  wrap(async (req, res) => {
    const t = await loadThesis(req.body?.thesis_id);
    requireOwner(t, req.user!.id);
    const bab = babParam(req.body?.bab);
    const mulai = Math.max(0, Math.floor(Number(req.body?.mulai) || 0));
    const blocks = sliceBab(await loadManuscript(t), bab);
    if (!blocks) throw new UserError(`Bab ${bab} tidak ditemukan di naskah tersimpan`);
    const paras = babParagraphs(blocks);
    if (!paras.length) throw new UserError('Bab ini belum memiliki paragraf.');
    if (mulai >= paras.length) throw new UserError('Seluruh paragraf bab ini sudah diperiksa.');
    const chunk: { i: number; t: string }[] = [];
    let len = 0;
    for (let i = mulai; i < paras.length; i++) {
      if (chunk.length && len + paras[i].length > 7000) break;
      chunk.push({ i, t: paras[i] });
      len += paras[i].length;
    }
    const berikutnya = chunk[chunk.length - 1].i + 1 < paras.length ? chunk[chunk.length - 1].i + 1 : null;
    const user = `Paragraf bernomor dari Bab ${bab}:\n${chunk.map((c) => `[P${c.i + 1}] ${c.t}`).join('\n\n')}`;
    const out = await run(req, { peran: 'mahasiswa', thesisId: t.id, fitur: 'ejaan', cuplikan: `Bab ${bab}, paragraf ${mulai + 1}-${chunk[chunk.length - 1].i + 1}` }, async (call) => {
      const j = await askJson<{ koreksi?: unknown }>(call, P.EJAAN, user, { maxTokens: 6000, temperature: 0.1, ringkas: 'Paling banyak 15 koreksi.' });
      const seen = new Set<string>();
      const koreksi = (Array.isArray(j.koreksi) ? j.koreksi : []).slice(0, 30).flatMap((x: Record<string, unknown>) => {
        const p = Number(String(x.p ?? '').replace(/^P/i, '')) - 1;
        const para = chunk.find((c) => c.i === p) ?? chunk.find((c) => typeof x.salah === 'string' && c.t.includes(x.salah));
        const salah = typeof x.salah === 'string' ? x.salah.replace(/\s+/g, ' ') : '';
        const benar = typeof x.benar === 'string' ? x.benar.replace(/\s+/g, ' ') : '';
        if (!para || !salah || salah === benar || salah.length > 400 || !para.t.includes(salah)) return [];
        const key = `${para.i}|${salah}`;
        if (seen.has(key)) return [];
        seen.add(key);
        const jenis = JENIS_EJAAN.has(String(x.jenis)) ? String(x.jenis) : 'ejaan';
        return [{ p: para.i + 1, salah, benar, jenis, alasan: s(x.alasan, 200) }];
      });
      return { bab, koreksi, dari: mulai + 1, sampai: chunk[chunk.length - 1].i + 1, total: paras.length, berikutnya };
    });
    res.json(out);
  }),
);

/* 7. Draf abstrak ---------------------------------------------------------- */

aisysRouter.post(
  '/abstrak',
  wrap(async (req, res) => {
    const t = await loadThesis(req.body?.thesis_id);
    requireOwner(t, req.user!.id);
    const babs = allBabs(await loadManuscript(t)).filter((b) => countWords(b.plain) > 15);
    const total = babs.reduce((n, b) => n + countWords(b.plain), 0);
    if (total < 300) throw new UserError('Naskah masih terlalu sedikit untuk disusun abstraknya (minimal sekitar 300 kata).');
    const user = [`Jenjang: ${t.jenjang}. Judul penelitian: ${t.judul}`, `Bab yang tersedia: ${babs.map((b) => `Bab ${b.bab} ${b.judul}`).join('; ')}`, `Teks naskah:\n${babsText(babs, 26000)}`].join('\n\n');
    const out = await run(req, { peran: 'mahasiswa', thesisId: t.id, fitur: 'abstrak', cuplikan: `${babs.length} bab, ${total} kata` }, async (call) => {
      const j = await askJson<{ id?: unknown; en?: unknown; kata_kunci?: unknown; keywords?: unknown; catatan?: unknown }>(call, P.ABSTRAK, user, {
        maxTokens: 5000,
        temperature: 0.3,
        ringkas: 'Masing-masing abstrak 150 sampai 200 kata.',
      });
      const id = s(j.id, 3000);
      const en = s(j.en, 3000);
      if (!id || !en) throw new AiError('AISYS tidak menghasilkan abstrak. Coba lagi.');
      return { id, en, kata_kunci: arr(j.kata_kunci, 6, 60), keywords: arr(j.keywords, 6, 60), catatan: arr(j.catatan, 4, 300), kata: { id: countWords(id), en: countWords(en) } };
    });
    res.json(out);
  }),
);

/* 8. Persiapan seminar ------------------------------------------------------ */

const UJIAN_LABEL: Record<string, string> = { sempro: 'Seminar Proposal', semhas: 'Seminar Hasil', pendadaran: 'Ujian Pendadaran', d3: 'Ujian Tugas Akhir' };

aisysRouter.post(
  '/persiapan-seminar',
  wrap(async (req, res) => {
    const t = await loadThesis(req.body?.thesis_id);
    requireOwner(t, req.user!.id);
    const jenis = UJIAN_LABEL[String(req.body?.jenis)] ? String(req.body.jenis) : t.jenjang === 'D3' ? 'd3' : 'sempro';
    let babs = allBabs(await loadManuscript(t)).filter((b) => countWords(b.plain) > 15);
    if (jenis === 'sempro') babs = babs.filter((b) => b.bab <= 3);
    const total = babs.reduce((n, b) => n + countWords(b.plain), 0);
    if (total < 300) throw new UserError('Naskah masih terlalu sedikit untuk persiapan ujian (minimal sekitar 300 kata).');
    const { data: notes } = await admin.from('exam_revision_notes').select('isi').eq('thesis_id', t.id).limit(30);
    const prev = ((notes ?? []) as { isi: string }[]).map((n) => `- ${n.isi}`).join('\n');
    const user = [
      `Ujian: ${UJIAN_LABEL[jenis]}. Jenjang: ${t.jenjang}. Judul penelitian: ${t.judul}`,
      prev ? `Catatan revisi dari ujian sebelumnya (pastikan sudah terjawab):\n${clip(prev, 3000)}` : '',
      `Teks naskah:\n${babsText(babs, 28000)}`,
    ]
      .filter(Boolean)
      .join('\n\n');
    const out = await run(req, { peran: 'mahasiswa', thesisId: t.id, fitur: 'persiapan_seminar', cuplikan: UJIAN_LABEL[jenis] }, async (call) => {
      const j = await askJson<{ pertanyaan?: unknown; slide?: unknown; tips?: unknown }>(call, P.PERSIAPAN_SEMINAR, user, {
        maxTokens: 8000,
        temperature: 0.4,
        ringkas: 'Paling banyak 8 pertanyaan dan 10 slide; poin paling banyak 10 kata.',
      });
      const pertanyaan = (Array.isArray(j.pertanyaan) ? j.pertanyaan : []).slice(0, 12).flatMap((x: Record<string, unknown>) => {
        const q = s(x.pertanyaan, 400);
        if (!q) return [];
        const bab = Number(x.bab);
        return [{ pertanyaan: q, kategori: s(x.kategori, 20) || 'lainnya', alasan: s(x.alasan, 300), poin_jawaban: arr(x.poin_jawaban, 5, 300), bab: Number.isInteger(bab) ? bab : null }];
      });
      const slide = (Array.isArray(j.slide) ? j.slide : [])
        .slice(0, 16)
        .map((x: Record<string, unknown>) => ({ judul: s(x.judul, 120), poin: arr(x.poin, 6, 200) }))
        .filter((x) => x.judul);
      if (!pertanyaan.length && !slide.length) throw new AiError('AISYS tidak menghasilkan bahan persiapan. Coba lagi.');
      return { jenis, label: UJIAN_LABEL[jenis], pertanyaan, slide, tips: arr(j.tips, 4, 300) };
    });
    res.json(out);
  }),
);
