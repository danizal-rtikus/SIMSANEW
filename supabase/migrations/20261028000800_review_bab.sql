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
