/** Office 2016+ chartEx parts (port of xlsx2echarts/chartex.py — keep both in sync; see tests/parity). */
import { El } from "./xml.js";
import { fillColor, lineProps, noFill, pyRound, resolveColor } from "./colors.js";
import { match as geoMatch } from "./geo.js";
import { FormulaError, Val, splitRef } from "./formula.js";
import { fsum, mean, median, quantile, sig, stdev } from "./stats.js";
import { Workbook, fixedHalfUp, formatNumber, jnum, jstr } from "./workbook.js";

export const CXNS = "http://schemas.microsoft.com/office/drawing/2014/chartex";
const CX = `{${CXNS}}`, A = "{http://schemas.openxmlformats.org/drawingml/2006/main}";
const FONT = "Calibri, 'Microsoft YaHei', 'PingFang SC', sans-serif";
type Obj = Record<string, any>;
type Dim = { type: string | null; num: boolean; levels: any[][]; fmt: string | null };
const isNum = (x: any): x is number => typeof x === "number";

function toF(s: string | null | undefined, d: number | null = null): number | null {
  if (s === null || s === undefined || s.trim() === "") return d;
  const v = Number(s.trim()); return isNaN(v) ? d : v;
}
function boolAttr(el: El | null | undefined, name: string, def: boolean) {
  if (!el || el.get(name) === undefined) return def;
  const v = el.get(name); return v === "1" || v === "true";
}

/** Helper surface of ChartConverter used here (refs, theme colours, fonts, warnings, number-format hooks). */
export interface CxHelper {
  wb: Workbook; root: El; theme: Record<string, string>; warnings: string[]; formats: Obj[]; usedFormulaFallback: boolean;
  refFormat(f: string): string | null; resolveRef(f: string, multi?: boolean): [Val[], string | null];
  autoColor(i: number): string; font(txPr: El | null, defPt: number, bold?: boolean): Obj; fmtHook(path: string, code: string, date?: boolean): void;
}

export class ChartEx {
  wb: Workbook; root: El; theme: Record<string, string>; warnings: string[];
  data = new Map<string | undefined, Dim[]>(); axes = new Map<string | undefined, El>(); option: Obj = {}; legendData: string[] | null = null;
  constructor(public h: CxHelper) { this.wb = h.wb; this.root = h.root; this.theme = h.theme; this.warnings = h.warnings; }

  refLevels(f: string, num: boolean, byRow: boolean): [any[][], string | null] {
    f = f.trim();
    if (this.wb.definedNames.has(f)) f = this.wb.definedNames.get(f)!;
    let sp;
    try { sp = splitRef(f); } catch (e) { if (!(e instanceof FormulaError)) throw e; this.warnings.push(`cannot resolve reference ${pyrepr(f)}`); return [[], null]; }
    const [sheet, r1, c1, r2, c2] = sp;
    if (sheet === null || (r2 - r1 + 1) * (c2 - c1 + 1) > 100000) { this.warnings.push(`cannot resolve reference ${pyrepr(f)}`); return [[], null]; }
    this.h.usedFormulaFallback = true;
    const grid: Val[][] = [];
    for (let r = r1; r <= r2; r++) { const row: Val[] = []; for (let c = c1; c <= c2; c++) row.push(this.wb.value(sheet, r, c)); grid.push(row); }
    let lines: Val[][];
    if (r1 === r2) lines = [grid[0]];
    else if (c1 === c2) lines = [grid.map((row) => row[0])];
    else if (byRow) lines = grid;
    else lines = Array.from({ length: c2 - c1 + 1 }, (_, j) => grid.map((row) => row[j]));
    const out = lines.slice().reverse().map((ln) => num ? ln.map((v) => (isNum(v) ? v : null)) : ln.map((v) => (v === null || jstr(v) === "" ? null : jstr(v))));
    return [out, num ? this.h.refFormat(f) : null];
  }
  dim(d: El): Dim {
    const num = d.tag === CX + "numDim";
    let levels: any[][] = [], fmt: string | null = null;
    for (const lvl of d.findall(CX + "lvl")) {
      const pts = lvl.findall(CX + "pt");
      let n = parseInt(lvl.get("ptCount") || "0", 10) || 0;
      if (!n && pts.length) n = Math.max(...pts.map((p) => parseInt(p.get("idx")!, 10))) + 1;
      const arr: any[] = new Array(n).fill(null);
      for (const p of pts) { const i = parseInt(p.get("idx")!, 10); if (i < n) arr[i] = num ? toF(p.text) : (p.text ?? null); }
      if (fmt === null && lvl.get("formatCode")) fmt = lvl.get("formatCode")!;
      levels.push(arr);
    }
    const fe = d.find(CX + "f");
    const ftxt = fe ? (fe.text || "").trim() : "";
    if (!levels.some((lv) => lv.some((v) => v !== null)) && fe && ftxt) {
      const [lv, rf] = this.refLevels(fe.text!, num, fe.get("dir") === "row"); levels = lv; fmt = fmt || rf;
    } else if (num && (fmt === null || fmt === "General") && fe && ftxt) fmt = this.h.refFormat(ftxt) || fmt;
    return { type: d.get("type") ?? null, num, levels, fmt };
  }
  text(tx: El | null): string | null {
    if (!tx) return null;
    const td = tx.find(CX + "txData");
    if (td) {
      const v = td.findtext(CX + "v"); if (v !== null) return v;
      const f = td.findtext(CX + "f");
      if (f) { const [vals] = this.h.resolveRef(f); return vals.filter((x) => x !== null).map(jstr).join(" "); }
    }
    const rich = tx.find(CX + "rich");
    if (rich) return rich.findall(A + "p").map((p) => [...p.iter(A + "t")].map((t) => t.text || "").join("")).join("\n");
    return null;
  }
  font(el: El | null | undefined, pt: number, bold = false) { return this.h.font(el ? el.find(CX + "txPr") : null, pt, bold); }

