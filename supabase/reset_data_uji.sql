-- =====================================================================
-- SIMSA: hapus data uji coba studi akhir (akun pengguna TETAP ada)
-- Jalankan di Supabase SQL Editor setelah migrasi 0600 bila mahasiswa uji
-- masih memakai milestone alur lama. Yang dihapus: pendaftaran/judul,
-- studi akhir dan seluruh milestone, bimbingan, draf, ujian, nilai, revisi,
-- notifikasi, dan riwayat. Yang tetap: pengguna, peran, prodi, tahun
-- akademik, pedoman, template milestone, form penilaian, konversi nilai.
-- File di Storage (drafts, pendaftaran, naskah) tidak ikut terhapus; kosongkan
-- lewat menu Storage bila perlu.
-- =====================================================================
begin;

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

commit;
