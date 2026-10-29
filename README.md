# SIMSA — Sistem Informasi Manajemen Studi Akhir

Aplikasi web untuk mengelola proses Skripsi (S1) dan Tugas Akhir (D3): pengajuan judul, penetapan pembimbing, bimbingan dengan unggah draf, Milestone Tracker per jenjang, Pedoman digital, notifikasi, dan dashboard untuk enam peran.

Repositori ini berisi **MVP Fase 1** sesuai PRD v0.1.

| Folder | Isi |
| --- | --- |
| `web/` | Frontend Vite + React + TypeScript |
| `server/` | Service Node.js (Express): API admin (buat/impor/nonaktifkan akun). Tempat integrasi DeepSeek dan Mendeley di Fase 2 |
| `supabase/migrations/` | Skema Postgres, fungsi alur kerja, Row Level Security, Storage, template milestone |
| `supabase/seed.sql` | Data contoh: prodi TI (S1), SI (S1), MI (D3), tahun akademik, pedoman contoh |

## Menjalankan pertama kali

Butuh **Node.js 20+** dan proyek **Supabase** (cloud).

### 1. Siapkan database Supabase

Di Supabase Dashboard buka **SQL Editor**, lalu jalankan berkas berikut **berurutan** (salin isi, tempel, Run):

1. `supabase/migrations/20261028000100_schema.sql`
2. `supabase/migrations/20261028000200_functions.sql`
3. `supabase/migrations/20261028000300_rls.sql`
4. `supabase/migrations/20261028000400_storage.sql`
5. `supabase/migrations/20261028000500_default_templates.sql`
6. `supabase/migrations/20261028000600_alur_stikom.sql` (alur STIKOM Yos Sudarso: pendaftaran, ploting, ACC per bab, modul ujian)
7. `supabase/migrations/20261028000700_naskah.sql` (naskah daring: editor, versi, gambar naskah)
8. `supabase/migrations/20261028000800_review_bab.sql` (pengajuan bab, review dosen, komentar, Track Changes)
9. `supabase/migrations/20261028000900_review_dua_pembimbing.sql` (review oleh dua pembimbing secara paralel, kirim komentar tanpa keputusan)
10. `supabase/migrations/20261028001000_pustaka.sql` (pustaka rujukan naskah untuk sitasi dan daftar pustaka otomatis)
11. `supabase/migrations/20261028001100_aisys.sql` (catatan pemakaian AISYS, hanya dapat dibaca Admin)
12. `supabase/migrations/20261028001200_kinerja.sql` (indeks dan aturan RLS yang lebih cepat; aman dijalankan ulang)
13. `supabase/migrations/20261028001300_kunci_fase_judul.sql` (kunci bab setelah ACC, fase milestone, usulan perubahan judul, tautan sesi ke pengajuan bab, fitur AISYS baru)
14. `supabase/migrations/20261029001400_daftar_akun.sql` (pendaftaran akun mahasiswa dan verifikasi Admin)
15. `supabase/seed.sql` (opsional, data contoh; ganti dengan prodi asli Anda)

Atau jalankan satu berkas `supabase/setup_lengkap.sql` (gabungan semua di atas) pada proyek kosong.

Proyek yang sudah menjalankan migrasi sebelumnya cukup menjalankan migrasi yang belum dijalankan, berurutan (mis. hanya **0700**). Mahasiswa uji yang sudah ada tetap memakai milestone alur lama; hapus data uji dengan `supabase/reset_data_uji.sql` (akun pengguna tidak terhapus) lalu daftarkan ulang.

Jika memakai Supabase CLI: `supabase link --project-ref <ref>` lalu `supabase db push`.

Pastikan **Authentication > Providers > Email** aktif. Untuk produksi, matikan pendaftaran publik (**Allow new users to sign up**) karena akun dibuat oleh Admin.

### 2. Isi variabel lingkungan

```bash
cp server/.env.example server/.env   # isi SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY
cp web/.env.example web/.env         # isi VITE_SUPABASE_URL dan VITE_SUPABASE_ANON_KEY
```

