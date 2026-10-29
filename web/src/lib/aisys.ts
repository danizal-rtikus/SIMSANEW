/** Klien AISYS (Akal Imitasi STIKOM Yos Sudarso). Semua pemanggilan lewat server SIMSA. */
import { api } from './api';
import type { CrWork } from './pustaka/sources';

export const AISYS = 'AISYS';

export interface AisysStatus {
  aktif: boolean;
  batas: number | null;
  terpakai: number;
  sisa: number | null;
}

export interface Temuan {
  kategori: 'struktur' | 'isi' | 'metode' | 'bahasa' | 'sitasi' | 'format' | string;
  tingkat: 'penting' | 'saran';
  kutipan: string;
  masalah: string;
  saran: string;
}

export interface HasilPeriksa {
  bab: number;
  judul: string;
  kata: number;
  ringkasan: string;
  kekuatan: string[];
  temuan: Temuan[];
  pedoman: boolean;
  sisa: number | null;
}

export type GayaParafrase = 'akademik' | 'ringkas' | 'sederhana';

export const GAYA_LABEL: Record<GayaParafrase, string> = {
  akademik: 'Akademik',
  ringkas: 'Lebih ringkas',
  sederhana: 'Lebih sederhana',
};

export const KATEGORI_LABEL: Record<string, string> = {
  struktur: 'Struktur',
  isi: 'Isi',
  metode: 'Metode',
  bahasa: 'Bahasa',
  sitasi: 'Sitasi',
  format: 'Format',
};

export interface HasilTanggapi {
  maksud: string;
  langkah: string[];
  contoh: string;
  balasan: string;
  paragraf: string;
  bab: number;
  sisa: number | null;
}

export interface TemuanBab extends Temuan {
  bab: number;
}

export interface HasilKeselarasan {
  ringkasan: string;
  butir: { rumusan: string; tujuan: string; metode: string; hasil: string; kesimpulan: string; status: 'selaras' | 'sebagian' | 'tidak'; catatan: string }[];
  temuan: TemuanBab[];
  bab: { bab: number; judul: string; kata: number }[];
  sisa: number | null;
}

export interface KerangkaItem {
  judul: string;
  panduan: string[];
  anak: { judul: string; panduan: string[] }[];
  ada: boolean;
}

export interface HasilKerangka {
  bab: number;
  judul: string;
  subbab: KerangkaItem[];
  catatan: string;
  pedoman: boolean;
  sisa: number | null;
}

export interface BarisTerdahulu {
  id: string;
  penulis: string;
  tahun: number | null;
  judul: string;
  tujuan: string;
  metode: string;
  hasil: string;
  perbedaan: string;
  abstrak: boolean;
}

export interface HasilCocok {
  bab: number;
  butir: { kutipan: string; alasan: string; rujukan: string[]; kesesuaian: string; kata_kunci: string }[];
  pustaka: number;
  sisa: number | null;
}

export interface Koreksi {
  p: number;
  salah: string;
  benar: string;
  jenis: 'ejaan' | 'tanda_baca' | 'kata_baku' | 'kalimat_efektif';
  alasan: string;
}

export interface HasilEjaan {
  bab: number;
  koreksi: Koreksi[];
  dari: number;
  sampai: number;
  total: number;
  berikutnya: number | null;
  sisa: number | null;
}

export interface HasilAbstrak {
  id: string;
  en: string;
  kata_kunci: string[];
  keywords: string[];
  catatan: string[];
  kata: { id: number; en: number };
  sisa: number | null;
}

export type JenisUjian = 'sempro' | 'semhas' | 'pendadaran' | 'd3';

export interface HasilPersiapan {
  jenis: JenisUjian;
  label: string;
  pertanyaan: { pertanyaan: string; kategori: string; alasan: string; poin_jawaban: string[]; bab: number | null }[];
  slide: { judul: string; poin: string[] }[];
  tips: string[];
  sisa: number | null;
}

export const JENIS_EJAAN: Record<Koreksi['jenis'], string> = {
  ejaan: 'Ejaan',
  tanda_baca: 'Tanda baca',
  kata_baku: 'Kata baku',
  kalimat_efektif: 'Kalimat efektif',
};

export interface PanduOpsi {
  k: 'A' | 'B' | 'C' | 'D';
  teks: string;
}

