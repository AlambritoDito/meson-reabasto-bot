// `npm run stop`: asegura el apagado de una demo previa (poller + wrangler dev) usando el archivo de PIDs.
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const pidFile = join(dirname(fileURLToPath(import.meta.url)), '..', '.wrangler', 'demo.pid');
if (!existsSync(pidFile)) {
  console.log('No hay demo registrada en ejecución.');
  process.exit(0);
}
const [demoPid, wrPid] = readFileSync(pidFile, 'utf8').trim().split(/\s+/).map(Number);
for (const [pid, group] of [[demoPid, false], [wrPid, true]]) {
  if (!pid) continue;
  try {
    process.kill(group ? -pid : pid, 'SIGTERM');
    console.log(`Señal de apagado enviada a ${group ? 'wrangler dev' : 'la demo'} (pid ${pid}).`);
  } catch {
    /* ya no existe */
  }
}
rmSync(pidFile, { force: true });
console.log('Listo. Si usaste un webhook antes, el poller ya lo había desactivado; no hay nada más corriendo.');