Nilainya ada di **Project Settings > API**. Service role key hanya untuk `server/.env`, jangan pernah ditaruh di `web/`.

### 3. Pasang paket dan buat Admin pertama

```bash
npm install
npm run install:all
npm --prefix server run create-admin -- admin@kampus.ac.id "KataSandiKuat123" "Nama Admin"
```

Opsional, untuk mencoba semua peran sekaligus (butuh `seed.sql`):

```bash
npm --prefix server run seed-demo
```

Perintah ini membuat 12 akun `@demo.simsa.id` (admin, pimpinan, baak, kaprodi.ti, kaprodi.mi, dosen1–3, mhs1–4) dengan kata sandi `SimsaDemo2026`. Jangan jalankan di database produksi.

### 4. Jalankan

```bash
npm run dev
```

Frontend di http://localhost:5173, server di http://localhost:3001 (Vite meneruskan `/api` ke server).

## Produksi

```bash
npm run build      # membangun web/dist
npm start          # server Node.js menyajikan API dan web/dist pada satu port
```

Frontend juga dapat dihosting terpisah (Vercel/Netlify). Dalam hal itu isi `VITE_API_URL` dengan alamat server dan `CORS_ORIGIN` di server dengan alamat frontend. Atur **Authentication > URL Configuration > Site URL** ke alamat frontend agar tautan atur ulang kata sandi benar.

## Alur dan aturan yang dijalankan database

Perubahan status penting hanya terjadi lewat fungsi RPC di database, bukan klaim dari UI:

| Aksi | Fungsi | Siapa |
| --- | --- | --- |
| Pendaftaran TA (judul sementara + sinopsis) | `daftar_ta` | Mahasiswa |
| Terima pendaftaran + tetapkan P1 dan P2 | `terima_pendaftaran` (minta perbaikan / tolak: `putuskan_judul`) | Ka. Prodi |
| Ubah judul selama bimbingan | `ubah_judul` (alasan wajib, tercatat di riwayat judul) | Mahasiswa / pembimbing / Ka. Prodi |
| Ploting pembimbing dan penguji | `tetapkan_pembimbing`, `tetapkan_penguji` (seminar: 1 penguji; pendadaran: 2 penguji di luar pembimbing + wakil P1/P2) | Ka. Prodi |
| Bimbingan + draf | `catat_dokumen`, `ajukan_bimbingan`, `tanggapi_bimbingan`, `catat_bimbingan` | Mahasiswa / dosen |
| ACC bab | `acc_bab` atau hasil sesi *ACC bab ini dari saya*; bab selesai setelah P1 **dan** P2 ACC, masing-masing dengan kode verifikasi | Pembimbing |
| Daftar ujian | `daftar_ujian` (semua tahap sebelumnya harus selesai) | Mahasiswa |
| Jadwal ujian | `jadwalkan_ujian` (panel otomatis dari ploting, cek bentrok jadwal ruang/dosen) | Ka. Prodi / BAAK |
| Nilai ujian | `nilai_ujian` (skor 40–100 per komponen form penilaian; nilai dosen = rata-rata berbobot) | Setiap dosen panel |
| Putuskan hasil | `putuskan_ujian`: nilai akhir = rata-rata nilai panel, huruf dari tabel konversi; Lulus revisi minor / mayor / Mengulang | Ketua sidang / Ka. Prodi |
| Revisi ujian | `tandai_revisi` (mahasiswa), `acc_revisi` (setiap dosen panel; selesai saat semua ACC, terbit kode BA revisi) | Mahasiswa / panel |
| Berkas, yudisium, SK | `selesaikan_milestone` (sementara manual; tahap berkas yang dapat diatur menyusul) | BAAK / Pimpinan |
| Ubah tenggat | `ubah_tenggat_milestone` (alasan wajib) | Pembimbing / Ka. Prodi |

