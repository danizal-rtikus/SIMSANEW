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
