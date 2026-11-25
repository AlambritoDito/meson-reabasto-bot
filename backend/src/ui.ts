// Vistas del chat (HTML de Telegram) y teclados inline estilo BotFather.
// TODO dato de usuario/archivo pasa por esc(). Cada etiqueta HTML abre y cierra en la misma línea
// (así el recorte por líneas nunca deja etiquetas sin cerrar).
import type { AdjustmentPreview, Proposal, Validation } from './engine';
import type { Session } from './db';
import type { InlineButton, Keyboard } from './telegram';
import { describeInvalid } from './render';
import { fmtMoney, fmtNum, short } from './text';

export function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export interface View {
  html: string;
  kb?: Keyboard;
}

export const PCTS = ['-50', '-30', '-20', '-10', '+10', '+20', '+30', '+50'] as const;
export const PAGE = 8;

const b = (text: string, data: string): InlineButton => ({ text, callback_data: data });
export const BACK = b('« Volver', 'm:home');

/** Callback data aceptados (lista cerrada). Todo lo demás se rechaza. */
export const CALLBACK_PATTERNS: RegExp[] = [
  /^m:(home|load|upl|alr|prop|exp|tmp|dl|his|lim|del|help)$/,
  /^(ap|rj):[0-9a-f]{8}:\d{1,6}$/,
  /^a[jc]:[0-9a-f]{8}$/,
  /^del:([0-9a-f]{8}|-)$/,
  /^tg:[0-9a-f]{8}:\d{1,6}$/,
  /^tl:[0-9a-f]{8}:\d{1,6}:[pi]:\d{1,3}$/,
  /^tx:[0-9a-f]{8}:\d{1,6}:[pi]:\d{1,3}$/,
  /^tp:[0-9a-f]{8}:\d{1,6}:[gpi]:\d{1,3}:(-50|-30|-20|-10|\+10|\+20|\+30|\+50)$/,
];
export const isKnownCallback = (d: string) => d.length <= 64 && CALLBACK_PATTERNS.some((r) => r.test(d));

function rows2(btns: InlineButton[]): Keyboard {
  const out: Keyboard = [];
  for (let i = 0; i < btns.length; i += 2) out.push(btns.slice(i, i + 2));
  return out;
}

export type SessionState = 'vacia' | 'sin_alertas' | 'bloqueada' | 'propuesta' | 'aprobada' | 'rechazada';

export function stateOf(s: Session | null, p: Proposal | null): SessionState {
  if (!s || !p) return 'vacia';
  if (s.approvedVersion === s.version) return 'aprobada';
  if (s.rejectedVersion === s.version) return 'rechazada';
  if (p.blocked) return 'bloqueada';
  if (!p.lines.length) return 'sin_alertas';
  return 'propuesta';
}

/** Menú principal: solo lo que tiene sentido en el estado actual. */
export function menuKeyboard(st: SessionState): Keyboard {
  const load = b('📦 Cargar muestra', 'm:load');
  const upl = b('📄 Subir mi archivo', 'm:upl');
  const alr = b('🚨 Ver alertas', 'm:alr');
  const prop = b('🧾 Ver propuesta', 'm:prop');
  const exp = b('💬 Explicar', 'm:exp');
  const tmp = b('🌦️ Ajustar por temporada', 'm:tmp');
  const dec = b('✅ Aprobar / ❌ Rechazar', 'm:prop');
  const dl = b('⬇️ Descargar borrador', 'm:dl');
  const his = b('🕓 Historial', 'm:his');
  const lim = b('📊 Mis límites', 'm:lim');
  const del = b('🗑️ Borrar mis datos', 'm:del');
  const help = b('❓ Ayuda', 'm:help');
  const by: Record<SessionState, InlineButton[]> = {
    vacia: [load, upl, lim, help],
    sin_alertas: [alr, prop, his, lim, load, upl, del, help],
    bloqueada: [alr, prop, his, lim, load, upl, del, help],
    propuesta: [prop, dec, alr, exp, tmp, his, lim, load, upl, del, help],
    aprobada: [dl, prop, exp, tmp, his, lim, load, upl, del, help],
    rechazada: [prop, tmp, his, lim, load, upl, del, help],
  };
  return rows2(by[st]);
}

