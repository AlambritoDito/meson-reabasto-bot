import type { D1Database } from './types';
import type { Adjustments, Validation, AdjustmentRequest } from './engine';
import { LIMITS } from './config';

export interface PendingAdjust {
  id: string; // nonce del ajuste pendiente
  baseVersion: number;
  req: AdjustmentRequest;
  appliedPct: number;
  target?: string;
  next: Adjustments;
}

export interface Session {
  chatId: number;
  sessionId: string;
  source: string;
  validation: Validation;
  adjustments: Adjustments;
  version: number;
  approvedVersion: number | null;
  rejectedVersion: number | null;
  pendingAdjust: PendingAdjust | null;
  updatedAt: number;
}

interface SessionRow {
  chat_id: number;
  session_id: string;
  source: string;
  validation_json: string;
  adjustments_json: string;
  version: number;
  approved_version: number | null;
  rejected_version: number | null;
  pending_adjust_json: string | null;
  updated_at: number;
}

const DAY = 86_400_000;

export class Store {
  constructor(private db: D1Database, private now: () => number) {}

  // ---- updates (idempotencia del webhook) ----
  /** Registra el update y suma un intento. Devuelve el estado previo. */
  async beginUpdate(updateId: number): Promise<{ status: 'pending' | 'done'; attempts: number }> {
    await this.db.prepare('INSERT OR IGNORE INTO updates (update_id, status, attempts, created_at) VALUES (?, ?, 0, ?)').bind(updateId, 'pending', this.now()).run();
    const row = await this.db
      .prepare("UPDATE updates SET attempts = attempts + 1 WHERE update_id = ? AND status = 'pending' RETURNING status, attempts")
      .bind(updateId)
      .first<{ status: 'pending'; attempts: number }>();
    if (row) return row;
    return { status: 'done', attempts: 0 };
  }

  async finishUpdate(updateId: number): Promise<void> {
    await this.db.prepare("UPDATE updates SET status = 'done' WHERE update_id = ?").bind(updateId).run();
  }

  // ---- sesiones ----
  async getSession(chatId: number): Promise<Session | null> {
    const r = await this.db.prepare('SELECT * FROM sessions WHERE chat_id = ?').bind(chatId).first<SessionRow>();
    if (!r) return null;
    if (r.updated_at < this.now() - LIMITS.retentionDays * DAY) {
      await this.deleteChat(chatId);
      return null;
    }
    return {
      chatId: r.chat_id,
      sessionId: r.session_id,
      source: r.source,
      validation: JSON.parse(r.validation_json),
      adjustments: JSON.parse(r.adjustments_json),
      version: r.version,
      approvedVersion: r.approved_version,
      rejectedVersion: r.rejected_version ?? null,
      pendingAdjust: r.pending_adjust_json ? JSON.parse(r.pending_adjust_json) : null,
      updatedAt: r.updated_at,
    };
  }

  async replaceSession(chatId: number, sessionId: string, source: string, validation: Validation, adjustments: Adjustments): Promise<void> {
    const t = this.now();
    await this.db.batch([
      this.db
        .prepare(
          `INSERT INTO sessions (chat_id, session_id, source, validation_json, adjustments_json, version, approved_version, pending_adjust_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 1, NULL, NULL, ?, ?)
           ON CONFLICT(chat_id) DO UPDATE SET session_id = excluded.session_id, source = excluded.source,
             validation_json = excluded.validation_json, adjustments_json = excluded.adjustments_json, version = 1,
             approved_version = NULL, rejected_version = NULL, pending_adjust_json = NULL, created_at = excluded.created_at, updated_at = excluded.updated_at`,
        )
        .bind(chatId, sessionId, source, JSON.stringify(validation), JSON.stringify(adjustments), t, t),
      this.db.prepare('DELETE FROM history WHERE chat_id = ?').bind(chatId),
    ]);
  }

  async setPendingAdjust(chatId: number, sessionId: string, version: number, p: PendingAdjust | null): Promise<boolean> {
    const r = await this.db
      .prepare('UPDATE sessions SET pending_adjust_json = ?, updated_at = ? WHERE chat_id = ? AND session_id = ? AND version = ?')
      .bind(p ? JSON.stringify(p) : null, this.now(), chatId, sessionId, version)
      .run();
    return r.meta.changes === 1;
  }

