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
