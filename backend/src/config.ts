// Regla CANDIDATA para la demo. NO es política confirmada del restaurante:
// el equipo y el cliente deben aprobar comparador, fórmula, redondeo y rangos.
export type PoliticaInvalido = 'parcial_explicita' | 'bloquear';

export interface RuleConfig {
  etiqueta: string;
  comparador: '<' | '<=';
  formula: 'maximo_menos_existencia';
  redondeo: { modo: 'arriba' | 'cercano' | 'ninguno'; paso: number };
  temporada: { minPct: number; maxPct: number };
  politicaInvalido: PoliticaInvalido;
  maxFilas: number;
}

export const DEFAULT_RULE: RuleConfig = {
  etiqueta: 'regla propuesta para la demo',
  comparador: '<',
  formula: 'maximo_menos_existencia',
  redondeo: { modo: 'arriba', paso: 1 },
  temporada: { minPct: -50, maxPct: 50 },
  politicaInvalido: 'parcial_explicita',
  maxFilas: 500,
};

export const LIMITS = {
  aiPerMinutePerChat: 3,
  aiPerDayPerChat: 20,
  aiPerDayGlobal: 300,
  filesPerDayPerChat: 5,
  maxOutputTokens: 800,
  maxAiInputChars: 4000,
  aiTimeoutMs: 20_000,
  maxFileBytes: 200 * 1024,
  maxZipUncompressedBytes: 4 * 1024 * 1024,
  maxZipEntries: 200,
  maxUpdateAttempts: 3,
  retentionDays: 7,
  maxWebhookBodyBytes: 1024 * 1024,
} as const;

export const DEFAULT_MAX_AI_CALLS_TOTAL = 1000;
