-- SIMSA: setup lengkap (gabungan semua migrasi + data contoh). Jalankan SEKALI di Supabase SQL Editor pada proyek kosong.

-- ===================== supabase/migrations/20261028000100_schema.sql =====================
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

-- ===================== supabase/migrations/20261028000200_functions.sql =====================
-- =====================================================================
-- SIMSA — Migrasi 2: fungsi bantu, trigger, dan alur kerja (RPC)
-- Semua perubahan status penting dijalankan lewat fungsi di sini,
-- sehingga aturan bisnis berlaku di database, bukan hanya di UI.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Fungsi bantu hak akses (dipakai kebijakan RLS)
-- ---------------------------------------------------------------------
create or replace function priv.has_role(r public.app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_roles ur
    join public.profiles p on p.id = ur.user_id
    where ur.user_id = auth.uid() and ur.role = r and p.aktif
  );
$$;

create or replace function priv.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select priv.has_role('admin');
$$;

create or replace function priv.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_roles ur join public.profiles p on p.id = ur.user_id
    where ur.user_id = auth.uid() and ur.role <> 'mahasiswa' and p.aktif
  );
$$;

create or replace function priv.is_kaprodi_of(p_prodi uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_roles ur join public.profiles p on p.id = ur.user_id
    where ur.user_id = auth.uid() and ur.role = 'kaprodi' and ur.prodi_id = p_prodi and p.aktif
  );
$$;

create or replace function priv.is_baak_of(p_prodi uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_roles ur join public.profiles p on p.id = ur.user_id
    where ur.user_id = auth.uid() and ur.role = 'baak'
      and (ur.prodi_id is null or ur.prodi_id = p_prodi) and p.aktif
  );
$$;

create or replace function priv.is_supervisor_of(p_thesis uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.thesis_supervisors s
    where s.thesis_id = p_thesis and s.dosen_id = auth.uid() and s.aktif
  );
$$;

create or replace function priv.is_thesis_owner(p_thesis uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.thesis t where t.id = p_thesis and t.mahasiswa_id = auth.uid());
$$;

create or replace function priv.can_view_thesis(p_thesis uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.thesis t
    where t.id = p_thesis and (
      t.mahasiswa_id = auth.uid()
      or priv.is_supervisor_of(t.id)
      or priv.is_kaprodi_of(t.prodi_id)
      or priv.is_baak_of(t.prodi_id)
      or priv.has_role('pimpinan')
      or priv.is_admin()
    )
  );
$$;

create or replace function priv.can_manage_thesis(p_thesis uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.thesis t
    where t.id = p_thesis and (priv.is_kaprodi_of(t.prodi_id) or priv.is_admin())
  );
$$;

