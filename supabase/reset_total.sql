-- =====================================================================
-- SIMSA: RESET TOTAL untuk uji coba dari nol
-- Menghapus SEMUA data studi akhir (seperti reset_data_uji.sql), audit log,
-- dan SEMUA akun pengguna KECUALI akun yang berperan Admin.
-- Yang tetap: akun Admin, prodi, tahun akademik, pedoman, template milestone,
-- form penilaian, konversi nilai.
-- PERINGATAN: tidak dapat dibatalkan. Jangan dijalankan di data produksi.
-- File di Storage (drafts, pendaftaran, naskah) tidak ikut terhapus;
-- kosongkan lewat menu Storage bila perlu.
-- =====================================================================
begin;

-- 1. Data studi akhir
do $$ begin if to_regclass('public.thesis_references') is not null then delete from public.thesis_references; end if; end $$;
delete from public.review_comments;
delete from public.chapter_reviews;
delete from public.chapter_submissions;
delete from public.manuscript_versions;
delete from public.thesis_manuscripts;
delete from public.exam_revision_notes;
delete from public.exam_scores;
delete from public.exam_panel;
delete from public.exams;
delete from public.milestone_approvals;
delete from public.thesis_examiners;
delete from public.thesis_title_history;
delete from public.comments;
delete from public.guidance_sessions;
delete from public.documents;
delete from public.milestone_history;
delete from public.thesis_milestones;
delete from public.thesis_supervisors;
delete from public.thesis;
delete from public.title_submissions;
delete from public.notifications;
delete from public.audit_logs;

-- 2. Lepas rujukan pengguna yang akan dihapus dari data yang dipertahankan
update public.guidelines set created_by = null
 where created_by is not null
   and created_by not in (select user_id from public.user_roles where role = 'admin');

-- 3. Hapus akun selain Admin (profil, peran, dan bookmark ikut terhapus)
delete from auth.users
 where id not in (select user_id from public.user_roles where role = 'admin');

-- Audit log berisi catatan penghapusan di atas; kosongkan lagi agar bersih.
delete from public.audit_logs;

commit;

-- Periksa sisa akun
select p.email, p.nama, array_agg(r.role) as peran
  from public.profiles p left join public.user_roles r on r.user_id = p.id
 group by p.email, p.nama;
