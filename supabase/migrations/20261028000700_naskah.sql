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