export interface PanduBuku {
  id: string;
  judul: string;
  penulis: string[];
  penerbit: string | null;
  tahun: number | null;
  isbn: string | null;
  url: string | null;
  alasan: string;
}

export interface PanduGiliran {
  kind: 'pilihan' | 'konfirmasi' | 'literatur' | 'draf' | 'selesai';
  tahap: string;
  progres: string;
  pengantar?: string;
  umpan_balik?: string;
  pertanyaan: string;
  opsi: PanduOpsi[];
  bebas: boolean;
  ringkasan?: string;
  literatur?: { kueri: string[]; artikel: { work: CrWork & { abstract?: string }; alasan: string; aspek: string }[]; buku: PanduBuku[] };
  draf?: { paragraf: string[]; problem_statement: string; research_questions: string[]; research_objectives: string[]; refs: string[] };
}

export interface PanduSesi {
  id: string;
  status: 'aktif' | 'selesai' | 'dibatalkan';
  tahap: string;
  current: PanduGiliran | null;
  riwayat: { tahap: string; pertanyaan: string; jawaban: string }[];
}

export interface PanduJawab {
  pilihan?: PanduOpsi['k'];
  teks?: string;
  ref_ids?: string[];
  aksi?: 'cari_ulang' | 'selesai';
}

export const aisys = {
  status: () => api<AisysStatus>('/aisys/status'),
  parafrase: (thesis_id: string, teks: string, gaya: GayaParafrase) => api<{ hasil: string[]; sisa: number | null }>('/aisys/parafrase', { body: { thesis_id, teks, gaya } }),
  susun: (thesis_id: string, poin: string, konteks: { bab?: string; subbab?: string; sebelum?: string }) =>
    api<{ hasil: string; sisa: number | null }>('/aisys/susun', { body: { thesis_id, poin, konteks } }),
  cariJurnal: (thesis_id: string, topik: string) => api<{ kueri: string[]; items: { work: CrWork; alasan: string }[]; sisa: number | null }>('/aisys/cari-jurnal', { body: { thesis_id, topik } }),
  periksaBab: (thesis_id: string, bab: number) => api<HasilPeriksa>('/aisys/periksa-bab', { body: { thesis_id, bab } }),
  reviewBab: (submission_id: string) => api<HasilPeriksa>('/aisys/review-bab', { body: { submission_id } }),
  tanggapiCatatan: (thesis_id: string, comment_id: string) => api<HasilTanggapi>('/aisys/tanggapi-catatan', { body: { thesis_id, comment_id } }),
  keselarasan: (thesis_id: string) => api<HasilKeselarasan>('/aisys/keselarasan', { body: { thesis_id } }),
  kerangka: (thesis_id: string, bab: number, catatan: string) => api<HasilKerangka>('/aisys/kerangka', { body: { thesis_id, bab, catatan } }),
  tabelTerdahulu: (thesis_id: string, ref_ids: string[]) => api<{ baris: BarisTerdahulu[]; posisi: string; sisa: number | null }>('/aisys/tabel-terdahulu', { body: { thesis_id, ref_ids } }),
  cocokRujukan: (thesis_id: string, bab: number) => api<HasilCocok>('/aisys/cocok-rujukan', { body: { thesis_id, bab } }),
  ejaan: (thesis_id: string, bab: number, mulai: number) => api<HasilEjaan>('/aisys/ejaan', { body: { thesis_id, bab, mulai } }),
  abstrak: (thesis_id: string) => api<HasilAbstrak>('/aisys/abstrak', { body: { thesis_id } }),
  persiapanSeminar: (thesis_id: string, jenis: JenisUjian) => api<HasilPersiapan>('/aisys/persiapan-seminar', { body: { thesis_id, jenis } }),
  pandu: (thesis_id: string) => api<{ sesi: PanduSesi | null }>(`/aisys/pandu?thesis_id=${encodeURIComponent(thesis_id)}`),
  panduMulai: (thesis_id: string) => api<{ sesi: PanduSesi; sisa: number | null }>('/aisys/pandu/mulai', { body: { thesis_id } }),
  panduJawab: (sesi_id: string, j: PanduJawab) => api<PanduSesi>('/aisys/pandu/jawab', { body: { sesi_id, ...j } }),
};
