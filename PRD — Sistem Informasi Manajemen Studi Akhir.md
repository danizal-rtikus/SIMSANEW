# PRD — SIMSA: Sistem Informasi Manajemen Studi Akhir

*Versi 0.1 (Draft) · 27 Oktober 2026 · Status: untuk direview*

## 1. Ringkasan Produk

Sistem Informasi Manajemen Studi Akhir (selanjutnya disebut **SIMSA**) adalah aplikasi web untuk mengelola seluruh proses Skripsi/Tugas Akhir (TA), mulai dari pengajuan judul, penetapan pembimbing, bimbingan, seminar proposal, sidang, hingga pengarsipan naskah final. Sistem memuat **Pedoman Skripsi/TA** sebagai rujukan penulisan dan sistematika, **Milestone Tracker** untuk memantau progres mahasiswa secara real-time, **integrasi Mendeley** untuk pencarian dan pengelolaan referensi, serta **integrasi API DeepSeek (deepseek-v4-flash)** sebagai asisten AI untuk review awal dan masukan.

SIMSA juga dilengkapi **Early Warning System (EWS)** yang mendeteksi dini mahasiswa berisiko terlambat atau berhenti, dan melayani dua jenjang dengan alur milestone berbeda: **S1** (Seminar Proposal, Seminar Hasil, Pendadaran) dan **D3** (Seminar Tertutup Tugas Akhir, Komprehensif).

**Pengguna:** Admin, Pimpinan, Ka. Prodi, BAAK, Dosen, dan Mahasiswa.

**Stack:** Vite + React (frontend), Node.js (service backend/proxy), Supabase (Postgres, Auth, Storage, Realtime), repository GitHub.

## 2. Latar Belakang dan Masalah

Pengelolaan studi akhir yang umum terjadi saat ini bersifat manual dan tersebar (WhatsApp, email, Google Drive, buku bimbingan kertas). Akibatnya:

- Progres mahasiswa tidak terlihat oleh Ka. Prodi, BAAK, dan Pimpinan sampai mendekati batas waktu.
- Catatan bimbingan sulit dilacak dan sulit dijadikan bukti administrasi (syarat sidang, akreditasi).
- Mahasiswa sering menulis tidak sesuai pedoman, sehingga dosen menghabiskan waktu bimbingan untuk koreksi format yang berulang.
- Beban bimbingan dosen tidak terpantau merata.
- Pencarian referensi dan sitasi dikerjakan terpisah dari proses penulisan.

## 3. Tujuan dan Indikator Keberhasilan

| Tujuan | Indikator (target awal, bisa disesuaikan) |
| --- | --- |
| Digitalisasi bimbingan | ≥ 90% sesi bimbingan tercatat di sistem |
| Transparansi progres | Ka. Prodi/BAAK dapat melihat status seluruh mahasiswa (S1 dan D3) tanpa meminta laporan manual |
| Deteksi dini (EWS) | Mahasiswa berisiko teridentifikasi sebelum tenggat; waktu rata-rata penanganan peringatan merah menurun |
| Percepatan studi akhir | Penurunan median waktu penyelesaian TA per semester |
| Kualitas naskah | Berkurangnya temuan format/sistematika pada tahap seminar dan ujian akhir |
| Efisiensi dosen | Waktu review draf per sesi berkurang berkat pra-review AI |
| Kesiapan akreditasi | Rekap bimbingan, beban dosen, dan kelulusan dapat diekspor dalam satu klik |

## 4. Ruang Lingkup

**Termasuk (In Scope)**

- Manajemen pengajuan judul, penetapan pembimbing, dan penjadwalan
- Log bimbingan dengan unggah draf dan umpan balik berjenjang
- Milestone Tracker per jenjang (S1 dan D3) dan dashboard agregat
- Pedoman Skripsi/TA digital (baca, cari, dijadikan rubrik pemeriksaan)
- Integrasi Mendeley (cari referensi, sinkron perpustakaan, sitasi)
- Asisten AI (DeepSeek) untuk review dan saran
- Seminar dan ujian per jenjang (S1: Seminar Proposal, Seminar Hasil, Pendadaran; D3: Seminar Tertutup Tugas Akhir, Komprehensif) beserta penilaian
- Early Warning System (EWS), notifikasi, laporan, ekspor, dan audit log

**Di luar lingkup (Out of Scope, rilis awal)**

