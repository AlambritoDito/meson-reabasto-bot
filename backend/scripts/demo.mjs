// `npm run demo`: aplica migraciones D1 locales, levanta `wrangler dev` y el poller. Ctrl+C apaga todo.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseDevVars, runPoller, configureBot } from './poll.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pidFile = join(root, '.wrangler', 'demo.pid');
const port = process.env.PORT || '8787';
const wranglerBin = join(root, 'node_modules', '.bin', 'wrangler');
const env = { ...process.env, WRANGLER_SEND_METRICS: 'false' };

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

if (!existsSync(join(root, '.dev.vars'))) {
  console.error('Falta backend/.dev.vars. Copia .dev.vars.example a .dev.vars y llena los valores.');
  process.exit(1);
}
const vars = parseDevVars(readFileSync(join(root, '.dev.vars'), 'utf8'));
for (const k of ['TELEGRAM_BOT_TOKEN', 'WEBHOOK_SECRET', 'OPENAI_MODEL', 'DEMO_UNTIL']) {
  if (!vars[k]) {
    console.error(`Falta ${k} en .dev.vars.`);
    process.exit(1);
  }
}
if (existsSync(pidFile)) {
  const pids = readFileSync(pidFile, 'utf8').trim().split(/\s+/).map(Number);
  if (pids.some((p) => p && alive(p))) {
    console.error('Ya hay una demo corriendo (único consumidor de Telegram). Usa `npm run stop` primero.');
    process.exit(1);
  }
}

const mig = spawnSync(wranglerBin, ['d1', 'migrations', 'apply', 'reto2-demo', '--local'], { cwd: root, env, stdio: ['ignore', 'inherit', 'inherit'] });
if (mig.status !== 0) {
  console.error('No pude aplicar las migraciones D1 locales.');
  process.exit(1);
}

const wr = spawn(wranglerBin, ['dev', '--local', '--port', port, '--ip', '127.0.0.1'], { cwd: root, env, stdio: ['ignore', 'inherit', 'inherit'], detached: true });
mkdirSync(join(root, '.wrangler'), { recursive: true });
writeFileSync(pidFile, `${process.pid} ${wr.pid}\n`);

const ctrl = new AbortController();
let stopping = false;
function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  ctrl.abort();
  try {
    process.kill(-wr.pid, 'SIGTERM');
  } catch {
    /* ya terminó */
  }
  rmSync(pidFile, { force: true });
  setTimeout(() => process.exit(code), 500);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
wr.on('exit', (c) => {
  if (!stopping) {
    console.error(`wrangler dev terminó (código ${c}).`);
    shutdown(1);
  }
});

async function waitHealth() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/health`);
      if (r.ok) return true;
    } catch {
      /* aún no */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

if (!(await waitHealth())) {
  console.error('El Worker local no respondió /health.');
  shutdown(1);
} else {
  console.log(`Worker local listo en http://127.0.0.1:${port}. Configurando el menú del bot…`);
  await configureBot(fetch, vars.TELEGRAM_BOT_TOKEN, vars.TELEGRAM_API_BASE, (m) => console.log(m));
  console.log('Iniciando poller…');
  runPoller({ token: vars.TELEGRAM_BOT_TOKEN, secret: vars.WEBHOOK_SECRET, workerUrl: `http://127.0.0.1:${port}/tg`, signal: ctrl.signal, base: vars.TELEGRAM_API_BASE })
    .catch((e) => console.error(`poller: ${e.message}`))
    .finally(() => shutdown(0));
}
