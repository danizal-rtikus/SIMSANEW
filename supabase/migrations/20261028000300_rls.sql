-- =====================================================================
-- SIMSA — Migrasi 3: Row Level Security
-- Prinsip: least privilege. Perubahan alur kerja (judul, pembimbing,
-- bimbingan, milestone) hanya lewat fungsi RPC; tabel hanya membuka
-- akses baca sesuai peran, plus sedikit penulisan langsung yang aman.
-- =====================================================================

alter table public.prodi enable row level security;
alter table public.academic_years enable row level security;
alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.guidelines enable row level security;
alter table public.guideline_sections enable row level security;
alter table public.guideline_bookmarks enable row level security;
alter table public.thesis enable row level security;
alter table public.title_submissions enable row level security;
alter table public.thesis_supervisors enable row level security;
alter table public.milestone_templates enable row level security;
alter table public.thesis_milestones enable row level security;
alter table public.milestone_history enable row level security;
alter table public.documents enable row level security;
alter table public.guidance_sessions enable row level security;
alter table public.comments enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_logs enable row level security;

-- ---------------------------------------------------------------------
-- Master data: semua pengguna login dapat membaca; Admin mengelola
-- ---------------------------------------------------------------------
create policy prodi_select on public.prodi for select to authenticated using (true);
create policy prodi_admin on public.prodi for all to authenticated
  using (priv.is_admin()) with check (priv.is_admin());
-- Ka. Prodi boleh mengubah parameter prodinya sendiri (ambang, kuota, min. bimbingan)
create policy prodi_kaprodi_update on public.prodi for update to authenticated
  using (priv.is_kaprodi_of(id)) with check (priv.is_kaprodi_of(id));

create policy academic_years_select on public.academic_years for select to authenticated using (true);
create policy academic_years_admin on public.academic_years for all to authenticated
  using (priv.is_admin()) with check (priv.is_admin());

-- ---------------------------------------------------------------------
-- Profil dan peran
-- ---------------------------------------------------------------------
create policy profiles_select on public.profiles for select to authenticated
  using (priv.can_view_profile(id));
-- Pengguna dapat memperbarui kontak sendiri; kolom sensitif dikunci lewat GRANT kolom di bawah
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_admin on public.profiles for all to authenticated
  using (priv.is_admin()) with check (priv.is_admin());

revoke update on public.profiles from authenticated;
grant update (nama, telepon, bidang_keahlian) on public.profiles to authenticated;

create policy user_roles_select on public.user_roles for select to authenticated
  using (user_id = auth.uid() or priv.is_admin() or role <> 'mahasiswa' or priv.can_view_profile(user_id));
create policy user_roles_admin on public.user_roles for all to authenticated
  using (priv.is_admin()) with check (priv.is_admin());

-- ---------------------------------------------------------------------
-- Pedoman
-- ---------------------------------------------------------------------
create policy guidelines_select on public.guidelines for select to authenticated
  using (aktif or priv.is_admin() or priv.is_kaprodi_of(prodi_id));
create policy guidelines_manage on public.guidelines for all to authenticated
  using (priv.is_admin() or priv.is_kaprodi_of(prodi_id))
  with check (priv.is_admin() or priv.is_kaprodi_of(prodi_id));

create policy guideline_sections_select on public.guideline_sections for select to authenticated
  using (exists (select 1 from public.guidelines g where g.id = guideline_id
                 and (g.aktif or priv.is_admin() or priv.is_kaprodi_of(g.prodi_id))));
create policy guideline_sections_manage on public.guideline_sections for all to authenticated
  using (exists (select 1 from public.guidelines g where g.id = guideline_id
                 and (priv.is_admin() or priv.is_kaprodi_of(g.prodi_id))))
  with check (exists (select 1 from public.guidelines g where g.id = guideline_id
                 and (priv.is_admin() or priv.is_kaprodi_of(g.prodi_id))));

create policy guideline_bookmarks_own on public.guideline_bookmarks for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- Studi akhir dan turunannya
-- ---------------------------------------------------------------------
create policy thesis_select on public.thesis for select to authenticated
  using (priv.can_view_thesis(id));