- Editor naskah kolaboratif real-time (mahasiswa menulis di Word/Google Docs lalu mengunggah)
- Pendeteksi plagiarisme internal (cukup unggah/catat hasil dari layanan eksternal)
- Integrasi SIAKAD dua arah (rilis awal memakai impor CSV; API menyusul)
- Aplikasi mobile native (cukup web responsif)

## 5. Peran dan Hak Akses

| Peran | Deskripsi | Hak utama |
| --- | --- | --- |
| **Admin** | Pengelola sistem | Kelola akun, peran, master data (prodi, tahun akademik, template), konfigurasi integrasi, audit log |
| **Pimpinan** | Ketua/Wakil Ketua | Dashboard eksekutif read-only, laporan lintas prodi, persetujuan tertentu (mis. SK pembimbing jika dibutuhkan) |
| **Ka. Prodi** | Kepala program studi | Verifikasi/persetujuan judul, penetapan pembimbing & penguji, monitoring progres dan beban dosen di prodinya, pengelolaan pedoman prodi |
| **BAAK** | Administrasi akademik | Verifikasi kelengkapan administrasi, jadwal seminar/sidang, penerbitan berita acara & dokumen, rekap kelulusan |
| **Dosen** | Pembimbing/penguji | Terima mahasiswa bimbingan, review draf, catat bimbingan, setujui milestone, nilai seminar/sidang, gunakan AI sebagai pendamping |
| **Mahasiswa** | Penulis TA | Ajukan judul, ajukan jadwal bimbingan, unggah draf, ikuti milestone, cari referensi, gunakan AI untuk pra-review |

Prinsip akses: *least privilege* dan dijalankan di level database melalui **Row Level Security (RLS)** Supabase, bukan hanya di UI. Satu akun dapat memiliki lebih dari satu peran (mis. Dosen sekaligus Ka. Prodi) dengan *role switcher*.

## 6. Alur Proses Studi Akhir

1. **Pengajuan Topik/Judul** — Mahasiswa mengajukan 1–3 judul dengan abstrak singkat.
2. **Verifikasi Judul** — Ka. Prodi menyetujui, merevisi, atau menolak (dengan catatan).
3. **Penetapan Pembimbing** — Ka. Prodi menetapkan Pembimbing 1 dan 2 (sistem menampilkan kuota dan beban dosen).
4. **Bimbingan dan Penulisan** — Bab demi bab melalui log bimbingan, dipantau Milestone Tracker dan EWS.
5. **Seminar dan Ujian** — Pendaftaran, verifikasi BAAK, penjadwalan, penilaian, dan hasil; tahapnya berbeda menurut jenjang (tabel di bawah).
6. **Revisi Pasca Ujian** — Tenggat revisi dan persetujuan penguji.
7. **Pengarsipan** — Naskah final, lembar pengesahan, dan metadata tersimpan; status lulus.

Tahap seminar dan ujian pada langkah 5:

| Jenjang | Tahap berurutan |
| --- | --- |
| S1 | Seminar Proposal → Seminar Hasil → Pendadaran |
| D3 | Seminar Tertutup Tugas Akhir → Komprehensif |

Setiap tahap memiliki **status** dan **aturan transisi** (state machine) yang dapat dikonfigurasi per prodi.

## 7. Kebutuhan Fungsional

### 7.1 Autentikasi dan Manajemen Pengguna

- Login dengan email institusi (opsi: Google SSO dibatasi domain institusi) dan/atau email-password via Supabase Auth.
- Admin dapat membuat, menonaktifkan, dan mengimpor akun (CSV: mahasiswa, dosen).
- Pengaturan profil: NIM/NIDN, prodi, kontak, tautan akun Mendeley.
- Pencatatan audit log untuk aksi sensitif (ubah peran, ubah pembimbing, ubah nilai).

### 7.2 Manajemen Judul dan Pembimbing

