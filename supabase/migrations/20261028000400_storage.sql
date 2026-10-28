-- =====================================================================
-- SIMSA — Migrasi 4: Supabase Storage
--   drafts     : draf skripsi/TA (privat). Path wajib: {thesis_id}/{nama-berkas}
--   guidelines : PDF pedoman asli (dapat dibaca semua pengguna login)
-- Akses berkas memakai signed URL berumur pendek dari aplikasi.
-- =====================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('drafts', 'drafts', false, 20971520, array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]),
  ('guidelines', 'guidelines', false, 52428800, array['application/pdf'])
on conflict (id) do nothing;

create policy drafts_select on storage.objects for select to authenticated
  using (bucket_id = 'drafts' and priv.can_view_thesis(priv.try_uuid((storage.foldername(name))[1])));

create policy drafts_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'drafts'
    and (
      priv.is_thesis_owner(priv.try_uuid((storage.foldername(name))[1]))
      or priv.is_supervisor_of(priv.try_uuid((storage.foldername(name))[1]))
    )
  );

create policy guidelines_files_select on storage.objects for select to authenticated
  using (bucket_id = 'guidelines');

create policy guidelines_files_manage on storage.objects for insert to authenticated
  with check (bucket_id = 'guidelines' and (priv.is_admin() or priv.has_role('kaprodi')));

create policy guidelines_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'guidelines' and (priv.is_admin() or priv.has_role('kaprodi')));
