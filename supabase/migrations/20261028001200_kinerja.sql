-- =====================================================================
-- SIMSA — Migrasi 12: kinerja kueri
--   1. Indeks untuk kolom yang sering dipakai menyaring dan menggabung.
--   2. Aturan RLS: pemeriksaan yang tidak bergantung pada baris (auth.uid(),
--      is_admin(), has_role(...)) dibungkus "(select ...)" agar dihitung sekali
--      per kueri, bukan sekali per baris (saran resmi Supabase).
--   3. Peran yang melihat semua studi akhir (Admin, Pimpinan, BAAK semua prodi)
--      tidak lagi menjalankan pemeriksaan akses per baris.
-- Aman dijalankan ulang.
-- =====================================================================

-- 1. Indeks ------------------------------------------------------------
create index if not exists comments_thesis_idx on public.comments (thesis_id);
create index if not exists exam_panel_thesis_idx on public.exam_panel (thesis_id, dosen_id);
create index if not exists exam_revision_notes_exam_idx on public.exam_revision_notes (exam_id);
create index if not exists exam_revision_notes_thesis_idx on public.exam_revision_notes (thesis_id);
create index if not exists exam_scores_thesis_idx on public.exam_scores (thesis_id);
create index if not exists exam_scores_dosen_idx on public.exam_scores (dosen_id);
create index if not exists guidance_sessions_mhs_idx on public.guidance_sessions (mahasiswa_id, tanggal_usulan desc);
create index if not exists thesis_title_history_thesis_idx on public.thesis_title_history (thesis_id);
create index if not exists title_submissions_thesis_idx on public.title_submissions (thesis_id);
create index if not exists user_roles_prodi_idx on public.user_roles (prodi_id) where prodi_id is not null;
create index if not exists milestone_history_milestone_idx on public.milestone_history (milestone_id);
create index if not exists chapter_reviews_dosen_idx on public.chapter_reviews (dosen_id);
create index if not exists guideline_bookmarks_section_idx on public.guideline_bookmarks (section_id);
create index if not exists guideline_sections_parent_idx on public.guideline_sections (parent_id);
create index if not exists milestone_approvals_dosen_idx on public.milestone_approvals (dosen_id);
create index if not exists documents_milestone_idx on public.documents (milestone_id);
create index if not exists notifications_unread_idx on public.notifications (user_id) where dibaca_at is null;
create index if not exists ai_usage_logs_thesis_idx on public.ai_usage_logs (thesis_id);

-- 3. Peran yang melihat semua studi akhir --------------------------------
create or replace function priv.sees_all_thesis()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_roles ur join public.profiles p on p.id = ur.user_id
    where ur.user_id = auth.uid() and p.aktif
      and (ur.role in ('admin', 'pimpinan') or (ur.role = 'baak' and ur.prodi_id is null))
  );
$$;
revoke all on function priv.sees_all_thesis() from public, anon;
grant execute on function priv.sees_all_thesis() to authenticated;

-- 2 dan 3. Tulis ulang ekspresi aturan RLS di skema public ---------------
do $$
declare
  r record;
  q text;
  c text;
  stmt text;
  -- Pemanggilan yang tidak bergantung baris; lewati yang sudah dibungkus SELECT.
  pat constant text := '(?<!SELECT )(auth\.uid\(\)|priv\.is_admin\(\)|priv\.is_staff\(\)|priv\.has_role\(''[a-z]+''::app_role\))';
  fn text;
begin
  for r in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where schemaname = 'public'
  loop
    q := r.qual;
    c := r.with_check;
    if q is not null then
      q := regexp_replace(q, pat, '(SELECT \1)', 'g');
      if q !~ 'sees_all_thesis' then
        q := regexp_replace(q, 'priv\.can_view_thesis\(([a-z_.]+)\)', '((SELECT priv.sees_all_thesis()) OR priv.can_view_thesis(\1))', 'g');
      end if;
    end if;
    if c is not null then
      c := regexp_replace(c, pat, '(SELECT \1)', 'g');
    end if;
    if q is distinct from r.qual or c is distinct from r.with_check then
      stmt := format('alter policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
      if q is not null then stmt := stmt || ' using (' || q || ')'; end if;
      if c is not null then stmt := stmt || ' with check (' || c || ')'; end if;
      execute stmt;
    end if;
  end loop;
end
$$;
