// Orquestación de un update de Telegram. Todo efecto se decide en código; la IA solo interpreta/redacta.
import { DEFAULT_RULE, LIMITS, type RuleConfig } from './config';
import { parseCsv } from './csv';
import { buildProposal, emptyAdjustments, previewAdjustment, validateInventory, type AdjustmentRequest, type Validation } from './engine';
import type { Session, Store } from './db';
import type { TelegramClient, Keyboard } from './telegram';
import type { LlmClient } from './gemini';
import { classify, explain, type Intent } from './ai';
import { Quota, demoActive } from './limits';
import { HELP, SIN_IA, WELCOME, draftText, previewText, summaryText } from './render';
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
    message?: { chat: { id: number; type: string } };
  };
}

export interface Deps {
  store: Store;
  tg: TelegramClient;
  llm: LlmClient;
  now: () => number;
  demoUntil?: string;
  rule?: RuleConfig;
  randomId?: () => string;
}

const defaultRandomId = () => {
  const b = new Uint8Array(4);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
};

export async function handleUpdate(u: TgUpdate, d: Deps): Promise<void> {
  const bot = new Bot(d);
  if (u.callback_query) return bot.onCallback(u.callback_query);
  if (u.message) return bot.onMessage(u.message);
}

class Bot {
  rule: RuleConfig;
  quota: Quota;
  rid: () => string;
  constructor(private d: Deps) {
    this.rule = d.rule ?? DEFAULT_RULE;
    this.quota = new Quota(d.store, d.now);
    this.rid = d.randomId ?? defaultRandomId;
  }

  get active() {
    return demoActive(this.d.demoUntil, this.d.now());
  }

  say(chatId: number, text: string, kb?: Keyboard) {
    return this.d.tg.sendMessage(chatId, text, kb);
  }

  // ---------------- mensajes ----------------
  async onMessage(m: NonNullable<TgUpdate['message']>): Promise<void> {
    const chatId = m.chat.id;
    if (m.chat.type !== 'private') return; // solo chats privados; en grupos no respondemos
    const text = (m.text ?? '').trim();
    const cmd = /^\/([a-z_]+)(?:@\w+)?(?:\s+([\s\S]*))?$/i.exec(text);
    const name = cmd?.[1]?.toLowerCase();
    const args = (cmd?.[2] ?? '').trim();

    if (name === 'borrar') return this.cmdBorrar(chatId);
    if (!this.active) return this.say(chatId, 'Esta demo ya concluyó. Puedes usar /borrar para eliminar tus datos.');

    if (m.document) return this.onDocument(chatId, m.document);
    switch (name) {
      case 'start':
        return this.say(chatId, WELCOME);
      case 'ayuda':
      case 'help':
        return this.say(chatId, HELP);
      case 'muestra':
        return this.loadValidation(chatId, 'muestra ficticia', validateInventory(parseCsv(muestraCsv), this.rule));
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
        return this.say(chatId, 'No conozco ese comando. Usa /ayuda.');
    }
    if (!text) return this.say(chatId, 'Envíame un comando, un archivo .csv/.xlsx o una pregunta corta. /ayuda');
    return this.onFreeText(chatId, text);
  }

  async onFreeText(chatId: number, text: string): Promise<void> {
    const r = await this.quota.reserveAi(chatId);
    if (!r.ok) return this.say(chatId, `${SIN_IA} Llegaste al límite de IA (${r.reason === 'minuto' ? 'por minuto' : r.reason === 'dia' ? 'diario' : 'global de la demo'}). Usa los comandos: /ayuda`);
    let intent: Intent | null = null;
    try {
      intent = await classify(this.d.llm, text);
    } catch {
      return this.say(chatId, `${SIN_IA} No pude consultar la IA ahora. Usa los comandos: /ayuda`);
    }
    if (!intent) return this.say(chatId, `${SIN_IA} No entendí tu mensaje. Usa los comandos: /ayuda`);
    switch (intent.intent) {
      case 'ayuda':
        return this.say(chatId, HELP);
      case 'muestra':
        return this.say(chatId, 'Para cargar el inventario de ejemplo usa /muestra.');
      case 'explicar':
        return this.cmdExplicar(chatId, true);
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
        return this.say(chatId, 'Para borrar tus datos usa el comando /borrar.');
      default:
        return this.say(chatId, 'Eso está fuera de lo que hago. Solo reviso inventario, propongo y redacto pedidos ficticios; no envío pedidos ni cambio mínimos o máximos. /ayuda');
    }
  }