const STATUS: Record<SessionState, string> = {
  vacia: 'Aún no hay inventario cargado.',
  sin_alertas: '✅ Ningún insumo válido está bajo su mínimo.',
  bloqueada: '⚠️ Hay filas inválidas y la política es «bloquear».',
  propuesta: '🧾 Hay una propuesta pendiente de tu decisión.',
  aprobada: '✅ Propuesta aprobada: puedes descargar el borrador.',
  rechazada: '❌ Propuesta rechazada: ajusta o carga otro inventario.',
};

export function homeView(s: Session | null, p: Proposal | null): View {
  const st = stateOf(s, p);
  const lines = ['🏠 <b>Menú principal</b>', 'Asistente automático de DEMOSTRACIÓN con datos ficticios. Nunca envío pedidos a proveedores.', ''];
  if (s && p) lines.push(`Inventario: ${esc(short(s.source, 40))} · propuesta v${s.version} · ${p.lines.length} bajo mínimo`);
  lines.push(STATUS[st]);
  return { html: lines.join('\n'), kb: menuKeyboard(st) };
}

export const WELCOME_HTML = [
  '👋 Hola. Soy un <b>asistente automático de DEMOSTRACIÓN</b> para reabastecimiento con datos ficticios.',
  'Reviso un inventario contra mínimos, propongo un pedido por proveedor con la regla propuesta para la demo y redacto un borrador.',
  'Tú apruebas; yo nunca envío nada a proveedores.',
  '',
  'Usa los botones de abajo; no necesitas memorizar comandos. También puedes subir un .csv o .xlsx (máx. 200 KB, 500 filas).',
].join('\n');

export function helpView(): View {
  const html = [
    '❓ <b>Ayuda</b>',
    'Trabajo con botones: abre el menú con /menu.',
    '',
    '<b>Comandos (opcionales)</b>',
    '/muestra carga el inventario ficticio de ejemplo',
    '/explicar explica la propuesta',
    '/temporada +20 · /temporada -10 proveedor Nombre · /temporada 15 insumo Nombre',
    '/aprobar muestra la propuesta con Aprobar y Rechazar',
    '/borrador descarga el borrador aprobado',
    '/historial cambios de esta sesión',
    '/limites tu uso de la demo',
    '/borrar elimina tus datos (pide confirmación)',
    '',
    'Archivo: columnas insumo, unidad, existencia, minimo, maximo, proveedor, costo.',
    'Los datos se borran solos a los 7 días. Nunca envío pedidos a proveedores.',
  ].join('\n');
  return { html, kb: [[BACK]] };
}

export function uploadView(): View {
  const html = [
    '📄 <b>Subir mi archivo</b>',
    '1. Toca el clip 📎 de Telegram y elige <b>Archivo</b>.',
    '2. Adjunta un .csv o .xlsx (máx. 200 KB y 500 filas; solo la primera hoja).',
    '3. Columnas: <code>insumo, unidad, existencia, minimo, maximo, proveedor, costo</code>.',
    'Usa solo datos ficticios. Si una fila tiene un dato inválido, la señalo y no invento valores.',
  ].join('\n');
  return { html, kb: [[BACK]] };
}

function excludedLines(p: Proposal, max = 15): string[] {
  if (!p.excluded.length) return [];
  const out = ['', `⚠️ <b>Filas excluidas por datos inválidos (${p.excluded.length})</b>; no invento valores:`];
  for (const r of p.excluded.slice(0, max)) out.push(`• ${esc(describeInvalid(r))}`);
  if (p.excluded.length > max) out.push(`• … y ${p.excluded.length - max} más (ver borrador)`);
  return out;
}

export function alertsView(p: Proposal): View {
  const out = ['🚨 <b>Alertas</b>'];
  if (!p.lines.length) out.push('✅ Ningún insumo válido está bajo su mínimo.');
  else {
    out.push(`${p.lines.length} insumos bajo mínimo (existencia &lt; mínimo):`);
    for (const l of p.lines) out.push(`🚨 ${esc(short(l.insumo, 40))}: tiene ${fmtNum(l.existencia)}, mín ${fmtNum(l.minimo)} ${esc(short(l.unidad, 15))}`);
  }
  out.push(...excludedLines(p));
  return { html: out.join('\n'), kb: [[b('🧾 Ver propuesta', 'm:prop'), BACK]] };
}

