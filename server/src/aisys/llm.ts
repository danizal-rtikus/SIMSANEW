/** Pemanggil model bahasa (endpoint kompatibel OpenAI, mis. SumoPod). */
import { env } from '../env.js';
import { UserError } from '../users.js';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatResult {
  text: string;
  tokenMasuk: number;
  tokenKeluar: number;
}

export class AiError extends UserError {
  constructor(message: string, status = 502) {
    super(message);
    this.status = status;
  }
}

export function aiReady(): boolean {
  return !!env.ai.apiKey;
}

async function post(body: Record<string, unknown>, timeoutMs: number): Promise<Response> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    return await fetch(`${env.ai.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.ai.apiKey}` },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new AiError('AISYS terlalu lama merespons. Coba lagi dengan teks yang lebih pendek.', 504);
    throw new AiError('Layanan AISYS tidak dapat dihubungi. Coba lagi sebentar.');
  } finally {
    clearTimeout(t);
  }
}

/** Panggil model. `json` meminta keluaran objek JSON. */
export async function chat(messages: ChatMessage[], opts: { json?: boolean; temperature?: number; maxTokens?: number; timeoutMs?: number } = {}): Promise<ChatResult> {
  if (!aiReady()) throw new AiError('AISYS belum diaktifkan. Admin perlu mengisi AI_API_KEY pada server.', 503);
  const body: Record<string, unknown> = {
    model: env.ai.model,
    messages,
    temperature: opts.temperature ?? 0.4,
    max_tokens: opts.maxTokens ?? 2000,
  };
  if (opts.json) body.response_format = { type: 'json_object' };
  const timeout = opts.timeoutMs ?? 50000;
  let res = await post(body, timeout);
  // Sebagian penyedia tidak mengenal response_format: ulangi tanpa parameter itu.
  if (res.status === 400 && opts.json) {
    delete body.response_format;
    res = await post(body, timeout);
  }
  if (res.status === 401 || res.status === 403) throw new AiError('Kunci API AISYS ditolak penyedia. Admin perlu memeriksa AI_API_KEY.', 503);
  if (res.status === 429) throw new AiError('Kuota layanan AISYS sedang penuh. Coba lagi beberapa menit lagi.', 429);
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    console.error('[AISYS]', res.status, t.slice(0, 300));
    throw new AiError(`Layanan AISYS mengembalikan galat (${res.status}).`);
  }
  const j = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const text = j.choices?.[0]?.message?.content ?? '';
  if (!text.trim()) throw new AiError('AISYS tidak memberi jawaban. Coba lagi.');
  return { text, tokenMasuk: j.usage?.prompt_tokens ?? 0, tokenKeluar: j.usage?.completion_tokens ?? 0 };
}

/** Ambil objek JSON dari jawaban model (toleran terhadap pagar ``` dan teks pengantar). */
export function parseJson<T>(text: string): T {
  let s = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
  try {
    return JSON.parse(s) as T;
  } catch {
    const a = s.indexOf('{');
    const b = s.lastIndexOf('}');
    if (a >= 0 && b > a) {
      s = s.slice(a, b + 1);
      try {
        return JSON.parse(s) as T;
      } catch {
        /* jatuh ke galat */
      }
    }
  }
  throw new AiError('Jawaban AISYS tidak dapat dibaca. Coba lagi.');
}
