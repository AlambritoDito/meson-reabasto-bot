// Cliente OpenAI probado con un fetch FALSO. No es evidencia de una llamada real a la API.
import { describe, it, expect, vi } from 'vitest';
import { OpenAiClient, LlmError } from '../src/llm';
import { INTENT_SCHEMA, validateIntent } from '../src/ai';

const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const msgBody = (text: string, status = 'completed') => ({ status, output: [{ type: 'reasoning' }, { type: 'message', content: [{ type: 'output_text', text }] }] });

describe('OpenAiClient (fetch falso)', () => {
  it('arma la petición a /v1/responses con modelo de config, tope de salida, esfuerzo y json_schema estricto', async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const c = new OpenAiClient(async (url, init) => ((seen = { url, init: init! }), ok(msgBody('{"intent":"ayuda"}'))), 'k-fake', 'modelo-de-config', 'low');
    expect(await c.generate('sys', 'u', INTENT_SCHEMA)).toBe('{"intent":"ayuda"}');
    expect(seen!.url).toBe('https://api.openai.com/v1/responses');
    const b = JSON.parse(String(seen!.init.body));
    expect(b).toMatchObject({ model: 'modelo-de-config', instructions: 'sys', input: 'u', max_output_tokens: 800, reasoning: { effort: 'low' }, store: false });
    expect(b.text.format).toMatchObject({ type: 'json_schema', name: 'intencion', strict: true });
    expect((seen!.init.headers as Record<string, string>).authorization).toBe('Bearer k-fake');
  });
  it('el observador recibe status, usage y latencia, nunca la clave', async () => {
    const infos: unknown[] = [];
    const c = new OpenAiClient(async () => ok({ ...msgBody('x'), usage: { input_tokens: 10, output_tokens: 5, output_tokens_details: { reasoning_tokens: 2 } } }), 'k-secreta', 'm', 'low', (i) => infos.push(i));
    await c.generate('s', 'u');
    expect(infos[0]).toMatchObject({ httpStatus: 200, status: 'completed', usage: { input_tokens: 10, output_tokens: 5 } });
    expect(JSON.stringify(infos)).not.toContain('k-secreta');
  });
  it('trunca la entrada', async () => {
    let body: { input: string } | undefined;
    const c = new OpenAiClient(async (_u, init) => ((body = JSON.parse(String(init!.body))), ok(msgBody('x'))), 'k', 'm');
    await c.generate('s', 'a'.repeat(10_000));
    expect(body!.input.length).toBe(4000);
  });
  const fails: [string, () => Response, string][] = [
    ['incomplete', () => ok(msgBody('', 'incomplete')), 'incomplete'],
    ['incomplete con texto parcial', () => ok(msgBody('{"inte', 'incomplete')), 'incomplete'],
    ['texto vacío', () => ok({ status: 'completed', output: [{ type: 'reasoning' }] }), 'vacia'],
    ['tope de gasto 429', () => ok({ error: { code: 'project_spend_limit_exceeded' } }, 429), 'tope_gasto'],
    ['sin créditos 429 (observado en la API real)', () => ok({ error: { code: 'credit_balance_exhausted' } }, 429), 'tope_gasto'],
    ['429 genérico', () => ok({ error: { code: 'rate_limit_exceeded' } }, 429), 'http'],
    ['500', () => new Response('x', { status: 500 }), 'http'],
  ];
  for (const [name, res, kind] of fails) {
    it(`${name} → LlmError(${kind})`, async () => {
      const c = new OpenAiClient(async () => res(), 'k', 'm');
      await expect(c.generate('s', 'u')).rejects.toMatchObject({ kind });
    });
  }
  it('sin modelo configurado no llama a la red', async () => {
    const f = vi.fn();
    await expect(new OpenAiClient(f, 'k', undefined).generate('s', 'u')).rejects.toBeInstanceOf(LlmError);
    expect(f).not.toHaveBeenCalled();
  });
  it('timeout de 20 s aborta la petición', async () => {
    vi.useFakeTimers();
    const c = new OpenAiClient((_u, init) => new Promise((_r, rej) => init!.signal!.addEventListener('abort', () => rej(new Error('abort')))), 'k', 'm');
    const p = c.generate('s', 'u');
    const assertion = expect(p).rejects.toMatchObject({ kind: 'timeout' });
    await vi.advanceTimersByTimeAsync(20_000);
    await assertion;
    vi.useRealTimers();
  });
  it('validateIntent acepta nulls del esquema estricto y rechaza fuera de lista', () => {
    expect(validateIntent('{"intent":"temporada","pct":20,"alcance":null,"objetivo":null}')).toEqual({ intent: 'temporada', pct: 20, alcance: 'global' });
    expect(validateIntent('{"intent":"temporada","pct":20,"alcance":"insumo","objetivo":null}')).toBeNull();
    expect(validateIntent('{"intent":"hackear"}')).toBeNull();
    expect(validateIntent('[1]')).toBeNull();
  });
});