- Form pengajuan judul (judul, bidang kajian, abstrak, kata kunci).
- Pemeriksaan kemiripan judul dengan judul terdahulu di prodi (pencarian teks/*full-text search* Postgres; opsi lanjutan: embedding).
- Ka. Prodi menetapkan pembimbing; sistem menampilkan kuota, beban, dan bidang keahlian dosen.
- Riwayat perubahan judul dan pembimbing (dengan alasan).

### 7.3 Bimbingan (Core)

- Mahasiswa mengajukan sesi bimbingan (tatap muka/daring), tanggal, topik, dan unggahan draf (PDF/DOCX).
- Dosen menerima, menjadwalkan ulang, atau menolak; setelah sesi mengisi **catatan bimbingan** (ringkasan, saran, tindak lanjut, status: *disetujui / revisi / lanjut bab berikutnya*).
- Umpan balik berupa komentar bertaut ke bab/bagian, serta lampiran.
- Mahasiswa menandai tindak lanjut selesai dan mengunggah revisi (versi draf tersimpan: v1, v2, …).
- Rekap bimbingan otomatis (jumlah sesi, tanggal, pembimbing) dan **ekspor Kartu/Buku Bimbingan** (PDF) untuk syarat sidang.
- Pengesahan sesi oleh dosen (dapat memakai persetujuan digital di sistem).

### 7.4 Pedoman Skripsi/TA

- Admin/Ka. Prodi mengunggah dan mengelola **Pedoman** per prodi dan tahun akademik (versi bertanggal).
- Pedoman terbaca langsung di aplikasi: daftar isi, pencarian, dan bookmark.
- Pedoman **distrukturkan** menjadi:
  - **Sistematika**: struktur bab/subbab wajib (Bab 1 Pendahuluan, dst.) sebagai template milestone.
  - **Aturan penulisan**: margin, font, spasi, penomoran, gaya sitasi.
  - **Rubrik/checklist** pemeriksaan per bab, yang menjadi acuan review manual dan review AI.
- Mahasiswa dikaitkan dengan pedoman yang berlaku pada angkatan/tahun akademiknya.

### 7.5 Milestone Tracker

Lihat bagian 10.

### 7.6 Referensi (Mendeley)

Lihat bagian 8.

### 7.7 Asisten AI (DeepSeek)

Lihat bagian 9.

### 7.8 Seminar dan Ujian

- Pendaftaran seminar/ujian oleh mahasiswa sesuai jenjang (S1: Seminar Proposal, Seminar Hasil, Pendadaran; D3: Seminar Tertutup Tugas Akhir, Komprehensif) dengan pemeriksaan syarat otomatis (milestone tercapai, jumlah bimbingan, persetujuan pembimbing, berkas administrasi).
- BAAK memverifikasi berkas, menjadwalkan ruang/waktu, dan menetapkan penguji (dengan usulan Ka. Prodi).
- Cek bentrok jadwal dosen dan ruang.
- Penilaian oleh pembimbing/penguji sesuai rubrik; perhitungan nilai akhir terkonfigurasi.
- Penerbitan **berita acara**, **lembar penilaian**, dan **lembar pengesahan** (PDF dari template).
- Pencatatan revisi pasca sidang dan persetujuan penguji.

### 7.9 Notifikasi dan Pengingat

- Notifikasi in-app dan email: pengajuan baru, jawaban dosen, tenggat milestone, jadwal seminar/sidang, mahasiswa tidak aktif.
- Pengingat otomatis bagi mahasiswa yang tidak bimbingan lebih dari N hari (parameter per prodi).
- Opsi lanjutan: notifikasi WhatsApp.

### 7.10 Dashboard dan Laporan

| Peran | Isi dashboard |
| --- | --- |
| Mahasiswa | Status tahap, milestone berikutnya, tenggat, bimbingan terakhir, tindak lanjut tertunda |
| Dosen | Daftar mahasiswa bimbingan dengan status warna, draf menunggu review, jadwal minggu ini, beban bimbingan |
| Ka. Prodi | Sebaran tahap per angkatan, mahasiswa berisiko (tertinggal), beban dosen, antrean persetujuan |
| BAAK | Antrean verifikasi berkas, kalender seminar/sidang, rekap kelulusan |
| Pimpinan | Ringkasan lintas prodi: jumlah aktif, lulus tepat waktu, rata-rata durasi, tren |
| Admin | Kesehatan sistem, penggunaan AI, log integrasi, manajemen master data |

Laporan dapat diekspor ke PDF/Excel.

### 7.11 Early Warning System (EWS)

Lihat bagian 11.

## 8. Integrasi Mendeley

**Tujuan:** mahasiswa dapat mencari, menyimpan, dan menyisipkan referensi tanpa berpindah aplikasi, dan dosen dapat memeriksa kualitas daftar pustaka.

**Kebutuhan:**

- Hubungkan akun Mendeley melalui **OAuth 2.0**; token disimpan terenkripsi dan hanya diakses oleh service Node.js.
- Cari referensi (judul, penulis, DOI, kata kunci) dari katalog Mendeley dan dari perpustakaan pribadi.
- Simpan referensi ke **Pustaka TA** milik mahasiswa (tabel `references`) dan sinkronkan dengan folder/koleksi Mendeley.
- Tampilkan metadata (penulis, tahun, jurnal, DOI, abstrak) dan **tautan sumber**.
- Hasilkan **daftar pustaka** sesuai gaya sitasi dari pedoman (APA/IEEE/Harvard, dll.) dan ekspor BibTeX/RIS.
- Dosen dapat melihat Pustaka TA mahasiswa dan memberi komentar/penanda (mis. sumber kurang relevan, terlalu lama).
- **Pemeriksaan kualitas referensi:** persentase referensi 5–10 tahun terakhir, proporsi jurnal vs. non-jurnal, referensi tanpa DOI, duplikasi.

**Catatan teknis dan risiko:**

- Seluruh panggilan melalui backend Node.js (client secret tidak boleh ada di frontend).
- Ketersediaan dan syarat penggunaan API Mendeley perlu **diverifikasi saat tahap desain** (cakupan akses, kuota, kebijakan Elsevier). Rancang lapisan abstraksi `ReferenceProvider` agar dapat ditambah/diganti dengan **Crossref, OpenAlex, atau Semantic Scholar**, serta **impor manual RIS/BibTeX/DOI** sebagai cadangan.
- Lakukan *caching* hasil pencarian dan *rate limiting* per pengguna.

## 9. Integrasi AI (DeepSeek-v4-flash)

**Prinsip:** AI adalah **pendamping**, bukan pengganti dosen pembimbing. AI tidak menulis naskah untuk mahasiswa dan tidak memberi nilai resmi.

### 9.1 Fitur

| Fitur | Pengguna | Deskripsi |
| --- | --- | --- |
| Pra-review draf | Mahasiswa | Memeriksa bab terhadap rubrik/pedoman: kelengkapan sistematika, kejelasan rumusan masalah, konsistensi tujuan–metode–kesimpulan |
| Cek format dan gaya | Mahasiswa | Temuan kesesuaian aturan penulisan, sitasi, dan daftar pustaka |
| Saran perbaikan | Mahasiswa, Dosen | Masukan terstruktur (kekuatan, kelemahan, saran) per bagian |
| Ringkasan draf untuk dosen | Dosen | Ringkasan perubahan antar versi draf dan poin yang perlu diperhatikan |
| Draf umpan balik | Dosen | Usulan komentar yang dapat diedit dosen sebelum dikirim |
| Tanya Pedoman | Semua | Tanya-jawab berbasis isi Pedoman (dengan kutipan bagian pedoman) |
| Bantuan pencarian referensi | Mahasiswa | Saran kata kunci pencarian dan penjelasan relevansi referensi yang ditemukan |
| Ringkasan analitik | Ka. Prodi | Ringkasan kondisi progres/risiko prodi dari data milestone |

### 9.2 Aturan Penggunaan

- Keluaran AI selalu berlabel **"Dihasilkan AI — perlu diverifikasi"**, dan disimpan sebagai riwayat (prompt ringkas, versi draf, hasil) untuk audit.
- Aksi **"Gunakan AI"** bersifat opt-in per sesi; kebijakan boleh/tidaknya dikonfigurasi Admin atau Ka. Prodi per prodi.
- **Kuota** per mahasiswa/hari dan per organisasi, serta batas ukuran teks per permintaan.
- Prompt sistem disimpan di konfigurasi (versi), memuat rubrik dari pedoman aktif, dan menginstruksikan AI: tidak mengarang referensi, menandai ketidakpastian, dan tidak menulis ulang naskah secara penuh.
- Pemeriksaan keberadaan referensi yang disebut AI hanya dari data Pustaka TA/Mendeley (cegah halusinasi sitasi).

### 9.3 Arsitektur dan Keamanan

- Panggilan hanya dari **backend Node.js**; API key disimpan di variabel lingkungan/secret manager, tidak pernah di frontend.
- Nama model dikelola sebagai konfigurasi (`AI_MODEL=deepseek-v4-flash`) agar mudah diganti; pastikan nama model dan endpoint diverifikasi pada dokumentasi DeepSeek saat implementasi.
- Dokumen dipecah per bab/bagian (*chunking*) agar sesuai batas konteks; dukung respons *streaming*.
- **Privasi:** naskah mahasiswa dikirim ke penyedia eksternal. Tampilkan persetujuan (consent) pada pertama kali penggunaan, minimalkan data pribadi dalam prompt (tanpa NIM/nama bila tidak perlu), dan tinjau kebijakan retensi data penyedia.
- Penanganan galat: *retry* dengan *backoff*, *timeout*, dan pesan ramah ketika layanan tidak tersedia; sistem inti tetap berjalan tanpa AI.
- Pemantauan biaya: pencatatan token per pengguna dan per prodi di dashboard Admin.

## 10. Milestone Tracker

**Tujuan:** memberi gambaran progres yang objektif dan seragam bagi mahasiswa, dosen, Ka. Prodi, BAAK, dan Pimpinan.

### 10.1 Struktur Milestone

Milestone dibuat dari template yang diturunkan dari sistematika Pedoman dan dibedakan per jenjang (S1 dan D3); mahasiswa otomatis memakai template sesuai jenjang prodinya, dan template dapat disesuaikan per prodi. Contoh default:

**Jenjang S1 (Skripsi)**

| # | Milestone | Bukti/Syarat penyelesaian |
| --- | --- | --- |
| 1 | Judul disetujui | Persetujuan Ka. Prodi |
| 2 | Pembimbing ditetapkan | SK/penetapan |
| 3 | Bab 1 Pendahuluan | Persetujuan pembimbing |
| 4 | Bab 2 Tinjauan Pustaka | Persetujuan pembimbing |
| 5 | Bab 3 Metodologi | Persetujuan pembimbing |
| 6 | Seminar Proposal | Berita acara, status lulus |
| 7 | Pengumpulan dan Analisis Data | Persetujuan pembimbing |
| 8 | Bab 4 Hasil dan Pembahasan | Persetujuan pembimbing |
| 9 | Bab 5 Kesimpulan | Persetujuan pembimbing |
| 10 | Seminar Hasil | Berita acara, status lulus |
| 11 | Siap Pendadaran | Syarat otomatis terpenuhi (bimbingan minimum, persetujuan pembimbing, berkas administrasi) |
| 12 | Pendadaran | Berita acara, nilai |
| 13 | Revisi Pasca Pendadaran | Persetujuan penguji |
| 14 | Naskah Final Diarsipkan | Unggahan final dan lembar pengesahan |

**Jenjang D3 (Tugas Akhir)**

| # | Milestone | Bukti/Syarat penyelesaian |
| --- | --- | --- |
| 1 | Judul Tugas Akhir disetujui | Persetujuan Ka. Prodi |
| 2 | Pembimbing ditetapkan | SK/penetapan |
| 3 | Penyusunan bab awal | Persetujuan pembimbing (struktur sesuai Pedoman D3) |
| 4 | Pelaksanaan Tugas Akhir (perancangan, implementasi, atau pengumpulan data) | Persetujuan pembimbing |
| 5 | Penulisan naskah lengkap | Persetujuan pembimbing |
| 6 | Seminar Tertutup Tugas Akhir | Berita acara, status lulus |
| 7 | Siap Komprehensif | Syarat otomatis terpenuhi (bimbingan minimum, persetujuan pembimbing, berkas administrasi) |
| 8 | Komprehensif | Berita acara, nilai |
| 9 | Revisi Pasca Ujian | Persetujuan penguji |
| 10 | Naskah Final Diarsipkan | Unggahan final dan lembar pengesahan |

### 10.2 Perilaku

- Setiap milestone memiliki **status**: Belum mulai, Sedang dikerjakan, Menunggu review, Revisi, Selesai, Terlambat.
- **Tenggat target** dihitung dari tanggal mulai dan durasi standar (dapat diubah pembimbing/Ka. Prodi dengan alasan).
- Perubahan status terjadi dari aksi nyata (persetujuan dosen, hasil seminar), bukan klaim sepihak mahasiswa.
- **Persentase progres** dihitung berbobot (bobot per milestone dapat dikonfigurasi).
- **Indikator risiko**: hijau (sesuai jadwal), kuning (mendekati tenggat/tidak ada bimbingan N hari), merah (terlambat/tidak aktif); aturan lengkapnya diatur oleh EWS (bagian 11).
- Tampilan: linimasa vertikal/horizontal untuk mahasiswa; tabel dengan filter dan peta panas (heatmap) tahap per mahasiswa untuk Dosen, Ka. Prodi, BAAK, dan Pimpinan.
- Riwayat perubahan milestone tercatat (siapa, kapan, alasan).

## 11. Early Warning System (EWS)

EWS mendeteksi mahasiswa yang berisiko terlambat atau berhenti di tengah jalan, lalu mengirim peringatan dan tindakan yang disarankan kepada pihak yang berwenang sebelum tenggat studi terlewati. Pendekatan awal berbasis aturan (rule-based) yang transparan; AI hanya membantu merangkum kemungkinan penyebab.

### 11.1 Sinyal Risiko

Ambang berikut adalah usulan awal untuk dikalibrasi; Admin atau Ka. Prodi dapat mengubahnya per prodi dan jenjang.

| Sinyal | Contoh aturan awal | Dilaporkan ke |
| --- | --- | --- |
| Tidak ada bimbingan | Kuning bila > 30 hari tanpa sesi tercatat; merah bila > 60 hari | Mahasiswa, Dosen, Ka. Prodi |
| Milestone terlambat | Kuning bila lewat tenggat target ≥ 14 hari; merah bila ≥ 30 hari | Mahasiswa, Dosen, Ka. Prodi |
| Draf tidak diperbarui | Tidak ada unggahan draf baru dalam 30 hari | Mahasiswa, Dosen |
| Tindak lanjut tertunda | Tindak lanjut bimbingan belum selesai > 14 hari | Mahasiswa, Dosen |
| Respons dosen lambat | Draf atau pengajuan belum ditanggapi > 7 hari | Dosen, Ka. Prodi |
| Mendekati batas masa studi | Sisa waktu ke batas maksimum masa studi di bawah ambang (parameter per jenjang) | Mahasiswa, Dosen, Ka. Prodi |
| Progres di bawah rata-rata angkatan | Persentase milestone jauh di bawah median angkatan pada jenjang yang sama | Dosen, Ka. Prodi |
| Beban dosen berlebih | Jumlah bimbingan aktif melebihi kuota | Ka. Prodi, Admin |

### 11.2 Skor dan Tingkat Risiko

Setiap mahasiswa mendapat **skor risiko** (0–100) dari gabungan sinyal berbobot, dihitung ulang setiap hari. Skor dipetakan ke tiga tingkat: **Hijau** (aman), **Kuning** (waspada), dan **Merah** (kritis). Setiap peringatan menampilkan sinyal pemicunya, sehingga alasannya dapat ditelusuri dan dapat dikoreksi oleh dosen atau Ka. Prodi.

Bobot dan ambang S1 dan D3 dikonfigurasi terpisah, karena tahapnya berbeda (S1: tiga tahap seminar/ujian; D3: dua tahap).

### 11.3 Eskalasi dan Tindakan

| Tingkat | Penerima | Tindakan yang dipicu |
| --- | --- | --- |
| Kuning | Mahasiswa, Dosen pembimbing | Pengingat in-app dan email, disertai saran langkah berikutnya |
| Merah | Ditambah Ka. Prodi | Masuk antrean Ka. Prodi; tindakan wajib dicatat (jadwal bimbingan, teguran, ganti pembimbing, rencana percepatan) |
| Merah berkelanjutan (tanpa perbaikan setelah N hari) | Ditambah BAAK; ringkasan ke Pimpinan | Masuk laporan ringkas lintas prodi dan tinjauan kasus |

### 11.4 Kebutuhan Fungsional EWS

- Dashboard EWS berisi daftar mahasiswa berisiko, filter prodi/jenjang/angkatan/pembimbing, alasan peringatan, dan tren skor.
- Status peringatan: Baru, Ditangani, Selesai, atau Diabaikan (dengan alasan); setiap perubahan tercatat di audit log.
- Catatan intervensi oleh Dosen dan Ka. Prodi; catatan internal tidak terlihat oleh mahasiswa.
- Pengecualian sementara (mis. cuti akademik, menunggu data penelitian) oleh Ka. Prodi, dengan alasan dan masa berlaku.
- Penghitungan harian oleh job terjadwal di backend Node.js, lalu notifikasi in-app dan email; peringatan yang sama tidak dikirim berulang (batas frekuensi).
- Mahasiswa melihat status dan saran perbaikan untuk dirinya sendiri; tampilan skor mentah mengikuti kebijakan institusi (lihat pertanyaan terbuka).
- Ringkasan EWS di dashboard Pimpinan: jumlah mahasiswa per tingkat risiko, tren, dan rata-rata waktu penanganan.
- Opsional: AI (DeepSeek) merangkum kemungkinan penyebab dan saran tindak lanjut dari riwayat bimbingan; ringkasan ini tidak memengaruhi skor.

## 12. Arsitektur Teknis

### 12.1 Komponen

| Lapisan | Teknologi | Peran |
| --- | --- | --- |
| Frontend | Vite + React (TypeScript disarankan), React Router, TanStack Query, UI library (mis. Tailwind + komponen) | UI semua peran, role-based routing |
| Backend-for-integration | Node.js (Express/Fastify) | Proxy aman untuk DeepSeek dan Mendeley, parsing dokumen (PDF/DOCX), pembuatan PDF, antrean pekerjaan, penjadwal pengingat |
| Backend data | Supabase | Postgres + RLS, Auth, Storage (draf/berkas), Realtime (notifikasi), opsional Edge Functions |
| Repo dan CI/CD | GitHub + GitHub Actions | Lint, test, build, deploy otomatis; branch `main`/`develop` dengan pull request |

Supabase dapat memakai layanan cloud maupun self-hosted sesuai kebijakan institusi.

### 12.2 Entitas Data Utama (draft)

| Tabel | Isi utama |
| --- | --- |
| `profiles` | id (auth), nama, NIM/NIDN, prodi\_id, kontak |
| `user_roles` | user\_id, role (admin, pimpinan, kaprodi, baak, dosen, mahasiswa), prodi\_id |
| `prodi`, `academic_years` | master data |
| `guidelines`, `guideline_sections`, `guideline_rubrics` | pedoman versi, sistematika, aturan, rubrik |
| `thesis` | mahasiswa\_id, judul, abstrak, status tahap, tahun akademik, guideline\_id |
| `thesis_supervisors` | thesis\_id, dosen\_id, peran (P1/P2), tanggal penetapan |
| `title_submissions` | pengajuan judul dan keputusan |
| `guidance_sessions` | thesis\_id, dosen\_id, tanggal, topik, catatan, tindak lanjut, status, pengesahan |
| `documents` | thesis\_id, bab, versi, file\_path, diunggah\_oleh |
| `comments` | document\_id, bagian, penulis\_id, isi, status selesai |
| `milestone_templates`, `thesis_milestones` | template per prodi; instans per mahasiswa dengan status, tenggat, bobot, bukti |
| `defense_events`, `defense_scores`, `examiners` | seminar/sidang, penguji, penilaian |
| `references`, `reference_notes` | Pustaka TA, sinkron Mendeley, catatan dosen |
| `integration_accounts` | token Mendeley terenkripsi |
| `ai_requests`, `ai_outputs` | log penggunaan, token, hasil, versi prompt |
| `notifications` | penerima, jenis, status baca |
| `audit_logs` | aktor, aksi, entitas, sebelum/sesudah |

Entitas tambahan untuk EWS: `ews_rules` (aturan, bobot, dan ambang per prodi dan jenjang), `ews_scores` (skor harian per mahasiswa), `ews_alerts` (peringatan dan statusnya), dan `ews_actions` (catatan intervensi). Tabel `thesis`, `milestone_templates`, dan `defense_events` memuat kolom `jenjang` (S1/D3) agar template milestone dan jenis seminar/ujian mengikuti jenjang.

### 12.3 Keamanan Data

- **RLS** pada semua tabel: mahasiswa hanya melihat datanya; dosen hanya mahasiswa bimbingan/ujiannya; Ka. Prodi dan BAAK dibatasi prodi/ruang lingkupnya; Pimpinan read-only agregat.
- Berkas di Supabase Storage bersifat privat dengan *signed URL* berumur pendek.
- Secret (service role key, API key DeepSeek, client secret Mendeley) hanya di server; rotasi berkala.
- Validasi input di server, pembatasan tipe dan ukuran berkas, pemindaian malware untuk unggahan (opsional).

## 13. Kebutuhan Non-Fungsional

- **Kinerja:** halaman utama termuat ≤ 3 detik pada jaringan kampus; respons pencarian ≤ 2 detik; pra-review AI menampilkan *streaming* dalam ≤ 5 detik untuk token pertama.
- **Ketersediaan:** target ≥ 99% pada jam akademik; cadangan basis data harian.
- **Skalabilitas:** mendukung ratusan mahasiswa aktif dan puluhan dosen secara bersamaan; indeks pada kolom filter utama.
- **Keamanan dan privasi:** kepatuhan UU Pelindungan Data Pribadi (UU PDP), kebijakan retensi, enkripsi saat transit dan saat disimpan.
- **Aksesibilitas dan UX:** responsif (mobile-first untuk mahasiswa), bahasa Indonesia sebagai bawaan, kontras dan navigasi keyboard memadai.
- **Observabilitas:** pencatatan galat (mis. Sentry), metrik penggunaan, log integrasi.
- **Kemudahan pemeliharaan:** TypeScript, tes otomatis (unit + e2e untuk alur kritis), dokumentasi API dan skema, migrasi basis data berversi.

## 14. Roadmap Rilis

| Fase | Cakupan | Estimasi |
| --- | --- | --- |
| **MVP (Fase 1)** | Auth + role/RLS, master data, pengajuan judul, penetapan pembimbing, log bimbingan + unggah draf, Pedoman (baca), Milestone Tracker dasar per jenjang (S1 dan D3), notifikasi in-app, dashboard dasar | 8–10 minggu |
| **Fase 2** | EWS (aturan, skor, dashboard, eskalasi), integrasi Mendeley + Pustaka TA, asisten AI (pra-review, tanya pedoman), rubrik dari pedoman, notifikasi email, ekspor Buku Bimbingan | 6–8 minggu |
| **Fase 3** | Seminar dan ujian per jenjang (jadwal, penilaian, dokumen otomatis), dashboard Pimpinan/Ka. Prodi lengkap, laporan, audit log | 6–8 minggu |
| **Fase 4** | Impor/integrasi SIAKAD, notifikasi WhatsApp, analitik lanjutan, embedding untuk kemiripan judul | menyesuaikan |

Estimasi bersifat kasar dan perlu disesuaikan dengan ukuran tim.

## 15. Risiko dan Mitigasi

| Risiko | Dampak | Mitigasi |
| --- | --- | --- |
| Ketersediaan/kebijakan API Mendeley berubah | Fitur referensi terganggu | Lapisan abstraksi provider, cadangan Crossref/OpenAlex + impor RIS/BibTeX/DOI |
| Halusinasi AI (saran/sitasi keliru) | Mahasiswa menyalin informasi salah | Label verifikasi, rubrik tegas, validasi referensi hanya dari pustaka, dosen tetap penentu |
| Ketergantungan berlebihan pada AI / isu integritas akademik | Kualitas pembelajaran menurun | AI hanya memberi masukan, tidak menulis naskah; log audit; kebijakan institusi |
| Privasi naskah dikirim ke penyedia eksternal | Pelanggaran data/kekayaan intelektual | Consent, minimasi data, tinjau kebijakan penyedia, opsi nonaktifkan per prodi |
| Biaya API tidak terkendali | Anggaran terlampaui | Kuota, batas token, pemantauan biaya, caching |
| Adopsi rendah oleh dosen | Data bimbingan tidak lengkap | Pelatihan, UI sederhana, pengingat, kebijakan wajib bimbingan tercatat |
| Aturan beda antar prodi | Konfigurasi rumit | Template milestone dan pedoman per prodi dengan default institusi |
| Kebocoran data akibat RLS salah | Risiko serius | Tes otomatis kebijakan RLS per peran, tinjauan keamanan sebelum rilis |

## 16. Pertanyaan Terbuka

1. Apakah login memakai Google Workspace SSO dibatasi domain institusi, email-password, atau keduanya?
2. Berapa jumlah minimal bimbingan dan apa syarat administrasi untuk tiap tahap (S1: Seminar Proposal, Seminar Hasil, Pendadaran; D3: Seminar Tertutup Tugas Akhir, Komprehensif)?
3. Bagaimana struktur bab dan tahapan penulisan Tugas Akhir D3 menurut Pedoman D3, dan apakah ada tahap lain sebelum Seminar Tertutup?
4. Gaya sitasi apa yang dipakai (satu gaya institusi atau per prodi)?
5. Apakah Pimpinan perlu hak persetujuan (mis. SK pembimbing), atau hanya memantau?
6. Apakah pedoman yang ada (PDF) dapat dipecah menjadi rubrik terstruktur, atau diunggah apa adanya terlebih dahulu?
7. Kebijakan institusi terkait penggunaan AI dalam penulisan skripsi dan tugas akhir (batasan dan kewajiban deklarasi)?
8. Supabase akan memakai cloud atau self-hosted?
9. Apakah data mahasiswa/dosen perlu diimpor dari SIAKAD sejak awal?
10. Siapa yang menanggung biaya API DeepSeek dan berapa anggaran bulanannya?
11. Berapa ambang EWS yang dipakai (hari tanpa bimbingan, keterlambatan milestone, batas masa studi S1 dan D3), dan siapa yang menerima eskalasi pada tingkat Merah?
12. Apakah mahasiswa boleh melihat skor risikonya sendiri, atau hanya pengingat dan saran perbaikan?

## 17. Langkah Selanjutnya

- Review draf PRD ini dan jawab pertanyaan terbuka.
- Finalisasi cakupan MVP dan prioritas fitur.
- Susun desain database (ERD) dan kebijakan RLS per peran.
- Buat wireframe untuk alur Mahasiswa dan Dosen terlebih dahulu.
