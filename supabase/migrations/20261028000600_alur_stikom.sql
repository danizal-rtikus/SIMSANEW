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
