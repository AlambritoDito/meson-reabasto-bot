// Plantillas deterministas de mensajes y del borrador descargable.
import type { AdjustmentPreview, Issue, InvalidRow, Proposal, Validation } from './engine';
import { fmtMoney, fmtNum, safeCell, short } from './text';

export const SIN_IA = '(sin IA)';

const MOTIVO: Record<Issue['motivo'], string> = {
  vacio: 'vacío',
  no_numerico: 'no es número',
  negativo: 'negativo',
  minimo_mayor_que_maximo: 'mínimo mayor que máximo',
  duplicado: 'insumo duplicado',
};

export function describeInvalid(r: InvalidRow): string {
  return `fila ${r.fila}${r.insumo ? ` (${short(r.insumo, 30)})` : ''}: ${r.issues.map((i) => `${i.campo} ${MOTIVO[i.motivo]}`).join(', ')}`;
}

export const WELCOME = `Hola. Soy un asistente automático de DEMOSTRACIÓN para reabastecimiento con datos ficticios.
Reviso un inventario contra mínimos, propongo un pedido por proveedor con la regla propuesta para la demo y redacto un borrador.
Tú apruebas; yo nunca envío nada a proveedores.

Empieza con /muestra o súbeme un .csv o .xlsx (máx. 200 KB, 500 filas).
Comandos: /ayuda`;

export const HELP = `Comandos:
/muestra carga el inventario ficticio de ejemplo
(o súbeme un .csv/.xlsx con columnas insumo, unidad, existencia, minimo, maximo, proveedor, costo)
/explicar explica la propuesta
/temporada +20 | /temporada -10 proveedor Nombre | /temporada 15 insumo Nombre
/aprobar muestra la propuesta vigente con su botón de aprobar
/borrador descarga el borrador aprobado
/historial cambios de esta sesión
/limites tu uso de la demo
/borrar elimina tus datos de esta demo
Los datos se borran solos a los 7 días.`;

export function summaryText(v: Validation, p: Proposal, version: number, source: string): string {
  const out: string[] = [];
  out.push(`Inventario: ${short(source, 40)} · ${v.totalRows} insumos · propuesta v${version}`);
  out.push(`Regla propuesta para la demo: alerta si existencia < mínimo; cantidad = máximo − existencia.`);
  if (v.warnings.length) out.push(...v.warnings.map((w) => `Aviso: ${short(w, 200)}`));
  if (p.lines.length === 0) {
    out.push('', 'Ningún insumo válido está bajo su mínimo. No propongo compras.');
  } else {
    out.push('', `${p.lines.length} insumos bajo mínimo:`);
    for (const g of p.groups) {
      out.push(`\n${short(g.proveedor, 40)} — subtotal ${fmtMoney(g.subtotal)}`);
      for (const l of g.lines) {
        const adj = l.pctAplicado ? ` (ajuste ${l.pctAplicado > 0 ? '+' : ''}${l.pctAplicado} %)` : '';
        out.push(`• ${short(l.insumo, 40)}: tiene ${fmtNum(l.existencia)}, mín ${fmtNum(l.minimo)}, máx ${fmtNum(l.maximo)} → pedir ${fmtNum(l.cantidad)} ${short(l.unidad, 15)}${adj}`);
      }
    }
    out.push('', `Total estimado: ${fmtMoney(p.total)}`);
  }
  if (p.excluded.length) {
    out.push('', `Filas excluidas por datos inválidos (${p.excluded.length}); no invento valores:`);
    for (const r of p.excluded.slice(0, 15)) out.push(`• ${describeInvalid(r)}`);
    if (p.excluded.length > 15) out.push(`• … y ${p.excluded.length - 15} más (ver borrador)`);
    out.push(p.blocked ? 'Política «bloquear»: corrige el archivo para poder aprobar.' : 'Política «parcial explícita»: solo se aprueban las filas válidas.');
  }
  if (p.lines.length && !p.blocked) out.push('', 'Revisa y aprueba con el botón. Yo no envío nada a proveedores.');
  return out.join('\n');
}

export function previewText(pv: AdjustmentPreview): string {
  const out: string[] = [];
  const scope = pv.scope === 'global' ? 'todos los insumos' : `${pv.scope} ${short(pv.target ?? '', 40)}`;
  out.push(`Ajuste por temporada propuesto: ${pv.appliedPct > 0 ? '+' : ''}${pv.appliedPct} % a ${scope}.`);
  out.push(...pv.notes);
  out.push('', 'Antes → después:');
  const before = new Map(pv.before.lines.map((l) => [l.fila, l]));
  let changed = 0;
  for (const a of pv.after.lines) {
    const b = before.get(a.fila);
    if (b && b.cantidad !== a.cantidad) {
      changed++;
      out.push(`• ${short(a.insumo, 40)}: ${fmtNum(b.cantidad)} → ${fmtNum(a.cantidad)} ${short(a.unidad, 15)} (tope ${fmtNum(a.base)})`);
    }
  }
  if (!changed) out.push('• Ninguna cantidad cambia (topes por máximo o sin insumos afectados).');
  out.push('', `Total: ${fmtMoney(pv.before.total)} → ${fmtMoney(pv.after.total)}`);
  out.push('Nada cambia hasta que confirmes.');
  return out.join('\n');
}

export function draftText(p: Proposal, version: number, sessionId: string, history: { version: number; kind: string; detail: string; created_at: number }[], generatedAt: number): string {
  const L: string[] = [];
  L.push('BORRADOR DE PEDIDO — DEMOSTRACIÓN CON DATOS FICTICIOS');
  L.push('Este bot NO envía nada a proveedores. Una persona revisa, decide y envía.');
  L.push(`Sesión ${sessionId} · versión aprobada v${version} · generado ${new Date(generatedAt).toISOString()}`);
  L.push('Regla propuesta para la demo (no confirmada por el restaurante): alerta si existencia < mínimo; cantidad = máximo − existencia.');
  L.push('');
  for (const g of p.groups) {
    L.push(`PARA: ${safeCell(g.proveedor)}`);
    L.push('Hola, buen día. Les solicitamos el siguiente pedido (borrador):');
    for (const l of g.lines) L.push(`• ${safeCell(l.insumo)}: ${fmtNum(l.cantidad)} ${safeCell(l.unidad)} (costo unitario ${fmtMoney(l.costo)}, subtotal ${fmtMoney(l.subtotal)})`);
    L.push(`Subtotal estimado: ${fmtMoney(g.subtotal)}`);
    L.push('Favor de confirmar disponibilidad y fecha de entrega. Gracias.');
    L.push('');
  }
  L.push(`Total estimado: ${fmtMoney(p.total)}`);
  if (p.excluded.length) {
    L.push('');
    L.push('Filas excluidas por datos inválidos (no se pidieron, no se inventaron valores):');
    for (const r of p.excluded) L.push(`• ${safeCell(describeInvalid(r))}`);
  }
  L.push('');
  L.push('Historial de la sesión:');
  for (const h of history) L.push(`• ${new Date(h.created_at).toISOString()} v${h.version} ${safeCell(h.kind)}: ${safeCell(h.detail)}`);
  return L.join('\n') + '\n';
}
