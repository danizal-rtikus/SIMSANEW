-- =====================================================================
-- SIMSA — Sistem Informasi Manajemen Studi Akhir
-- Migrasi 1: skema inti (MVP Fase 1)
-- =====================================================================

create extension if not exists pg_trgm;

-- Skema privat untuk fungsi bantu RLS dan fungsi internal.
-- Skema ini TIDAK diekspos lewat API Supabase (PostgREST).
create schema if not exists priv;

-- ---------------------------------------------------------------------
-- Enum
-- ---------------------------------------------------------------------
create type public.app_role as enum ('admin','pimpinan','kaprodi','baak','dosen','mahasiswa');
create type public.jenjang as enum ('S1','D3');
create type public.title_status as enum ('diajukan','disetujui','revisi','ditolak','dibatalkan');
create type public.supervisor_role as enum ('P1','P2');
create type public.session_mode as enum ('tatap_muka','daring');
create type public.session_status as enum ('diajukan','dijadwalkan','ditolak','selesai','dibatalkan');
-- disetujui = progres disetujui, lanjutkan pengerjaan bab yang sama
-- lanjut    = bab disetujui, lanjut ke bab/milestone berikutnya
-- revisi    = perlu revisi
create type public.session_result as enum ('disetujui','revisi','lanjut');
create type public.milestone_status as enum ('belum_mulai','dikerjakan','menunggu_review','revisi','selesai','terlambat');
-- Cara sebuah milestone dinyatakan selesai (bukan klaim sepihak mahasiswa)
create type public.milestone_kind as enum (
  'judul',              -- otomatis saat Ka. Prodi menyetujui judul
  'pembimbing',         -- otomatis saat Pembimbing 1 ditetapkan
  'pembimbing_setuju',  -- persetujuan pembimbing lewat catatan bimbingan
  'seminar',            -- hasil seminar/ujian (Fase 3: otomatis dari berita acara; MVP: dicatat BAAK/Ka. Prodi)
  'syarat_otomatis',    -- syarat terpenuhi otomatis (bimbingan minimum, milestone sebelumnya)
  'penguji_setuju',     -- persetujuan revisi oleh penguji (MVP: dicatat BAAK/Ka. Prodi)
  'arsip'               -- naskah final diarsipkan (MVP: dicatat BAAK)
);

-- ---------------------------------------------------------------------
-- Master data
-- ---------------------------------------------------------------------
create table public.prodi (
  id uuid primary key default gen_random_uuid(),
  kode text not null unique,
  nama text not null,
  jenjang public.jenjang not null,
  fakultas text,
  min_bimbingan int not null default 8,            -- syarat jumlah bimbingan sebelum ujian akhir
  kuota_bimbingan_default int not null default 10, -- kuota mahasiswa per dosen
  hari_tanpa_bimbingan_kuning int not null default 30,
  hari_tanpa_bimbingan_merah int not null default 60,
  hari_terlambat_kuning int not null default 14,
  hari_terlambat_merah int not null default 30,
  created_at timestamptz not null default now()
);

create table public.academic_years (
  id uuid primary key default gen_random_uuid(),
  nama text not null unique,         -- mis. "2026/2027 Ganjil"
  mulai date not null,
  selesai date not null,
  aktif boolean not null default false,
  created_at timestamptz not null default now(),
  check (selesai > mulai)
);
create unique index academic_years_satu_aktif on public.academic_years (aktif) where aktif;

-- ---------------------------------------------------------------------
-- Pengguna
-- ---------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  nama text not null default '',
  nim text unique,
  nidn text unique,
  prodi_id uuid references public.prodi (id),
  angkatan int,
  telepon text,
  bidang_keahlian text[] not null default '{}',
  kuota_bimbingan int,               -- null = pakai kuota default prodi
  aktif boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index profiles_prodi_idx on public.profiles (prodi_id);

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  role public.app_role not null,
  prodi_id uuid references public.prodi (id), -- wajib untuk kaprodi; opsional untuk baak (null = semua prodi)
  created_at timestamptz not null default now(),
  constraint user_roles_unik unique nulls not distinct (user_id, role, prodi_id),
  constraint kaprodi_wajib_prodi check (role <> 'kaprodi' or prodi_id is not null)
);
create index user_roles_user_idx on public.user_roles (user_id);

-- ---------------------------------------------------------------------
-- Pedoman Skripsi/TA
-- ---------------------------------------------------------------------
create table public.guidelines (
  id uuid primary key default gen_random_uuid(),
  prodi_id uuid not null references public.prodi (id) on delete cascade,
  academic_year_id uuid references public.academic_years (id),
  judul text not null,
  versi text not null default '1.0',
  berlaku_mulai date not null default current_date,
  gaya_sitasi text not null default 'APA',
  file_path text,                    -- PDF asli di bucket "guidelines" (opsional)
  aktif boolean not null default true,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);
