// Poller probado con fetch FALSO (Telegram y Worker simulados). No es evidencia de Telegram real.
import { describe, it, expect } from 'vitest';
// @ts-expect-error módulo JS sin tipos
import { pollOnce, parseDevVars, runPoller } from '../scripts/poll.mjs';

const TOKEN = 'TOKEN-FALSO-123';
function fakeFetch(updates: { update_id: number }[], workerStatus: (id: number) => number | 'down') {
  const calls: { url: string; body: unknown; headers: Record<string, string> }[] = [];
  const fn = async (url: string, init: RequestInit) => {
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, body, headers: init.headers as Record<string, string> });
    if (url.includes('/getUpdates')) return new Response(JSON.stringify({ ok: true, result: updates.filter((u) => body.offset === undefined || u.update_id >= body.offset) }));
    if (url.includes('/deleteWebhook')) return new Response(JSON.stringify({ ok: true, result: true }));
    const s = workerStatus(body.update_id);
    if (s === 'down') throw new Error('ECONNREFUSED');
    return new Response('{}', { status: s });
  };
  return { fn, calls };
}

describe('poller (fetch falso)', () => {
  it('reenvía en orden con el secreto y avanza offset solo con 2xx', async () => {
    const f = fakeFetch([{ update_id: 10 }, { update_id: 11 }, { update_id: 12 }], (id) => (id === 12 ? 500 : 200));
    const r = await pollOnce({ fetchFn: f.fn, token: TOKEN, workerUrl: 'http://127.0.0.1:8787/tg', secret: 's3', offset: undefined });
    expect(r).toEqual({ offset: 12, count: 3, failed: true });
    const fwd = f.calls.filter((c) => c.url.endsWith('/tg'));
    expect(fwd.map((c) => (c.body as { update_id: number }).update_id)).toEqual([10, 11, 12]);
    expect(fwd[0].headers['x-telegram-bot-api-secret-token']).toBe('s3');
    // siguiente vuelta pide desde 12 (no pierde el que falló)
    const r2 = await pollOnce({ fetchFn: fakeFetch([{ update_id: 12 }], () => 200).fn, token: TOKEN, workerUrl: 'x', secret: 's', offset: r.offset });
    expect(r2.offset).toBe(13);
  });
  it('Worker caído: no avanza', async () => {
    const f = fakeFetch([{ update_id: 5 }], () => 'down');
    const r = await pollOnce({ fetchFn: f.fn, token: TOKEN, workerUrl: 'x', secret: 's', offset: 5 });
    expect(r).toMatchObject({ offset: 5, failed: true });
  });
  it('runPoller llama deleteWebhook una vez, no imprime el token y se detiene con abort', async () => {
    const f = fakeFetch([], () => 200);
    const logs: string[] = [];
    const ctrl = new AbortController();
    let polls = 0;
    const fn = async (url: string, init: RequestInit) => {
      if (url.includes('getUpdates') && ++polls >= 2) ctrl.abort();
      if (url.includes('getUpdates') && polls === 1) throw new Error(`fallo con ${url}`); // error con URL que contiene token
      return f.fn(url, init);
    };
    await runPoller({ fetchFn: fn, token: TOKEN, workerUrl: 'x', secret: 's', signal: ctrl.signal, log: (m: string) => logs.push(m), sleep: async () => {} });
    expect(f.calls.filter((c) => c.url.includes('deleteWebhook'))).toHaveLength(1);
    expect(logs.join('\n')).not.toContain(TOKEN);
    expect(logs.join('\n')).toMatch(/detenido/);
  });
  it('parseDevVars lee claves y omite comentarios', () => {
    expect(parseDevVars('# c\nA=1\nB="dos"\n\nC=\n')).toEqual({ A: '1', B: 'dos', C: '' });
  });
});

describe('configuración nativa del bot (fetch falso)', () => {
  it('registra comandos (por defecto y es), botón de menú y descripciones dentro de los límites de Telegram', async () => {
    // @ts-expect-error módulo JS sin tipos
    const { configureBot, BOT_COMMANDS, BOT_DESCRIPTION, BOT_SHORT_DESCRIPTION } = await import('../scripts/poll.mjs');
    const calls: { method: string; body: Record<string, unknown> }[] = [];
    const fn = async (url: string, init: RequestInit) => {
      calls.push({ method: url.split('/').pop()!, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ ok: true, result: true }));
    };
    const logs: string[] = [];
    expect(await configureBot(fn, TOKEN, undefined, (m: string) => logs.push(m))).toBe(5);
    expect(calls.map((c) => c.method)).toEqual(['setMyCommands', 'setMyCommands', 'setChatMenuButton', 'setMyDescription', 'setMyShortDescription']);
    expect(calls[1].body.language_code).toBe('es');
    expect(calls[2].body).toEqual({ menu_button: { type: 'commands' } });
    for (const c of BOT_COMMANDS as { command: string; description: string }[]) {
      expect(c.command).toMatch(/^[a-z0-9_]{1,32}$/);
      expect(c.description.length).toBeGreaterThan(0);
      expect(c.description.length).toBeLessThanOrEqual(256);
    }
    expect(BOT_DESCRIPTION.length).toBeLessThanOrEqual(512);
    expect(BOT_SHORT_DESCRIPTION.length).toBeLessThanOrEqual(120);
    expect(BOT_DESCRIPTION).toMatch(/DEMOSTRACIÓN/);
    expect(BOT_DESCRIPTION).toMatch(/no envía pedidos/);
    expect(logs.join(' ')).not.toContain(TOKEN);
  });
  it('un fallo de configuración no detiene la demo', async () => {
    // @ts-expect-error módulo JS sin tipos
    const { configureBot } = await import('../scripts/poll.mjs');
    const fn = async () => new Response(JSON.stringify({ ok: false, description: 'Too Many Requests' }), { status: 429 });
    const logs: string[] = [];
    expect(await configureBot(fn, TOKEN, undefined, (m: string) => logs.push(m))).toBe(0);
    expect(logs.join(' ')).toMatch(/0\/5 aplicadas/);
  });
});
