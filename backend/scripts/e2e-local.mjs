// E2E LOCAL con DOBLE DE PRUEBA de Telegram (servidor HTTP falso en 127.0.0.1) + poller real + `wrangler dev` (workerd) + D1 local.
// No contacta Telegram ni OpenAI: OPENAI_MODEL vacío fuerza la plantilla «sin IA» sin red. No es evidencia de servicios reales.
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPoller, configureBot } from './poll.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const wranglerBin = join(root, 'node_modules', '.bin', 'wrangler');
const persist = mkdtempSync(join(tmpdir(), 'reto2-e2e-'));
const TOKEN = 'e2e-fake-token';
const SECRET = 'e2e-secret';
const PORT = Number(process.env.E2E_PORT || 8797);
const env = { ...process.env, WRANGLER_SEND_METRICS: 'false' };

// ---------- Telegram falso ----------
const queue = []; // updates pendientes de entregar
const sent = []; // lo que el bot "envió"
let nextId = 1;
const files = new Map();
const server = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks);
  const url = req.url ?? '';
  const reply = (result) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, result }));
  };
  if (!url.startsWith(`/bot${TOKEN}/`) && !url.startsWith(`/file/bot${TOKEN}/`)) {
    res.writeHead(401);
    return res.end('{"ok":false}');
  }
  if (url.startsWith(`/file/bot${TOKEN}/`)) {
    res.writeHead(200);
    return res.end(files.get(url.split('/').pop()));
  }
  const method = url.split('/').pop();
  if (method === 'deleteWebhook') return reply(true);
  if (method === 'getUpdates') {
    const b = JSON.parse(raw.toString() || '{}');
    if (b.offset !== undefined) while (queue.length && queue[0].update_id < b.offset) queue.shift();
    if (!queue.length) await new Promise((r) => setTimeout(r, 300));
    return reply(queue.slice(0, 10));
  }
  if (method === 'getFile') {
    const b = JSON.parse(raw.toString());
    return reply({ file_id: b.file_id, file_path: `docs/${b.file_id}` });
  }
  if (method === 'sendDocument') {
    sent.push({ method, body: raw.toString('utf8') });
    return reply({ message_id: 1 });
  }
  const body = JSON.parse(raw.toString());
  if (typeof body.text === 'string') body.text = body.text.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'); // texto visible
  sent.push({ method, body });
  return reply(true);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

