// Límites de cuota en código. Las reservas se hacen ANTES de llamar a la IA o descargar archivos.
import { LIMITS, DEFAULT_MAX_AI_CALLS_TOTAL } from './config';
import type { Store } from './db';

export const TOTAL_KEY = 'ai:total';
const MIN = 60_000;
const DAY = 86_400_000;
const dayKey = (t: number) => new Date(t).toISOString().slice(0, 10); // día UTC
const minKey = (t: number) => Math.floor(t / MIN);

export function demoActive(demoUntil: string | undefined, now: number): boolean {
  if (!demoUntil) return false; // sin fecha de corte configurada: cerrado por defecto
  // Fecha sin hora: vale hasta el final de ese día en hora de CDMX (UTC-6, sin horario de verano desde 2022).
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(demoUntil.trim()) ? `${demoUntil.trim()}T23:59:59-06:00` : demoUntil;
  const t = Date.parse(iso);
  return Number.isFinite(t) && now <= t;
}

export class Quota {
  constructor(private store: Store, private now: () => number, private maxTotal: number = DEFAULT_MAX_AI_CALLS_TOTAL) {}

  keys(chatId: number) {
    const t = this.now();
    return {
      min: `ai:min:${chatId}:${minKey(t)}`,
      day: `ai:day:${chatId}:${dayKey(t)}`,
      global: `ai:global:${dayKey(t)}`,
      file: `file:day:${chatId}:${dayKey(t)}`,
    };
  }

  /** Reserva atómica de una llamada IA en los tres contadores; si uno falla, libera los anteriores. */
  async reserveAi(chatId: number): Promise<{ ok: true } | { ok: false; reason: 'minuto' | 'dia' | 'global' | 'total' }> {
    const k = this.keys(chatId);
    // Tope total acumulado (freno de gasto): no expira con los días; no se libera aunque falle otro contador.
    if (!(await this.store.reserve(TOTAL_KEY, this.maxTotal, 100 * 365 * DAY))) return { ok: false, reason: 'total' };
    if (!(await this.store.reserve(k.global, LIMITS.aiPerDayGlobal, 2 * DAY))) return { ok: false, reason: 'global' };
    if (!(await this.store.reserve(k.day, LIMITS.aiPerDayPerChat, 2 * DAY))) {
      await this.store.release(k.global);
      return { ok: false, reason: 'dia' };
    }
    if (!(await this.store.reserve(k.min, LIMITS.aiPerMinutePerChat, 2 * MIN))) {
      await this.store.release(k.global);
      await this.store.release(k.day);
      return { ok: false, reason: 'minuto' };
    }
    return { ok: true };
  }

  async reserveFile(chatId: number): Promise<boolean> {
    return this.store.reserve(this.keys(chatId).file, LIMITS.filesPerDayPerChat, 2 * DAY);
  }

  async usage(chatId: number) {
    const k = this.keys(chatId);
    return {
      aiMin: await this.store.getCount(k.min),
      aiDay: await this.store.getCount(k.day),
      aiGlobal: await this.store.getCount(k.global),
      aiTotal: await this.store.getCount(TOTAL_KEY),
      maxTotal: this.maxTotal,
      files: await this.store.getCount(k.file),
    };
  }
}
