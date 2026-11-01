-- =====================================================================
-- PERBAIKAN LENGKAP SUPABASE AUTH (Mengatasi "Database error finding users")
-- =====================================================================
-- Jalankan skrip ini di Supabase SQL Editor.
--
-- PENYEBAB UTAMA:
-- Saat akun dibuat melalui raw SQL (seperti seed dummy), beberapa kolom teks
-- internal Supabase Auth (GoTrue) seperti recovery_token, email_change,
-- reauthentication_token, dsb., tertinggal bernilai NULL di tabel "auth.users",
-- dan/atau kolom id di "auth.identities" tertinggal NULL.
--
-- GoTrue ditulis dalam bahasa Go yang tidak mengizinkan nilai NULL di-scan
-- ke struct model internal Go bertipe string/UUID. Hal ini memicu error:
-- "sql: Scan error on column ...: converting NULL to string is unsupported"
-- yang oleh Supabase Auth dibungkus menjadi HTTP 500:
-- {"code":500,"error_code":"unexpected_failure","msg":"Database error finding users"}
--
-- Skrip ini memperbaiki semua kolom NULL di auth.users dan auth.identities.
-- =====================================================================

begin;

-- 1. Perbaiki semua kolom token dan string di auth.users yang bernilai NULL
update auth.users
set 
  confirmation_token = coalesce(confirmation_token, ''),
  recovery_token = coalesce(recovery_token, ''),
  email_change_token_new = coalesce(email_change_token_new, ''),
  email_change = coalesce(email_change, ''),
  email_change_token_current = coalesce(email_change_token_current, ''),
  reauthentication_token = coalesce(reauthentication_token, ''),
  phone_change = coalesce(phone_change, ''),
  phone_change_token = coalesce(phone_change_token, ''),
  email_change_confirm_status = coalesce(email_change_confirm_status, 0),
  is_super_admin = coalesce(is_super_admin, false),
  is_sso_user = coalesce(is_sso_user, false),
  is_anonymous = coalesce(is_anonymous, false),
  raw_app_meta_data = coalesce(raw_app_meta_data, '{"provider":"email","providers":["email"]}'::jsonb),
  raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb);

-- 2. Perbaiki baris di auth.identities yang kolom id-nya NULL
update auth.identities
set id = gen_random_uuid()
where id is null;

-- 3. Perbaiki baris di auth.identities yang kolom provider_id-nya NULL
update auth.identities
set provider_id = user_id::text
where provider_id is null;

-- 4. Perbaiki baris di auth.identities yang identity_data tidak lengkap
update auth.identities i
set identity_data = jsonb_build_object('sub', i.user_id::text, 'email', u.email)
from auth.users u
where i.user_id = u.id
  and (i.identity_data is null or i.identity_data = '{}'::jsonb or not (i.identity_data ? 'email'));

-- 5. Tambahkan identitas untuk user yang belum memiliki baris sama sekali di auth.identities
insert into auth.identities (
  id,
  provider_id,
  user_id,
  identity_data,
  provider,
  last_sign_in_at,
  created_at,
  updated_at
)
select
  gen_random_uuid(),
  u.id::text,
  u.id,
  jsonb_build_object('sub', u.id::text, 'email', u.email),
  'email',
  now(),
  coalesce(u.created_at, now()),
  coalesce(u.updated_at, now())
from auth.users u
where not exists (
  select 1 from auth.identities i where i.user_id = u.id
)
on conflict do nothing;

commit;

-- =====================================================================
-- LAPORAN VERIFIKASI KESEHATAN AUTH
-- =====================================================================
select 
  (select count(*) from auth.users) as total_users,
  (select count(*) from auth.identities) as total_identities,
  (select count(*) from auth.users where recovery_token is null or email_change is null or confirmation_token is null) as users_with_null_tokens,
  (select count(*) from auth.identities where id is null) as identities_with_null_id,
  case 
    when (select count(*) from auth.users where recovery_token is null or email_change is null) = 0
     and (select count(*) from auth.identities where id is null) = 0
    then 'SEMUA KOLOM BERSIH & SINKRON (BERHASIL)'
    else 'MASIH ADA NILAI NULL'
  end as status_perbaikan;