  convert(): { types: string[]; option: Obj | null; warnings: string[] } {
    const root = this.root;
    const cd = root.find(CX + "chartData");
    for (const d of cd ? cd.findall(CX + "data") : []) this.data.set(d.get("id"), d.children.filter((x) => x.tag === CX + "numDim" || x.tag === CX + "strDim").map((x) => this.dim(x)));
    const ch = root.find(CX + "chart");
    const pa = ch ? ch.find(CX + "plotArea") : null;
    const region = pa ? pa.find(CX + "plotAreaRegion") : null;
    const sers = (region ? region.findall(CX + "series") : []).filter((s) => !boolAttr(s, "hidden", false));
    for (const a of pa ? pa.findall(CX + "axis") : []) this.axes.set(a.get("id"), a);
    const types: string[] = [];
    for (const s of sers) { const l = s.get("layoutId") ?? null; if (!types.includes(l as any)) types.push(l as any); }
    const sp = root.find(CX + "spPr");
    this.option = { backgroundColor: noFill(sp) ? "transparent" : fillColor(sp, this.theme) || "#FFFFFF", textStyle: { fontFamily: FONT }, tooltip: { trigger: "item" }, series: [] };
    const te = ch ? ch.find(CX + "title") : null;
    if (te) {
      let text = this.text(te.find(CX + "tx"));
      if (text === null) text = "Chart Title";
      if (text) this.option.title = { text, left: "center", top: 6, textStyle: this.font(te, 14.0) };
    }
    const kind = types.length ? types[0] : null;
    const map: Record<string, ((s: El[]) => void) | null> = { waterfall: this.waterfall, treemap: this.treemap, sunburst: this.sunburst, clusteredColumn: this.histogram, paretoLine: this.histogram, funnel: this.funnel, boxWhisker: this.box, regionMap: null };
    if (kind === null) { this.warnings.push("chartEx without series"); return { types, option: null, warnings: this.warnings }; }
    let fn = kind in map ? map[kind] : undefined;
    if (fn === null) {
      if (!this.regionMap(sers)) return { types, option: null, warnings: this.warnings };
      fn = () => {};
    }
    if (fn === undefined) { this.warnings.push(`chartEx layout ${pyrepr(kind)} is not supported — rendered as column chart`); fn = this.histogram; }
    fn.call(this, sers);
    this.legend(ch && kind !== "regionMap" ? ch.find(CX + "legend") : null);
    if ("grid" in this.option) {
      const g = this.option.grid;
      if ("title" in this.option) g.top += 26;
      const leg = this.option.legend;
      if (leg.show) {
        const p = leg._pos; delete leg._pos;
        if (p === "t") g.top += 28; else if (p === "b") g.bottom += 28; else if (p === "r") g.right = 130; else if (p === "l") g.left = 130;
      }
    }
    delete this.option.legend._pos;
    if (this.h.formats.length) this.option["x-numFmt"] = this.h.formats;
    return { types, option: this.option, warnings: this.warnings };
  }
  legend(lg: El | null) {
    if (!lg) { this.option.legend = { show: false }; return; }
    const pos = lg.get("pos", "t")!;
    const font = this.font(lg, 9.0);
    const e: Obj = { show: true, _pos: pos, textStyle: { color: font.color, fontSize: font.fontSize }, itemWidth: 10, itemHeight: 10 };
    if (pos === "l" || pos === "r") Object.assign(e, { orient: "vertical", top: "middle", ...(pos === "r" ? { right: 10 } : { left: 10 }) });
    else if (pos === "b") Object.assign(e, { orient: "horizontal", bottom: 8, left: "center" });
    else Object.assign(e, { orient: "horizontal", top: "title" in this.option ? 40 : 8, left: "center" });
    const ld = this.legendData;
    if (ld !== null) {
      if (!ld.length) { this.option.legend = { show: false }; return; }
      e.data = ld;
    }
    this.option.legend = e;
  }
  regionMap(sers: El[]): boolean {
    const s = sers[0];
    const [cat, val] = this.seriesDims(s);
    const vals: any[] = val && val.levels.length ? val.levels[0] : [];
    let names: any[] = cat && cat.levels.length ? [...cat.levels[0]] : [];
    names = names.slice(0, vals.length); while (names.length < vals.length) names.push(null);
    const gj = (this.wb as any).geojson;
    const m = geoMatch(names, gj);
    if (m === null) {
      this.warnings.push("regionMap: none of the region names matched " + (gj !== undefined && gj !== null ? "the supplied GeoJSON or " : "") + "the bundled China-province / world-country maps" + " — supply your own GeoJSON (geojson option / --geojson)");
      return false;
    }
    const [key, src, prop, res] = m;
    const data: Obj[] = [], unmatched: string[] = [];
    const lp = s.find(CX + "layoutPr");
    const rl = lp ? lp.find(CX + "regionLabelLayout") : null;
    const showLab = (rl ? rl.get("val") : "bestFitOnly") !== "none";
    names.forEach((nm, k) => {
      const f = res[k], v = vals[k];
      if (f === null) { if (nm !== null && nm !== undefined) unmatched.push(jstr(nm)); return; }
      const d: Obj = { name: f, value: v }; if (showLab) d.label = { show: true }; data.push(d);
    });
    if (unmatched.length) this.warnings.push(`regionMap: ${unmatched.length} region name(s) not found on the ${src} map: ` + unmatched.slice(0, 10).join(", ") + (unmatched.length > 10 ? " …" : ""));
    const c = this.color(s, 0);
    let colors: string[] | null = null;
    const vc = lp ? lp.find(CX + "valueColors") : null;
    if (vc) {
      const cs: string[] = [];
      for (const t of ["minColor", "midColor", "maxColor"]) { const el = vc.find(CX + t); const col = el && el.length ? resolveColor(el.children[0], this.theme) : null; if (col) cs.push(col); }
      if (cs.length >= 2) colors = cs;
    }
    if (colors === null) {
      const rgb = c.startsWith("#") && c.length === 7 ? [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)) : [68, 114, 196];
      colors = ["#" + rgb.map((x) => (x + Math.floor(((255 - x) * 85 + 50) / 100)).toString(16).toUpperCase().padStart(2, "0")).join(""), c];
    }
    const nums = data.map((d) => d.value).filter((v) => typeof v === "number");
    let mn = nums.length ? Math.min(...nums) : 0, mx = nums.length ? Math.max(...nums) : 1;
    if (mx === mn) mx = mn + 1;
    const e: Obj = { name: this.name(s, 0), type: "map", map: key };
    if (prop && prop !== "name") e.nameProperty = prop;
    const lab = this.labelsVis(s);
    Object.assign(e, { roam: true, showLegendSymbol: false, data, label: { show: false, fontSize: 10, color: "#404040" }, itemStyle: { areaColor: "#F2F2F2", borderColor: "#A6A6A6", borderWidth: 0.5 }, emphasis: { label: { show: true }, itemStyle: { areaColor: "#FFE699" } } });
    this.option.series.push(e);
    this.option.visualMap = { type: "continuous", min: mn, max: mx, calculable: false, left: 10, bottom: 10, inRange: { color: colors }, textStyle: { color: "#595959" } };
    const fmt = (lab && lab.fmt) || (val ? val.fmt : null);
    if (fmt && fmt !== "General") this.h.formats.push({ path: "series.0.tooltip", formatCode: fmt, tooltip: true });
    this.option["x-geo"] = { map: key, source: src };
    return true;
  }
  seriesDims(s: El): [Dim | null, Dim | null] {
    const did = s.find(CX + "dataId"); const dims = this.data.get(did ? did.get("val") : undefined) || [];
    const cat = dims.find((d) => d.type === "cat") ?? null;
    let val = dims.find((d) => d.type === "val" || d.type === "size") ?? null;
    if (!val) val = dims.find((d) => d.num && d.type !== "cat") ?? null;
    return [cat, val];
  }
  name(s: El, i: number) { const t = this.text(s.find(CX + "tx")); return t ? t : `Series${i + 1}`; }
  color(s: El, i: number) { return fillColor(s.find(CX + "spPr"), this.theme) || this.h.autoColor(i); }
  dpts(s: El) { const out = new Map<number, string>(); for (const dp of s.findall(CX + "dataPt")) { const c = fillColor(dp.find(CX + "spPr"), this.theme); if (c) out.set(parseInt(dp.get("idx", "0")!, 10), c); } return out; }
  labelsVis(s: El): Obj | null {
    const dl = s.find(CX + "dataLabels"); if (!dl) return null;
    const vis = dl.find(CX + "visibility");
    const fl: Obj = { value: boolAttr(vis, "value", true), categoryName: boolAttr(vis, "categoryName", false), seriesName: boolAttr(vis, "seriesName", false) };
    if (!(fl.value || fl.categoryName || fl.seriesName)) return null;
    const nf = dl.find(CX + "numFmt");
    fl.fmt = nf && (nf.get("sourceLinked") === "0" || nf.get("sourceLinked") === "false") ? nf.get("formatCode") ?? null : null;
    fl.pos = dl.get("pos") ?? null;
    fl.font = this.font(dl, 9.0);
    return fl;
  }
  static flatCats(cat: Dim | null, n: number): string[] {
    if (!cat || !cat.levels.length) return Array.from({ length: n }, (_, i) => String(i + 1));
    const lv = cat.levels;
    const outer = lv.slice(1).map((x) => x.slice());
    for (const o of outer) { let last: any = null; for (let i = 0; i < o.length; i++) { if (o[i] === null) o[i] = last; last = o[i]; } }
    const out: string[] = [];
    for (let i = 0; i < n; i++) {
      const parts: string[] = outer.slice().reverse().filter((o) => i < o.length && o[i]).map((o) => o[i]);
      const leaf = i < lv[0].length ? lv[0][i] : null;
      parts.push(leaf !== null ? jstr(leaf) : "");
      out.push(outer.length ? parts.filter((p) => p).join(" ") : leaf !== null ? jstr(leaf) : "");
    }
    return out;
  }
  axis(aid: string, kind: string, data: string[] | null = null, fmt: string | null = null, dim = "x"): Obj {
    const ax = this.axes.get(aid) ?? null;
    const hidden = boolAttr(ax, "hidden", false);
    const ticks = !!ax && !!ax.find(CX + "tickLabels");
    const font = this.font(ax, 9.0);
    const e: Obj = { type: kind, show: !hidden, axisLabel: { show: ticks || !ax, color: font.color, fontSize: font.fontSize }, axisTick: { show: false }, axisLine: { show: kind === "category", lineStyle: { color: "#D9D9D9" } } };
    const mg = !!ax && !!ax.find(CX + "majorGridlines");
    e.splitLine = { show: mg, lineStyle: { color: "#D9D9D9" } };
    if (kind === "category") e.data = data || [];
    else {
      const sc = ax ? ax.find(CX + "valScaling") : null;
      for (const k of ["min", "max"]) { const v = sc && sc.get(k) !== undefined && sc.get(k) !== "auto" ? toF(sc.get(k)) : null; if (v !== null) e[k] = v; }
      const nf = ax ? ax.find(CX + "numFmt") : null;
      const code = nf && (nf.get("sourceLinked") === "0" || nf.get("sourceLinked") === "false") ? nf.get("formatCode") ?? null : fmt;
      if (code && code !== "General") this.h.fmtHook(`${dim}Axis.axisLabel`, code);
    }
    const te = ax ? ax.find(CX + "title") : null;
    if (te) { const t = this.text(te.find(CX + "tx")); if (t) Object.assign(e, { name: t, nameLocation: "middle", nameGap: dim === "x" ? 32 : 48, nameTextStyle: this.font(te, 10.0) }); }
    return e;
  }
  gap(def: number) {
    const ax = this.axes.get("0"); const sc = ax ? ax.find(CX + "catScaling") : null;
    let g = sc && sc.get("gapWidth") !== undefined && sc.get("gapWidth") !== "auto" ? toF(sc.get("gapWidth")) : null;
    if (g === null) g = def;
    return `${jnum(pyRound(g / (1 + g) * 100, 2))}%`;
  }
  grid() { this.option.grid = { left: 16, right: 24, top: 24, bottom: 16, containLabel: true }; this.option.tooltip = { trigger: "axis", axisPointer: { type: "shadow" } }; }
  labelText(lab: Obj, cat: string, sname: string, v: number, fmt: string | null) {
    const parts: string[] = [];
    if (lab.seriesName) parts.push(sname); if (lab.categoryName) parts.push(cat); if (lab.value) parts.push(formatNumber(v, fmt));
    return parts.join(", ");
  }

  waterfall(sers: El[]) {
    const s = sers[0];
    const [cat, val] = this.seriesDims(s);
    const vals: (number | null)[] = val && val.levels.length ? val.levels[0] : [];
    const n = vals.length, cats = ChartEx.flatCats(cat, n);
    const lp = s.find(CX + "layoutPr");
    const subs = new Set<number>();
    const st = lp ? lp.find(CX + "subtotals") : null;
    for (const ix of st ? st.findall(CX + "idx") : []) subs.add(parseInt(ix.get("val")!, 10));
    const vis = lp ? lp.find(CX + "visibility") : null;
    const connectors = boolAttr(vis, "connectorLines", false);
    const dpts = this.dpts(s);
    const colors: Obj = { inc: this.h.autoColor(0), dec: this.h.autoColor(1), tot: this.h.autoColor(2) };
    const names: Obj = { inc: "Increase", dec: "Decrease", tot: "Total" };
    const lab = this.labelsVis(s);
    const fmt = (lab || {}).fmt || (val ? val.fmt : null);
    const baseP: (number | null)[] = [], baseN: (number | null)[] = [];
    const seg: Record<string, [any[], any[]]> = { inc: [[], []], dec: [[], []], tot: [[], []] };
    let running = 0; const ends: number[] = [], used: string[] = [];
    for (let j = 0; j < n; j++) {
      const v = vals[j] !== null ? vals[j]! : 0;
      let a: number, b: number, k: string;
      if (subs.has(j)) { a = 0; b = v; k = "tot"; running = v; }
      else { a = running; b = running + v; running = running + v; k = v >= 0 ? "inc" : "dec"; }
      ends.push(running);
      const [lo, hi] = a <= b ? [a, b] : [b, a];
      if (!used.includes(k)) used.push(k);
      let bp: number | null, bn: number | null, pp: number | null, nn: number | null;
      if (lo >= 0) [bp, bn, pp, nn] = [lo, null, hi - lo, null];
      else if (hi <= 0) [bp, bn, pp, nn] = [null, hi, null, lo - hi];
      else [bp, bn, pp, nn] = [0, 0, hi, lo];
      baseP.push(bp !== null ? sig(bp) : null); baseN.push(bn !== null ? sig(bn) : null);
      for (const kk of Object.keys(seg)) {
        if (kk === k) {
          const itemP: Obj | null = pp !== null ? { value: sig(pp) } : null, itemN: Obj | null = nn !== null ? { value: sig(nn) } : null;
          const col = dpts.get(j);
          for (const it of [itemP, itemN]) if (it && col) it.itemStyle = { color: col };
          if (lab) {
            const txt = this.labelText(lab, cats[j], names[k], v, fmt);
            const tgt = (v >= 0 && itemP !== null) || itemN === null ? itemP! : itemN;
            tgt.label = { show: true, formatter: txt, position: tgt === itemP ? "top" : "bottom" };
          }
          seg[kk][0].push(itemP); seg[kk][1].push(itemN);
        } else { seg[kk][0].push(null); seg[kk][1].push(null); }
      }
    }
    this.grid();
    this.option.xAxis = this.axis("0", "category", cats);
    this.option.yAxis = this.axis("1", "value", null, val ? val.fmt : null, "y");
    const gap = this.gap(0.5);
    const base: Obj = { type: "bar", stack: "wf", silent: true, itemStyle: { color: "transparent" }, emphasis: { disabled: true }, tooltip: { show: false } };
    const out: Obj[] = [{ ...base, name: "", data: baseP, barCategoryGap: gap }];
    if (baseN.some((v) => v !== null)) out.push({ ...base, name: "", data: baseN });
    for (const k of ["inc", "dec", "tot"]) {
      if (!used.includes(k)) continue;
      const e: Obj = { name: names[k], type: "bar", stack: "wf", data: seg[k][0], itemStyle: { color: colors[k] } };
      if (lab) e.label = { show: false, color: lab.font.color, fontSize: lab.font.fontSize };
      if (seg[k][0].some((x) => x !== null)) out.push({ ...e, data: seg[k][0] });
      if (seg[k][1].some((x) => x !== null)) out.push({ ...e, data: seg[k][1] });
    }
    if (connectors && n > 1)
      out[0].markLine = { silent: true, symbol: "none", lineStyle: { color: "#A6A6A6", type: "solid", width: 1 }, label: { show: false },
        data: Array.from({ length: n - 1 }, (_, j) => [{ coord: [j, sig(ends[j])] }, { coord: [j + 1, sig(ends[j])] }]) };
    this.option.series = out;
    this.legendData = ["inc", "dec", "tot"].filter((k) => used.includes(k)).map((k) => names[k]);
    this.option.tooltip = { trigger: "item" };
  }
  funnel(sers: El[]) {
    const s = sers[0];
    const [cat, val] = this.seriesDims(s);
    const vals: (number | null)[] = val && val.levels.length ? val.levels[0] : [];
    const n = vals.length, cats = ChartEx.flatCats(cat, n);
    let mx = 0; for (const v of vals) if (v !== null && Math.abs(v) > mx) mx = Math.abs(v);
    const color = this.color(s, 0), dpts = this.dpts(s), lab = this.labelsVis(s);
    const fmt = (lab || {}).fmt || (val ? val.fmt : null);
    const pad: (number | null)[] = [], data: Obj[] = [];
    vals.forEach((v, j) => {
      const a = v !== null ? Math.abs(v) : 0;
      pad.push(sig((mx - a) / 2));
      const it: Obj = { value: a };
      if (dpts.get(j)) it.itemStyle = { color: dpts.get(j) };
      if (lab) it.label = { formatter: this.labelText(lab, cats[j], this.name(s, 0), v !== null ? v : 0, fmt) };
      data.push(it);
    });
    this.grid();
    this.option.grid.left = 16;
    this.option.xAxis = { type: "value", show: false, min: 0, max: mx || 1 };
    const ya = this.axis("0", "category", cats, null, "y");
    ya.inverse = true; ya.axisLine = { show: false };
    this.option.yAxis = ya;
    const gap = this.gap(0.06);
    const e: Obj = { name: this.name(s, 0), type: "bar", stack: "funnel", data, itemStyle: { color }, barCategoryGap: gap };
    if (lab) e.label = { show: true, position: "inside", color: "#FFFFFF", fontSize: lab.font.fontSize };
    this.option.series = [{ name: "", type: "bar", stack: "funnel", data: pad, silent: true, itemStyle: { color: "transparent" }, emphasis: { disabled: true }, tooltip: { show: false }, barCategoryGap: gap }, e];
    this.legendData = [e.name];
  }
  tree(s: El): [Obj[], Dim | null] {
    const [cat, val] = this.seriesDims(s);
    const vals: (number | null)[] = val && val.levels.length ? val.levels[0] : [];
    const levels = cat ? cat.levels : [];
    const L = levels.length;
    const roots: Obj[] = []; let prev: string[] = [];
    vals.forEach((v, i) => {
      const raw = Array.from({ length: L }, (_, d) => (i < levels[L - 1 - d].length ? levels[L - 1 - d][i] : null));
      const blank = (x: any) => x === null || x === "";
      let k = -1; for (let d = 0; d < L; d++) if (!blank(raw[d])) k = d;
      if (k < 0 || v === null || v <= 0) return;
      const path: string[] = [];
      for (let d = 0; d <= k; d++) path.push(jstr(!blank(raw[d]) ? raw[d] : d < prev.length ? prev[d] : ""));
      prev = path;
      let lst = roots, node: Obj | null = null;
      for (const nm of path) {
        node = lst.find((x) => x.name === nm) ?? null;
        if (!node) { node = { name: nm, own: 0, children: [] }; lst.push(node); }
        lst = node.children;
      }
      node!.own += v;
    });
    return [roots, val];
  }
  finishTree(nodes: Obj[], color: string | null = null, depth = 0): Obj[] {
    return nodes.map((nd, i) => {
      const c = color || this.h.autoColor(i);
      const kids = this.finishTree(nd.children, c, depth + 1);
      let tot = nd.own; for (const k of kids) tot += k.value;
      const e: Obj = { name: nd.name, value: sig(tot), itemStyle: { color: c } };
      if (kids.length) e.children = kids;
      return e;
    });
  }
  treemap(sers: El[]) {
    const s = sers[0];
    const [roots, val] = this.tree(s);
    const data = this.finishTree(roots);
    const lp = s.find(CX + "layoutPr");
    const pll = lp ? lp.find(CX + "parentLabelLayout") : null;
    const mode = pll ? pll.get("val") : "overlapping";
    const lab = this.labelsVis(s) || { value: false, categoryName: true, seriesName: false, fmt: null, font: { fontSize: 12, color: "#FFFFFF" } };
    const fmt = lab.fmt || (val ? val.fmt : null);
    const parts = [...(lab.categoryName || !lab.value ? ["{b}"] : []), ...(lab.value ? ["{c}"] : [])];
    const label = { show: true, formatter: parts.join("\n"), color: "#FFFFFF", fontSize: lab.font.fontSize, position: "insideTopLeft", overflow: "truncate" };
    const e: Obj = { name: this.name(s, 0), type: "treemap", data, roam: false, nodeClick: false, breadcrumb: { show: false }, left: 8, right: 8, bottom: 8, top: "title" in this.option ? 40 : 8,
      label, upperLabel: { show: mode !== "none", height: 20, color: "#404040", fontSize: lab.font.fontSize, fontWeight: "bold" },
      itemStyle: { borderColor: "#FFFFFF", borderWidth: 1, gapWidth: 1 },
      levels: [{ itemStyle: { borderWidth: 0, gapWidth: 3 }, upperLabel: { show: false } }, { itemStyle: { borderColor: "#FFFFFF", borderWidth: 2, gapWidth: 1 } }, { itemStyle: { borderColor: "#FFFFFF", borderWidth: 1, gapWidth: 1 } }] };
    if (lab.value && fmt && fmt !== "General") this.h.fmtHook("series.0.label", fmt);
    this.option.series = [e];
    this.legendData = [];
  }
  sunburst(sers: El[]) {
    const s = sers[0];
    const [roots, val] = this.tree(s);
    const data = this.finishTree(roots);
    const lab = this.labelsVis(s) || { value: false, categoryName: true, seriesName: false, fmt: null, font: { fontSize: 12, color: "#FFFFFF" } };
    const parts = [...(lab.categoryName || !lab.value ? ["{b}"] : []), ...(lab.value ? ["{c}"] : [])];
    const e: Obj = { name: this.name(s, 0), type: "sunburst", data, radius: ["0%", "78%"], center: ["50%", "title" in this.option ? "55%" : "50%"], sort: null, nodeClick: false,
      itemStyle: { borderColor: "#FFFFFF", borderWidth: 1 }, label: { show: true, formatter: parts.join("\n"), rotate: "radial", color: "#FFFFFF", fontSize: lab.font.fontSize, minAngle: 6 } };
    const fmt = lab.fmt || (val ? val.fmt : null);
    if (lab.value && fmt && fmt !== "General") this.h.fmtHook("series.0.label", fmt);
    this.option.series = [e];
    this.legendData = [];
  }
  histogram(sers: El[]) {
    const bar = sers.find((s) => s.get("layoutId") !== "paretoLine") ?? sers[0];
    const pareto = sers.some((s) => s.get("layoutId") === "paretoLine");
    const [cat, val] = this.seriesDims(bar);
    const vals: (number | null)[] = val && val.levels.length ? val.levels[0] : [];
    const fmt = val ? val.fmt : null;
    const lp = bar.find(CX + "layoutPr");
    const binning = lp ? lp.find(CX + "binning") : null;
    let agg = !!lp && !!lp.find(CX + "aggregation");
    if (bar.get("layoutId") !== "clusteredColumn" || (!binning && (agg || cat !== null))) agg = true;
    let labels: string[] = [], counts: (number | null)[] = [];
    if (agg) {
      const catsAll = ChartEx.flatCats(cat, vals.length);
      const sums: number[] = [];
      for (let i = 0; i < Math.min(catsAll.length, vals.length); i++) {
        const c = catsAll[i], v = vals[i]; if (v === null) continue;
        const ix = labels.indexOf(c);
        if (ix >= 0) sums[ix] += v; else { labels.push(c); sums.push(v); }
      }
      counts = sums.map(sig);
    } else [labels, counts] = this.bins(vals.filter((v) => v !== null) as number[], binning, fmt);
    if (pareto) {
      const order = counts.map((_, i) => i).sort((a, b) => (-(counts[a] as number)) - (-(counts[b] as number)) || a - b);
      labels = order.map((i) => labels[i]); counts = order.map((i) => counts[i]);
    }
    this.grid();
    this.option.xAxis = this.axis("0", "category", labels);
    this.option.xAxis.axisLabel.interval = 0;
    let ya: any = this.axis("1", "value", null, agg ? fmt : null, "y");
    const color = this.color(bar, 0), dpts = this.dpts(bar);
    const e: Obj = { name: this.name(bar, 0), type: "bar", data: counts, itemStyle: { color }, barCategoryGap: this.gap(!agg || !pareto ? 0 : 0.5), yAxisIndex: 0 };
    if (dpts.size) e.data = counts.map((v, j) => ({ value: v, itemStyle: { color: dpts.get(j) || color } }));
    const lab = this.labelsVis(bar);
    if (lab) e.label = { show: true, position: "top", color: lab.font.color, fontSize: lab.font.fontSize };
    const series: Obj[] = [e];
    if (pareto) {
      const ps = sers.find((s) => s.get("layoutId") === "paretoLine")!;
      const tot = fsum(counts as number[]);
      const cum: (number | null)[] = []; let acc = 0;
      for (const c of counts as number[]) { acc += c; cum.push(tot ? sig(acc / tot * 100) : 0); }
      let [lc, w] = lineProps(ps.find(CX + "spPr"), this.theme);
      lc = lc || this.h.autoColor(1);
      series.push({ name: ps.find(CX + "tx") ? this.name(ps, 1) : "Pareto", type: "line", data: cum, yAxisIndex: 1, symbol: "none", itemStyle: { color: lc }, lineStyle: { color: lc, width: w || 2.67 } });
      const y2 = this.axis("2", "value", null, null, "y");
      Object.assign(y2, { min: 0, max: 100, position: "right" });
      y2.axisLabel.formatter = "{value}%";
      y2.splitLine = { show: false };
      ya = [ya, y2];
      this.option.grid.right = 24;
    }
    this.option.yAxis = ya;
    this.option.series = series;
    this.legendData = series.map((x) => x.name);
  }
  bins(xsIn: number[], binning: El | null, fmt: string | null): [string[], number[]] {
    const xs = xsIn.slice().sort((a, b) => a - b); const n = xs.length;
    if (!n) return [[], []];
    const closedR = (binning ? binning.get("intervalClosed", "r") : "r") !== "l";
    const numAttr = (k: string): number | null => {
      if (!binning) return null;
      const el = binning.find(CX + k); const v = el ? el.get("val") : binning.get(k);
      return v === undefined || v === "auto" ? null : toF(v);
    };
    const uf = numAttr("underflow"), of = numAttr("overflow"), sizeV = numAttr("binSize"), countV = numAttr("binCount");
    const lo = uf !== null ? uf : xs[0], hi = of !== null ? of : xs[n - 1];
    let w: number, nb: number;
    if (sizeV && sizeV > 0) { w = sizeV; nb = Math.max(1, Math.ceil((hi - lo) / w - 1e-9)); }
    else if (countV && countV >= 1) { nb = Math.trunc(countV); w = hi > lo ? (hi - lo) / nb : 1.0; }
    else {
      const sd = stdev(xs);
      w = sd > 0 ? 3.5 * sd / (n ** (1 / 3)) : 1.0;
      w = sig(w)!;
      nb = Math.max(1, Math.ceil((hi - lo) / w - 1e-9));
    }
    const counts: number[] = new Array(nb).fill(0); let under = 0, over = 0;
    for (const x of xs) {
      if (uf !== null && (closedR ? x <= uf : x < uf)) under++;
      else if (of !== null && (closedR ? x > of : x >= of)) over++;
      else {
        const t = (x - lo) / w;
        let k = closedR ? Math.ceil(t - 1e-9) - 1 : Math.floor(t + 1e-9);
        k = Math.min(Math.max(k, 0), nb - 1); counts[k]++;
      }
    }
    const fx = (x: number) => (fmt === null || fmt === "General" ? jnum(Number(fixedHalfUp(sig(x)!, 2))) : formatNumber(sig(x), fmt));
    const labels: string[] = [];
    for (let k = 0; k < nb; k++) {
      const a = lo + k * w, b = lo + (k + 1) * w;
      if (closedR) labels.push(`${k === 0 && uf === null ? "[" : "("}${fx(a)}, ${fx(b)}]`);
      else labels.push(`[${fx(a)}, ${fx(b)}${k === nb - 1 && of === null ? "]" : ")"}`);
    }
    if (uf !== null) { labels.unshift(`${closedR ? "≤" : "<"}${fx(uf)}`); counts.unshift(under); }
    if (of !== null) { labels.push(`${closedR ? ">" : "≥"}${fx(of)}`); counts.push(over); }
    return [labels, counts];
  }
  box(sers: El[]) {
    const groups: string[] = []; const per: [El, Map<string, number[]>][] = [];
    for (const s of sers) {
      const [cat, val] = this.seriesDims(s);
      const vals: (number | null)[] = val && val.levels.length ? val.levels[0] : [];
      const cats = cat !== null ? ChartEx.flatCats(cat, vals.length) : vals.map(() => "");
      const d = new Map<string, number[]>();
      for (let i = 0; i < Math.min(cats.length, vals.length); i++) {
        const c = cats[i], v = vals[i];
        if (!groups.includes(c)) groups.push(c);
        if (v !== null) { if (!d.has(c)) d.set(c, []); d.get(c)!.push(v); }
      }
      per.push([s, d]);
    }
    this.grid();
    this.option.tooltip = { trigger: "item" };
    this.option.xAxis = this.axis("0", "category", groups);
    this.option.yAxis = this.axis("1", "value", null, null, "y");
    const out: Obj[] = []; const ns = per.length;
    per.forEach(([s, d], si) => {
      const lp = s.find(CX + "layoutPr");
      const vis = lp ? lp.find(CX + "visibility") : null, stt = lp ? lp.find(CX + "statistics") : null;
      const method = stt ? stt.get("quartileMethod", "exclusive")! : "exclusive";
      const showMeanM = boolAttr(vis, "meanMarker", true), showMeanL = boolAttr(vis, "meanLine", false);
      const showInner = boolAttr(vis, "nonoutliers", false), showOut = boolAttr(vis, "outliers", true);
      const color = this.color(s, si), name = this.name(s, si);
      const box: any[] = [], pts: any[] = [], means: [number, number | null][] = [];
      groups.forEach((gname, gi) => {
        const xs = (d.get(gname) || []).slice().sort((a, b) => a - b);
        if (!xs.length) { box.push(null); return; }
        const q1 = quantile(xs, 0.25, method), q3 = quantile(xs, 0.75, method), med = median(xs);
        const iqr = q3 - q1, lf = q1 - 1.5 * iqr, hf = q3 + 1.5 * iqr;
        const inside = xs.filter((x) => lf <= x && x <= hf);
        const lo = inside.length ? inside[0] : q1, hi = inside.length ? inside[inside.length - 1] : q3;
        box.push([sig(lo), sig(q1), sig(med), sig(q3), sig(hi)]);
        const m = mean(xs);
        means.push([gi, sig(m)]);
        if (showMeanM) pts.push([gi, sig(m), 0]);
        for (const x of xs) {
          if (x < lf || x > hf) { if (showOut) pts.push([gi, sig(x), 1]); }
          else if (showInner) pts.push([gi, sig(x), 2]);
        }
      });
      out.push({ name, type: "boxplot", data: box, itemStyle: { color, borderColor: "#595959", borderWidth: 1 }, boxWidth: [7, "60%"] });
      const cfg = { slot: si, slots: ns, color };
      if (pts.length) out.push({ name, type: "custom", "x-renderItem": "boxPoints", "x-cfg": cfg, data: pts, encode: { x: [0], y: [1] }, z: 5, silent: true, tooltip: { show: false } });
      if (showMeanL && means.length > 1) {
        const segs = means.slice(0, -1).map((m, i) => [m[0], m[1], means[i + 1][0], means[i + 1][1]]);
        out.push({ name, type: "custom", "x-renderItem": "boxMeanLine", "x-cfg": cfg, data: segs, encode: { x: [0, 2], y: [1, 3] }, z: 4, silent: true, tooltip: { show: false } });
      }
    });
    this.option.series = out;
    this.legendData = out.filter((s) => s.type === "boxplot").map((s) => ({ name: s.name, itemStyle: { color: s.itemStyle.color } })) as any;
  }
}
function pyrepr(s: string) { return s.includes("'") && !s.includes('"') ? `"${s}"` : `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`; }
