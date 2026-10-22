/** Numeric helpers (port of xlsx2echarts/stats.py — same operation order for identical floats). */
export function sig(x: number): number | null { return isFinite(x) ? Number(x.toPrecision(10)) : null; }
export function fsum(xs: number[]): number { let s = 0; for (const x of xs) s += x; return s; }
export function mean(xs: number[]): number { return fsum(xs) / xs.length; }
export function stdev(xs: number[]): number {
  const n = xs.length; if (n < 2) return 0;
  const m = mean(xs); let s = 0; for (const x of xs) s += (x - m) * (x - m);
  return Math.sqrt(s / (n - 1));
}
export function quantile(xs: number[], p: number, method: string): number {
  const n = xs.length; if (n === 1) return xs[0];
  const pos = method === "inclusive" ? p * (n - 1) : p * (n + 1) - 1;
  if (pos <= 0) return xs[0];
  if (pos >= n - 1) return xs[n - 1];
  const i = Math.floor(pos), f = pos - i;
  return xs[i] + (xs[i + 1] - xs[i]) * f;
}
export function median(xs: number[]): number { const n = xs.length; return n % 2 ? xs[(n - 1) / 2] : (xs[n / 2 - 1] + xs[n / 2]) / 2; }
export function linreg(xs: number[], ys: number[]): [number, number] | null {
  const n = xs.length; if (n < 2) return null;
  const sx = fsum(xs), sy = fsum(ys); let sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) { sxx += xs[i] * xs[i]; sxy += xs[i] * ys[i]; }
  const den = n * sxx - sx * sx; if (!den) return null;
  const k = (n * sxy - sx * sy) / den;
  return [k, (sy - k * sx) / n];
}
export function polyfit(xs: number[], ys: number[], order: number): number[] | null {
  const m = order + 1; if (xs.length < m) return null;
  const a: number[][] = Array.from({ length: m }, () => new Array(m + 1).fill(0));
  for (let r = 0; r < m; r++) {
    for (let c = 0; c < m; c++) { let s = 0; for (const x of xs) s += x ** (r + c); a[r][c] = s; }
    let s = 0; for (let i = 0; i < xs.length; i++) s += ys[i] * xs[i] ** r; a[r][m] = s;
  }
  for (let col = 0; col < m; col++) {
    let piv = col;
    for (let r = col + 1; r < m; r++) if (Math.abs(a[r][col]) > Math.abs(a[piv][col])) piv = r;
    if (a[piv][col] === 0) return null;
    [a[col], a[piv]] = [a[piv], a[col]];
    for (let r = 0; r < m; r++) if (r !== col) { const f = a[r][col] / a[col][col]; for (let c = col; c <= m; c++) a[r][c] -= f * a[col][c]; }
  }
  return a.map((row, i) => row[m] / row[i]);
}
export function polyval(coef: number[], x: number): number { let y = 0; for (let i = coef.length - 1; i >= 0; i--) y = y * x + coef[i]; return y; }
