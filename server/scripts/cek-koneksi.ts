/**
 * Memeriksa konfigurasi server/.env terhadap Supabase.
 * Pemakaian: npm --prefix server run cek-koneksi
 */
import { checkSupabase, printCheck } from '../src/check.js';

const r = await checkSupabase();
printCheck(r);
process.exit(r.ok ? 0 : 1);
