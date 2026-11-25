// Orquestación de un update de Telegram. Todo efecto se decide en código; la IA solo interpreta/redacta.
// UX estilo BotFather: menú inline según el estado; las vistas editan el mensaje del menú; acciones con efecto
// (aprobar, rechazar, confirmar ajuste, borrar) conservan las verificaciones de dueño, versión e idempotencia.
import { DEFAULT_RULE, LIMITS, type RuleConfig } from './config';
import { parseCsv } from './csv';
import { buildProposal, emptyAdjustments, previewAdjustment, validateInventory, type AdjustmentRequest, type Proposal, type Validation } from './engine';
import type { Session, Store } from './db';
import type { TelegramClient, Keyboard } from './telegram';
import { LlmError, type LlmClient } from './llm';
import { classify, explain, type Intent } from './ai';
import { Quota, demoActive } from './limits';
import { SIN_IA, draftText } from './render';
import {
  BACK,
  WELCOME_HTML,
  alertsView,
  deleteConfirmView,
  esc,
  helpView,
  homeView,
  isKnownCallback,
  menuKeyboard,
  previewView,
  proposalView,
  stateOf,
  targetsOf,
  tempListView,
  tempPctView,
  tempScopeView,
  uploadView,
  type View,
} from './ui';
import { parseUpload, precheck } from './files';
import { fmtMoney } from './text';
import muestraCsv from '../../fixtures/inventario-muestra.csv';

export interface TgUpdate {
  update_id: number;
  message?: {
    message_id: number;
    chat: { id: number; type: string };
    from?: { id: number };
    text?: string;
    document?: { file_id: string; file_name?: string; file_size?: number };
  };
  callback_query?: {
    id: string;
    from: { id: number };
    data?: string;
    message?: { message_id?: number; chat: { id: number; type: string } };
  };
}

export interface Deps {
  store: Store;
  tg: TelegramClient;
  llm: LlmClient;
  now: () => number;
  demoUntil?: string;
  maxAiTotal?: number;
  rule?: RuleConfig;
  randomId?: () => string;
}

const defaultRandomId = () => {
  const b = new Uint8Array(4);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
};

const REJECTED_NEXT = (v: number) =>
  `❌ Rechazaste la propuesta v${v}. No genero borrador. Para una nueva propuesta: ajusta por temporada, carga la muestra o sube otro inventario.`;
const NOT_CURRENT = (v: number, cur: number) => `Esta versión (v${v}) ya no está vigente. La vigente es v${cur}.`;

function aiFailText(e: unknown): string {
  if (e instanceof LlmError && e.kind === 'tope_gasto') return 'La demo alcanzó su tope de gasto de IA; sigo con plantillas.';
  return 'No pude consultar la IA ahora.';
}

export async function handleUpdate(u: TgUpdate, d: Deps): Promise<void> {
  const bot = new Bot(d);
  if (u.callback_query) return bot.onCallback(u.callback_query);
  if (u.message) return bot.onMessage(u.message);
}

class Bot {
  rule: RuleConfig;
  quota: Quota;
  rid: () => string;
  /** Mensaje a editar (solo durante una vista pedida por botón). */
  target: { chatId: number; messageId: number } | null = null;
  cbId: string | null = null;
  acked = false;

  constructor(private d: Deps) {
    this.rule = d.rule ?? DEFAULT_RULE;
    this.quota = new Quota(d.store, d.now, d.maxAiTotal);
    this.rid = d.randomId ?? defaultRandomId;
  }

  get active() {
    return demoActive(this.d.demoUntil, this.d.now());
  }

  // ---------- salida ----------
  /** Responde el callback una sola vez (mejor esfuerzo: un callback viejo no debe provocar reintentos). */
  async ack(text?: string): Promise<void> {
    if (!this.cbId || this.acked) return;
    this.acked = true;
    try {
      await this.d.tg.answerCallback(this.cbId, text);
    } catch {
      /* callback vencido o repetido */
    }
  }

