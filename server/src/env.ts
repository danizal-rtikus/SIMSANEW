import 'dotenv/config';

function clean(v: string | undefined): string {
  return (v ?? '').trim().replace(/^['"]|['"]$/g, '').trim();
}

function required(name: string): string {
  const v = clean(process.env[name]);
  if (!v) {
    if (process.env.VERCEL) {
      // Di Vercel jangan menghentikan proses: /api/health akan melaporkan variabel yang kosong.
      console.error(`[SIMSA] Variabel lingkungan ${name} belum diisi di Vercel (Settings > Environment Variables).`);
      return '';
    }
    console.error(`[SIMSA] Variabel lingkungan ${name} belum diisi. Salin server/.env.example menjadi server/.env.`);
    process.exit(1);
  }
  return v;
}

export const env = {
  supabaseUrl: required('SUPABASE_URL'),
  serviceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),
  port: Number(process.env.PORT || 3001),
  // Alamat frontend yang diizinkan; garis miring di akhir dan tanda kutip diabaikan.
  corsOrigin: clean(process.env.CORS_ORIGIN || 'http://localhost:5173')
    .split(',')
    .map((s) => clean(s).replace(/\/+$/, ''))
    .filter(Boolean),
  defaultImportPassword: process.env.DEFAULT_IMPORT_PASSWORD || '',
};
