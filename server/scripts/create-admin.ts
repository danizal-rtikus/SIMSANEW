/**
 * Membuat akun Admin pertama.
 * Pemakaian: npm run create-admin -- email@kampus.ac.id "KataSandiKuat123" "Nama Admin"
 */
import { createUserWithRoles } from '../src/users.js';

const [email, password, ...namaParts] = process.argv.slice(2);
if (!email || !password) {
  console.log('Pemakaian: npm run create-admin -- <email> <kata-sandi> "<nama>"');
  process.exit(1);
}

createUserWithRoles({ email, password, nama: namaParts.join(' ') || 'Administrator', roles: [{ role: 'admin' }] })
  .then((u) => {
    console.log(`Admin dibuat: ${u.email} (${u.id})`);
    process.exit(0);
  })
  .catch((e) => {
    console.error('Gagal:', e.message);
    process.exit(1);
  });
