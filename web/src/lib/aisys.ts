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

export const aisys = {
  status: () => api<AisysStatus>('/aisys/status'),
  parafrase: (thesis_id: string, teks: string, gaya: GayaParafrase) => api<{ hasil: string[]; sisa: number | null }>('/aisys/parafrase', { body: { thesis_id, teks, gaya } }),
  susun: (thesis_id: string, poin: string, konteks: { bab?: string; subbab?: string; sebelum?: string }) =>
    api<{ hasil: string; sisa: number | null }>('/aisys/susun', { body: { thesis_id, poin, konteks } }),
  cariJurnal: (thesis_id: string, topik: string) => api<{ kueri: string[]; items: { work: CrWork; alasan: string }[]; sisa: number | null }>('/aisys/cari-jurnal', { body: { thesis_id, topik } }),
  periksaBab: (thesis_id: string, bab: number) => api<HasilPeriksa>('/aisys/periksa-bab', { body: { thesis_id, bab } }),
  reviewBab: (submission_id: string) => api<HasilPeriksa>('/aisys/review-bab', { body: { submission_id } }),
};
