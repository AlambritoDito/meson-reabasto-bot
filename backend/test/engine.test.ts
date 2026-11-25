import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseCsv } from '../src/csv';
import { validateInventory, buildProposal, previewAdjustment, emptyAdjustments } from '../src/engine';
import { DEFAULT_RULE } from '../src/config';

const fx = (n: string) => readFileSync(new URL(`../../fixtures/${n}`, import.meta.url), 'utf8');
const load = (n: string) => validateInventory(parseCsv(fx(n)), DEFAULT_RULE);

describe('fixture inventario-muestra (A06/A07)', () => {
  const v = load('inventario-muestra.csv');
  it('tiene 20 insumos y al menos 4 proveedores', () => {
    expect(v.totalRows).toBe(20);
    const provs = new Set(v.rows.map((r) => r.proveedor));
    expect(provs.size).toBeGreaterThanOrEqual(4);
  });
  it('exactamente 1 fila con dato requerido faltante, señalando fila y campo', () => {
    const missing = v.issues.filter((i) => i.motivo === 'vacio');
    expect(missing).toHaveLength(1);
    expect(missing[0]).toMatchObject({ fila: 20, campo: 'proveedor' });
  });
  it('exactamente 6 bajo mínimo y la fila incompleta no es una de ellas', () => {
    const p = buildProposal(v, DEFAULT_RULE, emptyAdjustments());
    expect(p.lines).toHaveLength(6);
    expect(p.lines.map((l) => l.fila)).not.toContain(20);
    expect(v.invalidRows.map((r) => r.fila)).toEqual([20]);
  });
});

describe('motor determinista', () => {
  it('D02: cantidades = máximo − existencia, agrupadas por proveedor con subtotales', () => {
    const p = buildProposal(load('inventario-muestra.csv'), DEFAULT_RULE, emptyAdjustments());
    const q = Object.fromEntries(p.lines.map((l) => [l.insumo, l.cantidad]));
    expect(q).toEqual({ 'Leche entera': 52, 'Yogur natural': 12, 'Cafe en grano': 13, Arroz: 21, Jitomate: 17, Aguacate: 8 });
    const sub = Object.fromEntries(p.groups.map((g) => [g.proveedor, g.subtotal]));
    expect(sub).toEqual({ 'Lacteos Ficticios SA': 1626, 'Cafe Ficticio del Valle': 3640, 'Abarrotes Ficticios': 546, 'Verduras Ficticias Sur': 996 });
    expect(p.total).toBe(6808);
    for (const l of p.lines) expect(l.existencia + l.cantidad).toBeLessThanOrEqual(l.maximo);
  });
  it('existencia igual al mínimo NO entra (comparador estricto <)', () => {
    const p = buildProposal(load('inventario-muestra.csv'), DEFAULT_RULE, emptyAdjustments());
    expect(p.lines.find((l) => l.insumo === 'Azucar')).toBeUndefined();
  });
  it('D01: inventario sin faltantes no propone compras', () => {
    const v = load('inventario-sin-faltantes.csv');
    expect(v.issues).toHaveLength(0);
    const p = buildProposal(v, DEFAULT_RULE, emptyAdjustments());
    expect(p.lines).toHaveLength(0);
    expect(p.total).toBe(0);
  });
  it('detecta negativos, no numéricos, min>max, duplicados y vacío con fila y campo, sin inventar', () => {
    const v = load('inventario-invalido.csv');
    const key = v.issues.map((i) => `${i.fila}:${i.campo}:${i.motivo}`);
    expect(key).toContain('2:existencia:negativo');
    expect(key).toContain('3:existencia:no_numerico');
    expect(key).toContain('4:minimo:minimo_mayor_que_maximo');
    expect(key).toContain('5:insumo:duplicado');
    expect(key).toContain('6:insumo:duplicado');
    expect(key).toContain('7:costo:vacio');
    const p = buildProposal(v, DEFAULT_RULE, emptyAdjustments());
    expect(p.lines.map((l) => l.insumo)).toEqual(['Aguacate']);
    expect(p.excluded.map((e) => e.fila)).toEqual([2, 3, 4, 5, 6, 7]);
    expect(p.blocked).toBe(false);
  });
  it('política «bloquear» impide aprobar si hay filas inválidas', () => {
    const rule = { ...DEFAULT_RULE, politicaInvalido: 'bloquear' as const };
    const p = buildProposal(validateInventory(parseCsv(fx('inventario-invalido.csv')), rule), rule, emptyAdjustments());
    expect(p.blocked).toBe(true);
  });
  it('rechaza archivo con columnas faltantes', () => {
    const v = validateInventory(parseCsv('insumo,unidad,existencia\nA,kg,1\n'), DEFAULT_RULE);
    expect(v.fatal).toMatch(/minimo/);
  });
  it('acepta encabezados con acentos y mayúsculas, ignora columnas extra con aviso', () => {
    const v = validateInventory(parseCsv('Insumo,Unidad,Existencia,Mínimo,Máximo,Proveedor,Costo,Notas\nA,kg,1,2,5,P,3,x\n'), DEFAULT_RULE);
    expect(v.fatal).toBeUndefined();
    expect(v.rows).toHaveLength(1);
    expect(v.warnings.join(' ')).toMatch(/notas/);
  });
  it('rechaza valores no finitos', () => {
    const v = validateInventory(parseCsv('insumo,unidad,existencia,minimo,maximo,proveedor,costo\nA,kg,Infinity,2,5,P,3\nB,kg,1e999,2,5,P,3\n'), DEFAULT_RULE);
    expect(v.rows).toHaveLength(0);
    expect(v.issues.every((i) => i.motivo === 'no_numerico')).toBe(true);
  });
  it('CSV con punto y coma admite coma decimal', () => {
    const v = validateInventory(parseCsv('insumo;unidad;existencia;minimo;maximo;proveedor;costo\nA;kg;1,5;2;5;P;3,25\n'), DEFAULT_RULE);
    expect(v.rows[0]).toMatchObject({ existencia: 1.5, costo: 3.25 });
  });
});