// ---------- Worker local ----------
let wr;
function startWorker() {
  wr = spawn(
    wranglerBin,
    ['dev', '--local', '--port', String(PORT), '--ip', '127.0.0.1', '--persist-to', persist,
      '--var', `WEBHOOK_SECRET:${SECRET}`, '--var', `TELEGRAM_BOT_TOKEN:${TOKEN}`, '--var', `TELEGRAM_API_BASE:${base}`,
      '--var', 'DEMO_UNTIL:2026-12-10', '--var', 'OPENAI_API_KEY:none', '--var', 'OPENAI_MODEL:'],
    { cwd: root, env, stdio: ['ignore', 'ignore', 'inherit'], detached: true },
  );
}
async function waitHealth(up = true) {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/health`);
      if (up && r.ok) return;
    } catch {
      if (!up) return;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('health timeout');
}
function stopWorker() {
  try {
    process.kill(-wr.pid, 'SIGTERM');
  } catch {}
}

const results = [];
function check(name, cond) {
  results.push([name, !!cond]);
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}`);
}
const A = 7001;
const B = 7002;
const msg = (chat, text) => queue.push({ update_id: nextId++, message: { message_id: nextId, chat: { id: chat, type: 'private' }, from: { id: chat }, text } });
const click = (chat, data) => queue.push({ update_id: nextId++, callback_query: { id: `cb${nextId}`, from: { id: chat }, data, message: { message_id: 500, chat: { id: chat, type: 'private' } } } });
async function until(pred, ms = 15000) {
  const t = Date.now();
  while (Date.now() - t < ms) {
    const v = pred();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}
const msgs = (chat) => sent.filter((s) => (s.method === 'sendMessage' || s.method === 'editMessageText') && s.body.chat_id === chat);
const lastMsg = (chat) => msgs(chat).at(-1);
const cbs = () => sent.filter((s) => s.method === 'answerCallbackQuery');
const docs = () => sent.filter((s) => s.method === 'sendDocument');

const ctrl = new AbortController();
let code = 1;
try {
  const mig = spawnSync(wranglerBin, ['d1', 'migrations', 'apply', 'reto2-demo', '--local', '--persist-to', persist], { cwd: root, env, stdio: 'ignore' });
  check('migraciones D1 locales aplicadas', mig.status === 0);
  startWorker();
  await waitHealth();
  const poller = runPoller({ token: TOKEN, secret: SECRET, workerUrl: `http://127.0.0.1:${PORT}/tg`, signal: ctrl.signal, base, timeoutSec: 1, log: () => {}, sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 500))) });

  check('configuración del bot (5 llamadas: comandos, menú, descripciones)', (await configureBot(fetch, TOKEN, base)) === 5 && sent.filter((s) => /^set(MyCommands|ChatMenuButton|MyDescription|MyShortDescription)$/.test(s.method)).length === 5);
  msg(A, '/start');
  check('/start se identifica como asistente automático de demostración', await until(() => /DEMOSTRACIÓN/.test(lastMsg(A)?.body.text ?? '')));
  check('/start trae menú inline (parse_mode HTML)', lastMsg(A)?.body.parse_mode === 'HTML' && lastMsg(A)?.body.reply_markup?.inline_keyboard?.[0]?.[0]?.callback_data === 'm:load');
  click(A, 'm:help');
  check('botón del menú edita el mensaje (editMessageText) y responde el callback', await until(() => sent.some((s) => s.method === 'editMessageText' && s.body.message_id === 500 && /Ayuda/.test(s.body.text))) && (await until(() => cbs().length >= 1)));
  msg(A, '/muestra');
  const prop = await until(() => msgs(A).find((m) => /bajo mínimo/.test(m.body.text)));
  check('/muestra → 6 bajo mínimo, fila 20 excluida, total $6808.00', prop && /6 insumos bajo mínimo/.test(prop.body.text) && /fila 20/.test(prop.body.text) && /\$6808\.00/.test(prop.body.text));
  const ap1 = prop?.body.reply_markup?.inline_keyboard[0][0].callback_data;
  msg(A, '/temporada -50 proveedor Cafe Ficticio del Valle');
  const pv = await until(() => msgs(A).find((m) => /Antes → después/.test(m.body.text)));
  check('/temporada muestra antes/después y pide confirmar', pv && /13 → 7/.test(pv.body.text));
  click(A, pv.body.reply_markup.inline_keyboard[0][0].callback_data);
  const v2 = await until(() => msgs(A).find((m) => /propuesta v2/.test(m.body.text)));
  check('confirmar ajuste → propuesta v2 total $5128.00', v2 && /\$5128\.00/.test(v2.body.text));
  click(A, ap1);
  check('botón v1 viejo rechazado («ya no está vigente»)', await until(() => cbs().find((c) => /ya no está vigente/.test(c.body.text ?? ''))));

  // Reinicio del Worker a mitad: el update de aprobación llega con el Worker caído.
  stopWorker();
  await waitHealth(false);
  const ap2 = v2.body.reply_markup.inline_keyboard[0][0].callback_data;
  click(A, ap2);
  await new Promise((r) => setTimeout(r, 2000));
  check('con Worker caído no se pierde el update (no se procesó aún)', docs().length === 0);
  startWorker();
  await waitHealth();
  check('tras reiniciar, la aprobación se procesa y llega un borrador', await until(() => docs().length === 1, 30000));
  const draft = docs()[0]?.body ?? '';
  check('borrador: NO envía a proveedores, café 7 kg, fila 20 excluida, historial', /NO envía nada a proveedores/.test(draft) && /Cafe en grano: 7 kg/.test(draft) && /fila 20/.test(draft) && /aprobada/.test(draft));
  click(A, ap2);
  check('doble clic no duplica', (await until(() => cbs().find((c) => /ya estaba aprobada/.test(c.body.text)))) && docs().length === 1);

  // Re-entrega del mismo update_id (p. ej. poller reiniciado antes de confirmar): deduplicado.
  const before = msgs(A).length;
  queue.push({ update_id: nextId - 1, callback_query: { id: 'dup', from: { id: A }, data: ap2, message: { chat: { id: A, type: 'private' } } } });
  msg(A, '/historial');
  await until(() => msgs(A).length > before);
  await new Promise((r) => setTimeout(r, 500));
  check('update re-entregado se deduplica', msgs(A).length === before + 1 && docs().length === 1);

  msg(A, 'hola, ¿qué puedes hacer?');
  check('texto libre sin IA configurada → plantilla «sin IA»', await until(() => /^\(sin IA\)/.test(lastMsg(A)?.body.text ?? '')));

  files.set('fB', readFileSync(join(root, '..', 'fixtures', 'inventario-sin-faltantes.csv')));
  queue.push({ update_id: nextId++, message: { message_id: 1, chat: { id: B, type: 'private' }, from: { id: B }, document: { file_id: 'fB', file_name: 'inv.csv', file_size: files.get('fB').length } } });
  check('chat B sube CSV sin faltantes → no propone compras (sin cruce con A)', await until(() => /No propongo compras/.test(lastMsg(B)?.body.text ?? '')));

  msg(A, '/borrar');
  const conf = await until(() => msgs(A).find((m) => /¿Borrar tus datos/.test(m.body.text)));
  check('/borrar pide confirmación con botones', conf && /^del:[0-9a-f]{8}$/.test(conf.body.reply_markup.inline_keyboard[0][0].callback_data));
  click(A, conf.body.reply_markup.inline_keyboard[0][0].callback_data);
  check('confirmar borra (vista editada)', await until(() => sent.some((s) => s.method === 'editMessageText' && /borré/.test(s.body.text))));
  msg(A, '/aprobar');
  check('tras /borrar no queda sesión', await until(() => /Aún no hay inventario/.test(lastMsg(A)?.body.text ?? '')));

  ctrl.abort();
  await poller;
  code = results.every(([, ok]) => ok) ? 0 : 1;
} catch (e) {
  console.error('E2E error:', e instanceof Error ? e.message : e);
} finally {
  ctrl.abort();
  stopWorker();
  server.close();
  rmSync(persist, { recursive: true, force: true });
  console.log(`${results.filter(([, ok]) => ok).length}/${results.length} checks PASS`);
  setTimeout(() => process.exit(code), 300);
}
