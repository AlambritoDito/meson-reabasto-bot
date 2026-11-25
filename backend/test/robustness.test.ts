// Robustez con DOBLES DE PRUEBA (Telegram, OpenAI y D1 sobre node:sqlite). No es evidencia de servicios reales.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { makeApp } from './fakes';
import { LIMITS } from '../src/config';

const fx = (n: string) => new Uint8Array(readFileSync(new URL(`../../fixtures/${n}`, import.meta.url)));
const A = 111111;
const B = 222222;
const verRow = (app: ReturnType<typeof makeApp>, chat: number) =>
  app.db.db.prepare('SELECT session_id, version, approved_version FROM sessions WHERE chat_id = ?').get(chat) as { session_id: string; version: number; approved_version: number | null } | undefined;

function xlsxBytes(aoa: unknown[][], formulaCell = false): Uint8Array {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  if (formulaCell) ws['C2'] = { t: 'n', v: 2, f: '1+1' };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Inventario');
  return new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
}

/** ZIP mínimo cuyo directorio central declara una expansión enorme (bomba). */
function zipBomb(): Uint8Array {
  const name = new TextEncoder().encode('xl/workbook.xml');
  const local = new Uint8Array(30 + name.length);
  const dl = new DataView(local.buffer);
  dl.setUint32(0, 0x04034b50, true);
  dl.setUint16(26, name.length, true);
  local.set(name, 30);
  const cd = new Uint8Array(46 + name.length);
  const dc = new DataView(cd.buffer);
  dc.setUint32(0, 0x02014b50, true);
  dc.setUint32(20, 1000, true);
  dc.setUint32(24, 50 * 1024 * 1024, true);
  dc.setUint16(28, name.length, true);
  cd.set(name, 46);
  const eocd = new Uint8Array(22);
  const de = new DataView(eocd.buffer);
  de.setUint32(0, 0x06054b50, true);
  de.setUint16(8, 1, true);
  de.setUint16(10, 1, true);
  de.setUint32(12, cd.length, true);
  de.setUint32(16, local.length, true);
  const out = new Uint8Array(local.length + cd.length + eocd.length);
  out.set(local, 0);
  out.set(cd, local.length);
  out.set(eocd, local.length + cd.length);
  return out;
}

describe('webhook: autenticación, health e idempotencia', () => {
  it('secreto incorrecto → 401 y nada se registra', async () => {
    const app = makeApp();
    const r = await app.post({ update_id: 1, message: { message_id: 1, chat: { id: A, type: 'private' }, text: '/start' } }, 'otro');
    expect(r.status).toBe(401);
    expect(app.db.count('updates')).toBe(0);
    expect(app.tg.sent).toHaveLength(0);
  });
  it('/health no expone datos; cuerpo inválido → 400; método/ruta → 405/404', async () => {
    const app = makeApp();
    const h = await app.postRaw('', undefined, 'GET', '/health');
    expect(await h.json()).toEqual({ ok: true });
    expect((await app.postRaw('{no json')).status).toBe(400);
    expect((await app.postRaw(JSON.stringify({ update_id: 'x' }))).status).toBe(400);
    expect((await app.postRaw('', undefined, 'GET', '/tg')).status).toBe(405);
    expect((await app.postRaw('{}', undefined, 'POST', '/otro')).status).toBe(404);
  });
  it('update duplicado no repite respuestas ni efectos', async () => {
    const app = makeApp();
    const u = { update_id: 77, message: { message_id: 1, chat: { id: A, type: 'private' }, text: '/muestra' } };
    expect((await app.post(u)).status).toBe(200);
    const n = app.tg.sent.length;
    const r2 = await app.post(u);
    expect(await r2.json()).toMatchObject({ duplicate: true });
    expect(app.tg.sent.length).toBe(n);
  });
  it('fallo a mitad → 500; el reintento procesa y luego queda deduplicado (recuperación tras reinicio)', async () => {
    const app = makeApp();
    const u = { update_id: 88, message: { message_id: 1, chat: { id: A, type: 'private' }, text: '/muestra' } };
    app.tg.failNext = 1;
    expect((await app.post(u)).status).toBe(500);
    expect((await app.post(u)).status).toBe(200);
    expect((await app.post(u)).status).toBe(200);
    expect(app.tg.sent.filter((s) => s.kind === 'message')).toHaveLength(1);
  });
  it('aprobación cuyo envío de borrador falla: el reintento no duplica la aprobación y /borrador recupera', async () => {
    const app = makeApp();
    await app.msg(A, '/muestra');
    const ap = app.tg.last('message')!.keyboard![0][0].callback_data;
    const u = { update_id: 500, callback_query: { id: 'c', from: { id: A }, data: ap, message: { chat: { id: A, type: 'private' } } } };
    app.tg.failNext = 1; // falla el mensaje "Aprobaste…" tras registrar la aprobación
    expect((await app.post(u)).status).toBe(500);
    expect(verRow(app, A)!.approved_version).toBe(1);
    expect((await app.post(u)).status).toBe(200);
    expect(app.tg.last('callback')!.text).toMatch(/ya estaba aprobada/);
    expect(app.db.db.prepare("SELECT COUNT(*) n FROM history WHERE kind='aprobada'").get()).toEqual({ n: 1 });
    await app.msg(A, '/borrador');
    expect(app.tg.sent.filter((s) => s.kind === 'document')).toHaveLength(1);
  });
  it('tras varios intentos fallidos se rinde con mensaje honesto y 200 (no cicla)', async () => {
    const app = makeApp();
    const u = { update_id: 99, message: { message_id: 1, chat: { id: A, type: 'private' }, text: '/muestra' } };
    app.tg.failNext = LIMITS.maxUpdateAttempts;
    for (let i = 0; i < LIMITS.maxUpdateAttempts; i++) expect((await app.post(u)).status).toBe(500);
    const r = await app.post(u);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ gaveUp: true });
    expect(app.tg.last('message')!.text).toMatch(/prueba con un CSV/);
  });
});