create index guidelines_prodi_idx on public.guidelines (prodi_id, aktif);

create table public.guideline_sections (
  id uuid primary key default gen_random_uuid(),
  guideline_id uuid not null references public.guidelines (id) on delete cascade,
  parent_id uuid references public.guideline_sections (id) on delete cascade,
  urutan int not null default 0,
  nomor text,                        -- mis. "1.2"
  judul text not null,
  isi text not null default '',
  kategori text not null default 'umum' check (kategori in ('umum','sistematika','aturan','rubrik')),
  pencarian tsvector generated always as (
    to_tsvector('simple', coalesce(nomor,'') || ' ' || coalesce(judul,'') || ' ' || coalesce(isi,''))
  ) stored,
  created_at timestamptz not null default now()
);
create index guideline_sections_guideline_idx on public.guideline_sections (guideline_id, urutan);
create index guideline_sections_search_idx on public.guideline_sections using gin (pencarian);

create table public.guideline_bookmarks (
  user_id uuid not null references public.profiles (id) on delete cascade,
  section_id uuid not null references public.guideline_sections (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, section_id)
);

-- ---------------------------------------------------------------------
-- Studi akhir (thesis), judul, pembimbing
-- ---------------------------------------------------------------------
create table public.thesis (
  id uuid primary key default gen_random_uuid(),
  mahasiswa_id uuid not null references public.profiles (id) on delete cascade,
  prodi_id uuid not null references public.prodi (id),
  jenjang public.jenjang not null,
  academic_year_id uuid references public.academic_years (id),
  guideline_id uuid references public.guidelines (id),
  judul text not null,
  abstrak text,
  bidang_kajian text,
  kata_kunci text[] not null default '{}',
  status text not null default 'aktif' check (status in ('aktif','cuti','lulus','berhenti')),
  mulai date not null default current_date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index thesis_satu_aktif on public.thesis (mahasiswa_id) where status in ('aktif','cuti');
create index thesis_prodi_idx on public.thesis (prodi_id, status);

create table public.title_submissions (
  id uuid primary key default gen_random_uuid(),
  mahasiswa_id uuid not null references public.profiles (id) on delete cascade,
  prodi_id uuid not null references public.prodi (id),
  kelompok uuid not null,            -- satu pengajuan berisi 1–3 judul
  prioritas int not null check (prioritas between 1 and 3),
  judul text not null check (length(trim(judul)) >= 10),
  bidang_kajian text,
  abstrak text not null default '',
  kata_kunci text[] not null default '{}',
  status public.title_status not null default 'diajukan',
  catatan_kaprodi text,
  diputuskan_oleh uuid references public.profiles (id),
  diputuskan_at timestamptz,
  thesis_id uuid references public.thesis (id) on delete set null,
  created_at timestamptz not null default now()
);
create index title_submissions_prodi_status_idx on public.title_submissions (prodi_id, status);
create index title_submissions_mhs_idx on public.title_submissions (mahasiswa_id);
create index title_submissions_judul_trgm on public.title_submissions using gin (judul gin_trgm_ops);
create index thesis_judul_trgm on public.thesis using gin (judul gin_trgm_ops);

create table public.thesis_supervisors (
  id uuid primary key default gen_random_uuid(),
  thesis_id uuid not null references public.thesis (id) on delete cascade,
  dosen_id uuid not null references public.profiles (id),
  peran public.supervisor_role not null,
  aktif boolean not null default true,
  alasan text,                       -- alasan penetapan/penggantian
  ditetapkan_oleh uuid references public.profiles (id),
  ditetapkan_at timestamptz not null default now(),
  diganti_at timestamptz
);
create unique index thesis_supervisors_peran_aktif on public.thesis_supervisors (thesis_id, peran) where aktif;
create unique index thesis_supervisors_dosen_aktif on public.thesis_supervisors (thesis_id, dosen_id) where aktif;
create index thesis_supervisors_dosen_idx on public.thesis_supervisors (dosen_id) where aktif;

-- ---------------------------------------------------------------------
-- Milestone
-- ---------------------------------------------------------------------
create table public.milestone_templates (
  id uuid primary key default gen_random_uuid(),
  prodi_id uuid references public.prodi (id) on delete cascade, -- null = default institusi
  jenjang public.jenjang not null,
  urutan int not null,
  kode text not null,
  nama text not null,
  bukti text not null default '',
  jenis public.milestone_kind not null,
  bobot numeric(6,2) not null default 1 check (bobot >= 0),
  durasi_hari int not null default 30 check (durasi_hari > 0),
  aktif boolean not null default true,
  created_at timestamptz not null default now(),
  constraint milestone_templates_unik unique nulls not distinct (prodi_id, jenjang, urutan)
);

create table public.thesis_milestones (
  id uuid primary key default gen_random_uuid(),
  thesis_id uuid not null references public.thesis (id) on delete cascade,
  template_id uuid references public.milestone_templates (id) on delete set null,
  urutan int not null,
  kode text not null,
  nama text not null,
  bukti text not null default '',
  jenis public.milestone_kind not null,
  bobot numeric(6,2) not null default 1,
  status public.milestone_status not null default 'belum_mulai',
  mulai date,
  tenggat date,
  selesai_at timestamptz,
  catatan_bukti text,                -- mis. nomor berita acara
  diubah_oleh uuid references public.profiles (id),
  updated_at timestamptz not null default now(),
  unique (thesis_id, urutan)
);
create index thesis_milestones_thesis_idx on public.thesis_milestones (thesis_id, urutan);

create table public.milestone_history (
  id bigint generated always as identity primary key,
  milestone_id uuid not null references public.thesis_milestones (id) on delete cascade,
  thesis_id uuid not null references public.thesis (id) on delete cascade,
  dari public.milestone_status,
  ke public.milestone_status,
  tenggat_lama date,
  tenggat_baru date,
  alasan text,
  aktor uuid references public.profiles (id),
  created_at timestamptz not null default now()
);
create index milestone_history_thesis_idx on public.milestone_history (thesis_id, created_at desc);

-- ---------------------------------------------------------------------
-- Dokumen draf dan bimbingan
-- ---------------------------------------------------------------------
create table public.documents (
  id uuid primary key default gen_random_uuid(),
  thesis_id uuid not null references public.thesis (id) on delete cascade,
  milestone_id uuid references public.thesis_milestones (id) on delete set null,
  bab text not null,                 -- mis. "Bab 1" atau nama milestone
  versi int not null,
  file_path text not null unique,    -- path di bucket "drafts": {thesis_id}/...
  nama_file text not null,
  ukuran bigint,
  mime text,
  catatan text,
  diunggah_oleh uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  unique (thesis_id, bab, versi)
);
create index documents_thesis_idx on public.documents (thesis_id, created_at desc);

create table public.guidance_sessions (
  id uuid primary key default gen_random_uuid(),
  thesis_id uuid not null references public.thesis (id) on delete cascade,
  mahasiswa_id uuid not null references public.profiles (id),
  dosen_id uuid not null references public.profiles (id),
  milestone_id uuid references public.thesis_milestones (id) on delete set null,
  document_id uuid references public.documents (id) on delete set null,
  mode public.session_mode not null default 'tatap_muka',
  tanggal_usulan timestamptz not null,
  tanggal_jadwal timestamptz,
  lokasi text,                       -- ruang atau tautan rapat daring
  topik text not null,
  pesan text,
  status public.session_status not null default 'diajukan',
  alasan_status text,
  ringkasan text,
  saran text,
  tindak_lanjut text,
  hasil public.session_result,
  catatan_at timestamptz,
  tindak_lanjut_selesai boolean not null default false,
  tindak_lanjut_selesai_at timestamptz,
  disahkan boolean not null default false,
  disahkan_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index guidance_sessions_thesis_idx on public.guidance_sessions (thesis_id, tanggal_usulan desc);
create index guidance_sessions_dosen_idx on public.guidance_sessions (dosen_id, status);

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  thesis_id uuid not null references public.thesis (id) on delete cascade,
  document_id uuid references public.documents (id) on delete cascade,
  session_id uuid references public.guidance_sessions (id) on delete cascade,
  bagian text,                       -- bab/bagian yang dikomentari, mis. "1.2 Rumusan Masalah"
  penulis_id uuid not null references public.profiles (id),
  isi text not null check (length(trim(isi)) > 0),
  selesai boolean not null default false,
  created_at timestamptz not null default now(),
  check (document_id is not null or session_id is not null)
);
create index comments_session_idx on public.comments (session_id);
create index comments_document_idx on public.comments (document_id);

-- ---------------------------------------------------------------------
-- Notifikasi dan audit
-- ---------------------------------------------------------------------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  jenis text not null,
  judul text not null,
  isi text,
  tautan text,
  dibaca_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  aktor uuid,
  aksi text not null,
  entitas text not null,
  entitas_id text,
  sebelum jsonb,
  sesudah jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_created_idx on public.audit_logs (created_at desc);
