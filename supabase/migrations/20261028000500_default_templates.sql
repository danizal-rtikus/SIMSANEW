-- =====================================================================
-- SIMSA — Migrasi 5: template milestone default institusi (PRD 10.1)
-- prodi_id = null berarti berlaku untuk semua prodi pada jenjang itu,
-- kecuali prodi membuat template sendiri.
-- Bobot total tiap jenjang = 100. Durasi dalam hari.
-- =====================================================================

insert into public.milestone_templates (prodi_id, jenjang, urutan, kode, nama, bukti, jenis, bobot, durasi_hari) values
  (null, 'S1',  1, 'JUDUL',      'Judul disetujui',               'Persetujuan Ka. Prodi', 'judul', 2, 14),
  (null, 'S1',  2, 'PEMBIMBING', 'Pembimbing ditetapkan',         'SK/penetapan', 'pembimbing', 2, 14),
  (null, 'S1',  3, 'BAB1',       'Bab 1 Pendahuluan',             'Persetujuan pembimbing', 'pembimbing_setuju', 8, 30),
  (null, 'S1',  4, 'BAB2',       'Bab 2 Tinjauan Pustaka',        'Persetujuan pembimbing', 'pembimbing_setuju', 8, 30),
  (null, 'S1',  5, 'BAB3',       'Bab 3 Metodologi',              'Persetujuan pembimbing', 'pembimbing_setuju', 8, 30),
  (null, 'S1',  6, 'SEMPRO',     'Seminar Proposal',              'Berita acara, status lulus', 'seminar', 10, 14),
  (null, 'S1',  7, 'DATA',       'Pengumpulan dan Analisis Data', 'Persetujuan pembimbing', 'pembimbing_setuju', 10, 45),
  (null, 'S1',  8, 'BAB4',       'Bab 4 Hasil dan Pembahasan',    'Persetujuan pembimbing', 'pembimbing_setuju', 12, 30),
  (null, 'S1',  9, 'BAB5',       'Bab 5 Kesimpulan',              'Persetujuan pembimbing', 'pembimbing_setuju', 6, 14),
  (null, 'S1', 10, 'SEMHAS',     'Seminar Hasil',                 'Berita acara, status lulus', 'seminar', 10, 14),
  (null, 'S1', 11, 'SIAP_PENDADARAN', 'Siap Pendadaran',          'Syarat otomatis terpenuhi (bimbingan minimum, persetujuan pembimbing, berkas administrasi)', 'syarat_otomatis', 2, 7),
  (null, 'S1', 12, 'PENDADARAN', 'Pendadaran',                    'Berita acara, nilai', 'seminar', 12, 14),
  (null, 'S1', 13, 'REVISI',     'Revisi Pasca Pendadaran',       'Persetujuan penguji', 'penguji_setuju', 6, 30),
  (null, 'S1', 14, 'ARSIP',      'Naskah Final Diarsipkan',       'Unggahan final dan lembar pengesahan', 'arsip', 4, 14),

  (null, 'D3',  1, 'JUDUL',      'Judul Tugas Akhir disetujui',   'Persetujuan Ka. Prodi', 'judul', 2, 14),
  (null, 'D3',  2, 'PEMBIMBING', 'Pembimbing ditetapkan',         'SK/penetapan', 'pembimbing', 2, 14),
  (null, 'D3',  3, 'BAB_AWAL',   'Penyusunan bab awal',           'Persetujuan pembimbing (struktur sesuai Pedoman D3)', 'pembimbing_setuju', 15, 30),
  (null, 'D3',  4, 'PELAKSANAAN','Pelaksanaan Tugas Akhir',       'Persetujuan pembimbing (perancangan, implementasi, atau pengumpulan data)', 'pembimbing_setuju', 20, 45),
  (null, 'D3',  5, 'NASKAH',     'Penulisan naskah lengkap',      'Persetujuan pembimbing', 'pembimbing_setuju', 15, 30),
  (null, 'D3',  6, 'SEMTUP',     'Seminar Tertutup Tugas Akhir',  'Berita acara, status lulus', 'seminar', 14, 14),
  (null, 'D3',  7, 'SIAP_KOMPRE','Siap Komprehensif',             'Syarat otomatis terpenuhi (bimbingan minimum, persetujuan pembimbing, berkas administrasi)', 'syarat_otomatis', 2, 7),
  (null, 'D3',  8, 'KOMPRE',     'Komprehensif',                  'Berita acara, nilai', 'seminar', 14, 14),
  (null, 'D3',  9, 'REVISI',     'Revisi Pasca Ujian',            'Persetujuan penguji', 'penguji_setuju', 8, 30),
  (null, 'D3', 10, 'ARSIP',      'Naskah Final Diarsipkan',       'Unggahan final dan lembar pengesahan', 'arsip', 8, 14)
on conflict on constraint milestone_templates_unik do nothing;
