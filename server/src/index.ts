import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { env } from './env.js';
import { adminRouter } from './routes/admin.js';
import { UserError } from './users.js';
import { checkSupabase, printCheck } from './check.js';

const app = express();
app.disable('x-powered-by');
app.use(cors({ origin: env.corsOrigin }));
app.use(express.json({ limit: '5mb' }));

app.get('/api/health', async (_req, res) => {
  const c = await checkSupabase();
  res.json({ ok: true, service: 'simsa-server', time: new Date().toISOString(), supabase: { ok: c.ok, problems: c.problems } });
});

app.use('/api/admin', adminRouter);

// Fase 2: /api/ai (DeepSeek) dan /api/references (Mendeley) akan ditambahkan di sini.

app.use('/api', (_req, res) => res.status(404).json({ error: 'Endpoint tidak ditemukan' }));

// Produksi: sajikan hasil build frontend bila tersedia (web/dist)
const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(here, '../../web/dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof UserError) return res.status(err.status).json({ error: err.message });
  console.error('[SIMSA]', err);
  res.status(500).json({ error: 'Terjadi kesalahan pada server' });
});

// Di Vercel, aplikasi dijalankan sebagai Vercel Function lewat export default;
// di komputer sendiri / server biasa, aplikasi mendengarkan port.
if (!process.env.VERCEL) {
  app.listen(env.port, async () => {
    console.log(`[SIMSA] server berjalan di http://localhost:${env.port}`);
    printCheck(await checkSupabase());
  });
}

export default app;