  /** Muestra una vista: edita el mensaje del menú si viene de un botón; si no, o si falla, envía uno nuevo. */
  async show(chatId: number, v: View): Promise<void> {
    const t = this.target;
    this.target = null;
    if (t && t.chatId === chatId) {
      try {
        await this.d.tg.editMessageText(chatId, t.messageId, v.html, v.kb);
        return;
      } catch {
        /* mensaje no editable: se envía uno nuevo */
      }
    }
    await this.d.tg.sendMessage(chatId, v.html, v.kb);
  }

  async ctx(chatId: number): Promise<{ s: Session | null; p: Proposal | null }> {
    const s = await this.d.store.getSession(chatId);
    return { s, p: s ? buildProposal(s.validation, this.rule, s.adjustments) : null };
  }

  async menuKb(chatId: number): Promise<Keyboard> {
    const { s, p } = await this.ctx(chatId);
    return menuKeyboard(stateOf(s, p));
  }

  /** Texto plano (se escapa) con el menú del estado actual debajo, salvo que se pase otro teclado. */
  async say(chatId: number, text: string, kb?: Keyboard): Promise<void> {
    return this.show(chatId, { html: esc(text), kb: kb ?? (await this.menuKb(chatId)) });
  }

  // ---------- mensajes ----------
  async onMessage(m: NonNullable<TgUpdate['message']>): Promise<void> {
    const chatId = m.chat.id;
    if (m.chat.type !== 'private') return; // solo chats privados; en grupos no respondemos
    const text = (m.text ?? '').trim();
    const cmd = /^\/([a-z_]+)(?:@\w+)?(?:\s+([\s\S]*))?$/i.exec(text);
    const name = cmd?.[1]?.toLowerCase();
    const args = (cmd?.[2] ?? '').trim();

    if (name === 'borrar') return this.show(chatId, deleteConfirmView());
    if (!this.active) return this.show(chatId, { html: esc('Esta demo ya concluyó. Puedes usar /borrar para eliminar tus datos.') });

    if (m.document) return this.onDocument(chatId, m.document);
    switch (name) {
      case 'start': {
        const { s, p } = await this.ctx(chatId);
        return this.show(chatId, { html: WELCOME_HTML, kb: menuKeyboard(stateOf(s, p)) });
      }
      case 'menu':
        return this.viewHome(chatId);
      case 'ayuda':
      case 'help':
        return this.show(chatId, helpView());
      case 'muestra':
        return this.loadMuestra(chatId);
      case 'explicar':
        return this.cmdExplicar(chatId);
      case 'temporada':
        return this.cmdTemporada(chatId, args);
      case 'aprobar':
        return this.cmdAprobar(chatId);
      case 'borrador':
        return this.cmdBorrador(chatId);
      case 'historial':
        return this.cmdHistorial(chatId);
      case 'limites':
        return this.cmdLimites(chatId);
      case undefined:
        break;
      default:
        return this.say(chatId, 'No conozco ese comando. Usa el menú o /ayuda.');
    }
    if (!text) return this.say(chatId, 'Envíame un archivo .csv/.xlsx, una pregunta corta o usa el menú.');
    return this.onFreeText(chatId, text);
  }