describe('aislamiento entre chats y permisos de botones', () => {
  it('dos chats no se cruzan; el botón de A no sirve en B; callback de otro usuario se rechaza', async () => {
    const app = makeApp();
    await app.msg(A, '/muestra');
    const apA = app.tg.last('message')!.keyboard![0][0].callback_data;
    await app.doc(B, 'b.csv', fx('inventario-invalido.csv'));
    expect(verRow(app, A)!.session_id).not.toBe(verRow(app, B)!.session_id);

    await app.click(B, apA); // B reenvía el callback de A en su propio chat
    expect(app.tg.last('callback')!.text).toMatch(/ya no existe/);
    await app.click(A, apA, B); // usuario B pulsa en el chat de A
    expect(app.tg.last('callback')!.text).toMatch(/no permitida/);
    expect(verRow(app, A)!.approved_version).toBeNull();
    expect(verRow(app, B)!.approved_version).toBeNull();

    await app.msg(B, '/historial');
    expect(app.tg.last('message')!.text).not.toMatch(/muestra ficticia/);
    expect(app.tg.last('message')!.chatId).toBe(B);
  });
  it('callbacks alterados o con formato inválido se rechazan', async () => {
    const app = makeApp();
    await app.msg(A, '/muestra');
    for (const d of ['ap:zzzz:1', 'ap:10000001:999999999', 'borrar_todo', 'aj:../../', '']) {
      await app.click(A, d);
      expect(app.tg.last('callback')!.text).toMatch(/no válido|ya no existe|versión vieja/);
    }
    expect(verRow(app, A)!.approved_version).toBeNull();
  });
  it('grupos: no responde ni guarda nada', async () => {
    const app = makeApp();
    await app.post({ update_id: 5, message: { message_id: 1, chat: { id: -100, type: 'group' }, from: { id: A }, text: '/muestra' } });
    expect(app.tg.sent).toHaveLength(0);
    expect(app.db.count('sessions')).toBe(0);
  });
  it('no guarda nombre, username ni teléfono', async () => {
    const app = makeApp();
    await app.post({ update_id: 6, message: { message_id: 1, chat: { id: A, type: 'private', first_name: 'NombreSecreto', username: 'usuario_x' }, from: { id: A, first_name: 'NombreSecreto', username: 'usuario_x' }, text: '/muestra' } });
    const dump = JSON.stringify(['sessions', 'history', 'updates', 'counters'].map((t) => app.db.db.prepare(`SELECT * FROM ${t}`).all()));
    expect(dump).not.toMatch(/NombreSecreto|usuario_x/);
  });
});

