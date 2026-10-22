import { El } from "./xml.js";
export const A = "{http://schemas.openxmlformats.org/drawingml/2006/main}";
const PRST: Record<string, string> = { black: "000000", white: "FFFFFF", red: "FF0000", green: "008000", blue: "0000FF", yellow: "FFFF00", gray: "808080", orange: "FFA500", purple: "800080" };
const ALIAS: Record<string, string> = { tx1: "dk1", bg1: "lt1", tx2: "dk2", bg2: "lt2", phClr: "accent1" };
const clamp = (x: number) => Math.max(0, Math.min(1, x));
export const local = (t: string) => t.slice(t.indexOf("}") + 1);

// python colorsys
function rgbToHls(r: number, g: number, b: number): [number, number, number] {
  const maxc = Math.max(r, g, b), minc = Math.min(r, g, b), sumc = maxc + minc, rangec = maxc - minc;
  const l = sumc / 2;
  if (minc === maxc) return [0, l, 0];
  const s = l <= 0.5 ? rangec / sumc : rangec / (2 - maxc - minc);
  const rc = (maxc - r) / rangec, gc = (maxc - g) / rangec, bc = (maxc - b) / rangec;
  let h = r === maxc ? bc - gc : g === maxc ? 2 + rc - bc : 4 + gc - rc;
  h = ((h / 6) % 1 + 1) % 1;
  return [h, l, s];
}
function v_(m1: number, m2: number, hue: number) {
  hue = ((hue % 1) + 1) % 1;
  if (hue < 1 / 6) return m1 + (m2 - m1) * hue * 6;
  if (hue < 0.5) return m2;
  if (hue < 2 / 3) return m1 + (m2 - m1) * (2 / 3 - hue) * 6;
  return m1;
}
function hlsToRgb(h: number, l: number, s: number): [number, number, number] {
  if (s === 0) return [l, l, l];
  const m2 = l <= 0.5 ? l * (1 + s) : l + s - l * s, m1 = 2 * l - m2;
  return [v_(m1, m2, h + 1 / 3), v_(m1, m2, h), v_(m1, m2, h - 1 / 3)];
}
export function pyRound(x: number, n = 0): number {
  const k = 10 ** n, m = x * k, r = Math.round(m);
  if (Math.abs(m - Math.trunc(m)) === 0.5) return (2 * Math.round(m / 2)) / k;
  return n ? Number((r / k).toFixed(n)) : r;
}
const hex2 = (n: number) => n.toString(16).toUpperCase().padStart(2, "0");

export function resolveColor(el: El | null | undefined, theme: Record<string, string>): string | null {
  if (!el) return null;
  const tag = local(el.tag);
  let hexv: string | undefined;
  if (tag === "srgbClr") hexv = el.get("val");
  else if (tag === "schemeClr") { const v = el.get("val")!; hexv = theme[ALIAS[v] ?? v]; }
  else if (tag === "sysClr") hexv = el.get("lastClr") || (el.get("val") === "windowText" ? "000000" : "FFFFFF");
  else if (tag === "prstClr") hexv = PRST[el.get("val")!] ?? "000000";
  else if (tag === "scrgbClr") hexv = ["r", "g", "b"].map((k) => hex2(Math.trunc(parseInt(el.get(k, "0")!, 10) / 100000 * 255))).join("");
  else return null;
  if (!hexv) return null;
  let r = parseInt(hexv.slice(0, 2), 16) / 255, g = parseInt(hexv.slice(2, 4), 16) / 255, b = parseInt(hexv.slice(4, 6), 16) / 255;
  let alpha = 1;
  for (const mod of el.children) {
    const mt = local(mod.tag), val = parseInt(mod.get("val", "0")!, 10) / 100000;
    if (mt === "lumMod" || mt === "lumOff") {
      let [h, l, s] = rgbToHls(r, g, b);
      l = mt === "lumMod" ? clamp(l * val) : clamp(l + val);
      [r, g, b] = hlsToRgb(h, l, s);
    } else if (mt === "tint") [r, g, b] = [r, g, b].map((c) => c + (1 - c) * (1 - val)) as any;
    else if (mt === "shade") [r, g, b] = [r, g, b].map((c) => c * val) as any;
    else if (mt === "alpha") alpha = val;
  }
  const rgb = [r, g, b].map((c) => pyRound(clamp(c) * 255));
  if (alpha < 0.999) return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${Number(alpha.toPrecision(3))})`;
  return "#" + rgb.map(hex2).join("");
}
export function fillColor(spPr: El | null, theme: Record<string, string>): string | null {
  if (!spPr) return null;
  const sf = spPr.find(A + "solidFill");
  if (sf && sf.length) return resolveColor(sf.children[0], theme);
  const gf = spPr.find(A + "gradFill");
  if (gf) { const gs = gf.find(`${A}gsLst/${A}gs`); if (gs && gs.length) return resolveColor(gs.children[0], theme); }
  return null;
}
export const noFill = (spPr: El | null) => !!spPr && !!spPr.find(A + "noFill");
export function lineProps(spPr: El | null, theme: Record<string, string>): [string | null, number | null, boolean, string | null] {
  if (!spPr) return [null, null, false, null];
  const ln = spPr.find(A + "ln");
  if (!ln) return [null, null, false, null];
  if (ln.find(A + "noFill")) return [null, null, true, null];
  let col: string | null = null;
  const sf = ln.find(A + "solidFill");
  if (sf && sf.length) col = resolveColor(sf.children[0], theme);
  const w = ln.get("w") ? parseInt(ln.get("w")!, 10) / 12700 * 4 / 3 : null;
  let dash: string | null = null;
  const pd = ln.find(A + "prstDash");
  const pv = pd?.get("val");
  if (pd && pv !== undefined && pv !== "solid") dash = pv.toLowerCase().includes("dot") && !pv.toLowerCase().includes("dash") ? "dotted" : "dashed";
  return [col, w, false, dash];
}
