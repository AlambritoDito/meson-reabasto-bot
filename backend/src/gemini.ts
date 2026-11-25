// Cliente REST de la API oficial de Google Gemini (generateContent). Sin SDK.
import type { FetchFn } from './types';
import { LIMITS } from './config';

export interface LlmClient {
  generate(system: string, user: string, json: boolean): Promise<string>;
}

export class LlmError extends Error {}

export class GeminiClient implements LlmClient {
  constructor(private fetchFn: FetchFn, private apiKey: string, private model: string) {}

  async generate(system: string, user: string, json: boolean): Promise<string> {
    if (!/^[a-z0-9.\-]+$/i.test(this.model)) throw new LlmError('modelo inválido');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), LIMITS.aiTimeoutMs);
    try {
      const res = await this.fetchFn(`https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`, {
        method: 'POST',
        signal: ctrl.signal,
        headers: { 'content-type': 'application/json', 'x-goog-api-key': this.apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: user.slice(0, LIMITS.maxAiInputChars) }] }],
          generationConfig: {
            maxOutputTokens: LIMITS.maxOutputTokens,
            temperature: 0.2,
            ...(json ? { responseMimeType: 'application/json' } : {}),
          },
        }),
      });
      if (!res.ok) throw new LlmError(`HTTP ${res.status}`);
      const j = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
      const text = (j.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('').trim();
      if (!text) throw new LlmError('respuesta vacía');
      return text;
    } catch (e) {
      if (e instanceof LlmError) throw e;
      throw new LlmError(ctrl.signal.aborted ? 'timeout' : 'red');
    } finally {
      clearTimeout(timer);
    }
  }
}
