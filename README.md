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
13. `supabase/seed.sql` (opsional, data contoh; ganti dengan prodi asli Anda)

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

| Fitur | Di mana | Siapa |
| --- | --- | --- |
| Parafrase teks terpilih (akademik, ringkas, sederhana), dua varian | Panel AISYS di editor naskah, tab Tulis | Mahasiswa pemilik |
| Kembangkan poin menjadi paragraf, mengikuti konteks bab dan subbab; klaim tanpa sumber ditandai [perlu rujukan] | Tab Tulis | Mahasiswa pemilik |
| Cari jurnal relevan: AISYS menyusun kata kunci, literatur diambil dari Crossref (DOI nyata), AISYS memilih yang relevan beserta alasannya, lalu dapat ditambahkan ke pustaka | Tab Cari jurnal | Mahasiswa pemilik |
| Periksa bab: membandingkan bab tersimpan dengan pedoman prodi dan menunjukkan kekurangan; klik temuan untuk menuju teksnya | Tab Periksa bab | Mahasiswa pemilik |
| Review bab: usulan catatan untuk bab yang diajukan; dosen memilih temuan, menyuntingnya, lalu menjadikannya komentar (draf) atas namanya sendiri | Tombol Periksa dengan AISYS di halaman review bab | Pembimbing dan penguji |

- Setiap pemakaian dicatat di `ai_usage_logs` (pengguna, fitur, token, durasi, status, cuplikan pendek masukan). Isi naskah dan jawaban AISYS tidak disimpan. Catatan ini hanya dapat dibaca Admin di menu **Log AISYS**.
- Batas pemakaian per pengguna per hari (WIB) diatur dengan `AISYS_LIMIT_HARIAN` (bawaan 40; 0 berarti tanpa batas).
- Variabel server: `AI_BASE_URL` (bawaan `https://ai.sumopod.com/v1`), `AI_API_KEY`, `AI_MODEL` (bawaan `deepseek-v4-flash`), `AISYS_LIMIT_HARIAN`. Di Vercel tambahkan di project server (`AI_API_KEY` sebagai Secret). `/api/health` menampilkan `aisys.aktif`.
- Periksa bab dapat memakan waktu 10 sampai 40 detik. Bila di Vercel muncul galat batas waktu, naikkan **Settings > Functions > Max Duration** project server (mis. 60 detik).

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
