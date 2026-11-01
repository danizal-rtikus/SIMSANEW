-- =====================================================================
-- SIMSA — DATA DUMMY DASHBOARD TRIAL (88 MAHASISWA & SEMUA PERAN)
-- =====================================================================
-- File ini dirancang untuk dijalankan di Supabase SQL Editor.
-- Tujuannya adalah membuat seluruh dashboard (Mahasiswa, Dosen, Ka. Prodi,
-- BAAK, Pimpinan, dan Akreditasi) tampil DINAMIS, INTERAKTIF, dan POSITIF.
--
-- Karakteristik Data Dummy:
-- 1. Prodi yang digunakan: INF (S1), SIF (S1), DKV (S1), KA (D3) sesuai database.
-- 2. Akun Staf/Dosen: Pimpinan, BAAK, Ka. Prodi & Dosen untuk setiap prodi.
-- 3. 88 Mahasiswa dengan sebaran tahapan milestone lengkap.
-- 4. Status EWS dominan POSITIF: ~86% Hijau, ~11% Kuning, ~3% Merah.
-- 5. 16 Mahasiswa Lulus dengan tingkat kelulusan tepat waktu tinggi (87.5%).
-- 6. Terdapat antrean pendaftaran judul, antrean bimbingan baru, jadwal minggu ini,
--    dan data akreditasi mahasiswa baru (LKPS) 2019-2026.
--
-- Semua akun demo menggunakan kata sandi: SimsaDemo2026
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. FUNGSI BANTU INTERNAL (TEMPORARY SESSION)
-- ---------------------------------------------------------------------
create or replace function pg_temp.buat_user(
  p_email text,
  p_nama text,
  p_role public.app_role,
  p_prodi_kode text default null,
  p_nim text default null,
  p_nidn text default null,
  p_angkatan int default null
) returns uuid language plpgsql as $$
declare
  v_uid uuid;
  v_prodi_id uuid;
  v_enc_pass text;
begin
  select id into v_uid from auth.users where email = p_email;

  begin
    v_enc_pass := extensions.crypt('SimsaDemo2026', extensions.gen_salt('bf'));
  exception when others then
    v_enc_pass := crypt('SimsaDemo2026', gen_salt('bf'));
  end;

  if v_uid is null then
    v_uid := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, reauthentication_token, phone_change, phone_change_token,
      email_change_confirm_status, is_super_admin, is_sso_user, is_anonymous
    ) values (
      '00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated',
      p_email, v_enc_pass, now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('nama', p_nama),
      now(), now(),
      '', '', '', '',
      '', '', '', '',
      0, false, false, false
    );

    insert into auth.identities (
      id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
    ) values (
      gen_random_uuid(), v_uid::text, v_uid, jsonb_build_object('sub', v_uid::text, 'email', p_email),
      'email', now(), now(), now()
    ) on conflict do nothing;
  end if;

  if p_prodi_kode is not null then
    select id into v_prodi_id from public.prodi where kode = p_prodi_kode;
  end if;

  update public.profiles
  set nama = p_nama,
      nim = coalesce(p_nim, nim),
      nidn = coalesce(p_nidn, nidn),
      prodi_id = coalesce(v_prodi_id, prodi_id),
      angkatan = coalesce(p_angkatan, angkatan),
      aktif = true
  where id = v_uid;

  insert into public.user_roles (user_id, role, prodi_id)
  values (v_uid, p_role, case when p_role = 'kaprodi' then v_prodi_id else null end)
  on conflict do nothing;

  return v_uid;
end;
$$;

-- ---------------------------------------------------------------------
-- 2. MASTER DATA PENDUKUNG (TAHUN AKADEMIK & AKREDITASI)
-- ---------------------------------------------------------------------
insert into public.academic_years (nama, mulai, selesai, aktif) values
  ('2024/2025 Ganjil', '2024-09-01', '2025-02-28', false),
  ('2024/2025 Genap',  '2025-03-01', '2025-08-31', false),
  ('2025/2026 Ganjil', '2025-09-01', '2026-02-28', false),
  ('2025/2026 Genap',  '2026-03-01', '2026-08-31', false),
  ('2026/2027 Ganjil', '2026-09-01', '2027-02-28', true)
on conflict (nama) do nothing;

update public.akreditasi_pengaturan set ts_tahun = 2026 where id = 1;

