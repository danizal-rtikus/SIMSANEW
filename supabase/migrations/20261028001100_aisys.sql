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
