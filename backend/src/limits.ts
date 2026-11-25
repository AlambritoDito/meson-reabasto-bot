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
    // Orden: minuto, día, global diario y al final el tope total (freno de gasto). Cada rechazo libera lo ya reservado,
    // así un chat bloqueado por minuto/día no consume el tope total ni el global.
    const steps: [string, number, number, 'minuto' | 'dia' | 'global' | 'total'][] = [
      [k.min, LIMITS.aiPerMinutePerChat, 2 * MIN, 'minuto'],
      [k.day, LIMITS.aiPerDayPerChat, 2 * DAY, 'dia'],
      [k.global, LIMITS.aiPerDayGlobal, 2 * DAY, 'global'],
      [TOTAL_KEY, this.maxTotal, 100 * 365 * DAY, 'total'],
    ];
    const done: string[] = [];
    for (const [key, limit, ttl, reason] of steps) {
      if (!(await this.store.reserve(key, limit, ttl))) {
        for (const d of done) await this.store.release(d);
        return { ok: false, reason };
      }
      done.push(key);
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