-- Data LKPS penerimaan mahasiswa baru per angkatan
insert into public.akreditasi_mahasiswa_baru (prodi_id, angkatan, jumlah)
select p.id, a.thn, a.jml
from public.prodi p
cross join (
  values
    (2019, 65), (2020, 70), (2021, 75), (2022, 80), (2023, 85), (2024, 90), (2025, 95), (2026, 100)
) as a(thn, jml)
on conflict (prodi_id, angkatan) do update set jumlah = excluded.jumlah;

-- ---------------------------------------------------------------------
-- 3. PEMBUATAN AKUN STAF & DOSEN PEMBIMBING LENGKAP
-- ---------------------------------------------------------------------
do $$
declare
  v_pimp uuid;
  v_baak uuid;
  v_inf_kaprodi uuid; v_inf_dosen1 uuid; v_inf_dosen2 uuid;
  v_sif_kaprodi uuid; v_sif_dosen1 uuid; v_sif_dosen2 uuid;
  v_dkv_kaprodi uuid; v_dkv_dosen1 uuid;
  v_ka_kaprodi uuid;  v_ka_dosen1 uuid;
begin
  -- Pimpinan & BAAK
  v_pimp := pg_temp.buat_user('pimpinan@stikomyos.ac.id', 'Dr. Ratna Wulandari', 'pimpinan');
  v_baak := pg_temp.buat_user('baak@stikomyos.ac.id', 'Siti Rahmawati, S.Kom.', 'baak');

  -- Dosen Teknik Informatika (INF)
  v_inf_kaprodi := pg_temp.buat_user('kaprodi.inf@stikomyos.ac.id', 'Dr. Budi Santoso, M.Kom.', 'kaprodi', 'INF', null, '0601018803');
  insert into public.user_roles (user_id, role, prodi_id) values (v_inf_kaprodi, 'dosen', null) on conflict do nothing;
  v_inf_dosen1  := pg_temp.buat_user('dosen.inf1@stikomyos.ac.id', 'Agus Prasetyo, M.Cs.', 'dosen', 'INF', null, '0601018804');
  v_inf_dosen2  := pg_temp.buat_user('dosen.inf2@stikomyos.ac.id', 'Eko Cahyono, M.T.', 'dosen', 'INF', null, '0601018805');

  -- Dosen Sistem Informasi (SIF)
  -- Catatan: Dhany Faizal Racma, M.Kom sudah ada sebagai kaprodi SIF di database
  select id into v_sif_kaprodi from public.profiles where email = 'dhany.faizal@stikomyos.ac.id';
  if v_sif_kaprodi is null then
    v_sif_kaprodi := pg_temp.buat_user('dhany.faizal@stikomyos.ac.id', 'Dhany Faizal Racma, M.Kom', 'kaprodi', 'SIF', null, '0624038601');
    insert into public.user_roles (user_id, role, prodi_id) values (v_sif_kaprodi, 'dosen', null) on conflict do nothing;
  end if;
  v_sif_dosen1 := pg_temp.buat_user('dosen.sif1@stikomyos.ac.id', 'Dewi Lestari, M.Kom.', 'dosen', 'SIF', null, '0601018801');
  v_sif_dosen2 := pg_temp.buat_user('dosen.sif2@stikomyos.ac.id', 'Bambang Irawan, M.Kom.', 'dosen', 'SIF', null, '0601018802');

  -- Dosen Desain Komunikasi Visual (DKV)
  v_dkv_kaprodi := pg_temp.buat_user('kaprodi.dkv@stikomyos.ac.id', 'Maya Safitri, M.Ds.', 'kaprodi', 'DKV', null, '0601018806');
  insert into public.user_roles (user_id, role, prodi_id) values (v_dkv_kaprodi, 'dosen', null) on conflict do nothing;
  v_dkv_dosen1  := pg_temp.buat_user('dosen.dkv1@stikomyos.ac.id', 'Rendra Wijaya, M.Sn.', 'dosen', 'DKV', null, '0601018807');

  -- Dosen Komputerisasi Akuntansi D3 (KA)
  v_ka_kaprodi := pg_temp.buat_user('kaprodi.ka@stikomyos.ac.id', 'Hendra Gunawan, M.Ak.', 'kaprodi', 'KA', null, '0601018808');
  insert into public.user_roles (user_id, role, prodi_id) values (v_ka_kaprodi, 'dosen', null) on conflict do nothing;
  v_ka_dosen1  := pg_temp.buat_user('dosen.ka1@stikomyos.ac.id', 'Rina Kartika, M.Kom.', 'dosen', 'KA', null, '0601018809');

  -- Perbarui kuota bimbingan default agar kapasitas dosen longgar dan berstatus hijau
  update public.profiles set kuota_bimbingan = 12 where id in (
    v_inf_kaprodi, v_inf_dosen1, v_inf_dosen2,
    v_sif_kaprodi, v_sif_dosen1, v_sif_dosen2,
    v_dkv_kaprodi, v_dkv_dosen1,
    v_ka_kaprodi,  v_ka_dosen1
  );
