import type { AppRole, ExamKind, ExamResult, ExamStatus, Milestone, MilestoneStatus, Risk, SessionResult, SessionStatus, TitleStatus } from './types';
import { daysFromToday } from './format';

export type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'brand' | 'neutral';

export const ROLE_LABEL: Record<AppRole, string> = {
  admin: 'Admin',
  pimpinan: 'Pimpinan',
  kaprodi: 'Ka. Prodi',
  baak: 'BAAK',
  dosen: 'Dosen',
  mahasiswa: 'Mahasiswa',
};
export const ROLE_ORDER: AppRole[] = ['kaprodi', 'dosen', 'baak', 'pimpinan', 'admin', 'mahasiswa'];

export const MILESTONE_STATUS: Record<MilestoneStatus, { label: string; tone: Tone }> = {
  belum_mulai: { label: 'Belum mulai', tone: 'neutral' },
  dikerjakan: { label: 'Sedang dikerjakan', tone: 'info' },
  menunggu_review: { label: 'Menunggu review', tone: 'brand' },
  revisi: { label: 'Revisi', tone: 'warn' },
  selesai: { label: 'Selesai', tone: 'ok' },
  terlambat: { label: 'Terlambat', tone: 'bad' },
};

/** Status yang ditampilkan: milestone yang lewat tenggat dan belum selesai dianggap "Terlambat". */
export function effectiveStatus(m: Pick<Milestone, 'status' | 'tenggat'>): MilestoneStatus {
  if (m.status !== 'selesai' && m.status !== 'belum_mulai' && m.tenggat) {
    const n = daysFromToday(m.tenggat);
    if (n !== null && n < 0) return 'terlambat';
  }
  return m.status;
}

export const SESSION_STATUS: Record<SessionStatus, { label: string; tone: Tone }> = {
  diajukan: { label: 'Menunggu tanggapan', tone: 'brand' },
  dijadwalkan: { label: 'Terjadwal', tone: 'info' },
  ditolak: { label: 'Ditolak', tone: 'bad' },
  selesai: { label: 'Selesai', tone: 'ok' },
  dibatalkan: { label: 'Dibatalkan', tone: 'neutral' },
};

export const SESSION_RESULT: Record<SessionResult, { label: string; tone: Tone; help: string }> = {
  revisi: { label: 'Revisi', tone: 'warn', help: 'Mahasiswa perlu memperbaiki draf. Milestone berstatus Revisi.' },
  disetujui: { label: 'Disetujui, lanjutkan pengerjaan', tone: 'info', help: 'Progres baik, bab yang sama masih dilanjutkan.' },
  lanjut: { label: 'ACC bab ini dari saya', tone: 'ok', help: 'Bab selesai setelah Pembimbing 1 dan Pembimbing 2 sama-sama memberi ACC.' },
};

export const TITLE_STATUS: Record<TitleStatus, { label: string; tone: Tone }> = {
  diajukan: { label: 'Menunggu keputusan', tone: 'brand' },
  disetujui: { label: 'Diterima', tone: 'ok' },
  revisi: { label: 'Perlu diperbaiki', tone: 'warn' },
  ditolak: { label: 'Ditolak', tone: 'bad' },
  dibatalkan: { label: 'Tidak dipilih', tone: 'neutral' },
};

export const RISK_LABEL: Record<Risk, string> = {
  hijau: 'Sesuai jadwal',
  kuning: 'Waspada',
  merah: 'Kritis',
  abu: 'Tidak aktif',
};

export const THESIS_STATUS: Record<string, { label: string; tone: Tone }> = {
  aktif: { label: 'Aktif', tone: 'info' },
  cuti: { label: 'Cuti', tone: 'warn' },
  lulus: { label: 'Lulus', tone: 'ok' },
  berhenti: { label: 'Berhenti', tone: 'bad' },
};

export const MODE_LABEL = { tatap_muka: 'Tatap muka', daring: 'Daring' } as const;

export const EXAM_LABEL: Record<ExamKind, string> = {
  sempro: 'Seminar Proposal',
  semhas: 'Seminar Hasil',
  pendadaran: 'Pendadaran',
  d3: 'Seminar Tertutup dan Komprehensif',
};

export const EXAM_STATUS: Record<ExamStatus, { label: string; tone: Tone }> = {
  didaftarkan: { label: 'Perlu dijadwalkan', tone: 'brand' },
  dijadwalkan: { label: 'Terjadwal', tone: 'info' },
  selesai: { label: 'Selesai', tone: 'ok' },
  dibatalkan: { label: 'Dibatalkan', tone: 'neutral' },
};

export const EXAM_RESULT: Record<ExamResult, { label: string; tone: Tone }> = {
  lulus: { label: 'Lulus', tone: 'ok' },
  lulus_minor: { label: 'Lulus dengan revisi minor', tone: 'ok' },
  lulus_mayor: { label: 'Lulus dengan revisi mayor', tone: 'warn' },
  mengulang: { label: 'Mengulang', tone: 'bad' },
};

/** Seminar Proposal dan Seminar Hasil memiliki tahap revisi; Pendadaran dan ujian D3 tidak. */
export const examHasRevision = (j: ExamKind) => j === 'sempro' || j === 'semhas';
export const examResultsFor = (j: ExamKind): ExamResult[] => (examHasRevision(j) ? ['lulus_minor', 'lulus_mayor', 'mengulang'] : ['lulus', 'mengulang']);
