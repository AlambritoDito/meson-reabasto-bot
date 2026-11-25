// `npm run stop`: asegura el apagado de una demo previa (poller + wrangler dev) usando el archivo de PIDs.
// Antes de señalar un PID comprueba que su comando es el de esta demo; si no coincide, NO lo toca.
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pidFile = join(root, '.wrangler', 'demo.pid');

export function commandOf(pid) {
  try {
    return execFileSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

export function isDemoProcess(cmd, kind) {
  if (!cmd) return false;
  return kind === 'demo' ? /scripts[\\/]demo\.mjs/.test(cmd) : /wrangler/.test(cmd) && /\bdev\b/.test(cmd);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (!existsSync(pidFile)) {
    console.log('No hay demo registrada en ejecución.');
    process.exit(0);
  }
  const [demoPid, wrPid] = readFileSync(pidFile, 'utf8').trim().split(/\s+/).map(Number);
  let skipped = 0;
  for (const [pid, kind] of [[demoPid, 'demo'], [wrPid, 'wrangler']]) {
    if (!pid) continue;
    const cmd = commandOf(pid);
    if (!cmd) continue; // ya no existe
    if (!isDemoProcess(cmd, kind)) {
      console.log(`El pid ${pid} ya no corresponde a ${kind === 'demo' ? 'la demo' : 'wrangler dev'}; no lo toco.`);
      skipped++;
      continue;
    }
    try {
      process.kill(kind === 'wrangler' ? -pid : pid, 'SIGTERM');
      console.log(`Señal de apagado enviada a ${kind === 'demo' ? 'la demo' : 'wrangler dev'} (pid ${pid}).`);
    } catch {
      /* ya no existe */
    }
  }
  rmSync(pidFile, { force: true });
  console.log(skipped ? 'Listo (algunos PIDs guardados ya eran de otros procesos y no se tocaron).' : 'Listo.');
}