  async onFreeText(chatId: number, text: string): Promise<void> {
    const r = await this.quota.reserveAi(chatId);
    if (!r.ok) return this.say(chatId, `${SIN_IA} Llegaste al límite de IA (${r.reason === 'minuto' ? 'por minuto' : r.reason === 'dia' ? 'diario' : r.reason === 'global' ? 'global diario de la demo' : 'total de la demo'}). Usa el menú.`);
    let intent: Intent | null = null;
    try {
      intent = await classify(this.d.llm, text);
    } catch (e) {
      return this.say(chatId, `${SIN_IA} ${aiFailText(e)} Usa el menú.`);
    }
    if (!intent) return this.say(chatId, `${SIN_IA} No entendí tu mensaje. Usa el menú.`);
    switch (intent.intent) {
      case 'ayuda':
        return this.show(chatId, helpView());
      case 'muestra':
        return this.say(chatId, 'Para cargar el inventario de ejemplo toca «📦 Cargar muestra» o usa /muestra.');
      case 'explicar':
        return this.cmdExplicar(chatId); // reserva su propia llamada (cada llamada real reserva antes)
      case 'temporada':
        return this.startAdjust(chatId, { scope: intent.alcance ?? 'global', target: intent.objetivo, pct: intent.pct! });
      case 'aprobar':
        return this.cmdAprobar(chatId);
      case 'borrador':
        return this.cmdBorrador(chatId);
      case 'historial':
        return this.cmdHistorial(chatId);
      case 'limites':
        return this.cmdLimites(chatId);
      case 'borrar':
        return this.say(chatId, 'Para borrar tus datos toca «🗑️ Borrar mis datos» o usa /borrar.');
      default:
        return this.say(chatId, 'Eso está fuera de lo que hago. Solo reviso inventario, propongo y redacto pedidos ficticios; no envío pedidos ni cambio mínimos o máximos.');
    }
  }

  async onDocument(chatId: number, doc: NonNullable<NonNullable<TgUpdate['message']>['document']>): Promise<void> {
    const pre = precheck(doc.file_name, doc.file_size);
    if (pre) return this.say(chatId, `⚠️ ${pre}`);
    if (!(await this.quota.reserveFile(chatId))) return this.say(chatId, `Llegaste al límite de ${LIMITS.filesPerDayPerChat} archivos por día en esta demo.`);
    const bytes = await this.d.tg.downloadFile(doc.file_id);
    const res = parseUpload(doc.file_name!, bytes);
    if (!res.ok) return this.say(chatId, `⚠️ ${res.error}`);
    const v = validateInventory(res.table, this.rule);
    if (v.fatal) return this.say(chatId, `⚠️ No pude usar el archivo: ${v.fatal}`);
    return this.loadValidation(chatId, `archivo ${doc.file_name}`, v);
  }

  loadMuestra(chatId: number) {
    return this.loadValidation(chatId, 'muestra ficticia', validateInventory(parseCsv(muestraCsv), this.rule));
  }

  async loadValidation(chatId: number, source: string, v: Validation): Promise<void> {
    const sid = this.rid();
    await this.d.store.replaceSession(chatId, sid, source.slice(0, 80), v, emptyAdjustments());
    const p = buildProposal(v, this.rule, emptyAdjustments());
    await this.d.store.addHistory(chatId, sid, 1, 'carga', `${source.slice(0, 80)}: ${v.totalRows} filas, ${p.lines.length} bajo mínimo, ${v.invalidRows.length} excluidas`);
    return this.viewProposal(chatId);
  }

  async requireSession(chatId: number): Promise<Session | null> {
    const s = await this.d.store.getSession(chatId);
    if (!s) await this.say(chatId, 'Aún no hay inventario. Toca «📦 Cargar muestra» o súbeme un archivo.');
    return s;
  }

  // ---------- vistas ----------
  async viewHome(chatId: number) {
    const { s, p } = await this.ctx(chatId);
    return this.show(chatId, homeView(s, p));
  }

  async viewProposal(chatId: number) {
    const { s, p } = await this.ctx(chatId);
    if (!s || !p) return this.say(chatId, 'Aún no hay inventario. Toca «📦 Cargar muestra» o súbeme un archivo.');
    return this.show(chatId, proposalView(s, p));
  }

  async viewAlerts(chatId: number) {
    const { s, p } = await this.ctx(chatId);
    if (!s || !p) return this.say(chatId, 'Aún no hay inventario. Toca «📦 Cargar muestra» o súbeme un archivo.');
    return this.show(chatId, alertsView(p));
  }

  async viewTemporada(chatId: number) {
    const { s, p } = await this.ctx(chatId);
    if (!s || !p) return this.say(chatId, 'Aún no hay inventario. Toca «📦 Cargar muestra» o súbeme un archivo.');
    return this.show(chatId, tempScopeView(s, p));
  }

