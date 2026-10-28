import { createClient } from '@supabase/supabase-js';
import { env } from './env.js';

// Klien service role: melewati RLS. Hanya dipakai di server, jangan pernah dikirim ke frontend.
export const admin = createClient(env.supabaseUrl, env.serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

export async function audit(aktor: string | null, aksi: string, entitas: string, entitasId: string | null, sebelum: unknown, sesudah: unknown) {
  const { error } = await admin.from('audit_logs').insert({
    aktor,
    aksi,
    entitas,
    entitas_id: entitasId,
    sebelum: sebelum ?? null,
    sesudah: sesudah ?? null,
  });
  if (error) console.error('[audit]', error.message);
}
