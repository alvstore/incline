/**
 * One CSV cell, safe for spreadsheets: neutralises formula-leading characters
 * (=, +, -, @, tab, CR) in text so Excel/Sheets never execute user-entered
 * values, then quotes when needed. Plain numbers (incl. negatives) are kept.
 */
export function csvCell(value: unknown, alwaysQuote = false): string {
  let s = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return alwaysQuote || /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