export function summaryHtml(v: Validation, p: Proposal, version: number, source: string): string {
  const out: string[] = [];
  out.push(`🧾 <b>Propuesta v${version}</b>`);
  out.push(`Inventario: ${esc(short(source, 40))} · ${v.totalRows} insumos · propuesta v${version}`);
  out.push('Regla propuesta para la demo: alerta si existencia &lt; mínimo; cantidad = máximo − existencia.');
  if (v.warnings.length) out.push(...v.warnings.map((w) => `⚠️ Aviso: ${esc(short(w, 200))}`));
  if (p.lines.length === 0) {
    out.push('', '✅ Ningún insumo válido está bajo su mínimo. No propongo compras.');
  } else {
    out.push('', `🚨 <b>${p.lines.length} insumos bajo mínimo</b>:`);
    for (const g of p.groups) {
      out.push('', `🏷️ <b>${esc(short(g.proveedor, 40))}</b> — subtotal ${fmtMoney(g.subtotal)}`);
      for (const l of g.lines) {
        const adj = l.pctAplicado ? ` (ajuste ${l.pctAplicado > 0 ? '+' : ''}${l.pctAplicado} %)` : '';
        out.push(`• ${esc(short(l.insumo, 40))}: tiene ${fmtNum(l.existencia)}, mín ${fmtNum(l.minimo)}, máx ${fmtNum(l.maximo)} → pedir <b>${fmtNum(l.cantidad)} ${esc(short(l.unidad, 15))}</b>${adj}`);
      }
    }
    out.push('', `<b>Total estimado: ${fmtMoney(p.total)}</b>`);
  }
  out.push(...excludedLines(p));
  if (p.excluded.length) out.push(p.blocked ? 'Política «bloquear»: corrige el archivo para poder aprobar.' : 'Política «parcial explícita»: solo se aprueban las filas válidas.');
  if (p.lines.length && !p.blocked) out.push('', 'Revisa y decide con los botones. Yo no envío nada a proveedores.');
  return out.join('\n');
}

export function proposalView(s: Session, p: Proposal): View {
  const kb: Keyboard = [];
  const st = stateOf(s, p);
  if (st === 'propuesta') kb.push([b(`✅ Aprobar v${s.version}`, `ap:${s.sessionId}:${s.version}`), b(`❌ Rechazar v${s.version}`, `rj:${s.sessionId}:${s.version}`)]);
  let html = summaryHtml(s.validation, p, s.version, s.source);
  if (st === 'aprobada') {
    html += `\n\n✅ <b>Aprobada (v${s.version}).</b>`;
    kb.push([b('⬇️ Descargar borrador', 'm:dl')]);
  }
  if (st === 'rechazada') html += `\n\n❌ <b>Rechazada (v${s.version}).</b> Ajusta por temporada o carga otro inventario.`;
  if (st === 'propuesta' || st === 'aprobada' || st === 'rechazada') kb.push([b('🌦️ Ajustar por temporada', 'm:tmp')]);
  kb.push([BACK]);
  return { html, kb };
}

// ---------- temporada por botones ----------
export function tempScopeView(s: Session, p: Proposal): View {
  if (!p.lines.length) return { html: '🌦️ No hay insumos en la propuesta para ajustar.', kb: [[BACK]] };
  const k = `${s.sessionId}:${s.version}`;
  return {
    html: ['🌦️ <b>Ajustar por temporada</b> (v' + s.version + ')', '¿A qué quieres aplicar el ajuste?', 'Rango permitido: −50 % a +50 %; nunca supera el máximo.'].join('\n'),
    kb: [[b('🌐 Todo', `tg:${k}`)], [b('🏷️ Por proveedor', `tl:${k}:p:0`), b('🥫 Por insumo', `tl:${k}:i:0`)], [BACK]],
  };
}

