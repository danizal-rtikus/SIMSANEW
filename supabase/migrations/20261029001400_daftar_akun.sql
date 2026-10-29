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
