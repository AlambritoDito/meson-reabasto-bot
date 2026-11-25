// Validación de archivos subidos: extensión, tamaño, contenido real y defensa contra ZIP expansivo antes de parsear.
import * as XLSX from 'xlsx';
import { LIMITS, DEFAULT_RULE } from './config';
import { parseCsv, type Table } from './csv';

export type FileResult = { ok: true; table: Table; kind: 'csv' | 'xlsx' } | { ok: false; error: string };

export function extensionOf(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name.trim());
  return m ? m[1].toLowerCase() : '';
}

/** Pre-chequeo con metadatos de Telegram (antes de descargar). */
export function precheck(fileName: string | undefined, fileSize: number | undefined): string | null {
  const ext = extensionOf(fileName ?? '');
  if (ext !== 'csv' && ext !== 'xlsx') return 'Solo acepto archivos .csv o .xlsx.';
  if (fileSize === undefined || fileSize > LIMITS.maxFileBytes) return 'El archivo supera 200 KB.';
  if (fileSize === 0) return 'El archivo está vacío.';
  return null;
}

const isZip = (b: Uint8Array) => b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;

/** Lee el directorio central ZIP y rechaza expansión excesiva, ZIP64 o estructura inválida. */
export function inspectZip(b: Uint8Array): { ok: true; names: string[] } | { ok: false; error: string } {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65535); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return { ok: false, error: 'El XLSX está dañado (sin directorio ZIP).' };
  const entries = dv.getUint16(eocd + 10, true);
  const cdOffset = dv.getUint32(eocd + 16, true);
  if (entries > LIMITS.maxZipEntries) return { ok: false, error: 'El XLSX tiene demasiadas partes internas.' };
  let p = cdOffset;
  let total = 0;
  const names: string[] = [];
  for (let k = 0; k < entries; k++) {
    if (p + 46 > b.length || dv.getUint32(p, true) !== 0x02014b50) return { ok: false, error: 'El XLSX está dañado.' };
    const usize = dv.getUint32(p + 24, true);
    const csize = dv.getUint32(p + 20, true);
    if (usize === 0xffffffff || csize === 0xffffffff) return { ok: false, error: 'El XLSX usa un formato no admitido (ZIP64).' };
    const n = dv.getUint16(p + 28, true);
    const e = dv.getUint16(p + 30, true);
    const c = dv.getUint16(p + 32, true);
    names.push(new TextDecoder().decode(b.subarray(p + 46, p + 46 + n)));
    total += usize;
    if (total > LIMITS.maxZipUncompressedBytes) return { ok: false, error: 'El XLSX se expande demasiado al abrirlo; usa CSV.' };
    p += 46 + n + e + c;
  }
  return { ok: true, names };
}

function decodeUtf8Strict(b: Uint8Array): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(b);
  } catch {
    return null;
  }
}

export function parseUpload(fileName: string, bytes: Uint8Array, maxRows: number = DEFAULT_RULE.maxFilas): FileResult {
  if (bytes.length === 0) return { ok: false, error: 'El archivo está vacío.' };
  if (bytes.length > LIMITS.maxFileBytes) return { ok: false, error: 'El archivo supera 200 KB.' };
  const ext = extensionOf(fileName);
  if (ext === 'csv') {
    if (isZip(bytes)) return { ok: false, error: 'El archivo dice ser CSV pero su contenido no es texto. ¿Es un XLSX renombrado?' };
    const text = decodeUtf8Strict(bytes);
    if (text === null || text.includes('\u0000')) return { ok: false, error: 'El CSV no es texto UTF-8 válido. Expórtalo como «CSV UTF-8».' };
    return { ok: true, table: parseCsv(text), kind: 'csv' };
  }
  if (ext === 'xlsx') {
    if (!isZip(bytes)) return { ok: false, error: 'El archivo dice ser XLSX pero su contenido no lo es.' };
    const z = inspectZip(bytes);
    if (!z.ok) return z;
    if (!z.names.includes('xl/workbook.xml')) return { ok: false, error: 'El archivo no es un libro XLSX válido.' };
    try {
      // sheetRows limita lo que SheetJS materializa; !fullref conserva el rango declarado original.
      const wb = XLSX.read(bytes, { type: 'array', cellFormula: false, cellHTML: false, cellText: false, sheets: 0, dense: true, sheetRows: maxRows + 2 });
      const first = wb.SheetNames[0];
      const ws = first ? wb.Sheets[first] : undefined;
      if (!ws) return { ok: false, error: 'El XLSX no tiene hojas.' };
      const ref = (ws['!fullref'] as string | undefined) ?? (ws['!ref'] as string | undefined);
      if (ref) {
        const r = XLSX.utils.decode_range(ref);
        if (r.e.c - r.s.c + 1 > LIMITS.maxSheetCols) return { ok: false, error: `La hoja usa más de ${LIMITS.maxSheetCols} columnas. Deja solo las columnas del inventario o usa CSV.` };
        if (r.e.r + 1 > maxRows + 1) return { ok: false, error: `El archivo tiene más de ${maxRows} filas (o celdas lejanas con contenido). Limpia la hoja o usa CSV.` };
      }
      const raw = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: '', blankrows: true });
      // Solo valores cacheados (no fórmulas). Números se pasan como texto con punto decimal.
      const rows = raw.map((r) => (Array.isArray(r) ? r.map((v) => (v === null || v === undefined ? '' : typeof v === 'number' ? String(v) : String(v))) : []));
      while (rows.length && rows[rows.length - 1].every((f) => f.trim() === '')) rows.pop();
      return { ok: true, table: { rows, delimiter: ',' }, kind: 'xlsx' };
    } catch {
      return { ok: false, error: 'No pude leer el XLSX. Intenta exportarlo como CSV.' };
    }
  }
  return { ok: false, error: 'Solo acepto archivos .csv o .xlsx.' };
}