Alur S1: Pendaftaran, Pembimbing, Bab 1–3, Seminar Proposal (P1, P2, Penguji), Revisi, Bab 4–5, Seminar Hasil (panel sama), Revisi, Berkas pendadaran, Pendadaran (2 penguji + wakil pembimbing, tanpa revisi), Berkas yudisium, Yudisium, SK Ketua. Alur D3: Pendaftaran, Pembimbing, Bab 1–5, Seminar Tertutup dan Komprehensif (dinilai P1 dan P2), Berkas yudisium, Yudisium, SK. Ujian yang hasilnya *Mengulang* dapat didaftarkan lagi sebagai percobaan berikutnya.

Form penilaian per jenis ujian dan tabel konversi huruf diatur Admin di Master data.

### Naskah daring

Menu **Naskah** (mahasiswa) dan menu konteks **Naskah** saat dosen membuka mahasiswa. Satu dokumen utuh dibagi per bab, dengan kerangka awal sesuai jenjang (S1/D3).

- Penomoran BAB (romawi), subbab, sub-subbab, serta keterangan Gambar/Tabel per bab dibuat otomatis.
- Simpan otomatis lewat `simpan_naskah` dengan deteksi bentrok bila naskah dibuka di dua tab atau perangkat.
- **Simpan versi** (`buat_versi_naskah`) membuat potret yang dapat dibuka kembali di Riwayat versi.
- **Unduh DOCX** memformat naskah sesuai pedoman: A4, margin 4-3-3-3 cm, Times New Roman 12, spasi 1,5, inden 1,25 cm, BAB di halaman baru, sampul berlogo, daftar isi (diperbarui otomatis saat dibuka di Word), dan nomor halaman.
- **Cetak atau PDF** memakai dialog cetak browser dengan tata letak halaman yang sama.
- Gambar naskah disimpan di bucket privat `naskah`. Mahasiswa yang menjaga format sendiri tetap dapat mengunggah file Word di tab Draf.
- Dosen dan pihak lain hanya dapat membaca isi naskah.
- **Impor dari Word** (.docx) untuk seluruh naskah, satu bab, atau bab baru: judul bab (pola "BAB I", style Heading), subbab "1.1", daftar, tabel, gambar, dan keterangan dibawa; sampul dan halaman awal dapat diabaikan.

### Sitasi dan daftar pustaka

Tombol **Sitasi** di toolbar dan panel **Pustaka** di editor naskah. Rujukan disimpan per studi akhir dalam format CSL-JSON (tabel `thesis_references`), dan gaya sitasi mengikuti isian *Gaya sitasi* pada pedoman aktif prodi (mengandung "IEEE" berarti IEEE, selain itu APA 7).

- Tambah rujukan lewat **DOI** (metadata dari Crossref, cadangan doi.org), **Cari judul** (pencarian Crossref), **Impor BibTeX/RIS** (ekspor Mendeley, Zotero, Google Scholar), atau **Isi manual**. DOI yang sama tidak dapat masuk dua kali.
- Sitasi disisipkan sebagai elemen tersendiri: satu atau beberapa rujukan, nomor halaman untuk kutipan langsung, dan bentuk naratif APA (Lestari et al. (2024)). Klik sitasi untuk mengubah atau menghapusnya.
- Teks sitasi dan daftar pustaka dihitung ulang otomatis: urutan nomor IEEE mengikuti kemunculan pertama, pembeda tahun APA (2024a, 2024b) dibuat sendiri. Daftar pustaka disisipkan di bawah judul DAFTAR PUSTAKA (naskah baru sudah memuatnya).
- Panel Pustaka menampilkan jumlah rujukan, persentase terbitan 10 tahun terakhir dan jurnal, serta rujukan yang belum dikutip, tanpa tahun, tanpa penulis, ganda, atau sitasi yang rujukannya sudah dihapus.
- Ekspor DOCX dan cetak memuat teks sitasi dan daftar pustaka dengan inden gantung. Dosen melihat sitasi yang sama pada halaman review bab.
- Hanya mahasiswa pemilik yang dapat mengubah pustaka; pembimbing dan pihak lain yang berhak melihat studi akhir dapat membaca.

### Tampilan dan kecepatan

