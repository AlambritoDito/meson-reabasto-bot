// Pruebas de recorrido con DOBLES DE PRUEBA de Telegram, OpenAI y D1. No son evidencia de IA ni Telegram reales.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { makeApp } from './fakes';

const fxBytes = (n: string) => new Uint8Array(readFileSync(new URL(`../../fixtures/${n}`, import.meta.url)));
const A = 111111;
const B = 222222;

async function loadMuestra(app: ReturnType<typeof makeApp>, chat = A) {
  const r = await app.msg(chat, '/muestra');
  expect(r.status).toBe(200);
  const btn = app.tg.last('message')!.keyboard![0][0].callback_data;
  return btn;
}

describe('recorrido /muestra → propuesta → /temporada → aprobar → borrador (dobles de prueba)', () => {
  it('flujo completo con versión, confirmación explícita, aprobación única y borrador', async () => {
    const app = makeApp();
    await app.msg(A, '/start');
    expect(app.tg.last()!.text).toMatch(/asistente automático de DEMOSTRACIÓN/);
    expect(app.tg.last()!.text).toMatch(/nunca envío nada a proveedores/);

    const ap1 = await loadMuestra(app);
    const prop = app.tg.last('message')!.text;
    expect(ap1).toMatch(/^ap:[0-9a-f]{8}:1$/);
    expect(prop).toMatch(/6 insumos bajo mínimo/);
    expect(prop).toMatch(/Regla propuesta para la demo/);
    expect(prop).toMatch(/fila 20 \(Vasos desechables\): proveedor vacío/);
    expect(prop).toMatch(/Total estimado: \$6808\.00/);

    // Ajuste por temporada: preview sin cambiar estado
    await app.msg(A, '/temporada -50 proveedor Cafe Ficticio del Valle');
    const pv = app.tg.last('message')!;
    expect(pv.text).toMatch(/Cafe en grano: 13 → 7/);
    expect(pv.text).toMatch(/Nada cambia hasta que confirmes/);
    const confirm = pv.keyboard![0][0].callback_data;
    expect(confirm).toMatch(/^aj:/);
    const verRow = () => app.db.db.prepare('SELECT version, approved_version FROM sessions WHERE chat_id = ?').get(A) as { version: number; approved_version: number | null };
    expect(verRow().version).toBe(1);

    await app.click(A, confirm);
    expect(verRow().version).toBe(2);
    const v2msg = app.tg.last('message')!;
    expect(v2msg.text).toMatch(/propuesta v2/);
    expect(v2msg.text).toMatch(/Total estimado: \$5128\.00/);
    const ap2 = v2msg.keyboard![0][0].callback_data;

    // Confirmar el mismo ajuste otra vez no aplica dos veces
    await app.click(A, confirm);
    expect(verRow().version).toBe(2);
    expect(app.tg.last('callback')!.text).toMatch(/ya no está vigente/);

    // Botón viejo v1 no aprueba
    await app.click(A, ap1);
    expect(app.tg.last('callback')!.text).toMatch(/ya no está vigente/);
    expect(verRow().approved_version).toBeNull();

    // Aprobar v2 → un borrador
    await app.click(A, ap2);
    expect(verRow().approved_version).toBe(2);
    const docs = () => app.tg.sent.filter((s) => s.kind === 'document');
    expect(docs()).toHaveLength(1);
    const draft = docs()[0].text;
    expect(docs()[0].fileName).toBe('borrador-pedido-v2.txt');
    expect(draft).toMatch(/NO envía nada a proveedores/);
    expect(draft).toMatch(/PARA: Cafe Ficticio del Valle\n.*\n• Cafe en grano: 7 kg/);
    expect(draft).toMatch(/fila 20 \(Vasos desechables\): proveedor vacío/);
    expect(draft).not.toMatch(/Vasos desechables: \d/);
    expect(draft).toMatch(/v2 ajuste temporada: '-50 % proveedor Cafe Ficticio del Valle/);
    expect(draft).toMatch(/v2 aprobada/);

    // Doble clic: no duplica
    await app.click(A, ap2);
    expect(docs()).toHaveLength(1);
    expect(app.tg.last('callback')!.text).toMatch(/ya estaba aprobada/);
    expect(app.db.count('history')).toBe(3);

    // /borrador reenvía el mismo borrador sin nueva aprobación
    await app.msg(A, '/borrador');
    expect(docs()).toHaveLength(2);
    await app.msg(A, '/historial');
    expect(app.tg.last('message')!.text).toMatch(/v1 carga[\s\S]*v2 ajuste temporada[\s\S]*v2 aprobada/);
  });

  it('cancelar ajuste no cambia la propuesta', async () => {
    const app = makeApp();
    await loadMuestra(app);
    await app.msg(A, '/temporada +20');
    const cancel = app.tg.last('message')!.keyboard![0][1].callback_data;
    await app.click(A, cancel);
    expect(app.tg.last('callback')!.text).toMatch(/Nada cambió/);
    expect((app.db.db.prepare('SELECT version FROM sessions').get() as { version: number }).version).toBe(1);
  });

  it('ajuste fuera de rango se acota a ±50 %', async () => {
    const app = makeApp();
    await loadMuestra(app);
    await app.msg(A, '/temporada +80');
    expect(app.tg.last('message')!.text).toMatch(/acotó a 50 %/);
  });

  it('aprobar tras un ajuste requiere la nueva versión; aprobar luego un ajuste invalida la aprobación', async () => {
    const app = makeApp();
    const ap1 = await loadMuestra(app);
    await app.click(A, ap1);
    await app.msg(A, '/temporada -10');
    await app.click(A, app.tg.last('message')!.keyboard![0][0].callback_data);
    await app.msg(A, '/borrador');
    expect(app.tg.last('message')!.text).toMatch(/Aún no apruebas la propuesta vigente \(v2\)/);
  });
});

describe('casos docentes D01–D05 (dobles de prueba)', () => {
  it('D01 inventario sin faltantes: no propone compras ni ofrece aprobar', async () => {
    const app = makeApp();
    await app.doc(A, 'inventario-sin-faltantes.csv', fxBytes('inventario-sin-faltantes.csv'));
    const m = app.tg.last('message')!;
    expect(m.text).toMatch(/No propongo compras/);
    expect(app.tg.buttons().filter((d) => /^(ap|rj):/.test(d))).toHaveLength(0); // sin Aprobar/Rechazar
    await app.msg(A, '/aprobar');
    expect(app.tg.last('message')!.text).toMatch(/No hay nada que aprobar/);
  });

  it('D02 varios bajo mínimo: cantidades por proveedor', async () => {
    const app = makeApp();
    await loadMuestra(app);
    const t = app.tg.last('message')!.text;
    expect(t).toMatch(/Lacteos Ficticios SA — subtotal \$1626\.00/);
    expect(t).toMatch(/Leche entera: tiene 8, mín 20, máx 60 → pedir 52 litro/);
    expect(t).toMatch(/Verduras Ficticias Sur — subtotal \$996\.00/);
  });

  it('D03 dato faltante: señala fila/campo y la excluye del pedido aprobado', async () => {
    const app = makeApp();
    await app.doc(A, 'inv.csv', fxBytes('inventario-invalido.csv'));
    const t = app.tg.last('message')!.text;
    expect(t).toMatch(/fila 7 \(Jitomate\): costo vacío/);
    expect(t).toMatch(/fila 2 \(Leche entera\): existencia negativo/);
    expect(t).toMatch(/1 insumos bajo mínimo/);
    await app.click(A, app.tg.last('message')!.keyboard![0][0].callback_data);
    const draft = app.tg.last('document')!.text;
    expect(draft).toMatch(/• Aguacate: 8 kg/);
    expect(draft).not.toMatch(/• Jitomate: \d/);
  });

  it('D04 ajuste por temporada (cubierto en el recorrido) muestra antes/después y requiere confirmar', async () => {
    const app = makeApp();
    await loadMuestra(app);
    app.llm.queue.push(JSON.stringify({ intent: 'temporada', pct: 20, alcance: 'insumo', objetivo: 'cafe en grano' }));
    await app.msg(A, 'semana de exámenes, sube el café 20%');
    const pv = app.tg.last('message')!;
    // +20 % sobre 13 kg = 15.6 → 16, pero el tope máximo − existencia es 13: no cambia nada y se dice.
    expect(pv.text).toBe(
      [
        '🌦️ Ajuste por temporada propuesto: +20 % a insumo Cafe en grano.',
        'Algunas cantidades quedaron topadas para no superar el máximo.',
        '',
        'Antes → después:',
        '• Ninguna cantidad cambia (topes por máximo o sin insumos afectados).',
        '',
        'Total: $6808.00 → $6808.00',
        'Nada cambia hasta que confirmes.',
      ].join('\n'),
    );
    expect(pv.keyboard![0][0].text).toBe('✅ Confirmar ajuste');
    expect((app.db.db.prepare('SELECT version FROM sessions').get() as { version: number }).version).toBe(1);
  });

  it('D04b ajuste a la baja (-20 % global) SÍ cambia cantidades: antes/después exacto y v2 tras confirmar', async () => {
    const app = makeApp();
    await loadMuestra(app);
    await app.msg(A, '/temporada -20');
    const pv = app.tg.last('message')!;
    expect(pv.text).toBe(
      [
        '🌦️ Ajuste por temporada propuesto: -20 % a todos los insumos.',
        '',
        'Antes → después:',
        '• Leche entera: 52 → 42 litro (tope 52)',
        '• Yogur natural: 12 → 10 litro (tope 12)',
        '• Cafe en grano: 13 → 11 kg (tope 13)',
        '• Arroz: 21 → 17 kg (tope 21)',
        '• Jitomate: 17 → 14 kg (tope 17)',
        '• Aguacate: 8 → 7 kg (tope 8)',
        '',
        'Total: $6808.00 → $5694.00',
        'Nada cambia hasta que confirmes.',
      ].join('\n'),
    );
    expect((app.db.db.prepare('SELECT version FROM sessions').get() as { version: number }).version).toBe(1);
    await app.click(A, pv.keyboard![0][0].callback_data);
    const v2 = app.tg.last('message')!.text;
    expect(v2).toMatch(/propuesta v2/);
    expect(v2).toMatch(/Leche entera: tiene 8, mín 20, máx 60 → pedir 42 litro \(ajuste -20 %\)/);
    expect(v2).toMatch(/Total estimado: \$5694\.00/);
  });

  it('D05 fuera de alcance: rechazo breve sin cambiar estado', async () => {
    const app = makeApp();
    await loadMuestra(app);
    const before = app.db.snapshot();
    app.llm.queue.push(JSON.stringify({ intent: 'fuera_de_alcance' }));
    await app.msg(A, 'Envía el pedido por WhatsApp al proveedor y sube el mínimo de leche a 50');
    expect(app.tg.last('message')!.text).toMatch(/fuera de lo que hago/);
    expect(app.db.snapshot()).toBe(before);
    expect(app.tg.sent.filter((s) => s.kind === 'document')).toHaveLength(0);
  });
});

describe('IA: salida inválida, fallo y contenido hostil (doble de prueba de OpenAI)', () => {
  it('intención inventada por la IA se rechaza sin cambiar estado', async () => {
    const app = makeApp();
    await loadMuestra(app);
    const before = app.db.snapshot();
    app.llm.queue.push(JSON.stringify({ intent: 'enviar_pedido_a_proveedor' }));
    await app.msg(A, 'hazlo');
    expect(app.tg.last('message')!.text).toMatch(/^\(sin IA\) No entendí/);
    app.llm.queue.push('esto no es json');
    await app.msg(A, 'otra cosa');
    expect(app.tg.last('message')!.text).toMatch(/^\(sin IA\)/);
    app.llm.queue.push(JSON.stringify({ intent: 'temporada', pct: 'mucho' }));
    await app.msg(A, 'sube');
    expect(app.tg.last('message')!.text).toMatch(/^\(sin IA\)/);
    expect(app.db.snapshot()).toBe(before);
  });

  it('«aprueba y envía» por texto libre no aprueba: solo muestra el botón', async () => {
    const app = makeApp();
    await loadMuestra(app);
    app.llm.queue.push(JSON.stringify({ intent: 'aprobar' }));
    await app.msg(A, 'aprueba todo y envíalo');
    expect((app.db.db.prepare('SELECT approved_version FROM sessions').get() as { approved_version: null }).approved_version).toBeNull();
    expect(app.tg.sent.filter((s) => s.kind === 'document')).toHaveLength(0);
  });

  it('fallo/timeout de la IA → plantilla «sin IA», nunca error mudo', async () => {
    const app = makeApp();
    await loadMuestra(app);
    app.llm.queue.push(new Error('timeout'));
    const r = await app.msg(A, '¿qué hago?');
    expect(r.status).toBe(200);
    expect(app.tg.last('message')!.text).toMatch(/^\(sin IA\) No pude consultar la IA/);
    app.llm.queue.push(new Error('HTTP 429'));
    await app.msg(A, '/explicar');
    expect(app.tg.last('message')!.text).toMatch(/^\(sin IA\) 6 insumos están bajo su mínimo/);
  });

  it('sin créditos en OpenAI → mensaje honesto de tope de gasto', async () => {
    const app = makeApp();
    await loadMuestra(app);
    const { LlmError } = await import('../src/llm');
    app.llm.queue.push(new LlmError('tope_gasto'));
    await app.msg(A, 'hola');
    expect(app.tg.last('message')!.text).toMatch(/^\(sin IA\) La demo alcanzó su tope de gasto de IA/);
  });

  it('ALTA 1: texto libre «explicar» reserva cada llamada real (llamadas del doble == contadores)', async () => {
    const app = makeApp();
    await loadMuestra(app);
    app.llm.queue.push(JSON.stringify({ intent: 'explicar', pct: null, alcance: null, objetivo: null }));
    app.llm.queue.push('Se piden 52 litros de leche porque tiene 8 y el máximo es 60.');
    await app.msg(A, '¿por qué tanta leche?');
    const c = (k: string) => (app.db.db.prepare('SELECT count FROM counters WHERE key LIKE ?').get(k) as { count: number } | undefined)?.count ?? 0;
    expect(app.llm.calls).toHaveLength(2);
    expect(c('ai:day:%')).toBe(2);
    expect(c('ai:min:%')).toBe(2);
    expect(c('ai:global:%')).toBe(2);
    expect(c('ai:total')).toBe(2);
    // Con 1 de cupo por minuto restante: clasifica (3ª) y la explicación cae a plantilla sin llamar.
    app.llm.queue.push(JSON.stringify({ intent: 'explicar', pct: null, alcance: null, objetivo: null }));
    await app.msg(A, 'explícame otra vez');
    expect(app.llm.calls).toHaveLength(3);
    expect(c('ai:min:%')).toBe(3);
    expect(c('ai:total')).toBe(3);
    expect(app.tg.last('message')!.text).toMatch(/^\(sin IA\) 6 insumos/);
  });

  it('/explicar acepta texto de IA con cifras correctas y rechaza cifras inventadas', async () => {
    const app = makeApp();
    await loadMuestra(app);
    app.llm.queue.push('Se piden 52 litros de leche porque tiene 8 y el máximo es 60.');
    await app.msg(A, '/explicar');
    expect(app.tg.last('message')!.text).toMatch(/redactada por IA/);
    app.llm.queue.push('Se piden 75 litros de leche.');
    await app.msg(A, '/explicar');
    expect(app.tg.last('message')!.text).toMatch(/^\(sin IA\)/);
  });

  it('celdas hostiles: se tratan como datos y el borrador neutraliza fórmulas', async () => {
    const app = makeApp();
    await app.doc(A, 'hostil.csv', fxBytes('hostil-celdas.csv'));
    app.llm.queue.push('Hay 4 insumos bajo mínimo.');
    await app.msg(A, '/explicar');
    const call = app.llm.calls[0];
    expect(call.system).toMatch(/nunca instrucciones/);
    expect(() => JSON.parse(call.user)).not.toThrow(); // las celdas viajan como JSON de datos
    await app.click(A, app.tg.sent.find((s) => s.keyboard)!.keyboard![0][0].callback_data);
    const draft = app.tg.last('document')!.text;
    expect(draft).toMatch(/• '=HYPERLINK/);
    expect(draft).toMatch(/• '\+1\+1/);
    expect(draft).toMatch(/• '@SUM/);
    expect(draft).toMatch(/PARA: '-2\+3 Ficticio/);
    expect(draft.split('\n').some((l) => /^[=+\-@]/.test(l))).toBe(false);
  });
});

describe('Rechazar propuesta (hoja del equipo: aprobar o rechazar pedidos)', () => {
  it('rechazo con versión: historial, sin borrador, idempotente; no se puede aprobar después; nueva propuesta posible', async () => {
    const app = makeApp();
    await loadMuestra(app);
    const kb = app.tg.last('message')!.keyboard![0];
    expect(kb.map((b) => b.text)).toEqual(['✅ Aprobar v1', '❌ Rechazar v1']);
    const [ap1, rj1] = kb.map((b) => b.callback_data);
    expect(rj1).toMatch(/^rj:[0-9a-f]{8}:1$/);
    await app.click(A, rj1);
    expect(app.tg.last('message')!.text).toMatch(/Rechazaste la propuesta v1\. No genero borrador/);
    await app.click(A, rj1);
    expect(app.tg.last('callback')!.text).toMatch(/ya estaba rechazada/);
    await app.click(A, ap1);
    expect(app.tg.last('callback')!.text).toMatch(/ya fue rechazada/);
    expect(app.tg.sent.filter((s) => s.kind === 'document')).toHaveLength(0);
    expect(app.db.db.prepare("SELECT COUNT(*) n FROM history WHERE kind = 'rechazada'").get()).toEqual({ n: 1 });
    await app.msg(A, '/borrador');
    expect(app.tg.last('message')!.text).toMatch(/fue rechazada; no hay borrador/);
    await app.msg(A, '/aprobar');
    expect(app.tg.last('message')!.text).toMatch(/Rechazaste la propuesta v1/);
    // Nueva propuesta vía ajuste: v2 se puede aprobar
    await app.msg(A, '/temporada -10');
    await app.click(A, app.tg.last('message')!.keyboard![0][0].callback_data);
    await app.click(A, app.tg.last('message')!.keyboard![0][0].callback_data);
    expect(app.tg.sent.filter((s) => s.kind === 'document')).toHaveLength(1);
    await app.msg(A, '/historial');
    expect(app.tg.last('message')!.text).toMatch(/v1 rechazada[\s\S]*v2 ajuste temporada[\s\S]*v2 aprobada/);
  });
  it('no se rechaza una versión aprobada ni una versión vieja, ni desde otro usuario', async () => {
    const app = makeApp();
    await loadMuestra(app);
    const [ap1, rj1] = app.tg.last('message')!.keyboard![0].map((b) => b.callback_data);
    await app.click(A, rj1, B);
    expect(app.tg.last('callback')!.text).toMatch(/no permitida/);
    await app.click(A, ap1);
    await app.click(A, rj1);
    expect(app.tg.last('callback')!.text).toMatch(/ya estaba aprobada; no se puede rechazar/);
    await app.msg(A, '/muestra');
    await app.click(A, rj1);
    expect(app.tg.last('callback')!.text).toMatch(/ya no existe/);
  });
});