create or replace function priv.can_view_profile(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select
    p_user = auth.uid()
    or priv.is_admin()
    or priv.has_role('pimpinan')
    -- profil staf (dosen, Ka. Prodi, dll.) terlihat oleh semua pengguna yang login
    or exists (select 1 from public.user_roles ur where ur.user_id = p_user and ur.role <> 'mahasiswa')
    or exists (
      select 1 from public.profiles x
      where x.id = p_user and x.prodi_id is not null
        and (priv.is_kaprodi_of(x.prodi_id) or priv.is_baak_of(x.prodi_id))
    )
    or exists (
      select 1 from public.thesis t
      join public.thesis_supervisors s on s.thesis_id = t.id and s.aktif
      where t.mahasiswa_id = p_user and s.dosen_id = auth.uid()
    );
$$;

create or replace function priv.try_uuid(p text)
returns uuid language plpgsql immutable as $$
begin
  return p::uuid;
exception when others then
  return null;
end;
$$;

-- ---------------------------------------------------------------------
-- Fungsi internal: notifikasi, audit, galat
-- ---------------------------------------------------------------------
create or replace function priv.require_user()
returns uuid language plpgsql stable as $$
declare v uuid := auth.uid();
begin
  if v is null then
    raise exception 'Sesi login tidak ditemukan' using errcode = '28000';
  end if;
  return v;
end;
$$;

create or replace function priv.notify(p_user uuid, p_jenis text, p_judul text, p_isi text, p_tautan text)
returns void language sql security definer set search_path = public as $$
  insert into public.notifications (user_id, jenis, judul, isi, tautan)
  select p_user, p_jenis, p_judul, p_isi, p_tautan where p_user is not null;
$$;

create or replace function priv.notify_kaprodi(p_prodi uuid, p_jenis text, p_judul text, p_isi text, p_tautan text)
returns void language sql security definer set search_path = public as $$
  insert into public.notifications (user_id, jenis, judul, isi, tautan)
  select distinct ur.user_id, p_jenis, p_judul, p_isi, p_tautan
  from public.user_roles ur join public.profiles p on p.id = ur.user_id
  where ur.role = 'kaprodi' and ur.prodi_id = p_prodi and p.aktif;
$$;

create or replace function priv.log(p_aksi text, p_entitas text, p_id text, p_sebelum jsonb, p_sesudah jsonb)
returns void language sql security definer set search_path = public as $$
  insert into public.audit_logs (aktor, aksi, entitas, entitas_id, sebelum, sesudah)
  values (auth.uid(), p_aksi, p_entitas, p_id, p_sebelum, p_sesudah);
$$;

-- ---------------------------------------------------------------------
-- Trigger umum
-- ---------------------------------------------------------------------
create or replace function priv.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_touch before update on public.profiles for each row execute function priv.touch_updated_at();
create trigger thesis_touch before update on public.thesis for each row execute function priv.touch_updated_at();
create trigger milestones_touch before update on public.thesis_milestones for each row execute function priv.touch_updated_at();
create trigger sessions_touch before update on public.guidance_sessions for each row execute function priv.touch_updated_at();

-- Profil dibuat otomatis saat akun Supabase Auth dibuat
create or replace function priv.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, nama)
  values (
    new.id,
    new.email,
    coalesce(nullif(new.raw_user_meta_data ->> 'nama', ''), nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function priv.handle_new_user();

-- Audit log untuk aksi sensitif
create or replace function priv.audit_row()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_logs (aktor, aksi, entitas, entitas_id, sebelum, sesudah)
  values (
    auth.uid(),
    lower(tg_op),
    tg_table_name,
    coalesce((case when tg_op = 'DELETE' then old.id else new.id end)::text, null),
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end
  );
  return coalesce(new, old);
end;
$$;

create trigger audit_user_roles after insert or delete on public.user_roles
  for each row execute function priv.audit_row();
create trigger audit_thesis_supervisors after insert or update on public.thesis_supervisors
  for each row execute function priv.audit_row();
create trigger audit_profiles_aktif after update of aktif, prodi_id, nim, nidn on public.profiles
  for each row execute function priv.audit_row();

-- Riwayat milestone: siapa, kapan, alasan
create or replace function priv.milestone_history_row()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status or new.tenggat is distinct from old.tenggat then
    insert into public.milestone_history (milestone_id, thesis_id, dari, ke, tenggat_lama, tenggat_baru, alasan, aktor)
    values (
      new.id, new.thesis_id,
      old.status, new.status,
      old.tenggat, new.tenggat,
      nullif(current_setting('simsa.alasan', true), ''),
      auth.uid()
    );
  end if;
  return new;
end;
$$;

create trigger thesis_milestones_history after update on public.thesis_milestones
  for each row execute function priv.milestone_history_row();

-- Nomor versi draf otomatis per bab (v1, v2, ...)
create or replace function priv.document_version()
returns trigger language plpgsql as $$
begin
  perform pg_advisory_xact_lock(hashtext(new.thesis_id::text || new.bab));
  select coalesce(max(versi), 0) + 1 into new.versi
  from public.documents where thesis_id = new.thesis_id and bab = new.bab;
  return new;
end;
$$;

create trigger documents_version before insert on public.documents
  for each row execute function priv.document_version();

-- ---------------------------------------------------------------------
-- Mesin milestone
-- ---------------------------------------------------------------------
create or replace function priv.generate_milestones(p_thesis uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_thesis public.thesis;
  v_prodi_ada boolean;
begin
  select * into v_thesis from public.thesis where id = p_thesis;
  select exists (
    select 1 from public.milestone_templates
    where prodi_id = v_thesis.prodi_id and jenjang = v_thesis.jenjang and aktif
  ) into v_prodi_ada;

  insert into public.thesis_milestones (thesis_id, template_id, urutan, kode, nama, bukti, jenis, bobot, tenggat)
  select
    p_thesis, t.id, t.urutan, t.kode, t.nama, t.bukti, t.jenis, t.bobot,
    v_thesis.mulai + (sum(t.durasi_hari) over (order by t.urutan))::int
  from public.milestone_templates t
  where t.jenjang = v_thesis.jenjang and t.aktif
    and ((v_prodi_ada and t.prodi_id = v_thesis.prodi_id) or (not v_prodi_ada and t.prodi_id is null))
  order by t.urutan;
end;
$$;

-- Ubah status milestone dengan alasan (tercatat di milestone_history)
create or replace function priv.set_milestone_status(p_id uuid, p_status public.milestone_status, p_alasan text, p_catatan text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform set_config('simsa.alasan', coalesce(p_alasan, ''), true);
  update public.thesis_milestones
  set status = p_status,
      mulai = case when p_status <> 'belum_mulai' then coalesce(mulai, current_date) else mulai end,
      selesai_at = case when p_status = 'selesai' then now() else null end,
      catatan_bukti = coalesce(p_catatan, catatan_bukti),
      diubah_oleh = auth.uid()
  where id = p_id;
  perform set_config('simsa.alasan', '', true);
end;
$$;

-- Hasil pemeriksaan syarat otomatis (bimbingan minimum + milestone sebelumnya)
create or replace function priv.cek_syarat(p_thesis uuid, p_urutan int)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_min int;
  v_jumlah int;
  v_belum int;
begin
  select pr.min_bimbingan into v_min
  from public.thesis t join public.prodi pr on pr.id = t.prodi_id where t.id = p_thesis;

  select count(*) into v_jumlah
  from public.guidance_sessions where thesis_id = p_thesis and status = 'selesai';

  select count(*) into v_belum
  from public.thesis_milestones where thesis_id = p_thesis and urutan < p_urutan and status <> 'selesai';

  return jsonb_build_object(
    'min_bimbingan', v_min,
    'jumlah_bimbingan', v_jumlah,
    'bimbingan_cukup', v_jumlah >= v_min,
    'milestone_sebelumnya_selesai', v_belum = 0,
    'catatan', 'Pemeriksaan berkas administrasi tersedia pada Fase 3',
    'terpenuhi', v_jumlah >= v_min and v_belum = 0
  );
end;
$$;

-- Aktifkan milestone berikutnya; selesaikan otomatis milestone "syarat_otomatis"
create or replace function priv.activate_next(p_thesis uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_next public.thesis_milestones;
  v_syarat jsonb;
begin
  loop
    select * into v_next from public.thesis_milestones
    where thesis_id = p_thesis and status <> 'selesai'
    order by urutan limit 1;

    if not found then
      update public.thesis set status = 'lulus' where id = p_thesis and status = 'aktif';
      return;
    end if;

    if v_next.status = 'belum_mulai' then
      perform priv.set_milestone_status(v_next.id, 'dikerjakan', 'Milestone sebelumnya selesai');
    end if;

    if v_next.jenis = 'syarat_otomatis' then
      v_syarat := priv.cek_syarat(p_thesis, v_next.urutan);
      if (v_syarat ->> 'terpenuhi')::boolean then
        perform priv.set_milestone_status(v_next.id, 'selesai', 'Syarat otomatis terpenuhi', v_syarat::text);
        continue;
      end if;
    end if;
    return;
  end loop;
end;
$$;

create or replace function priv.complete_milestone(p_id uuid, p_alasan text, p_catatan text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_thesis uuid;
begin
  select thesis_id into v_thesis from public.thesis_milestones where id = p_id;
  perform priv.set_milestone_status(p_id, 'selesai', p_alasan, p_catatan);
  perform priv.activate_next(v_thesis);
end;
$$;

-- =====================================================================
-- RPC publik (dipanggil dari aplikasi lewat supabase.rpc)
-- =====================================================================

-- 1. Mahasiswa mengajukan 1–3 judul
create or replace function public.ajukan_judul(p_items jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := priv.require_user();
  v_prodi uuid;
  v_kelompok uuid := gen_random_uuid();
  v_item jsonb;
  v_i int := 0;
  v_nama text;
begin
  if not priv.has_role('mahasiswa') then
    raise exception 'Hanya mahasiswa yang dapat mengajukan judul';
  end if;
  select prodi_id, nama into v_prodi, v_nama from public.profiles where id = v_uid;
  if v_prodi is null then
    raise exception 'Prodi pada profil Anda belum diisi. Hubungi Admin.';
  end if;
  if exists (select 1 from public.thesis where mahasiswa_id = v_uid and status in ('aktif','cuti','lulus')) then
    raise exception 'Anda sudah memiliki judul studi akhir yang disetujui';
  end if;
  if exists (select 1 from public.title_submissions where mahasiswa_id = v_uid and status = 'diajukan') then
    raise exception 'Masih ada pengajuan judul yang menunggu keputusan Ka. Prodi';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 3 then
    raise exception 'Ajukan minimal 1 dan maksimal 3 judul';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_i := v_i + 1;
    if length(trim(coalesce(v_item ->> 'judul', ''))) < 10 then
      raise exception 'Judul ke-% terlalu pendek (minimal 10 karakter)', v_i;
    end if;
    insert into public.title_submissions (mahasiswa_id, prodi_id, kelompok, prioritas, judul, bidang_kajian, abstrak, kata_kunci)
    values (
      v_uid, v_prodi, v_kelompok, v_i,
      trim(v_item ->> 'judul'),
      nullif(trim(coalesce(v_item ->> 'bidang_kajian', '')), ''),
      coalesce(v_item ->> 'abstrak', ''),
      coalesce(array(select trim(x) from jsonb_array_elements_text(coalesce(v_item -> 'kata_kunci', '[]'::jsonb)) x where trim(x) <> ''), '{}')
    );
  end loop;

  perform priv.notify_kaprodi(v_prodi, 'judul_baru', 'Pengajuan judul baru',
    v_nama || ' mengajukan ' || v_i || ' judul untuk diverifikasi.', '/kaprodi/judul');
  return v_kelompok;
end;
$$;

-- 2. Ka. Prodi memutuskan pengajuan judul
create or replace function public.putuskan_judul(p_id uuid, p_status public.title_status, p_catatan text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := priv.require_user();
  v_sub public.title_submissions;
  v_prodi public.prodi;
  v_thesis uuid;
  v_first uuid;
  v_label text;
begin
  select * into v_sub from public.title_submissions where id = p_id for update;
  if not found then raise exception 'Pengajuan judul tidak ditemukan'; end if;
  if not (priv.is_kaprodi_of(v_sub.prodi_id) or priv.is_admin()) then
    raise exception 'Anda tidak berwenang memutuskan judul pada prodi ini';
  end if;
  if v_sub.status <> 'diajukan' then
    raise exception 'Pengajuan ini sudah diputuskan';
  end if;
  if p_status not in ('disetujui','revisi','ditolak') then
    raise exception 'Keputusan tidak valid';
  end if;
  if p_status <> 'disetujui' and length(trim(coalesce(p_catatan, ''))) = 0 then
    raise exception 'Catatan wajib diisi untuk keputusan revisi atau tolak';
  end if;

  update public.title_submissions
  set status = p_status, catatan_kaprodi = nullif(trim(coalesce(p_catatan,'')), ''),
      diputuskan_oleh = v_uid, diputuskan_at = now()
  where id = p_id;

  if p_status = 'disetujui' then
    if exists (select 1 from public.thesis where mahasiswa_id = v_sub.mahasiswa_id and status in ('aktif','cuti')) then
      raise exception 'Mahasiswa ini sudah memiliki studi akhir aktif';
    end if;
    select * into v_prodi from public.prodi where id = v_sub.prodi_id;

    insert into public.thesis (mahasiswa_id, prodi_id, jenjang, academic_year_id, guideline_id, judul, abstrak, bidang_kajian, kata_kunci)
    values (
      v_sub.mahasiswa_id, v_sub.prodi_id, v_prodi.jenjang,
      (select id from public.academic_years where aktif limit 1),
      (select id from public.guidelines where prodi_id = v_sub.prodi_id and aktif order by berlaku_mulai desc limit 1),
      v_sub.judul, v_sub.abstrak, v_sub.bidang_kajian, v_sub.kata_kunci
    ) returning id into v_thesis;

    update public.title_submissions set thesis_id = v_thesis where id = p_id;
    update public.title_submissions
      set status = 'dibatalkan', catatan_kaprodi = 'Judul lain dalam pengajuan ini telah disetujui',
          diputuskan_oleh = v_uid, diputuskan_at = now()
      where kelompok = v_sub.kelompok and id <> p_id and status = 'diajukan';

    perform priv.generate_milestones(v_thesis);
    select id into v_first from public.thesis_milestones
      where thesis_id = v_thesis and jenis = 'judul' order by urutan limit 1;
    if v_first is not null then
      perform priv.complete_milestone(v_first, 'Judul disetujui Ka. Prodi', null);
    else
      perform priv.activate_next(v_thesis);
    end if;
  end if;

  v_label := case p_status when 'disetujui' then 'disetujui' when 'revisi' then 'perlu direvisi' else 'ditolak' end;
  perform priv.notify(v_sub.mahasiswa_id, 'judul_diputuskan', 'Judul ' || v_label,
    '"' || v_sub.judul || '" ' || v_label || coalesce('. Catatan: ' || nullif(trim(coalesce(p_catatan,'')), ''), '') || '.',
    '/judul');
  perform priv.log('putuskan_judul', 'title_submissions', p_id::text, to_jsonb(v_sub),
    jsonb_build_object('status', p_status, 'catatan', p_catatan, 'thesis_id', v_thesis));
  return v_thesis;
end;
$$;

-- 3. Ka. Prodi menetapkan / mengganti pembimbing
create or replace function public.tetapkan_pembimbing(p_thesis uuid, p_dosen uuid, p_peran public.supervisor_role, p_alasan text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := priv.require_user();
  v_thesis public.thesis;
  v_lama public.thesis_supervisors;
  v_id uuid;
  v_ms uuid;
  v_nama_dosen text;
  v_nama_mhs text;
begin
  select * into v_thesis from public.thesis where id = p_thesis;
  if not found then raise exception 'Data studi akhir tidak ditemukan'; end if;
  if not priv.can_manage_thesis(p_thesis) then
    raise exception 'Anda tidak berwenang menetapkan pembimbing pada prodi ini';
  end if;
  if v_thesis.status <> 'aktif' then
    raise exception 'Studi akhir tidak berstatus aktif';
  end if;
  if not exists (
    select 1 from public.user_roles ur join public.profiles p on p.id = ur.user_id
    where ur.user_id = p_dosen and ur.role = 'dosen' and p.aktif
  ) then
    raise exception 'Pengguna yang dipilih bukan dosen aktif';
  end if;
  if exists (select 1 from public.thesis_supervisors where thesis_id = p_thesis and dosen_id = p_dosen and aktif and peran <> p_peran) then
    raise exception 'Dosen ini sudah menjadi pembimbing lain untuk mahasiswa yang sama';
  end if;

  select * into v_lama from public.thesis_supervisors where thesis_id = p_thesis and peran = p_peran and aktif;
  if found then
    if v_lama.dosen_id = p_dosen then
      raise exception 'Dosen ini sudah ditetapkan sebagai %', p_peran;
    end if;
    if length(trim(coalesce(p_alasan, ''))) = 0 then
      raise exception 'Alasan wajib diisi saat mengganti pembimbing';
    end if;
    update public.thesis_supervisors set aktif = false, diganti_at = now() where id = v_lama.id;
    perform priv.notify(v_lama.dosen_id, 'pembimbing_diganti', 'Penugasan pembimbing berakhir',
      'Anda tidak lagi menjadi ' || p_peran || ' untuk "' || v_thesis.judul || '". Alasan: ' || p_alasan, '/dosen/mahasiswa');
  end if;

  insert into public.thesis_supervisors (thesis_id, dosen_id, peran, alasan, ditetapkan_oleh)
  values (p_thesis, p_dosen, p_peran, nullif(trim(coalesce(p_alasan,'')), ''), v_uid)
  returning id into v_id;

  select nama into v_nama_dosen from public.profiles where id = p_dosen;
  select nama into v_nama_mhs from public.profiles where id = v_thesis.mahasiswa_id;

  perform priv.notify(p_dosen, 'pembimbing_ditetapkan', 'Penugasan pembimbing baru',
    'Anda ditetapkan sebagai ' || (case p_peran when 'P1' then 'Pembimbing 1' else 'Pembimbing 2' end) || ' untuk ' || v_nama_mhs || '.',
    '/mahasiswa-bimbingan/' || p_thesis);
  perform priv.notify(v_thesis.mahasiswa_id, 'pembimbing_ditetapkan', 'Pembimbing ditetapkan',
    v_nama_dosen || ' ditetapkan sebagai ' || (case p_peran when 'P1' then 'Pembimbing 1' else 'Pembimbing 2' end) || '.',
    '/');

  if p_peran = 'P1' then
    select id into v_ms from public.thesis_milestones
      where thesis_id = p_thesis and jenis = 'pembimbing' and status <> 'selesai' order by urutan limit 1;
    if v_ms is not null then
      perform priv.complete_milestone(v_ms, 'Pembimbing 1 ditetapkan', null);
    end if;
  end if;
  return v_id;
end;
$$;

-- 3b. Lepas Pembimbing 2 (Pembimbing 1 hanya dapat diganti)
create or replace function public.lepas_pembimbing(p_id uuid, p_alasan text)
returns void language plpgsql security definer set search_path = public as $$
declare v_s public.thesis_supervisors;
begin
  perform priv.require_user();
  select * into v_s from public.thesis_supervisors where id = p_id and aktif;
  if not found then raise exception 'Penugasan pembimbing tidak ditemukan'; end if;
  if not priv.can_manage_thesis(v_s.thesis_id) then raise exception 'Anda tidak berwenang'; end if;
  if v_s.peran = 'P1' then raise exception 'Pembimbing 1 tidak dapat dilepas, hanya dapat diganti'; end if;
  if length(trim(coalesce(p_alasan, ''))) = 0 then raise exception 'Alasan wajib diisi'; end if;
  update public.thesis_supervisors set aktif = false, diganti_at = now(), alasan = p_alasan where id = p_id;
  perform priv.notify(v_s.dosen_id, 'pembimbing_diganti', 'Penugasan pembimbing berakhir',
    'Penugasan Anda sebagai Pembimbing 2 diakhiri. Alasan: ' || p_alasan, '/dosen/mahasiswa');
end;
$$;

-- 4. Mahasiswa mencatat draf yang sudah diunggah ke Storage
create or replace function public.catat_dokumen(
  p_thesis uuid, p_bab text, p_milestone uuid, p_path text, p_nama text,
  p_ukuran bigint default null, p_mime text default null, p_catatan text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := priv.require_user();
  v_id uuid;
begin
  if not (priv.is_thesis_owner(p_thesis) or priv.is_supervisor_of(p_thesis)) then
    raise exception 'Anda tidak berwenang mengunggah draf untuk studi akhir ini';
  end if;
  if p_path is null or left(p_path, length(p_thesis::text) + 1) <> p_thesis::text || '/' then
    raise exception 'Lokasi berkas tidak valid';
  end if;
  if not exists (select 1 from storage.objects where bucket_id = 'drafts' and name = p_path) then
    raise exception 'Berkas belum terunggah ke penyimpanan';
  end if;
  if p_milestone is not null and not exists (select 1 from public.thesis_milestones where id = p_milestone and thesis_id = p_thesis) then
    raise exception 'Milestone tidak sesuai';
  end if;
  insert into public.documents (thesis_id, milestone_id, bab, versi, file_path, nama_file, ukuran, mime, catatan, diunggah_oleh)
  values (p_thesis, p_milestone, trim(p_bab), 0, p_path, p_nama, p_ukuran, p_mime, p_catatan, v_uid)
  returning id into v_id;
  return v_id;
end;
$$;

-- 5. Mahasiswa mengajukan sesi bimbingan
create or replace function public.ajukan_bimbingan(
  p_thesis uuid, p_dosen uuid, p_mode public.session_mode, p_tanggal timestamptz,
  p_topik text, p_pesan text default null, p_milestone uuid default null, p_document uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := priv.require_user();
  v_thesis public.thesis;
  v_id uuid;
  v_ms public.thesis_milestones;
  v_nama text;
begin
  select * into v_thesis from public.thesis where id = p_thesis;
  if not found or v_thesis.mahasiswa_id <> v_uid then
    raise exception 'Studi akhir tidak ditemukan';
  end if;
  if v_thesis.status <> 'aktif' then raise exception 'Studi akhir tidak berstatus aktif'; end if;
  if not exists (select 1 from public.thesis_supervisors where thesis_id = p_thesis and dosen_id = p_dosen and aktif) then
    raise exception 'Dosen yang dipilih bukan pembimbing Anda';
  end if;
  if length(trim(coalesce(p_topik, ''))) = 0 then raise exception 'Topik bimbingan wajib diisi'; end if;
  if p_document is not null and not exists (select 1 from public.documents where id = p_document and thesis_id = p_thesis) then
    raise exception 'Draf tidak sesuai';
  end if;
  if p_milestone is not null then
    select * into v_ms from public.thesis_milestones where id = p_milestone and thesis_id = p_thesis;
    if not found then raise exception 'Milestone tidak sesuai'; end if;
  end if;

  insert into public.guidance_sessions (thesis_id, mahasiswa_id, dosen_id, milestone_id, document_id, mode, tanggal_usulan, topik, pesan)
  values (p_thesis, v_uid, p_dosen, p_milestone, p_document, p_mode, p_tanggal, trim(p_topik), p_pesan)
  returning id into v_id;

  if p_document is not null and v_ms.id is not null and v_ms.jenis = 'pembimbing_setuju'
     and v_ms.status in ('belum_mulai','dikerjakan','revisi') then
    perform priv.set_milestone_status(v_ms.id, 'menunggu_review', 'Draf diajukan untuk direview');
  end if;

  select nama into v_nama from public.profiles where id = v_uid;
  perform priv.notify(p_dosen, 'bimbingan_baru', 'Pengajuan bimbingan baru',
    v_nama || ' mengajukan bimbingan: ' || trim(p_topik), '/bimbingan/' || v_id);
  return v_id;
end;
$$;

-- 6. Dosen menanggapi pengajuan (terima / jadwal ulang / tolak); mahasiswa dapat membatalkan
create or replace function public.tanggapi_bimbingan(
  p_id uuid, p_aksi text, p_tanggal timestamptz default null, p_lokasi text default null, p_alasan text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := priv.require_user();
  v_s public.guidance_sessions;
  v_ms public.thesis_milestones;
begin
  select * into v_s from public.guidance_sessions where id = p_id for update;
  if not found then raise exception 'Sesi bimbingan tidak ditemukan'; end if;

  if p_aksi = 'batal' then
    if v_s.mahasiswa_id <> v_uid then raise exception 'Hanya mahasiswa pengaju yang dapat membatalkan'; end if;
    if v_s.status not in ('diajukan','dijadwalkan') then raise exception 'Sesi ini tidak dapat dibatalkan'; end if;
    update public.guidance_sessions set status = 'dibatalkan', alasan_status = p_alasan where id = p_id;
    perform priv.notify(v_s.dosen_id, 'bimbingan_batal', 'Bimbingan dibatalkan mahasiswa',
      v_s.topik || coalesce(' — ' || nullif(p_alasan, ''), ''), '/bimbingan/' || p_id);
  else
    if v_s.dosen_id <> v_uid or not priv.is_supervisor_of(v_s.thesis_id) then
      raise exception 'Hanya dosen pembimbing yang dituju yang dapat menanggapi';
    end if;
    if p_aksi = 'terima' then
      if v_s.status <> 'diajukan' then raise exception 'Sesi ini sudah ditanggapi'; end if;
      update public.guidance_sessions
        set status = 'dijadwalkan', tanggal_jadwal = coalesce(p_tanggal, tanggal_usulan), lokasi = coalesce(p_lokasi, lokasi)
        where id = p_id;
      perform priv.notify(v_s.mahasiswa_id, 'bimbingan_diterima', 'Bimbingan dijadwalkan',
        v_s.topik, '/bimbingan/' || p_id);
    elsif p_aksi = 'jadwal_ulang' then
      if v_s.status not in ('diajukan','dijadwalkan') then raise exception 'Sesi ini tidak dapat dijadwalkan ulang'; end if;
      if p_tanggal is null then raise exception 'Tanggal baru wajib diisi'; end if;
      update public.guidance_sessions
        set status = 'dijadwalkan', tanggal_jadwal = p_tanggal, lokasi = coalesce(p_lokasi, lokasi), alasan_status = p_alasan
        where id = p_id;
      perform priv.notify(v_s.mahasiswa_id, 'bimbingan_jadwal_ulang', 'Bimbingan dijadwalkan ulang',
        v_s.topik || coalesce(' — ' || nullif(p_alasan, ''), ''), '/bimbingan/' || p_id);
    elsif p_aksi = 'tolak' then
      if v_s.status not in ('diajukan','dijadwalkan') then raise exception 'Sesi ini tidak dapat ditolak'; end if;
      if length(trim(coalesce(p_alasan, ''))) = 0 then raise exception 'Alasan penolakan wajib diisi'; end if;
      update public.guidance_sessions set status = 'ditolak', alasan_status = p_alasan where id = p_id;
      if v_s.milestone_id is not null then
        select * into v_ms from public.thesis_milestones where id = v_s.milestone_id;
        if v_ms.status = 'menunggu_review' then
          perform priv.set_milestone_status(v_ms.id, 'dikerjakan', 'Pengajuan bimbingan ditolak');
        end if;
      end if;
      perform priv.notify(v_s.mahasiswa_id, 'bimbingan_ditolak', 'Pengajuan bimbingan ditolak',
        v_s.topik || ' — ' || p_alasan, '/bimbingan/' || p_id);
    else
      raise exception 'Aksi tidak dikenal: %', p_aksi;
    end if;
  end if;
end;
$$;

-- 7. Dosen mengisi catatan bimbingan; hasilnya menggerakkan milestone
create or replace function public.catat_bimbingan(
  p_id uuid, p_ringkasan text, p_saran text, p_tindak_lanjut text,
  p_hasil public.session_result, p_sahkan boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := priv.require_user();
  v_s public.guidance_sessions;
  v_ms public.thesis_milestones;
  v_label text;
begin
  select * into v_s from public.guidance_sessions where id = p_id for update;
  if not found then raise exception 'Sesi bimbingan tidak ditemukan'; end if;
  if v_s.dosen_id <> v_uid or not priv.is_supervisor_of(v_s.thesis_id) then
    raise exception 'Hanya dosen pembimbing sesi ini yang dapat mengisi catatan';
  end if;
  if not (v_s.status in ('diajukan','dijadwalkan') or (v_s.status = 'selesai' and not v_s.disahkan)) then
    raise exception 'Catatan sesi yang sudah disahkan tidak dapat diubah';
  end if;
  if length(trim(coalesce(p_ringkasan, ''))) = 0 then raise exception 'Ringkasan bimbingan wajib diisi'; end if;
  if p_hasil is null then raise exception 'Status hasil bimbingan wajib dipilih'; end if;

  update public.guidance_sessions set
    status = 'selesai',
    tanggal_jadwal = coalesce(tanggal_jadwal, tanggal_usulan),
    ringkasan = trim(p_ringkasan),
    saran = nullif(trim(coalesce(p_saran, '')), ''),
    tindak_lanjut = nullif(trim(coalesce(p_tindak_lanjut, '')), ''),
    hasil = p_hasil,
    catatan_at = now(),
    disahkan = coalesce(p_sahkan, false),
    disahkan_at = case when p_sahkan then now() else null end
  where id = p_id;

  if v_s.milestone_id is not null then
    select * into v_ms from public.thesis_milestones where id = v_s.milestone_id;
    if v_ms.jenis = 'pembimbing_setuju' and v_ms.status <> 'selesai' then
      if p_hasil = 'revisi' then
        perform priv.set_milestone_status(v_ms.id, 'revisi', 'Revisi dari pembimbing: ' || left(trim(p_ringkasan), 200));
      elsif p_hasil = 'disetujui' then
        perform priv.set_milestone_status(v_ms.id, 'dikerjakan', 'Progres disetujui pembimbing, lanjutkan pengerjaan');
      elsif p_hasil = 'lanjut' then
        perform priv.complete_milestone(v_ms.id, 'Disetujui pembimbing pada sesi bimbingan', 'Sesi ' || to_char(coalesce(v_s.tanggal_jadwal, v_s.tanggal_usulan), 'DD-MM-YYYY'));
      end if;
    end if;
  end if;

  -- jumlah bimbingan bertambah: periksa ulang milestone syarat otomatis
  perform priv.activate_next(v_s.thesis_id);

  v_label := case p_hasil when 'revisi' then 'Revisi' when 'lanjut' then 'Bab disetujui, lanjut ke tahap berikutnya' else 'Disetujui, lanjutkan pengerjaan' end;
  perform priv.notify(v_s.mahasiswa_id, 'catatan_bimbingan', 'Catatan bimbingan tersedia',
    v_s.topik || ' — ' || v_label, '/bimbingan/' || p_id);
end;
$$;

-- 8. Dosen mengesahkan sesi
create or replace function public.sahkan_bimbingan(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := priv.require_user(); v_s public.guidance_sessions;
begin
  select * into v_s from public.guidance_sessions where id = p_id for update;
  if not found or v_s.dosen_id <> v_uid then raise exception 'Sesi bimbingan tidak ditemukan'; end if;
  if v_s.status <> 'selesai' then raise exception 'Isi catatan bimbingan sebelum mengesahkan'; end if;
  update public.guidance_sessions set disahkan = true, disahkan_at = now() where id = p_id;
end;
$$;

-- 9. Mahasiswa menandai tindak lanjut selesai
create or replace function public.tandai_tindak_lanjut(p_id uuid, p_selesai boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := priv.require_user(); v_s public.guidance_sessions;
begin
  select * into v_s from public.guidance_sessions where id = p_id;
  if not found or v_s.mahasiswa_id <> v_uid then raise exception 'Sesi bimbingan tidak ditemukan'; end if;
  if v_s.status <> 'selesai' then raise exception 'Sesi belum memiliki catatan dari dosen'; end if;
  update public.guidance_sessions
    set tindak_lanjut_selesai = p_selesai, tindak_lanjut_selesai_at = case when p_selesai then now() end
    where id = p_id;
  if p_selesai then
    perform priv.notify(v_s.dosen_id, 'tindak_lanjut', 'Tindak lanjut diselesaikan',
      'Mahasiswa menandai tindak lanjut "' || v_s.topik || '" selesai.', '/bimbingan/' || p_id);
  end if;
end;
$$;

-- 10. Ubah tenggat milestone (wajib alasan)
create or replace function public.ubah_tenggat_milestone(p_id uuid, p_tenggat date, p_alasan text)
returns void language plpgsql security definer set search_path = public as $$
declare v_m public.thesis_milestones;
begin
  perform priv.require_user();
  select * into v_m from public.thesis_milestones where id = p_id;
  if not found then raise exception 'Milestone tidak ditemukan'; end if;
  if not (priv.is_supervisor_of(v_m.thesis_id) or priv.can_manage_thesis(v_m.thesis_id)) then
    raise exception 'Hanya pembimbing atau Ka. Prodi yang dapat mengubah tenggat';
  end if;
  if length(trim(coalesce(p_alasan, ''))) = 0 then raise exception 'Alasan perubahan tenggat wajib diisi'; end if;
  if p_tenggat is null then raise exception 'Tenggat baru wajib diisi'; end if;
  perform set_config('simsa.alasan', p_alasan, true);
  update public.thesis_milestones set tenggat = p_tenggat, diubah_oleh = auth.uid() where id = p_id;
  perform set_config('simsa.alasan', '', true);
  perform priv.log('ubah_tenggat', 'thesis_milestones', p_id::text,
    jsonb_build_object('tenggat', v_m.tenggat), jsonb_build_object('tenggat', p_tenggat, 'alasan', p_alasan));
end;
$$;

-- 11. Menyelesaikan milestone yang bukti penyelesaiannya di luar bimbingan
create or replace function public.selesaikan_milestone(p_id uuid, p_catatan text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_m public.thesis_milestones;
  v_th public.thesis;
  v_boleh boolean;
begin
  perform priv.require_user();
  select * into v_m from public.thesis_milestones where id = p_id;
  if not found then raise exception 'Milestone tidak ditemukan'; end if;
  select * into v_th from public.thesis where id = v_m.thesis_id;
  if v_m.status = 'selesai' then raise exception 'Milestone sudah selesai'; end if;
  if exists (select 1 from public.thesis_milestones where thesis_id = v_m.thesis_id and urutan < v_m.urutan and status <> 'selesai') then
    raise exception 'Selesaikan milestone sebelumnya terlebih dahulu';
  end if;
  if length(trim(coalesce(p_catatan, ''))) = 0 then
    raise exception 'Catatan bukti wajib diisi (mis. nomor berita acara)';
  end if;

  v_boleh := case v_m.jenis
    when 'pembimbing_setuju' then priv.is_supervisor_of(v_m.thesis_id)
    when 'seminar' then priv.is_baak_of(v_th.prodi_id) or priv.can_manage_thesis(v_m.thesis_id)
    when 'penguji_setuju' then priv.is_baak_of(v_th.prodi_id) or priv.can_manage_thesis(v_m.thesis_id)
    when 'arsip' then priv.is_baak_of(v_th.prodi_id) or priv.is_admin()
    when 'syarat_otomatis' then priv.can_manage_thesis(v_m.thesis_id)
    else false
  end;
  if not v_boleh then
    raise exception 'Anda tidak berwenang menyelesaikan milestone ini';
  end if;

  perform priv.complete_milestone(p_id, 'Diselesaikan dengan bukti: ' || trim(p_catatan), trim(p_catatan));
  perform priv.notify(v_th.mahasiswa_id, 'milestone_selesai', 'Milestone selesai', v_m.nama, '/milestone');
end;
$$;

-- 12. Ubah status studi akhir (cuti, aktif kembali, berhenti)
create or replace function public.ubah_status_thesis(p_thesis uuid, p_status text, p_alasan text)
returns void language plpgsql security definer set search_path = public as $$
declare v_th public.thesis;
begin
  perform priv.require_user();
  select * into v_th from public.thesis where id = p_thesis;
  if not found then raise exception 'Studi akhir tidak ditemukan'; end if;
  if not priv.can_manage_thesis(p_thesis) then raise exception 'Anda tidak berwenang'; end if;
  if p_status not in ('aktif','cuti','berhenti') then raise exception 'Status tidak valid'; end if;
  if length(trim(coalesce(p_alasan, ''))) = 0 then raise exception 'Alasan wajib diisi'; end if;
  update public.thesis set status = p_status where id = p_thesis;
  perform priv.log('ubah_status_thesis', 'thesis', p_thesis::text,
    jsonb_build_object('status', v_th.status), jsonb_build_object('status', p_status, 'alasan', p_alasan));
  perform priv.notify(v_th.mahasiswa_id, 'status_studi', 'Status studi akhir berubah',
    'Status menjadi ' || p_status || '. Alasan: ' || p_alasan, '/');
end;
$$;

-- 13. Cek syarat (untuk ditampilkan di UI)
create or replace function public.cek_syarat_milestone(p_milestone uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_m public.thesis_milestones;
begin
  perform priv.require_user();
  select * into v_m from public.thesis_milestones where id = p_milestone;
  if not found or not priv.can_view_thesis(v_m.thesis_id) then raise exception 'Milestone tidak ditemukan'; end if;
  return priv.cek_syarat(v_m.thesis_id, v_m.urutan);
end;
$$;

-- 14. Pemeriksaan kemiripan judul (trigram + full-text)
create or replace function public.cek_kemiripan_judul(p_judul text, p_prodi uuid default null, p_kecuali uuid default null)
returns table (sumber text, id uuid, judul text, tahun int, status text, skor real)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare v_prodi uuid;
begin
  perform priv.require_user();
  v_prodi := coalesce(p_prodi, (select prodi_id from public.profiles where id = auth.uid()));
  if length(trim(coalesce(p_judul, ''))) < 5 then return; end if;
  return query
  select * from (
    select 'studi_akhir'::text, t.id, t.judul, extract(year from t.mulai)::int, t.status::text,
           greatest(similarity(t.judul, p_judul),
                    ts_rank(to_tsvector('simple', t.judul), plainto_tsquery('simple', p_judul)))::real as skor
    from public.thesis t
    where (v_prodi is null or t.prodi_id = v_prodi)
      and (p_kecuali is null or t.id <> p_kecuali)
      and (t.judul % p_judul or to_tsvector('simple', t.judul) @@ plainto_tsquery('simple', p_judul))
    union all
    select 'pengajuan'::text, s.id, s.judul, extract(year from s.created_at)::int, s.status::text,
           similarity(s.judul, p_judul)::real
    from public.title_submissions s
    where (v_prodi is null or s.prodi_id = v_prodi)
      and (p_kecuali is null or s.id <> p_kecuali)
      and s.status in ('diajukan','revisi')
      and s.thesis_id is null
      and s.judul % p_judul
  ) x
  order by skor desc
  limit 10;
end;
$$;

-- 15. Beban bimbingan dosen (untuk penetapan pembimbing dan dashboard)
create or replace function public.beban_dosen(p_prodi uuid default null)
returns table (dosen_id uuid, nama text, nidn text, prodi_id uuid, prodi_nama text, bidang_keahlian text[],
               kuota int, bimbingan_aktif int, sebagai_p1 int, sebagai_p2 int)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  perform priv.require_user();
  if not priv.is_staff() then raise exception 'Hanya untuk staf'; end if;
  return query
  select p.id, p.nama, p.nidn, p.prodi_id, pr.nama, p.bidang_keahlian,
         coalesce(p.kuota_bimbingan, pr.kuota_bimbingan_default, 10)::int,
         count(s.id) filter (where t.status = 'aktif')::int,
         count(s.id) filter (where t.status = 'aktif' and s.peran = 'P1')::int,
         count(s.id) filter (where t.status = 'aktif' and s.peran = 'P2')::int
  from public.profiles p
  join public.user_roles ur on ur.user_id = p.id and ur.role = 'dosen'
  left join public.prodi pr on pr.id = p.prodi_id
  left join public.thesis_supervisors s on s.dosen_id = p.id and s.aktif
  left join public.thesis t on t.id = s.thesis_id
  where p.aktif and (p_prodi is null or p.prodi_id = p_prodi)
  group by p.id, p.nama, p.nidn, p.prodi_id, pr.nama, p.bidang_keahlian, p.kuota_bimbingan, pr.kuota_bimbingan_default
  order by p.nama;
end;
$$;

-- 16. Tandai notifikasi dibaca (null = semua)
create or replace function public.baca_notifikasi(p_id uuid default null)
returns void language sql security definer set search_path = public as $$
  update public.notifications set dibaca_at = now()
  where user_id = auth.uid() and dibaca_at is null and (p_id is null or id = p_id);
$$;

-- ---------------------------------------------------------------------
-- View progres (mengikuti RLS pemanggil)
-- ---------------------------------------------------------------------
create or replace view public.v_thesis_progress with (security_invoker = true) as
select
  th.id as thesis_id,
  th.mahasiswa_id,
  p.nama as mahasiswa_nama,
  p.nim,
  p.angkatan,
  th.prodi_id,
  pr.kode as prodi_kode,
  pr.nama as prodi_nama,
  th.jenjang,
  th.judul,
  th.status,
  th.mulai,
  coalesce(prog.persen, 0)::numeric(5,1) as persen,
  coalesce(prog.total, 0)::int as milestone_total,
  coalesce(prog.jumlah_selesai, 0)::int as milestone_selesai,
  cur.id as milestone_id,
  cur.urutan as milestone_urutan,
  cur.nama as milestone_nama,
  cur.status as milestone_status,
  cur.tenggat as milestone_tenggat,
  greatest(0, current_date - cur.tenggat)::int as hari_terlambat,
  lg.terakhir as bimbingan_terakhir,
  (current_date - coalesce(lg.terakhir::date, th.mulai))::int as hari_tanpa_bimbingan,
  coalesce(lg.jumlah, 0)::int as jumlah_bimbingan,
  sup.p1_id, sup.p1_nama, sup.p2_id, sup.p2_nama,
  case
    when th.status <> 'aktif' then 'abu'
    when cur.id is null then 'hijau'
    when greatest(0, current_date - cur.tenggat) >= pr.hari_terlambat_merah
      or (current_date - coalesce(lg.terakhir::date, th.mulai)) >= pr.hari_tanpa_bimbingan_merah then 'merah'
    when greatest(0, current_date - cur.tenggat) >= pr.hari_terlambat_kuning
      or (current_date - coalesce(lg.terakhir::date, th.mulai)) >= pr.hari_tanpa_bimbingan_kuning
      or (cur.tenggat - current_date) between 0 and 7 then 'kuning'
    else 'hijau'
  end as risiko
from public.thesis th
join public.profiles p on p.id = th.mahasiswa_id
join public.prodi pr on pr.id = th.prodi_id
left join lateral (
  select round(100 * sum(m.bobot) filter (where m.status = 'selesai') / nullif(sum(m.bobot), 0), 1) as persen,
         count(*) as total,
         count(*) filter (where m.status = 'selesai') as jumlah_selesai
  from public.thesis_milestones m where m.thesis_id = th.id
) prog on true
left join lateral (
  select m.* from public.thesis_milestones m
  where m.thesis_id = th.id and m.status <> 'selesai'
  order by m.urutan limit 1
) cur on true
left join lateral (
  select max(coalesce(g.tanggal_jadwal, g.tanggal_usulan)) as terakhir, count(*) as jumlah
  from public.guidance_sessions g where g.thesis_id = th.id and g.status = 'selesai'
) lg on true
left join lateral (
  select
    (max(s.dosen_id::text) filter (where s.peran = 'P1'))::uuid as p1_id,
    max(d.nama) filter (where s.peran = 'P1') as p1_nama,
    (max(s.dosen_id::text) filter (where s.peran = 'P2'))::uuid as p2_id,
    max(d.nama) filter (where s.peran = 'P2') as p2_nama
  from public.thesis_supervisors s join public.profiles d on d.id = s.dosen_id
  where s.thesis_id = th.id and s.aktif
) sup on true;

-- ---------------------------------------------------------------------
-- Hak eksekusi: fungsi internal tidak dapat dipanggil langsung oleh klien
-- ---------------------------------------------------------------------
revoke all on schema priv from public;
grant usage on schema priv to authenticated, service_role;
revoke execute on all functions in schema priv from public;
grant execute on function
  priv.has_role(public.app_role), priv.is_admin(), priv.is_staff(), priv.is_kaprodi_of(uuid),
  priv.is_baak_of(uuid), priv.is_supervisor_of(uuid), priv.is_thesis_owner(uuid),
  priv.can_view_thesis(uuid), priv.can_manage_thesis(uuid), priv.can_view_profile(uuid), priv.try_uuid(text)
  to authenticated;

revoke execute on function
  public.ajukan_judul(jsonb), public.putuskan_judul(uuid, public.title_status, text),
  public.tetapkan_pembimbing(uuid, uuid, public.supervisor_role, text), public.lepas_pembimbing(uuid, text),
  public.catat_dokumen(uuid, text, uuid, text, text, bigint, text, text),
  public.ajukan_bimbingan(uuid, uuid, public.session_mode, timestamptz, text, text, uuid, uuid),
  public.tanggapi_bimbingan(uuid, text, timestamptz, text, text),
  public.catat_bimbingan(uuid, text, text, text, public.session_result, boolean),
  public.sahkan_bimbingan(uuid), public.tandai_tindak_lanjut(uuid, boolean),
  public.ubah_tenggat_milestone(uuid, date, text), public.selesaikan_milestone(uuid, text),
  public.ubah_status_thesis(uuid, text, text), public.cek_syarat_milestone(uuid),
  public.cek_kemiripan_judul(text, uuid, uuid), public.beban_dosen(uuid), public.baca_notifikasi(uuid)
  from public, anon;

grant execute on function
  public.ajukan_judul(jsonb), public.putuskan_judul(uuid, public.title_status, text),
  public.tetapkan_pembimbing(uuid, uuid, public.supervisor_role, text), public.lepas_pembimbing(uuid, text),
  public.catat_dokumen(uuid, text, uuid, text, text, bigint, text, text),
  public.ajukan_bimbingan(uuid, uuid, public.session_mode, timestamptz, text, text, uuid, uuid),
  public.tanggapi_bimbingan(uuid, text, timestamptz, text, text),
  public.catat_bimbingan(uuid, text, text, text, public.session_result, boolean),
  public.sahkan_bimbingan(uuid), public.tandai_tindak_lanjut(uuid, boolean),
  public.ubah_tenggat_milestone(uuid, date, text), public.selesaikan_milestone(uuid, text),
  public.ubah_status_thesis(uuid, text, text), public.cek_syarat_milestone(uuid),
  public.cek_kemiripan_judul(text, uuid, uuid), public.beban_dosen(uuid), public.baca_notifikasi(uuid)
  to authenticated;

-- ===================== supabase/migrations/20261028000300_rls.sql =====================
-- =====================================================================
-- SIMSA — Migrasi 3: Row Level Security
-- Prinsip: least privilege. Perubahan alur kerja (judul, pembimbing,
-- bimbingan, milestone) hanya lewat fungsi RPC; tabel hanya membuka
-- akses baca sesuai peran, plus sedikit penulisan langsung yang aman.
-- =====================================================================

alter table public.prodi enable row level security;
alter table public.academic_years enable row level security;
alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.guidelines enable row level security;
alter table public.guideline_sections enable row level security;
alter table public.guideline_bookmarks enable row level security;
alter table public.thesis enable row level security;
alter table public.title_submissions enable row level security;
alter table public.thesis_supervisors enable row level security;
alter table public.milestone_templates enable row level security;
alter table public.thesis_milestones enable row level security;
alter table public.milestone_history enable row level security;
alter table public.documents enable row level security;
alter table public.guidance_sessions enable row level security;
alter table public.comments enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_logs enable row level security;

-- ---------------------------------------------------------------------
-- Master data: semua pengguna login dapat membaca; Admin mengelola
-- ---------------------------------------------------------------------
create policy prodi_select on public.prodi for select to authenticated using (true);
create policy prodi_admin on public.prodi for all to authenticated
  using (priv.is_admin()) with check (priv.is_admin());
-- Ka. Prodi boleh mengubah parameter prodinya sendiri (ambang, kuota, min. bimbingan)
create policy prodi_kaprodi_update on public.prodi for update to authenticated
  using (priv.is_kaprodi_of(id)) with check (priv.is_kaprodi_of(id));

create policy academic_years_select on public.academic_years for select to authenticated using (true);
create policy academic_years_admin on public.academic_years for all to authenticated
  using (priv.is_admin()) with check (priv.is_admin());

-- ---------------------------------------------------------------------
-- Profil dan peran
-- ---------------------------------------------------------------------
create policy profiles_select on public.profiles for select to authenticated
  using (priv.can_view_profile(id));
-- Pengguna dapat memperbarui kontak sendiri; kolom sensitif dikunci lewat GRANT kolom di bawah
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_admin on public.profiles for all to authenticated
  using (priv.is_admin()) with check (priv.is_admin());

revoke update on public.profiles from authenticated;
grant update (nama, telepon, bidang_keahlian) on public.profiles to authenticated;

create policy user_roles_select on public.user_roles for select to authenticated
  using (user_id = auth.uid() or priv.is_admin() or role <> 'mahasiswa' or priv.can_view_profile(user_id));
create policy user_roles_admin on public.user_roles for all to authenticated
  using (priv.is_admin()) with check (priv.is_admin());

-- ---------------------------------------------------------------------
-- Pedoman
-- ---------------------------------------------------------------------
create policy guidelines_select on public.guidelines for select to authenticated
  using (aktif or priv.is_admin() or priv.is_kaprodi_of(prodi_id));
create policy guidelines_manage on public.guidelines for all to authenticated
  using (priv.is_admin() or priv.is_kaprodi_of(prodi_id))
  with check (priv.is_admin() or priv.is_kaprodi_of(prodi_id));

create policy guideline_sections_select on public.guideline_sections for select to authenticated
  using (exists (select 1 from public.guidelines g where g.id = guideline_id
                 and (g.aktif or priv.is_admin() or priv.is_kaprodi_of(g.prodi_id))));
create policy guideline_sections_manage on public.guideline_sections for all to authenticated
  using (exists (select 1 from public.guidelines g where g.id = guideline_id
                 and (priv.is_admin() or priv.is_kaprodi_of(g.prodi_id))))
  with check (exists (select 1 from public.guidelines g where g.id = guideline_id
                 and (priv.is_admin() or priv.is_kaprodi_of(g.prodi_id))));

create policy guideline_bookmarks_own on public.guideline_bookmarks for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- Studi akhir dan turunannya
-- ---------------------------------------------------------------------
create policy thesis_select on public.thesis for select to authenticated
  using (priv.can_view_thesis(id));
-- Ka. Prodi/Admin boleh merapikan judul, abstrak, kata kunci (perubahan status lewat RPC)
create policy thesis_update on public.thesis for update to authenticated
  using (priv.can_manage_thesis(id)) with check (priv.can_manage_thesis(id));
revoke update on public.thesis from authenticated;
grant update (judul, abstrak, bidang_kajian, kata_kunci, guideline_id) on public.thesis to authenticated;

create policy title_submissions_select on public.title_submissions for select to authenticated
  using (mahasiswa_id = auth.uid() or priv.is_kaprodi_of(prodi_id) or priv.is_baak_of(prodi_id)
         or priv.has_role('pimpinan') or priv.is_admin());

create policy thesis_supervisors_select on public.thesis_supervisors for select to authenticated
  using (priv.can_view_thesis(thesis_id) or dosen_id = auth.uid());

create policy milestone_templates_select on public.milestone_templates for select to authenticated using (true);
create policy milestone_templates_manage on public.milestone_templates for all to authenticated
  using (priv.is_admin() or (prodi_id is not null and priv.is_kaprodi_of(prodi_id)))
  with check (priv.is_admin() or (prodi_id is not null and priv.is_kaprodi_of(prodi_id)));

create policy thesis_milestones_select on public.thesis_milestones for select to authenticated
  using (priv.can_view_thesis(thesis_id));

create policy milestone_history_select on public.milestone_history for select to authenticated
  using (priv.can_view_thesis(thesis_id));

create policy documents_select on public.documents for select to authenticated
  using (priv.can_view_thesis(thesis_id));

create policy guidance_sessions_select on public.guidance_sessions for select to authenticated
  using (priv.can_view_thesis(thesis_id));

-- Komentar: mahasiswa pemilik dan pembimbing dapat berdiskusi; Ka. Prodi dapat ikut berkomentar
create policy comments_select on public.comments for select to authenticated
  using (priv.can_view_thesis(thesis_id));
create policy comments_insert on public.comments for insert to authenticated
  with check (
    penulis_id = auth.uid()
    and (priv.is_thesis_owner(thesis_id) or priv.is_supervisor_of(thesis_id) or priv.can_manage_thesis(thesis_id))
    and (document_id is null or exists (select 1 from public.documents d where d.id = document_id and d.thesis_id = comments.thesis_id))
    and (session_id is null or exists (select 1 from public.guidance_sessions s where s.id = session_id and s.thesis_id = comments.thesis_id))
  );
create policy comments_update on public.comments for update to authenticated
  using (penulis_id = auth.uid() or priv.is_thesis_owner(thesis_id) or priv.is_supervisor_of(thesis_id))
  with check (penulis_id = auth.uid() or priv.is_thesis_owner(thesis_id) or priv.is_supervisor_of(thesis_id));
revoke update on public.comments from authenticated;
grant update (selesai) on public.comments to authenticated;
create policy comments_delete on public.comments for delete to authenticated
  using (penulis_id = auth.uid());

-- ---------------------------------------------------------------------
-- Notifikasi dan audit
-- ---------------------------------------------------------------------
create policy notifications_own on public.notifications for select to authenticated
  using (user_id = auth.uid());
create policy notifications_update_own on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke update on public.notifications from authenticated;
grant update (dibaca_at) on public.notifications to authenticated;

create policy audit_logs_admin on public.audit_logs for select to authenticated
  using (priv.is_admin());

-- Tidak ada akses untuk anon
revoke all on all tables in schema public from anon;

-- Notifikasi real-time (Supabase Realtime menghormati RLS)
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.notifications;
  end if;
end;
$$;

-- Ka. Prodi hanya boleh mengubah parameter prodi, bukan identitasnya
create or replace function priv.guard_prodi_identity()
returns trigger language plpgsql as $$
begin
  if not priv.is_admin() and auth.uid() is not null and (
    new.kode is distinct from old.kode or new.nama is distinct from old.nama
    or new.jenjang is distinct from old.jenjang or new.fakultas is distinct from old.fakultas
  ) then
    raise exception 'Hanya Admin yang dapat mengubah kode, nama, jenjang, atau fakultas prodi';
  end if;
  return new;
end;
$$;
create trigger prodi_guard_identity before update on public.prodi
  for each row execute function priv.guard_prodi_identity();

-- ===================== supabase/migrations/20261028000400_storage.sql =====================
-- =====================================================================
-- SIMSA — Migrasi 4: Supabase Storage
--   drafts     : draf skripsi/TA (privat). Path wajib: {thesis_id}/{nama-berkas}
--   guidelines : PDF pedoman asli (dapat dibaca semua pengguna login)
-- Akses berkas memakai signed URL berumur pendek dari aplikasi.
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('drafts', 'drafts', false, 20971520, array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]),
  ('guidelines', 'guidelines', false, 52428800, array['application/pdf'])
on conflict (id) do nothing;

create policy drafts_select on storage.objects for select to authenticated
  using (bucket_id = 'drafts' and priv.can_view_thesis(priv.try_uuid((storage.foldername(name))[1])));

create policy drafts_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'drafts'
    and (
      priv.is_thesis_owner(priv.try_uuid((storage.foldername(name))[1]))
      or priv.is_supervisor_of(priv.try_uuid((storage.foldername(name))[1]))
    )
  );

create policy guidelines_files_select on storage.objects for select to authenticated
  using (bucket_id = 'guidelines');

create policy guidelines_files_manage on storage.objects for insert to authenticated
  with check (bucket_id = 'guidelines' and (priv.is_admin() or priv.has_role('kaprodi')));

create policy guidelines_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'guidelines' and (priv.is_admin() or priv.has_role('kaprodi')));

-- ===================== supabase/migrations/20261028000500_default_templates.sql =====================
-- =====================================================================
-- SIMSA — Migrasi 5: template milestone default institusi (PRD 10.1)
-- prodi_id = null berarti berlaku untuk semua prodi pada jenjang itu,
-- kecuali prodi membuat template sendiri.
-- Bobot total tiap jenjang = 100. Durasi dalam hari.
-- =====================================================================

insert into public.milestone_templates (prodi_id, jenjang, urutan, kode, nama, bukti, jenis, bobot, durasi_hari) values
  (null, 'S1',  1, 'JUDUL',      'Judul disetujui',               'Persetujuan Ka. Prodi', 'judul', 2, 14),
  (null, 'S1',  2, 'PEMBIMBING', 'Pembimbing ditetapkan',         'SK/penetapan', 'pembimbing', 2, 14),
  (null, 'S1',  3, 'BAB1',       'Bab 1 Pendahuluan',             'Persetujuan pembimbing', 'pembimbing_setuju', 8, 30),
  (null, 'S1',  4, 'BAB2',       'Bab 2 Tinjauan Pustaka',        'Persetujuan pembimbing', 'pembimbing_setuju', 8, 30),
  (null, 'S1',  5, 'BAB3',       'Bab 3 Metodologi',              'Persetujuan pembimbing', 'pembimbing_setuju', 8, 30),
  (null, 'S1',  6, 'SEMPRO',     'Seminar Proposal',              'Berita acara, status lulus', 'seminar', 10, 14),
  (null, 'S1',  7, 'DATA',       'Pengumpulan dan Analisis Data', 'Persetujuan pembimbing', 'pembimbing_setuju', 10, 45),
  (null, 'S1',  8, 'BAB4',       'Bab 4 Hasil dan Pembahasan',    'Persetujuan pembimbing', 'pembimbing_setuju', 12, 30),
  (null, 'S1',  9, 'BAB5',       'Bab 5 Kesimpulan',              'Persetujuan pembimbing', 'pembimbing_setuju', 6, 14),
  (null, 'S1', 10, 'SEMHAS',     'Seminar Hasil',                 'Berita acara, status lulus', 'seminar', 10, 14),
  (null, 'S1', 11, 'SIAP_PENDADARAN', 'Siap Pendadaran',          'Syarat otomatis terpenuhi (bimbingan minimum, persetujuan pembimbing, berkas administrasi)', 'syarat_otomatis', 2, 7),
  (null, 'S1', 12, 'PENDADARAN', 'Pendadaran',                    'Berita acara, nilai', 'seminar', 12, 14),
  (null, 'S1', 13, 'REVISI',     'Revisi Pasca Pendadaran',       'Persetujuan penguji', 'penguji_setuju', 6, 30),
  (null, 'S1', 14, 'ARSIP',      'Naskah Final Diarsipkan',       'Unggahan final dan lembar pengesahan', 'arsip', 4, 14),

  (null, 'D3',  1, 'JUDUL',      'Judul Tugas Akhir disetujui',   'Persetujuan Ka. Prodi', 'judul', 2, 14),
  (null, 'D3',  2, 'PEMBIMBING', 'Pembimbing ditetapkan',         'SK/penetapan', 'pembimbing', 2, 14),
  (null, 'D3',  3, 'BAB_AWAL',   'Penyusunan bab awal',           'Persetujuan pembimbing (struktur sesuai Pedoman D3)', 'pembimbing_setuju', 15, 30),
  (null, 'D3',  4, 'PELAKSANAAN','Pelaksanaan Tugas Akhir',       'Persetujuan pembimbing (perancangan, implementasi, atau pengumpulan data)', 'pembimbing_setuju', 20, 45),
  (null, 'D3',  5, 'NASKAH',     'Penulisan naskah lengkap',      'Persetujuan pembimbing', 'pembimbing_setuju', 15, 30),
  (null, 'D3',  6, 'SEMTUP',     'Seminar Tertutup Tugas Akhir',  'Berita acara, status lulus', 'seminar', 14, 14),
  (null, 'D3',  7, 'SIAP_KOMPRE','Siap Komprehensif',             'Syarat otomatis terpenuhi (bimbingan minimum, persetujuan pembimbing, berkas administrasi)', 'syarat_otomatis', 2, 7),
  (null, 'D3',  8, 'KOMPRE',     'Komprehensif',                  'Berita acara, nilai', 'seminar', 14, 14),
  (null, 'D3',  9, 'REVISI',     'Revisi Pasca Ujian',            'Persetujuan penguji', 'penguji_setuju', 8, 30),
  (null, 'D3', 10, 'ARSIP',      'Naskah Final Diarsipkan',       'Unggahan final dan lembar pengesahan', 'arsip', 8, 14)
on conflict on constraint milestone_templates_unik do nothing;

-- ===================== supabase/migrations/20261028000600_alur_stikom.sql =====================
-- =====================================================================
-- SIMSA — Migrasi 6: alur studi akhir STIKOM Yos Sudarso
--   * Pendaftaran TA (judul sementara + sinopsis), diterima Ka. Prodi
--   * Ploting dosen oleh Ka. Prodi: P1, P2, Penguji seminar, Tim pendadaran
--   * ACC per bab oleh Pembimbing 1 DAN Pembimbing 2
--   * Ujian: Seminar Proposal, Seminar Hasil, Pendadaran (S1), Ujian TA D3
--     dengan form penilaian yang diatur Admin, nilai 40–100, rata-rata panel,
--     konversi huruf, hasil Lulus (revisi minor/mayor) / Mengulang
--   * Revisi pascaseminar dengan ACC digital seluruh panel dan kode verifikasi
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Jenis milestone menjadi teks (lebih mudah dikembangkan)
-- ---------------------------------------------------------------------
drop view if exists public.v_thesis_progress;
alter table public.milestone_templates alter column jenis type text using jenis::text;
alter table public.thesis_milestones alter column jenis type text using jenis::text;
drop type if exists public.milestone_kind;

alter table public.milestone_templates
  add constraint milestone_templates_jenis_check check (jenis in (
    'judul','pembimbing','pembimbing_setuju','ujian','revisi','berkas','yudisium','sk',
    'seminar','syarat_otomatis','penguji_setuju','arsip')),
  add column if not exists ujian_jenis text check (ujian_jenis in ('sempro','semhas','pendadaran','d3'));
alter table public.thesis_milestones add column if not exists ujian_jenis text;

-- Template baru sesuai alur kampus (template lama dihapus; studi akhir yang sudah berjalan tidak berubah)
delete from public.milestone_templates;

insert into public.milestone_templates (prodi_id, jenjang, urutan, kode, nama, bukti, jenis, ujian_jenis, bobot, durasi_hari) values
  (null,'S1', 1,'PENDAFTARAN','Pendaftaran tugas akhir diterima','Diterima Ka. Prodi','judul',null,2,14),
  (null,'S1', 2,'PEMBIMBING','Pembimbing ditetapkan','Ploting P1 dan P2 oleh Ka. Prodi','pembimbing',null,3,14),
  (null,'S1', 3,'BAB1','Proposal: Bab 1','ACC Pembimbing 1 dan 2','pembimbing_setuju',null,6,30),
  (null,'S1', 4,'BAB2','Proposal: Bab 2','ACC Pembimbing 1 dan 2','pembimbing_setuju',null,6,30),
  (null,'S1', 5,'BAB3','Proposal: Bab 3','ACC Pembimbing 1 dan 2','pembimbing_setuju',null,6,30),
  (null,'S1', 6,'SEMPRO','Seminar Proposal','Nilai panel dan keputusan lulus','ujian','sempro',10,21),
  (null,'S1', 7,'REVISI_SEMPRO','Revisi Seminar Proposal (proposal selesai)','ACC revisi P1, P2, dan Penguji','revisi','sempro',5,30),
  (null,'S1', 8,'BAB4','Skripsi: Bab 4','ACC Pembimbing 1 dan 2','pembimbing_setuju',null,8,45),
  (null,'S1', 9,'BAB5','Skripsi: Bab 5','ACC Pembimbing 1 dan 2','pembimbing_setuju',null,8,30),
  (null,'S1',10,'SEMHAS','Seminar Hasil','Nilai panel dan keputusan lulus','ujian','semhas',10,21),
  (null,'S1',11,'REVISI_SEMHAS','Revisi Seminar Hasil (skripsi selesai)','ACC revisi P1, P2, dan Penguji','revisi','semhas',5,30),
  (null,'S1',12,'BERKAS_PENDADARAN','Berkas pendadaran lengkap','Diverifikasi BAAK','berkas',null,4,14),
  (null,'S1',13,'PENDADARAN','Pendadaran','Nilai tim penguji dan keputusan lulus','ujian','pendadaran',15,21),
  (null,'S1',14,'BERKAS_YUDISIUM','Berkas yudisium lengkap','Diverifikasi BAAK','berkas',null,3,14),
  (null,'S1',15,'YUDISIUM','Rapat yudisium','Dinyatakan layak dalam rapat','yudisium',null,4,14),
  (null,'S1',16,'SK','Penetapan SK Ketua','SK Ketua STIKOM Yos Sudarso','sk',null,5,14),

  (null,'D3', 1,'PENDAFTARAN','Pendaftaran tugas akhir diterima','Diterima Ka. Prodi','judul',null,2,14),
  (null,'D3', 2,'PEMBIMBING','Pembimbing ditetapkan','Ploting P1 dan P2 oleh Ka. Prodi','pembimbing',null,3,14),
  (null,'D3', 3,'BAB1','Bab 1','ACC Pembimbing 1 dan 2','pembimbing_setuju',null,10,30),
  (null,'D3', 4,'BAB2','Bab 2','ACC Pembimbing 1 dan 2','pembimbing_setuju',null,10,30),
  (null,'D3', 5,'BAB3','Bab 3','ACC Pembimbing 1 dan 2','pembimbing_setuju',null,10,30),
  (null,'D3', 6,'BAB4','Bab 4','ACC Pembimbing 1 dan 2','pembimbing_setuju',null,15,45),
  (null,'D3', 7,'BAB5','Bab 5','ACC Pembimbing 1 dan 2','pembimbing_setuju',null,10,30),
  (null,'D3', 8,'UJIAN_D3','Seminar Tertutup dan Komprehensif','Nilai Pembimbing 1 dan 2','ujian','d3',20,21),
  (null,'D3', 9,'BERKAS_YUDISIUM','Berkas yudisium lengkap','Diverifikasi BAAK','berkas',null,6,14),
  (null,'D3',10,'YUDISIUM','Rapat yudisium','Dinyatakan layak dalam rapat','yudisium',null,6,14),
  (null,'D3',11,'SK','Penetapan SK Ketua','SK Ketua STIKOM Yos Sudarso','sk',null,8,14);

-- generate_milestones ikut menyalin ujian_jenis
create or replace function priv.generate_milestones(p_thesis uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_thesis public.thesis;
  v_prodi_ada boolean;
begin
  select * into v_thesis from public.thesis where id = p_thesis;
  select exists (
    select 1 from public.milestone_templates
    where prodi_id = v_thesis.prodi_id and jenjang = v_thesis.jenjang and aktif
  ) into v_prodi_ada;

  insert into public.thesis_milestones (thesis_id, template_id, urutan, kode, nama, bukti, jenis, ujian_jenis, bobot, tenggat)
  select
    p_thesis, t.id, t.urutan, t.kode, t.nama, t.bukti, t.jenis, t.ujian_jenis, t.bobot,
    v_thesis.mulai + (sum(t.durasi_hari) over (order by t.urutan))::int
  from public.milestone_templates t
  where t.jenjang = v_thesis.jenjang and t.aktif
    and ((v_prodi_ada and t.prodi_id = v_thesis.prodi_id) or (not v_prodi_ada and t.prodi_id is null))
  order by t.urutan;
end;
$$;

-- ---------------------------------------------------------------------
-- 2. Pendaftaran tugas akhir dengan sinopsis
-- ---------------------------------------------------------------------
alter table public.title_submissions
  add column if not exists sinopsis_path text,
  add column if not exists sinopsis_nama text;
alter table public.thesis
  add column if not exists sinopsis_path text,
  add column if not exists sinopsis_nama text,
  add column if not exists pendadaran_wakil text not null default 'P1' check (pendadaran_wakil in ('P1','P2'));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pendaftaran', 'pendaftaran', false, 20971520, array[
  'application/pdf','application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do nothing;

create policy pendaftaran_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'pendaftaran' and (storage.foldername(name))[1] = auth.uid()::text);
create policy pendaftaran_select on storage.objects for select to authenticated
  using (bucket_id = 'pendaftaran' and (
    (storage.foldername(name))[1] = auth.uid()::text
    or (priv.is_staff() and priv.can_view_profile(priv.try_uuid((storage.foldername(name))[1])))
  ));

create table public.thesis_title_history (
  id bigint generated always as identity primary key,
  thesis_id uuid not null references public.thesis (id) on delete cascade,
  judul_lama text not null,
  judul_baru text not null,
  alasan text,
  aktor uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

create or replace function public.daftar_ta(
  p_judul text, p_bidang text, p_abstrak text, p_kata_kunci text[], p_sinopsis_path text, p_sinopsis_nama text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := priv.require_user();
  v_prodi uuid;
  v_nama text;
  v_id uuid;
begin
  if not priv.has_role('mahasiswa') then raise exception 'Hanya mahasiswa yang dapat mendaftar tugas akhir'; end if;
  select prodi_id, nama into v_prodi, v_nama from public.profiles where id = v_uid;
  if v_prodi is null then raise exception 'Prodi pada profil Anda belum diisi. Hubungi Admin.'; end if;
  if exists (select 1 from public.thesis where mahasiswa_id = v_uid and status in ('aktif','cuti','lulus')) then
    raise exception 'Anda sudah terdaftar tugas akhir';
  end if;
  if exists (select 1 from public.title_submissions where mahasiswa_id = v_uid and status = 'diajukan') then
    raise exception 'Pendaftaran Anda masih menunggu keputusan Ka. Prodi';
  end if;
  if length(trim(coalesce(p_judul, ''))) < 10 then raise exception 'Judul minimal 10 karakter'; end if;
  if p_sinopsis_path is null or (storage.foldername(p_sinopsis_path))[1] <> v_uid::text
     or not exists (select 1 from storage.objects where bucket_id = 'pendaftaran' and name = p_sinopsis_path) then
    raise exception 'Sinopsis belum terunggah';
  end if;

  insert into public.title_submissions (mahasiswa_id, prodi_id, kelompok, prioritas, judul, bidang_kajian, abstrak, kata_kunci, sinopsis_path, sinopsis_nama)
  values (v_uid, v_prodi, gen_random_uuid(), 1, trim(p_judul), nullif(trim(coalesce(p_bidang,'')), ''), coalesce(p_abstrak, ''),
          coalesce(p_kata_kunci, '{}'), p_sinopsis_path, p_sinopsis_nama)
  returning id into v_id;

  perform priv.notify_kaprodi(v_prodi, 'pendaftaran_baru', 'Pendaftaran tugas akhir baru',
    v_nama || ' mendaftar tugas akhir: ' || trim(p_judul), '/kaprodi/judul');
  return v_id;
end;
$$;

-- Keputusan pendaftaran (teks notifikasi disesuaikan); logika sama dengan versi sebelumnya
create or replace function public.putuskan_judul(p_id uuid, p_status public.title_status, p_catatan text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := priv.require_user();
  v_sub public.title_submissions;
  v_prodi public.prodi;
  v_thesis uuid;
  v_first uuid;
  v_label text;
begin
  select * into v_sub from public.title_submissions where id = p_id for update;
  if not found then raise exception 'Pendaftaran tidak ditemukan'; end if;
  if not (priv.is_kaprodi_of(v_sub.prodi_id) or priv.is_admin()) then
    raise exception 'Anda tidak berwenang memutuskan pendaftaran pada prodi ini';
  end if;
  if v_sub.status <> 'diajukan' then raise exception 'Pendaftaran ini sudah diputuskan'; end if;
  if p_status not in ('disetujui','revisi','ditolak') then raise exception 'Keputusan tidak valid'; end if;
  if p_status <> 'disetujui' and length(trim(coalesce(p_catatan, ''))) = 0 then
    raise exception 'Catatan wajib diisi untuk keputusan perbaikan atau tolak';
  end if;

  update public.title_submissions
  set status = p_status, catatan_kaprodi = nullif(trim(coalesce(p_catatan,'')), ''), diputuskan_oleh = v_uid, diputuskan_at = now()
  where id = p_id;

  if p_status = 'disetujui' then
    if exists (select 1 from public.thesis where mahasiswa_id = v_sub.mahasiswa_id and status in ('aktif','cuti')) then
      raise exception 'Mahasiswa ini sudah memiliki tugas akhir aktif';
    end if;
    select * into v_prodi from public.prodi where id = v_sub.prodi_id;
    insert into public.thesis (mahasiswa_id, prodi_id, jenjang, academic_year_id, guideline_id, judul, abstrak, bidang_kajian, kata_kunci, sinopsis_path, sinopsis_nama)
    values (
      v_sub.mahasiswa_id, v_sub.prodi_id, v_prodi.jenjang,
      (select id from public.academic_years where aktif limit 1),
      (select id from public.guidelines where prodi_id = v_sub.prodi_id and aktif order by berlaku_mulai desc limit 1),
      v_sub.judul, v_sub.abstrak, v_sub.bidang_kajian, v_sub.kata_kunci, v_sub.sinopsis_path, v_sub.sinopsis_nama
    ) returning id into v_thesis;

    update public.title_submissions set thesis_id = v_thesis where id = p_id;
    update public.title_submissions
      set status = 'dibatalkan', catatan_kaprodi = 'Judul lain dalam pengajuan ini telah disetujui', diputuskan_oleh = v_uid, diputuskan_at = now()
      where kelompok = v_sub.kelompok and id <> p_id and status = 'diajukan';

    perform priv.generate_milestones(v_thesis);
    select id into v_first from public.thesis_milestones where thesis_id = v_thesis and jenis = 'judul' order by urutan limit 1;
    if v_first is not null then
      perform priv.complete_milestone(v_first, 'Pendaftaran diterima Ka. Prodi', null);
    else
      perform priv.activate_next(v_thesis);
    end if;
  end if;

  v_label := case p_status when 'disetujui' then 'diterima' when 'revisi' then 'perlu diperbaiki' else 'ditolak' end;
  perform priv.notify(v_sub.mahasiswa_id, 'pendaftaran_diputuskan', 'Pendaftaran tugas akhir ' || v_label,
    '"' || v_sub.judul || '" ' || v_label || coalesce('. Catatan: ' || nullif(trim(coalesce(p_catatan,'')), ''), '') || '.', '/judul');
  perform priv.log('putuskan_pendaftaran', 'title_submissions', p_id::text, to_jsonb(v_sub),
    jsonb_build_object('status', p_status, 'catatan', p_catatan, 'thesis_id', v_thesis));
  return v_thesis;
end;
$$;

-- Terima pendaftaran sekaligus ploting P1 dan P2
create or replace function public.terima_pendaftaran(p_id uuid, p_p1 uuid, p_p2 uuid, p_catatan text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_thesis uuid;
begin
  perform priv.require_user();
  if p_p1 is null or p_p2 is null then raise exception 'Pilih Pembimbing 1 dan Pembimbing 2'; end if;
  if p_p1 = p_p2 then raise exception 'Pembimbing 1 dan 2 harus dosen yang berbeda'; end if;
  v_thesis := public.putuskan_judul(p_id, 'disetujui', p_catatan);
  perform public.tetapkan_pembimbing(v_thesis, p_p1, 'P1', null);
  perform public.tetapkan_pembimbing(v_thesis, p_p2, 'P2', null);
  return v_thesis;
end;
$$;

-- Judul dapat diperbarui selama proses; riwayat tersimpan
create or replace function public.ubah_judul(p_thesis uuid, p_judul text, p_alasan text)
returns void language plpgsql security definer set search_path = public as $$
declare v_th public.thesis;
begin
  perform priv.require_user();
  select * into v_th from public.thesis where id = p_thesis;
  if not found then raise exception 'Tugas akhir tidak ditemukan'; end if;
  if not (v_th.mahasiswa_id = auth.uid() or priv.is_supervisor_of(p_thesis) or priv.can_manage_thesis(p_thesis)) then
    raise exception 'Anda tidak berwenang mengubah judul';
  end if;
  if length(trim(coalesce(p_judul, ''))) < 10 then raise exception 'Judul minimal 10 karakter'; end if;
  if length(trim(coalesce(p_alasan, ''))) = 0 then raise exception 'Alasan perubahan judul wajib diisi'; end if;
  if trim(p_judul) = v_th.judul then raise exception 'Judul tidak berubah'; end if;
  insert into public.thesis_title_history (thesis_id, judul_lama, judul_baru, alasan, aktor)
  values (p_thesis, v_th.judul, trim(p_judul), trim(p_alasan), auth.uid());
  update public.thesis set judul = trim(p_judul) where id = p_thesis;
  if v_th.mahasiswa_id <> auth.uid() then
    perform priv.notify(v_th.mahasiswa_id, 'judul_diubah', 'Judul tugas akhir diperbarui', trim(p_judul), '/studi-akhir');
  end if;
  perform priv.notify(s.dosen_id, 'judul_diubah', 'Judul tugas akhir diperbarui', trim(p_judul), '/mahasiswa-bimbingan/' || p_thesis)
  from public.thesis_supervisors s where s.thesis_id = p_thesis and s.aktif and s.dosen_id <> auth.uid();
end;
$$;

-- ---------------------------------------------------------------------
-- 3. Ploting penguji (seminar: 1 dosen; pendadaran: 2 dosen + wakil P1/P2)
-- ---------------------------------------------------------------------
create table public.thesis_examiners (
  id uuid primary key default gen_random_uuid(),
  thesis_id uuid not null references public.thesis (id) on delete cascade,
  dosen_id uuid not null references public.profiles (id),
  tahap text not null check (tahap in ('seminar','pendadaran')),
  urutan int not null default 1,
  aktif boolean not null default true,
  ditetapkan_oleh uuid references public.profiles (id),
  ditetapkan_at timestamptz not null default now()
);
create unique index thesis_examiners_unik on public.thesis_examiners (thesis_id, tahap, dosen_id) where aktif;
create index thesis_examiners_dosen_idx on public.thesis_examiners (dosen_id) where aktif;
create trigger audit_thesis_examiners after insert or update on public.thesis_examiners
  for each row execute function priv.audit_row();

create or replace function public.tetapkan_penguji(p_thesis uuid, p_tahap text, p_dosen uuid[], p_wakil text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_th public.thesis;
  v_d uuid;
  v_i int := 0;
  v_need int;
begin
  perform priv.require_user();
  select * into v_th from public.thesis where id = p_thesis;
  if not found then raise exception 'Tugas akhir tidak ditemukan'; end if;
  if not priv.can_manage_thesis(p_thesis) then raise exception 'Hanya Ka. Prodi yang dapat melakukan ploting penguji'; end if;
  if p_tahap not in ('seminar','pendadaran') then raise exception 'Tahap tidak valid'; end if;
  if v_th.jenjang = 'D3' then raise exception 'Ujian D3 dinilai oleh Pembimbing 1 dan 2, tidak memerlukan penguji'; end if;
  v_need := case p_tahap when 'seminar' then 1 else 2 end;
  if coalesce(array_length(p_dosen, 1), 0) <> v_need
     or (select count(distinct x) from unnest(p_dosen) x) <> v_need then
    raise exception 'Pilih % dosen penguji yang berbeda', v_need;
  end if;
  foreach v_d in array p_dosen loop
    if exists (select 1 from public.thesis_supervisors where thesis_id = p_thesis and dosen_id = v_d and aktif) then
      raise exception 'Penguji harus dosen di luar Pembimbing 1 dan 2';
    end if;
    if not exists (select 1 from public.user_roles ur join public.profiles p on p.id = ur.user_id
                   where ur.user_id = v_d and ur.role = 'dosen' and p.aktif) then
      raise exception 'Pengguna yang dipilih bukan dosen aktif';
    end if;
  end loop;
  if p_tahap = 'pendadaran' and coalesce(p_wakil, 'P1') not in ('P1','P2') then
    raise exception 'Wakil pembimbing harus P1 atau P2';
  end if;

  update public.thesis_examiners set aktif = false where thesis_id = p_thesis and tahap = p_tahap and aktif;
  foreach v_d in array p_dosen loop
    v_i := v_i + 1;
    insert into public.thesis_examiners (thesis_id, dosen_id, tahap, urutan, ditetapkan_oleh)
    values (p_thesis, v_d, p_tahap, v_i, auth.uid());
    perform priv.notify(v_d, 'penguji_ditetapkan', 'Penugasan penguji',
      'Anda ditetapkan sebagai penguji ' || case p_tahap when 'seminar' then 'Seminar Proposal dan Seminar Hasil' else 'Pendadaran' end
      || ' untuk ' || (select nama from public.profiles where id = v_th.mahasiswa_id) || '.', '/ujian');
  end loop;
  if p_tahap = 'pendadaran' then
    update public.thesis set pendadaran_wakil = coalesce(p_wakil, 'P1') where id = p_thesis;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 4. ACC per bab oleh Pembimbing 1 dan Pembimbing 2
-- ---------------------------------------------------------------------
create table public.milestone_approvals (
  id uuid primary key default gen_random_uuid(),
  milestone_id uuid not null references public.thesis_milestones (id) on delete cascade,
  thesis_id uuid not null references public.thesis (id) on delete cascade,
  dosen_id uuid not null references public.profiles (id),
  peran public.supervisor_role not null,
  kode text not null unique default upper(substr(md5(random()::text || clock_timestamp()::text), 1, 10)),
  catatan text,
  session_id uuid references public.guidance_sessions (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (milestone_id, dosen_id)
);
create index milestone_approvals_thesis_idx on public.milestone_approvals (thesis_id);

create or replace function priv.acc_milestone(p_id uuid, p_catatan text, p_session uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_m public.thesis_milestones;
  v_peran public.supervisor_role;
  v_need int;
  v_have int;
  v_mhs uuid;
begin
  select * into v_m from public.thesis_milestones where id = p_id;
  if not found then raise exception 'Milestone tidak ditemukan'; end if;
  if v_m.jenis <> 'pembimbing_setuju' then raise exception 'Tahap ini tidak di-ACC pembimbing'; end if;
  if v_m.status = 'selesai' then raise exception 'Bab ini sudah selesai'; end if;
  if exists (select 1 from public.thesis_milestones where thesis_id = v_m.thesis_id and urutan < v_m.urutan and status <> 'selesai') then
    raise exception 'Tahap sebelumnya belum selesai';
  end if;
  select peran into v_peran from public.thesis_supervisors where thesis_id = v_m.thesis_id and dosen_id = auth.uid() and aktif;
  if v_peran is null then raise exception 'Hanya Pembimbing 1 atau 2 yang dapat memberi ACC'; end if;

  insert into public.milestone_approvals (milestone_id, thesis_id, dosen_id, peran, catatan, session_id)
  values (p_id, v_m.thesis_id, auth.uid(), v_peran, nullif(trim(coalesce(p_catatan,'')), ''), p_session)
  on conflict (milestone_id, dosen_id) do nothing;

  select count(*) into v_need from public.thesis_supervisors where thesis_id = v_m.thesis_id and aktif;
  select count(*) into v_have from public.milestone_approvals a
    join public.thesis_supervisors s on s.thesis_id = a.thesis_id and s.dosen_id = a.dosen_id and s.aktif
    where a.milestone_id = p_id;
  select mahasiswa_id into v_mhs from public.thesis where id = v_m.thesis_id;

  if v_have >= v_need and v_need >= 2 then
    perform priv.complete_milestone(p_id, 'ACC Pembimbing 1 dan Pembimbing 2', 'ACC P1 dan P2');
    perform priv.notify(v_mhs, 'acc_bab', v_m.nama || ' selesai', 'Sudah di-ACC Pembimbing 1 dan Pembimbing 2.', '/studi-akhir');
    return 'selesai';
  end if;
  if v_m.status in ('belum_mulai','revisi','menunggu_review') then
    perform priv.set_milestone_status(p_id, 'dikerjakan', 'ACC ' || v_peran || ', menunggu pembimbing lain');
  end if;
  perform priv.notify(v_mhs, 'acc_bab', 'ACC ' || v_peran || ': ' || v_m.nama,
    'Menunggu ACC dari pembimbing lainnya.', '/studi-akhir');
  return 'sebagian';
end;
$$;

create or replace function public.acc_bab(p_milestone uuid, p_catatan text default null)
returns text language plpgsql security definer set search_path = public as $$
begin
  perform priv.require_user();
  return priv.acc_milestone(p_milestone, p_catatan, null);
end;
$$;

-- catat_bimbingan: hasil "lanjut" kini berarti ACC dari dosen ini (bab selesai setelah P1 dan P2 ACC)
create or replace function public.catat_bimbingan(
  p_id uuid, p_ringkasan text, p_saran text, p_tindak_lanjut text,
  p_hasil public.session_result, p_sahkan boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := priv.require_user();
  v_s public.guidance_sessions;
  v_ms public.thesis_milestones;
  v_label text;
begin
  select * into v_s from public.guidance_sessions where id = p_id for update;
  if not found then raise exception 'Sesi bimbingan tidak ditemukan'; end if;
  if v_s.dosen_id <> v_uid or not priv.is_supervisor_of(v_s.thesis_id) then
    raise exception 'Hanya dosen pembimbing sesi ini yang dapat mengisi catatan';
  end if;
  if not (v_s.status in ('diajukan','dijadwalkan') or (v_s.status = 'selesai' and not v_s.disahkan)) then
    raise exception 'Catatan sesi yang sudah disahkan tidak dapat diubah';
  end if;
  if length(trim(coalesce(p_ringkasan, ''))) = 0 then raise exception 'Ringkasan bimbingan wajib diisi'; end if;
  if p_hasil is null then raise exception 'Status hasil bimbingan wajib dipilih'; end if;

  update public.guidance_sessions set
    status = 'selesai', tanggal_jadwal = coalesce(tanggal_jadwal, tanggal_usulan),
    ringkasan = trim(p_ringkasan), saran = nullif(trim(coalesce(p_saran, '')), ''),
    tindak_lanjut = nullif(trim(coalesce(p_tindak_lanjut, '')), ''), hasil = p_hasil, catatan_at = now(),
    disahkan = coalesce(p_sahkan, false), disahkan_at = case when p_sahkan then now() else null end
  where id = p_id;

  if v_s.milestone_id is not null then
    select * into v_ms from public.thesis_milestones where id = v_s.milestone_id;
    if v_ms.jenis = 'pembimbing_setuju' and v_ms.status <> 'selesai' then
      if p_hasil = 'revisi' then
        perform priv.set_milestone_status(v_ms.id, 'revisi', 'Revisi dari pembimbing: ' || left(trim(p_ringkasan), 200));
      elsif p_hasil = 'disetujui' then
        perform priv.set_milestone_status(v_ms.id, 'dikerjakan', 'Progres disetujui pembimbing, lanjutkan pengerjaan');
      elsif p_hasil = 'lanjut' then
        perform priv.acc_milestone(v_ms.id, 'ACC pada sesi bimbingan ' || to_char(coalesce(v_s.tanggal_jadwal, v_s.tanggal_usulan), 'DD-MM-YYYY'), p_id);
      end if;
    end if;
  end if;

  perform priv.activate_next(v_s.thesis_id);
  v_label := case p_hasil when 'revisi' then 'Revisi' when 'lanjut' then 'ACC bab' else 'Disetujui, lanjutkan pengerjaan' end;
  perform priv.notify(v_s.mahasiswa_id, 'catatan_bimbingan', 'Catatan bimbingan tersedia', v_s.topik || ' — ' || v_label, '/bimbingan/' || p_id);
end;
$$;

-- selesaikan_milestone: bab memakai ACC ganda; ujian/revisi lewat modul ujian; berkas/yudisium/SK sementara manual
create or replace function public.selesaikan_milestone(p_id uuid, p_catatan text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_m public.thesis_milestones;
  v_th public.thesis;
  v_boleh boolean;
begin
  perform priv.require_user();
  select * into v_m from public.thesis_milestones where id = p_id;
  if not found then raise exception 'Milestone tidak ditemukan'; end if;
  if v_m.jenis = 'pembimbing_setuju' then
    perform priv.acc_milestone(p_id, p_catatan, null);
    return;
  end if;
  if v_m.jenis in ('ujian','revisi') then
    raise exception 'Tahap ini diselesaikan melalui modul ujian';
  end if;
  select * into v_th from public.thesis where id = v_m.thesis_id;
  if v_m.status = 'selesai' then raise exception 'Milestone sudah selesai'; end if;
  if exists (select 1 from public.thesis_milestones where thesis_id = v_m.thesis_id and urutan < v_m.urutan and status <> 'selesai') then
    raise exception 'Selesaikan milestone sebelumnya terlebih dahulu';
  end if;
  if length(trim(coalesce(p_catatan, ''))) = 0 then raise exception 'Catatan bukti wajib diisi'; end if;

  v_boleh := case v_m.jenis
    when 'berkas' then priv.is_baak_of(v_th.prodi_id) or priv.is_admin()
    when 'yudisium' then priv.is_baak_of(v_th.prodi_id) or priv.has_role('pimpinan') or priv.is_admin()
    when 'sk' then priv.has_role('pimpinan') or priv.is_baak_of(v_th.prodi_id) or priv.is_admin()
    when 'seminar' then priv.is_baak_of(v_th.prodi_id) or priv.can_manage_thesis(v_m.thesis_id)
    when 'penguji_setuju' then priv.is_baak_of(v_th.prodi_id) or priv.can_manage_thesis(v_m.thesis_id)
    when 'arsip' then priv.is_baak_of(v_th.prodi_id) or priv.is_admin()
    when 'syarat_otomatis' then priv.can_manage_thesis(v_m.thesis_id)
    else false
  end;
  if not v_boleh then raise exception 'Anda tidak berwenang menyelesaikan tahap ini'; end if;

  perform priv.complete_milestone(p_id, 'Diselesaikan dengan bukti: ' || trim(p_catatan), trim(p_catatan));
  perform priv.notify(v_th.mahasiswa_id, 'milestone_selesai', 'Tahap selesai', v_m.nama, '/studi-akhir');
end;
$$;

-- ---------------------------------------------------------------------
-- 5. Ujian, penilaian, konversi huruf, revisi
-- ---------------------------------------------------------------------
create table public.assessment_items (
  id uuid primary key default gen_random_uuid(),
  jenis text not null check (jenis in ('sempro','semhas','pendadaran','d3')),
  urutan int not null default 1,
  nama text not null,
  keterangan text,
  bobot numeric(6,2) not null default 1 check (bobot > 0),
  aktif boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.grade_scale (
  id uuid primary key default gen_random_uuid(),
  huruf text not null unique,
  nilai_min numeric(5,2) not null check (nilai_min between 0 and 100),
  angka numeric(3,2),
  created_at timestamptz not null default now()
);

create table public.exams (
  id uuid primary key default gen_random_uuid(),
  thesis_id uuid not null references public.thesis (id) on delete cascade,
  milestone_id uuid references public.thesis_milestones (id) on delete set null,
  jenis text not null check (jenis in ('sempro','semhas','pendadaran','d3')),
  percobaan int not null default 1,
  status text not null default 'didaftarkan' check (status in ('didaftarkan','dijadwalkan','selesai','dibatalkan')),
  tanggal timestamptz,
  durasi_menit int not null default 120 check (durasi_menit between 15 and 600),
  ruang text,
  catatan text,
  nilai_akhir numeric(5,2),
  huruf text,
  hasil text check (hasil in ('lulus','lulus_minor','lulus_mayor','mengulang')),
  diputuskan_oleh uuid references public.profiles (id),
  diputuskan_at timestamptz,
  kode_ba text unique,
  revisi_selesai_at timestamptz,
  kode_ba_revisi text unique,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index exams_satu_aktif on public.exams (thesis_id, jenis) where status in ('didaftarkan','dijadwalkan');
create index exams_status_idx on public.exams (status, tanggal);
create trigger exams_touch before update on public.exams for each row execute function priv.touch_updated_at();

create table public.exam_panel (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.exams (id) on delete cascade,
  thesis_id uuid not null references public.thesis (id) on delete cascade,
  dosen_id uuid not null references public.profiles (id),
  peran text not null,
  urutan int not null default 1,
  ketua boolean not null default false,
  nilai numeric(5,2),
  catatan text,
  dinilai_at timestamptz,
  kode_nilai text unique,
  acc_revisi_at timestamptz,
  kode_acc text unique,
  unique (exam_id, dosen_id)
);
create index exam_panel_dosen_idx on public.exam_panel (dosen_id);

create table public.exam_scores (
  exam_id uuid not null references public.exams (id) on delete cascade,
  thesis_id uuid not null references public.thesis (id) on delete cascade,
  dosen_id uuid not null references public.profiles (id),
  item_id uuid not null references public.assessment_items (id),
  skor numeric(5,2) not null check (skor between 40 and 100),
  primary key (exam_id, dosen_id, item_id)
);

create table public.exam_revision_notes (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.exams (id) on delete cascade,
  thesis_id uuid not null references public.thesis (id) on delete cascade,
  dosen_id uuid not null references public.profiles (id),
  isi text not null check (length(trim(isi)) > 0),
  selesai boolean not null default false,
  created_at timestamptz not null default now()
);

-- Butir penilaian dan konversi bawaan (dapat diubah Admin)
insert into public.assessment_items (jenis, urutan, nama, bobot) values
  ('sempro',1,'Penguasaan materi dan latar belakang masalah',30),
  ('sempro',2,'Kesesuaian sistematika dengan pedoman',20),
  ('sempro',3,'Ketepatan metodologi',30),
  ('sempro',4,'Presentasi dan tanya jawab',20),
  ('semhas',1,'Hasil dan pembahasan',30),
  ('semhas',2,'Penguasaan materi',25),
  ('semhas',3,'Konsistensi dengan proposal dan pedoman',20),
  ('semhas',4,'Presentasi dan tanya jawab',25),
  ('pendadaran',1,'Penguasaan isi skripsi',35),
  ('pendadaran',2,'Kemampuan menjawab pertanyaan',30),
  ('pendadaran',3,'Kualitas karya dan kontribusi',20),
  ('pendadaran',4,'Sikap dan presentasi',15),
  ('d3',1,'Penguasaan tugas akhir',30),
  ('d3',2,'Hasil implementasi atau karya',30),
  ('d3',3,'Penulisan sesuai pedoman',20),
  ('d3',4,'Presentasi dan tanya jawab',20);

insert into public.grade_scale (huruf, nilai_min, angka) values
  ('A',85,4.00),('A-',80,3.70),('B+',75,3.30),('B',70,3.00),('B-',65,2.70),
  ('C+',60,2.30),('C',55,2.00),('D',45,1.00),('E',40,0.00)
on conflict (huruf) do nothing;

create or replace function priv.exam_has_revision(p_jenis text)
returns boolean language sql immutable as $$ select p_jenis in ('sempro','semhas') $$;

create or replace function priv.exam_label(p_jenis text)
returns text language sql immutable as $$
  select case p_jenis when 'sempro' then 'Seminar Proposal' when 'semhas' then 'Seminar Hasil'
    when 'pendadaran' then 'Pendadaran' else 'Seminar Tertutup dan Komprehensif' end
$$;

create or replace function priv.new_code()
returns text language sql volatile as $$ select upper(substr(md5(random()::text || clock_timestamp()::text), 1, 10)) $$;

create or replace function priv.is_examiner_of(p_thesis uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.thesis_examiners where thesis_id = p_thesis and dosen_id = auth.uid() and aktif)
      or exists (select 1 from public.exam_panel where thesis_id = p_thesis and dosen_id = auth.uid());
$$;

-- Penguji ikut dapat melihat data mahasiswa yang diujinya
create or replace function priv.can_view_thesis(p_thesis uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.thesis t
    where t.id = p_thesis and (
      t.mahasiswa_id = auth.uid()
      or priv.is_supervisor_of(t.id)
      or priv.is_examiner_of(t.id)
      or priv.is_kaprodi_of(t.prodi_id)
      or priv.is_baak_of(t.prodi_id)
      or priv.has_role('pimpinan')
      or priv.is_admin()
    )
  );
$$;

create or replace function priv.can_view_profile(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select
    p_user = auth.uid()
    or priv.is_admin()
    or priv.has_role('pimpinan')
    or exists (select 1 from public.user_roles ur where ur.user_id = p_user and ur.role <> 'mahasiswa')
    or exists (
      select 1 from public.profiles x
      where x.id = p_user and x.prodi_id is not null
        and (priv.is_kaprodi_of(x.prodi_id) or priv.is_baak_of(x.prodi_id))
    )
    or exists (
      select 1 from public.thesis t
      where t.mahasiswa_id = p_user and (priv.is_supervisor_of(t.id) or priv.is_examiner_of(t.id))
    );
$$;

-- 5a. Mahasiswa mendaftar ujian (syarat: semua tahap sebelumnya selesai)
create or replace function public.daftar_ujian(p_thesis uuid, p_jenis text, p_catatan text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_th public.thesis;
  v_m public.thesis_milestones;
  v_id uuid;
  v_ke int;
  v_nama text;
begin
  perform priv.require_user();
  select * into v_th from public.thesis where id = p_thesis;
  if not found or v_th.mahasiswa_id <> auth.uid() then raise exception 'Tugas akhir tidak ditemukan'; end if;
  if v_th.status <> 'aktif' then raise exception 'Tugas akhir tidak berstatus aktif'; end if;
  select * into v_m from public.thesis_milestones where thesis_id = p_thesis and jenis = 'ujian' and ujian_jenis = p_jenis;
  if not found then raise exception 'Tahap ujian ini tidak ada pada alur Anda'; end if;
  if v_m.status = 'selesai' then raise exception '% sudah dinyatakan lulus', priv.exam_label(p_jenis); end if;
  if exists (select 1 from public.thesis_milestones where thesis_id = p_thesis and urutan < v_m.urutan and status <> 'selesai') then
    raise exception 'Belum dapat mendaftar: selesaikan dulu semua tahap sebelum %', priv.exam_label(p_jenis);
  end if;
  if exists (select 1 from public.exams where thesis_id = p_thesis and jenis = p_jenis and status in ('didaftarkan','dijadwalkan')) then
    raise exception 'Pendaftaran % Anda sudah ada dan sedang diproses', priv.exam_label(p_jenis);
  end if;
  select count(*) + 1 into v_ke from public.exams where thesis_id = p_thesis and jenis = p_jenis and status = 'selesai';

  insert into public.exams (thesis_id, milestone_id, jenis, percobaan, catatan, created_by)
  values (p_thesis, v_m.id, p_jenis, v_ke, nullif(trim(coalesce(p_catatan,'')), ''), auth.uid())
  returning id into v_id;

  perform priv.set_milestone_status(v_m.id, 'menunggu_review', 'Mendaftar ' || priv.exam_label(p_jenis));
  select nama into v_nama from public.profiles where id = auth.uid();
  perform priv.notify_kaprodi(v_th.prodi_id, 'ujian_daftar', 'Pendaftaran ' || priv.exam_label(p_jenis),
    v_nama || ' mendaftar ' || priv.exam_label(p_jenis) || '. Jadwalkan ujian.', '/ujian/' || v_id);
  perform priv.notify(ur.user_id, 'ujian_daftar', 'Pendaftaran ' || priv.exam_label(p_jenis),
    v_nama || ' mendaftar ' || priv.exam_label(p_jenis) || '.', '/ujian/' || v_id)
  from public.user_roles ur where ur.role = 'baak' and (ur.prodi_id is null or ur.prodi_id = v_th.prodi_id);
  return v_id;
end;
$$;

-- 5b. Ka. Prodi/BAAK menjadwalkan ujian; panel disusun dari ploting; cek bentrok ruang dan dosen
create or replace function public.jadwalkan_ujian(
  p_exam uuid, p_tanggal timestamptz, p_ruang text, p_durasi int default 120, p_ketua uuid default null, p_paksa boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_e public.exams;
  v_th public.thesis;
  v_p1 uuid; v_p2 uuid; v_pg uuid[]; v_wakil uuid;
  v_conf text;
  v_mulai timestamptz := p_tanggal;
  v_akhir timestamptz := p_tanggal + make_interval(mins => coalesce(p_durasi, 120));
begin
  perform priv.require_user();
  select * into v_e from public.exams where id = p_exam for update;
  if not found then raise exception 'Ujian tidak ditemukan'; end if;
  select * into v_th from public.thesis where id = v_e.thesis_id;
  if not (priv.is_kaprodi_of(v_th.prodi_id) or priv.is_baak_of(v_th.prodi_id) or priv.is_admin()) then
    raise exception 'Hanya Ka. Prodi atau BAAK yang dapat menjadwalkan ujian';
  end if;
  if v_e.status not in ('didaftarkan','dijadwalkan') then raise exception 'Ujian ini tidak dapat dijadwalkan'; end if;
  if p_tanggal is null then raise exception 'Tanggal dan jam ujian wajib diisi'; end if;
  if length(trim(coalesce(p_ruang, ''))) = 0 then raise exception 'Ruang ujian wajib diisi'; end if;

  -- Susun ulang panel bila belum ada yang menilai
  if not exists (select 1 from public.exam_panel where exam_id = p_exam and dinilai_at is not null) then
    select dosen_id into v_p1 from public.thesis_supervisors where thesis_id = v_th.id and peran = 'P1' and aktif;
    select dosen_id into v_p2 from public.thesis_supervisors where thesis_id = v_th.id and peran = 'P2' and aktif;
    if v_p1 is null or v_p2 is null then raise exception 'Pembimbing 1 dan 2 belum lengkap'; end if;
    delete from public.exam_panel where exam_id = p_exam;

    if v_e.jenis in ('sempro','semhas') then
      select array_agg(dosen_id order by urutan) into v_pg from public.thesis_examiners where thesis_id = v_th.id and tahap = 'seminar' and aktif;
      if coalesce(array_length(v_pg, 1), 0) <> 1 then raise exception 'Penguji seminar belum diploting oleh Ka. Prodi'; end if;
      insert into public.exam_panel (exam_id, thesis_id, dosen_id, peran, urutan) values
        (p_exam, v_th.id, v_p1, 'Pembimbing 1', 1), (p_exam, v_th.id, v_p2, 'Pembimbing 2', 2), (p_exam, v_th.id, v_pg[1], 'Penguji', 3);
    elsif v_e.jenis = 'pendadaran' then
      select array_agg(dosen_id order by urutan) into v_pg from public.thesis_examiners where thesis_id = v_th.id and tahap = 'pendadaran' and aktif;
      if coalesce(array_length(v_pg, 1), 0) <> 2 then raise exception 'Tim penguji pendadaran belum diploting oleh Ka. Prodi'; end if;
      v_wakil := case v_th.pendadaran_wakil when 'P2' then v_p2 else v_p1 end;
      insert into public.exam_panel (exam_id, thesis_id, dosen_id, peran, urutan) values
        (p_exam, v_th.id, v_pg[1], 'Penguji 1', 1), (p_exam, v_th.id, v_pg[2], 'Penguji 2', 2),
        (p_exam, v_th.id, v_wakil, case v_th.pendadaran_wakil when 'P2' then 'Pembimbing 2' else 'Pembimbing 1' end, 3);
    else
      insert into public.exam_panel (exam_id, thesis_id, dosen_id, peran, urutan) values
        (p_exam, v_th.id, v_p1, 'Pembimbing 1', 1), (p_exam, v_th.id, v_p2, 'Pembimbing 2', 2);
    end if;
  end if;

  update public.exam_panel set ketua = false where exam_id = p_exam;
  if p_ketua is not null then
    update public.exam_panel set ketua = true where exam_id = p_exam and dosen_id = p_ketua;
    if not found then raise exception 'Ketua sidang harus anggota panel'; end if;
  else
    update public.exam_panel set ketua = true where id = (select id from public.exam_panel where exam_id = p_exam order by urutan limit 1);
  end if;

  if not coalesce(p_paksa, false) then
    select string_agg(distinct x, '; ') into v_conf from (
      select 'ruang ' || e.ruang || ' dipakai ' || priv.exam_label(e.jenis) || ' ' || pm.nama || ' pukul ' || to_char(e.tanggal at time zone 'Asia/Jakarta', 'HH24:MI') as x
      from public.exams e join public.thesis t on t.id = e.thesis_id join public.profiles pm on pm.id = t.mahasiswa_id
      where e.id <> p_exam and e.status = 'dijadwalkan' and lower(trim(e.ruang)) = lower(trim(p_ruang))
        and e.tanggal < v_akhir and e.tanggal + make_interval(mins => e.durasi_menit) > v_mulai
      union all
      select d.nama || ' menguji ' || priv.exam_label(e.jenis) || ' lain pukul ' || to_char(e.tanggal at time zone 'Asia/Jakarta', 'HH24:MI')
      from public.exams e
      join public.exam_panel op on op.exam_id = e.id
      join public.exam_panel mp on mp.exam_id = p_exam and mp.dosen_id = op.dosen_id
      join public.profiles d on d.id = op.dosen_id
      where e.id <> p_exam and e.status = 'dijadwalkan'
        and e.tanggal < v_akhir and e.tanggal + make_interval(mins => e.durasi_menit) > v_mulai
    ) c;
    if v_conf is not null then raise exception 'Bentrok jadwal: %', v_conf; end if;
  end if;

  update public.exams set status = 'dijadwalkan', tanggal = p_tanggal, ruang = trim(p_ruang), durasi_menit = coalesce(p_durasi, 120) where id = p_exam;

  perform priv.notify(v_th.mahasiswa_id, 'ujian_jadwal', priv.exam_label(v_e.jenis) || ' dijadwalkan',
    to_char(p_tanggal at time zone 'Asia/Jakarta', 'DD-MM-YYYY HH24:MI') || ' di ' || trim(p_ruang), '/ujian/' || p_exam);
  perform priv.notify(dosen_id, 'ujian_jadwal', 'Jadwal ' || priv.exam_label(v_e.jenis),
    to_char(p_tanggal at time zone 'Asia/Jakarta', 'DD-MM-YYYY HH24:MI') || ' di ' || trim(p_ruang) || ' (' || peran || ')', '/ujian/' || p_exam)
  from public.exam_panel where exam_id = p_exam;
end;
$$;

-- 5c. Anggota panel mengisi penilaian (skor 40–100 per butir) dan catatan revisi
create or replace function public.nilai_ujian(p_exam uuid, p_skor jsonb, p_catatan text default null, p_revisi jsonb default '[]'::jsonb)
returns numeric language plpgsql security definer set search_path = public as $$
declare
  v_e public.exams;
  v_item record;
  v_s numeric;
  v_total numeric := 0;
  v_bobot numeric := 0;
  v_nilai numeric;
  v_note text;
begin
  perform priv.require_user();
  select * into v_e from public.exams where id = p_exam;
  if not found then raise exception 'Ujian tidak ditemukan'; end if;
  if not exists (select 1 from public.exam_panel where exam_id = p_exam and dosen_id = auth.uid()) then
    raise exception 'Anda bukan anggota panel ujian ini';
  end if;
  if v_e.status <> 'dijadwalkan' then raise exception 'Penilaian hanya dapat diisi untuk ujian yang terjadwal dan belum diputuskan'; end if;
  if jsonb_typeof(p_skor) <> 'object' then raise exception 'Format nilai tidak valid'; end if;

  delete from public.exam_scores where exam_id = p_exam and dosen_id = auth.uid();
  for v_item in select * from public.assessment_items where jenis = v_e.jenis and aktif order by urutan loop
    if not (p_skor ? v_item.id::text) then raise exception 'Nilai "%" belum diisi', v_item.nama; end if;
    v_s := (p_skor ->> v_item.id::text)::numeric;
    if v_s is null or v_s < 40 or v_s > 100 then raise exception 'Nilai "%" harus 40 sampai 100', v_item.nama; end if;
    insert into public.exam_scores (exam_id, thesis_id, dosen_id, item_id, skor) values (p_exam, v_e.thesis_id, auth.uid(), v_item.id, v_s);
    v_total := v_total + v_s * v_item.bobot;
    v_bobot := v_bobot + v_item.bobot;
  end loop;
  if v_bobot = 0 then raise exception 'Butir penilaian untuk ujian ini belum diatur Admin'; end if;
  v_nilai := round(v_total / v_bobot, 2);

  update public.exam_panel
    set nilai = v_nilai, catatan = nullif(trim(coalesce(p_catatan,'')), ''), dinilai_at = now(), kode_nilai = coalesce(kode_nilai, priv.new_code())
    where exam_id = p_exam and dosen_id = auth.uid();

  if priv.exam_has_revision(v_e.jenis) then
    delete from public.exam_revision_notes where exam_id = p_exam and dosen_id = auth.uid();
    for v_note in select trim(x) from jsonb_array_elements_text(coalesce(p_revisi, '[]'::jsonb)) x where trim(x) <> '' loop
      insert into public.exam_revision_notes (exam_id, thesis_id, dosen_id, isi) values (p_exam, v_e.thesis_id, auth.uid(), v_note);
    end loop;
  end if;
  return v_nilai;
end;
$$;

-- 5d. Ketua sidang memutuskan hasil; nilai akhir = rata-rata nilai seluruh panel
create or replace function public.putuskan_ujian(p_exam uuid, p_hasil text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_e public.exams;
  v_th public.thesis;
  v_nilai numeric;
  v_huruf text;
  v_label text;
  v_rev uuid;
begin
  perform priv.require_user();
  select * into v_e from public.exams where id = p_exam for update;
  if not found then raise exception 'Ujian tidak ditemukan'; end if;
  select * into v_th from public.thesis where id = v_e.thesis_id;
  if not (exists (select 1 from public.exam_panel where exam_id = p_exam and dosen_id = auth.uid() and ketua)
          or priv.is_kaprodi_of(v_th.prodi_id) or priv.is_admin()) then
    raise exception 'Hasil ujian diputuskan oleh ketua sidang';
  end if;
  if v_e.status <> 'dijadwalkan' then raise exception 'Ujian ini tidak dalam status terjadwal'; end if;
  if exists (select 1 from public.exam_panel where exam_id = p_exam and dinilai_at is null) then
    raise exception 'Semua anggota panel harus mengisi penilaian terlebih dahulu';
  end if;
  if priv.exam_has_revision(v_e.jenis) and p_hasil not in ('lulus_minor','lulus_mayor','mengulang') then
    raise exception 'Hasil harus Lulus dengan revisi minor, Lulus dengan revisi mayor, atau Mengulang';
  end if;
  if not priv.exam_has_revision(v_e.jenis) and p_hasil not in ('lulus','mengulang') then
    raise exception 'Hasil harus Lulus atau Mengulang';
  end if;

  select round(avg(nilai), 2) into v_nilai from public.exam_panel where exam_id = p_exam;
  select huruf into v_huruf from public.grade_scale where nilai_min <= v_nilai order by nilai_min desc limit 1;

  update public.exams set status = 'selesai', hasil = p_hasil, nilai_akhir = v_nilai, huruf = v_huruf,
    diputuskan_oleh = auth.uid(), diputuskan_at = now(), kode_ba = priv.new_code()
  where id = p_exam;

  v_label := case p_hasil when 'lulus' then 'Lulus' when 'lulus_minor' then 'Lulus dengan revisi minor'
    when 'lulus_mayor' then 'Lulus dengan revisi mayor' else 'Mengulang' end;

  if p_hasil = 'mengulang' then
    perform priv.set_milestone_status(v_e.milestone_id, 'dikerjakan', priv.exam_label(v_e.jenis) || ': mengulang');
  else
    perform priv.complete_milestone(v_e.milestone_id, priv.exam_label(v_e.jenis) || ' ' || v_label,
      'Nilai ' || v_nilai || ' (' || coalesce(v_huruf, '-') || '), BA ' || (select kode_ba from public.exams where id = p_exam));
  end if;

  perform priv.notify(v_th.mahasiswa_id, 'ujian_hasil', 'Hasil ' || priv.exam_label(v_e.jenis) || ': ' || v_label,
    'Nilai akhir ' || v_nilai || coalesce(' (' || v_huruf || ')', '') ||
    case when p_hasil in ('lulus_minor','lulus_mayor') then '. Kerjakan revisi lalu minta ACC seluruh dosen.' when p_hasil = 'mengulang' then '. Silakan daftar ulang setelah siap.' else '.' end,
    '/ujian/' || p_exam);
  perform priv.log('putuskan_ujian', 'exams', p_exam::text, null, jsonb_build_object('hasil', p_hasil, 'nilai', v_nilai, 'huruf', v_huruf));
end;
$$;

-- 5e. Mahasiswa menandai catatan revisi selesai
create or replace function public.tandai_revisi(p_note uuid, p_selesai boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_n public.exam_revision_notes;
begin
  perform priv.require_user();
  select * into v_n from public.exam_revision_notes where id = p_note;
  if not found or not priv.is_thesis_owner(v_n.thesis_id) then raise exception 'Catatan revisi tidak ditemukan'; end if;
  update public.exam_revision_notes set selesai = p_selesai where id = p_note;
end;
$$;

-- 5f. Setiap anggota panel memberi ACC revisi; setelah semua ACC terbit Berita Acara Hasil Revisi
create or replace function public.acc_revisi(p_exam uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_e public.exams;
  v_th public.thesis;
  v_m uuid;
  v_kode text;
begin
  perform priv.require_user();
  select * into v_e from public.exams where id = p_exam for update;
  if not found then raise exception 'Ujian tidak ditemukan'; end if;
  if not exists (select 1 from public.exam_panel where exam_id = p_exam and dosen_id = auth.uid()) then
    raise exception 'Anda bukan anggota panel ujian ini';
  end if;
  if v_e.status <> 'selesai' or v_e.hasil not in ('lulus_minor','lulus_mayor') then
    raise exception 'Ujian ini tidak memiliki tahap revisi';
  end if;
  if v_e.revisi_selesai_at is not null then raise exception 'Revisi sudah dinyatakan selesai'; end if;

  update public.exam_panel set acc_revisi_at = coalesce(acc_revisi_at, now()), kode_acc = coalesce(kode_acc, priv.new_code())
    where exam_id = p_exam and dosen_id = auth.uid();
  select * into v_th from public.thesis where id = v_e.thesis_id;

  if not exists (select 1 from public.exam_panel where exam_id = p_exam and acc_revisi_at is null) then
    v_kode := priv.new_code();
    update public.exams set revisi_selesai_at = now(), kode_ba_revisi = v_kode where id = p_exam;
    select id into v_m from public.thesis_milestones
      where thesis_id = v_e.thesis_id and jenis = 'revisi' and ujian_jenis = v_e.jenis and status <> 'selesai';
    if v_m is not null then
      perform priv.complete_milestone(v_m, 'Revisi ' || priv.exam_label(v_e.jenis) || ' di-ACC seluruh dosen', 'BA revisi ' || v_kode);
    end if;
    perform priv.notify(v_th.mahasiswa_id, 'revisi_selesai',
      case v_e.jenis when 'sempro' then 'Proposal dinyatakan selesai' else 'Skripsi dinyatakan selesai' end,
      'Revisi ' || priv.exam_label(v_e.jenis) || ' sudah di-ACC seluruh dosen. Kode BA: ' || v_kode, '/ujian/' || p_exam);
    return 'selesai';
  end if;
  perform priv.notify(v_th.mahasiswa_id, 'revisi_acc', 'ACC revisi ' || priv.exam_label(v_e.jenis),
    (select nama from public.profiles where id = auth.uid()) || ' memberi ACC revisi.', '/ujian/' || p_exam);
  return 'sebagian';
end;
$$;

-- 5g. Pembatalan pendaftaran/jadwal ujian
create or replace function public.batalkan_ujian(p_exam uuid, p_alasan text)
returns void language plpgsql security definer set search_path = public as $$
declare v_e public.exams; v_th public.thesis;
begin
  perform priv.require_user();
  select * into v_e from public.exams where id = p_exam for update;
  if not found then raise exception 'Ujian tidak ditemukan'; end if;
  select * into v_th from public.thesis where id = v_e.thesis_id;
  if v_e.status not in ('didaftarkan','dijadwalkan') then raise exception 'Ujian ini tidak dapat dibatalkan'; end if;
  if not (priv.is_kaprodi_of(v_th.prodi_id) or priv.is_baak_of(v_th.prodi_id) or priv.is_admin()
          or (v_th.mahasiswa_id = auth.uid() and v_e.status = 'didaftarkan')) then
    raise exception 'Anda tidak berwenang membatalkan ujian ini';
  end if;
  if length(trim(coalesce(p_alasan, ''))) = 0 then raise exception 'Alasan pembatalan wajib diisi'; end if;
  update public.exams set status = 'dibatalkan', catatan = trim(p_alasan) where id = p_exam;
  perform priv.set_milestone_status(v_e.milestone_id, 'dikerjakan', 'Ujian dibatalkan: ' || trim(p_alasan));
  if v_th.mahasiswa_id <> auth.uid() then
    perform priv.notify(v_th.mahasiswa_id, 'ujian_batal', priv.exam_label(v_e.jenis) || ' dibatalkan', trim(p_alasan), '/ujian/' || p_exam);
  end if;
end;
$$;

-- View progres dibuat ulang (sempat dilepas untuk mengubah tipe kolom jenis)
create or replace view public.v_thesis_progress with (security_invoker = true) as
select
  th.id as thesis_id,
  th.mahasiswa_id,
  p.nama as mahasiswa_nama,
  p.nim,
  p.angkatan,
  th.prodi_id,
  pr.kode as prodi_kode,
  pr.nama as prodi_nama,
  th.jenjang,
  th.judul,
  th.status,
  th.mulai,
  coalesce(prog.persen, 0)::numeric(5,1) as persen,
  coalesce(prog.total, 0)::int as milestone_total,
  coalesce(prog.jumlah_selesai, 0)::int as milestone_selesai,
  cur.id as milestone_id,
  cur.urutan as milestone_urutan,
  cur.nama as milestone_nama,
  cur.status as milestone_status,
  cur.tenggat as milestone_tenggat,
  greatest(0, current_date - cur.tenggat)::int as hari_terlambat,
  lg.terakhir as bimbingan_terakhir,
  (current_date - coalesce(lg.terakhir::date, th.mulai))::int as hari_tanpa_bimbingan,
  coalesce(lg.jumlah, 0)::int as jumlah_bimbingan,
  sup.p1_id, sup.p1_nama, sup.p2_id, sup.p2_nama,
  case
    when th.status <> 'aktif' then 'abu'
    when cur.id is null then 'hijau'
    when greatest(0, current_date - cur.tenggat) >= pr.hari_terlambat_merah
      or (current_date - coalesce(lg.terakhir::date, th.mulai)) >= pr.hari_tanpa_bimbingan_merah then 'merah'
    when greatest(0, current_date - cur.tenggat) >= pr.hari_terlambat_kuning
      or (current_date - coalesce(lg.terakhir::date, th.mulai)) >= pr.hari_tanpa_bimbingan_kuning
      or (cur.tenggat - current_date) between 0 and 7 then 'kuning'
    else 'hijau'
  end as risiko
from public.thesis th
join public.profiles p on p.id = th.mahasiswa_id
join public.prodi pr on pr.id = th.prodi_id
left join lateral (
  select round(100 * sum(m.bobot) filter (where m.status = 'selesai') / nullif(sum(m.bobot), 0), 1) as persen,
         count(*) as total,
         count(*) filter (where m.status = 'selesai') as jumlah_selesai
  from public.thesis_milestones m where m.thesis_id = th.id
) prog on true
left join lateral (
  select m.* from public.thesis_milestones m
  where m.thesis_id = th.id and m.status <> 'selesai'
  order by m.urutan limit 1
) cur on true
left join lateral (
  select max(coalesce(g.tanggal_jadwal, g.tanggal_usulan)) as terakhir, count(*) as jumlah
  from public.guidance_sessions g where g.thesis_id = th.id and g.status = 'selesai'
) lg on true
left join lateral (
  select
    (max(s.dosen_id::text) filter (where s.peran = 'P1'))::uuid as p1_id,
    max(d.nama) filter (where s.peran = 'P1') as p1_nama,
    (max(s.dosen_id::text) filter (where s.peran = 'P2'))::uuid as p2_id,
    max(d.nama) filter (where s.peran = 'P2') as p2_nama
  from public.thesis_supervisors s join public.profiles d on d.id = s.dosen_id
  where s.thesis_id = th.id and s.aktif
) sup on true;

-- ---------------------------------------------------------------------
-- 6. RLS tabel baru
-- ---------------------------------------------------------------------
alter table public.thesis_title_history enable row level security;
alter table public.thesis_examiners enable row level security;
alter table public.milestone_approvals enable row level security;
alter table public.assessment_items enable row level security;
alter table public.grade_scale enable row level security;
alter table public.exams enable row level security;
alter table public.exam_panel enable row level security;
alter table public.exam_scores enable row level security;
alter table public.exam_revision_notes enable row level security;

create policy title_history_select on public.thesis_title_history for select to authenticated using (priv.can_view_thesis(thesis_id));
create policy examiners_select on public.thesis_examiners for select to authenticated using (priv.can_view_thesis(thesis_id) or dosen_id = auth.uid());
create policy approvals_select on public.milestone_approvals for select to authenticated using (priv.can_view_thesis(thesis_id));

create policy assessment_items_select on public.assessment_items for select to authenticated using (true);
create policy assessment_items_admin on public.assessment_items for all to authenticated using (priv.is_admin()) with check (priv.is_admin());
create policy grade_scale_select on public.grade_scale for select to authenticated using (true);
create policy grade_scale_admin on public.grade_scale for all to authenticated using (priv.is_admin()) with check (priv.is_admin());

create policy exams_select on public.exams for select to authenticated using (priv.can_view_thesis(thesis_id));
create policy exam_panel_select on public.exam_panel for select to authenticated using (priv.can_view_thesis(thesis_id));
-- Rincian skor: dosen melihat miliknya; Ka. Prodi/BAAK/Admin melihat semua; mahasiswa setelah ujian diputuskan
create policy exam_scores_select on public.exam_scores for select to authenticated using (
  dosen_id = auth.uid()
  or priv.can_manage_thesis(thesis_id)
  or exists (select 1 from public.thesis t where t.id = thesis_id and priv.is_baak_of(t.prodi_id))
  or (priv.can_view_thesis(thesis_id) and exists (select 1 from public.exams e where e.id = exam_id and e.status = 'selesai'))
);
create policy revision_notes_select on public.exam_revision_notes for select to authenticated using (priv.can_view_thesis(thesis_id));

revoke all on public.thesis_title_history, public.thesis_examiners, public.milestone_approvals, public.exams,
  public.exam_panel, public.exam_scores, public.exam_revision_notes, public.assessment_items, public.grade_scale from anon;

-- ---------------------------------------------------------------------
-- 7. Hak eksekusi
-- ---------------------------------------------------------------------
revoke execute on all functions in schema priv from public;
grant execute on function
  priv.has_role(public.app_role), priv.is_admin(), priv.is_staff(), priv.is_kaprodi_of(uuid),
  priv.is_baak_of(uuid), priv.is_supervisor_of(uuid), priv.is_thesis_owner(uuid), priv.is_examiner_of(uuid),
  priv.can_view_thesis(uuid), priv.can_manage_thesis(uuid), priv.can_view_profile(uuid), priv.try_uuid(text)
  to authenticated;

revoke execute on function
  public.daftar_ta(text, text, text, text[], text, text), public.terima_pendaftaran(uuid, uuid, uuid, text),
  public.ubah_judul(uuid, text, text), public.tetapkan_penguji(uuid, text, uuid[], text), public.acc_bab(uuid, text),
  public.daftar_ujian(uuid, text, text), public.jadwalkan_ujian(uuid, timestamptz, text, int, uuid, boolean),
  public.nilai_ujian(uuid, jsonb, text, jsonb), public.putuskan_ujian(uuid, text), public.tandai_revisi(uuid, boolean),
  public.acc_revisi(uuid), public.batalkan_ujian(uuid, text)
  from public, anon;
grant execute on function
  public.daftar_ta(text, text, text, text[], text, text), public.terima_pendaftaran(uuid, uuid, uuid, text),
  public.ubah_judul(uuid, text, text), public.tetapkan_penguji(uuid, text, uuid[], text), public.acc_bab(uuid, text),
  public.daftar_ujian(uuid, text, text), public.jadwalkan_ujian(uuid, timestamptz, text, int, uuid, boolean),
  public.nilai_ujian(uuid, jsonb, text, jsonb), public.putuskan_ujian(uuid, text), public.tandai_revisi(uuid, boolean),
  public.acc_revisi(uuid), public.batalkan_ujian(uuid, text)
  to authenticated;

-- ===================== supabase/migrations/20261028000700_naskah.sql =====================
-- =====================================================================
-- SIMSA — Migrasi 7: naskah daring (editor satu dokumen per bab)
--   * thesis_manuscripts : isi naskah terkini (format dokumen editor, JSON)
--   * manuscript_versions: potret versi (disimpan mahasiswa atau saat diajukan
--                          untuk direview; dipakai review dan Track Changes)
--   * bucket `naskah`    : gambar di dalam naskah. Path: {thesis_id}/{berkas}
-- Hanya mahasiswa pemilik yang dapat mengubah isi naskah. Dosen dan pihak lain
-- yang berhak melihat studi akhir hanya dapat membaca.
-- =====================================================================

create table public.thesis_manuscripts (
  thesis_id uuid primary key references public.thesis (id) on delete cascade,
  konten jsonb not null,
  revisi int not null default 1,
  jumlah_kata int not null default 0,
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table public.manuscript_versions (
  id uuid primary key default gen_random_uuid(),
  thesis_id uuid not null references public.thesis (id) on delete cascade,
  nomor int not null,
  konten jsonb not null,
  jumlah_kata int not null default 0,
  catatan text,
  sumber text not null default 'editor' check (sumber in ('editor', 'word')),
  document_id uuid references public.documents (id) on delete set null,
  dibuat_oleh uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  unique (thesis_id, nomor)
);
create index manuscript_versions_thesis_idx on public.manuscript_versions (thesis_id, nomor desc);

-- ---------------------------------------------------------------------
-- Simpan naskah (autosave). p_revisi = revisi yang dimuat klien; bila berbeda
-- dengan di database berarti naskah sudah diubah dari tab atau perangkat lain.
-- ---------------------------------------------------------------------
create or replace function public.simpan_naskah(p_thesis uuid, p_konten jsonb, p_revisi int, p_kata int)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_th public.thesis;
  v_rev int;
begin
  perform priv.require_user();
  select * into v_th from public.thesis where id = p_thesis;
  if not found then raise exception 'Tugas akhir tidak ditemukan'; end if;
  if v_th.mahasiswa_id <> auth.uid() then raise exception 'Hanya mahasiswa pemilik yang dapat mengubah naskah'; end if;
  if v_th.status <> 'aktif' then raise exception 'Studi akhir tidak aktif; naskah tidak dapat diubah'; end if;
  if p_konten is null or jsonb_typeof(p_konten) <> 'object' or p_konten->>'type' <> 'doc' then
    raise exception 'Format naskah tidak dikenali';
  end if;
  if octet_length(p_konten::text) > 8 * 1024 * 1024 then
    raise exception 'Naskah terlalu besar (lebih dari 8 MB teks). Pindahkan gambar besar atau pecah tabel.';
  end if;

  select revisi into v_rev from public.thesis_manuscripts where thesis_id = p_thesis for update;
  if not found then
    insert into public.thesis_manuscripts (thesis_id, konten, revisi, jumlah_kata, updated_by)
    values (p_thesis, p_konten, 1, greatest(coalesce(p_kata, 0), 0), auth.uid());
    return 1;
  end if;
  if p_revisi is distinct from v_rev then
    raise exception 'KONFLIK: Naskah sudah diubah di tab atau perangkat lain. Muat ulang untuk melihat versi terbaru.';
  end if;
  update public.thesis_manuscripts
     set konten = p_konten, revisi = v_rev + 1, jumlah_kata = greatest(coalesce(p_kata, 0), 0),
         updated_by = auth.uid(), updated_at = now()
   where thesis_id = p_thesis;
  return v_rev + 1;
end;
$$;

-- ---------------------------------------------------------------------
-- Simpan potret versi dari isi naskah terkini.
-- ---------------------------------------------------------------------
create or replace function public.buat_versi_naskah(p_thesis uuid, p_catatan text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_th public.thesis;
  v_ms public.thesis_manuscripts;
  v_last public.manuscript_versions;
  v_id uuid;
begin
  perform priv.require_user();
  select * into v_th from public.thesis where id = p_thesis;
  if not found then raise exception 'Tugas akhir tidak ditemukan'; end if;
  if v_th.mahasiswa_id <> auth.uid() then raise exception 'Hanya mahasiswa pemilik yang dapat menyimpan versi naskah'; end if;
  select * into v_ms from public.thesis_manuscripts where thesis_id = p_thesis;
  if not found then raise exception 'Naskah masih kosong'; end if;

  select * into v_last from public.manuscript_versions where thesis_id = p_thesis order by nomor desc limit 1;
  if found and v_last.konten = v_ms.konten then
    raise exception 'Tidak ada perubahan sejak versi %', v_last.nomor;
  end if;

  insert into public.manuscript_versions (thesis_id, nomor, konten, jumlah_kata, catatan, dibuat_oleh)
  values (p_thesis, coalesce(v_last.nomor, 0) + 1, v_ms.konten, v_ms.jumlah_kata, nullif(trim(coalesce(p_catatan, '')), ''), auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.thesis_manuscripts enable row level security;
alter table public.manuscript_versions enable row level security;

create policy manuscripts_select on public.thesis_manuscripts for select to authenticated
  using (priv.can_view_thesis(thesis_id));
create policy manuscript_versions_select on public.manuscript_versions for select to authenticated
  using (priv.can_view_thesis(thesis_id));
-- Tidak ada kebijakan insert/update/delete: perubahan hanya lewat RPC di atas.

revoke all on public.thesis_manuscripts, public.manuscript_versions from anon;

-- ---------------------------------------------------------------------
-- Storage: gambar naskah
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('naskah', 'naskah', false, 5242880, array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
on conflict (id) do nothing;

create policy naskah_select on storage.objects for select to authenticated
  using (bucket_id = 'naskah' and priv.can_view_thesis(priv.try_uuid((storage.foldername(name))[1])));

create policy naskah_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'naskah' and priv.is_thesis_owner(priv.try_uuid((storage.foldername(name))[1])));

-- ---------------------------------------------------------------------
-- Hak eksekusi
-- ---------------------------------------------------------------------
revoke execute on function public.simpan_naskah(uuid, jsonb, int, int), public.buat_versi_naskah(uuid, text) from public, anon;
grant execute on function public.simpan_naskah(uuid, jsonb, int, int), public.buat_versi_naskah(uuid, text) to authenticated;

-- ===================== supabase/migrations/20261028000800_review_bab.sql =====================
-- =====================================================================
-- SIMSA — Migrasi 8: pengajuan bab dan review naskah
--   * chapter_submissions : mahasiswa mengajukan satu bab untuk direview.
--                           Isi bab dibekukan (potret) saat diajukan.
--   * chapter_reviews     : keputusan tiap pembimbing atas pengajuan
--                           (Revisi atau ACC). ACC memakai mekanisme ACC bab
--                           yang sudah ada (milestone BABn, kode verifikasi).
--   * review_comments     : sorotan dan komentar dosen yang tertambat pada
--                           kutipan teks, beserta balasan. Komentar dosen
--                           berstatus draf sampai keputusan review dikirim.
-- =====================================================================

create table public.chapter_submissions (
  id uuid primary key default gen_random_uuid(),
  thesis_id uuid not null references public.thesis (id) on delete cascade,
  bab int not null check (bab between 1 and 20),
  nomor int not null,
  judul text not null,
  konten jsonb not null,
  version_id uuid references public.manuscript_versions (id) on delete set null,
  milestone_id uuid references public.thesis_milestones (id) on delete set null,
  catatan text,
  status text not null default 'diajukan' check (status in ('diajukan', 'revisi', 'acc', 'ditarik')),
  diajukan_oleh uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  ditutup_at timestamptz,
  unique (thesis_id, bab, nomor)
);
create unique index chapter_submissions_satu_terbuka on public.chapter_submissions (thesis_id, bab) where status = 'diajukan';
create index chapter_submissions_thesis_idx on public.chapter_submissions (thesis_id, bab, nomor desc);

create table public.chapter_reviews (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.chapter_submissions (id) on delete cascade,
  thesis_id uuid not null references public.thesis (id) on delete cascade,
  dosen_id uuid not null references public.profiles (id),
  peran public.supervisor_role not null,
  hasil text not null check (hasil in ('revisi', 'acc')),
  catatan text,
  kode text not null default upper(substr(md5(random()::text || clock_timestamp()::text), 1, 10)),
  created_at timestamptz not null default now(),
  unique (submission_id, dosen_id)
);
create index chapter_reviews_thesis_idx on public.chapter_reviews (thesis_id);

create table public.review_comments (
  id uuid primary key default gen_random_uuid(),
  thesis_id uuid not null references public.thesis (id) on delete cascade,
  submission_id uuid not null references public.chapter_submissions (id) on delete cascade,
  bab int not null,
  parent_id uuid references public.review_comments (id) on delete cascade,
  penulis_id uuid not null references public.profiles (id),
  isi text not null check (length(trim(isi)) > 0),
  -- Jangkar (hanya komentar utama): kutipan teks + konteks sebelum/sesudah,
  -- dan posisi pada potret pengajuan tempat komentar dibuat.
  kutipan text,
  prefix text,
  suffix text,
  posisi jsonb,
  terkirim boolean not null default false,
  status text not null default 'terbuka' check (status in ('terbuka', 'diperbaiki', 'selesai')),
  status_oleh uuid references public.profiles (id),
  status_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index review_comments_thesis_idx on public.review_comments (thesis_id, bab);
create index review_comments_submission_idx on public.review_comments (submission_id);
create index review_comments_parent_idx on public.review_comments (parent_id);

-- ---------------------------------------------------------------------
-- Potong satu bab dari naskah: dari judul bab bernomor ke-n sampai sebelum
-- judul bab (heading level 1) berikutnya.
-- ---------------------------------------------------------------------
create or replace function priv.slice_bab(p_konten jsonb, p_bab int)
returns jsonb language plpgsql immutable as $$
declare
  v_node jsonb;
  v_count int := 0;
  v_in boolean := false;
  v_out jsonb := '[]'::jsonb;
begin
  for v_node in select value from jsonb_array_elements(coalesce(p_konten->'content', '[]'::jsonb)) loop
    if v_node->>'type' = 'heading' and coalesce((v_node->'attrs'->>'level')::int, 1) = 1 then
      if v_in then exit; end if;
      if coalesce(v_node->'attrs'->>'bernomor', 'true') <> 'false' then
        v_count := v_count + 1;
        if v_count = p_bab then v_in := true; end if;
      end if;
    end if;
    if v_in then v_out := v_out || jsonb_build_array(v_node); end if;
  end loop;
  if jsonb_array_length(v_out) = 0 then return null; end if;
  return jsonb_build_object('type', 'doc', 'content', v_out);
end;
$$;

create or replace function priv.node_text(p jsonb)
returns text language sql immutable as $$
  select coalesce(p->>'text', '') || coalesce((select string_agg(priv.node_text(c), '') from jsonb_array_elements(coalesce(p->'content', '[]'::jsonb)) c), '');
$$;

-- Apakah dosen ini sudah memberi ACC untuk bab tersebut (pada pengajuan mana pun)?
create or replace function priv.sudah_acc_bab(p_thesis uuid, p_bab int, p_dosen uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.chapter_reviews r join public.chapter_submissions s on s.id = r.submission_id
     where s.thesis_id = p_thesis and s.bab = p_bab and r.dosen_id = p_dosen and r.hasil = 'acc')
  or exists (
    select 1 from public.milestone_approvals a join public.thesis_milestones m on m.id = a.milestone_id
     where m.thesis_id = p_thesis and m.kode = 'BAB' || p_bab and a.dosen_id = p_dosen);
$$;

-- ---------------------------------------------------------------------
-- Mahasiswa: ajukan bab
-- ---------------------------------------------------------------------
create or replace function public.ajukan_bab(p_thesis uuid, p_bab int, p_catatan text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_th public.thesis;
  v_ms public.thesis_manuscripts;
  v_slice jsonb;
  v_judul text;
  v_nomor int;
  v_ver uuid;
  v_ver_no int;
  v_mil public.thesis_milestones;
  v_id uuid;
  v_last public.chapter_submissions;
begin
  perform priv.require_user();
  select * into v_th from public.thesis where id = p_thesis;
  if not found then raise exception 'Tugas akhir tidak ditemukan'; end if;
  if v_th.mahasiswa_id <> auth.uid() then raise exception 'Hanya mahasiswa pemilik yang dapat mengajukan bab'; end if;
  if v_th.status <> 'aktif' then raise exception 'Studi akhir tidak aktif'; end if;
  if not exists (select 1 from public.thesis_supervisors where thesis_id = p_thesis and aktif) then
    raise exception 'Pembimbing belum ditetapkan';
  end if;

  select * into v_ms from public.thesis_manuscripts where thesis_id = p_thesis;
  if not found then raise exception 'Naskah masih kosong'; end if;
  v_slice := priv.slice_bab(v_ms.konten, p_bab);
  if v_slice is null then raise exception 'Bab % tidak ditemukan di naskah', p_bab; end if;
  if length(trim(priv.node_text(jsonb_build_object('content', (v_slice->'content') - 0)))) < 20 then
    raise exception 'Isi Bab % masih kosong', p_bab;
  end if;
  v_judul := trim(priv.node_text(v_slice->'content'->0));

  if exists (select 1 from public.chapter_submissions where thesis_id = p_thesis and bab = p_bab and status = 'diajukan') then
    raise exception 'Bab % masih menunggu review', p_bab;
  end if;
  select * into v_last from public.chapter_submissions where thesis_id = p_thesis and bab = p_bab and status <> 'ditarik'
   order by nomor desc limit 1;
  if found and v_last.status = 'acc' then raise exception 'Bab % sudah di-ACC', p_bab; end if;
  if exists (select 1 from public.thesis_milestones where thesis_id = p_thesis and kode = 'BAB' || p_bab and status = 'selesai') then
    raise exception 'Bab % sudah di-ACC Pembimbing 1 dan 2', p_bab;
  end if;
  if found and v_last.konten = v_slice then raise exception 'Isi Bab % belum berubah sejak pengajuan ke-%', p_bab, v_last.nomor; end if;

  select coalesce(max(nomor), 0) + 1 into v_nomor from public.chapter_submissions where thesis_id = p_thesis and bab = p_bab;

  -- Potret seluruh naskah sebagai versi
  select coalesce(max(nomor), 0) + 1 into v_ver_no from public.manuscript_versions where thesis_id = p_thesis;
  insert into public.manuscript_versions (thesis_id, nomor, konten, jumlah_kata, catatan, dibuat_oleh)
  values (p_thesis, v_ver_no, v_ms.konten, v_ms.jumlah_kata, format('Pengajuan Bab %s (ke-%s)', p_bab, v_nomor), auth.uid())
  returning id into v_ver;

  select * into v_mil from public.thesis_milestones where thesis_id = p_thesis and kode = 'BAB' || p_bab;

  insert into public.chapter_submissions (thesis_id, bab, nomor, judul, konten, version_id, milestone_id, catatan, diajukan_oleh)
  values (p_thesis, p_bab, v_nomor, coalesce(nullif(v_judul, ''), 'Bab ' || p_bab), v_slice, v_ver, v_mil.id,
          nullif(trim(coalesce(p_catatan, '')), ''), auth.uid())
  returning id into v_id;

  if v_mil.id is not null and v_mil.status not in ('selesai') then
    perform priv.set_milestone_status(v_mil.id, 'menunggu_review', format('Bab %s diajukan untuk review (ke-%s)', p_bab, v_nomor));
  end if;

  perform priv.notify(s.dosen_id, 'pengajuan_bab', format('Pengajuan Bab %s: %s', p_bab, initcap(lower(v_judul))),
                      (select nama from public.profiles where id = auth.uid()) || format(' mengajukan Bab %s (pengajuan ke-%s).', p_bab, v_nomor),
                      '/naskah/' || p_thesis || '/ajuan/' || v_id)
  from public.thesis_supervisors s where s.thesis_id = p_thesis and s.aktif;
  return v_id;
end;
$$;

create or replace function public.tarik_pengajuan_bab(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_s public.chapter_submissions;
begin
  perform priv.require_user();
  select * into v_s from public.chapter_submissions where id = p_id for update;
  if not found then raise exception 'Pengajuan tidak ditemukan'; end if;
  if v_s.diajukan_oleh <> auth.uid() then raise exception 'Hanya mahasiswa yang mengajukan dapat menarik pengajuan'; end if;
  if v_s.status <> 'diajukan' then raise exception 'Pengajuan sudah ditinjau dan tidak dapat ditarik'; end if;
  if exists (select 1 from public.chapter_reviews where submission_id = p_id) then
    raise exception 'Pengajuan sudah ditinjau dosen dan tidak dapat ditarik';
  end if;
  if exists (select 1 from public.review_comments where submission_id = p_id and terkirim) then
    raise exception 'Sudah ada komentar dosen pada pengajuan ini';
  end if;
  delete from public.review_comments where submission_id = p_id;
  update public.chapter_submissions set status = 'ditarik', ditutup_at = now() where id = p_id;
  if v_s.milestone_id is not null then
    update public.thesis_milestones set status = 'dikerjakan'
     where id = v_s.milestone_id and status = 'menunggu_review';
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Dosen: komentar (draf sampai keputusan dikirim)
-- ---------------------------------------------------------------------
create or replace function public.komentar_naskah(
  p_submission uuid, p_isi text, p_kutipan text, p_prefix text, p_suffix text, p_posisi jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_s public.chapter_submissions; v_id uuid;
begin
  perform priv.require_user();
  select * into v_s from public.chapter_submissions where id = p_submission;
  if not found then raise exception 'Pengajuan tidak ditemukan'; end if;
  if not (priv.is_supervisor_of(v_s.thesis_id) or priv.is_examiner_of(v_s.thesis_id)) then
    raise exception 'Hanya pembimbing atau penguji yang dapat memberi komentar';
  end if;
  if v_s.status = 'ditarik' then raise exception 'Pengajuan sudah ditarik'; end if;
  if length(trim(coalesce(p_isi, ''))) = 0 then raise exception 'Isi komentar wajib diisi'; end if;
  if length(trim(coalesce(p_kutipan, ''))) = 0 then raise exception 'Pilih teks yang dikomentari'; end if;
  insert into public.review_comments (thesis_id, submission_id, bab, penulis_id, isi, kutipan, prefix, suffix, posisi, terkirim)
  values (v_s.thesis_id, p_submission, v_s.bab, auth.uid(), trim(p_isi), left(p_kutipan, 2000), left(p_prefix, 200), left(p_suffix, 200), p_posisi,
          v_s.status <> 'diajukan' or priv.sudah_acc_bab(v_s.thesis_id, v_s.bab, auth.uid()))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.ubah_komentar(p_id uuid, p_isi text)
returns void language plpgsql security definer set search_path = public as $$
declare v_c public.review_comments;
begin
  perform priv.require_user();
  select * into v_c from public.review_comments where id = p_id;
  if not found then raise exception 'Komentar tidak ditemukan'; end if;
  if v_c.penulis_id <> auth.uid() then raise exception 'Hanya penulis yang dapat mengubah komentar'; end if;
  if length(trim(coalesce(p_isi, ''))) = 0 then raise exception 'Isi komentar wajib diisi'; end if;
  if v_c.terkirim and v_c.parent_id is null then raise exception 'Komentar yang sudah dikirim tidak dapat diubah; tambahkan balasan'; end if;
  update public.review_comments set isi = trim(p_isi), updated_at = now() where id = p_id;
end;
$$;

create or replace function public.hapus_komentar(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_c public.review_comments;
begin
  perform priv.require_user();
  select * into v_c from public.review_comments where id = p_id;
  if not found then raise exception 'Komentar tidak ditemukan'; end if;
  if v_c.penulis_id <> auth.uid() then raise exception 'Hanya penulis yang dapat menghapus komentar'; end if;
  if v_c.terkirim and v_c.parent_id is null then raise exception 'Komentar yang sudah dikirim tidak dapat dihapus'; end if;
  delete from public.review_comments where id = p_id;
end;
$$;

create or replace function public.balas_komentar(p_parent uuid, p_isi text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_p public.review_comments; v_id uuid; v_mhs uuid;
begin
  perform priv.require_user();
  select * into v_p from public.review_comments where id = p_parent;
  if not found or v_p.parent_id is not null then raise exception 'Komentar tidak ditemukan'; end if;
  if not v_p.terkirim then raise exception 'Komentar masih draf'; end if;
  select mahasiswa_id into v_mhs from public.thesis where id = v_p.thesis_id;
  if not (v_mhs = auth.uid() or priv.is_supervisor_of(v_p.thesis_id) or priv.is_examiner_of(v_p.thesis_id)) then
    raise exception 'Anda tidak dapat membalas komentar ini';
  end if;
  if length(trim(coalesce(p_isi, ''))) = 0 then raise exception 'Isi balasan wajib diisi'; end if;
  insert into public.review_comments (thesis_id, submission_id, bab, parent_id, penulis_id, isi, terkirim)
  values (v_p.thesis_id, v_p.submission_id, v_p.bab, p_parent, auth.uid(), trim(p_isi), true)
  returning id into v_id;
  if auth.uid() = v_mhs then
    perform priv.notify(v_p.penulis_id, 'balasan_komentar', 'Balasan pada komentar Bab ' || v_p.bab,
                        left(trim(p_isi), 140), '/naskah/' || v_p.thesis_id || '/ajuan/' || v_p.submission_id);
  else
    perform priv.notify(v_mhs, 'balasan_komentar', 'Balasan dosen pada komentar Bab ' || v_p.bab, left(trim(p_isi), 140), '/naskah');
  end if;
  return v_id;
end;
$$;

-- Mahasiswa: terbuka <-> diperbaiki. Dosen penulis: selesai / buka kembali.
create or replace function public.tandai_komentar(p_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare v_c public.review_comments; v_mhs uuid;
begin
  perform priv.require_user();
  select * into v_c from public.review_comments where id = p_id for update;
  if not found or v_c.parent_id is not null then raise exception 'Komentar tidak ditemukan'; end if;
  if not v_c.terkirim then raise exception 'Komentar masih draf'; end if;
  select mahasiswa_id into v_mhs from public.thesis where id = v_c.thesis_id;
  if p_status not in ('terbuka', 'diperbaiki', 'selesai') then raise exception 'Status tidak dikenal'; end if;
  if auth.uid() = v_mhs then
    if p_status = 'selesai' then raise exception 'Komentar diselesaikan oleh dosen'; end if;
    if v_c.status = 'selesai' then raise exception 'Komentar sudah diselesaikan dosen'; end if;
  elsif v_c.penulis_id = auth.uid() or priv.is_supervisor_of(v_c.thesis_id) then
    null;
  else
    raise exception 'Anda tidak dapat mengubah status komentar ini';
  end if;
  update public.review_comments set status = p_status, status_oleh = auth.uid(), status_at = now(), updated_at = now() where id = p_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Dosen: keputusan review. Mengirim semua komentar draf dosen ini pada
-- pengajuan, lalu Revisi atau ACC. ACC memakai priv.acc_milestone sehingga
-- bab selesai setelah Pembimbing 1 dan 2 sama-sama ACC.
-- ---------------------------------------------------------------------
create or replace function public.tinjau_bab(p_submission uuid, p_hasil text, p_catatan text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_s public.chapter_submissions;
  v_peran public.supervisor_role;
  v_mhs uuid;
  v_need int;
  v_acc int;
  v_res text := 'tercatat';
  v_draf int;
begin
  perform priv.require_user();
  select * into v_s from public.chapter_submissions where id = p_submission for update;
  if not found then raise exception 'Pengajuan tidak ditemukan'; end if;
  select peran into v_peran from public.thesis_supervisors where thesis_id = v_s.thesis_id and dosen_id = auth.uid() and aktif;
  if v_peran is null then raise exception 'Hanya Pembimbing 1 atau 2 yang dapat memberi keputusan review'; end if;
  if p_hasil not in ('revisi', 'acc') then raise exception 'Keputusan harus Revisi atau ACC'; end if;
  if v_s.status in ('ditarik', 'acc') then raise exception 'Pengajuan sudah ditutup'; end if;
  if exists (select 1 from public.chapter_submissions where thesis_id = v_s.thesis_id and bab = v_s.bab and nomor > v_s.nomor and status <> 'ditarik') then
    raise exception 'Sudah ada pengajuan yang lebih baru untuk bab ini';
  end if;
  if exists (select 1 from public.chapter_reviews where submission_id = p_submission and dosen_id = auth.uid()) then
    raise exception 'Anda sudah memberi keputusan untuk pengajuan ini';
  end if;
  if priv.sudah_acc_bab(v_s.thesis_id, v_s.bab, auth.uid()) then
    raise exception 'Anda sudah memberi ACC untuk Bab %; menunggu pembimbing lainnya', v_s.bab;
  end if;
  if p_hasil = 'revisi' and length(trim(coalesce(p_catatan, ''))) = 0
     and not exists (select 1 from public.review_comments where submission_id = p_submission and penulis_id = auth.uid() and parent_id is null) then
    raise exception 'Beri komentar pada naskah atau catatan revisi';
  end if;

  select mahasiswa_id into v_mhs from public.thesis where id = v_s.thesis_id;

  if p_hasil = 'acc' then
    if v_s.milestone_id is not null then
      v_res := priv.acc_milestone(v_s.milestone_id, coalesce(nullif(trim(coalesce(p_catatan,'')), ''), format('ACC lewat review Bab %s (pengajuan ke-%s)', v_s.bab, v_s.nomor)), null);
    end if;
  end if;

  update public.review_comments set terkirim = true, updated_at = now()
   where submission_id = p_submission and penulis_id = auth.uid() and not terkirim;
  get diagnostics v_draf = row_count;

  insert into public.chapter_reviews (submission_id, thesis_id, dosen_id, peran, hasil, catatan)
  values (p_submission, v_s.thesis_id, auth.uid(), v_peran, p_hasil, nullif(trim(coalesce(p_catatan, '')), ''));

  select count(*) into v_need from public.thesis_supervisors where thesis_id = v_s.thesis_id and aktif;
  select count(*) into v_acc from public.thesis_supervisors s
   where s.thesis_id = v_s.thesis_id and s.aktif and priv.sudah_acc_bab(v_s.thesis_id, v_s.bab, s.dosen_id);

  if p_hasil = 'revisi' then
    update public.chapter_submissions set status = 'revisi', ditutup_at = coalesce(ditutup_at, now()) where id = p_submission;
    if v_s.milestone_id is not null then
      update public.thesis_milestones set status = 'revisi' where id = v_s.milestone_id and status <> 'selesai';
    end if;
    perform priv.notify(v_mhs, 'review_bab', format('Revisi Bab %s dari %s', v_s.bab, v_peran),
                        format('%s komentar baru. %s', v_draf, coalesce(nullif(trim(coalesce(p_catatan,'')), ''), 'Lihat catatan di naskah.')), '/naskah');
  elsif v_acc >= v_need and v_need >= 1 then
    update public.chapter_submissions set status = 'acc', ditutup_at = now() where id = p_submission;
    perform priv.notify(v_mhs, 'review_bab', format('Bab %s di-ACC', v_s.bab), 'Pembimbing 1 dan 2 sudah memberi ACC.', '/naskah');
  else
    perform priv.notify(v_mhs, 'review_bab', format('ACC %s untuk Bab %s', v_peran, v_s.bab),
                        case when v_draf > 0 then format('%s komentar ditambahkan. ', v_draf) else '' end || 'Menunggu pembimbing lainnya.', '/naskah');
  end if;
  return coalesce(v_res, 'tercatat');
end;
$$;

-- ---------------------------------------------------------------------
-- Antrean review dosen (pembimbing aktif)
-- ---------------------------------------------------------------------
create or replace function public.antrean_review()
returns table (
  id uuid, thesis_id uuid, bab int, nomor int, judul text, status text, created_at timestamptz,
  mahasiswa_nama text, nim text, peran text, perlu_tinjau boolean)
language sql stable security definer set search_path = public as $$
  select s.id, s.thesis_id, s.bab, s.nomor, s.judul, s.status, s.created_at, p.nama, p.nim, sp.peran::text,
         (s.status = 'diajukan'
          and not exists (select 1 from public.chapter_reviews r where r.submission_id = s.id and r.dosen_id = auth.uid())
          and not priv.sudah_acc_bab(s.thesis_id, s.bab, auth.uid())) as perlu_tinjau
    from public.chapter_submissions s
    join public.thesis_supervisors sp on sp.thesis_id = s.thesis_id and sp.dosen_id = auth.uid() and sp.aktif
    join public.thesis t on t.id = s.thesis_id
    join public.profiles p on p.id = t.mahasiswa_id
   where s.status <> 'ditarik'
   order by s.created_at desc
   limit 300;
$$;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.chapter_submissions enable row level security;
alter table public.chapter_reviews enable row level security;
alter table public.review_comments enable row level security;

create policy chapter_submissions_select on public.chapter_submissions for select to authenticated
  using (priv.can_view_thesis(thesis_id));
create policy chapter_reviews_select on public.chapter_reviews for select to authenticated
  using (priv.can_view_thesis(thesis_id));
-- Draf komentar hanya terlihat oleh penulisnya
create policy review_comments_select on public.review_comments for select to authenticated
  using (penulis_id = auth.uid() or (terkirim and priv.can_view_thesis(thesis_id)));

revoke all on public.chapter_submissions, public.chapter_reviews, public.review_comments from anon;

revoke execute on function
  public.ajukan_bab(uuid, int, text), public.tarik_pengajuan_bab(uuid),
  public.komentar_naskah(uuid, text, text, text, text, jsonb), public.ubah_komentar(uuid, text), public.hapus_komentar(uuid),
  public.balas_komentar(uuid, text), public.tandai_komentar(uuid, text), public.tinjau_bab(uuid, text, text), public.antrean_review()
  from public, anon;
grant execute on function
  public.ajukan_bab(uuid, int, text), public.tarik_pengajuan_bab(uuid),
  public.komentar_naskah(uuid, text, text, text, text, jsonb), public.ubah_komentar(uuid, text), public.hapus_komentar(uuid),
  public.balas_komentar(uuid, text), public.tandai_komentar(uuid, text), public.tinjau_bab(uuid, text, text), public.antrean_review()
  to authenticated;
revoke execute on function priv.slice_bab(jsonb, int), priv.node_text(jsonb), priv.sudah_acc_bab(uuid, int, uuid) from public;

-- ===================== supabase/migrations/20261028000900_review_dua_pembimbing.sql =====================
-- =====================================================================
-- SIMSA — Migrasi 9: perbaikan alur review bab dengan dua pembimbing
--   * Revisi dari satu pembimbing tidak lagi menutup pengajuan; pembimbing
--     lain tetap dapat berkomentar dan memberi keputusan pada pengajuan itu.
--   * Pengajuan tertutup setelah semua pembimbing merespons, atau saat
--     mahasiswa mengajukan versi perbaikan (draf komentar yang tertinggal
--     ikut terkirim agar tidak hilang).
--   * Dosen dapat mengirim komentar tanpa keputusan (kirim_komentar).
--   * Komentar penguji (bukan pembimbing) langsung terkirim.
-- =====================================================================

create or replace function public.komentar_naskah(
  p_submission uuid, p_isi text, p_kutipan text, p_prefix text, p_suffix text, p_posisi jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_s public.chapter_submissions; v_id uuid;
begin
  perform priv.require_user();
  select * into v_s from public.chapter_submissions where id = p_submission;
  if not found then raise exception 'Pengajuan tidak ditemukan'; end if;
  if not (priv.is_supervisor_of(v_s.thesis_id) or priv.is_examiner_of(v_s.thesis_id)) then
    raise exception 'Hanya pembimbing atau penguji yang dapat memberi komentar';
  end if;
  if v_s.status = 'ditarik' then raise exception 'Pengajuan sudah ditarik'; end if;
  if length(trim(coalesce(p_isi, ''))) = 0 then raise exception 'Isi komentar wajib diisi'; end if;
  if length(trim(coalesce(p_kutipan, ''))) = 0 then raise exception 'Pilih teks yang dikomentari'; end if;
  insert into public.review_comments (thesis_id, submission_id, bab, penulis_id, isi, kutipan, prefix, suffix, posisi, terkirim)
  values (v_s.thesis_id, p_submission, v_s.bab, auth.uid(), trim(p_isi), left(p_kutipan, 2000), left(p_prefix, 200), left(p_suffix, 200), p_posisi,
          v_s.status <> 'diajukan' or priv.sudah_acc_bab(v_s.thesis_id, v_s.bab, auth.uid())
          or exists (select 1 from public.chapter_reviews r where r.submission_id = p_submission and r.dosen_id = auth.uid())
          or not priv.is_supervisor_of(v_s.thesis_id))
  returning id into v_id;
  return v_id;
end;
$$;


create or replace function public.ajukan_bab(p_thesis uuid, p_bab int, p_catatan text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_th public.thesis;
  v_ms public.thesis_manuscripts;
  v_slice jsonb;
  v_judul text;
  v_nomor int;
  v_ver uuid;
  v_ver_no int;
  v_mil public.thesis_milestones;
  v_id uuid;
  v_last public.chapter_submissions;
begin
  perform priv.require_user();
  select * into v_th from public.thesis where id = p_thesis;
  if not found then raise exception 'Tugas akhir tidak ditemukan'; end if;
  if v_th.mahasiswa_id <> auth.uid() then raise exception 'Hanya mahasiswa pemilik yang dapat mengajukan bab'; end if;
  if v_th.status <> 'aktif' then raise exception 'Studi akhir tidak aktif'; end if;
  if not exists (select 1 from public.thesis_supervisors where thesis_id = p_thesis and aktif) then
    raise exception 'Pembimbing belum ditetapkan';
  end if;

  select * into v_ms from public.thesis_manuscripts where thesis_id = p_thesis;
  if not found then raise exception 'Naskah masih kosong'; end if;
  v_slice := priv.slice_bab(v_ms.konten, p_bab);
  if v_slice is null then raise exception 'Bab % tidak ditemukan di naskah', p_bab; end if;
  if length(trim(priv.node_text(jsonb_build_object('content', (v_slice->'content') - 0)))) < 20 then
    raise exception 'Isi Bab % masih kosong', p_bab;
  end if;
  v_judul := trim(priv.node_text(v_slice->'content'->0));

  -- Pengajuan yang masih terbuka: boleh digantikan bila sudah ada permintaan revisi.
  select * into v_last from public.chapter_submissions where thesis_id = p_thesis and bab = p_bab and status = 'diajukan';
  if found then
    if not exists (select 1 from public.chapter_reviews where submission_id = v_last.id and hasil = 'revisi') then
      raise exception 'Bab % masih menunggu review. Tarik pengajuan bila ingin mengganti isinya.', p_bab;
    end if;
    -- Kirim draf komentar yang tertinggal agar tidak hilang, lalu tutup pengajuan lama.
    update public.review_comments set terkirim = true, updated_at = now() where submission_id = v_last.id and not terkirim;
    update public.chapter_submissions set status = 'revisi', ditutup_at = now() where id = v_last.id;
  end if;
  select * into v_last from public.chapter_submissions where thesis_id = p_thesis and bab = p_bab and status <> 'ditarik'
   order by nomor desc limit 1;
  if found and v_last.status = 'acc' then raise exception 'Bab % sudah di-ACC', p_bab; end if;
  if exists (select 1 from public.thesis_milestones where thesis_id = p_thesis and kode = 'BAB' || p_bab and status = 'selesai') then
    raise exception 'Bab % sudah di-ACC Pembimbing 1 dan 2', p_bab;
  end if;
  if found and v_last.konten = v_slice then raise exception 'Isi Bab % belum berubah sejak pengajuan ke-%', p_bab, v_last.nomor; end if;

  select coalesce(max(nomor), 0) + 1 into v_nomor from public.chapter_submissions where thesis_id = p_thesis and bab = p_bab;

  -- Potret seluruh naskah sebagai versi
  select coalesce(max(nomor), 0) + 1 into v_ver_no from public.manuscript_versions where thesis_id = p_thesis;
  insert into public.manuscript_versions (thesis_id, nomor, konten, jumlah_kata, catatan, dibuat_oleh)
  values (p_thesis, v_ver_no, v_ms.konten, v_ms.jumlah_kata, format('Pengajuan Bab %s (ke-%s)', p_bab, v_nomor), auth.uid())
  returning id into v_ver;

  select * into v_mil from public.thesis_milestones where thesis_id = p_thesis and kode = 'BAB' || p_bab;

  insert into public.chapter_submissions (thesis_id, bab, nomor, judul, konten, version_id, milestone_id, catatan, diajukan_oleh)
  values (p_thesis, p_bab, v_nomor, coalesce(nullif(v_judul, ''), 'Bab ' || p_bab), v_slice, v_ver, v_mil.id,
          nullif(trim(coalesce(p_catatan, '')), ''), auth.uid())
  returning id into v_id;

  if v_mil.id is not null and v_mil.status not in ('selesai') then
    perform priv.set_milestone_status(v_mil.id, 'menunggu_review', format('Bab %s diajukan untuk review (ke-%s)', p_bab, v_nomor));
  end if;

  perform priv.notify(s.dosen_id, 'pengajuan_bab', format('Pengajuan Bab %s: %s', p_bab, initcap(lower(v_judul))),
                      (select nama from public.profiles where id = auth.uid()) || format(' mengajukan Bab %s (pengajuan ke-%s).', p_bab, v_nomor),
                      '/naskah/' || p_thesis || '/ajuan/' || v_id)
  from public.thesis_supervisors s where s.thesis_id = p_thesis and s.aktif;
  return v_id;
end;
$$;


create or replace function public.tinjau_bab(p_submission uuid, p_hasil text, p_catatan text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_s public.chapter_submissions;
  v_peran public.supervisor_role;
  v_mhs uuid;
  v_need int;
  v_acc int;
  v_res text := 'tercatat';
  v_draf int;
  v_respon int;
begin
  perform priv.require_user();
  select * into v_s from public.chapter_submissions where id = p_submission for update;
  if not found then raise exception 'Pengajuan tidak ditemukan'; end if;
  select peran into v_peran from public.thesis_supervisors where thesis_id = v_s.thesis_id and dosen_id = auth.uid() and aktif;
  if v_peran is null then raise exception 'Hanya Pembimbing 1 atau 2 yang dapat memberi keputusan review'; end if;
  if p_hasil not in ('revisi', 'acc') then raise exception 'Keputusan harus Revisi atau ACC'; end if;
  if exists (select 1 from public.chapter_submissions where thesis_id = v_s.thesis_id and bab = v_s.bab and nomor > v_s.nomor and status <> 'ditarik') then
    raise exception 'Sudah ada pengajuan yang lebih baru untuk bab ini';
  end if;
  if v_s.status <> 'diajukan' then raise exception 'Pengajuan sudah ditutup'; end if;
  if exists (select 1 from public.chapter_reviews where submission_id = p_submission and dosen_id = auth.uid()) then
    raise exception 'Anda sudah memberi keputusan untuk pengajuan ini';
  end if;
  if priv.sudah_acc_bab(v_s.thesis_id, v_s.bab, auth.uid()) then
    raise exception 'Anda sudah memberi ACC untuk Bab %; menunggu pembimbing lainnya', v_s.bab;
  end if;
  if p_hasil = 'revisi' and length(trim(coalesce(p_catatan, ''))) = 0
     and not exists (select 1 from public.review_comments where submission_id = p_submission and penulis_id = auth.uid() and parent_id is null) then
    raise exception 'Beri komentar pada naskah atau catatan revisi';
  end if;

  select mahasiswa_id into v_mhs from public.thesis where id = v_s.thesis_id;

  if p_hasil = 'acc' then
    if v_s.milestone_id is not null then
      v_res := priv.acc_milestone(v_s.milestone_id, coalesce(nullif(trim(coalesce(p_catatan,'')), ''), format('ACC lewat review Bab %s (pengajuan ke-%s)', v_s.bab, v_s.nomor)), null);
    end if;
  end if;

  update public.review_comments set terkirim = true, updated_at = now()
   where submission_id = p_submission and penulis_id = auth.uid() and not terkirim;
  get diagnostics v_draf = row_count;

  insert into public.chapter_reviews (submission_id, thesis_id, dosen_id, peran, hasil, catatan)
  values (p_submission, v_s.thesis_id, auth.uid(), v_peran, p_hasil, nullif(trim(coalesce(p_catatan, '')), ''));

  select count(*) into v_need from public.thesis_supervisors where thesis_id = v_s.thesis_id and aktif;
  select count(*) into v_acc from public.thesis_supervisors s
   where s.thesis_id = v_s.thesis_id and s.aktif and priv.sudah_acc_bab(v_s.thesis_id, v_s.bab, s.dosen_id);
  -- Pembimbing yang sudah merespons pengajuan ini (atau sudah ACC bab ini sebelumnya)
  select count(*) into v_respon from public.thesis_supervisors s
   where s.thesis_id = v_s.thesis_id and s.aktif
     and (exists (select 1 from public.chapter_reviews r where r.submission_id = p_submission and r.dosen_id = s.dosen_id)
          or priv.sudah_acc_bab(v_s.thesis_id, v_s.bab, s.dosen_id));

  if p_hasil = 'revisi' then
    -- Pengajuan tetap terbuka untuk pembimbing lain sampai semua merespons
    -- (atau mahasiswa mengajukan versi perbaikan lebih dulu).
    if v_respon >= v_need then
      update public.chapter_submissions set status = 'revisi', ditutup_at = coalesce(ditutup_at, now()) where id = p_submission;
    end if;
    if v_s.milestone_id is not null then
      update public.thesis_milestones set status = 'revisi' where id = v_s.milestone_id and status <> 'selesai';
    end if;
    perform priv.notify(v_mhs, 'review_bab', format('Revisi Bab %s dari %s', v_s.bab, v_peran),
                        format('%s komentar baru. %s', v_draf, coalesce(nullif(trim(coalesce(p_catatan,'')), ''), 'Lihat catatan di naskah.')), '/naskah');
  elsif v_acc >= v_need and v_need >= 1 then
    update public.chapter_submissions set status = 'acc', ditutup_at = now() where id = p_submission;
    perform priv.notify(v_mhs, 'review_bab', format('Bab %s di-ACC', v_s.bab), 'Pembimbing 1 dan 2 sudah memberi ACC.', '/naskah');
  else
    if v_respon >= v_need then
      update public.chapter_submissions set status = 'revisi', ditutup_at = coalesce(ditutup_at, now()) where id = p_submission;
    end if;
    perform priv.notify(v_mhs, 'review_bab', format('ACC %s untuk Bab %s', v_peran, v_s.bab),
                        case when v_draf > 0 then format('%s komentar ditambahkan. ', v_draf) else '' end || 'Menunggu pembimbing lainnya.', '/naskah');
  end if;
  return coalesce(v_res, 'tercatat');
end;
$$;


-- Kirim draf komentar sekarang tanpa memberi keputusan.
create or replace function public.kirim_komentar(p_submission uuid)
returns int language plpgsql security definer set search_path = public as $$
declare v_s public.chapter_submissions; v_n int; v_mhs uuid;
begin
  perform priv.require_user();
  select * into v_s from public.chapter_submissions where id = p_submission;
  if not found then raise exception 'Pengajuan tidak ditemukan'; end if;
  update public.review_comments set terkirim = true, updated_at = now()
   where submission_id = p_submission and penulis_id = auth.uid() and not terkirim and parent_id is null;
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'Tidak ada komentar draf untuk dikirim'; end if;
  select mahasiswa_id into v_mhs from public.thesis where id = v_s.thesis_id;
  perform priv.notify(v_mhs, 'review_bab', format('%s komentar baru pada Bab %s', v_n, v_s.bab),
                      (select nama from public.profiles where id = auth.uid()) || ' menambahkan komentar. Keputusan review menyusul.', '/naskah');
  return v_n;
end;
$$;

revoke execute on function public.kirim_komentar(uuid) from public, anon;
grant execute on function public.kirim_komentar(uuid) to authenticated;

-- Perbaiki data yang sudah terlanjur: pengajuan berstatus revisi yang belum
-- direspons semua pembimbing dan belum digantikan, dibuka kembali.
update public.chapter_submissions s set status = 'diajukan', ditutup_at = null
 where s.status = 'revisi'
   and not exists (select 1 from public.chapter_submissions n where n.thesis_id = s.thesis_id and n.bab = s.bab and n.nomor > s.nomor and n.status <> 'ditarik')
   and (select count(*) from public.chapter_reviews r where r.submission_id = s.id)
       < (select count(*) from public.thesis_supervisors p where p.thesis_id = s.thesis_id and p.aktif)
   and not exists (select 1 from public.chapter_submissions o where o.thesis_id = s.thesis_id and o.bab = s.bab and o.status = 'diajukan');

-- Draf komentar yang tertinggal di pengajuan lama (sudah digantikan) dikirim.
update public.review_comments c set terkirim = true, updated_at = now()
 where not c.terkirim
   and exists (select 1 from public.chapter_submissions s join public.chapter_submissions n
                 on n.thesis_id = s.thesis_id and n.bab = s.bab and n.nomor > s.nomor and n.status <> 'ditarik'
                where s.id = c.submission_id);

-- ===================== supabase/migrations/20261028001000_pustaka.sql =====================
-- =====================================================================
-- SIMSA — Migrasi 10: pustaka (referensi) naskah
--   * thesis_references: daftar rujukan milik satu studi akhir, disimpan
--     dalam format CSL-JSON (standar yang dipakai Mendeley, Zotero, Crossref).
--   * Sitasi di naskah merujuk id baris ini; daftar pustaka disusun otomatis
--     dengan gaya sesuai pedoman prodi (APA atau IEEE).
-- Hanya mahasiswa pemilik yang dapat menambah, mengubah, atau menghapus
-- rujukan; pihak lain yang berhak melihat studi akhir dapat membaca.
-- =====================================================================

create table public.thesis_references (
  id uuid primary key default gen_random_uuid(),
  thesis_id uuid not null references public.thesis (id) on delete cascade,
  csl jsonb not null check (jsonb_typeof(csl) = 'object'),
  doi text,
  sumber text not null default 'manual' check (sumber in ('doi', 'cari', 'bibtex', 'ris', 'manual', 'mendeley')),
  created_by uuid references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index thesis_references_doi_unik on public.thesis_references (thesis_id, lower(doi)) where doi is not null and doi <> '';
create index thesis_references_thesis_idx on public.thesis_references (thesis_id, created_at);
create trigger thesis_references_touch before update on public.thesis_references
  for each row execute function priv.touch_updated_at();

alter table public.thesis_references enable row level security;

create policy thesis_references_select on public.thesis_references for select to authenticated
  using (priv.can_view_thesis(thesis_id));

create policy thesis_references_insert on public.thesis_references for insert to authenticated
  with check (
    priv.is_thesis_owner(thesis_id)
    and exists (select 1 from public.thesis t where t.id = thesis_id and t.status = 'aktif')
  );

create policy thesis_references_update on public.thesis_references for update to authenticated
  using (priv.is_thesis_owner(thesis_id))
  with check (priv.is_thesis_owner(thesis_id));

create policy thesis_references_delete on public.thesis_references for delete to authenticated
  using (priv.is_thesis_owner(thesis_id));

revoke all on public.thesis_references from anon;
grant select, insert, update, delete on public.thesis_references to authenticated;

-- ===================== supabase/migrations/20261028001100_aisys.sql =====================
-- =====================================================================
-- SIMSA — Migrasi 11: AISYS (Akal Imitasi STIKOM Yos Sudarso)
--   * ai_usage_logs: catatan setiap pemakaian AISYS (siapa, fitur, studi
--     akhir, jumlah token, durasi, berhasil atau gagal).
--   * Ditulis hanya oleh server SIMSA (service role); hanya Admin yang dapat
--     membaca. Mahasiswa, dosen, Ka. Prodi tidak dapat melihat catatan ini.
-- Isi naskah dan jawaban AI tidak disimpan; hanya cuplikan pendek masukan.
-- =====================================================================

create table public.ai_usage_logs (
  id bigint generated always as identity primary key,
  user_id uuid references public.profiles (id) on delete set null,
  peran text not null check (peran in ('mahasiswa', 'dosen')),
  thesis_id uuid references public.thesis (id) on delete set null,
  fitur text not null check (fitur in ('parafrase', 'susun', 'cari_jurnal', 'periksa_bab', 'review_bab')),
  model text,
  token_masuk int not null default 0,
  token_keluar int not null default 0,
  durasi_ms int not null default 0,
  status text not null default 'ok' check (status in ('ok', 'gagal', 'ditolak')),
  galat text,
  cuplikan text,
  created_at timestamptz not null default now()
);
create index ai_usage_logs_user_idx on public.ai_usage_logs (user_id, created_at desc);
create index ai_usage_logs_created_idx on public.ai_usage_logs (created_at desc);

alter table public.ai_usage_logs enable row level security;

create policy ai_usage_logs_admin on public.ai_usage_logs for select to authenticated
  using (priv.is_admin());

revoke all on public.ai_usage_logs from anon, authenticated;
grant select on public.ai_usage_logs to authenticated;

-- ===================== supabase/migrations/20261028001200_kinerja.sql =====================
-- =====================================================================
-- SIMSA — Migrasi 12: kinerja kueri
--   1. Indeks untuk kolom yang sering dipakai menyaring dan menggabung.
--   2. Aturan RLS: pemeriksaan yang tidak bergantung pada baris (auth.uid(),
--      is_admin(), has_role(...)) dibungkus "(select ...)" agar dihitung sekali
--      per kueri, bukan sekali per baris (saran resmi Supabase).
--   3. Peran yang melihat semua studi akhir (Admin, Pimpinan, BAAK semua prodi)
--      tidak lagi menjalankan pemeriksaan akses per baris.
-- Aman dijalankan ulang.
-- =====================================================================

-- 1. Indeks ------------------------------------------------------------
create index if not exists comments_thesis_idx on public.comments (thesis_id);
create index if not exists exam_panel_thesis_idx on public.exam_panel (thesis_id, dosen_id);
create index if not exists exam_revision_notes_exam_idx on public.exam_revision_notes (exam_id);
create index if not exists exam_revision_notes_thesis_idx on public.exam_revision_notes (thesis_id);
create index if not exists exam_scores_thesis_idx on public.exam_scores (thesis_id);
create index if not exists exam_scores_dosen_idx on public.exam_scores (dosen_id);
create index if not exists guidance_sessions_mhs_idx on public.guidance_sessions (mahasiswa_id, tanggal_usulan desc);
create index if not exists thesis_title_history_thesis_idx on public.thesis_title_history (thesis_id);
create index if not exists title_submissions_thesis_idx on public.title_submissions (thesis_id);
create index if not exists user_roles_prodi_idx on public.user_roles (prodi_id) where prodi_id is not null;
create index if not exists milestone_history_milestone_idx on public.milestone_history (milestone_id);
create index if not exists chapter_reviews_dosen_idx on public.chapter_reviews (dosen_id);
create index if not exists guideline_bookmarks_section_idx on public.guideline_bookmarks (section_id);
create index if not exists guideline_sections_parent_idx on public.guideline_sections (parent_id);
create index if not exists milestone_approvals_dosen_idx on public.milestone_approvals (dosen_id);
create index if not exists documents_milestone_idx on public.documents (milestone_id);
create index if not exists notifications_unread_idx on public.notifications (user_id) where dibaca_at is null;
create index if not exists ai_usage_logs_thesis_idx on public.ai_usage_logs (thesis_id);

-- 3. Peran yang melihat semua studi akhir --------------------------------
create or replace function priv.sees_all_thesis()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_roles ur join public.profiles p on p.id = ur.user_id
    where ur.user_id = auth.uid() and p.aktif
      and (ur.role in ('admin', 'pimpinan') or (ur.role = 'baak' and ur.prodi_id is null))
  );
$$;
revoke all on function priv.sees_all_thesis() from public, anon;
grant execute on function priv.sees_all_thesis() to authenticated;

-- 2 dan 3. Tulis ulang ekspresi aturan RLS di skema public ---------------
do $$
declare
  r record;
  q text;
  c text;
  stmt text;
  -- Pemanggilan yang tidak bergantung baris; lewati yang sudah dibungkus SELECT.
  pat constant text := '(?<!SELECT )(auth\.uid\(\)|priv\.is_admin\(\)|priv\.is_staff\(\)|priv\.has_role\(''[a-z]+''::app_role\))';
  fn text;
begin
  for r in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where schemaname = 'public'
  loop
    q := r.qual;
    c := r.with_check;
    if q is not null then
      q := regexp_replace(q, pat, '(SELECT \1)', 'g');
      if q !~ 'sees_all_thesis' then
        q := regexp_replace(q, 'priv\.can_view_thesis\(([a-z_.]+)\)', '((SELECT priv.sees_all_thesis()) OR priv.can_view_thesis(\1))', 'g');
      end if;
    end if;
    if c is not null then
      c := regexp_replace(c, pat, '(SELECT \1)', 'g');
    end if;
    if q is distinct from r.qual or c is distinct from r.with_check then
      stmt := format('alter policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
      if q is not null then stmt := stmt || ' using (' || q || ')'; end if;
      if c is not null then stmt := stmt || ' with check (' || c || ')'; end if;
      execute stmt;
    end if;
  end loop;
end
$$;

-- ===================== supabase/migrations/20261028001300_kunci_fase_judul.sql =====================
-- =====================================================================
-- SIMSA — Migrasi 13
--   1. Kunci bab: bab yang sudah di-ACC Pembimbing 1 dan 2 terkunci untuk
--      mahasiswa; pembimbing yang sudah ACC tidak dapat berkomentar lagi.
--      Kunci terbuka otomatis selama milestone Revisi Seminar aktif.
--   2. Fase milestone (Persiapan, Proposal, Hasil penelitian, Pendadaran,
--      Kelulusan; D3: Persiapan, Penulisan, Ujian, Kelulusan).
--   3. Perubahan judul setelah seminar lewat usulan + persetujuan P1 dan P2;
--      penguji dapat menandai "perlu perubahan judul".
--   4. Sesi bimbingan dapat menautkan pengajuan bab di naskah.
--   5. Daftar fitur AISYS baru pada catatan pemakaian.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Kunci bab
-- ---------------------------------------------------------------------

-- Revisi seminar sedang berjalan: bab yang sudah ACC boleh diperbaiki lagi.
create or replace function priv.revisi_aktif(p_thesis uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.thesis_milestones
    where thesis_id = p_thesis and jenis = 'revisi'
      and status in ('dikerjakan', 'menunggu_review', 'revisi', 'terlambat')
  );
$$;

-- Bab terkunci untuk mahasiswa: semua pembimbing aktif sudah ACC dan tidak sedang revisi seminar.
create or replace function priv.bab_terkunci(p_thesis uuid, p_bab int)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.thesis_supervisors where thesis_id = p_thesis and aktif)
     and not exists (
       select 1 from public.thesis_supervisors s
       where s.thesis_id = p_thesis and s.aktif and not priv.sudah_acc_bab(p_thesis, p_bab, s.dosen_id))
     and not priv.revisi_aktif(p_thesis);
$$;

-- Tanda tangan isi (jenis node dan teks, tanpa atribut tampilan) untuk membandingkan bab.
create or replace function priv.node_sig(p jsonb)
returns text language sql immutable as $$
  select coalesce(p->>'type', '') || '(' || coalesce(p->>'text', '') || coalesce(p->'attrs'->>'refs', '') || coalesce(p->'attrs'->>'path', '') ||
         coalesce((select string_agg(priv.node_sig(c), ',' order by o)
                   from jsonb_array_elements(coalesce(p->'content', '[]'::jsonb)) with ordinality as t(c, o)), '') || ')';
$$;

create or replace function priv.jumlah_bab(p_konten jsonb)
returns int language sql immutable as $$
  select count(*)::int from jsonb_array_elements(coalesce(p_konten->'content', '[]'::jsonb)) n
  where n->>'type' = 'heading' and coalesce((n->'attrs'->>'level')::int, 1) = 1
    and coalesce(n->'attrs'->>'bernomor', 'true') <> 'false';
$$;

-- Status kunci per bab untuk tampilan (mahasiswa, pembimbing, pihak yang berhak melihat).
create or replace function public.status_kunci_bab(p_thesis uuid)
returns table (bab int, terkunci boolean, acc_p1 boolean, acc_p2 boolean, saya_acc boolean, revisi_aktif boolean)
language sql stable security definer set search_path = public as $$
  with b as (
    select distinct s.bab from public.chapter_submissions s where s.thesis_id = p_thesis
    union
    select substring(m.kode from 4)::int from public.thesis_milestones m
     where m.thesis_id = p_thesis and m.kode ~ '^BAB[0-9]+$'
       and exists (select 1 from public.milestone_approvals a where a.milestone_id = m.id)
  )
  select b.bab,
         priv.bab_terkunci(p_thesis, b.bab),
         exists (select 1 from public.thesis_supervisors s where s.thesis_id = p_thesis and s.aktif and s.peran = 'P1' and priv.sudah_acc_bab(p_thesis, b.bab, s.dosen_id)),
         exists (select 1 from public.thesis_supervisors s where s.thesis_id = p_thesis and s.aktif and s.peran = 'P2' and priv.sudah_acc_bab(p_thesis, b.bab, s.dosen_id)),
         priv.sudah_acc_bab(p_thesis, b.bab, auth.uid()),
         priv.revisi_aktif(p_thesis)
  from b
  where priv.can_view_thesis(p_thesis)
  order by b.bab;
$$;

-- Simpan naskah: tolak perubahan pada bab yang terkunci.
create or replace function public.simpan_naskah(p_thesis uuid, p_konten jsonb, p_revisi int, p_kata int)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_th public.thesis;
  v_rev int;
  v_old jsonb;
  v_bab int;
  v_n int;
begin
  perform priv.require_user();
  select * into v_th from public.thesis where id = p_thesis;
  if not found then raise exception 'Tugas akhir tidak ditemukan'; end if;
  if v_th.mahasiswa_id <> auth.uid() then raise exception 'Hanya mahasiswa pemilik yang dapat mengubah naskah'; end if;
  if v_th.status <> 'aktif' then raise exception 'Studi akhir tidak aktif; naskah tidak dapat diubah'; end if;
  if p_konten is null or jsonb_typeof(p_konten) <> 'object' or p_konten->>'type' <> 'doc' then
    raise exception 'Format naskah tidak dikenali';
  end if;
  if octet_length(p_konten::text) > 8 * 1024 * 1024 then
    raise exception 'Naskah terlalu besar (lebih dari 8 MB teks). Pindahkan gambar besar atau pecah tabel.';
  end if;

  select revisi, konten into v_rev, v_old from public.thesis_manuscripts where thesis_id = p_thesis for update;
  if not found then
    insert into public.thesis_manuscripts (thesis_id, konten, revisi, jumlah_kata, updated_by)
    values (p_thesis, p_konten, 1, greatest(coalesce(p_kata, 0), 0), auth.uid());
    return 1;
  end if;
  if p_revisi is distinct from v_rev then
    raise exception 'KONFLIK: Naskah sudah diubah di tab atau perangkat lain. Muat ulang untuk melihat versi terbaru.';
  end if;

  v_n := priv.jumlah_bab(v_old);
  for v_bab in 1 .. v_n loop
    if priv.bab_terkunci(p_thesis, v_bab)
       and priv.node_sig(coalesce(priv.slice_bab(v_old, v_bab), '{}'::jsonb)) is distinct from priv.node_sig(coalesce(priv.slice_bab(p_konten, v_bab), '{}'::jsonb)) then
      raise exception 'TERKUNCI: Bab % sudah di-ACC Pembimbing 1 dan 2 sehingga terkunci. Perubahan pada bab itu tidak disimpan.', v_bab;
    end if;
  end loop;

  update public.thesis_manuscripts
     set konten = p_konten, revisi = v_rev + 1, jumlah_kata = greatest(coalesce(p_kata, 0), 0),
         updated_by = auth.uid(), updated_at = now()
   where thesis_id = p_thesis;
  return v_rev + 1;
end;
$$;

-- Komentar: pembimbing yang sudah ACC bab tidak dapat berkomentar lagi (kecuali saat revisi seminar).
create or replace function public.komentar_naskah(
  p_submission uuid, p_isi text, p_kutipan text, p_prefix text, p_suffix text, p_posisi jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_s public.chapter_submissions; v_id uuid;
begin
  perform priv.require_user();
  select * into v_s from public.chapter_submissions where id = p_submission;
  if not found then raise exception 'Pengajuan tidak ditemukan'; end if;
  if not (priv.is_supervisor_of(v_s.thesis_id) or priv.is_examiner_of(v_s.thesis_id)) then
    raise exception 'Hanya pembimbing atau penguji yang dapat memberi komentar';
  end if;
  if v_s.status = 'ditarik' then raise exception 'Pengajuan sudah ditarik'; end if;
  if priv.sudah_acc_bab(v_s.thesis_id, v_s.bab, auth.uid()) and not priv.revisi_aktif(v_s.thesis_id) then
    raise exception 'Anda sudah memberi ACC untuk Bab %, sehingga komentar untuk bab ini terkunci', v_s.bab;
  end if;
  if length(trim(coalesce(p_isi, ''))) = 0 then raise exception 'Isi komentar wajib diisi'; end if;
  if length(trim(coalesce(p_kutipan, ''))) = 0 then raise exception 'Pilih teks yang dikomentari'; end if;
  insert into public.review_comments (thesis_id, submission_id, bab, penulis_id, isi, kutipan, prefix, suffix, posisi, terkirim)
  values (v_s.thesis_id, p_submission, v_s.bab, auth.uid(), trim(p_isi), left(p_kutipan, 2000), left(p_prefix, 200), left(p_suffix, 200), p_posisi,
          v_s.status <> 'diajukan' or priv.sudah_acc_bab(v_s.thesis_id, v_s.bab, auth.uid())
          or exists (select 1 from public.chapter_reviews r where r.submission_id = p_submission and r.dosen_id = auth.uid())
          or not priv.is_supervisor_of(v_s.thesis_id))
  returning id into v_id;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 2. Fase milestone
-- ---------------------------------------------------------------------
create or replace function priv.fase_bawaan(p_jenjang text, p_kode text)
returns text language sql immutable as $$
  select case
    when p_kode in ('PENDAFTARAN', 'PEMBIMBING') then 'Persiapan'
    when p_kode in ('BERKAS_YUDISIUM', 'YUDISIUM', 'SK') then 'Kelulusan'
    when p_jenjang = 'D3' and p_kode ~ '^BAB[0-9]+$' then 'Penulisan'
    when p_jenjang = 'D3' and p_kode = 'UJIAN_D3' then 'Ujian'
    when p_kode in ('BAB1', 'BAB2', 'BAB3', 'SEMPRO', 'REVISI_SEMPRO') then 'Proposal'
    when p_kode in ('BAB4', 'BAB5', 'SEMHAS', 'REVISI_SEMHAS') then 'Hasil penelitian'
    when p_kode in ('BERKAS_PENDADARAN', 'PENDADARAN') then 'Pendadaran'
    else 'Lainnya'
  end;
$$;

alter table public.milestone_templates add column if not exists fase text;
alter table public.thesis_milestones add column if not exists fase text;

update public.milestone_templates set fase = priv.fase_bawaan(jenjang::text, kode) where fase is null;
update public.thesis_milestones m set fase = coalesce(
  (select t.fase from public.milestone_templates t where t.id = m.template_id),
  priv.fase_bawaan((select th.jenjang::text from public.thesis th where th.id = m.thesis_id), m.kode))
where m.fase is null;

create or replace function priv.isi_fase_template()
returns trigger language plpgsql as $$
begin
  if new.fase is null or trim(new.fase) = '' then new.fase := priv.fase_bawaan(new.jenjang::text, new.kode); end if;
  return new;
end;
$$;
drop trigger if exists milestone_templates_fase on public.milestone_templates;
create trigger milestone_templates_fase before insert or update on public.milestone_templates
  for each row execute function priv.isi_fase_template();

create or replace function priv.isi_fase_milestone()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.fase is null or trim(new.fase) = '' then
    new.fase := coalesce(
      (select t.fase from public.milestone_templates t where t.id = new.template_id),
      priv.fase_bawaan((select th.jenjang::text from public.thesis th where th.id = new.thesis_id), new.kode));
  end if;
  return new;
end;
$$;
drop trigger if exists thesis_milestones_fase on public.thesis_milestones;
create trigger thesis_milestones_fase before insert on public.thesis_milestones
  for each row execute function priv.isi_fase_milestone();

-- v_thesis_progress dan halaman lain membaca thesis_milestones langsung; kolom baru ikut terbaca.

-- ---------------------------------------------------------------------
-- 3. Perubahan judul setelah seminar
-- ---------------------------------------------------------------------
alter table public.exam_panel add column if not exists ubah_judul boolean not null default false;
alter table public.exam_panel add column if not exists arahan_judul text;

-- Penguji/panel menandai bahwa judul perlu diubah, beserta arahannya.
create or replace function public.arahan_judul_ujian(p_exam uuid, p_perlu boolean, p_arahan text)
returns void language plpgsql security definer set search_path = public as $$
declare v_e public.exams; v_mhs uuid;
begin
  perform priv.require_user();
  select * into v_e from public.exams where id = p_exam;
  if not found then raise exception 'Ujian tidak ditemukan'; end if;
  if not exists (select 1 from public.exam_panel where exam_id = p_exam and dosen_id = auth.uid()) then
    raise exception 'Anda bukan anggota panel ujian ini';
  end if;
  if v_e.status not in ('dijadwalkan', 'selesai') then raise exception 'Ujian belum dijadwalkan'; end if;
  if v_e.revisi_selesai_at is not null then raise exception 'Revisi ujian ini sudah selesai'; end if;
  if p_perlu and length(trim(coalesce(p_arahan, ''))) = 0 then raise exception 'Tulis arahan perubahan judul'; end if;
  update public.exam_panel set ubah_judul = coalesce(p_perlu, false), arahan_judul = case when p_perlu then trim(p_arahan) end
   where exam_id = p_exam and dosen_id = auth.uid();
  if p_perlu then
    select mahasiswa_id into v_mhs from public.thesis where id = v_e.thesis_id;
    perform priv.notify(v_mhs, 'arahan_judul', 'Penguji meminta perubahan judul', trim(p_arahan), '/judul');
  end if;
end;
$$;

create table if not exists public.title_change_requests (
  id uuid primary key default gen_random_uuid(),
  thesis_id uuid not null references public.thesis (id) on delete cascade,
  judul_lama text not null,
  judul_baru text not null check (length(trim(judul_baru)) >= 10),
  alasan text not null check (length(trim(alasan)) > 0),
  status text not null default 'diajukan' check (status in ('diajukan', 'disetujui', 'ditolak', 'dibatalkan')),
  created_by uuid references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now(),
  diputuskan_at timestamptz
);
create unique index if not exists title_change_satu_terbuka on public.title_change_requests (thesis_id) where status = 'diajukan';
create index if not exists title_change_thesis_idx on public.title_change_requests (thesis_id, created_at desc);

create table if not exists public.title_change_approvals (
  request_id uuid not null references public.title_change_requests (id) on delete cascade,
  dosen_id uuid not null references public.profiles (id),
  peran public.supervisor_role not null,
  setuju boolean not null,
  catatan text,
  created_at timestamptz not null default now(),
  primary key (request_id, dosen_id)
);

alter table public.title_change_requests enable row level security;
alter table public.title_change_approvals enable row level security;
drop policy if exists title_change_requests_select on public.title_change_requests;
create policy title_change_requests_select on public.title_change_requests for select to authenticated
  using ((select priv.sees_all_thesis()) or priv.can_view_thesis(thesis_id));
drop policy if exists title_change_approvals_select on public.title_change_approvals;
create policy title_change_approvals_select on public.title_change_approvals for select to authenticated
  using (exists (select 1 from public.title_change_requests r where r.id = request_id and ((select priv.sees_all_thesis()) or priv.can_view_thesis(r.thesis_id))));
revoke all on public.title_change_requests, public.title_change_approvals from anon;
grant select on public.title_change_requests, public.title_change_approvals to authenticated;

-- Seminar pertama (proposal / ujian D3) sudah selesai: judul tidak boleh diubah langsung oleh mahasiswa.
create or replace function priv.sudah_seminar(p_thesis uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.thesis_milestones where thesis_id = p_thesis and jenis = 'ujian' and status = 'selesai');
$$;

create or replace function public.ubah_judul(p_thesis uuid, p_judul text, p_alasan text)
returns void language plpgsql security definer set search_path = public as $$
declare v_th public.thesis;
begin
  perform priv.require_user();
  select * into v_th from public.thesis where id = p_thesis;
  if not found then raise exception 'Tugas akhir tidak ditemukan'; end if;
  if not (v_th.mahasiswa_id = auth.uid() or priv.is_supervisor_of(p_thesis) or priv.can_manage_thesis(p_thesis)) then
    raise exception 'Anda tidak berwenang mengubah judul';
  end if;
  if v_th.mahasiswa_id = auth.uid() and priv.sudah_seminar(p_thesis) then
    raise exception 'Setelah seminar, perubahan judul diajukan sebagai usulan dan berlaku setelah disetujui Pembimbing 1 dan 2';
  end if;
  if length(trim(coalesce(p_judul, ''))) < 10 then raise exception 'Judul minimal 10 karakter'; end if;
  if length(trim(coalesce(p_alasan, ''))) = 0 then raise exception 'Alasan perubahan judul wajib diisi'; end if;
  if trim(p_judul) = v_th.judul then raise exception 'Judul tidak berubah'; end if;
  insert into public.thesis_title_history (thesis_id, judul_lama, judul_baru, alasan, aktor)
  values (p_thesis, v_th.judul, trim(p_judul), trim(p_alasan), auth.uid());
  update public.thesis set judul = trim(p_judul) where id = p_thesis;
  if v_th.mahasiswa_id <> auth.uid() then
    perform priv.notify(v_th.mahasiswa_id, 'judul_diubah', 'Judul tugas akhir diperbarui', trim(p_judul), '/studi-akhir');
  end if;
  perform priv.notify(s.dosen_id, 'judul_diubah', 'Judul tugas akhir diperbarui', trim(p_judul), '/mahasiswa-bimbingan/' || p_thesis)
  from public.thesis_supervisors s where s.thesis_id = p_thesis and s.aktif and s.dosen_id <> auth.uid();
end;
$$;

create or replace function public.usul_judul(p_thesis uuid, p_judul text, p_alasan text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_th public.thesis; v_id uuid;
begin
  perform priv.require_user();
  select * into v_th from public.thesis where id = p_thesis;
  if not found then raise exception 'Tugas akhir tidak ditemukan'; end if;
  if v_th.mahasiswa_id <> auth.uid() then raise exception 'Hanya mahasiswa pemilik yang dapat mengusulkan judul'; end if;
  if v_th.status <> 'aktif' then raise exception 'Studi akhir tidak aktif'; end if;
  if length(trim(coalesce(p_judul, ''))) < 10 then raise exception 'Judul minimal 10 karakter'; end if;
  if length(trim(coalesce(p_alasan, ''))) = 0 then raise exception 'Alasan perubahan judul wajib diisi'; end if;
  if trim(p_judul) = v_th.judul then raise exception 'Judul tidak berubah'; end if;
  if exists (select 1 from public.title_change_requests where thesis_id = p_thesis and status = 'diajukan') then
    raise exception 'Masih ada usulan judul yang menunggu persetujuan';
  end if;
  insert into public.title_change_requests (thesis_id, judul_lama, judul_baru, alasan)
  values (p_thesis, v_th.judul, trim(p_judul), trim(p_alasan)) returning id into v_id;
  perform priv.notify(s.dosen_id, 'usul_judul', 'Usulan perubahan judul', trim(p_judul), '/mahasiswa-bimbingan/' || p_thesis || '?tab=riwayat')
  from public.thesis_supervisors s where s.thesis_id = p_thesis and s.aktif;
  return v_id;
end;
$$;

create or replace function public.batalkan_usul_judul(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_r public.title_change_requests;
begin
  perform priv.require_user();
  select * into v_r from public.title_change_requests where id = p_id for update;
  if not found or not priv.is_thesis_owner(v_r.thesis_id) then raise exception 'Usulan tidak ditemukan'; end if;
  if v_r.status <> 'diajukan' then raise exception 'Usulan sudah diputuskan'; end if;
  update public.title_change_requests set status = 'dibatalkan', diputuskan_at = now() where id = p_id;
end;
$$;

create or replace function public.tanggapi_usul_judul(p_id uuid, p_setuju boolean, p_catatan text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_r public.title_change_requests;
  v_peran public.supervisor_role;
  v_th public.thesis;
  v_need int;
  v_ok int;
begin
  perform priv.require_user();
  select * into v_r from public.title_change_requests where id = p_id for update;
  if not found then raise exception 'Usulan tidak ditemukan'; end if;
  if v_r.status <> 'diajukan' then raise exception 'Usulan sudah diputuskan'; end if;
  select peran into v_peran from public.thesis_supervisors where thesis_id = v_r.thesis_id and dosen_id = auth.uid() and aktif;
  if v_peran is null then raise exception 'Hanya Pembimbing 1 atau 2 yang dapat menanggapi usulan judul'; end if;
  if not p_setuju and length(trim(coalesce(p_catatan, ''))) = 0 then raise exception 'Tulis alasan penolakan'; end if;
  insert into public.title_change_approvals (request_id, dosen_id, peran, setuju, catatan)
  values (p_id, auth.uid(), v_peran, p_setuju, nullif(trim(coalesce(p_catatan, '')), ''))
  on conflict (request_id, dosen_id) do update set setuju = excluded.setuju, catatan = excluded.catatan, created_at = now();
  select * into v_th from public.thesis where id = v_r.thesis_id;

  if not p_setuju then
    update public.title_change_requests set status = 'ditolak', diputuskan_at = now() where id = p_id;
    perform priv.notify(v_th.mahasiswa_id, 'usul_judul', 'Usulan judul ditolak ' || v_peran, trim(p_catatan), '/judul');
    return 'ditolak';
  end if;

  select count(*) into v_need from public.thesis_supervisors where thesis_id = v_r.thesis_id and aktif;
  select count(*) into v_ok from public.title_change_approvals a
    join public.thesis_supervisors s on s.dosen_id = a.dosen_id and s.thesis_id = v_r.thesis_id and s.aktif
   where a.request_id = p_id and a.setuju;
  if v_ok < v_need then
    perform priv.notify(v_th.mahasiswa_id, 'usul_judul', 'Usulan judul disetujui ' || v_peran, 'Menunggu pembimbing lainnya.', '/judul');
    return 'sebagian';
  end if;

  insert into public.thesis_title_history (thesis_id, judul_lama, judul_baru, alasan, aktor)
  values (v_r.thesis_id, v_th.judul, v_r.judul_baru, v_r.alasan || ' (disetujui Pembimbing 1 dan 2)', v_th.mahasiswa_id);
  update public.thesis set judul = v_r.judul_baru where id = v_r.thesis_id;
  update public.title_change_requests set status = 'disetujui', diputuskan_at = now() where id = p_id;
  perform priv.notify(v_th.mahasiswa_id, 'usul_judul', 'Judul baru berlaku', v_r.judul_baru, '/judul');
  return 'disetujui';
end;
$$;

-- ACC revisi terakhir menunggu usulan judul bila penguji meminta perubahan judul.
create or replace function public.acc_revisi(p_exam uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_e public.exams;
  v_th public.thesis;
  v_m uuid;
  v_kode text;
begin
  perform priv.require_user();
  select * into v_e from public.exams where id = p_exam for update;
  if not found then raise exception 'Ujian tidak ditemukan'; end if;
  if not exists (select 1 from public.exam_panel where exam_id = p_exam and dosen_id = auth.uid()) then
    raise exception 'Anda bukan anggota panel ujian ini';
  end if;
  if v_e.status <> 'selesai' or v_e.hasil not in ('lulus_minor','lulus_mayor') then
    raise exception 'Ujian ini tidak memiliki tahap revisi';
  end if;
  if v_e.revisi_selesai_at is not null then raise exception 'Revisi sudah dinyatakan selesai'; end if;

  update public.exam_panel set acc_revisi_at = coalesce(acc_revisi_at, now()), kode_acc = coalesce(kode_acc, priv.new_code())
    where exam_id = p_exam and dosen_id = auth.uid();
  select * into v_th from public.thesis where id = v_e.thesis_id;

  if not exists (select 1 from public.exam_panel where exam_id = p_exam and acc_revisi_at is null) then
    if exists (select 1 from public.title_change_requests where thesis_id = v_e.thesis_id and status = 'diajukan') then
      raise exception 'Usulan perubahan judul masih menunggu persetujuan Pembimbing 1 dan 2';
    end if;
    if exists (select 1 from public.exam_panel where exam_id = p_exam and ubah_judul)
       and not exists (select 1 from public.title_change_requests
                        where thesis_id = v_e.thesis_id and status = 'disetujui' and created_at >= coalesce(v_e.tanggal, v_e.created_at)) then
      raise exception 'Panel meminta perubahan judul; judul baru belum diusulkan atau belum disetujui pembimbing';
    end if;
    v_kode := priv.new_code();
    update public.exams set revisi_selesai_at = now(), kode_ba_revisi = v_kode where id = p_exam;
    select id into v_m from public.thesis_milestones
      where thesis_id = v_e.thesis_id and jenis = 'revisi' and ujian_jenis = v_e.jenis and status <> 'selesai';
    if v_m is not null then
      perform priv.complete_milestone(v_m, 'Revisi ' || priv.exam_label(v_e.jenis) || ' di-ACC seluruh dosen', 'BA revisi ' || v_kode);
    end if;
    perform priv.notify(v_th.mahasiswa_id, 'revisi_selesai',
      case v_e.jenis when 'sempro' then 'Proposal dinyatakan selesai' else 'Skripsi dinyatakan selesai' end,
      'Revisi ' || priv.exam_label(v_e.jenis) || ' sudah di-ACC seluruh dosen. Kode BA: ' || v_kode, '/ujian/' || p_exam);
    return 'selesai';
  end if;
  perform priv.notify(v_th.mahasiswa_id, 'revisi_acc', 'ACC revisi ' || priv.exam_label(v_e.jenis),
    (select nama from public.profiles where id = auth.uid()) || ' memberi ACC revisi.', '/ujian/' || p_exam);
  return 'sebagian';
end;
$$;

-- ---------------------------------------------------------------------
-- 4. Sesi bimbingan menautkan pengajuan bab
-- ---------------------------------------------------------------------
alter table public.guidance_sessions add column if not exists submission_id uuid references public.chapter_submissions (id) on delete set null;

create or replace function public.tautkan_pengajuan_sesi(p_session uuid, p_submission uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_s public.guidance_sessions; v_sub public.chapter_submissions;
begin
  perform priv.require_user();
  select * into v_s from public.guidance_sessions where id = p_session for update;
  if not found or v_s.mahasiswa_id <> auth.uid() then raise exception 'Sesi bimbingan tidak ditemukan'; end if;
  if v_s.status not in ('diajukan', 'dijadwalkan') then raise exception 'Sesi sudah selesai atau dibatalkan'; end if;
  if p_submission is not null then
    select * into v_sub from public.chapter_submissions where id = p_submission;
    if not found or v_sub.thesis_id <> v_s.thesis_id then raise exception 'Pengajuan bab tidak ditemukan'; end if;
  end if;
  update public.guidance_sessions set submission_id = p_submission where id = p_session;
end;
$$;

-- ---------------------------------------------------------------------
-- 5. Fitur AISYS baru
-- ---------------------------------------------------------------------
alter table public.ai_usage_logs drop constraint if exists ai_usage_logs_fitur_check;
alter table public.ai_usage_logs add constraint ai_usage_logs_fitur_check check (fitur in (
  'parafrase', 'susun', 'cari_jurnal', 'periksa_bab', 'review_bab',
  'tanggapi_catatan', 'keselarasan', 'kerangka', 'tabel_terdahulu', 'cocok_rujukan', 'ejaan', 'abstrak', 'persiapan_seminar'));

-- ---------------------------------------------------------------------
-- Hak eksekusi
-- ---------------------------------------------------------------------
revoke all on function public.status_kunci_bab(uuid), public.arahan_judul_ujian(uuid, boolean, text),
  public.usul_judul(uuid, text, text), public.batalkan_usul_judul(uuid), public.tanggapi_usul_judul(uuid, boolean, text),
  public.tautkan_pengajuan_sesi(uuid, uuid) from public, anon;
grant execute on function public.status_kunci_bab(uuid), public.arahan_judul_ujian(uuid, boolean, text),
  public.usul_judul(uuid, text, text), public.batalkan_usul_judul(uuid), public.tanggapi_usul_judul(uuid, boolean, text),
  public.tautkan_pengajuan_sesi(uuid, uuid) to authenticated;
revoke all on function priv.revisi_aktif(uuid), priv.bab_terkunci(uuid, int), priv.sudah_seminar(uuid) from public, anon;
grant execute on function priv.revisi_aktif(uuid), priv.bab_terkunci(uuid, int), priv.sudah_seminar(uuid) to authenticated;

-- ===================== supabase/migrations/20261029001400_daftar_akun.sql =====================
-- =====================================================================
-- SIMSA — Migrasi 14: pendaftaran akun mahasiswa dengan verifikasi Admin
--   * Calon mahasiswa mendaftar sendiri (lewat server SIMSA). Akun dapat masuk
--     tetapi belum memiliki peran, sehingga tidak dapat membuka data apa pun.
--   * Data pendaftaran (NIM, prodi, angkatan, HP) disimpan di account_requests
--     dan baru dipindahkan ke profil saat Admin menyetujui.
--   * Admin menyetujui atau menolak (alasan wajib); pendaftar yang ditolak
--     dapat memperbaiki data lalu mengajukan ulang.
-- =====================================================================

create table if not exists public.account_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles (id) on delete cascade,
  nama text not null check (length(trim(nama)) >= 3),
  nim text not null check (nim ~ '^[0-9]{6,20}$'),
  prodi_id uuid not null references public.prodi (id),
  angkatan int,
  email text not null,
  telepon text not null,
  status text not null default 'menunggu' check (status in ('menunggu', 'disetujui', 'ditolak')),
  alasan text,
  ip_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  diputuskan_at timestamptz,
  diputuskan_oleh uuid references public.profiles (id)
);
create index if not exists account_requests_status_idx on public.account_requests (status, created_at desc);
create index if not exists account_requests_nim_idx on public.account_requests (nim);
create index if not exists account_requests_ip_idx on public.account_requests (ip_hash, created_at);

alter table public.account_requests enable row level security;
drop policy if exists account_requests_select on public.account_requests;
create policy account_requests_select on public.account_requests for select to authenticated
  using (user_id = (select auth.uid()) or (select priv.is_admin()));
revoke all on public.account_requests from anon;
grant select on public.account_requests to authenticated;

drop trigger if exists account_requests_touch on public.account_requests;
create trigger account_requests_touch before update on public.account_requests
  for each row execute function priv.touch_updated_at();

-- Angkatan diambil dari 4 digit pertama NIM bila masuk akal.
create or replace function priv.angkatan_dari_nim(p_nim text)
returns int language sql immutable as $$
  select case
    when p_nim ~ '^[0-9]{4}' and substr(p_nim, 1, 4)::int between 1990 and extract(year from now())::int + 1
      then substr(p_nim, 1, 4)::int
  end;
$$;

-- ---------------------------------------------------------------------
-- Antrean verifikasi untuk Admin, lengkap dengan peringatan otomatis
-- ---------------------------------------------------------------------
create or replace function public.antrean_verifikasi(p_status text default 'menunggu')
returns table (
  id uuid, user_id uuid, nama text, nim text, prodi_id uuid, prodi_kode text, prodi_nama text, angkatan int,
  email text, telepon text, status text, alasan text, created_at timestamptz, diputuskan_at timestamptz,
  nim_terdaftar text, nim_ganda int, email_mirip text, nama_mirip text
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not priv.is_admin() then raise exception 'Hanya Admin yang dapat melihat antrean verifikasi'; end if;
  return query
  select r.id, r.user_id, r.nama, r.nim, r.prodi_id, pr.kode, pr.nama, r.angkatan, r.email, r.telepon, r.status, r.alasan,
         r.created_at, r.diputuskan_at,
         (select p.nama || coalesce(' (' || p.email || ')', '') from public.profiles p where p.nim = r.nim and p.id <> r.user_id limit 1),
         (select count(*)::int from public.account_requests o where o.nim = r.nim and o.id <> r.id and o.status <> 'ditolak'),
         (select string_agg(p.email, ', ') from (
            select p.email from public.profiles p
             where p.id <> r.user_id and p.email is not null
               and lower(split_part(p.email, '@', 1)) = lower(split_part(r.email, '@', 1))
             limit 3) p),
         (select string_agg(p.nama || coalesce(' ' || p.nim, ''), ', ') from (
            select p.nama, p.nim from public.profiles p
             where p.id <> r.user_id and length(p.nama) > 2 and similarity(lower(p.nama), lower(r.nama)) >= 0.6
             order by similarity(lower(p.nama), lower(r.nama)) desc limit 3) p)
  from public.account_requests r
  join public.prodi pr on pr.id = r.prodi_id
  where p_status = 'semua' or r.status = p_status
  order by case when r.status = 'menunggu' then r.created_at end asc, r.updated_at desc;
end;
$$;

-- ---------------------------------------------------------------------
-- Setujui / tolak (dapat beberapa sekaligus)
-- ---------------------------------------------------------------------
create or replace function public.verifikasi_akun(p_ids uuid[], p_setuju boolean, p_alasan text default null)
returns int language plpgsql security definer set search_path = public as $$
declare
  r public.account_requests;
  v_lain text;
  v_n int := 0;
begin
  perform priv.require_user();
  if not priv.is_admin() then raise exception 'Hanya Admin yang dapat memverifikasi akun'; end if;
  if coalesce(array_length(p_ids, 1), 0) = 0 then raise exception 'Pilih minimal satu pendaftar'; end if;
  if not p_setuju and length(trim(coalesce(p_alasan, ''))) = 0 then raise exception 'Alasan penolakan wajib diisi'; end if;

  for r in select * from public.account_requests where id = any (p_ids) and status = 'menunggu' order by created_at for update loop
    if p_setuju then
      select p.nama into v_lain from public.profiles p where p.nim = r.nim and p.id <> r.user_id;
      if found then
        raise exception 'NIM % sudah dipakai akun %. Tolak pendaftaran ini atau ubah akun lama terlebih dahulu.', r.nim, v_lain;
      end if;
      update public.profiles
         set nama = r.nama, nim = r.nim, prodi_id = r.prodi_id, angkatan = r.angkatan, telepon = r.telepon, aktif = true
       where id = r.user_id;
      insert into public.user_roles (user_id, role, prodi_id) values (r.user_id, 'mahasiswa', null)
        on conflict do nothing;
      update public.account_requests set status = 'disetujui', alasan = null, diputuskan_at = now(), diputuskan_oleh = auth.uid() where id = r.id;
      perform priv.notify(r.user_id, 'akun_disetujui', 'Akun Anda sudah diverifikasi',
        'Selamat datang di SIMSA. Anda sekarang dapat mendaftarkan tugas akhir.', '/judul');
    else
      update public.account_requests set status = 'ditolak', alasan = trim(p_alasan), diputuskan_at = now(), diputuskan_oleh = auth.uid() where id = r.id;
      perform priv.notify(r.user_id, 'akun_ditolak', 'Pendaftaran akun ditolak', trim(p_alasan), '/');
    end if;
    v_n := v_n + 1;
  end loop;
  if v_n = 0 then raise exception 'Pendaftar yang dipilih sudah diputuskan'; end if;
  return v_n;
end;
$$;

-- ---------------------------------------------------------------------
-- Pendaftar: lihat status sendiri dan ajukan ulang setelah ditolak
-- ---------------------------------------------------------------------
create or replace function public.status_pendaftaran_saya()
returns table (nama text, nim text, prodi_id uuid, prodi_nama text, angkatan int, email text, telepon text, status text, alasan text, created_at timestamptz, diputuskan_at timestamptz)
language sql stable security definer set search_path = public as $$
  select r.nama, r.nim, r.prodi_id, pr.nama, r.angkatan, r.email, r.telepon, r.status, r.alasan, r.created_at, r.diputuskan_at
  from public.account_requests r join public.prodi pr on pr.id = r.prodi_id
  where r.user_id = auth.uid();
$$;

create or replace function public.ajukan_ulang_pendaftaran(p_nama text, p_nim text, p_prodi uuid, p_telepon text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.account_requests;
begin
  perform priv.require_user();
  select * into r from public.account_requests where user_id = auth.uid() for update;
  if not found then raise exception 'Pendaftaran tidak ditemukan'; end if;
  if r.status <> 'ditolak' then raise exception 'Pendaftaran Anda tidak dalam status ditolak'; end if;
  if length(trim(coalesce(p_nama, ''))) < 3 then raise exception 'Nama minimal 3 huruf'; end if;
  if coalesce(p_nim, '') !~ '^[0-9]{6,20}$' then raise exception 'NIM hanya berisi angka (6 sampai 20 digit)'; end if;
  if coalesce(p_telepon, '') !~ '^\+?[0-9]{8,15}$' then raise exception 'Nomor HP tidak valid'; end if;
  if not exists (select 1 from public.prodi where id = p_prodi) then raise exception 'Program studi tidak valid'; end if;
  update public.account_requests
     set nama = trim(p_nama), nim = p_nim, prodi_id = p_prodi, angkatan = priv.angkatan_dari_nim(p_nim), telepon = p_telepon,
         status = 'menunggu', alasan = null, diputuskan_at = null, diputuskan_oleh = null
   where id = r.id;
  update public.profiles set nama = trim(p_nama) where id = auth.uid();
end;
$$;

revoke all on function public.antrean_verifikasi(text), public.verifikasi_akun(uuid[], boolean, text),
  public.status_pendaftaran_saya(), public.ajukan_ulang_pendaftaran(text, text, uuid, text) from public, anon;
grant execute on function public.antrean_verifikasi(text), public.verifikasi_akun(uuid[], boolean, text),
  public.status_pendaftaran_saya(), public.ajukan_ulang_pendaftaran(text, text, uuid, text) to authenticated;

-- ===================== supabase/migrations/20261029001500_pandu_latar.sql =====================
-- =====================================================================
-- SIMSA — Migrasi 15: AISYS Pandu latar belakang
--   Sesi bimbingan bertahap (topik, jenis skripsi, WHY, OMKKMASASOLTU,
--   literatur, draf) disimpan agar mahasiswa dapat melanjutkan kapan saja.
--   Satu sesi dihitung satu pemakaian AISYS (fitur 'pandu_latar');
--   giliran di dalam sesi dicatat sebagai 'pandu_giliran' dan tidak
--   mengurangi kuota harian.
-- =====================================================================

create table if not exists public.ai_pandu_sessions (
  id uuid primary key default gen_random_uuid(),
  thesis_id uuid not null references public.thesis (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'aktif' check (status in ('aktif', 'selesai', 'dibatalkan')),
  tahap text not null default 'topik',
  state jsonb not null default '{}'::jsonb,
  riwayat jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ai_pandu_sessions_thesis_idx on public.ai_pandu_sessions (thesis_id, created_at desc);

alter table public.ai_pandu_sessions enable row level security;
drop policy if exists ai_pandu_sessions_select on public.ai_pandu_sessions;
create policy ai_pandu_sessions_select on public.ai_pandu_sessions for select to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.ai_pandu_sessions from anon;
grant select on public.ai_pandu_sessions to authenticated;

drop trigger if exists ai_pandu_sessions_touch on public.ai_pandu_sessions;
create trigger ai_pandu_sessions_touch before update on public.ai_pandu_sessions
  for each row execute function priv.touch_updated_at();

alter table public.ai_usage_logs drop constraint if exists ai_usage_logs_fitur_check;
alter table public.ai_usage_logs add constraint ai_usage_logs_fitur_check check (fitur in (
  'parafrase', 'susun', 'cari_jurnal', 'periksa_bab', 'review_bab',
  'tanggapi_catatan', 'keselarasan', 'kerangka', 'tabel_terdahulu', 'cocok_rujukan', 'ejaan', 'abstrak', 'persiapan_seminar',
  'pandu_latar', 'pandu_giliran'));

-- ===================== supabase/migrations/20261029001600_akreditasi.sql =====================
-- =====================================================================
-- SIMSA — Migrasi 16: dashboard akreditasi
--   * Tahun akademik TS ditetapkan Admin; TS-1, TS-2, dst. mengikuti.
--   * Batas tepat waktu dalam semester (bawaan S1 8, D3 6).
--   * Jumlah mahasiswa diterima per prodi per angkatan (diisi Admin atau
--     Ka. Prodi) untuk persentase keberhasilan studi.
--   * Lembaga akreditasi per prodi (LAM INFOKOM, LAM DEPILAR, ...).
--   * RPC dashboard_akreditasi: Admin dan Pimpinan semua prodi,
--     Ka. Prodi hanya prodinya.
--
-- Definisi yang dipakai:
--   Tanggal lulus   = tanggal milestone Yudisium selesai (bila tidak ada,
--                     milestone terakhir yang selesai pada studi akhir lulus).
--   Semester lulus  = semester ke-n sejak semester Ganjil tahun angkatan,
--                     dihitung dari kalender Tahun Akademik (bila tanggalnya
--                     tidak tercakup: Ganjil Sep–Feb, Genap Mar–Ags).
--   Masa studi      = semester lulus / 2 (tahun).
--   Tepat waktu     = semester lulus <= batas semester jenjang.
-- Aman dijalankan ulang.
-- =====================================================================

alter table public.prodi add column if not exists lembaga_akreditasi text;
update public.prodi
set lembaga_akreditasi = case when nama ilike '%desain%' or kode ilike 'DKV%' then 'LAM DEPILAR' else 'LAM INFOKOM' end
where lembaga_akreditasi is null;

create table if not exists public.akreditasi_pengaturan (
  id int primary key default 1 check (id = 1),
  ts_tahun int not null check (ts_tahun between 2000 and 2100),
  batas_semester_s1 int not null default 8 check (batas_semester_s1 between 6 and 14),
  batas_semester_d3 int not null default 6 check (batas_semester_d3 between 4 and 10),
  diubah_oleh uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.akreditasi_pengaturan (id, ts_tahun)
values (1, extract(year from current_date)::int - case when extract(month from current_date) < 9 then 1 else 0 end)
on conflict (id) do nothing;

create table if not exists public.akreditasi_mahasiswa_baru (
  prodi_id uuid not null references public.prodi (id) on delete cascade,
  angkatan int not null check (angkatan between 1990 and 2100),
  jumlah int not null check (jumlah >= 0),
  diubah_oleh uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (prodi_id, angkatan)
);

alter table public.akreditasi_pengaturan enable row level security;
alter table public.akreditasi_mahasiswa_baru enable row level security;
drop policy if exists akreditasi_pengaturan_select on public.akreditasi_pengaturan;
create policy akreditasi_pengaturan_select on public.akreditasi_pengaturan for select to authenticated using ((select priv.is_staff()));
drop policy if exists akreditasi_mahasiswa_baru_select on public.akreditasi_mahasiswa_baru;
create policy akreditasi_mahasiswa_baru_select on public.akreditasi_mahasiswa_baru for select to authenticated using ((select priv.is_staff()));
revoke all on public.akreditasi_pengaturan, public.akreditasi_mahasiswa_baru from anon;
grant select on public.akreditasi_pengaturan, public.akreditasi_mahasiswa_baru to authenticated;

-- ---------------------------------------------------------------------
-- Kalender akademik
-- ---------------------------------------------------------------------

/** Tahun akademik (tahun awal) dan semester dari sebuah tanggal. */
create or replace function priv.semester_ta(p_tgl date, out tahun int, out genap boolean)
language plpgsql stable security definer set search_path = public as $$
declare v_nama text;
begin
  select nama into v_nama from public.academic_years
  where p_tgl between mulai and selesai and nama ~ '^\d{4}'
  order by mulai desc limit 1;
  if v_nama is not null then
    tahun := substring(v_nama from '^(\d{4})')::int;
    genap := v_nama ilike '%genap%';
    return;
  end if;
  if extract(month from p_tgl) >= 9 then
    tahun := extract(year from p_tgl)::int; genap := false;
  elsif extract(month from p_tgl) <= 2 then
    tahun := extract(year from p_tgl)::int - 1; genap := false;
  else
    tahun := extract(year from p_tgl)::int - 1; genap := true;
  end if;
end;
$$;

/** Rentang tanggal satu semester (p_genap) atau satu tahun akademik (p_genap null). */
create or replace function priv.rentang_ta(p_tahun int, p_genap boolean, out mulai date, out selesai date)
language plpgsql stable security definer set search_path = public as $$
begin
  select min(a.mulai), max(a.selesai) into mulai, selesai
  from public.academic_years a
  where a.nama like p_tahun || '/%'
    and (p_genap is null or (a.nama ilike '%genap%') = p_genap);
  if mulai is null then
    mulai := case when p_genap is true then make_date(p_tahun + 1, 3, 1) else make_date(p_tahun, 9, 1) end;
    selesai := case when p_genap is false then (make_date(p_tahun + 1, 3, 1) - 1) else make_date(p_tahun + 1, 8, 31) end;
  end if;
end;
$$;

create or replace function priv.semester_ke(p_angkatan int, p_tgl date)
returns int language sql stable security definer set search_path = public as $$
  select case when p_angkatan is null or p_tgl is null then null
    else (s.tahun - p_angkatan) * 2 + case when s.genap then 2 else 1 end end
  from priv.semester_ta(p_tgl) s;
$$;

-- ---------------------------------------------------------------------
-- Data per studi akhir untuk akreditasi
-- ---------------------------------------------------------------------
create or replace function priv.akr_tesis(p_prodi uuid[])
returns table (
  thesis_id uuid, prodi_id uuid, jenjang public.jenjang, mahasiswa_id uuid, nama text, nim text, angkatan int,
  status text, bidang text, mulai date,
  tgl_pembimbing date, tgl_sempro date, tgl_semhas date, tgl_ujian_akhir date, tgl_lulus date,
  lulus_tahun int, semester_lulus int, batas int, tahap text
)
language sql stable security definer set search_path = public as $$
  with cfg as (select batas_semester_s1, batas_semester_d3 from public.akreditasi_pengaturan where id = 1),
  m as (
    select tm.thesis_id,
      max(tm.selesai_at) filter (where tm.jenis = 'pembimbing' and tm.status = 'selesai')::date as tgl_pembimbing,
      max(tm.selesai_at) filter (where tm.ujian_jenis = 'sempro' and tm.jenis = 'ujian' and tm.status = 'selesai')::date as tgl_sempro,
      max(tm.selesai_at) filter (where tm.ujian_jenis = 'semhas' and tm.jenis = 'ujian' and tm.status = 'selesai')::date as tgl_semhas,
      max(tm.selesai_at) filter (where tm.ujian_jenis in ('pendadaran', 'd3') and tm.jenis = 'ujian' and tm.status = 'selesai')::date as tgl_ujian_akhir,
      max(tm.selesai_at) filter (where tm.jenis = 'yudisium' and tm.status = 'selesai')::date as tgl_yudisium,
      max(tm.selesai_at) filter (where tm.status = 'selesai')::date as tgl_terakhir,
      (array_agg(tm.nama order by tm.urutan) filter (where tm.status <> 'selesai'))[1] as tahap
    from public.thesis_milestones tm
    group by tm.thesis_id
  ),
  b as (
    select t.id as thesis_id, t.prodi_id, t.jenjang, t.mahasiswa_id, p.nama, p.nim,
      coalesce(p.angkatan, priv.angkatan_dari_nim(p.nim)) as angkatan,
      t.status, nullif(trim(t.bidang_kajian), '') as bidang, t.mulai,
      m.tgl_pembimbing, m.tgl_sempro, m.tgl_semhas, m.tgl_ujian_akhir,
      case when m.tgl_yudisium is not null then m.tgl_yudisium when t.status = 'lulus' then m.tgl_terakhir end as tgl_lulus,
      case when t.jenjang = 'D3' then (select batas_semester_d3 from cfg) else (select batas_semester_s1 from cfg) end as batas,
      m.tahap
    from public.thesis t
    join public.profiles p on p.id = t.mahasiswa_id
    left join m on m.thesis_id = t.id
    where p_prodi is null or t.prodi_id = any (p_prodi)
  )
  select b.thesis_id, b.prodi_id, b.jenjang, b.mahasiswa_id, b.nama, b.nim, b.angkatan, b.status, b.bidang, b.mulai,
    b.tgl_pembimbing, b.tgl_sempro, b.tgl_semhas, b.tgl_ujian_akhir, b.tgl_lulus,
    (select s.tahun from priv.semester_ta(b.tgl_lulus) s where b.tgl_lulus is not null),
    priv.semester_ke(b.angkatan, b.tgl_lulus),
    b.batas, b.tahap
  from b;
$$;

-- ---------------------------------------------------------------------
-- Dashboard
-- ---------------------------------------------------------------------
create or replace function public.dashboard_akreditasi(p_ts int default null, p_prodi uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := priv.require_user();
  v_semua boolean := priv.is_admin() or priv.has_role('pimpinan');
  v_scope uuid[];
  v_cfg public.akreditasi_pengaturan;
  v_ts int;
  r_ts record; r_g record; r_e record; r_3 record;
  v_out jsonb;
begin
  if p_prodi is not null then
    if not (v_semua or priv.is_kaprodi_of(p_prodi)) then raise exception 'Anda tidak berhak melihat data prodi ini'; end if;
    v_scope := array[p_prodi];
  elsif v_semua then
    select array_agg(id) into v_scope from public.prodi;
  else
    select array_agg(distinct ur.prodi_id) into v_scope
    from public.user_roles ur where ur.user_id = v_uid and ur.role = 'kaprodi' and ur.prodi_id is not null;
    if v_scope is null then raise exception 'Dashboard akreditasi hanya untuk Admin, Pimpinan, dan Ka. Prodi'; end if;
  end if;

  select * into v_cfg from public.akreditasi_pengaturan where id = 1;
  v_ts := coalesce(p_ts, v_cfg.ts_tahun);
  select * into r_ts from priv.rentang_ta(v_ts, null);
  select * into r_g from priv.rentang_ta(v_ts, false);
  select * into r_e from priv.rentang_ta(v_ts, true);
  select * into r_3 from priv.rentang_ta(v_ts - 2, null);

  with
  _akr as materialized (select * from priv.akr_tesis(v_scope)),
  pr as (select p.* from public.prodi p where p.id = any (v_scope)),
  lul as (select * from _akr where tgl_lulus is not null and lulus_tahun between v_ts - 2 and v_ts),
  -- Pembimbing yang aktif pada tiap semester TS
  sem as (select 'ganjil'::text as s, r_g.mulai as mulai, r_g.selesai as selesai union all select 'genap', r_e.mulai, r_e.selesai),
  sup as (
    select sem.s, s.dosen_id, s.peran, a.thesis_id, a.prodi_id
    from sem
    join public.thesis_supervisors s on s.ditetapkan_at::date <= sem.selesai and coalesce(s.diganti_at::date, 'infinity'::date) >= sem.mulai
    join _akr a on a.thesis_id = s.thesis_id
    where (a.tgl_lulus is null or a.tgl_lulus >= sem.mulai) and a.mulai <= sem.selesai and a.status <> 'berhenti'
  ),
  aktif_sem as (select s, prodi_id, count(distinct thesis_id) as n from sup group by s, prodi_id),
  sesi as (
    select g.dosen_id, a.prodi_id, case when coalesce(g.tanggal_jadwal, g.tanggal_usulan)::date <= r_g.selesai then 'ganjil' else 'genap' end as s
    from public.guidance_sessions g join _akr a on a.thesis_id = g.thesis_id
    where g.status = 'selesai' and coalesce(g.tanggal_jadwal, g.tanggal_usulan)::date between r_ts.mulai and r_ts.selesai
  ),
  rev as (
    select r.dosen_id, a.prodi_id, extract(epoch from (r.created_at - cs.created_at)) / 86400.0 as hari
    from public.chapter_reviews r
    join public.chapter_submissions cs on cs.id = r.submission_id
    join _akr a on a.thesis_id = r.thesis_id
    where r.created_at::date between r_ts.mulai and r_ts.selesai
  ),
  uji as (
    select e.*, a.prodi_id from public.exams e join _akr a on a.thesis_id = e.thesis_id
    where e.status = 'selesai' and e.hasil is not null and coalesce(e.diputuskan_at, e.tanggal)::date between r_ts.mulai and r_ts.selesai
  ),
  peng as (
    select ep.dosen_id, count(*) as n from public.exam_panel ep join uji on uji.id = ep.exam_id
    where ep.peran ilike 'penguji%' group by ep.dosen_id
  ),
  dsn_ids as (select dosen_id from sup union select dosen_id from sesi union select dosen_id from rev union select dosen_id from peng),
  dsn as (
    select d.id, d.nama, hp.kode as homebase,
      coalesce(d.kuota_bimbingan, hp.kuota_bimbingan_default) as kuota,
      (select count(distinct thesis_id) from sup where sup.dosen_id = d.id and peran = 'P1' and s = 'ganjil') as p1_ganjil,
      (select count(distinct thesis_id) from sup where sup.dosen_id = d.id and peran = 'P1' and s = 'genap') as p1_genap,
      (select count(distinct thesis_id) from sup where sup.dosen_id = d.id and peran = 'P2' and s = 'ganjil') as p2_ganjil,
      (select count(distinct thesis_id) from sup where sup.dosen_id = d.id and peran = 'P2' and s = 'genap') as p2_genap,
      (select count(*) from sesi where sesi.dosen_id = d.id) as sesi,
      (select count(*) from rev where rev.dosen_id = d.id) as n_review,
      (select round(avg(hari)::numeric, 1) from rev where rev.dosen_id = d.id) as hari_review,
      coalesce((select n from peng where peng.dosen_id = d.id), 0) as penguji
    from public.profiles d
    join dsn_ids on dsn_ids.dosen_id = d.id
    left join public.prodi hp on hp.id = d.prodi_id
  )
  select jsonb_build_object(
    'ts', v_ts,
    'ts_ditetapkan', v_cfg.ts_tahun,
    'batas', jsonb_build_object('S1', v_cfg.batas_semester_s1, 'D3', v_cfg.batas_semester_d3),
    'rentang', jsonb_build_object('mulai', r_ts.mulai, 'selesai', r_ts.selesai, 'ganjil', jsonb_build_array(r_g.mulai, r_g.selesai), 'genap', jsonb_build_array(r_e.mulai, r_e.selesai), 'tiga_ts_mulai', r_3.mulai),
    'bisa_atur', priv.is_admin(),
    'prodi', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'kode', kode, 'nama', nama, 'jenjang', jenjang, 'lembaga', coalesce(lembaga_akreditasi, case when nama ilike '%desain%' then 'LAM DEPILAR' else 'LAM INFOKOM' end),
                         'bisa_isi', priv.is_admin() or priv.is_kaprodi_of(id)) order by jenjang desc, nama) from pr), '[]'),

    -- Ringkasan per prodi
    'ringkas', coalesce((select jsonb_agg(jsonb_build_object(
        'prodi_id', pr.id,
        'lulusan', jsonb_build_array(
           (select count(*) from _akr a where a.prodi_id = pr.id and a.lulus_tahun = v_ts),
           (select count(*) from _akr a where a.prodi_id = pr.id and a.lulus_tahun = v_ts - 1),
           (select count(*) from _akr a where a.prodi_id = pr.id and a.lulus_tahun = v_ts - 2)),
        'n_masa_studi', (select count(*) from lul where lul.prodi_id = pr.id and lul.semester_lulus is not null),
        'rata_masa_studi', (select round(avg(semester_lulus / 2.0)::numeric, 2) from lul where lul.prodi_id = pr.id and lul.semester_lulus is not null),
        'tepat', (select count(*) from lul where lul.prodi_id = pr.id and lul.semester_lulus <= lul.batas),
        'tanpa_angkatan', (select count(*) from lul where lul.prodi_id = pr.id and lul.semester_lulus is null),
        'rata_lama_ta_bulan', (select round(avg((tgl_ujian_akhir - tgl_pembimbing) / 30.44)::numeric, 1) from lul where lul.prodi_id = pr.id and tgl_ujian_akhir is not null and tgl_pembimbing is not null),
        'ujian_n', (select count(*) from uji where uji.prodi_id = pr.id),
        'ujian_lulus_pertama', (select count(*) from uji where uji.prodi_id = pr.id and uji.percobaan = 1 and uji.hasil <> 'mengulang'),
        'ujian_pertama_n', (select count(*) from uji where uji.prodi_id = pr.id and uji.percobaan = 1),
        'mhs_aktif', jsonb_build_object('ganjil', coalesce((select n from aktif_sem where aktif_sem.prodi_id = pr.id and s = 'ganjil'), 0),
                                        'genap', coalesce((select n from aktif_sem where aktif_sem.prodi_id = pr.id and s = 'genap'), 0)),
        'sesi', jsonb_build_object('ganjil', (select count(*) from sesi where sesi.prodi_id = pr.id and s = 'ganjil'),
                                   'genap', (select count(*) from sesi where sesi.prodi_id = pr.id and s = 'genap')),
        'p1', jsonb_build_object(
          'ganjil', (select round(avg(c)::numeric, 2) from (select count(distinct thesis_id) as c from sup where sup.prodi_id = pr.id and peran = 'P1' and s = 'ganjil' group by dosen_id) x),
          'genap', (select round(avg(c)::numeric, 2) from (select count(distinct thesis_id) as c from sup where sup.prodi_id = pr.id and peran = 'P1' and s = 'genap' group by dosen_id) x)),
        'hari_review', (select round(avg(hari)::numeric, 1) from rev where rev.prodi_id = pr.id),
        'berisiko', (select count(*) from _akr a where a.prodi_id = pr.id and a.status in ('aktif', 'cuti') and priv.semester_ke(a.angkatan, current_date) >= a.batas - 1)
      )) from pr), '[]'),

    -- Tabel masa studi per angkatan (S1: TS-6..TS, D3: TS-4..TS)
    'masa_studi', coalesce((select jsonb_agg(jsonb_build_object(
        'prodi_id', pr.id, 'angkatan', ang, 'k', v_ts - ang,
        'diterima', (select jumlah from public.akreditasi_mahasiswa_baru mb where mb.prodi_id = pr.id and mb.angkatan = ang),
        'lulus_per_ts', (select jsonb_agg((select count(*) from _akr a where a.prodi_id = pr.id and a.angkatan = ang and a.lulus_tahun = v_ts - j) order by j desc)
                         from generate_series(0, case when pr.jenjang = 'D3' then 4 else 6 end) j),
        'lulus', (select count(*) from _akr a where a.prodi_id = pr.id and a.angkatan = ang and a.lulus_tahun <= v_ts),
        'tepat', (select count(*) from _akr a where a.prodi_id = pr.id and a.angkatan = ang and a.lulus_tahun <= v_ts and a.semester_lulus <= a.batas),
        'rata_masa_studi', (select round(avg(semester_lulus / 2.0)::numeric, 2) from _akr a where a.prodi_id = pr.id and a.angkatan = ang and a.lulus_tahun <= v_ts),
        'masih_aktif', (select count(*) from _akr a where a.prodi_id = pr.id and a.angkatan = ang and a.status in ('aktif', 'cuti'))
      ) order by pr.jenjang desc, pr.nama, ang)
      from pr, generate_series(v_ts - case when pr.jenjang = 'D3' then 4 else 6 end, v_ts) ang), '[]'),

    -- Lama per tahap (hari), lulusan 3 TS terakhir
    'tahap', coalesce((select jsonb_agg(jsonb_build_object(
        'prodi_id', pr.id,
        'pembimbing_sempro', (select round(avg(tgl_sempro - tgl_pembimbing)) from lul where lul.prodi_id = pr.id and tgl_sempro is not null and tgl_pembimbing is not null),
        'sempro_semhas', (select round(avg(tgl_semhas - tgl_sempro)) from lul where lul.prodi_id = pr.id and tgl_semhas is not null and tgl_sempro is not null),
        'semhas_akhir', (select round(avg(tgl_ujian_akhir - tgl_semhas)) from lul where lul.prodi_id = pr.id and tgl_ujian_akhir is not null and tgl_semhas is not null),
        'pembimbing_akhir', (select round(avg(tgl_ujian_akhir - tgl_pembimbing)) from lul where lul.prodi_id = pr.id and tgl_ujian_akhir is not null and tgl_pembimbing is not null),
        'akhir_lulus', (select round(avg(tgl_lulus - tgl_ujian_akhir)) from lul where lul.prodi_id = pr.id and tgl_ujian_akhir is not null)
      )) from pr), '[]'),

    -- Ujian pada TS
    'ujian', coalesce((select jsonb_agg(jsonb_build_object('prodi_id', prodi_id, 'jenis', jenis, 'n', n, 'pertama_n', pn, 'lulus_pertama', lp, 'mengulang', mg))
      from (select prodi_id, jenis, count(*) n, count(*) filter (where percobaan = 1) pn,
                   count(*) filter (where percobaan = 1 and hasil <> 'mengulang') lp, count(*) filter (where hasil = 'mengulang') mg
            from uji group by prodi_id, jenis) u), '[]'),

    -- Dosen pada TS
    'dosen', coalesce((select jsonb_agg(to_jsonb(dsn) order by greatest(p1_ganjil, p1_genap) desc, nama) from dsn), '[]'),

    -- Mahasiswa berisiko terlambat (per hari ini)
    'berisiko', coalesce((select jsonb_agg(x order by (x->>'semester')::int desc, x->>'nama') from (
        select jsonb_build_object('thesis_id', a.thesis_id, 'nama', a.nama, 'nim', a.nim, 'prodi_id', a.prodi_id, 'angkatan', a.angkatan,
          'semester', priv.semester_ke(a.angkatan, current_date), 'batas', a.batas, 'tahap', a.tahap, 'status', a.status) as x
        from _akr a
        where a.status in ('aktif', 'cuti') and priv.semester_ke(a.angkatan, current_date) >= a.batas - 1
        limit 300) q), '[]'),
    'tanpa_angkatan_aktif', (select count(*) from _akr a where a.status in ('aktif', 'cuti') and a.angkatan is null),

    -- Bidang kajian studi akhir yang dimulai pada TS-2..TS
    'topik', coalesce((select jsonb_agg(jsonb_build_object('prodi_id', prodi_id, 'bidang', bidang, 'n', n) order by n desc)
      from (select prodi_id, coalesce(bidang, 'Belum diisi') as bidang, count(*) n from _akr
            where mulai between r_3.mulai and r_ts.selesai group by 1, 2) t), '[]')
  ) into v_out;

  return v_out;
end;
$$;
grant execute on function public.dashboard_akreditasi(int, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Pengaturan
-- ---------------------------------------------------------------------
create or replace function public.atur_akreditasi(p_ts int, p_batas_s1 int, p_batas_d3 int)
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := priv.require_user();
begin
  if not priv.is_admin() then raise exception 'Hanya Admin yang dapat menetapkan TS'; end if;
  if p_ts is null or p_ts not between 2000 and 2100 then raise exception 'Tahun akademik TS tidak valid'; end if;
  update public.akreditasi_pengaturan
  set ts_tahun = p_ts, batas_semester_s1 = coalesce(p_batas_s1, batas_semester_s1), batas_semester_d3 = coalesce(p_batas_d3, batas_semester_d3),
      diubah_oleh = v_uid, updated_at = now()
  where id = 1;
end;
$$;

create or replace function public.atur_lembaga_prodi(p_prodi uuid, p_lembaga text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform priv.require_user();
  if not priv.is_admin() then raise exception 'Hanya Admin yang dapat mengubah lembaga akreditasi'; end if;
  update public.prodi set lembaga_akreditasi = nullif(trim(p_lembaga), '') where id = p_prodi;
end;
$$;

create or replace function public.simpan_mahasiswa_baru(p_prodi uuid, p_angkatan int, p_jumlah int)
returns void language plpgsql security definer set search_path = public as $$
declare v_uid uuid := priv.require_user();
begin
  if not (priv.is_admin() or priv.is_kaprodi_of(p_prodi)) then raise exception 'Hanya Admin atau Ka. Prodi yang dapat mengisi jumlah mahasiswa diterima'; end if;
  if p_angkatan is null or p_angkatan not between 1990 and 2100 then raise exception 'Angkatan tidak valid'; end if;
  if p_jumlah is null then
    delete from public.akreditasi_mahasiswa_baru where prodi_id = p_prodi and angkatan = p_angkatan;
    return;
  end if;
  if p_jumlah < 0 then raise exception 'Jumlah tidak boleh negatif'; end if;
  insert into public.akreditasi_mahasiswa_baru (prodi_id, angkatan, jumlah, diubah_oleh)
  values (p_prodi, p_angkatan, p_jumlah, v_uid)
  on conflict (prodi_id, angkatan) do update set jumlah = excluded.jumlah, diubah_oleh = v_uid, updated_at = now();
end;
$$;

revoke execute on function public.dashboard_akreditasi(int, uuid), public.atur_akreditasi(int, int, int), public.atur_lembaga_prodi(uuid, text), public.simpan_mahasiswa_baru(uuid, int, int) from anon;

-- ===================== supabase/seed.sql =====================
-- =====================================================================
-- SIMSA — Data contoh (opsional). Jalankan setelah semua migrasi.
-- Ganti nama prodi dan isi pedoman dengan data resmi institusi Anda.
-- =====================================================================

insert into public.prodi (kode, nama, jenjang, fakultas, min_bimbingan) values
  ('TI', 'Teknik Informatika', 'S1', 'Fakultas Teknik', 8),
  ('SI', 'Sistem Informasi', 'S1', 'Fakultas Teknik', 8),
  ('MI', 'Manajemen Informatika', 'D3', 'Fakultas Vokasi', 6)
on conflict (kode) do nothing;

insert into public.academic_years (nama, mulai, selesai, aktif) values
  ('2026/2027 Ganjil', '2026-09-01', '2027-02-28', true)
on conflict (nama) do nothing;

-- Pedoman contoh untuk setiap prodi (berlabel CONTOH agar mudah dikenali)
do $$
declare
  r record;
  g uuid;
  b1 uuid; b2 uuid;
begin
  for r in select * from public.prodi loop
    if exists (select 1 from public.guidelines where prodi_id = r.id) then continue; end if;

    insert into public.guidelines (prodi_id, academic_year_id, judul, versi, gaya_sitasi)
    values (r.id, (select id from public.academic_years where aktif limit 1),
            'CONTOH — Pedoman Penulisan ' || case when r.jenjang = 'S1' then 'Skripsi ' else 'Tugas Akhir ' end || r.nama,
            '2026.1', 'APA 7')
    returning id into g;

    insert into public.guideline_sections (guideline_id, urutan, nomor, judul, kategori, isi) values
      (g, 1, '1', 'Ketentuan Umum', 'umum',
       'Dokumen ini adalah contoh struktur pedoman di SIMSA. Ka. Prodi dapat mengganti setiap bagian dengan isi pedoman resmi.' || chr(10) || chr(10) ||
       'Naskah ditulis dalam Bahasa Indonesia baku sesuai PUEBI/EYD. Istilah asing dicetak miring.');

    insert into public.guideline_sections (guideline_id, urutan, nomor, judul, kategori, isi)
    values (g, 2, '2', 'Sistematika Penulisan', 'sistematika',
            'Struktur bab berikut menjadi acuan milestone dan pemeriksaan naskah.')
    returning id into b1;

    if r.jenjang = 'S1' then
      insert into public.guideline_sections (guideline_id, parent_id, urutan, nomor, judul, kategori, isi) values
        (g, b1, 1, '2.1', 'Bab 1 Pendahuluan', 'sistematika',
         'Memuat latar belakang, rumusan masalah, batasan masalah, tujuan penelitian, manfaat penelitian, dan sistematika penulisan.'),
        (g, b1, 2, '2.2', 'Bab 2 Tinjauan Pustaka', 'sistematika',
         'Memuat penelitian terdahulu (minimal 10 sumber, mayoritas terbitan 5–10 tahun terakhir) dan landasan teori yang relevan dengan rumusan masalah.'),
        (g, b1, 3, '2.3', 'Bab 3 Metodologi Penelitian', 'sistematika',
         'Memuat objek penelitian, jenis dan sumber data, teknik pengumpulan data, metode analisis atau pengembangan, serta alur penelitian.'),
        (g, b1, 4, '2.4', 'Bab 4 Hasil dan Pembahasan', 'sistematika',
         'Menyajikan hasil penelitian secara sistematis dan membahasnya dengan mengaitkan pada teori dan penelitian terdahulu.'),
        (g, b1, 5, '2.5', 'Bab 5 Kesimpulan dan Saran', 'sistematika',
         'Kesimpulan menjawab setiap rumusan masalah. Saran ditujukan untuk penelitian selanjutnya dan pihak terkait.');
    else
      insert into public.guideline_sections (guideline_id, parent_id, urutan, nomor, judul, kategori, isi) values
        (g, b1, 1, '2.1', 'Bab 1 Pendahuluan', 'sistematika',
         'Memuat latar belakang, rumusan masalah, batasan, tujuan, dan manfaat Tugas Akhir.'),
        (g, b1, 2, '2.2', 'Bab 2 Landasan Teori', 'sistematika',
         'Memuat teori, perangkat, dan teknologi yang digunakan dalam pelaksanaan Tugas Akhir.'),
        (g, b1, 3, '2.3', 'Bab 3 Analisis dan Perancangan', 'sistematika',
         'Memuat analisis kebutuhan dan rancangan sistem/produk yang dikerjakan.'),
        (g, b1, 4, '2.4', 'Bab 4 Implementasi dan Pengujian', 'sistematika',
         'Memuat hasil implementasi dan pengujian beserta pembahasannya.'),
        (g, b1, 5, '2.5', 'Bab 5 Penutup', 'sistematika',
         'Memuat kesimpulan dan saran.');
    end if;

    insert into public.guideline_sections (guideline_id, urutan, nomor, judul, kategori, isi)
    values (g, 3, '3', 'Aturan Penulisan', 'aturan', 'Ketentuan teknis penulisan naskah.')
    returning id into b2;

    insert into public.guideline_sections (guideline_id, parent_id, urutan, nomor, judul, kategori, isi) values
      (g, b2, 1, '3.1', 'Kertas dan Margin', 'aturan',
       'Kertas HVS A4 80 gram. Margin kiri 4 cm, atas 3 cm, kanan 3 cm, bawah 3 cm.'),
      (g, b2, 2, '3.2', 'Huruf dan Spasi', 'aturan',
       'Times New Roman 12 pt, spasi 1,5. Judul bab 14 pt tebal, huruf kapital, rata tengah.'),
      (g, b2, 3, '3.3', 'Penomoran', 'aturan',
       'Bagian awal memakai angka Romawi kecil (i, ii, iii). Bagian inti memakai angka Arab (1, 2, 3) di kanan bawah.'),
      (g, b2, 4, '3.4', 'Sitasi dan Daftar Pustaka', 'aturan',
       'Menggunakan gaya APA edisi 7. Setiap sumber yang dikutip wajib tercantum di daftar pustaka dan sebaliknya.');

    insert into public.guideline_sections (guideline_id, urutan, nomor, judul, kategori, isi) values
      (g, 4, '4', 'Rubrik Pemeriksaan Bab 1', 'rubrik',
       '- Latar belakang menunjukkan masalah nyata dengan data pendukung' || chr(10) ||
       '- Rumusan masalah berbentuk pertanyaan yang dapat dijawab' || chr(10) ||
       '- Tujuan selaras dengan setiap rumusan masalah' || chr(10) ||
       '- Batasan masalah jelas dan realistis');
  end loop;
end;
$$;