export function targetsOf(p: Proposal, kind: 'p' | 'i'): string[] {
  return kind === 'p' ? p.groups.map((g) => g.proveedor) : p.lines.map((l) => l.insumo);
}

export function tempListView(s: Session, p: Proposal, kind: 'p' | 'i', page: number): View {
  const items = targetsOf(p, kind);
  const pages = Math.max(1, Math.ceil(items.length / PAGE));
  const pg = Math.min(Math.max(0, page), pages - 1);
  const k = `${s.sessionId}:${s.version}`;
  const btns = items.slice(pg * PAGE, pg * PAGE + PAGE).map((name, j) => b(short(name, 28), `tx:${k}:${kind}:${pg * PAGE + j}`));
  const kb = rows2(btns);
  const nav: InlineButton[] = [];
  if (pg > 0) nav.push(b('‹ Anterior', `tl:${k}:${kind}:${pg - 1}`));
  if (pg < pages - 1) nav.push(b('Siguiente ›', `tl:${k}:${kind}:${pg + 1}`));
  if (nav.length) kb.push(nav);
  kb.push([b('« Volver', 'm:tmp')]);
  const title = kind === 'p' ? 'Elige un proveedor' : 'Elige un insumo';
  return { html: `🌦️ <b>${title}</b>${pages > 1 ? ` (página ${pg + 1} de ${pages})` : ''}`, kb };
}

export function tempPctView(s: Session, scope: 'g' | 'p' | 'i', idx: number, label: string): View {
  const k = `${s.sessionId}:${s.version}`;
  const btns = PCTS.map((pc) => b(`${pc.replace('-', '−')} %`, `tp:${k}:${scope}:${idx}:${pc}`));
  const who = scope === 'g' ? 'todos los insumos' : `${scope === 'p' ? 'proveedor' : 'insumo'} <b>${esc(short(label, 40))}</b>`;
  return {
    html: `🌦️ <b>Porcentaje</b> para ${who}\nElige cuánto subir o bajar. Verás antes/después y nada cambia hasta que confirmes.`,
    kb: [btns.slice(0, 4), btns.slice(4, 8), [b('« Volver', 'm:tmp')]],
  };
}

export function previewHtml(pv: AdjustmentPreview): string {
  const out: string[] = [];
  const scope = pv.scope === 'global' ? 'todos los insumos' : `${pv.scope} ${esc(short(pv.target ?? '', 40))}`;
  out.push(`🌦️ <b>Ajuste por temporada propuesto:</b> ${pv.appliedPct > 0 ? '+' : ''}${pv.appliedPct} % a ${scope}.`);
  out.push(...pv.notes.map(esc));
  out.push('', 'Antes → después:');
  const before = new Map(pv.before.lines.map((l) => [l.fila, l]));
  let changed = 0;
  for (const a of pv.after.lines) {
    const bl = before.get(a.fila);
    if (bl && bl.cantidad !== a.cantidad) {
      changed++;
      out.push(`• ${esc(short(a.insumo, 40))}: ${fmtNum(bl.cantidad)} → <b>${fmtNum(a.cantidad)}</b> ${esc(short(a.unidad, 15))} (tope ${fmtNum(a.base)})`);
    }
  }
  if (!changed) out.push('• Ninguna cantidad cambia (topes por máximo o sin insumos afectados).');
  out.push('', `Total: ${fmtMoney(pv.before.total)} → <b>${fmtMoney(pv.after.total)}</b>`);
  out.push('Nada cambia hasta que confirmes.');
  return out.join('\n');
}

export function previewView(pv: AdjustmentPreview, nonce: string): View {
  return { html: previewHtml(pv), kb: [[b('✅ Confirmar ajuste', `aj:${nonce}`), b('« Cancelar', `ac:${nonce}`)]] };
}

/** El botón de confirmar va ligado a la sesión vigente («-» si no hay sesión). */
export function deleteConfirmView(sessionId: string | null): View {
  return {
    html: '🗑️ <b>¿Borrar tus datos de esta demo?</b>\nSe eliminan tu inventario, propuestas e historial. No se puede deshacer.',
    kb: [[b('🗑️ Sí, borrar', `del:${sessionId ?? '-'}`), b('« Cancelar', 'm:home')]],
  };
}
