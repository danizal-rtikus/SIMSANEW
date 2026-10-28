import { env } from './env.js';

export interface CheckResult {
  ok: boolean;
  problems: string[];
  info: string[];
}

function decodeJwt(token: string): Record<string, unknown> | null {
  try {
    const part = token.split('.')[1];
    return JSON.parse(Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

/** Memeriksa SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY: format, kecocokan proyek, dan apakah diterima Supabase. */
export async function checkSupabase(): Promise<CheckResult> {
  const problems: string[] = [];
  const info: string[] = [];
  const url = env.supabaseUrl;
  const key = env.serviceRoleKey;

  if (!url) problems.push('SUPABASE_URL belum diisi (di Vercel: Settings > Environment Variables, lalu Redeploy).');
  if (!key) problems.push('SUPABASE_SERVICE_ROLE_KEY belum diisi (di Vercel: Settings > Environment Variables, lalu Redeploy).');
  const m = url.match(/^https:\/\/([a-z0-9]+)\.supabase\.co\/?$/);
  const urlRef = m?.[1] ?? null;
  if (!m) problems.push(`SUPABASE_URL tidak berformat https://<ref>.supabase.co (sekarang: "${url}")`);
  else info.push(`Proyek dari SUPABASE_URL: ${urlRef}`);

  if (/\s/.test(key)) problems.push('SUPABASE_SERVICE_ROLE_KEY mengandung spasi atau baris baru. Tempel ulang dalam satu baris.');
  if (key.startsWith('sb_publishable_')) problems.push('SUPABASE_SERVICE_ROLE_KEY berisi publishable key. Pakai "service_role" (legacy) atau "secret key" (sb_secret_...).');
  if (key.startsWith('eyJ')) {
    const p = decodeJwt(key);
    if (!p) problems.push('SUPABASE_SERVICE_ROLE_KEY bukan JWT yang valid (mungkin terpotong saat disalin).');
    else {
      info.push(`Key: role=${p.role}, proyek=${p.ref}`);
      if (p.role !== 'service_role') problems.push(`SUPABASE_SERVICE_ROLE_KEY ber-role "${p.role}". Yang dibutuhkan adalah service_role, bukan anon.`);
      if (urlRef && p.ref && p.ref !== urlRef) problems.push(`Key milik proyek "${p.ref}", tetapi SUPABASE_URL menunjuk proyek "${urlRef}".`);
    }
  } else if (key.startsWith('sb_secret_')) {
    info.push('Key: secret key format baru (sb_secret_...)');
  } else if (!key.startsWith('sb_publishable_')) {
    problems.push('Format SUPABASE_SERVICE_ROLE_KEY tidak dikenali.');
  }

  if (problems.length === 0) {
    try {
      const headers: Record<string, string> = { apikey: key };
      if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`;
      const r = await fetch(`${url.replace(/\/$/, '')}/auth/v1/admin/users?page=1&per_page=1`, { headers });
      if (r.ok) info.push('Supabase menerima service key (akses admin Auth berhasil).');
      else {
        const body = await r.text().catch(() => '');
        problems.push(
          `Supabase menolak service key (HTTP ${r.status}${body ? `: ${body.slice(0, 160)}` : ''}). ` +
            'Kemungkinan key sudah di-rotate, legacy API keys dinonaktifkan, atau key salah salin. Ambil ulang dari Project Settings > API Keys.',
        );
      }
    } catch (e) {
      problems.push(`Tidak dapat menghubungi ${url}: ${(e as Error).message}`);
    }
  }

  return { ok: problems.length === 0, problems, info };
}

export function printCheck(r: CheckResult) {
  r.info.forEach((i) => console.log(`[SIMSA]   ${i}`));
  if (r.ok) console.log('[SIMSA] Koneksi Supabase dari server: OK');
  else {
    console.error('[SIMSA] Masalah konfigurasi server/.env:');
    r.problems.forEach((p) => console.error(`[SIMSA]   - ${p}`));
  }
}