describe('ajuste por temporada (D04)', () => {
  const v = load('inventario-muestra.csv');
  it('global +20 %: redondea hacia arriba y nunca supera el máximo', () => {
    const base = buildProposal(v, DEFAULT_RULE, emptyAdjustments());
    const pv = previewAdjustment(v, DEFAULT_RULE, emptyAdjustments(), { scope: 'global', pct: 20 });
    expect(pv.appliedPct).toBe(20);
    // Leche: 52*1.2=62.4 -> 63 pero tope max-existencia = 52
    const after = Object.fromEntries(pv.after.lines.map((l) => [l.insumo, l.cantidad]));
    expect(after['Leche entera']).toBe(52);
    expect(base.total).toBe(6808);
    for (const l of pv.after.lines) expect(l.existencia + l.cantidad).toBeLessThanOrEqual(l.maximo);
  });
  it('-50 % por proveedor reduce solo ese proveedor', () => {
    const pv = previewAdjustment(v, DEFAULT_RULE, emptyAdjustments(), { scope: 'proveedor', target: 'cafe ficticio del valle', pct: -50 });
    const after = Object.fromEntries(pv.after.lines.map((l) => [l.insumo, l.cantidad]));
    expect(after['Cafe en grano']).toBe(7); // ceil(6.5)
    expect(after['Leche entera']).toBe(52);
  });
  it('acota el porcentaje al rango configurado (±50 %)', () => {
    const pv = previewAdjustment(v, DEFAULT_RULE, emptyAdjustments(), { scope: 'insumo', target: 'Arroz', pct: -90 });
    expect(pv.appliedPct).toBe(-50);
    expect(pv.notes.join(' ')).toMatch(/50/);
  });
  it('objetivo inexistente produce error, no ajuste', () => {
    const pv = previewAdjustment(v, DEFAULT_RULE, emptyAdjustments(), { scope: 'insumo', target: 'Caviar', pct: 10 });
    expect(pv.error).toBeTruthy();
  });
  it('el ajuste por insumo prevalece sobre el de proveedor y el global', () => {
    const adj = { global: 10, proveedor: { 'Verduras Ficticias Sur': -50 }, insumo: { Jitomate: 0 } };
    const p = buildProposal(v, DEFAULT_RULE, adj);
    const q = Object.fromEntries(p.lines.map((l) => [l.insumo, l.cantidad]));
    expect(q['Jitomate']).toBe(17);
    expect(q['Aguacate']).toBe(4);
    expect(q['Arroz']).toBe(21); // 21*1.1=23.1 -> 24 > tope 21
  });
});