  async onDocument(chatId: number, doc: NonNullable<NonNullable<TgUpdate['message']>['document']>): Promise<void> {
    const pre = precheck(doc.file_name, doc.file_size);
    if (pre) return this.say(chatId, pre);
    if (!(await this.quota.reserveFile(chatId))) return this.say(chatId, `Llegaste al límite de ${LIMITS.filesPerDayPerChat} archivos por día en esta demo.`);
    const bytes = await this.d.tg.downloadFile(doc.file_id);
    const res = parseUpload(doc.file_name!, bytes);
    if (!res.ok) return this.say(chatId, res.error);
    const v = validateInventory(res.table, this.rule);
    if (v.fatal) return this.say(chatId, `No pude usar el archivo: ${v.fatal}`);
    return this.loadValidation(chatId, `archivo ${doc.file_name}`, v);
  }

  async loadValidation(chatId: number, source: string, v: Validation): Promise<void> {
    const sid = this.rid();
    await this.d.store.replaceSession(chatId, sid, source.slice(0, 80), v, emptyAdjustments());
    const p = buildProposal(v, this.rule, emptyAdjustments());
    await this.d.store.addHistory(chatId, sid, 1, 'carga', `${source.slice(0, 80)}: ${v.totalRows} filas, ${p.lines.length} bajo mínimo, ${v.invalidRows.length} excluidas`);
    return this.sendProposal(chatId, sid, 1, source, v);
  }

  async sendProposal(chatId: number, sid: string, version: number, source: string, v: Validation, adj = emptyAdjustments()) {
    const p = buildProposal(v, this.rule, adj);
    const kb: Keyboard | undefined = p.lines.length && !p.blocked ? [[{ text: `Aprobar propuesta v${version}`, callback_data: `ap:${sid}:${version}` }]] : undefined;
    return this.say(chatId, summaryText(v, p, version, source), kb);
  }

  async requireSession(chatId: number): Promise<Session | null> {
    const s = await this.d.store.getSession(chatId);
    if (!s) await this.say(chatId, 'Aún no hay inventario. Usa /muestra o súbeme un archivo.');
    return s;
  }