describe('límites en código (reserva antes de llamar)', () => {
  it('3 llamadas IA por minuto por chat; la 4ª cae a «sin IA» sin llamar al proveedor', async () => {
    const app = makeApp();
    for (let i = 0; i < 4; i++) app.llm.queue.push(JSON.stringify({ intent: 'ayuda', pct: null, alcance: null, objetivo: null }));
    for (let i = 0; i < 4; i++) await app.msg(A, 'hola');
    expect(app.llm.calls).toHaveLength(3);
    expect(app.tg.last('message')!.text).toMatch(/^\(sin IA\) Llegaste al límite de IA \(por minuto\)/);
    // Otro chat no se ve afectado
    await app.msg(B, 'hola');
    expect(app.llm.calls).toHaveLength(4);
    app.advance(61_000);
    await app.msg(A, 'hola');
    expect(app.tg.last('message')!.text).toMatch(/^\(sin IA\)/); // cola vacía del doble → fallo → plantilla
  });
  it('20 por día por chat', async () => {
    const app = makeApp();
    for (let i = 0; i < 21; i++) {
      app.llm.queue.push(JSON.stringify({ intent: 'ayuda', pct: null, alcance: null, objetivo: null }));
      await app.msg(A, 'hola');
      app.advance(61_000);
    }
    expect(app.llm.calls).toHaveLength(20);
    expect(app.tg.last('message')!.text).toMatch(/límite de IA \(diario\)/);
  });
  it('300 por día global y tope total MAX_AI_CALLS_TOTAL', async () => {
    const app = makeApp();
    const day = new Date(Date.parse('2026-11-25T18:00:00Z')).toISOString().slice(0, 10);
    app.db.db.prepare('INSERT INTO counters (key, count, expires_at) VALUES (?, ?, ?)').run(`ai:global:${day}`, LIMITS.aiPerDayGlobal, Date.now() * 2);
    await app.msg(A, 'hola');
    expect(app.llm.calls).toHaveLength(0);
    expect(app.tg.last('message')!.text).toMatch(/global diario/);

    const app2 = makeApp({ maxTotal: '2' });
    for (let i = 0; i < 3; i++) {
      app2.llm.queue.push(JSON.stringify({ intent: 'ayuda', pct: null, alcance: null, objetivo: null }));
      await app2.msg(i, 'hola');
    }
    expect(app2.llm.calls).toHaveLength(2);
    expect(app2.tg.last('message')!.text).toMatch(/total de la demo/);
  });
  it('reserva concurrente: nunca excede el límite', async () => {
    const app = makeApp();
    for (let i = 0; i < 10; i++) app.llm.queue.push(JSON.stringify({ intent: 'ayuda', pct: null, alcance: null, objetivo: null }));
    await Promise.all(Array.from({ length: 10 }, () => app.msg(A, 'hola')));
    expect(app.llm.calls.length).toBe(3);
  });
  it('5 archivos por día por chat', async () => {
    const app = makeApp();
    for (let i = 0; i < 6; i++) await app.doc(A, 'x.csv', fx('inventario-sin-faltantes.csv'));
    expect(app.tg.last('message')!.text).toMatch(/límite de 5 archivos/);
  });
  it('/limites informa uso', async () => {
    const app = makeApp();
    await app.msg(A, '/limites');
    expect(app.tg.last('message')!.text).toMatch(/IA: 0\/20 por día/);
  });
});