- **Simpanan data** (TanStack Query): halaman yang pernah dibuka tampil langsung dari simpanan lalu diperbarui di latar. Simpanan dikosongkan saat keluar.
- **Kode per halaman**: setiap halaman dimuat saat dibutuhkan; halaman menu dimuat lebih awal saat peramban senggang dan saat kursor berada di atas menu.
- **Skeleton** sesuai bentuk konten (tabel, kartu, detail, editor), muncul bila pemuatan lebih dari 150 ms.
- **Menu sidebar** muncul satu per satu sekali saat aplikasi dibuka; nonaktif bila sistem meminta gerakan dikurangi.
- **Ruang kerja naskah**: lebar penuh, sidebar menjadi ikon (melebar saat diarahkan kursor), mode fokus (Esc untuk keluar), kepala satu baris dengan menu Berkas, struktur dapat dilipat, tampilan Halaman A4 atau Lebar penuh, panel Catatan/Pustaka/AISYS bertab yang lebarnya dapat ditarik.
- **Daftar dan detail berdampingan** di layar lebar (Bimbingan), bilah filter menempel, kolom pertama tabel menempel di layar sempit, dan pilihan **Kerapatan** (Nyaman/Rapat) di Profil.
- Database proyek saat ini berada di eu-west-1 (Irlandia). Untuk pengguna di Indonesia, memindahkan proyek ke Singapura (ap-southeast-1) akan memangkas waktu tunggu tiap permintaan secara nyata.

### AISYS (Akal Imitasi STIKOM Yos Sudarso)

Asisten AI yang dipanggil lewat server Node.js (`/api/aisys/*`), memakai endpoint kompatibel OpenAI (SumoPod). Kunci API hanya ada di server.

Di editor naskah, panel AISYS berisi menu fitur per kelompok. Instruksi sistem membuat AISYS berperan sebagai peneliti senior: teliti dan jujur secara ilmiah, tidak mengarang data, angka, kutipan, atau rujukan (kekurangan ditandai [perlu rujukan] / [perlu data: ...]), dan tidak menuliskan bab utuh untuk mahasiswa. Kutipan yang dikembalikan AISYS selalu dicocokkan dengan teks naskah di server; yang tidak ditemukan dibuang.

| Kelompok | Fitur | Hasil dan tindakan |
| --- | --- | --- |
| Menulis | Parafrase dan kembangkan | Dua varian parafrase (akademik, ringkas, sederhana); poin menjadi paragraf sesuai konteks bab |
| | Kerangka subbab | Subbab sesuai pedoman prodi dan judul, dengan panduan isi; judul subbab yang dipilih disisipkan di akhir bab |
| | Draf abstrak | Abstrak Indonesia dan Inggris dari seluruh naskah beserta kata kunci; bagian yang belum ada ditandai; dapat disisipkan di awal naskah |
| Memeriksa | Periksa bab | Temuan kelengkapan, logika, dan bahasa terhadap pedoman prodi |
| | Ejaan dan kalimat efektif | Koreksi EYD V, tanda baca, kata baku, kalimat efektif per bagian bab; terapkan satu per satu atau sekaligus (bagian bersitasi tidak diubah otomatis) |
| | Keselarasan antarbab | Matriks rumusan masalah ke tujuan, metode, hasil, dan kesimpulan, plus temuan antarbab |
| | Tanggapi catatan dosen | Maksud catatan, langkah perbaikan, contoh revisi bila relevan, dan draf balasan yang dapat dikirim |
| Rujukan | Cari jurnal | Kata kunci dari AISYS, literatur dari Crossref (DOI nyata), alasan relevansi; tambah ke pustaka |
| | Cocokkan rujukan | Klaim tanpa sitasi dicocokkan dengan pustaka; sisipkan sitasi di akhir kalimat atau lanjut Cari jurnal |
| | Tabel penelitian terdahulu | Metode, hasil, dan perbedaan dari abstrak rujukan terpilih (abstrak diambil dari Crossref bila belum tersimpan); disisipkan sebagai tabel bersitasi |
| Ujian | Persiapan seminar | Perkiraan pertanyaan penguji dengan poin jawaban dari naskah dan kerangka slide; unduh sebagai teks |
| Dosen | Review bab | Di halaman review bab: usulan catatan yang dapat dijadikan komentar atas nama dosen |

