/**
 * AISYS (Akal Imitasi STIKOM Yos Sudarso).
 *  Mahasiswa pemilik naskah : parafrase, susun paragraf, cari jurnal, periksa bab.
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

type Fitur = 'parafrase' | 'susun' | 'cari_jurnal' | 'periksa_bab' | 'review_bab';
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
    const r: ChatResult = await chat(m, o);
    tin += r.tokenMasuk;
    tout += r.tokenKeluar;
    return r;
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
        { json: true, temperature: 0.7, maxTokens: 1800 },
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
        { json: true, temperature: 0.6, maxTokens: 1800 },
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
        { json: true, temperature: 0.3, maxTokens: 300 },
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
        { json: true, temperature: 0.2, maxTokens: 1200 },
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
  const r = await call(
    [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    { json: true, temperature: 0.3, maxTokens: 3500, timeoutMs: 55000 },
  );
  const j = parseJson<{ ringkasan?: unknown; kekuatan?: unknown; temuan?: unknown }>(r.text);
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
