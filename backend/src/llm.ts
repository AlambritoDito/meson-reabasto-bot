// Cliente REST de la API oficial de OpenAI (Responses API, POST /v1/responses). Sin SDK.
// El modelo viene SOLO de OPENAI_MODEL. `incomplete` o texto vacío se tratan como fallo -> plantilla «sin IA».
import type { FetchFn } from './types';
import { LIMITS } from './config';

export interface JsonSchemaSpec {
  name: string;
  schema: Record<string, unknown>;
}

export interface LlmClient {
  generate(system: string, user: string, schema?: JsonSchemaSpec): Promise<string>;
}

export type LlmErrorKind = 'config' | 'timeout' | 'red' | 'http' | 'incomplete' | 'vacia' | 'tope_gasto';

export class LlmError extends Error {
  constructor(public kind: LlmErrorKind, detail = '') {
    super(`IA ${kind}${detail ? ' ' + detail : ''}`);
  }
}

const SPEND_CODES = ['project_spend_limit_exceeded', 'credit_balance_exhausted', 'insufficient_quota'];

export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high';

export interface LlmCallInfo {
  httpStatus: number;
  status?: string;
  usage?: { input_tokens?: number; output_tokens?: number; output_tokens_details?: { reasoning_tokens?: number } };
  ms: number;
  errorCode?: string;
  errorMessage?: string;
}

interface ResponsesBody {
  status?: string;
  usage?: LlmCallInfo['usage'];
  incomplete_details?: { reason?: string } | null;
  output?: { type?: string; content?: { type?: string; text?: string }[] }[];
  error?: { code?: string; message?: string; param?: string } | null;
}

export function extractOutputText(j: ResponsesBody): string {
  const parts: string[] = [];
  for (const item of j.output ?? []) {
    if (item.type !== 'message') continue;
    for (const c of item.content ?? []) if (c.type === 'output_text' && typeof c.text === 'string') parts.push(c.text);
  }
  return parts.join('').trim();
}

export class OpenAiClient implements LlmClient {
  constructor(
    private fetchFn: FetchFn,
    private apiKey: string,
    private model: string | undefined,
    private effort: ReasoningEffort = 'low',
    /** Observador opcional (métricas de verificación); nunca recibe la clave. */
    private onCall?: (info: LlmCallInfo) => void,
  ) {}

  async generate(system: string, user: string, schema?: JsonSchemaSpec): Promise<string> {
    if (!this.model || !/^[a-z0-9.\-_:]+$/i.test(this.model)) throw new LlmError('config', 'OPENAI_MODEL');
    if (!this.apiKey) throw new LlmError('config', 'OPENAI_API_KEY');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), LIMITS.aiTimeoutMs);
    const t0 = Date.now();
    try {
      const res = await this.fetchFn('https://api.openai.com/v1/responses', {
        method: 'POST',
        signal: ctrl.signal,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({
          model: this.model,
          instructions: system,
          input: user.slice(0, LIMITS.maxAiInputChars),
          max_output_tokens: LIMITS.maxOutputTokens,
          reasoning: { effort: this.effort },
          store: false,
          ...(schema ? { text: { format: { type: 'json_schema', name: schema.name, schema: schema.schema, strict: true } } } : {}),
        }),
      });
      let j: ResponsesBody | null = null;
      try {
        j = (await res.json()) as ResponsesBody;
      } catch {
        j = null;
      }
      this.onCall?.({
        httpStatus: res.status,
        status: j?.status,
        usage: j?.usage,
        ms: Date.now() - t0,
        errorCode: j?.error?.code ?? j?.incomplete_details?.reason,
        errorMessage: j?.error?.message?.slice(0, 300),
      });
      // Sin saldo o tope de gasto: fallo definitivo, sin reintentos (códigos observados/documentados de OpenAI).
      if (res.status === 429 && SPEND_CODES.includes(j?.error?.code ?? '')) throw new LlmError('tope_gasto');
      if (!res.ok || !j) throw new LlmError('http', String(res.status));
      if (j.status === 'incomplete') throw new LlmError('incomplete');
      const text = extractOutputText(j);
      if (!text) throw new LlmError('vacia');
      return text;
    } catch (e) {
      if (e instanceof LlmError) throw e;
      throw new LlmError(ctrl.signal.aborted ? 'timeout' : 'red');
    } finally {
      clearTimeout(timer);
    }
  }
}
