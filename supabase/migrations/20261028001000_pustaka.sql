-- =====================================================================
-- SIMSA — Migrasi 10: pustaka (referensi) naskah
--   * thesis_references: daftar rujukan milik satu studi akhir, disimpan
--     dalam format CSL-JSON (standar yang dipakai Mendeley, Zotero, Crossref).
--   * Sitasi di naskah merujuk id baris ini; daftar pustaka disusun otomatis
--     dengan gaya sesuai pedoman prodi (APA atau IEEE).
-- Hanya mahasiswa pemilik yang dapat menambah, mengubah, atau menghapus
-- rujukan; pihak lain yang berhak melihat studi akhir dapat membaca.
-- =====================================================================

create table public.thesis_references (
  id uuid primary key default gen_random_uuid(),
  thesis_id uuid not null references public.thesis (id) on delete cascade,
  csl jsonb not null check (jsonb_typeof(csl) = 'object'),
  doi text,
  sumber text not null default 'manual' check (sumber in ('doi', 'cari', 'bibtex', 'ris', 'manual', 'mendeley')),
  created_by uuid references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index thesis_references_doi_unik on public.thesis_references (thesis_id, lower(doi)) where doi is not null and doi <> '';
create index thesis_references_thesis_idx on public.thesis_references (thesis_id, created_at);
create trigger thesis_references_touch before update on public.thesis_references
  for each row execute function priv.touch_updated_at();

alter table public.thesis_references enable row level security;

create policy thesis_references_select on public.thesis_references for select to authenticated
  using (priv.can_view_thesis(thesis_id));

create policy thesis_references_insert on public.thesis_references for insert to authenticated
  with check (
    priv.is_thesis_owner(thesis_id)
    and exists (select 1 from public.thesis t where t.id = thesis_id and t.status = 'aktif')
  );

create policy thesis_references_update on public.thesis_references for update to authenticated
  using (priv.is_thesis_owner(thesis_id))
  with check (priv.is_thesis_owner(thesis_id));

create policy thesis_references_delete on public.thesis_references for delete to authenticated
  using (priv.is_thesis_owner(thesis_id));

revoke all on public.thesis_references from anon;
grant select, insert, update, delete on public.thesis_references to authenticated;