- Setiap pemakaian dicatat di `ai_usage_logs` (pengguna, fitur, token, durasi, status, cuplikan pendek masukan). Isi naskah dan jawaban AISYS tidak disimpan. Catatan ini hanya dapat dibaca Admin di menu **Log AISYS**.
- Batas pemakaian per pengguna per hari (WIB) diatur dengan `AISYS_LIMIT_HARIAN` (bawaan 40; 0 berarti tanpa batas).
- Variabel server: `AI_BASE_URL` (bawaan `https://ai.sumopod.com/v1`), `AI_API_KEY`, `AI_MODEL` (bawaan `deepseek-v4-flash`), `AISYS_LIMIT_HARIAN`. Di Vercel tambahkan di project server (`AI_API_KEY` sebagai Secret). `/api/health` menampilkan `aisys.aktif`.
- Periksa bab dapat memakan waktu 10 sampai 40 detik. Bila di Vercel muncul galat batas waktu, naikkan **Settings > Functions > Max Duration** project server (mis. 60 detik).

### Pendaftaran akun mahasiswa

- Halaman masuk memiliki tab **Daftar akun**. Calon mahasiswa mengisi nama, NIM, prodi, email, nomor HP, dan kata sandi; angkatan dibaca dari 4 digit pertama NIM.
- Akun dibuat oleh server (`POST /api/daftar`) dengan API admin Supabase, sehingga tidak memerlukan konfirmasi email. Pengaturan Supabase **Authentication > Sign In / Providers > Allow new users to sign up** sebaiknya dimatikan agar pendaftaran hanya lewat SIMSA. Pendaftaran dari satu jaringan dibatasi 5 per jam.
- Akun baru dapat masuk tetapi belum memiliki peran, sehingga hanya melihat halaman status "menunggu verifikasi". Data pendaftaran disimpan di `account_requests` dan baru disalin ke profil saat disetujui.
- Admin memeriksa antrean di menu **Verifikasi akun** (jumlah antrean tampil di sidebar), lengkap dengan peringatan NIM sudah terdaftar, NIM ganda, email serupa, nama mirip, dan angkatan yang tidak terbaca. Setujui (satu atau beberapa sekaligus) memberi peran Mahasiswa; Tolak wajib disertai alasan. Pendaftar yang ditolak dapat memperbaiki data dan mengajukan ulang.
- Admin dapat **menghapus** akun yang belum memiliki data studi akhir atau bimbingan (menu Verifikasi akun dan Pengguna). Akun yang sudah memiliki data cukup dinonaktifkan.

### Kunci bab, fase, dan perubahan judul

- **Kunci bab.** Naskah tetap satu dokumen. Setelah Pembimbing 1 dan 2 sama-sama ACC sebuah bab, bab itu terkunci untuk mahasiswa: editor menolak suntingan di bab tersebut dan `simpan_naskah` menolak perubahan isinya (perubahan tampilan seperti perataan tetap boleh). Pembimbing yang sudah ACC tidak dapat menambah komentar pada bab itu. Kunci terbuka otomatis selama milestone Revisi Seminar Proposal / Revisi Seminar Hasil berjalan, lalu terkunci kembali. Status per bab: `status_kunci_bab`.
- **Fase milestone.** Kolom `fase` pada template dan milestone (S1: Persiapan, Proposal, Hasil penelitian, Pendadaran, Kelulusan; D3: Persiapan, Penulisan, Ujian, Kelulusan). Halaman studi akhir menampilkan penanda fase; fase berjalan terbuka, fase lain terlipat. Fase dapat diubah di editor template.
- **Perubahan judul.** Sebelum seminar pertama selesai, mahasiswa mengubah judul langsung (`ubah_judul`). Setelahnya, judul diubah lewat usulan (`usul_judul`) yang berlaku setelah Pembimbing 1 dan 2 menyetujui (`tanggapi_usul_judul`). Penguji dapat menandai "Perlu perubahan judul" beserta arahan (`arahan_judul_ujian`); ACC revisi terakhir tertahan sampai judul baru disetujui.
- **Ajukan bab dan Ajukan bimbingan.** Ajukan bab (di Naskah) adalah jalur review isi. Ajukan bimbingan adalah pertemuan yang dihitung sebagai kehadiran, dengan tautan ke pengajuan bab yang dibahas (`tautkan_pengajuan_sesi`); unggahan berkas draf tetap tersedia sebagai cadangan.

