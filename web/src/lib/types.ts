export type AppRole = 'admin' | 'pimpinan' | 'kaprodi' | 'baak' | 'dosen' | 'mahasiswa';
export type Jenjang = 'S1' | 'D3';
export type MilestoneStatus = 'belum_mulai' | 'dikerjakan' | 'menunggu_review' | 'revisi' | 'selesai' | 'terlambat';
export type MilestoneKind =
  | 'judul' | 'pembimbing' | 'pembimbing_setuju' | 'ujian' | 'revisi' | 'berkas' | 'yudisium' | 'sk'
  | 'seminar' | 'syarat_otomatis' | 'penguji_setuju' | 'arsip';
export type ExamKind = 'sempro' | 'semhas' | 'pendadaran' | 'd3';
export type ExamResult = 'lulus' | 'lulus_minor' | 'lulus_mayor' | 'mengulang';
export type ExamStatus = 'didaftarkan' | 'dijadwalkan' | 'selesai' | 'dibatalkan';
export type SessionStatus = 'diajukan' | 'dijadwalkan' | 'ditolak' | 'selesai' | 'dibatalkan';
export type SessionResult = 'disetujui' | 'revisi' | 'lanjut';
export type TitleStatus = 'diajukan' | 'disetujui' | 'revisi' | 'ditolak' | 'dibatalkan';
export type Risk = 'hijau' | 'kuning' | 'merah' | 'abu';

export interface RoleRow {
  role: AppRole;
  prodi_id: string | null;
}

export interface Prodi {
  id: string;
  kode: string;
  nama: string;
  jenjang: Jenjang;
  fakultas: string | null;
  min_bimbingan: number;
  kuota_bimbingan_default: number;
  hari_tanpa_bimbingan_kuning: number;
  hari_tanpa_bimbingan_merah: number;
  hari_terlambat_kuning: number;
  hari_terlambat_merah: number;
}

export interface Profile {
  id: string;
  email: string | null;
  nama: string;
  nim: string | null;
  nidn: string | null;
  prodi_id: string | null;
  angkatan: number | null;
  telepon: string | null;
  bidang_keahlian: string[];
  kuota_bimbingan: number | null;
  aktif: boolean;
  prodi?: Pick<Prodi, 'kode' | 'nama' | 'jenjang'> | null;
}

export interface Thesis {
  id: string;
  mahasiswa_id: string;
  prodi_id: string;
  jenjang: Jenjang;
  judul: string;
  abstrak: string | null;
  bidang_kajian: string | null;
  kata_kunci: string[];
  status: 'aktif' | 'cuti' | 'lulus' | 'berhenti';
  mulai: string;
  guideline_id: string | null;
  sinopsis_path: string | null;
  sinopsis_nama: string | null;
  pendadaran_wakil: 'P1' | 'P2';
}

export interface Milestone {
  id: string;
  thesis_id: string;
  urutan: number;
  kode: string;
  nama: string;
  bukti: string;
  jenis: MilestoneKind;
  ujian_jenis: ExamKind | null;
  bobot: number;
  status: MilestoneStatus;
  mulai: string | null;
  tenggat: string | null;
  selesai_at: string | null;
  catatan_bukti: string | null;
  /** Fase tahapan (Persiapan, Proposal, ...). */
  fase?: string | null;
}

export interface Progress {
  thesis_id: string;
  mahasiswa_id: string;
  mahasiswa_nama: string;
  nim: string | null;
  angkatan: number | null;
  prodi_id: string;
  prodi_kode: string;
  prodi_nama: string;
  jenjang: Jenjang;
  judul: string;
  status: Thesis['status'];
  mulai: string;
  persen: number;
  milestone_total: number;
  milestone_selesai: number;
  milestone_id: string | null;
  milestone_urutan: number | null;
  milestone_nama: string | null;
  milestone_status: MilestoneStatus | null;
  milestone_tenggat: string | null;
  hari_terlambat: number | null;
  bimbingan_terakhir: string | null;
  hari_tanpa_bimbingan: number;
  jumlah_bimbingan: number;
  p1_id: string | null;
  p1_nama: string | null;
  p2_id: string | null;
  p2_nama: string | null;
  risiko: Risk;
}

export interface Session {
  id: string;
  thesis_id: string;
  mahasiswa_id: string;
  dosen_id: string;
  milestone_id: string | null;
  document_id: string | null;
  mode: 'tatap_muka' | 'daring';
  tanggal_usulan: string;
  tanggal_jadwal: string | null;
  lokasi: string | null;
  topik: string;
  pesan: string | null;
  status: SessionStatus;
  alasan_status: string | null;
  ringkasan: string | null;
  saran: string | null;
  tindak_lanjut: string | null;
  hasil: SessionResult | null;
  catatan_at: string | null;
  tindak_lanjut_selesai: boolean;
  disahkan: boolean;
  disahkan_at: string | null;
  created_at: string;
  dosen?: { nama: string } | null;
  mahasiswa?: { nama: string; nim: string | null } | null;
  milestone?: { nama: string } | null;
  /** Pengajuan bab di Naskah yang dibahas pada sesi ini. */
  submission_id?: string | null;
  submission?: { id: string; bab: number; nomor: number; judul: string; status: string } | null;
}

