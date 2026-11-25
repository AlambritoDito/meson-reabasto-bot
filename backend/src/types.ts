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
  GEMINI_API_KEY: string;
  WEBHOOK_SECRET: string;
  GEMINI_MODEL?: string;
  DEMO_UNTIL?: string; // ISO 8601, p. ej. 2026-12-15T23:59:59-06:00
}

export type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;
