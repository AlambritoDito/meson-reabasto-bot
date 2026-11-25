// Utilidades de texto seguras para salida.
/** Neutraliza contenido que una hoja de cálculo interpretaría como fórmula y quita caracteres de control. */
export function safeCell(s: string): string {
  const clean = s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/[\r\n\t]+/g, ' ');
  return /^[=+\-@]/.test(clean) ? `'${clean}` : clean;
}

export function short(s: string, n = 60): string {
  const t = safeCell(s);
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

export function fmtNum(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

export function fmtMoney(n: number): string {
  return `$${n.toFixed(2)}`;
}
