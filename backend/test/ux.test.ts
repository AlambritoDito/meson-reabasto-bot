// UX estilo BotFather con DOBLES DE PRUEBA (Telegram, IA y D1 simulados). No es evidencia de Telegram real.
import { describe, it, expect } from 'vitest';
import { makeApp, assertValidHtml } from './fakes';
import { isKnownCallback } from '../src/ui';
import { fitHtml } from '../src/telegram';

const A = 111111;
const B = 222222;
const enc = (s: string) => new TextEncoder().encode(s);
const datas = (kb?: { callback_data: string }[][]) => (kb ?? []).flat().map((b) => b.callback_data);
const ver = (app: ReturnType<typeof makeApp>) => (app.db.db.prepare('SELECT version FROM sessions WHERE chat_id = ?').get(A) as { version: number } | undefined)?.version;

describe('menú principal según el estado', () => {
  it('/start sin inventario: solo cargar, subir, límites y ayuda', async () => {
    const app = makeApp();
    await app.msg(A, '/start');
    const m = app.tg.last('message')!;
    expect(m.text).toMatch(/asistente automático de DEMOSTRACIÓN/);
    expect(datas(m.keyboard)).toEqual(['m:load', 'm:upl', 'm:lim', 'm:help']);
    expect(m.keyboard!.every((r) => r.length <= 2)).toBe(true); // 2 columnas
  });
  it('con propuesta: ver, decidir, explicar, ajustar; aprobada: descargar; rechazada: sin aprobar ni descargar', async () => {
    const app = makeApp();
    await app.msg(A, '/muestra');
    await app.msg(A, '/menu');
    const d1 = datas(app.tg.last('message')!.keyboard);
    expect(d1).toEqual(expect.arrayContaining(['m:prop', 'm:alr', 'm:exp', 'm:tmp', 'm:his', 'm:del']));
    expect(d1).not.toContain('m:dl');
    await app.click(A, 'm:prop');
    const ap = datas(app.tg.last('message')!.keyboard).find((d) => d.startsWith('ap:'))!;
    await app.click(A, ap);
    await app.msg(A, '/menu');
    expect(datas(app.tg.last('message')!.keyboard)).toContain('m:dl');

    const app2 = makeApp();
    await app2.msg(A, '/muestra');
    const rj = datas(app2.tg.last('message')!.keyboard).find((d) => d.startsWith('rj:'))!;
    await app2.click(A, rj);
    await app2.msg(A, '/menu');
    const d3 = datas(app2.tg.last('message')!.keyboard);
    expect(d3).not.toContain('m:dl');
    expect(d3).toContain('m:tmp');
  });
});

describe('navegación: las vistas editan el mensaje del menú', () => {
  it('botones del menú editan (editMessageText) con «Volver»; siempre se responde el callback', async () => {
    const app = makeApp();
    await app.msg(A, '/start');
    await app.click(A, 'm:help', A, 77);
    let e = app.tg.shown()!;
    expect(e.kind).toBe('edit');
    expect(e.messageId).toBe(77);
    expect(e.text).toMatch(/Ayuda/);
    expect(datas(e.keyboard)).toEqual(['m:home']);
    await app.click(A, 'm:upl', A, 77);
    e = app.tg.shown()!;
    expect(e.kind).toBe('edit');
    expect(e.text).toMatch(/clip 📎/);
    await app.click(A, 'm:load', A, 77);
    e = app.tg.last('message')!;
    expect(e.kind).toBe('edit');
    expect(e.text).toMatch(/6 insumos bajo mínimo/);
    await app.click(A, 'm:alr', A, 77);
    expect(app.tg.last('message')!.text).toMatch(/🚨 Leche entera: tiene 8, mín 20 litro/);
    expect(app.tg.last('message')!.text).toMatch(/⚠️ Filas excluidas/);
    await app.click(A, 'm:home', A, 77);
    expect(app.tg.last('message')!.text).toMatch(/Menú principal/);
    const clicks = 5;
    expect(app.tg.sent.filter((s) => s.kind === 'callback')).toHaveLength(clicks);
    expect(app.tg.sent.filter((s) => s.kind === 'message')).toHaveLength(1); // solo el /start
  });
  it('si no se puede editar, envía un mensaje nuevo', async () => {
    const app = makeApp();
    app.tg.editFails = 1;
    await app.click(A, 'm:help');
    expect(app.tg.shown()!.kind).toBe('message');
    expect(app.tg.shown()!.text).toMatch(/Ayuda/);
  });
  it('documentos y aprobación van como mensajes nuevos', async () => {
    const app = makeApp();
    await app.msg(A, '/muestra');
    const ap = datas(app.tg.last('message')!.keyboard).find((d) => d.startsWith('ap:'))!;
    await app.click(A, ap);
    const tail = app.tg.sent.filter((x) => x.kind !== 'callback').slice(-2);
    expect(tail.map((x) => x.kind)).toEqual(['message', 'document']);
    await app.click(A, 'm:dl');
    expect(app.tg.sent.filter((x) => x.kind === 'document')).toHaveLength(2);
  });
});

