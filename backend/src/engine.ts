// Motor determinista puro: sin I/O. Todo cálculo, validación y estado de la propuesta se decide aquí.
import type { RuleConfig } from './config';
import type { Table } from './csv';

export const REQUIRED = ['insumo', 'unidad', 'existencia', 'minimo', 'maximo', 'proveedor', 'costo'] as const;
type Campo = (typeof REQUIRED)[number];
const NUMERIC: Campo[] = ['existencia', 'minimo', 'maximo', 'costo'];

export type Motivo = 'vacio' | 'no_numerico' | 'negativo' | 'minimo_mayor_que_maximo' | 'duplicado';

export interface Issue {
  fila: number; // número de fila en la hoja (encabezado = 1)
  campo: Campo;
  motivo: Motivo;
}

export interface Row {
  fila: number;
  insumo: string;
  unidad: string;
  existencia: number;
  minimo: number;
  maximo: number;
  proveedor: string;
  costo: number;
}

export interface InvalidRow {
  fila: number;
  insumo: string;
  issues: Issue[];
}

export interface Validation {
  fatal?: string;
  totalRows: number;
  rows: Row[];
  invalidRows: InvalidRow[];
  issues: Issue[];
  warnings: string[];
}

export interface Line extends Row {
  base: number;
  pctAplicado: number;
  cantidad: number;
  subtotal: number;
}

export interface Group {
  proveedor: string;
  lines: Line[];
  subtotal: number;
}

export interface Proposal {
  lines: Line[];
  groups: Group[];
  total: number;
  excluded: InvalidRow[];
  blocked: boolean;
  regla: string;
}

export interface Adjustments {
  global?: number;
  proveedor: Record<string, number>;
  insumo: Record<string, number>;
}

export interface AdjustmentRequest {
  scope: 'global' | 'proveedor' | 'insumo';
  target?: string;
  pct: number;
}

export const emptyAdjustments = (): Adjustments => ({ proveedor: {}, insumo: {} });

