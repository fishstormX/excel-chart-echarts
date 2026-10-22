/** Apply the JSON-only "x-numFmt" hooks of a converted option as ECharts formatter functions. */
export function fmtNumber(v: any, code: string): string {
  if (typeof v !== "number" || !isFinite(v)) return v == null ? "" : String(v);
  if (!code || code === "General" || code === "@") return String(+v.toPrecision(12));
  const sec = code.split(";"); let c = v < 0 && sec.length > 1 ? sec[1] : sec[0]; const neg = v < 0 && sec.length > 1;
  if (v === 0 && sec.length > 2) c = sec[2];
  c = c.replace(/\[[^\]]*\]|_.|\*.|\\|"/g, "");
  const pct = c.includes("%"); let x = pct ? v * 100 : v; if (neg) x = Math.abs(x);
  const m = /[0#]+(?:[.,][0#]+)*/.exec(c); if (!m) return c;
  const pat = m[0], dec = pat.includes(".") ? pat.split(".")[1].length : 0;
  if (/^E\+?0+/i.test(c.slice(m.index + pat.length))) return x.toExponential(dec).toUpperCase().replace(/E([+-]?)(\d+)$/, (_m, sg, d) => "E" + (sg === "-" ? "-" : "+") + (d.length < 2 ? "0" + d : d));
  let body = x.toFixed(dec);
  if (pat.split(".")[0].includes(",")) { const p = body.split("."); p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ","); body = p.join("."); }
  return c.slice(0, m.index) + body + c.slice(m.index + pat.length);
}
const pad = (n: number) => (n < 10 ? "0" : "") + n;
export function fmtDate(t: any, code: string): string {
  const d = new Date(t); if (isNaN(+d)) return String(t);
  const c = (code || "yyyy-mm-dd").split(";")[0].replace(/\[[^\]]*\]/g, ""); let out = "", i = 0, prevH = false;
  while (i < c.length) {
    const ch = c[i];
    if (ch === '"') { let j = c.indexOf('"', i + 1); if (j < 0) j = c.length; out += c.slice(i + 1, j); i = j + 1; continue; }
    if (ch === "\\") { out += c[i + 1] || ""; i += 2; continue; }
    const m = /^(y+|m+|d+|h+|s+|AM\/PM)/i.exec(c.slice(i));
    if (m) {
      const tk = m[0], l = tk.toLowerCase(); i += tk.length;
      if (l[0] === "y") out += tk.length > 2 ? d.getFullYear() : pad(d.getFullYear() % 100);
      else if (l[0] === "d") out += tk.length === 1 ? d.getDate() : pad(d.getDate());
      else if (l[0] === "h") { prevH = true; out += tk.length === 1 ? d.getHours() : pad(d.getHours()); }
      else if (l[0] === "s") out += pad(d.getSeconds());
      else if (l[0] === "m") {
        if (prevH && tk.length <= 2) out += tk.length === 1 ? d.getMinutes() : pad(d.getMinutes());
        else out += tk.length === 1 ? d.getMonth() + 1 : tk.length === 2 ? pad(d.getMonth() + 1) : d.toLocaleString("en", { month: tk.length === 3 ? "short" : "long" });
        prevH = false;
      } else out += d.getHours() < 12 ? "AM" : "PM";
      continue;
    }
    if (ch !== "_" && ch !== "*") out += ch; else i++;
    i++;
  }
  return out;
}
function getPath(o: any, path: string) {
  let cur = o;
  for (const k of path.split(".")) {
    if (cur == null) return null;
    if (/^\d+$/.test(k) && !Array.isArray(cur)) { if (+k !== 0) return null; continue; }
    if (cur[k] == null) cur[k] = {};
    cur = cur[k];
  }
  return cur;
}
function seriesFmt(tpl: string, code: string) {
  return (p: any) => {
    const v = Array.isArray(p.value) ? p.value[1] : p.value;
    return tpl.replace(/\{a\}/g, p.seriesName || "").replace(/\{b\}/g, p.name || "")
      .replace(/\{c\}|\{@\[1\]\}/g, fmtNumber(v, code)).replace(/\{d\}/g, p.percent != null ? String(p.percent) : "");
  };
}
type Pt = number[];
const seg = (x1: number, y1: number, x2: number, y2: number, style: any) => ({ type: "line", shape: { x1, y1, x2, y2 }, style });
/** Offset (px) of bar `slot` inside its category band — same arithmetic as ECharts' barLayout. */
function barOffset(band: number, b: any) {
  const w = Math.max((band - band * b.catGap) / (b.slots + (b.slots - 1) * b.gap), 0);
  const sum = w * b.slots + (b.slots - 1) * b.gap * w;
  return -sum / 2 + b.slot * w * (1 + b.gap) + w / 2;
}
/** Offset (px) of boxplot series `slot` of `slots` — same arithmetic as ECharts' boxplotLayout. */
function boxOffset(band: number, slot: number, slots: number) {
  const h = 0.8 * band - 2, c = (h / slots) * 0.3, p = (h - c * (slots - 1)) / slots;
  return p / 2 - h / 2 + slot * (c + p);
}
/** renderItem factories for the JSON-only "x-renderItem" custom series emitted by the converter. */
export const renderers: Record<string, (cfg: any) => (params: any, api: any) => any> = {
  /** item [x, y, lo, hi]: error bar from lo to hi along y (dir v) or x (dir h), aligned with clustered/stacked bars */
  errorBar: (cfg) => (_p, api) => {
    const x = api.value(0), y = api.value(1), lo = api.value(2), hi = api.value(3);
    if ([x, y, lo, hi].some((v) => v == null || (typeof v === "number" && isNaN(v)))) return null;
    const v = cfg.dir !== "h";
    const p0: Pt = api.coord(v ? [x, lo] : [lo, y]), p1: Pt = api.coord(v ? [x, hi] : [hi, y]);
    if (cfg.bar) {
      const off = barOffset(v ? api.size([1, 0])[0] : api.size([0, 1])[1], cfg.bar);
      const k = v ? 0 : 1; p0[k] += off; p1[k] += off;
    }
    const st = { stroke: cfg.color || "#595959", lineWidth: cfg.width || 1, fill: null }, c = 4;
    const ch: any[] = [seg(p0[0], p0[1], p1[0], p1[1], st)];
    if (cfg.cap !== false) for (const p of [p0, p1]) ch.push(v ? seg(p[0] - c, p[1], p[0] + c, p[1], st) : seg(p[0], p[1] - c, p[0], p[1] + c, st));
    return { type: "group", children: ch };
  },
  /** item [categoryIndex, y, kind]: kind 0 = mean marker (×), 1 = outlier, 2 = inner point */
  boxPoints: (cfg) => (_p, api) => {
    const ci = api.value(0), y = api.value(1), k = api.value(2);
    const p: Pt = api.coord([ci, y]); p[0] += boxOffset(api.size([1, 0])[0], cfg.slot, cfg.slots);
    if (k === 0) { const st = { stroke: "#262626", lineWidth: 1.5 }, r = 4; return { type: "group", children: [seg(p[0] - r, p[1] - r, p[0] + r, p[1] + r, st), seg(p[0] - r, p[1] + r, p[0] + r, p[1] - r, st)] }; }
    return { type: "circle", shape: { cx: p[0], cy: p[1], r: k === 1 ? 3 : 2.5 }, style: k === 1 ? { fill: cfg.color, stroke: "#FFFFFF", lineWidth: 0.5 } : { fill: "#FFFFFF", stroke: cfg.color, lineWidth: 1 } };
  },
  /** item [ci1, mean1, ci2, mean2]: mean line segment between neighbouring categories */
  boxMeanLine: (cfg) => (_p, api) => {
    const band = api.size([1, 0])[0], off = boxOffset(band, cfg.slot, cfg.slots);
    const a: Pt = api.coord([api.value(0), api.value(1)]), b: Pt = api.coord([api.value(2), api.value(3)]);
    return seg(a[0] + off, a[1], b[0] + off, b[1], { stroke: cfg.color, lineWidth: 1.5 });
  },
};
/** Excel date serial (1900 or 1904 system) -> local ISO string without zone (parsed as local time). */
export function serialToLocal(v: any, sys: number): any {
  if (typeof v !== "number" || !isFinite(v)) return v;
  const ms = Math.round((v - (sys === 1904 ? 24107 : 25569)) * 86400000);
  return new Date(ms).toISOString().slice(0, 19);
}
/** Returns a copy of the option with formatter / renderItem functions; safe to pass to chart.setOption(). */
export function prepare(option: any): any {
  const o = JSON.parse(JSON.stringify(option));
  for (const s of Array.isArray(o.series) ? o.series : []) {
    const r = s["x-renderItem"]; if (!r) continue;
    if (renderers[r]) s.renderItem = renderers[r](s["x-cfg"] || {});
    delete s["x-renderItem"]; delete s["x-cfg"];
  }
  for (const h of o["x-numFmt"] || []) {
    const tgt = getPath(o, h.path); if (!tgt) continue; const code = h.formatCode;
    const dt = (v: any) => fmtDate(h.serial ? serialToLocal(v, h.serial) : v, code);
    if (h.tooltip && h.date) { tgt.valueFormatter = (v: any) => Array.isArray(v) ? [dt(v[0]), ...v.slice(1).map((x: any) => fmtNumber(x, "General"))].join(", ") : dt(v); continue; }
    if (h.tooltip) { tgt.valueFormatter = (v: any) => fmtNumber(Array.isArray(v) ? v[v.length - 1] : v, code); continue; }
    tgt.formatter = h.date ? dt
      : h.path.startsWith("series") ? seriesFmt(typeof tgt.formatter === "string" ? tgt.formatter : "{c}", code)
      : (v: any) => fmtNumber(v, code);
  }
  delete o["x-numFmt"];
  return o;
}

/** Register the GeoJSON a regionMap option needs (option["x-geo"]) with echarts before setOption().
 *  opts.maps: {world|china|custom: FeatureCollection} used directly; otherwise fetched from `${baseUrl}${source}.json`. */
export async function registerMaps(echarts: any, option: any, opts: { baseUrl?: string; maps?: Record<string, any>; geojson?: any } = {}): Promise<void> {
  const g = option && option["x-geo"]; if (!g) return;
  if (echarts.getMap && echarts.getMap(g.map) && g.source !== "custom") return;
  let fc = g.source === "custom" && opts.geojson ? opts.geojson : opts.maps && opts.maps[g.source];
  if (typeof fc === "string") fc = JSON.parse(fc);
  if (!fc) { const r = await fetch((opts.baseUrl ?? "geo/") + g.source + ".json"); fc = await r.json(); }
  echarts.registerMap(g.map, fc);
}
