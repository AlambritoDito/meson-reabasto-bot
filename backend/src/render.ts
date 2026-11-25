// Plantillas deterministas de mensajes y del borrador descargable.
import type { Issue, InvalidRow, Proposal } from './engine';
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