export function normalizeKey(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const NUM_DOT = /^[+-]?(\d+(\.\d+)?|\.\d+)$/;
const NUM_COMMA = /^[+-]?(\d+(,\d+)?|,\d+)$/;

export function parseNumber(raw: string, allowComma: boolean): number | null {
  const s = raw.trim();
  let n: number;
  if (NUM_DOT.test(s)) n = Number(s);
  else if (allowComma && NUM_COMMA.test(s)) n = Number(s.replace(',', '.'));
  else return null;
  return Number.isFinite(n) ? n : null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function validateInventory(table: Table, rule: RuleConfig): Validation {
  const out: Validation = { totalRows: 0, rows: [], invalidRows: [], issues: [], warnings: [] };
  if (table.rows.length === 0) return { ...out, fatal: 'El archivo está vacío.' };
  const header = table.rows[0].map((h) => normalizeKey(String(h)));
  const idx: Partial<Record<Campo, number>> = {};
  for (const c of REQUIRED) {
    const i = header.indexOf(c);
    if (i >= 0) idx[c] = i;
  }
  const missing = REQUIRED.filter((c) => idx[c] === undefined);
  if (missing.length) return { ...out, fatal: `Faltan columnas: ${missing.join(', ')}.` };
  const extra = header.filter((h) => h !== '' && !(REQUIRED as readonly string[]).includes(h));
  if (extra.length) out.warnings.push(`Columnas ignoradas: ${extra.join(', ')}.`);

  const dataRows = table.rows.slice(1);
  const nonEmpty = dataRows.filter((r) => r.some((f) => String(f ?? '').trim() !== ''));
  if (nonEmpty.length === 0) return { ...out, fatal: 'El archivo no tiene filas de datos.' };
  if (nonEmpty.length > rule.maxFilas) return { ...out, fatal: `El archivo tiene más de ${rule.maxFilas} filas.` };

  const allowComma = table.delimiter === ';';
  const parsed: { fila: number; insumo: string; row?: Row; issues: Issue[] }[] = [];
  dataRows.forEach((r, k) => {
    if (!r.some((f) => String(f ?? '').trim() !== '')) return;
    const fila = k + 2;
    out.totalRows++;
    const get = (c: Campo) => String(r[idx[c]!] ?? '').trim();
    const issues: Issue[] = [];
    const nums: Partial<Record<Campo, number>> = {};
    for (const c of REQUIRED) {
      const v = get(c);
      if (v === '') {
        issues.push({ fila, campo: c, motivo: 'vacio' });
        continue;
      }
      if (NUMERIC.includes(c)) {
        const n = parseNumber(v, allowComma);
        if (n === null) issues.push({ fila, campo: c, motivo: 'no_numerico' });
        else if (n < 0) issues.push({ fila, campo: c, motivo: 'negativo' });
        else nums[c] = n;
      }
    }
    if (nums.minimo !== undefined && nums.maximo !== undefined && nums.minimo > nums.maximo) {
      issues.push({ fila, campo: 'minimo', motivo: 'minimo_mayor_que_maximo' });
    }
    const entry: (typeof parsed)[number] = { fila, insumo: get('insumo'), issues };
    if (issues.length === 0) {
      entry.row = {
        fila,
        insumo: get('insumo'),
        unidad: get('unidad'),
        existencia: nums.existencia!,
        minimo: nums.minimo!,
        maximo: nums.maximo!,
        proveedor: get('proveedor'),
        costo: nums.costo!,
      };
    }
    parsed.push(entry);
  });

  // Duplicados por insumo normalizado: todas las apariciones quedan inválidas (no se elige una por la persona).
  const seen = new Map<string, number>();
  for (const p of parsed) if (p.insumo) seen.set(normalizeKey(p.insumo), (seen.get(normalizeKey(p.insumo)) ?? 0) + 1);
  for (const p of parsed) {
    if (p.insumo && (seen.get(normalizeKey(p.insumo)) ?? 0) > 1) {
      p.issues.unshift({ fila: p.fila, campo: 'insumo', motivo: 'duplicado' });
      p.row = undefined;
    }
  }
  for (const p of parsed) {
    if (p.row) out.rows.push(p.row);
    else {
      out.invalidRows.push({ fila: p.fila, insumo: p.insumo, issues: p.issues });
      out.issues.push(...p.issues);
    }
  }
  return out;
}

function applyRounding(x: number, rule: RuleConfig): number {
  const { modo, paso } = rule.redondeo;
  if (modo === 'ninguno' || paso <= 0) return round2(x);
  const q = x / paso;
  // Tolerancia para errores de coma flotante (p. ej. 12*1.1).
  const r = modo === 'arriba' ? Math.ceil(q - 1e-9) : Math.round(q);
  return round2(r * paso);
}

export function clampPct(pct: number, rule: RuleConfig): number {
  return Math.min(rule.temporada.maxPct, Math.max(rule.temporada.minPct, pct));
}

function effectivePct(row: Row, adj: Adjustments): number {
  const ik = Object.keys(adj.insumo).find((k) => normalizeKey(k) === normalizeKey(row.insumo));
  if (ik !== undefined) return adj.insumo[ik];
  const pk = Object.keys(adj.proveedor).find((k) => normalizeKey(k) === normalizeKey(row.proveedor));
  if (pk !== undefined) return adj.proveedor[pk];
  return adj.global ?? 0;
}

export function buildProposal(v: Validation, rule: RuleConfig, adj: Adjustments): Proposal {
  const lines: Line[] = [];
  for (const r of v.rows) {
    const alerta = rule.comparador === '<' ? r.existencia < r.minimo : r.existencia <= r.minimo;
    if (!alerta) continue;
    const tope = round2(r.maximo - r.existencia);
    const base = tope; // fórmula candidata: máximo − existencia
    const pct = effectivePct(r, adj);
    const ajustada = applyRounding(base * (1 + pct / 100), rule);
    const cantidad = Math.max(0, Math.min(ajustada, tope));
    lines.push({ ...r, base, pctAplicado: pct, cantidad, subtotal: round2(cantidad * r.costo) });
  }
  const map = new Map<string, Group>();
  for (const l of lines) {
    const g = map.get(l.proveedor) ?? { proveedor: l.proveedor, lines: [], subtotal: 0 };
    g.lines.push(l);
    g.subtotal = round2(g.subtotal + l.subtotal);
    map.set(l.proveedor, g);
  }
  const groups = [...map.values()];
  return {
    lines,
    groups,
    total: round2(groups.reduce((s, g) => s + g.subtotal, 0)),
    excluded: v.invalidRows,
    blocked: rule.politicaInvalido === 'bloquear' && v.invalidRows.length > 0,
    regla: rule.etiqueta,
  };
}

export interface AdjustmentPreview {
  error?: string;
  appliedPct: number;
  notes: string[];
  before: Proposal;
  after: Proposal;
  next: Adjustments;
  scope: AdjustmentRequest['scope'];
  target?: string;
}

export function previewAdjustment(v: Validation, rule: RuleConfig, current: Adjustments, req: AdjustmentRequest): AdjustmentPreview {
  const before = buildProposal(v, rule, current);
  const notes: string[] = [];
  const base = { appliedPct: 0, notes, before, after: before, next: current, scope: req.scope };
  if (!Number.isFinite(req.pct)) return { ...base, error: 'Porcentaje inválido.' };
  const appliedPct = clampPct(Math.round(req.pct), rule);
  if (appliedPct !== Math.round(req.pct)) {
    notes.push(`El ajuste se acotó a ${appliedPct} % (rango permitido ${rule.temporada.minPct} % a +${rule.temporada.maxPct} %).`);
  }
  const next: Adjustments = { global: current.global, proveedor: { ...current.proveedor }, insumo: { ...current.insumo } };
  let target: string | undefined;
  if (req.scope === 'global') next.global = appliedPct;
  else {
    const want = normalizeKey(req.target ?? '');
    const pool = req.scope === 'proveedor' ? v.rows.map((r) => r.proveedor) : v.rows.map((r) => r.insumo);
    target = pool.find((x) => normalizeKey(x) === want);
    if (!want || !target) return { ...base, error: `No encontré ${req.scope === 'proveedor' ? 'el proveedor' : 'el insumo'} «${req.target ?? ''}» en el inventario.` };
    if (req.scope === 'proveedor') next.proveedor[target] = appliedPct;
    else next.insumo[target] = appliedPct;
  }
  const after = buildProposal(v, rule, next);
  if (after.lines.some((l) => l.cantidad < applyRounding(l.base * (1 + l.pctAplicado / 100), rule))) {
    notes.push('Algunas cantidades quedaron topadas para no superar el máximo.');
  }
  return { appliedPct, notes, before, after, next, scope: req.scope, target };
}