describe('archivos hostiles y XLSX', () => {
  const cases: [string, Uint8Array, RegExp][] = [
    ['vacio.csv', new Uint8Array(), /vacío/],
    ['falso.xlsx', new TextEncoder().encode('insumo,unidad\n'), /no lo es/],
    ['renombrado.csv', xlsxBytes([['insumo']]), /no es texto/],
    ['binario.csv', new Uint8Array([0xff, 0xfe, 0x00, 0x41]), /UTF-8/],
    ['malware.exe', new Uint8Array([1, 2, 3]), /Solo acepto/],
    ['bomba.xlsx', zipBomb(), /se expande demasiado/],
    ['columnas.csv', new TextEncoder().encode('a,b,c\n1,2,3\n'), /Faltan columnas/],
  ];
  for (const [name, bytes, re] of cases) {
    it(`rechaza ${name} con mensaje claro y sin crear sesión`, async () => {
      const app = makeApp();
      await app.doc(A, name, bytes);
      expect(app.tg.last('message')!.text).toMatch(re);
      expect(app.db.count('sessions')).toBe(0);
    });
  }
  it('>200 KB se rechaza antes de descargar', async () => {
    const app = makeApp();
    await app.doc(A, 'grande.csv', new Uint8Array(10), LIMITS.maxFileBytes + 1);
    expect(app.tg.last('message')!.text).toMatch(/200 KB/);
  });
  it('>500 filas se rechaza', async () => {
    const app = makeApp();
    const csv = 'insumo,unidad,existencia,minimo,maximo,proveedor,costo\n' + Array.from({ length: 501 }, (_, i) => `I${i},kg,1,2,5,P,1`).join('\n');
    await app.doc(A, 'filas.csv', new TextEncoder().encode(csv));
    expect(app.tg.last('message')!.text).toMatch(/más de 500 filas/);
  });
  it('XLSX real (primera hoja, valores, no fórmulas) produce la misma propuesta que el CSV', async () => {
    const app = makeApp();
    const text = readFileSync(new URL('../../fixtures/inventario-muestra.csv', import.meta.url), 'utf8').trim();
    const aoa = text.split('\n').map((l, r) => l.split(',').map((c, i) => (r > 0 && i >= 2 && i <= 6 && i !== 5 && c !== '' ? Number(c) : c)));
    await app.doc(A, 'inv.xlsx', xlsxBytes(aoa));
    const t = app.tg.last('message')!.text;
    expect(t).toMatch(/6 insumos bajo mínimo/);
    expect(t).toMatch(/Total estimado: \$6808\.00/);
    expect(t).toMatch(/fila 20 \(Vasos desechables\): proveedor vacío/);
  });
  it('XLSX con fórmula usa el valor calculado guardado', async () => {
    const app = makeApp();
    await app.doc(A, 'f.xlsx', xlsxBytes([['insumo', 'unidad', 'existencia', 'minimo', 'maximo', 'proveedor', 'costo'], ['A', 'kg', 0, 5, 10, 'P', 1]], true));
    expect(app.tg.last('message')!.text).toMatch(/tiene 2, mín 5, máx 10 → pedir 8/);
  });
});

describe('borrado, retención y fecha de corte', () => {
  it('/borrar elimina sesión e historial; botones viejos dejan de servir', async () => {
    const app = makeApp();
    await app.msg(A, '/muestra');
    const ap = app.tg.last('message')!.keyboard![0][0].callback_data;
    await app.msg(B, '/muestra');
    await app.msg(A, '/borrar');
    expect(verRow(app, A)).toBeUndefined();
    expect(app.db.db.prepare('SELECT COUNT(*) n FROM history WHERE chat_id = ?').get(A)).toEqual({ n: 0 });
    expect(verRow(app, B)).toBeDefined();
    await app.click(A, ap);
    expect(app.tg.last('callback')!.text).toMatch(/ya no existe/);
    await app.msg(A, '/aprobar');
    expect(app.tg.last('message')!.text).toMatch(/Aún no hay inventario/);
  });
  it('retención de 7 días', async () => {
    const app = makeApp();
    await app.msg(A, '/muestra');
    app.advance(8 * 86_400_000);
    await app.msg(B, '/start'); // dispara limpieza perezosa
    expect(verRow(app, A)).toBeUndefined();
    expect(app.db.count('history')).toBe(0);
  });
  it('DEMO_UNTIL vencida: solo /borrar funciona; sin fecha también queda cerrada', async () => {
    for (const demoUntil of ['2026-11-01', '']) {
      const app = makeApp({ demoUntil });
      await app.msg(A, '/muestra');
      expect(app.tg.last('message')!.text).toMatch(/demo ya concluyó/);
      expect(app.db.count('sessions')).toBe(0);
      await app.msg(A, '/borrar');
      expect(app.tg.last('message')!.text).toMatch(/borré/);
    }
  });
  it('DEMO_UNTIL solo-fecha vale hasta el fin de ese día en CDMX', async () => {
    const app = makeApp({ demoUntil: '2026-11-25', now: () => Date.parse('2026-11-26T05:30:00Z') }); // 23:30 CDMX
    await app.msg(A, '/start');
    expect(app.tg.last('message')!.text).toMatch(/DEMOSTRACIÓN/);
  });
});

describe('TELEGRAM_API_BASE', () => {
  it('solo admite la API oficial o loopback', async () => {
    const { safeApiBase } = await import('../src/telegram');
    expect(safeApiBase(undefined)).toBe('https://api.telegram.org');
    expect(safeApiBase('http://127.0.0.1:9000')).toBe('http://127.0.0.1:9000');
    expect(() => safeApiBase('https://evil.example')).toThrow();
    expect(() => safeApiBase('http://127.0.0.1.evil.example:80')).toThrow();
  });
});