  async cmdExplicar(chatId: number): Promise<void> {
    const s = await this.requireSession(chatId);
    if (!s) return;
    const p = buildProposal(s.validation, this.rule, s.adjustments);
    const back: Keyboard = [[{ text: '🧾 Ver propuesta', callback_data: 'm:prop' }, BACK]];
    const template = () =>
      `${SIN_IA} ${p.lines.length} insumos están bajo su mínimo. Para cada uno, la regla propuesta para la demo pide máximo − existencia${p.lines.some((l) => l.pctAplicado) ? ', con el ajuste de temporada que confirmaste y sin pasar del máximo' : ''}. Total estimado ${fmtMoney(p.total)} en ${p.groups.length} proveedores. ${p.excluded.length ? `${p.excluded.length} filas quedaron fuera por datos inválidos. ` : ''}Tú apruebas; yo no envío nada a proveedores.`;
    const r = await this.quota.reserveAi(chatId);
    if (!r.ok) return this.say(chatId, template(), back);
    try {
      const t = await explain(this.d.llm, p);
      if (!t) return this.say(chatId, template(), back);
      return this.show(chatId, { html: `🤖 ${esc(t)}\n\n<i>(Explicación redactada por IA; las cifras oficiales son las de la propuesta.)</i>`, kb: back });
    } catch (e) {
      return this.say(chatId, e instanceof LlmError && e.kind === 'tope_gasto' ? `${template()}\n(La demo alcanzó su tope de gasto de IA.)` : template(), back);
    }
  }

  parseTemporada(args: string): AdjustmentRequest | null {
    const m = /^([+-]?\d+(?:[.,]\d+)?)\s*%?\s*(?:(proveedor|insumo)\s+(.+))?$/i.exec(args);
    if (!m) return null;
    const pct = Number(m[1].replace(',', '.'));
    const scope = (m[2]?.toLowerCase() as 'proveedor' | 'insumo' | undefined) ?? 'global';
    return { scope, target: m[3]?.trim(), pct };
  }

  async cmdTemporada(chatId: number, args: string): Promise<void> {
    if (!args) return this.viewTemporada(chatId); // sin argumentos: submenú con botones
    const req = this.parseTemporada(args);
    if (!req) return this.say(chatId, `Indica el porcentaje. Ejemplos:\n/temporada +20\n/temporada -10 proveedor Abarrotes Ficticios\n/temporada 15 insumo Arroz\nRango permitido: ${this.rule.temporada.minPct} % a +${this.rule.temporada.maxPct} %.`);
    return this.startAdjust(chatId, req);
  }

  async startAdjust(chatId: number, req: AdjustmentRequest): Promise<void> {
    const s = await this.requireSession(chatId);
    if (!s) return;
    const pv = previewAdjustment(s.validation, this.rule, s.adjustments, req);
    if (pv.error) return this.say(chatId, pv.error);
    const nonce = this.rid();
    const ok = await this.d.store.setPendingAdjust(chatId, s.sessionId, s.version, { id: nonce, baseVersion: s.version, req, appliedPct: pv.appliedPct, target: pv.target, next: pv.next });
    if (!ok) return this.say(chatId, 'La propuesta cambió mientras tanto. Intenta de nuevo.');
    return this.show(chatId, previewView(pv, nonce));
  }

  async cmdAprobar(chatId: number): Promise<void> {
    const s = await this.requireSession(chatId);
    if (!s) return;
    if (s.approvedVersion === s.version) return this.say(chatId, `✅ La propuesta v${s.version} ya está aprobada. Puedes descargar el borrador.`);
    if (s.rejectedVersion === s.version) return this.say(chatId, REJECTED_NEXT(s.version));
    const p = buildProposal(s.validation, this.rule, s.adjustments);
    if (!p.lines.length) return this.say(chatId, 'No hay nada que aprobar: ningún insumo válido está bajo mínimo.');
    if (p.blocked) return this.say(chatId, 'No se puede aprobar: hay filas inválidas y la política es «bloquear».');
    return this.show(chatId, proposalView(s, p));
  }