  /** Aplica el ajuste pendiente solo si sigue vigente (misma sesión, versión y nonce). Idempotente. */
  async applyPendingAdjust(chatId: number, sessionId: string, baseVersion: number, nonce: string, next: Adjustments): Promise<boolean> {
    const r = await this.db
      .prepare(
        `UPDATE sessions SET adjustments_json = ?, version = version + 1, approved_version = NULL, rejected_version = NULL, pending_adjust_json = NULL, updated_at = ?
         WHERE chat_id = ? AND session_id = ? AND version = ? AND json_extract(pending_adjust_json, '$.id') = ?`,
      )
      .bind(JSON.stringify(next), this.now(), chatId, sessionId, baseVersion, nonce)
      .run();
    return r.meta.changes === 1;
  }

  /** Aprueba la versión vigente una sola vez. true solo en la primera aprobación efectiva. */
  async approve(chatId: number, sessionId: string, version: number): Promise<boolean> {
    const r = await this.db
      .prepare('UPDATE sessions SET approved_version = version, updated_at = ? WHERE chat_id = ? AND session_id = ? AND version = ? AND approved_version IS NULL AND rejected_version IS NULL')
      .bind(this.now(), chatId, sessionId, version)
      .run();
    return r.meta.changes === 1;
  }

  /** Rechaza la versión vigente una sola vez (si no está aprobada ni rechazada). */
  async reject(chatId: number, sessionId: string, version: number): Promise<boolean> {
    const r = await this.db
      .prepare('UPDATE sessions SET rejected_version = version, pending_adjust_json = NULL, updated_at = ? WHERE chat_id = ? AND session_id = ? AND version = ? AND approved_version IS NULL AND rejected_version IS NULL')
      .bind(this.now(), chatId, sessionId, version)
      .run();
    return r.meta.changes === 1;
  }

  async addHistory(chatId: number, sessionId: string, version: number, kind: string, detail: string): Promise<void> {
    await this.db.prepare('INSERT INTO history (chat_id, session_id, version, kind, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(chatId, sessionId, version, kind, detail, this.now()).run();
  }

  async getHistory(chatId: number, sessionId: string): Promise<{ version: number; kind: string; detail: string; created_at: number }[]> {
    const r = await this.db.prepare('SELECT version, kind, detail, created_at FROM history WHERE chat_id = ? AND session_id = ? ORDER BY id').bind(chatId, sessionId).all<{ version: number; kind: string; detail: string; created_at: number }>();
    return r.results;
  }

  async deleteChat(chatId: number): Promise<void> {
    await this.db.batch([this.db.prepare('DELETE FROM sessions WHERE chat_id = ?').bind(chatId), this.db.prepare('DELETE FROM history WHERE chat_id = ?').bind(chatId)]);
  }

  // ---- contadores atómicos ----
  /** Reserva 1 unidad si count < limit. Atómico en una sola sentencia. */
  async reserve(key: string, limit: number, ttlMs: number): Promise<boolean> {
    if (!(limit > 0)) return false; // límite 0 (o inválido) no permite ninguna unidad
    const t = this.now();
    const row = await this.db
      .prepare(
        `INSERT INTO counters (key, count, expires_at) VALUES (?, 1, ?)
         ON CONFLICT(key) DO UPDATE SET count = count + 1 WHERE counters.count < ?
         RETURNING count`,
      )
      .bind(key, t + ttlMs, limit)
      .first<{ count: number }>();
    return row !== null;
  }

  async release(key: string): Promise<void> {
    await this.db.prepare('UPDATE counters SET count = count - 1 WHERE key = ? AND count > 0').bind(key).run();
  }

  async getCount(key: string): Promise<number> {
    const r = await this.db.prepare('SELECT count FROM counters WHERE key = ?').bind(key).first<{ count: number }>();
    return r?.count ?? 0;
  }

  // ---- retención ----
  async cleanup(): Promise<void> {
    const t = this.now();
    const cutoff = t - LIMITS.retentionDays * DAY;
    await this.db.batch([
      this.db.prepare('DELETE FROM sessions WHERE updated_at < ?').bind(cutoff),
      this.db.prepare('DELETE FROM history WHERE created_at < ?').bind(cutoff),
      this.db.prepare('DELETE FROM updates WHERE created_at < ?').bind(cutoff),
      this.db.prepare('DELETE FROM counters WHERE expires_at < ?').bind(t),
    ]);
  }
}
