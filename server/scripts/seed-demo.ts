/**
 * Membuat akun demo untuk setiap peran (butuh seed.sql sudah dijalankan agar prodi TI dan MI ada).
 * Pemakaian: npm run seed-demo -- [kata-sandi]
 * JANGAN jalankan di basis data produksi.
 */
import { createUserWithRoles, type UserInput } from '../src/users.js';

const password = process.argv[2] || 'SimsaDemo2026';
const d = 'demo.simsa.id';

const users: UserInput[] = [
  { email: `admin@${d}`, nama: 'Admin SIMSA', roles: [{ role: 'admin' }] },
  { email: `pimpinan@${d}`, nama: 'Dr. Ratna Wulandari', roles: [{ role: 'pimpinan' }] },
  { email: `baak@${d}`, nama: 'Siti Rahmawati', roles: [{ role: 'baak' }] },
  { email: `kaprodi.ti@${d}`, nama: 'Dr. Budi Santoso, M.Kom.', nidn: '0601018801', prodi_kode: 'TI', bidang_keahlian: ['Rekayasa Perangkat Lunak'], roles: [{ role: 'kaprodi' }, { role: 'dosen' }] },
  { email: `kaprodi.mi@${d}`, nama: 'Hendra Gunawan, M.T.', nidn: '0601018802', prodi_kode: 'MI', bidang_keahlian: ['Jaringan Komputer'], roles: [{ role: 'kaprodi' }, { role: 'dosen' }] },
  { email: `dosen1@${d}`, nama: 'Dewi Lestari, M.Kom.', nidn: '0601018803', prodi_kode: 'TI', bidang_keahlian: ['Data Mining', 'Machine Learning'], roles: [{ role: 'dosen' }] },
  { email: `dosen2@${d}`, nama: 'Agus Prasetyo, M.Cs.', nidn: '0601018804', prodi_kode: 'TI', bidang_keahlian: ['Sistem Informasi', 'Basis Data'], roles: [{ role: 'dosen' }] },
  { email: `dosen3@${d}`, nama: 'Rina Kartika, M.T.', nidn: '0601018805', prodi_kode: 'MI', bidang_keahlian: ['Pemrograman Web'], roles: [{ role: 'dosen' }] },
  { email: `mhs1@${d}`, nama: 'Andi Saputra', nim: '2201001', prodi_kode: 'TI', angkatan: 2022, roles: [{ role: 'mahasiswa' }] },
  { email: `mhs2@${d}`, nama: 'Bunga Maharani', nim: '2201002', prodi_kode: 'TI', angkatan: 2022, roles: [{ role: 'mahasiswa' }] },
  { email: `mhs3@${d}`, nama: 'Citra Ayu', nim: '2201003', prodi_kode: 'TI', angkatan: 2021, roles: [{ role: 'mahasiswa' }] },
  { email: `mhs4@${d}`, nama: 'Dimas Pratama', nim: '2303001', prodi_kode: 'MI', angkatan: 2023, roles: [{ role: 'mahasiswa' }] },
];

for (const u of users) {
  try {
    await createUserWithRoles({ ...u, password });
    console.log(`dibuat   ${u.email}`);
  } catch (e) {
    console.log(`dilewati ${u.email}: ${(e as Error).message}`);
  }
}
console.log(`\nSemua akun demo memakai kata sandi: ${password}`);
process.exit(0);