-- Ka. Prodi/Admin boleh merapikan judul, abstrak, kata kunci (perubahan status lewat RPC)
create policy thesis_update on public.thesis for update to authenticated
  using (priv.can_manage_thesis(id)) with check (priv.can_manage_thesis(id));
revoke update on public.thesis from authenticated;
grant update (judul, abstrak, bidang_kajian, kata_kunci, guideline_id) on public.thesis to authenticated;

create policy title_submissions_select on public.title_submissions for select to authenticated
  using (mahasiswa_id = auth.uid() or priv.is_kaprodi_of(prodi_id) or priv.is_baak_of(prodi_id)
         or priv.has_role('pimpinan') or priv.is_admin());

create policy thesis_supervisors_select on public.thesis_supervisors for select to authenticated
  using (priv.can_view_thesis(thesis_id) or dosen_id = auth.uid());

create policy milestone_templates_select on public.milestone_templates for select to authenticated using (true);
create policy milestone_templates_manage on public.milestone_templates for all to authenticated
  using (priv.is_admin() or (prodi_id is not null and priv.is_kaprodi_of(prodi_id)))
  with check (priv.is_admin() or (prodi_id is not null and priv.is_kaprodi_of(prodi_id)));

create policy thesis_milestones_select on public.thesis_milestones for select to authenticated
  using (priv.can_view_thesis(thesis_id));

create policy milestone_history_select on public.milestone_history for select to authenticated
  using (priv.can_view_thesis(thesis_id));

create policy documents_select on public.documents for select to authenticated
  using (priv.can_view_thesis(thesis_id));

create policy guidance_sessions_select on public.guidance_sessions for select to authenticated
  using (priv.can_view_thesis(thesis_id));

-- Komentar: mahasiswa pemilik dan pembimbing dapat berdiskusi; Ka. Prodi dapat ikut berkomentar
create policy comments_select on public.comments for select to authenticated
  using (priv.can_view_thesis(thesis_id));
create policy comments_insert on public.comments for insert to authenticated
  with check (
    penulis_id = auth.uid()
    and (priv.is_thesis_owner(thesis_id) or priv.is_supervisor_of(thesis_id) or priv.can_manage_thesis(thesis_id))
    and (document_id is null or exists (select 1 from public.documents d where d.id = document_id and d.thesis_id = comments.thesis_id))
    and (session_id is null or exists (select 1 from public.guidance_sessions s where s.id = session_id and s.thesis_id = comments.thesis_id))
  );
create policy comments_update on public.comments for update to authenticated
  using (penulis_id = auth.uid() or priv.is_thesis_owner(thesis_id) or priv.is_supervisor_of(thesis_id))
  with check (penulis_id = auth.uid() or priv.is_thesis_owner(thesis_id) or priv.is_supervisor_of(thesis_id));
revoke update on public.comments from authenticated;
grant update (selesai) on public.comments to authenticated;
create policy comments_delete on public.comments for delete to authenticated
  using (penulis_id = auth.uid());

-- ---------------------------------------------------------------------
-- Notifikasi dan audit
-- ---------------------------------------------------------------------
create policy notifications_own on public.notifications for select to authenticated
  using (user_id = auth.uid());
create policy notifications_update_own on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke update on public.notifications from authenticated;
grant update (dibaca_at) on public.notifications to authenticated;

create policy audit_logs_admin on public.audit_logs for select to authenticated
  using (priv.is_admin());

-- Tidak ada akses untuk anon
revoke all on all tables in schema public from anon;

-- Notifikasi real-time (Supabase Realtime menghormati RLS)
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.notifications;
  end if;
end;
$$;

-- Ka. Prodi hanya boleh mengubah parameter prodi, bukan identitasnya
create or replace function priv.guard_prodi_identity()
returns trigger language plpgsql as $$
begin
  if not priv.is_admin() and auth.uid() is not null and (
    new.kode is distinct from old.kode or new.nama is distinct from old.nama
    or new.jenjang is distinct from old.jenjang or new.fakultas is distinct from old.fakultas
  ) then
    raise exception 'Hanya Admin yang dapat mengubah kode, nama, jenjang, atau fakultas prodi';
  end if;
  return new;
end;
$$;
create trigger prodi_guard_identity before update on public.prodi
  for each row execute function priv.guard_prodi_identity();
