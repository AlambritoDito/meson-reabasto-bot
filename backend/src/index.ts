// Punto de entrada del Worker: GET /health y POST /tg (webhook de Telegram). Procesamiento síncrono e idempotente.
import { LIMITS, DEFAULT_MODEL } from './config';
import { Store } from './db';
import { GeminiClient } from './gemini';
import { HttpTelegram, type TelegramClient } from './telegram';
import type { LlmClient } from './gemini';
import { handleUpdate, type TgUpdate } from './bot';
import type { Env, FetchFn } from './types';

export interface AppOverrides {
  tg?: TelegramClient;
  llm?: LlmClient;
  now?: () => number;
  randomId?: () => string;
}

function timingSafeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export async function handleRequest(req: Request, env: Env, o: AppOverrides = {}): Promise<Response> {
  const url = new URL(req.url);
  if (url.pathname === '/health' && req.method === 'GET') return json(200, { ok: true });
  if (url.pathname !== '/tg') return json(404, { ok: false });
  if (req.method !== 'POST') return json(405, { ok: false });
  if (!env.WEBHOOK_SECRET || !timingSafeEqual(req.headers.get('x-telegram-bot-api-secret-token') ?? '', env.WEBHOOK_SECRET)) return json(401, { ok: false });

  const raw = await req.text();
  if (raw.length > LIMITS.maxWebhookBodyBytes) return json(413, { ok: false });
  let update: TgUpdate;
  try {
    update = JSON.parse(raw);
  } catch {
    return json(400, { ok: false });
  }
  if (!update || typeof update.update_id !== 'number' || !Number.isSafeInteger(update.update_id)) return json(400, { ok: false });

  const now = o.now ?? Date.now;
  const store = new Store(env.DB, now);
  const fetchFn: FetchFn = (i, init) => fetch(i, init);
  const tg = o.tg ?? new HttpTelegram(fetchFn, env.TELEGRAM_BOT_TOKEN);
  const llm = o.llm ?? new GeminiClient(fetchFn, env.GEMINI_API_KEY, env.GEMINI_MODEL || DEFAULT_MODEL);

  const st = await store.beginUpdate(update.update_id);
  if (st.status === 'done') return json(200, { ok: true, duplicate: true });

  const chatId = update.message?.chat.id ?? update.callback_query?.message?.chat.id;
  if (st.attempts > LIMITS.maxUpdateAttempts) {
    // Error honesto tras reintentos (p. ej. límite de CPU con un XLSX): se cierra el update para no ciclar.
    if (chatId !== undefined && (update.message?.chat.type ?? update.callback_query?.message?.chat.type) === 'private') {
      try {
        await tg.sendMessage(chatId, 'No pude procesar ese mensaje tras varios intentos. Si era un XLSX, prueba con un CSV más pequeño.');
      } catch {
        /* mejor esfuerzo */
      }
    }
    await store.finishUpdate(update.update_id);
    return json(200, { ok: true, gaveUp: true });
  }

  try {
    await handleUpdate(update, { store, tg, llm, now, demoUntil: env.DEMO_UNTIL, randomId: o.randomId });
    await store.finishUpdate(update.update_id);
    return json(200, { ok: true });
  } catch (e) {
    // Sin datos sensibles en logs: solo tipo y mensaje propio (nuestros errores no incluyen URL ni token).
    console.error('update_failed', update.update_id, e instanceof Error ? e.name + ': ' + e.message.slice(0, 120) : 'unknown');
    return json(500, { ok: false });
  }
}

export default {
  fetch(req: Request, env: Env): Promise<Response> {
    return handleRequest(req, env);
  },
  async scheduled(_c: unknown, env: Env): Promise<void> {
    await new Store(env.DB, Date.now).cleanup();
  },
};