describe('temporada sin teclear (botones)', () => {
  it('alcance → proveedor → porcentaje → antes/después → confirmar → v2; botones viejos no valen', async () => {
    const app = makeApp();
    await app.msg(A, '/muestra');
    await app.click(A, 'm:tmp');
    const scope = datas(app.tg.last('message')!.keyboard);
    const tl = scope.find((d) => /^tl:.*:p:0$/.test(d))!;
    await app.click(A, tl);
    const list = app.tg.last('message')!;
    expect(list.keyboard!.flat().map((b) => b.text)).toEqual(expect.arrayContaining(['Lacteos Ficticios SA', 'Cafe Ficticio del Valle', 'Abarrotes Ficticios', 'Verduras Ficticias Sur']));
    const cafe = list.keyboard!.flat().find((b) => b.text === 'Cafe Ficticio del Valle')!.callback_data;
    await app.click(A, cafe);
    const pct = app.tg.last('message')!;
    expect(pct.text).toMatch(/proveedor Cafe Ficticio del Valle/);
    expect(pct.keyboard!.slice(0, 2).flat().map((b) => b.text)).toEqual(['−50 %', '−30 %', '−20 %', '−10 %', '+10 %', '+20 %', '+30 %', '+50 %']);
    const m50 = datas(pct.keyboard).find((d) => d.endsWith(':-50'))!;
    await app.click(A, m50);
    const pv = app.tg.last('message')!;
    expect(pv.kind).toBe('edit');
    expect(pv.text).toMatch(/Cafe en grano: 13 → 7 kg/);
    expect(ver(app)).toBe(1);
    await app.click(A, datas(pv.keyboard).find((d) => d.startsWith('aj:'))!);
    expect(ver(app)).toBe(2);
    expect(app.tg.last('message')!.text).toMatch(/Propuesta v2[\s\S]*Total estimado: \$5128\.00/);
    // botón de porcentaje de la v1: ya no vigente, sin cambios
    await app.click(A, m50);
    expect(app.tg.last('callback')!.text).toMatch(/ya no está vigente/);
    expect(ver(app)).toBe(2);
  });
  it('«Todo» −20 % y cancelar no cambia nada', async () => {
    const app = makeApp();
    await app.msg(A, '/muestra');
    await app.click(A, 'm:tmp');
    await app.click(A, datas(app.tg.last('message')!.keyboard).find((d) => d.startsWith('tg:'))!);
    await app.click(A, datas(app.tg.last('message')!.keyboard).find((d) => d.endsWith(':g:0:-20'))!);
    const pv = app.tg.last('message')!;
    expect(pv.text).toMatch(/Total: \$6808\.00 → \$5694\.00/);
    await app.click(A, datas(pv.keyboard).find((d) => d.startsWith('ac:'))!);
    expect(ver(app)).toBe(1);
    expect(app.tg.last('message')!.text).toMatch(/Propuesta v1/);
  });
  it('lista de insumos paginada y con índices resueltos contra la sesión del propio chat', async () => {
    const app = makeApp();
    const rows = Array.from({ length: 11 }, (_, i) => `Insumo ${i + 1},kg,1,5,10,Prov ${i % 3},2`).join('\n');
    await app.doc(A, 'x.csv', enc(`insumo,unidad,existencia,minimo,maximo,proveedor,costo\n${rows}\n`));
    await app.click(A, 'm:tmp');
    await app.click(A, datas(app.tg.last('message')!.keyboard).find((d) => /^tl:.*:i:0$/.test(d))!);
    const p1 = app.tg.last('message')!;
    expect(p1.text).toMatch(/página 1 de 2/);
    expect(p1.keyboard!.flat().filter((b) => b.callback_data.startsWith('tx:'))).toHaveLength(8);
    await app.click(A, datas(p1.keyboard).find((d) => /:i:1$/.test(d) && d.startsWith('tl:'))!);
    const p2 = app.tg.last('message')!;
    expect(p2.keyboard!.flat().filter((b) => b.callback_data.startsWith('tx:')).map((b) => b.text)).toEqual(['Insumo 9', 'Insumo 10', 'Insumo 11']);
    // índice fuera de rango o de otro chat: no se resuelve
    const sid = (app.db.db.prepare('SELECT session_id FROM sessions WHERE chat_id = ?').get(A) as { session_id: string }).session_id;
    await app.click(A, `tx:${sid}:1:i:99`);
    expect(app.tg.last('callback')!.text).toMatch(/ya no está vigente/);
    await app.msg(B, '/muestra');
    await app.click(B, `tp:${sid}:1:i:0:+10`); // B usa el id de sesión de A
    expect(app.tg.last('callback')!.text).toMatch(/ya no existe/);
  });
  it('el comando de texto y el texto libre con IA siguen funcionando', async () => {
    const app = makeApp();
    await app.msg(A, '/muestra');
    await app.msg(A, '/temporada -20');
    expect(app.tg.last('message')!.text).toMatch(/\$5694\.00/);
    app.llm.queue.push(JSON.stringify({ intent: 'temporada', pct: -10, alcance: 'insumo', objetivo: 'arroz' }));
    await app.msg(A, 'baja 10% el arroz');
    expect(app.tg.last('message')!.text).toMatch(/Arroz: 21 → 19 kg/);
  });
});