  async cmdBorrador(chatId: number): Promise<void> {
    const s = await this.requireSession(chatId);
    if (!s) return;
    if (s.rejectedVersion === s.version) return this.say(chatId, `La propuesta v${s.version} fue rechazada; no hay borrador.`);
    if (s.approvedVersion !== s.version) return this.say(chatId, `Aún no apruebas la propuesta vigente (v${s.version}). Usa «✅ Aprobar / ❌ Rechazar».`);
    return this.sendDraft(s);
  }

  async sendDraft(s: Session): Promise<void> {
    const p = buildProposal(s.validation, this.rule, s.adjustments);
    const hist = await this.d.store.getHistory(s.chatId, s.sessionId);
    const body = draftText(p, s.version, s.sessionId, hist, this.d.now());
    await this.d.tg.sendDocument(s.chatId, `borrador-pedido-v${s.version}.txt`, body, `Borrador v${s.version} (datos ficticios). No se envió nada a proveedores: revísalo y envíalo tú si procede.`);
  }

  async cmdHistorial(chatId: number): Promise<void> {
    const s = await this.requireSession(chatId);
    if (!s) return;
    const h = await this.d.store.getHistory(chatId, s.sessionId);
    const icon = (k: string) => (k === 'aprobada' ? '✅' : k === 'rechazada' ? '❌' : k.startsWith('ajuste') ? '🌦️' : '📦');
    const lines = h.slice(-20).map((x) => `${icon(x.kind)} v${x.version} ${esc(x.kind)}: ${esc(x.detail.slice(0, 200))}`);
    return this.show(chatId, { html: `🕓 <b>Historial de esta sesión</b>\n${lines.join('\n') || '• (vacío)'}`, kb: [[BACK]] });
  }

  async cmdLimites(chatId: number): Promise<void> {
    const u = await this.quota.usage(chatId);
    const html = [
      '📊 <b>Tu uso hoy</b> (día UTC)',
      `• IA: <code>${u.aiDay}/${LIMITS.aiPerDayPerChat}</code> por día · <code>${u.aiMin}/${LIMITS.aiPerMinutePerChat}</code> este minuto`,
      `• Archivos: <code>${u.files}/${LIMITS.filesPerDayPerChat}</code>`,
      `• IA global de la demo hoy: <code>${u.aiGlobal}/${LIMITS.aiPerDayGlobal}</code>; acumulado <code>${u.aiTotal}/${u.maxTotal}</code>`,
      `Si la IA se agota, respondo con plantillas marcadas ${esc(SIN_IA)}.`,
    ].join('\n');
    return this.show(chatId, { html, kb: [[BACK]] });
  }

  // ---------- botones ----------
  async onCallback(q: NonNullable<TgUpdate['callback_query']>): Promise<void> {
    this.cbId = q.id;
    try {
      await this.routeCallback(q);
    } finally {
      await this.ack(); // siempre se responde (sin texto si nadie respondió antes)
    }
  }