  async cmdExplicar(chatId: number, aiAlreadyReserved = false): Promise<void> {
    const s = await this.requireSession(chatId);
    if (!s) return;
    const p = buildProposal(s.validation, this.rule, s.adjustments);
    const template = () =>
      `${SIN_IA} ${p.lines.length} insumos están bajo su mínimo. Para cada uno, la regla propuesta para la demo pide máximo − existencia${p.lines.some((l) => l.pctAplicado) ? ', con el ajuste de temporada que confirmaste y sin pasar del máximo' : ''}. Total estimado ${fmtMoney(p.total)} en ${p.groups.length} proveedores. ${p.excluded.length ? `${p.excluded.length} filas quedaron fuera por datos inválidos. ` : ''}Tú apruebas; yo no envío nada a proveedores.`;
    if (!aiAlreadyReserved) {
      const r = await this.quota.reserveAi(chatId);
      if (!r.ok) return this.say(chatId, template());
    }
    try {
      const t = await explain(this.d.llm, p);
      return this.say(chatId, t ? `${t}\n\n(Explicación redactada por IA; las cifras oficiales son las de la propuesta.)` : template());
    } catch {
      return this.say(chatId, template());
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
    return this.say(chatId, previewText(pv), [[{ text: 'Confirmar ajuste', callback_data: `aj:${nonce}` }, { text: 'Cancelar', callback_data: `ac:${nonce}` }]]);
  }

  async cmdAprobar(chatId: number): Promise<void> {
    const s = await this.requireSession(chatId);
    if (!s) return;
    if (s.approvedVersion === s.version) return this.say(chatId, `La propuesta v${s.version} ya está aprobada. Usa /borrador para descargarla.`);
    const p = buildProposal(s.validation, this.rule, s.adjustments);
    if (!p.lines.length) return this.say(chatId, 'No hay nada que aprobar: ningún insumo válido está bajo mínimo.');
    if (p.blocked) return this.say(chatId, 'No se puede aprobar: hay filas inválidas y la política es «bloquear».');
    return this.sendProposal(chatId, s.sessionId, s.version, s.source, s.validation, s.adjustments);
  }

  async cmdBorrador(chatId: number): Promise<void> {
    const s = await this.requireSession(chatId);
    if (!s) return;
    if (s.approvedVersion !== s.version) return this.say(chatId, `Aún no apruebas la propuesta vigente (v${s.version}). Usa /aprobar.`);
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
    const lines = h.slice(-20).map((x) => `• v${x.version} ${x.kind}: ${x.detail.slice(0, 200)}`);
    return this.say(chatId, `Historial de esta sesión:\n${lines.join('\n') || '• (vacío)'}`);
  }

  async cmdLimites(chatId: number): Promise<void> {
    const u = await this.quota.usage(chatId);
    return this.say(
      chatId,
      `Tu uso hoy (día UTC):\n• IA: ${u.aiDay}/${LIMITS.aiPerDayPerChat} por día, ${u.aiMin}/${LIMITS.aiPerMinutePerChat} este minuto\n• Archivos: ${u.files}/${LIMITS.filesPerDayPerChat}\n• IA global de la demo: ${u.aiGlobal}/${LIMITS.aiPerDayGlobal}\nSi la IA se agota, respondo con plantillas marcadas ${SIN_IA}.`,
    );
  }

  async cmdBorrar(chatId: number): Promise<void> {
    await this.d.store.deleteChat(chatId);
    return this.say(chatId, 'Listo: borré tu inventario, propuestas e historial de esta demo.');
  }

  // ---------------- botones ----------------
  async onCallback(q: NonNullable<TgUpdate['callback_query']>): Promise<void> {
    const chat = q.message?.chat;
    // Solo el dueño del chat privado puede accionar sus botones.
    if (!chat || chat.type !== 'private' || chat.id !== q.from.id) return this.d.tg.answerCallback(q.id, 'Acción no permitida.');
    const chatId = chat.id;
    if (!this.active) return this.d.tg.answerCallback(q.id, 'La demo concluyó.');
    const data = q.data ?? '';
    let m: RegExpExecArray | null;
    if ((m = /^ap:([0-9a-f]{8}):(\d{1,6})$/.exec(data))) return this.onApprove(q.id, chatId, m[1], Number(m[2]));
    if ((m = /^a([jc]):([0-9a-f]{8})$/.exec(data))) return this.onAdjustDecision(q.id, chatId, m[1] === 'j', m[2]);
    return this.d.tg.answerCallback(q.id, 'Botón no válido.');
  }

  async onApprove(cbId: string, chatId: number, sid: string, version: number): Promise<void> {
    const s = await this.d.store.getSession(chatId);
    if (!s || s.sessionId !== sid) return this.d.tg.answerCallback(cbId, 'Esa propuesta ya no existe.');
    if (s.version !== version) return this.d.tg.answerCallback(cbId, `Esa es una versión vieja (v${version}). La vigente es v${s.version}.`);
    const p = buildProposal(s.validation, this.rule, s.adjustments);
    if (!p.lines.length || p.blocked) return this.d.tg.answerCallback(cbId, 'Esta propuesta no se puede aprobar.');
    const first = await this.d.store.approve(chatId, sid, version);
    if (!first) return this.d.tg.answerCallback(cbId, `La v${version} ya estaba aprobada. Usa /borrador.`);
    await this.d.store.addHistory(chatId, sid, version, 'aprobada', `propuesta v${version} aprobada por la persona del chat; total ${fmtMoney(p.total)}`);
    await this.d.tg.answerCallback(cbId, `Propuesta v${version} aprobada.`);
    await this.say(chatId, `Aprobaste la propuesta v${version}. Te envío el borrador. Recuerda: yo no envío nada a proveedores; tú decides si lo mandas.`);
    return this.sendDraft({ ...s, approvedVersion: version });
  }

  async onAdjustDecision(cbId: string, chatId: number, confirm: boolean, nonce: string): Promise<void> {
    const s = await this.d.store.getSession(chatId);
    const pa = s?.pendingAdjust;
    if (!s || !pa || pa.id !== nonce || pa.baseVersion !== s.version) return this.d.tg.answerCallback(cbId, 'Ese ajuste ya no está vigente.');
    if (!confirm) {
      await this.d.store.setPendingAdjust(chatId, s.sessionId, s.version, null);
      await this.d.store.addHistory(chatId, s.sessionId, s.version, 'ajuste cancelado', `${pa.appliedPct} % ${pa.req.scope}${pa.target ? ' ' + pa.target : ''}`);
      return this.d.tg.answerCallback(cbId, 'Ajuste cancelado. Nada cambió.');
    }
    const ok = await this.d.store.applyPendingAdjust(chatId, s.sessionId, s.version, nonce, pa.next);
    if (!ok) return this.d.tg.answerCallback(cbId, 'Ese ajuste ya se aplicó o dejó de estar vigente.');
    const v2 = s.version + 1;
    const before = buildProposal(s.validation, this.rule, s.adjustments).total;
    const after = buildProposal(s.validation, this.rule, pa.next).total;
    await this.d.store.addHistory(chatId, s.sessionId, v2, 'ajuste temporada', `${pa.appliedPct > 0 ? '+' : ''}${pa.appliedPct} % ${pa.req.scope}${pa.target ? ' ' + pa.target : ''}; total ${fmtMoney(before)} → ${fmtMoney(after)}; confirmado por la persona`);
    await this.d.tg.answerCallback(cbId, `Ajuste aplicado. Nueva propuesta v${v2}.`);
    return this.sendProposal(chatId, s.sessionId, v2, s.source, s.validation, pa.next);
  }
}
