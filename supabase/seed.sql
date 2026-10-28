-- =====================================================================
-- SIMSA — Data contoh (opsional). Jalankan setelah semua migrasi.
-- Ganti nama prodi dan isi pedoman dengan data resmi institusi Anda.
-- =====================================================================

insert into public.prodi (kode, nama, jenjang, fakultas, min_bimbingan) values
  ('TI', 'Teknik Informatika', 'S1', 'Fakultas Teknik', 8),
  ('SI', 'Sistem Informasi', 'S1', 'Fakultas Teknik', 8),
  ('MI', 'Manajemen Informatika', 'D3', 'Fakultas Vokasi', 6)
on conflict (kode) do nothing;

insert into public.academic_years (nama, mulai, selesai, aktif) values
  ('2026/2027 Ganjil', '2026-09-01', '2027-02-28', true)
on conflict (nama) do nothing;

-- Pedoman contoh untuk setiap prodi (berlabel CONTOH agar mudah dikenali)
do $$
declare
  r record;
  g uuid;
  b1 uuid; b2 uuid;
begin
  for r in select * from public.prodi loop
    if exists (select 1 from public.guidelines where prodi_id = r.id) then continue; end if;

    insert into public.guidelines (prodi_id, academic_year_id, judul, versi, gaya_sitasi)
    values (r.id, (select id from public.academic_years where aktif limit 1),
            'CONTOH — Pedoman Penulisan ' || case when r.jenjang = 'S1' then 'Skripsi ' else 'Tugas Akhir ' end || r.nama,
            '2026.1', 'APA 7')
    returning id into g;

    insert into public.guideline_sections (guideline_id, urutan, nomor, judul, kategori, isi) values
      (g, 1, '1', 'Ketentuan Umum', 'umum',
       'Dokumen ini adalah contoh struktur pedoman di SIMSA. Ka. Prodi dapat mengganti setiap bagian dengan isi pedoman resmi.' || chr(10) || chr(10) ||
       'Naskah ditulis dalam Bahasa Indonesia baku sesuai PUEBI/EYD. Istilah asing dicetak miring.');

    insert into public.guideline_sections (guideline_id, urutan, nomor, judul, kategori, isi)
    values (g, 2, '2', 'Sistematika Penulisan', 'sistematika',
            'Struktur bab berikut menjadi acuan milestone dan pemeriksaan naskah.')
    returning id into b1;

    if r.jenjang = 'S1' then
      insert into public.guideline_sections (guideline_id, parent_id, urutan, nomor, judul, kategori, isi) values
        (g, b1, 1, '2.1', 'Bab 1 Pendahuluan', 'sistematika',
         'Memuat latar belakang, rumusan masalah, batasan masalah, tujuan penelitian, manfaat penelitian, dan sistematika penulisan.'),
        (g, b1, 2, '2.2', 'Bab 2 Tinjauan Pustaka', 'sistematika',
         'Memuat penelitian terdahulu (minimal 10 sumber, mayoritas terbitan 5–10 tahun terakhir) dan landasan teori yang relevan dengan rumusan masalah.'),
        (g, b1, 3, '2.3', 'Bab 3 Metodologi Penelitian', 'sistematika',
         'Memuat objek penelitian, jenis dan sumber data, teknik pengumpulan data, metode analisis atau pengembangan, serta alur penelitian.'),
        (g, b1, 4, '2.4', 'Bab 4 Hasil dan Pembahasan', 'sistematika',
         'Menyajikan hasil penelitian secara sistematis dan membahasnya dengan mengaitkan pada teori dan penelitian terdahulu.'),
        (g, b1, 5, '2.5', 'Bab 5 Kesimpulan dan Saran', 'sistematika',
         'Kesimpulan menjawab setiap rumusan masalah. Saran ditujukan untuk penelitian selanjutnya dan pihak terkait.');
    else
      insert into public.guideline_sections (guideline_id, parent_id, urutan, nomor, judul, kategori, isi) values
        (g, b1, 1, '2.1', 'Bab 1 Pendahuluan', 'sistematika',
         'Memuat latar belakang, rumusan masalah, batasan, tujuan, dan manfaat Tugas Akhir.'),
        (g, b1, 2, '2.2', 'Bab 2 Landasan Teori', 'sistematika',
         'Memuat teori, perangkat, dan teknologi yang digunakan dalam pelaksanaan Tugas Akhir.'),
        (g, b1, 3, '2.3', 'Bab 3 Analisis dan Perancangan', 'sistematika',
         'Memuat analisis kebutuhan dan rancangan sistem/produk yang dikerjakan.'),
        (g, b1, 4, '2.4', 'Bab 4 Implementasi dan Pengujian', 'sistematika',
         'Memuat hasil implementasi dan pengujian beserta pembahasannya.'),
        (g, b1, 5, '2.5', 'Bab 5 Penutup', 'sistematika',
         'Memuat kesimpulan dan saran.');
    end if;

    insert into public.guideline_sections (guideline_id, urutan, nomor, judul, kategori, isi)
    values (g, 3, '3', 'Aturan Penulisan', 'aturan', 'Ketentuan teknis penulisan naskah.')
    returning id into b2;

    insert into public.guideline_sections (guideline_id, parent_id, urutan, nomor, judul, kategori, isi) values
      (g, b2, 1, '3.1', 'Kertas dan Margin', 'aturan',
       'Kertas HVS A4 80 gram. Margin kiri 4 cm, atas 3 cm, kanan 3 cm, bawah 3 cm.'),
      (g, b2, 2, '3.2', 'Huruf dan Spasi', 'aturan',
       'Times New Roman 12 pt, spasi 1,5. Judul bab 14 pt tebal, huruf kapital, rata tengah.'),
      (g, b2, 3, '3.3', 'Penomoran', 'aturan',
       'Bagian awal memakai angka Romawi kecil (i, ii, iii). Bagian inti memakai angka Arab (1, 2, 3) di kanan bawah.'),
      (g, b2, 4, '3.4', 'Sitasi dan Daftar Pustaka', 'aturan',
       'Menggunakan gaya APA edisi 7. Setiap sumber yang dikutip wajib tercantum di daftar pustaka dan sebaliknya.');

    insert into public.guideline_sections (guideline_id, urutan, nomor, judul, kategori, isi) values
      (g, 4, '4', 'Rubrik Pemeriksaan Bab 1', 'rubrik',
       '- Latar belakang menunjukkan masalah nyata dengan data pendukung' || chr(10) ||
       '- Rumusan masalah berbentuk pertanyaan yang dapat dijawab' || chr(10) ||
       '- Tujuan selaras dengan setiap rumusan masalah' || chr(10) ||
       '- Batasan masalah jelas dan realistis');
  end loop;
end;
$$;