### Review per bab

| Aksi | Fungsi | Siapa |
| --- | --- | --- |
| Ajukan bab (isi bab dibekukan, versi naskah disimpan) | `ajukan_bab`, `tarik_pengajuan_bab` | Mahasiswa |
| Sorot teks dan beri komentar (draf sampai keputusan dikirim) | `komentar_naskah`, `ubah_komentar`, `hapus_komentar` | Pembimbing (dan penguji) |
| Kirim komentar tanpa keputusan | `kirim_komentar` | Pembimbing |
| Keputusan Revisi atau ACC (ACC tercatat di ACC bab dengan kode verifikasi). Pengajuan tetap terbuka sampai kedua pembimbing merespons, atau mahasiswa mengajukan perbaikan setelah ada permintaan revisi | `tinjau_bab` | Pembimbing 1 / 2 |
| Balas komentar, tandai sudah diperbaiki / selesaikan | `balas_komentar`, `tandai_komentar` | Mahasiswa / dosen |
| Antrean review | `antrean_review` (menu Review naskah) | Dosen |

Komentar tertambat pada kutipan teks, sehingga tetap menempel di naskah yang direvisi. Halaman review menampilkan Track Changes per kata antara pengajuan sebelumnya dan pengajuan baru. ACC dari pembimbing pada pengajuan sebelumnya tetap berlaku; bab selesai setelah Pembimbing 1 dan 2 sama-sama ACC.

Setelah menarik pembaruan ini jalankan `npm install` di folder `web` (paket editor Tiptap, pembuat DOCX, pembaca file Word, dan TanStack Query).

Indikator risiko di `v_thesis_progress`: **kritis** bila lewat tenggat ≥ 30 hari atau tanpa bimbingan ≥ 60 hari; **waspada** bila lewat tenggat ≥ 14 hari, tanpa bimbingan ≥ 30 hari, atau tenggat ≤ 7 hari lagi. Ambang dapat diubah per prodi di menu Pengaturan prodi. Skor EWS lengkap ada di Fase 2.

RLS: mahasiswa hanya melihat datanya; dosen hanya mahasiswa bimbingannya; Ka. Prodi dan BAAK sebatas prodinya (BAAK tanpa prodi = semua); Pimpinan baca saja; audit log hanya Admin.

## Impor CSV

Menu Pengguna > Impor CSV. Template dapat diunduh dari dialog impor.

- Mahasiswa: `email,nama,nim,prodi_kode,angkatan,telepon,password`
- Dosen: `email,nama,nidn,prodi_kode,bidang_keahlian,kuota_bimbingan,telepon,password` (bidang dipisah `|`)

Kolom `password` boleh kosong; kata sandi awal dibuat otomatis dan tercantum di berkas hasil impor.

## Belum termasuk (fase berikutnya)

- **Fase 2:** EWS (skor harian, eskalasi, catatan intervensi), integrasi Mendeley dan Pustaka TA, asisten AI DeepSeek, notifikasi email, ekspor Kartu Bimbingan PDF.
- **Gelombang 3 alur kampus:** tahap berkas pendadaran dan yudisium yang dapat diatur Admin dengan verifikasi BAAK, dasbor rapat yudisium, pembuatan SK Ketua, dokumen PDF (berita acara, lembar nilai, BA revisi, SK, Kartu Bimbingan) berlogo dengan kode verifikasi.
- **Fase 4:** integrasi SIAKAD, WhatsApp, analitik lanjutan.
