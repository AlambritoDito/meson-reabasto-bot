// Cliente mínimo de la Bot API de Telegram. Los errores NUNCA incluyen la URL (contiene el token).
import type { FetchFn } from './types';

export interface InlineButton {
  text: string;
  callback_data: string;
}
export type Keyboard = InlineButton[][];

export interface TelegramClient {
  /** `html` usa parse_mode HTML: todo dato externo debe venir escapado (ui.esc). */
  sendMessage(chatId: number, html: string, keyboard?: Keyboard): Promise<void>;
  editMessageText(chatId: number, messageId: number, html: string, keyboard?: Keyboard): Promise<void>;
  answerCallback(callbackId: string, text?: string): Promise<void>;
  sendDocument(chatId: number, fileName: string, content: string, caption: string): Promise<void>;
  downloadFile(fileId: string): Promise<Uint8Array>;
}

export class TelegramApiError extends Error {
  constructor(method: string, status: number, public description = '') {
    super(`Telegram ${method} falló (HTTP ${status})`);
  }
}

/** Recorta por líneas completas (cada etiqueta HTML abre y cierra en su línea), bajo el límite de 4096 de Telegram. */
export function fitHtml(html: string, max = 4000): string {
  if (html.length <= max) return html;
  const suffix = '\n… (mensaje recortado; el detalle completo va en el borrador)';
  const room = max - suffix.length;
  const cut = html.lastIndexOf('\n', room);
  return `${html.slice(0, cut > 0 ? cut : room)}${suffix}`;
}

/** Solo la API oficial o un servidor falso en loopback (pruebas E2E locales). Evita mandar el token a otro host. */
export function safeApiBase(base: string | undefined): string {
  if (!base) return 'https://api.telegram.org';
  if (base === 'https://api.telegram.org' || /^http:\/\/127\.0\.0\.1:\d{2,5}$/.test(base)) return base;
  throw new Error('TELEGRAM_API_BASE no permitido');
}

export class HttpTelegram implements TelegramClient {
  private base: string;
  constructor(private fetchFn: FetchFn, private token: string, apiBase?: string) {
    this.base = safeApiBase(apiBase);
  }

  private async call(method: string, body: BodyInit, headers?: Record<string, string>): Promise<unknown> {
    let res: Response;
    try {
      res = await this.fetchFn(`${this.base}/bot${this.token}/${method}`, { method: 'POST', body, headers });
    } catch {
      throw new TelegramApiError(method, 0);
    }
    let j: { ok?: boolean; result?: unknown; description?: string } = {};
    try {
      j = (await res.json()) as typeof j;
    } catch {
      /* sin cuerpo JSON */
    }
    if (!res.ok || !j.ok) throw new TelegramApiError(method, res.status, String(j.description ?? '').slice(0, 200));
    return j.result;
  }

  async sendMessage(chatId: number, html: string, keyboard?: Keyboard): Promise<void> {
    const body: Record<string, unknown> = { chat_id: chatId, text: fitHtml(html), parse_mode: 'HTML', link_preview_options: { is_disabled: true } };
    if (keyboard) body.reply_markup = { inline_keyboard: keyboard };
    await this.call('sendMessage', JSON.stringify(body), { 'content-type': 'application/json' });
  }

  async editMessageText(chatId: number, messageId: number, html: string, keyboard?: Keyboard): Promise<void> {
    const body: Record<string, unknown> = { chat_id: chatId, message_id: messageId, text: fitHtml(html), parse_mode: 'HTML', link_preview_options: { is_disabled: true } };
    if (keyboard) body.reply_markup = { inline_keyboard: keyboard };
    try {
      await this.call('editMessageText', JSON.stringify(body), { 'content-type': 'application/json' });
    } catch (e) {
      // Pulsar dos veces el mismo botón deja el texto igual: Telegram responde 400 «message is not modified».
      if (e instanceof TelegramApiError && /message is not modified/i.test(e.description)) return;
      throw e;
    }
  }

  async answerCallback(callbackId: string, text?: string): Promise<void> {
    await this.call('answerCallbackQuery', JSON.stringify({ callback_query_id: callbackId, text }), { 'content-type': 'application/json' });
  }

  async sendDocument(chatId: number, fileName: string, content: string, caption: string): Promise<void> {
    const form = new FormData();
    form.append('chat_id', String(chatId));
    form.append('caption', caption.slice(0, 1000));
    form.append('document', new Blob([content], { type: 'text/plain;charset=utf-8' }), fileName);
    await this.call('sendDocument', form);
  }

  async downloadFile(fileId: string): Promise<Uint8Array> {
    const info = (await this.call('getFile', JSON.stringify({ file_id: fileId }), { 'content-type': 'application/json' })) as { file_path?: string };
    if (!info.file_path) throw new TelegramApiError('getFile', 200);
    let res: Response;
    try {
      res = await this.fetchFn(`${this.base}/file/bot${this.token}/${info.file_path}`);
    } catch {
      throw new TelegramApiError('download', 0);
    }
    if (!res.ok) throw new TelegramApiError('download', res.status);
    return new Uint8Array(await res.arrayBuffer());
  }
}