  async routeCallback(q: NonNullable<TgUpdate['callback_query']>): Promise<void> {
    const chat = q.message?.chat;
    // Solo el dueño del chat privado puede accionar sus botones.
    if (!chat || chat.type !== 'private' || chat.id !== q.from.id) return this.ack('Acción no permitida.');
    const chatId = chat.id;
    const data = q.data ?? '';
    if (!isKnownCallback(data)) return this.ack('Botón no válido.');
    if (!this.active && data !== 'del:y' && data !== 'm:del') return this.ack('La demo concluyó.');
    // Las vistas editan el mensaje donde se pulsó el botón.
    if (q.message?.message_id !== undefined) this.target = { chatId, messageId: q.message.message_id };

    let m: RegExpExecArray | null;
    if ((m = /^m:(\w+)$/.exec(data))) return this.onMenu(chatId, m[1]);
    if (data === 'del:y') {
      await this.d.store.deleteChat(chatId);
      await this.ack('Datos borrados.');
      return this.show(chatId, { html: '✅ Listo: borré tu inventario, propuestas e historial de esta demo.', kb: menuKeyboard('vacia') });
    }
    // Aprobar/rechazar responden con mensajes nuevos; temporada y confirmar/cancelar ajuste editan la vista.
    this.target = this.target && /^(tg|tl|tx|tp|aj|ac):/.test(data) ? this.target : null;
    if ((m = /^ap:([0-9a-f]{8}):(\d{1,6})$/.exec(data))) return this.onApprove(chatId, m[1], Number(m[2]));
    if ((m = /^rj:([0-9a-f]{8}):(\d{1,6})$/.exec(data))) return this.onReject(chatId, m[1], Number(m[2]));
    if ((m = /^a([jc]):([0-9a-f]{8})$/.exec(data))) return this.onAdjustDecision(chatId, m[1] === 'j', m[2]);
    if ((m = /^t([glxp]):([0-9a-f]{8}):(\d{1,6})(?::([gpi]):(\d{1,3}))?(?::([-+]\d{2}))?$/.exec(data))) {
      return this.onTemporadaButton(chatId, m[1], m[2], Number(m[3]), m[4] as 'g' | 'p' | 'i' | undefined, m[5] !== undefined ? Number(m[5]) : 0, m[6]);
    }
    return this.ack('Botón no válido.');
  }

  async onMenu(chatId: number, what: string): Promise<void> {
    switch (what) {
      case 'home':
        return this.viewHome(chatId);
      case 'load':
        await this.ack('Cargando la muestra ficticia…');
        return this.loadMuestra(chatId);
      case 'upl':
        return this.show(chatId, uploadView());
      case 'alr':
        return this.viewAlerts(chatId);
      case 'prop':
        return this.viewProposal(chatId);
      case 'exp':
        await this.ack('Preparando la explicación…');
        return this.cmdExplicar(chatId);
      case 'tmp':
        return this.viewTemporada(chatId);
      case 'dl': {
        this.target = null;
        const s = await this.d.store.getSession(chatId);
        if (!s || s.approvedVersion !== s.version) return this.ack('Primero aprueba la propuesta vigente.');
        await this.ack('Enviando el borrador…');
        return this.sendDraft(s);
      }
      case 'his':
        return this.cmdHistorial(chatId);
      case 'lim':
        return this.cmdLimites(chatId);
      case 'del':
        return this.show(chatId, deleteConfirmView());
      case 'help':
        return this.show(chatId, helpView());
    }
  }

  /** Temporada por botones. Índices y versión se resuelven contra la sesión del propio chat. */
  async onTemporadaButton(chatId: number, op: string, sid: string, version: number, kind: 'g' | 'p' | 'i' | undefined, idx: number, pct?: string): Promise<void> {
    const { s, p } = await this.ctx(chatId);
    if (!s || !p || s.sessionId !== sid) return this.ack('Esa propuesta ya no existe.');
    if (s.version !== version) return this.ack(NOT_CURRENT(version, s.version));
    if (op === 'g') return this.show(chatId, tempPctView(s, 'g', 0, ''));
    if (op === 'l' && (kind === 'p' || kind === 'i')) return this.show(chatId, tempListView(s, p, kind, idx));
    const resolve = (k: 'p' | 'i') => targetsOf(p, k)[idx];
    if (op === 'x' && (kind === 'p' || kind === 'i')) {
      const label = resolve(kind);
      if (label === undefined) return this.ack(NOT_CURRENT(version, s.version));
      return this.show(chatId, tempPctView(s, kind, idx, label));
    }
    if (op === 'p' && kind && pct) {
      if (kind === 'g') return this.startAdjust(chatId, { scope: 'global', pct: Number(pct) });
      const label = resolve(kind);
      if (label === undefined) return this.ack(NOT_CURRENT(version, s.version));
      return this.startAdjust(chatId, { scope: kind === 'p' ? 'proveedor' : 'insumo', target: label, pct: Number(pct) });
    }
    return this.ack('Botón no válido.');
  }