describe('borrar con confirmación', () => {
  it('cancelar conserva datos; confirmar borra', async () => {
    const app = makeApp();
    await app.msg(A, '/muestra');
    await app.click(A, 'm:del');
    expect(app.tg.last('message')!.text).toMatch(/¿Borrar tus datos/);
    await app.click(A, 'm:home');
    expect(ver(app)).toBe(1);
    await app.click(A, 'm:del');
    await app.click(A, 'del:y');
    expect(ver(app)).toBeUndefined();
    expect(datas(app.tg.last('message')!.keyboard)).toEqual(['m:load', 'm:upl', 'm:lim', 'm:help']);
  });
});

describe('seguridad de callbacks', () => {
  it('callback inválido, alterado, demasiado largo o de otro usuario: rechazado sin cambio de estado', async () => {
    const app = makeApp();
    await app.msg(A, '/muestra');
    const before = app.db.snapshot();
    for (const d of ['m:hack', 'tp:10000001:1:g:0:+15', 'tp:10000001:1:g:0:+500', 'del:yes', 'x'.repeat(65), 'm:home; DROP']) {
      await app.click(A, d);
      expect(app.tg.last('callback')!.text).toBe('Botón no válido.');
    }
    await app.click(A, 'm:load', B);
    expect(app.tg.last('callback')!.text).toBe('Acción no permitida.');
    expect(app.db.snapshot()).toBe(before);
  });
  it('todo callback_data generado mide ≤64 bytes y está en la lista cerrada', async () => {
    const app = makeApp();
    await app.msg(A, '/start');
    await app.msg(A, '/muestra');
    for (const d of ['m:home', 'm:tmp', 'm:prop', 'm:del', 'm:help', 'm:alr', 'm:lim', 'm:upl']) await app.click(A, d);
    await app.click(A, datas(app.tg.sent.find((s) => datas(s.keyboard).some((x) => x.startsWith('tl:')))!.keyboard).find((x) => /:p:0$/.test(x))!);
    const all = app.tg.buttons();
    expect(all.length).toBeGreaterThan(20);
    for (const d of all) {
      expect(enc(d).length).toBeLessThanOrEqual(64);
      expect(isKnownCallback(d)).toBe(true);
    }
  });
});

describe('HTML seguro', () => {
  it('nombres hostiles se escapan y el HTML es válido para parse_mode HTML', async () => {
    const app = makeApp();
    const csv = 'insumo,unidad,existencia,minimo,maximo,proveedor,costo\n"<b>Pan</b> & <a href=x>",kg,1,5,10,"A<B & Co",2\n<i>Sal,<u>kg,1,5,10,P&lt;,3\n';
    await app.doc(A, 'h<tml>.csv', enc(csv));
    const m = app.tg.last('message')!;
    expect(m.html).toContain('&lt;b&gt;Pan&lt;/b&gt; &amp; &lt;a href=x&gt;');
    expect(m.html).toContain('A&lt;B &amp; Co');
    expect(m.html).toContain('P&amp;lt;');
    expect(m.html).not.toMatch(/<(a|u|script)\b/);
    expect(m.text).toMatch(/<b>Pan<\/b> & <a href=x>/); // lo que ve la persona es el texto original
    await app.click(A, 'm:alr');
    await app.click(A, 'm:tmp');
    await app.click(A, datas(app.tg.last('message')!.keyboard).find((d) => /^tl:.*:p:0$/.test(d))!);
    await app.click(A, datas(app.tg.last('message')!.keyboard).find((d) => d.startsWith('tx:'))!);
    expect(app.tg.last('message')!.html).toContain('&lt;');
    // el fake valida cada mensaje con assertValidHtml; si algo no se escapara, la prueba lanzaría
  });
  it('fitHtml recorta por líneas y deja HTML válido', () => {
    const big = Array.from({ length: 400 }, (_, i) => `• <b>línea ${i}</b> con texto`).join('\n');
    const out = fitHtml(big);
    expect(out.length).toBeLessThanOrEqual(4000);
    expect(() => assertValidHtml(out)).not.toThrow();
    expect(out).toMatch(/mensaje recortado/);
  });
});
