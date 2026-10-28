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
  /** 'stop' normal; 'length' berarti jawaban terpotong karena batas token. */
  finish: string;
}

export class AiError extends UserError {
  kosong = false;
  usage?: { tokenMasuk: number; tokenKeluar: number };
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
    choices?: { message?: { content?: string | null; reasoning_content?: string | null }; finish_reason?: string }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const c = j.choices?.[0];
  const text = c?.message?.content ?? '';
  const finish = c?.finish_reason ?? '';
  const tokenMasuk = j.usage?.prompt_tokens ?? 0;
  const tokenKeluar = j.usage?.completion_tokens ?? 0;
  if (!text.trim()) {
    // Model bernalar dapat menghabiskan batas token untuk "berpikir" sebelum menjawab.
    console.error('[AISYS] jawaban kosong', { finish, tokenKeluar, reasoning: (c?.message?.reasoning_content ?? '').length });
    const e = new AiError(finish === 'length' ? `AISYS kehabisan batas panjang jawaban (finish=length, ${tokenKeluar} token).` : `AISYS tidak memberi jawaban (finish=${finish || '-'}).`);
    e.kosong = true;
    e.usage = { tokenMasuk, tokenKeluar };
    throw e;
  }
  return { text, tokenMasuk, tokenKeluar, finish };
}

/**
 * Perbaiki JSON yang terpotong: potong di elemen larik/objek terakhir yang
 * lengkap lalu tutup kurung yang masih terbuka.
 */
function repairJson(s: string): string | null {
  const stack: string[] = [];
  let inStr = false;
  let esc = false;
  let cut = -1;
  let cutStack: string[] = [];
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{' || ch === '[') stack.push(ch === '{' ? '}' : ']');
    else if (ch === '}' || ch === ']') {
      stack.pop();
      if (stack.length && stack[stack.length - 1] === ']') {
        cut = i + 1;
        cutStack = [...stack];
      }
      if (!stack.length) return s.slice(0, i + 1);
    }
  }
  if (cut < 0) return null;
  return s.slice(0, cut) + cutStack.reverse().join('');
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
        /* coba perbaikan di bawah */
      }
    }
    if (a >= 0) {
      const fixed = repairJson(text.slice(text.indexOf('{')));
      if (fixed) {
        try {
          return JSON.parse(fixed) as T;
        } catch {
          /* jatuh ke galat */
        }
      }
    }
  }
  console.error('[AISYS] JSON tidak terbaca', text.length, text.slice(0, 200), '...', text.slice(-200));
  throw new AiError(`Jawaban AISYS tidak dapat dibaca (${text.length} karakter). Coba lagi.`);
}
