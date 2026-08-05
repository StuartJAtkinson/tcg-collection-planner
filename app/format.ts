// Compact count: <10000 stays as integer; >=10000 becomes "X.Yk" with one decimal.
// Examples: 9999 → "9999", 13587 → "13.6k", 1118 → "1118", 999999 → "1000.0k".
export function fmtN(n: number): string {
  if (n < 10000) return String(n);
  return `${(n / 1000).toFixed(1)}k`;
}
