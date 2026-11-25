// Subconjunto mínimo de la API de D1 que usa el Worker (evita depender de @cloudflare/workers-types).
export interface D1Result<T = Record<string, unknown>> {
  results: T[];
  meta: { changes: number };
}
export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run(): Promise<D1Result>;
}
export interface D1Database {
  prepare(sql: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<D1Result[]>;
}

export interface Env {
  DB: D1Database;
  TELEGRAM_BOT_TOKEN: string;
  OPENAI_API_KEY: string;
  WEBHOOK_SECRET: string;
  OPENAI_MODEL?: string; // ID del modelo; sin valor por defecto en código
  DEMO_UNTIL?: string; // fecha ISO; si es solo día (2026-12-10) la demo vale hasta el fin de ese día en CDMX
  OPENAI_REASONING_EFFORT?: string; // none|minimal|low|medium|high; por defecto low
  MAX_AI_CALLS_TOTAL?: string;
  TELEGRAM_API_BASE?: string; // solo para E2E local con servidor falso en 127.0.0.1; vacío = API oficial // tope duro acumulado de llamadas IA (freno de gasto)
}

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;
