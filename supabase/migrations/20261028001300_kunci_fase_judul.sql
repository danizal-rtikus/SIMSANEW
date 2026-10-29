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
