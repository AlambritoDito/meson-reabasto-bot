// Poller de Telegram (long polling) que reenvía cada update al Worker local en POST /tg.
// Único consumidor; solo confirma (avanza offset) cuando el Worker responde 2xx. Sin dependencias.
// Nunca imprime el token: los errores se reportan con mensajes propios, sin URL.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function parseDevVars(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trim().startsWith('#')) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

export function safeApiBase(base) {
  if (!base) return 'https://api.telegram.org';
  if (base === 'https://api.telegram.org' || /^http:\/\/127\.0\.0\.1:\d{2,5}$/.test(base)) return base;
  throw new Error('TELEGRAM_API_BASE no permitido');
}

async function tgCall(fetchFn, token, method, body, signal, base) {
  let res;
  try {
    res = await fetchFn(`${safeApiBase(base)}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
  } catch {
    throw new Error(`Telegram ${method}: error de red`);
  }
  let j = null;
  try {
    j = await res.json();
  } catch {
    /* sin cuerpo JSON */
  }
  if (!res.ok || !j || j.ok !== true) throw new Error(`Telegram ${method}: HTTP ${res.status}`);
  return j.result;
}

// Menú nativo de Telegram (setMyCommands) y textos públicos del bot. Idempotente: repetirlo deja lo mismo.
export const BOT_COMMANDS = [
  { command: 'start', description: 'Inicio y menú con botones' },
  { command: 'menu', description: 'Abrir el menú' },
  { command: 'muestra', description: 'Cargar el inventario ficticio' },
  { command: 'explicar', description: 'Explicar la propuesta' },
  { command: 'temporada', description: 'Ajustar por temporada' },
  { command: 'aprobar', description: 'Aprobar o rechazar la propuesta' },
  { command: 'borrador', description: 'Descargar el borrador aprobado' },
  { command: 'historial', description: 'Historial de la sesión' },
  { command: 'limites', description: 'Mis límites de uso' },
  { command: 'borrar', description: 'Borrar mis datos' },
  { command: 'ayuda', description: 'Ayuda' },
];
export const BOT_DESCRIPTION =
  'Asistente automático de DEMOSTRACIÓN para reabastecimiento con datos ficticios. Revisa un inventario contra mínimos, propone un pedido por proveedor y prepara un borrador. Una persona aprueba; el bot no envía pedidos a proveedores.';
export const BOT_SHORT_DESCRIPTION = 'Demo con datos ficticios: propone pedidos de reabastecimiento y tú apruebas. No envía pedidos.';

export async function configureBot(fetchFn, token, base, log = () => {}) {
  const calls = [
    ['setMyCommands', { commands: BOT_COMMANDS }],
    ['setMyCommands', { commands: BOT_COMMANDS, language_code: 'es' }],
    ['setChatMenuButton', { menu_button: { type: 'commands' } }],
    ['setMyDescription', { description: BOT_DESCRIPTION }],
    ['setMyShortDescription', { short_description: BOT_SHORT_DESCRIPTION }],
  ];
  let ok = 0;
  for (const [method, body] of calls) {
    try {
      await tgCall(fetchFn, token, method, body, undefined, base);
      ok++;
    } catch (e) {
      log(`configuración del bot: ${e instanceof Error ? e.message : 'error'} (se continúa)`);
    }
  }
  log(`configuración del bot: ${ok}/${calls.length} aplicadas (menú de comandos y descripciones)`);
  return ok;
}

export async function deleteWebhook(fetchFn, token, base) {
  return tgCall(fetchFn, token, 'deleteWebhook', { drop_pending_updates: false }, undefined, base);
}

/**
 * Una vuelta: pide updates desde `offset`, los reenvía en orden y devuelve el nuevo offset.
 * Si el Worker no responde 2xx, se detiene y NO avanza más allá de ese update (se reintentará).
 */
export async function pollOnce({ fetchFn, token, workerUrl, secret, offset, timeoutSec = 50, signal, log = () => {}, base, forwardTimeoutMs = 60_000 }) {
  const body = { timeout: timeoutSec, allowed_updates: ['message', 'callback_query'] };
  if (offset !== undefined) body.offset = offset;
  const updates = await tgCall(fetchFn, token, 'getUpdates', body, signal, base);
  let next = offset;
  let failed = false;
  for (const u of updates) {
    let res;
    const fwd = new AbortController();
    const timer = setTimeout(() => fwd.abort(), forwardTimeoutMs);
    try {
      res = await fetchFn(workerUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': secret },
        body: JSON.stringify(u),
        signal: fwd.signal,
      });
    } catch {
      log(`update ${u.update_id}: ${fwd.signal.aborted ? `el Worker no respondió en ${forwardTimeoutMs / 1000}s` : 'Worker inaccesible'}; no se confirma, se reintentará`);
      failed = true;
      break;
    } finally {
      clearTimeout(timer);
    }
    if (res.status < 200 || res.status >= 300) {
      log(`update ${u.update_id}: Worker respondió ${res.status}; se reintentará`);
      failed = true;
      break;
    }
    next = u.update_id + 1;
  }
  return { offset: next, count: updates.length, failed };
}

export async function runPoller({ fetchFn = fetch, token, workerUrl, secret, signal, log = console.log, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), base, timeoutSec }) {
  if (!token) throw new Error('Falta TELEGRAM_BOT_TOKEN en .dev.vars');
  if (!secret) throw new Error('Falta WEBHOOK_SECRET en .dev.vars');
  await deleteWebhook(fetchFn, token, base);
  log('poller: webhook desactivado; escuchando con getUpdates (Ctrl+C para salir)');
  let offset;
  let backoff = 1000;
  while (!signal?.aborted) {
    try {
      const r = await pollOnce({ fetchFn, token, workerUrl, secret, offset, signal, log, base, timeoutSec });
      offset = r.offset;
      if (r.failed) {
        await sleep(backoff);
        backoff = Math.min(backoff * 2, 30_000);
      } else backoff = 1000;
    } catch (e) {
      if (signal?.aborted) break;
      log(`poller: ${e instanceof Error ? e.message : 'error'}; reintento en ${backoff / 1000}s`);
      await sleep(backoff);
      backoff = Math.min(backoff * 2, 30_000);
    }
  }
  log('poller: detenido');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const vars = parseDevVars(readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8'));
  const port = process.env.PORT || '8787';
  const ctrl = new AbortController();
  process.on('SIGINT', () => ctrl.abort());
  process.on('SIGTERM', () => ctrl.abort());
  runPoller({ token: vars.TELEGRAM_BOT_TOKEN, secret: vars.WEBHOOK_SECRET, workerUrl: `http://127.0.0.1:${port}/tg`, signal: ctrl.signal, base: vars.TELEGRAM_API_BASE }).catch((e) => {
    console.error(`poller: ${e.message}`);
    process.exit(1);
  });
}
