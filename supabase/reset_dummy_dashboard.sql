-- =====================================================================
-- SIMSA — RESET & HAPUS AKUN DEMO DASHBOARD TRIAL
-- =====================================================================
-- Berkas ini menghapus seluruh data uji coba yang dihasilkan oleh
-- seed_dummy_dashboard.sql, TERMASUK:
-- 1. 88 Akun Mahasiswa Demo (@demo.simsa.id)
-- 2. Seluruh transaksi studi akhir (thesis), judul, milestone, dan
--    sesi bimbingan milik akun demo tersebut.
-- 3. Akun Staf/Dosen Demo khusus trial:
--    - pimpinan@stikomyos.ac.id
--    - baak@stikomyos.ac.id
--    - kaprodi.inf@stikomyos.ac.id, dosen.inf1, dosen.inf2
--    - dosen.sif1, dosen.sif2
--    - kaprodi.dkv@stikomyos.ac.id, dosen.dkv1
--    - kaprodi.ka@stikomyos.ac.id, dosen.ka1
--
-- AKUN ASLI YANG AMAN & TIDAK AKAN DIHAPUS:
-- - Akun Admin (admin@stikomyos.ac.id)
-- - Akun Asli Dosen / Ka. Prodi SIF (dhany.faizal@stikomyos.ac.id)
-- - Akun AISYS (aisys@stikomyos.ac.id)
-- - Seluruh akun mahasiswa / dosen asli kampus yang sudah terdaftar sebelumnya.
-- =====================================================================

begin;

-- 1. Kumpulkan ID akun demo yang ditargetkan untuk dihapus
create temp table temp_demo_users on commit drop as
select id, email from auth.users
where email like '%@demo.simsa.id'
   or email in (
     'pimpinan@stikomyos.ac.id',
     'baak@stikomyos.ac.id',
     'kaprodi.inf@stikomyos.ac.id',
     'dosen.inf1@stikomyos.ac.id',
     'dosen.inf2@stikomyos.ac.id',
     'dosen.sif1@stikomyos.ac.id',
     'dosen.sif2@stikomyos.ac.id',
     'kaprodi.dkv@stikomyos.ac.id',
     'dosen.dkv1@stikomyos.ac.id',
     'kaprodi.ka@stikomyos.ac.id',
     'dosen.ka1@stikomyos.ac.id'
   );

-- 2. Kumpulkan ID thesis yang berhubungan dengan mahasiswa demo
create temp table temp_demo_theses on commit drop as
select id from public.thesis
where mahasiswa_id in (select id from temp_demo_users);

-- 3. Hapus data transaksi turunan studi akhir demo
do $$ begin if to_regclass('public.review_comments') is not null then delete from public.review_comments where chapter_review_id in (select id from public.chapter_reviews where chapter_submission_id in (select id from public.chapter_submissions where thesis_id in (select id from temp_demo_theses))); end if; end $$;
do $$ begin if to_regclass('public.chapter_reviews') is not null then delete from public.chapter_reviews where chapter_submission_id in (select id from public.chapter_submissions where thesis_id in (select id from temp_demo_theses)); end if; end $$;
do $$ begin if to_regclass('public.chapter_submissions') is not null then delete from public.chapter_submissions where thesis_id in (select id from temp_demo_theses); end if; end $$;
do $$ begin if to_regclass('public.manuscript_versions') is not null then delete from public.manuscript_versions where thesis_id in (select id from temp_demo_theses); end if; end $$;
do $$ begin if to_regclass('public.thesis_manuscripts') is not null then delete from public.thesis_manuscripts where thesis_id in (select id from temp_demo_theses); end if; end $$;

delete from public.comments where thesis_id in (select id from temp_demo_theses);
delete from public.guidance_sessions where thesis_id in (select id from temp_demo_theses);
delete from public.thesis_supervisors where thesis_id in (select id from temp_demo_theses);
delete from public.milestone_history where thesis_id in (select id from temp_demo_theses);
delete from public.thesis_milestones where thesis_id in (select id from temp_demo_theses);
delete from public.title_submissions where mahasiswa_id in (select id from temp_demo_users);
delete from public.thesis where id in (select id from temp_demo_theses);

-- 4. Lepas rujukan pembimbing/dosen demo jika ada sesi/ploting yang mengarah ke dosen demo
delete from public.thesis_supervisors where dosen_id in (select id from temp_demo_users);
delete from public.guidance_sessions where dosen_id in (select id from temp_demo_users);

-- 5. Hapus peran dan notifikasi milik akun demo
delete from public.user_roles where user_id in (select id from temp_demo_users);
delete from public.notifications where user_id in (select id from temp_demo_users);

-- 6. Hapus akun dari auth.users (otomatis cascade ke public.profiles)
delete from auth.users where id in (select id from temp_demo_users);

commit;

-- =====================================================================
-- CEK SISA DATA SETELAH RESET
-- =====================================================================
select 'Pengguna Terdaftar' as entitas, count(*)::text as jumlah from auth.users
union all
select 'Studi Akhir (Thesis)', count(*)::text from public.thesis
union all
select 'Pendaftaran Judul', count(*)::text from public.title_submissions
union all
select 'Sesi Bimbingan', count(*)::text from public.guidance_sessions;