end $$;

-- ---------------------------------------------------------------------
-- 4. PEMBUATAN 88 MAHASISWA & SKENARIO ALUR TAHAPAN
-- ---------------------------------------------------------------------
do $$
declare
  v_ta_id uuid;
  v_inf_id uuid; v_sif_id uuid; v_dkv_id uuid; v_ka_id uuid;
  
  -- Daftar Dosen per Prodi
  v_inf_p1 uuid; v_inf_p2 uuid; v_inf_p3 uuid;
  v_sif_p1 uuid; v_sif_p2 uuid; v_sif_p3 uuid;
  v_dkv_p1 uuid; v_dkv_p2 uuid;
  v_ka_p1  uuid; v_ka_p2  uuid;

  v_idx int;
  v_mhs_id uuid;
  v_thesis_id uuid;
  v_judul text;
  v_p1 uuid; v_p2 uuid;
  v_tahap_target int;
  v_status_risiko text;
  v_tgl_mulai date;
  v_bimbingan_terakhir timestamptz;
  v_sesi_count int;
  v_s int;
  v_sesi_id uuid;
begin
  select id into v_ta_id from public.academic_years where aktif limit 1;
  select id into v_inf_id from public.prodi where kode = 'INF';
  select id into v_sif_id from public.prodi where kode = 'SIF';
  select id into v_dkv_id from public.prodi where kode = 'DKV';
  select id into v_ka_id  from public.prodi where kode = 'KA';

  -- Ambil dosen IDs
  select id into v_inf_p1 from public.profiles where email = 'kaprodi.inf@stikomyos.ac.id';
  select id into v_inf_p2 from public.profiles where email = 'dosen.inf1@stikomyos.ac.id';
  select id into v_inf_p3 from public.profiles where email = 'dosen.inf2@stikomyos.ac.id';

  select id into v_sif_p1 from public.profiles where email = 'dhany.faizal@stikomyos.ac.id';
  select id into v_sif_p2 from public.profiles where email = 'dosen.sif1@stikomyos.ac.id';
  select id into v_sif_p3 from public.profiles where email = 'dosen.sif2@stikomyos.ac.id';

  select id into v_dkv_p1 from public.profiles where email = 'kaprodi.dkv@stikomyos.ac.id';
  select id into v_dkv_p2 from public.profiles where email = 'dosen.dkv1@stikomyos.ac.id';

  select id into v_ka_p1  from public.profiles where email = 'kaprodi.ka@stikomyos.ac.id';
  select id into v_ka_p2  from public.profiles where email = 'dosen.ka1@stikomyos.ac.id';

  -- ===================================================================
  -- GENERATE 88 MAHASISWA
  -- Pembagian:
  -- Index 1 - 28 : Teknik Informatika (INF - S1) -> 28 mahasiswa
  -- Index 29 - 58: Sistem Informasi (SIF - S1)   -> 30 mahasiswa
  -- Index 59 - 73: Desain Komunikasi Visual (DKV)-> 15 mahasiswa
  -- Index 74 - 88: Komputerisasi Akuntansi (KA)  -> 15 mahasiswa
  -- ===================================================================
  for v_idx in 1..88 loop
    declare
      v_nama text;
      v_email text;
      v_nim text;
      v_prodi_kode text;
      v_prodi_id uuid;
      v_jenjang text;
      v_angkatan int;
      v_is_lulus boolean := false;
      v_is_pending_title boolean := false;
      v_is_pending_supervisor boolean := false;
    begin
      -- Penentuan Prodi, NIM, dan Angkatan
      if v_idx <= 28 then
        v_prodi_kode := 'INF'; v_prodi_id := v_inf_id; v_jenjang := 'S1';
        v_angkatan := case when v_idx <= 6 then 2021 when v_idx <= 25 then 2022 else 2023 end;
        v_nim := '2201' || lpad(v_idx::text, 3, '0');
        v_email := 'mhs.inf' || lpad(v_idx::text, 3, '0') || '@demo.simsa.id';
        v_nama := (array[
          'Aditya Pratama','Bagas Kurniawan','Chandra Wijaya','Dimas Wahyudi','Erlangga Putra',
          'Fajar Sidik','Gilang Ramadhan','Hendra Saputra','Irfan Maulana','Jodi Prasetyo',
          'Kevin Sanjaya','Lukman Hakim','Muhammad Fikri','Naufal Azhar','Okky Firmansyah',
          'Pandu Wicaksono','Rafi Ahmad','Satria Yudha','Taufik Hidayat','Umar Faruq',
          'Vicky Prasetyo','Wahyu Nugroho','Yogi Pratama','Zulfikar Ali','Aris Munandar',
          'Bayu Aji','Cahyo Utomo','Dodi Permana'
        ])[v_idx];
        v_judul := 'Rancang Bangun Sistem Cerdas ' || v_nama || ' Berbasis Deep Learning dan IoT';

      elsif v_idx <= 58 then
        declare v_offset int := v_idx - 28;
        begin
          v_prodi_kode := 'SIF'; v_prodi_id := v_sif_id; v_jenjang := 'S1';
          v_angkatan := case when v_offset <= 6 then 2021 when v_offset <= 26 then 2022 else 2023 end;
          v_nim := '2202' || lpad(v_offset::text, 3, '0');
          v_email := 'mhs.sif' || lpad(v_offset::text, 3, '0') || '@demo.simsa.id';
          v_nama := (array[
            'Annisa Rahmawati','Bella Safitri','Citra Kirana','Dinda Permata','Elisa Wardani',
            'Febriani Putri','Gita Gutawa','Hesti Purwanti','Intan Nuraini','Jelita Sari',
            'Kartika Chandra','Lestari Wulandari','Mega Silvia','Nadya Utami','Olivia Putri',
            'Putri Handayani','Qori Anggraini','Rina Marlina','Siti Nurhaliza','Tania Bella',
            'Utari Kusuma','Vina Amelia','Winda Lestari','Yuliana Safitri','Zahra Maharani',
            'Aulia Rahmi','Bunga Cantika','Devi Anggun','Fitriani Dewi','Gisela Anastasia'
          ])[v_offset];
          v_judul := 'Pengembangan Sistem Informasi Manajemen Terpadu ' || v_nama || ' Menggunakan Framework TOGAF';
        end;

      elsif v_idx <= 73 then
        declare v_offset int := v_idx - 58;
        begin
          v_prodi_kode := 'DKV'; v_prodi_id := v_dkv_id; v_jenjang := 'S1';
          v_angkatan := case when v_offset <= 3 then 2021 when v_offset <= 13 then 2022 else 2023 end;
          v_nim := '2203' || lpad(v_offset::text, 3, '0');
          v_email := 'mhs.dkv' || lpad(v_offset::text, 3, '0') || '@demo.simsa.id';
          v_nama := (array[
            'Alifia Nurul','Bintang Kejora','Cyntia Laura','Danang Joyo','Eunike Gloria',
            'Farhan Halim','Guntur Bumi','Hana Pertiwi','Indra Bekti','Jessica Mila',
            'Kurniawan Dwi','Luki Danendra','Mutiara Hati','Noval Rizki','Putra Mahkota'
          ])[v_offset];
          v_judul := 'Perancangan Visual Branding dan Media Promosi Interaktif ' || v_nama || ' Berbasis Augmented Reality';
        end;

      else
        declare v_offset int := v_idx - 73;
        begin
          v_prodi_kode := 'KA'; v_prodi_id := v_ka_id; v_jenjang := 'D3';
          v_angkatan := case when v_offset <= 3 then 2022 when v_offset <= 13 then 2023 else 2024 end;
          v_nim := '2304' || lpad(v_offset::text, 3, '0');
          v_email := 'mhs.ka' || lpad(v_offset::text, 3, '0') || '@demo.simsa.id';
          v_nama := (array[
            'Agnes Monika','Bambang Soediro','Celia Thomas','Denny Sumargo','Eko Patrio',
            'Feni Rose','Gading Marten','Helmy Yahya','Irfan Hakim','Jupe Perez',
            'Kiki Amalia','Luna Maya','Melaney Ricardo','Nikita Willy','Olga Syahputra'
          ])[v_offset];
          v_judul := 'Sistem Informasi Akuntansi Penggajian dan Pengendalian Kas ' || v_nama || ' Berbasis Web';
        end;
      end if;

      -- Buat / Dapatkan Akun Mahasiswa
      v_mhs_id := pg_temp.buat_user(v_email, v_nama, 'mahasiswa', v_prodi_kode, v_nim, null, v_angkatan);

      -- =================================================================
      -- SKENARIO KELOMPOK
      -- =================================================================
      -- A. Pendaftaran Judul Baru Menunggu Ka. Prodi (6 mahasiswa: index 27, 28, 57, 58, 73, 88)
      if v_idx in (27, 28, 57, 58, 73, 88) then
        v_is_pending_title := true;
        insert into public.title_submissions (
          mahasiswa_id, prodi_id, kelompok, prioritas, judul, abstrak, status, created_at
        ) values (
          v_mhs_id, v_prodi_id, gen_random_uuid(), 1, v_judul,
          'Abstrak usulan penelitian mengenai analisa kebutuhan dan solusi komprehensif oleh ' || v_nama,
          'diajukan', now() - interval '2 days'
        );
        continue; -- Selesai untuk kelompok A
      end if;

      -- B. Judul Disetujui, Belum Ada Ploting Pembimbing (4 mahasiswa: index 26, 56, 72, 87)
      if v_idx in (26, 56, 72, 87) then
        v_is_pending_supervisor := true;
      end if;

      -- C. Mahasiswa Lulus (16 mahasiswa: index 1-6 [INF], 29-34 [SIF], 59-61 [DKV], 74-76 [KA])
      if (v_idx between 1 and 6) or (v_idx between 29 and 34) or (v_idx between 59 and 61) or (v_idx between 74 and 76) then
        v_is_lulus := true;
      end if;

      -- Tetapkan Pembimbing (P1 & P2 bergantian agar beban dosen merata)
      if v_prodi_kode = 'INF' then
        v_p1 := case when v_idx % 2 = 0 then v_inf_p1 else v_inf_p2 end;
        v_p2 := case when v_idx % 2 = 0 then v_inf_p3 else v_inf_p1 end;
      elsif v_prodi_kode = 'SIF' then
        v_p1 := case when v_idx % 2 = 0 then v_sif_p1 else v_sif_p2 end;
        v_p2 := case when v_idx % 2 = 0 then v_sif_p3 else v_sif_p1 end;
      elsif v_prodi_kode = 'DKV' then
        v_p1 := v_dkv_p1;
        v_p2 := v_dkv_p2;
      else
        v_p1 := v_ka_p1;
        v_p2 := v_ka_p2;
      end if;

      -- Buat Data Studi Akhir (Thesis)
      v_tgl_mulai := case
        when v_is_lulus then (current_date - interval '10 months')
        when v_is_pending_supervisor then (current_date - interval '14 days')
        else (current_date - interval '4 months')
      end;

      insert into public.thesis (
        mahasiswa_id, prodi_id, jenjang, academic_year_id, judul, abstrak, status, mulai, created_at, updated_at
      ) values (
        v_mhs_id, v_prodi_id, v_jenjang::public.jenjang, v_ta_id, v_judul,
        'Penelitian mendalam yang mengeksplorasi metodologi dan implementasi sistem studi akhir.',
        case when v_is_lulus then 'lulus' else 'aktif' end,
        v_tgl_mulai, v_tgl_mulai, now()
      )
      returning id into v_thesis_id;

      -- Catat Judul Terkait di title_submissions
      insert into public.title_submissions (
        mahasiswa_id, prodi_id, kelompok, prioritas, judul, abstrak, status, thesis_id, created_at
      ) values (
        v_mhs_id, v_prodi_id, gen_random_uuid(), 1, v_judul, 'Abstrak disetujui.', 'disetujui', v_thesis_id, v_tgl_mulai
      );

      -- Hubungkan Pembimbing (bila bukan kelompok B)
      if not v_is_pending_supervisor then
        insert into public.thesis_supervisors (thesis_id, dosen_id, peran, aktif, ditetapkan_at) values
          (v_thesis_id, v_p1, 'P1', true, v_tgl_mulai),
          (v_thesis_id, v_p2, 'P2', true, v_tgl_mulai);
      end if;

      -- Buat Milestone dari Template
      perform priv.generate_milestones(v_thesis_id);

      -- =================================================================
      -- SEBARAN TAHAPAN MILESTONE & STATUS RISIKO
      -- =================================================================
      if v_is_lulus then
        -- Semua milestone selesai 100%
        update public.thesis_milestones
        set status = 'selesai',
            selesai_at = v_tgl_mulai + interval '8 months'
        where thesis_id = v_thesis_id;

        v_bimbingan_terakhir := v_tgl_mulai + interval '7 months';
        v_sesi_count := 10;
        v_status_risiko := 'hijau';

      elsif v_is_pending_supervisor then
        -- Milestone 1 (Pendaftaran) selesai, Milestone 2 (Pembimbing) sedang dikerjakan
        update public.thesis_milestones
        set status = 'selesai', selesai_at = now() - interval '3 days'
        where thesis_id = v_thesis_id and urutan = 1;

        update public.thesis_milestones
        set status = 'dikerjakan', mulai = current_date - 3
        where thesis_id = v_thesis_id and urutan = 2;

        v_bimbingan_terakhir := null;
        v_sesi_count := 0;

      else
        -- Mahasiswa Aktif dengan Sebaran Positif (Tahap 3 s/d 12)
        -- Distribusi:
        -- urutan 3 (Bab 1): ~9 mhs
        -- urutan 4 (Bab 2): ~10 mhs
        -- urutan 5 (Bab 3): ~10 mhs
        -- urutan 6 (Sempro): ~8 mhs
        -- urutan 7 (Revisi Sempro): ~6 mhs
        -- urutan 8 (Bab 4): ~8 mhs
        -- urutan 9 (Bab 5): ~7 mhs
        -- urutan 10-12 (Semhas / Pendadaran): ~6 mhs
        v_tahap_target := case
          when v_idx % 8 = 0 then 3  -- Bab 1
          when v_idx % 8 = 1 then 4  -- Bab 2
          when v_idx % 8 = 2 then 5  -- Bab 3
          when v_idx % 8 = 3 then 6  -- Sempro
          when v_idx % 8 = 4 then 7  -- Revisi Sempro
          when v_idx % 8 = 5 then 8  -- Bab 4
          when v_idx % 8 = 6 then 9  -- Bab 5
          else case when v_jenjang = 'S1' then 10 else 8 end -- Semhas / Ujian Akhir
        end;

        -- Selesaikan milestone sebelum tahap target
        update public.thesis_milestones
        set status = 'selesai',
            selesai_at = v_tgl_mulai + (urutan * interval '12 days')
        where thesis_id = v_thesis_id and urutan < v_tahap_target;

        -- Tandai milestone target sedang dikerjakan
        update public.thesis_milestones
        set status = 'dikerjakan',
            mulai = current_date - 15,
            tenggat = current_date + 20
        where thesis_id = v_thesis_id and urutan = v_tahap_target;

        -- Atur status risiko:
        -- Sebisa mungkin POSITIF:
        -- ~86% Hijau (bimbingan 3-10 hari lalu)
        -- ~11% Kuning (bimbingan 33 hari lalu) -> misal index 15, 25, 45, 55, 65, 80
        -- ~3% Merah (bimbingan 65 hari lalu)  -> misal index 20, 50
        if v_idx in (20, 50) then
          v_status_risiko := 'merah';
          v_bimbingan_terakhir := now() - interval '65 days';
          -- Lewatkan tenggat milestone target
          update public.thesis_milestones
          set tenggat = current_date - interval '32 days'
          where thesis_id = v_thesis_id and urutan = v_tahap_target;
        elsif v_idx in (15, 25, 45, 55, 65, 80) then
          v_status_risiko := 'kuning';
          v_bimbingan_terakhir := now() - interval '34 days';
          update public.thesis_milestones
          set tenggat = current_date + interval '4 days'
          where thesis_id = v_thesis_id and urutan = v_tahap_target;
        else
          v_status_risiko := 'hijau';
          v_bimbingan_terakhir := now() - ((v_idx % 9 + 2) * interval '1 day');
        end if;

        v_sesi_count := least(v_tahap_target, 8);
      end if;

      -- =================================================================
      -- BUAT RIWAYAT BIMBINGAN (GUIDANCE SESSIONS)
      -- =================================================================
      if v_sesi_count > 0 and not v_is_pending_supervisor then
        for v_s in 1..v_sesi_count loop
          insert into public.guidance_sessions (
            thesis_id, mahasiswa_id, dosen_id, mode, tanggal_usulan, tanggal_jadwal,
            topik, status, ringkasan, saran, tindak_lanjut, hasil, disahkan, created_at
          ) values (
            v_thesis_id, v_mhs_id, case when v_s % 2 = 0 then v_p2 else v_p1 end,
            'tatap_muka',
            v_tgl_mulai + (v_s * interval '12 days'),
            v_tgl_mulai + (v_s * interval '12 days'),
            'Bimbingan ' || case when v_s <= 3 then 'Bab 1-2' when v_s <= 5 then 'Bab 3 Metodologi' else 'Bab 4-5 Hasil' end,
            'selesai',
            'Pembahasan progres draft dan metodologi penelitian ' || v_nama,
            'Perbaiki format sitasi APA 7 dan pertegas keterkaitan rumusan masalah dengan tujuan.',
            'Menyempurnakan bab terkait dan menyiapkan draf revisi minggu depan.',
            'disetujui', true,
            v_tgl_mulai + (v_s * interval '12 days')
          );
        end loop;

        -- Pastikan tanggal bimbingan terakhir tercatat tepat sesuai status risiko
        insert into public.guidance_sessions (
          thesis_id, mahasiswa_id, dosen_id, mode, tanggal_usulan, tanggal_jadwal,
          topik, status, ringkasan, saran, tindak_lanjut, hasil, disahkan, created_at
        ) values (
          v_thesis_id, v_mhs_id, v_p1, 'tatap_muka',
          v_bimbingan_terakhir, v_bimbingan_terakhir,
          'Sesi Konsultasi Progres Terakhir',
          'selesai',
          'Konsultasi capaian data empiris dan pengujian sistem.',
          'Lanjutkan sesuai saran perbaikan.',
          'Menyerahkan naskah akhir bab.',
          'lanjut', true, v_bimbingan_terakhir
        );

        -- Tambahan 1: Sesi Bimbingan Menunggu Tanggapan Dosen (Status 'diajukan') untuk beberapa mahasiswa
        if v_idx in (7, 14, 35, 42, 62, 78) then
          insert into public.guidance_sessions (
            thesis_id, mahasiswa_id, dosen_id, mode, tanggal_usulan,
            topik, status, pesan, created_at
          ) values (
            v_thesis_id, v_mhs_id, v_p1, 'tatap_muka',
            now() - interval '1 day',
            'Pengajuan bimbingan pembahasan revisi Bab ' || least(v_tahap_target, 5),
            'diajukan',
            'Selamat pagi Bapak/Ibu, mohon waktu untuk konsultasi perbaikan instrumen penelitian.',
            now() - interval '1 day'
          );
        end if;

        -- Tambahan 2: Sesi Bimbingan Terjadwal Minggu Ini (Status 'dijadwalkan') untuk beberapa mahasiswa
        if v_idx in (8, 16, 36, 44, 63, 79) then
          insert into public.guidance_sessions (
            thesis_id, mahasiswa_id, dosen_id, mode, tanggal_usulan, tanggal_jadwal, lokasi,
            topik, status, pesan, created_at
          ) values (
            v_thesis_id, v_mhs_id, v_p2, 'tatap_muka',
            now() - interval '3 days',
            now() + ((v_idx % 4 + 1) * interval '1 day'),
            'Ruang Dosen Gedung B Lt. 2',
            'Jadwal Bimbingan Progres Bab ' || least(v_tahap_target, 5),
            'dijadwalkan',
            'Harap bawa printout matriks keselarasan rumusan masalah dan instrumen.',
            now() - interval '3 days'
          );
        end if;
      end if;

    end;
  end loop;

end $$;

commit;

-- =====================================================================
-- CEK HASIL GENERATE
-- =====================================================================
select
  pr.kode as prodi,
  count(distinct th.id) as total_skripsi,
  count(distinct th.id) filter (where th.status = 'aktif') as aktif,
  count(distinct th.id) filter (where th.status = 'lulus') as lulus,
  count(distinct th.id) filter (where v.risiko = 'hijau') as risiko_hijau,
  count(distinct th.id) filter (where v.risiko = 'kuning') as risiko_kuning,
  count(distinct th.id) filter (where v.risiko = 'merah') as risiko_merah
from public.thesis th
join public.prodi pr on pr.id = th.prodi_id
left join public.v_thesis_progress v on v.thesis_id = th.id
group by pr.kode;