export interface DocumentRow {
  id: string;
  thesis_id: string;
  milestone_id: string | null;
  bab: string;
  versi: number;
  file_path: string;
  nama_file: string;
  ukuran: number | null;
  mime: string | null;
  catatan: string | null;
  created_at: string;
  pengunggah?: { nama: string } | null;
}

export interface TitleSubmission {
  id: string;
  mahasiswa_id: string;
  prodi_id: string;
  kelompok: string;
  prioritas: number;
  judul: string;
  bidang_kajian: string | null;
  abstrak: string;
  kata_kunci: string[];
  status: TitleStatus;
  catatan_kaprodi: string | null;
  diputuskan_at: string | null;
  created_at: string;
  sinopsis_path: string | null;
  sinopsis_nama: string | null;
  mahasiswa?: { nama: string; nim: string | null; angkatan: number | null } | null;
}

export interface Supervisor {
  id: string;
  thesis_id: string;
  dosen_id: string;
  peran: 'P1' | 'P2';
  aktif: boolean;
  alasan: string | null;
  ditetapkan_at: string;
  dosen?: { nama: string; nidn: string | null; email: string | null } | null;
}

export interface Notification {
  id: string;
  jenis: string;
  judul: string;
  isi: string | null;
  tautan: string | null;
  dibaca_at: string | null;
  created_at: string;
}

export interface Approval {
  id: string;
  milestone_id: string;
  dosen_id: string;
  peran: 'P1' | 'P2';
  kode: string;
  created_at: string;
}

export interface Examiner {
  id: string;
  thesis_id: string;
  dosen_id: string;
  tahap: 'seminar' | 'pendadaran';
  urutan: number;
  dosen?: { nama: string } | null;
}

export interface Exam {
  id: string;
  thesis_id: string;
  milestone_id: string | null;
  jenis: ExamKind;
  percobaan: number;
  status: ExamStatus;
  tanggal: string | null;
  durasi_menit: number;
  ruang: string | null;
  catatan: string | null;
  nilai_akhir: number | null;
  huruf: string | null;
  hasil: ExamResult | null;
  diputuskan_at: string | null;
  kode_ba: string | null;
  revisi_selesai_at: string | null;
  kode_ba_revisi: string | null;
  created_at: string;
  thesis?: { id: string; judul: string; jenjang: string; prodi_id: string; mahasiswa_id: string; mahasiswa?: { nama: string; nim: string | null } | null } | null;
}

export interface PanelMember {
  id: string;
  exam_id: string;
  dosen_id: string;
  peran: string;
  urutan: number;
  ketua: boolean;
  nilai: number | null;
  catatan: string | null;
  dinilai_at: string | null;
  kode_nilai: string | null;
  acc_revisi_at: string | null;
  kode_acc: string | null;
  /** Penguji meminta perubahan judul (lihat arahan_judul_ujian). */
  ubah_judul?: boolean;
  arahan_judul?: string | null;
  dosen?: { nama: string } | null;
}

export interface AssessmentItem {
  id: string;
  jenis: ExamKind;
  urutan: number;
  nama: string;
  keterangan: string | null;
  bobot: number;
  aktif: boolean;
}

export interface GradeRow {
  id: string;
  huruf: string;
  nilai_min: number;
  angka: number | null;
}

export interface RevisionNote {
  id: string;
  exam_id: string;
  dosen_id: string;
  isi: string;
  selesai: boolean;
  created_at: string;
}

export type SubmissionStatus = 'diajukan' | 'revisi' | 'acc' | 'ditarik';
export interface ChapterSubmission {
  id: string;
  thesis_id: string;
  bab: number;
  nomor: number;
  judul: string;
  konten?: unknown;
  version_id: string | null;
  milestone_id: string | null;
  catatan: string | null;
  status: SubmissionStatus;
  created_at: string;
  ditutup_at: string | null;
}
export interface ChapterReview {
  id: string;
  submission_id: string;
  thesis_id: string;
  dosen_id: string;
  peran: 'P1' | 'P2';
  hasil: 'revisi' | 'acc';
  catatan: string | null;
  kode: string;
  created_at: string;
  dosen?: { nama: string } | null;
}
export type CommentStatus = 'terbuka' | 'diperbaiki' | 'selesai';
export interface ReviewComment {
  id: string;
  thesis_id: string;
  submission_id: string;
  bab: number;
  parent_id: string | null;
  penulis_id: string;
  isi: string;
  kutipan: string | null;
  prefix: string | null;
  suffix: string | null;
  posisi: { from: number; to: number } | null;
  terkirim: boolean;
  status: CommentStatus;
  created_at: string;
  updated_at: string;
  penulis?: { nama: string } | null;
}
export interface ReviewQueueRow {
  id: string;
  thesis_id: string;
  bab: number;
  nomor: number;
  judul: string;
  status: SubmissionStatus;
  created_at: string;
  mahasiswa_nama: string;
  nim: string | null;
  peran: 'P1' | 'P2';
  perlu_tinjau: boolean;
}
