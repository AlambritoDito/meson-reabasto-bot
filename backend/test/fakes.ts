// DOBLES DE PRUEBA. Nada aquí acredita una llamada real a Telegram, OpenAI o D1 remoto.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import type { D1Database, D1PreparedStatement, D1Result, Env } from '../src/types';
import type { TelegramClient, Keyboard } from '../src/telegram';
import type { LlmClient } from '../src/llm';
import { handleRequest } from '../src/index';

/** Doble de D1 respaldado por SQLite en memoria (node:sqlite) con el mismo esquema de migrations/. */
export class FakeD1 implements D1Database {
  db = new DatabaseSync(':memory:');
  constructor() {
    this.db.exec(readFileSync(new URL('../migrations/0001_init.sql', import.meta.url), 'utf8'));
  }
  prepare(sql: string): D1PreparedStatement {
    const self = this;
    const make = (params: unknown[]): D1PreparedStatement => {
      const runSync = () => {
        const r = self.db.prepare(sql).run(...(params as never[]));
        return { results: [], meta: { changes: Number(r.changes) } };
      };
      return {
      bind: (...v: unknown[]) => make(v),
      async first<T>() {
        const r = self.db.prepare(sql).all(...(params as never[]));
        return (r[0] as T) ?? null;
      },
      async all<T>() {
        const r = self.db.prepare(sql).all(...(params as never[]));
        return { results: r as T[], meta: { changes: 0 } } as D1Result<T>;
      },
      async run() {
        return runSync();
      },
      _runSync: runSync,
    } as D1PreparedStatement;
    };
    return make([]);
  }
  // Síncrono, como el batch atómico de D1: no intercala otras sentencias dentro de la transacción.
  async batch(stmts: D1PreparedStatement[]) {
    this.db.exec('BEGIN');
    try {
      const out = [];
      for (const s of stmts) out.push((s as unknown as { _runSync: () => D1Result })._runSync());
      this.db.exec('COMMIT');
      return out;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
  count(table: string): number {
    return Number((this.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n);
  }
  snapshot(): string {
    return JSON.stringify(['sessions', 'history'].map((t) => this.db.prepare(`SELECT * FROM ${t} ORDER BY 1`).all()));
  }
}

export interface Sent {
  kind: 'message' | 'callback' | 'document';
  chatId?: number;
  text: string;
  keyboard?: Keyboard;
  fileName?: string;
}

/** Doble de prueba de Telegram: registra lo que el bot "enviaría". */
export class FakeTelegram implements TelegramClient {
  sent: Sent[] = [];
  files = new Map<string, Uint8Array>();
  failNext = 0;
  private maybeFail() {
    if (this.failNext > 0) {
      this.failNext--;
      throw new Error('fake telegram caído');
    }
  }
  async sendMessage(chatId: number, text: string, keyboard?: Keyboard) {
    this.maybeFail();
    this.sent.push({ kind: 'message', chatId, text, keyboard });
  }
  async answerCallback(_id: string, text?: string) {
    this.sent.push({ kind: 'callback', text: text ?? '' });
  }
  async sendDocument(chatId: number, fileName: string, content: string, caption: string) {
    this.maybeFail();
    this.sent.push({ kind: 'document', chatId, text: content, fileName, keyboard: undefined });
    void caption;
  }
  async downloadFile(fileId: string) {
    const f = this.files.get(fileId);
    if (!f) throw new Error('fake: archivo no existe');
    return f;
  }
  last(kind?: Sent['kind']) {
    const xs = kind ? this.sent.filter((s) => s.kind === kind) : this.sent;
    return xs[xs.length - 1];
  }
  buttons(): string[] {
    return this.sent.flatMap((s) => (s.keyboard ?? []).flat().map((b) => b.callback_data));
  }
}

/** Doble de prueba del LLM (OpenAI). Devuelve respuestas programadas o lanza errores. */
export class FakeLlm implements LlmClient {
  calls: { system: string; user: string }[] = [];
  queue: (string | Error)[] = [];
  async generate(system: string, user: string) {
    this.calls.push({ system, user });
    const r = this.queue.shift();
    if (r === undefined) throw new Error('fake llm sin respuesta programada');
    if (r instanceof Error) throw r;
    return r;
  }
}

export const SECRET = 'test-webhook-secret-no-real';

export function makeApp(opts: { demoUntil?: string; now?: () => number; maxTotal?: string } = {}) {
  const db = new FakeD1();
  const tg = new FakeTelegram();
  const llm = new FakeLlm();
  let clock = Date.parse('2026-11-25T18:00:00Z');
  let seq = 0;
  const now = opts.now ?? (() => clock);
  const env: Env = {
    DB: db,
    TELEGRAM_BOT_TOKEN: 'fake-token',
    OPENAI_API_KEY: 'fake-key',
    WEBHOOK_SECRET: SECRET,
    OPENAI_MODEL: 'fake-model',
    MAX_AI_CALLS_TOTAL: opts.maxTotal ?? '1000',
    DEMO_UNTIL: opts.demoUntil ?? '2026-12-31T23:59:59-06:00',
  };
  let updateId = 1000;
  let rid = 0;
  const randomId = () => (0x10000000 + ++rid).toString(16);
  const post = async (update: Record<string, unknown>, secret = SECRET) => {
    const req = new Request('https://demo.invalid/tg', {
      method: 'POST',
      headers: { 'x-telegram-bot-api-secret-token': secret, 'content-type': 'application/json' },
      body: JSON.stringify(update),
    });
    return handleRequest(req, env, { tg, llm, now, randomId });
  };
  const postRaw = (body: string, secret = SECRET, method = 'POST', path = '/tg') => {
    const req = new Request(`https://demo.invalid${path}`, { method, headers: { 'x-telegram-bot-api-secret-token': secret }, body: method === 'GET' ? undefined : body });
    return handleRequest(req, env, { tg, llm, now, randomId });
  };
  const msg = (chatId: number, text: string, extra: Record<string, unknown> = {}) =>
    post({ update_id: ++updateId, message: { message_id: ++seq, chat: { id: chatId, type: 'private' }, from: { id: chatId }, text, ...extra } });
  const click = (chatId: number, data: string, fromId = chatId) =>
    post({ update_id: ++updateId, callback_query: { id: `cb${++seq}`, from: { id: fromId }, data, message: { chat: { id: chatId, type: 'private' } } } });
  const doc = (chatId: number, name: string, bytes: Uint8Array, size = bytes.length) => {
    const fid = `f${++seq}`;
    tg.files.set(fid, bytes);
    return post({ update_id: ++updateId, message: { message_id: ++seq, chat: { id: chatId, type: 'private' }, from: { id: chatId }, document: { file_id: fid, file_name: name, file_size: size } } });
  };
  return { db, tg, llm, env, post, postRaw, msg, click, doc, advance: (ms: number) => (clock += ms), nextUpdateId: () => ++updateId };
}