  async onApprove(chatId: number, sid: string, version: number): Promise<void> {
    const s = await this.d.store.getSession(chatId);
    if (!s || s.sessionId !== sid) return this.ack('Esa propuesta ya no existe.');
    if (s.version !== version) return this.ack(NOT_CURRENT(version, s.version));
    const p = buildProposal(s.validation, this.rule, s.adjustments);
    if (!p.lines.length || p.blocked) return this.ack('Esta propuesta no se puede aprobar.');
    if (s.rejectedVersion === version) return this.ack(`La v${version} ya fue rechazada; no se puede aprobar.`);
    const first = await this.d.store.approve(chatId, sid, version);
    if (!first) return this.ack(`La v${version} ya estaba aprobada. Descarga el borrador desde el menú.`);
    await this.d.store.addHistory(chatId, sid, version, 'aprobada', `propuesta v${version} aprobada por la persona del chat; total ${fmtMoney(p.total)}`);
    await this.ack(`Propuesta v${version} aprobada.`);
    await this.say(chatId, `✅ Aprobaste la propuesta v${version}. Te envío el borrador. Recuerda: yo no envío nada a proveedores; tú decides si lo mandas.`);
    return this.sendDraft({ ...s, approvedVersion: version });
  }

  async onReject(chatId: number, sid: string, version: number): Promise<void> {
    const s = await this.d.store.getSession(chatId);
    if (!s || s.sessionId !== sid) return this.ack('Esa propuesta ya no existe.');
    if (s.version !== version) return this.ack(NOT_CURRENT(version, s.version));
    if (s.approvedVersion === version) return this.ack(`La v${version} ya estaba aprobada; no se puede rechazar.`);
    const first = await this.d.store.reject(chatId, sid, version);
    if (!first) return this.ack(`La v${version} ya estaba rechazada.`);
    await this.d.store.addHistory(chatId, sid, version, 'rechazada', `propuesta v${version} rechazada por la persona del chat; no se generó borrador`);
    await this.ack(`Propuesta v${version} rechazada.`);
    return this.say(chatId, REJECTED_NEXT(version));
  }

  async onAdjustDecision(chatId: number, confirm: boolean, nonce: string): Promise<void> {
    const s = await this.d.store.getSession(chatId);
    const pa = s?.pendingAdjust;
    if (!s || !pa || pa.id !== nonce || pa.baseVersion !== s.version) return this.ack('Ese ajuste ya no está vigente.');
    if (!confirm) {
      await this.d.store.setPendingAdjust(chatId, s.sessionId, s.version, null);
      await this.d.store.addHistory(chatId, s.sessionId, s.version, 'ajuste cancelado', `${pa.appliedPct} % ${pa.req.scope}${pa.target ? ' ' + pa.target : ''}`);
      await this.ack('Ajuste cancelado. Nada cambió.');
      return this.viewProposal(chatId);
    }
    const ok = await this.d.store.applyPendingAdjust(chatId, s.sessionId, s.version, nonce, pa.next);
    if (!ok) return this.ack('Ese ajuste ya se aplicó o dejó de estar vigente.');
    const v2 = s.version + 1;
    const before = buildProposal(s.validation, this.rule, s.adjustments).total;
    const after = buildProposal(s.validation, this.rule, pa.next).total;
    await this.d.store.addHistory(chatId, s.sessionId, v2, 'ajuste temporada', `${pa.appliedPct > 0 ? '+' : ''}${pa.appliedPct} % ${pa.req.scope}${pa.target ? ' ' + pa.target : ''}; total ${fmtMoney(before)} → ${fmtMoney(after)}; confirmado por la persona`);
    await this.ack(`Ajuste aplicado. Nueva propuesta v${v2}.`);
    return this.viewProposal(chatId);
  }
}
