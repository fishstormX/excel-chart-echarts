/** DrawingML chart → ECharts option (port of xlsx2echarts/converter.py — keep both in sync; see tests/parity). */
import { El } from "./xml.js";
import { A, fillColor, lineProps, local, noFill, pyRound, resolveColor } from "./colors.js";
import { FormulaError, Val, num2col, splitRef } from "./formula.js";
import { CXNS, ChartEx } from "./chartex.js";
import { fsum, linreg, mean, polyfit, polyval, sig, stdev } from "./stats.js";
import { NS, R_ID, Sheet, Workbook, formatDate, formatNumber, isDateFormat, isoLocal, jnum, jstr, serialToDate } from "./workbook.js";

const C15 = "{http://schemas.microsoft.com/office/drawing/2012/chart}";
const C = `{${NS.c}}`, XDR = `{${NS.xdr}}`, EMU_PX = 9525;
const GROUP_TAGS = ["barChart", "bar3DChart", "lineChart", "line3DChart", "areaChart", "area3DChart", "pieChart", "pie3DChart", "doughnutChart", "ofPieChart", "scatterChart", "radarChart", "bubbleChart", "stockChart", "surfaceChart", "surface3DChart"];
const AX_TAGS = ["catAx", "valAx", "dateAx", "serAx"];
const SYMBOLS: Record<string, string> = { circle: "circle", square: "rect", diamond: "diamond", triangle: "triangle", x: "path://M0,0L10,10M10,0L0,10", star: "path://M5,0L5,10M0,5L10,5M1.5,1.5L8.5,8.5M8.5,1.5L1.5,8.5", plus: "path://M5,0L5,10M0,5L10,5", dash: "path://M0,4h10v2h-10z", dot: "circle", picture: "rect" };
const LEGACY_MARKERS = ["diamond", "rect", "triangle", SYMBOLS.x, SYMBOLS.star, "circle", SYMBOLS.plus];
const ALIAS_FN: Record<string, string> = { bar3DChart: "barChart", line3DChart: "lineChart", area3DChart: "areaChart", pie3DChart: "pieChart", ofPieChart: "pieChart" };

type Obj = Record<string, any>;
const isNum = (x: any): x is number => typeof x === "number";
const INT = /^[+-]?\d+$/;
function _v<T = string>(el: El | null | undefined, path: string | null, def: T, cast: "str" | "int" | "float" = "str"): T | any {
  if (!el) return def;
  const x = path ? el.find(path) : el;
  if (!x || x.get("val") === undefined) return def;
  const s = x.get("val")!;
  if (cast === "int") return INT.test(s.trim()) ? parseInt(s, 10) : def;
  if (cast === "float") { const f = s.trim() === "" ? NaN : Number(s); return isNaN(f) ? def : f; }
  return s;
}
function _bool(el: El | null | undefined, path: string, def = false) {
  if (!el) return def;
  const x = el.find(path);
  if (!x) return def;
  const v = x.get("val", "1");
  return v === "1" || v === "true";
}
const pct = (x: number) => `${jnum(pyRound(x, 2))}%`;

export interface ChartResult { index?: number; id: string; part: string; sheet: string | null; anchor: string | null; name: string | null; title: string | null; width: number; height: number; types: string[]; usedFormulaFallback?: boolean; warnings: string[]; option: Obj | null; }
export interface ConvertResult { charts: ChartResult[]; warnings: string[]; sheets: string[]; evaluatedFormulas: number; }

class ChartConverter {
  root: El; theme: Record<string, string>; warnings: string[] = []; formats: Obj[] = []; chartEl: El; modern: boolean; baseFont: Obj;
  axes = new Map<string | null, [string, El]>(); dispBlanks = "gap"; option: Obj = {}; xaxes: Obj[] = []; yaxes: Obj[] = [];
  axmap = new Map<string | null, [string, number]>(); pieLike = false; usedFormulaFallback = false;
  errPending: [Obj, Obj | null][] = []; tipFmt = new Map<Obj, string | [string, string]>(); autoAxes: [string, number, number | null, number | null][] = []; dateAxes = new Map<string, string>(); autoNames = new Set<string>(); trendPending: Obj[] = []; barDim = new Map<Obj, string>();
  constructor(public wb: Workbook, public part: string, public excelCompat = true) {
    this.root = wb.xml(part); this.theme = wb.theme; this.chartEl = this.root.find(C + "chart")!;
    const raw = wb.raw(part);
    this.modern = raw.includes("c14:style") || raw.slice(0, 4000).includes("<c:txPr") || !!this.root.find(C + "txPr");
    this.baseFont = this.font(this.root.find(C + "txPr"), this.modern ? 9.0 : 10.0);
  }
  font(txPr: El | null, defPt: number, bold = false): Obj {
    let sz = defPt, color: string | null = null, b = bold;
    if (txPr) {
      for (const e of [txPr.find(`.//${A}defRPr`), txPr.find(`.//${A}rPr`)]) {
        if (!e) continue;
        if (e.get("sz")) sz = parseInt(e.get("sz")!, 10) / 100;
        if (e.get("b") !== undefined) b = e.get("b") === "1" || e.get("b") === "true";
        const sf = e.find(A + "solidFill");
        if (sf && sf.length) color = resolveColor(sf.children[0], this.theme);
      }
    }
    return { fontSize: pyRound(sz * 4 / 3, 1), color: color || "#595959", fontWeight: b ? "bold" : "normal" };
  }
  richText(tx: El | null): [string | null, El | null] {
    const rich = tx ? tx.find(C + "rich") : null;
    if (rich) return [rich.findall(A + "p").map((p) => [...p.iter(A + "t")].map((t) => t.text || "").join("")).join("\n"), rich];
    if (tx) {
      if (tx.find(C + "strRef")) { const [vals] = this.readData(tx); return [vals.filter((v) => v !== null).map(jstr).join(" "), null]; }
      if (tx.find(C + "v")) return [tx.find(C + "v")!.text || "", null];
    }
    return [null, null];
  }
  title(el: El | null, defPt: number, auto: string | null): [string, Obj] | null {
    if (!el) return null;
    let [text, rich] = this.richText(el.find(C + "tx"));
    if (text === null) text = auto;
    if (!text) return null;
    let f = this.font(el.find(C + "txPr"), defPt, !this.modern || defPt > 12);
    if (rich) f = this.font(rich, defPt, f.fontWeight === "bold");
    return [text, f];
  }
  readData(el: El | null): [Val[], string | null, boolean] {
    if (!el) return [[], null, false];
    for (const kind of ["numRef", "strRef", "multiLvlStrRef", "numLit", "strLit"]) {
      const src = el.find(C + kind);
      if (!src) continue;
      const cache = kind.endsWith("Ref") ? src.find(C + ({ numRef: "numCache", strRef: "strCache", multiLvlStrRef: "multiLvlStrCache" } as Obj)[kind]) : src;
      let fmt: string | null = null; let vals: Val[] = [];
      if (cache && kind === "multiLvlStrRef") {
        const lvls = cache.findall(C + "lvl"); const n = _v(cache, C + "ptCount", 0, "int");
        if (lvls.length && n) {
          const levels = lvls.map((lvl) => { const arr: (string | null)[] = new Array(n).fill(null); for (const pt of lvl.findall(C + "pt")) { const i = parseInt(pt.get("idx")!, 10); if (i < n) arr[i] = pt.findtext(C + "v"); } return arr; });
          const outer = levels.slice(1);
          for (const o of outer) { let last: string | null = null; for (let i = 0; i < n; i++) { if (o[i] === null) o[i] = last; last = o[i]; } }
          vals = []; for (let i = 0; i < n; i++) vals.push([...[...outer].reverse().map((o) => o[i]), levels[0][i]].filter((x) => x).join(" "));
          return [vals, null, true];
        }
      }
      if (cache && (cache.find(C + "ptCount") || cache.findall(C + "pt").length)) {
        let n = _v(cache, C + "ptCount", 0, "int");
        const pts = cache.findall(C + "pt");
        if (n === 0 && pts.length) n = Math.max(...pts.map((p) => parseInt(p.get("idx")!, 10))) + 1;
        if (pts.length || n) {
          fmt = cache.findtext(C + "formatCode");
          const arr: Val[] = new Array(n).fill(null);
          for (const pt of pts) {
            const i = parseInt(pt.get("idx")!, 10); if (i >= n) continue;
            const t = pt.findtext(C + "v");
            if (kind === "numRef" || kind === "numLit") { const x = t === null || t.trim() === "" ? NaN : Number(t); arr[i] = isNaN(x) ? null : x; }
            else arr[i] = t;
            if (pt.get("formatCode")) fmt = fmt || pt.get("formatCode")!;
          }
          if (pts.length) {
            if ((fmt === null || fmt === "General") && src.findtext(C + "f")) fmt = this.refFormat(src.findtext(C + "f")!) || fmt;
            return [arr, fmt, !(kind === "numRef" || kind === "numLit")];
          }
        }
      }
      const f = src.findtext(C + "f");
      if (f) { const [v2, f2] = this.resolveRef(f, kind === "multiLvlStrRef" || el.tag === C + "cat"); return [v2, f2, !(kind === "numRef" || kind === "numLit") || v2.some((v) => typeof v === "string")]; }
      return [vals, fmt, !(kind === "numRef" || kind === "numLit")];
    }
    return [[], null, false];
  }
  parts(f: string): string[] {
    f = f.trim();
    if (f.startsWith("(") && f.endsWith(")")) f = f.slice(1, -1);
    if (this.wb.definedNames.has(f)) f = this.wb.definedNames.get(f)!;
    return f.match(/(?:'(?:[^']|'')+'|[^,'])+/g) || [];
  }
  refFormat(f: string): string | null {
    for (const part of this.parts(f)) {
      let sp; try { sp = splitRef(part.trim()); } catch (e) { if (e instanceof FormulaError) continue; throw e; }
      const [sheet, r1, c1, r2, c2] = sp;
      if (sheet === null || (r2 - r1 + 1) * (c2 - c1 + 1) > 100000) continue;
      for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) { const st = this.wb.style(sheet, r, c); if (st !== "General") return st; }
    }
    return null;
  }
  resolveRef(f: string, multi = false): [Val[], string | null] {
    const parts = this.parts(f);
    if (multi && parts.length === 1) {
      let sp: ReturnType<typeof splitRef> | null = null;
      try { sp = splitRef(parts[0].trim()); } catch (e) { if (!(e instanceof FormulaError)) throw e; }
      if (sp && sp[0] !== null && sp[3] > sp[1] && sp[4] > sp[2] && (sp[3] - sp[1] + 1) * (sp[4] - sp[2] + 1) <= 100000) {
        const [sheet, r1, c1, r2, c2] = sp as [string, number, number, number, number];
        let rows: Val[][] = [];
        for (let r = r1; r <= r2; r++) { const row: Val[] = []; for (let c = c1; c <= c2; c++) row.push(this.wb.value(sheet, r, c)); rows.push(row); }
        if (r2 - r1 < c2 - c1) rows = rows[0].map((_, k) => rows.map((row) => row[k]));
        for (let lvl = 0; lvl < rows[0].length - 1; lvl++) { let last: Val = null; for (const row of rows) { if (row[lvl] === null || row[lvl] === "") row[lvl] = last; last = row[lvl]; } }
        this.usedFormulaFallback = true;
        return [rows.map((row) => row.map(jstr).filter((x) => x).join(" ")), null];
      }
    }
    const vals: Val[] = []; let fmt: string | null = null;
    for (const part of parts) {
      let sp;
      try { sp = splitRef(part.trim()); } catch (e) { if (!(e instanceof FormulaError)) throw e; this.warnings.push(`cannot resolve reference ${pyrepr(part)}`); continue; }
      const [sheet, r1, c1, r2, c2] = sp;
      if (sheet === null) { this.warnings.push(`reference without sheet ${pyrepr(part)}`); continue; }
      if ((r2 - r1 + 1) * (c2 - c1 + 1) > 100000) { this.warnings.push(`reference too large ${pyrepr(part)}`); continue; }
      for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) {
        vals.push(this.wb.value(sheet, r, c));
        if (fmt === null) { const st = this.wb.style(sheet, r, c); if (st !== "General") fmt = st; }
      }
    }
    this.usedFormulaFallback = true;
    return [vals, fmt];
  }

  convert(): { types: string[]; option: Obj; warnings: string[] } {
    const ch = this.chartEl, pa = ch.find(C + "plotArea")!;
    const groups = pa.children.filter((g) => GROUP_TAGS.includes(local(g.tag)));
    for (const ax of pa.children) { const t = local(ax.tag); if (AX_TAGS.includes(t)) this.axes.set(ax.findtext(C + "axId") || _v(ax, C + "axId", null), [t, ax]); }
    this.dispBlanks = _v(ch, C + "dispBlanksAs", "gap");
    this.option = { backgroundColor: this.chartBg(), textStyle: { fontFamily: "Calibri, 'Microsoft YaHei', 'PingFang SC', sans-serif" }, tooltip: { trigger: "item" }, series: [] };
    const types: string[] = [], allSeries: El[] = [];
    for (const g of groups) {
      const t = local(g.tag); types.push(t);
      const sers = g.findall(C + "ser").map((s, i) => [s, i] as [El, number]).sort((a, b) => (_v(a[0], C + "order", 0, "int") - _v(b[0], C + "order", 0, "int")) || a[1] - b[1]).map((x) => x[0]);
      allSeries.push(...sers);
      const name = "g_" + (ALIAS_FN[t] ?? t);
      let fn = (this as any)[name];
      if (!fn) { this.warnings.push(`${t} is not supported — rendered as line chart`); fn = this.g_lineChart; }
      if (t.endsWith("3DChart")) this.warnings.push(`${t}: 3-D rendered as 2-D`);
      fn.call(this, g, sers);
    }
    this.finalizeErrbars();
    this.option.series.push(...this.trendPending);
    this.autoScale();
    let auto: string | null = null;
    if (allSeries.length === 1) auto = this.seriesName(allSeries[0], 0); else if (allSeries.length) auto = "Chart Title";
    const t = _bool(ch, C + "autoTitleDeleted") ? null : this.title(ch.find(C + "title"), this.modern ? 14.0 : 18.0, auto);
    if (t) {
      this.option.title = { text: t[0], left: "center", top: 6, textStyle: t[1] };
      const mxy = manualXY(ch.find(C + "title"));
      if (mxy) [this.option.title.left, this.option.title.top] = mxy;
    }
    this.legend(ch.find(C + "legend"));
    if (!this.option.legend.show && this.autoNames.size) {
      for (const s of this.option.series) {
        if (this.autoNames.has(s.name)) s.name = "";
        if (s.type === "radar") for (const d of s.data || []) if (this.autoNames.has(d.name)) d.name = "";
      }
    }
    this.option.series.forEach((s: Obj, i: number) => {
      const code = this.tipFmt.get(s);
      if (Array.isArray(code)) this.formats.push({ path: `series.${i}.tooltip`, formatCode: code[1], tooltip: true, date: true, serial: this.wb.date1904 ? 1904 : 1900 });
      else if (code) this.formats.push({ path: `series.${i}.tooltip`, formatCode: code, tooltip: true });
    });
    if (this.xaxes.length) this.option.xAxis = this.xaxes.length > 1 ? this.xaxes : this.xaxes[0];
    if (this.yaxes.length) this.option.yAxis = this.yaxes.length > 1 ? this.yaxes : this.yaxes[0];
    if (this.xaxes.length || this.yaxes.length) {
      const top = "title" in this.option ? 50 : 24;
      const leg = this.option.legend || {};
      const grid: Obj = { left: 16, right: 24, top, bottom: 16, containLabel: true };
      if (leg.show) {
        const pos = leg._pos;
        if (pos === "b") grid.bottom = 40; else if (pos === "t") grid.top = top + 28; else if (pos === "r" || pos === "tr") grid.right = 130; else if (pos === "l") grid.left = 130;
      }
      for (const ax of this.yaxes) if (ax.name) grid[ax.position === "right" ? "right" : "left"] += 28;
      if (this.xaxes.some((ax) => ax.name)) grid.bottom += 24;
      this.option.grid = grid;
      this.option.tooltip = { trigger: "axis", axisPointer: { type: types.some((x) => x.includes("bar")) ? "shadow" : "line" } };
      if (types.some((x) => x === "scatterChart" || x === "bubbleChart")) this.option.tooltip = { trigger: "item" };
    }
    if ("legend" in this.option) delete this.option.legend._pos;
    if (this.formats.length) this.option["x-numFmt"] = this.formats;
    return { types, option: this.option, warnings: this.warnings };
  }
  chartBg() { const sp = this.root.find(C + "spPr"); if (noFill(sp)) return "transparent"; return fillColor(sp, this.theme) || "#FFFFFF"; }
  autoColor(i: number): string {
    const acc = ["accent1", "accent2", "accent3", "accent4", "accent5", "accent6"];
    const base = this.theme[acc[i % 6]] ?? "4472C4"; const r = Math.floor(i / 6);
    if (r === 0) return "#" + base.toUpperCase();
    const e = new El(A + "srgbClr", { val: base });
    if (r % 2 === 1) e.children.push(new El(A + "lumMod", { val: "60000" }));
    else { e.children.push(new El(A + "lumMod", { val: "80000" })); e.children.push(new El(A + "lumOff", { val: "20000" })); }
    return resolveColor(e, this.theme)!;
  }
  seriesColor(ser: El): string { const sp = ser.find(C + "spPr"); return fillColor(sp, this.theme) || this.autoColor(_v(ser, C + "idx", 0, "int")); }
  seriesLine(ser: El): [string, number | null, boolean, string | null] {
    const [col, w, nol, dash] = lineProps(ser.find(C + "spPr"), this.theme);
    return [col || this.autoColor(_v(ser, C + "idx", 0, "int")), w, nol, dash];
  }
  seriesName(ser: El, i: number) {
    const tx = ser.find(C + "tx");
    if (tx) { const [text] = this.richText(tx); if (text) return text; }
    const nm = `Series${_v(ser, C + "idx", i, "int") + 1}`;
    this.autoNames.add(nm);
    return nm;
  }
  tip(e: Obj, lab: Obj | null, fmt: string | null, axisFmt: string | null, skip: boolean) {
    if (skip) return;
    const ok = (c: string | null | undefined) => (c && c !== "General" ? c : null);
    const code = (lab && lab._fmt) || ok(fmt) || ok(axisFmt);
    if (code && !isDateFormat(code)) this.tipFmt.set(e, code);
  }
  axisFor(axId: string | null, dim: "x" | "y", kind: string, o: { categories?: string[]; catFmt?: string | null; valFmt?: string | null; percent?: boolean; boundaryGap?: boolean } = {}): number {
    if (this.axmap.has(axId)) return this.axmap.get(axId)![1];
    const lst = dim === "x" ? this.xaxes : this.yaxes;
    const ent = this.axes.get(axId); const ax = ent ? ent[1] : null;
    // openpyxl ≥3.1 writes neither <c:delete> nor <c:tickLblPos>; Excel then hides the axis (XlsxWriter writes tickLblPos → shown).
    const implicitHide = !!ax && this.excelCompat && !ax.find(C + "delete") && !ax.find(C + "tickLblPos");
    const deleted = ax ? _bool(ax, C + "delete", implicitHide) : true;
    if (implicitHide)
      this.warnings.push(`axis ${axId}: no <c:delete> element — Excel hides such axes (typical openpyxl ≥3.1 output); labels hidden to match Excel`);
    const e: Obj = {};
    const font = this.font(ax ? ax.find(C + "txPr") : null, this.baseFont.fontSize * 3 / 4);
    e.axisLabel = { show: !deleted && _v(ax, C + "tickLblPos", "nextTo") !== "none", color: font.color, fontSize: font.fontSize };
    let rot: number | null = null;
    if (ax) { const bp = ax.find(`${C}txPr/${A}bodyPr`); if (bp && bp.get("rot") !== undefined && bp.get("rot") !== "-60000000") { rot = -parseInt(bp.get("rot")!, 10) / 60000; if (rot) e.axisLabel.rotate = rot; } }
    let lineCol = this.modern ? "#D9D9D9" : "#868686"; let axisLineShow = false;
    let lineW: number | null = null;
    if (ax) { const [c, w, nol] = lineProps(ax.find(C + "spPr"), this.theme); lineW = w; if (c) lineCol = c; axisLineShow = !nol && !deleted; }
    e.axisLine = { show: axisLineShow, lineStyle: { color: lineCol, ...(lineW && lineW > 1.5 ? { width: lineW } : {}) } };
    const majorTick = _v(ax, C + "majorTickMark", this.modern ? "none" : "out");
    e.axisTick = { show: !deleted && majorTick !== "none", inside: majorTick === "in", lineStyle: { color: lineCol } };
    if (kind === "category") e.axisTick.alignWithLabel = true;
    const mg = ax ? ax.find(C + "majorGridlines") : null; const gcol = this.modern ? "#D9D9D9" : "#878787";
    if (mg) { const [c, w, , dash] = lineProps(mg.find(C + "spPr"), this.theme); e.splitLine = { show: true, lineStyle: { color: c || gcol, ...(w ? { width: w } : {}), ...(dash ? { type: dash } : {}) } }; }
    else e.splitLine = { show: false };
    if (ax && ax.find(C + "minorGridlines")) { e.minorSplitLine = { show: true, lineStyle: { color: "#F2F2F2" } }; e.minorTick = { show: false }; }
    const title = ax ? this.title(ax.find(C + "title"), 10.0, null) : null;
    if (title) { e.name = title[0]; e.nameLocation = "middle"; e.nameTextStyle = { ...title[1] }; e.nameGap = dim === "x" ? 32 : 45; }
    const scaling = ax ? ax.find(C + "scaling") : null;
    if (_v(scaling, C + "orientation", "minMax") === "maxMin") e.inverse = true;
    const pos = _v(ax, C + "axPos", null);
    if (kind === "category") {
      e.type = "category"; e.data = o.categories || []; e.boundaryGap = o.boundaryGap ?? true;
      const skip = _v(ax, C + "tickLblSkip", null, "int");
      if (skip) e.axisLabel.interval = skip - 1; else if (o.categories && o.categories.length && !rot) e.axisLabel.interval = "auto";
    } else if (kind === "time") {
      e.type = "time"; e.boundaryGap = false;
      if (o.catFmt) this.fmtHook(`${dim}Axis.${lst.length}.axisLabel`, o.catFmt, true);
    } else {
      e.type = "value";
      const lb = _v(scaling, C + "logBase", null, "float");
      if (lb) { e.type = "log"; e.logBase = lb; }
      let mn = _v(scaling, C + "min", null, "float"), mx = _v(scaling, C + "max", null, "float");
      if (o.percent) { mn = mn === null ? 0 : mn * 100; mx = mx === null ? 100 : mx * 100; }
      if (mn !== null) e.min = mn;
      if (mx !== null) e.max = mx;
      const mu = _v(ax, C + "majorUnit", null, "float");
      if (mu) e.interval = mu * (o.percent ? 100 : 1);
      e.scale = false;
      if (mn === null && !lb && !o.percent) this.autoAxes.push([dim, lst.length, mx, mu]);
      const nf = ax ? ax.find(C + "numFmt") : null; let code: string | null = null;
      if (nf && (nf.get("sourceLinked") === "0" || nf.get("sourceLinked") === "false")) code = nf.get("formatCode") ?? null;
      else if (o.valFmt) code = o.valFmt;
      if (o.percent) e.axisLabel.formatter = "{value}%";
      else if (code && isDateFormat(code)) { this.fmtHook(`${dim}Axis.${lst.length}.axisLabel`, code, true, true); this.dateAxes.set(`${dim}${lst.length}`, code); }
      else if (code && code !== "General") this.fmtHook(`${dim}Axis.${lst.length}.axisLabel`, code);
      if (dim === "y" && (pos === "r" || lst.length >= 1)) e.position = lst.length >= 1 ? "right" : "left";
      if (dim === "x" && (pos === "t" || xOccupied(lst))) e.position = "top";
    }
    if (dim === "x" && kind !== "value" && (pos === "t" || xOccupied(lst))) e.position = "top";
    if (dim === "x" && lst.length && !("position" in e)) e.position = "bottom";
    lst.push(e);
    const idx = lst.length - 1; this.axmap.set(axId, [dim, idx]); return idx;
  }
  fmtHook(path: string, code: string, date = false, serial = false) {
    const h: Obj = { path, formatCode: code };
    if (date) h.date = true;
    if (serial) h.serial = this.wb.date1904 ? 1904 : 1900;
    this.formats.push(h);
  }
  /** Excel's automatic value-axis minimum (see converter.py _auto_scale). */
  autoScale() {
    for (const [dim, idx, mxFixed, mu] of this.autoAxes) {
      let vals: any[] = [];
      for (const s of this.option.series) {
        if ((s[dim + "AxisIndex"] ?? 0) !== idx || s.stack) continue;
        vals.push(...this.axisVals(s, dim));
      }
      vals = vals.filter((v) => typeof v === "number" && isFinite(v));
      if (!vals.length) continue;
      let lo = Math.min(...vals), hi = Math.max(...vals);
      if (mxFixed !== null) hi = Math.max(hi, mxFixed);
      const ax = (dim === "x" ? this.xaxes : this.yaxes)[idx];
      let mn: number;
      if (lo > 0 && lo > hi * 5 / 6 && hi > lo) mn = lo - (hi - lo) / 2;
      else if (hi < 0 && hi < lo * 5 / 6 && hi > lo) { ax.scale = true; continue; }
      else continue;
      if (mu) ax.min = sig(Math.floor(mn / mu) * mu); else ax.scale = true;
    }
  }
  axisVals(s: Obj, dim: string): any[] {
    const d = s.data || [], out: any[] = [], t = s.type;
    if (t === "custom") {
      const enc: number[] = (s.encode || {})[dim] || [];
      for (let p of d) { p = p !== null && typeof p === "object" && !Array.isArray(p) ? p.value : p; if (Array.isArray(p)) for (const k of enc) if (k < p.length) out.push(p[k]); }
      return out;
    }
    const catDim = t === "bar" ? (this.barDim.get(s) ?? "x") : "x";
    for (let p of d) {
      p = p !== null && typeof p === "object" && !Array.isArray(p) ? p.value : p;
      if (Array.isArray(p)) { if ((t === "scatter" || t === "line") && p.length >= 2) out.push(dim === "x" ? p[0] : p[1]); }
      else if ((t === "bar" || t === "line") && dim !== catDim) out.push(p);
    }
    return out;
  }
  labels(group: El, ser: El, kind: string, fmt: string | null): Obj | null {
    let d = ser.find(C + "dLbls"); if (!d) d = group.find(C + "dLbls");
    if (!d || _bool(d, C + "delete")) return null;
    const fl: Obj = {}; for (const k of ["showVal", "showPercent", "showCatName", "showSerName", "showLegendKey"]) fl[k] = _bool(d, C + k);
    let rng: (string | null)[] | null = null;
    if ([...d.iter(C15 + "showDataLabelsRange")].some((x) => x.get("val") === "1" || x.get("val") === "true")) {
      const cache = ser.iter(C15 + "dlblRangeCache").next().value;
      if (cache) {
        const n = _v(cache, C + "ptCount", 0, "int"); rng = new Array(n).fill(null);
        for (const pt of cache.findall(C + "pt")) { const k = parseInt(pt.get("idx")!, 10); if (k < n) { const t = pt.findtext(C + "v"); rng[k] = t == null ? null : t.replace(/\r\n?/g, "\n"); } }
      }
    }
    if (rng !== null) {
      const font = this.font(d.find(C + "txPr"), this.baseFont.fontSize * 3 / 4);
      const pm: Obj = { t: "top", b: "bottom", l: "left", r: "right", ctr: "inside" };
      return { show: true, formatter: "{b}", color: font.color, fontSize: font.fontSize, position: pm[_v(d, C + "dLblPos", null)] ?? "right", _range: rng };
    }
    if (!(fl.showVal || fl.showPercent || fl.showCatName || fl.showSerName)) return null;
    const sep = d.findtext(C + "separator") || ", ";
    const parts: string[] = [];
    if (fl.showSerName) parts.push("{a}");
    if (fl.showCatName) parts.push("{b}");
    if (fl.showVal) parts.push(kind === "scatter" ? "{@[1]}" : "{c}");
    if (fl.showPercent && kind === "pie") parts.push("{d}%");
    const font = this.font(d.find(C + "txPr"), this.baseFont.fontSize * 3 / 4);
    const lab: Obj = { show: true, formatter: parts.join(sep), color: font.color, fontSize: font.fontSize };
    const pos = _v(d, C + "dLblPos", null);
    const pmap: Obj = { outEnd: "top", inEnd: "insideTop", ctr: "inside", inBase: "insideBottom", t: "top", b: "bottom", l: "left", r: "right", bestFit: "outside" };
    if (kind === "pie") lab.position = ({ outEnd: "outside", bestFit: "outside", inEnd: "inside", ctr: "inside" } as Obj)[pos] ?? "outside";
    else if (kind === "hbar") lab.position = ({ outEnd: "right", inEnd: "insideRight", ctr: "inside", inBase: "insideLeft" } as Obj)[pos] ?? "right";
    else if (kind === "stackbar") lab.position = pmap[pos] ?? "inside";
    else lab.position = pmap[pos] ?? (kind !== "line" ? "top" : "right");
    const nf = d.find(C + "numFmt");
    const code = nf && (nf.get("sourceLinked") === "0" || nf.get("sourceLinked") === "false") ? nf.get("formatCode") ?? null : fmt;
    if (code && code !== "General" && fl.showVal && kind !== "scatter") lab._fmt = code;
    return lab;
  }
  applyLabelFmt(s: Obj) {
    const lab = s.label; if (!lab || !("_fmt" in lab)) return;
    const code = lab._fmt; delete lab._fmt;
    if (lab.formatter === "{c}") {
      s.data = s.data.map((v: any) => {
        const isObj = v !== null && typeof v === "object" && !Array.isArray(v);
        const raw = isObj ? v.value : v; const item: Obj = isObj ? { ...v } : { value: v };
        if (raw !== null && raw !== undefined) { item.label = item.label || {}; item.label.formatter = formatNumber(raw, code); }
        return item;
      });
    } else this.fmtHook(`series.${this.option.series.length - 1}.label`, code);
  }
  categories(sers: El[], axId: string | null): [string[], (number | null)[] | null, string] {
    let cats: Val[] = [], fmt: string | null = null;
    for (const s of sers) { [cats, fmt] = this.readData(s.find(C + "cat")); if (cats.length) break; }
    const n = Math.max(...sers.map((s) => this.readData(s.find(C + "val"))[0].length), cats.length);
    const ent = this.axes.get(axId); const tag = ent ? ent[0] : "catAx"; const ax = ent ? ent[1] : null;
    const nf = ax ? ax.find(C + "numFmt") : null;
    if (nf && (nf.get("sourceLinked") === "0" || nf.get("sourceLinked") === "false")) fmt = nf.get("formatCode") || fmt;
    const numeric = cats.length > 0 && cats.every((c) => c === null || isNum(c));
    let dates: (number | null)[] | null = null, labels: string[];
    if (numeric && (isDateFormat(fmt) || tag === "dateAx")) { dates = cats as any; labels = cats.map((c) => (c !== null ? formatDate(c as number, fmt || "yyyy-mm-dd", this.wb.date1904) : "")); }
    else if (numeric) labels = cats.map((c) => formatNumber(c, fmt));
    else labels = cats.map(jstr);
    if (!labels.length) labels = Array.from({ length: n }, (_, i) => String(i + 1));
    while (labels.length < n) labels.push(String(labels.length + 1));
    return [labels, dates, tag];
  }
  values(ser: El, tag = "val"): [(number | null)[], string | null] {
    const [vals, fmt] = this.readData(ser.find(C + tag));
    const out = vals.map((v): number | null => {
      if (typeof v === "boolean") v = v ? 1 : 0;
      if (typeof v === "string") { const t = v.trim(); const x = t === "" ? NaN : Number(t); v = isNaN(x) ? null : x; }
      if (Array.isArray(v)) v = null;
      if (v === null && this.dispBlanks === "zero") v = 0;
      if (isNum(v)) v = Number.isInteger(v) && Math.abs(v) < 1e15 ? v : Number(v.toPrecision(12));
      return v as number | null;
    });
    return [out, fmt];
  }
  catValAxes(g: El): [string | null, string | null] { const ids = g.findall(C + "axId").map((a) => a.get("val") ?? null); return [ids[0] ?? null, ids[1] ?? null]; }
  percentLabels(e: Obj, lab: Obj, orig: (number | null)[], fmt: string | null) {
    const code = lab._fmt || fmt; delete lab._fmt;
    if (lab.formatter === "{c}") {
      const n = Math.min(e.data.length, orig.length); const data: Obj[] = [];
      for (let k = 0; k < n; k++) {
        const v = e.data[k]; const isObj = v !== null && typeof v === "object" && !Array.isArray(v);
        const item: Obj = isObj ? { ...v } : { value: v };
        if (orig[k] !== null) item.label = { formatter: formatNumber(orig[k], code) };
        data.push(item);
      }
      e.data = data;
    } else lab.formatter = lab.formatter.split("{c}").join("{c}%");
  }
  dpts(s: El) { const out = new Map<number, string>(); for (const dp of s.findall(C + "dPt")) { const c = fillColor(dp.find(C + "spPr"), this.theme); if (c) out.set(_v(dp, C + "idx", 0, "int"), c); } return out; }
  percentTotals(valsAll: [(number | null)[], any][], n: number) {
    return Array.from({ length: n }, (_, i) => valsAll.reduce((a, [v]) => a + (i < v.length && v[i] !== null ? Math.abs(v[i]!) : 0), 0));
  }

  g_barChart(g: El, sers: El[]) {
    const horizontal = _v(g, C + "barDir", "col") === "bar", grouping = _v(g, C + "grouping", "clustered");
    const [catId, valId] = this.catValAxes(g);
    const [labels] = this.categories(sers, catId);
    const [cdim, vdim]: ["x" | "y", "x" | "y"] = horizontal ? ["y", "x"] : ["x", "y"];
    const valsAll = sers.map((s) => this.values(s));
    const valFmt = valsAll.find(([, f]) => f)?.[1] ?? null;
    const percent = grouping === "percentStacked";
    const ci = this.axisFor(catId, cdim, "category", { categories: labels });
    const vi = this.axisFor(valId, vdim, "value", { valFmt, percent });
    const gap = _v(g, C + "gapWidth", 150, "int") / 100;
    const stacked = grouping === "stacked" || grouping === "percentStacked";
    const overlap = _v(g, C + "overlap", stacked ? 100 : 0, "int");
    const nbars = stacked ? 1 : Math.max(1, sers.length);
    const totals = percent ? this.percentTotals(valsAll, labels.length) : null;
    const vary = _bool(g, C + "varyColors") && sers.length === 1;
    const stackId = `stack${this.option.series.length}`;
    const accP: number[] = new Array(labels.length).fill(0), accN: number[] = new Array(labels.length).fill(0);
    sers.forEach((s, i) => {
      let [vals, fmt] = valsAll[i];
      const orig = vals;
      const color = this.seriesColor(s);
      if (percent) vals = vals.map((v, j) => (v === null || !totals![j] ? null : pyRound(v / totals![j] * 100, 6)));
      const it: Obj = { color };
      const [col, w, nol] = lineProps(s.find(C + "spPr"), this.theme);
      if (col && !nol) { it.borderColor = col; it.borderWidth = w || 1; }
      if (noFill(s.find(C + "spPr"))) it.color = "transparent";
      const e: Obj = { name: this.seriesName(s, i), type: "bar", data: vals, itemStyle: it, [horizontal ? "xAxisIndex" : "yAxisIndex"]: vi, [horizontal ? "yAxisIndex" : "xAxisIndex"]: ci };
      if (stacked) e.stack = stackId;
      if (i === 0 || !stacked) { e.barCategoryGap = pct(gap / (nbars + gap) * 100); e.barGap = `${jnum(-overlap)}%`; }
      const dp = this.dpts(s);
      if (vary || dp.size) e.data = vals.map((v, j) => ({ value: v, itemStyle: { color: dp.get(j) || (vary ? this.autoColor(j) : color) } }));
      const lab = this.labels(g, s, horizontal && !stacked ? "hbar" : stacked ? "stackbar" : "bar", fmt);
      this.tip(e, lab, fmt, valFmt, percent);
      if (lab) { e.label = lab; if (percent) this.percentLabels(e, lab, orig, fmt); }
      this.option.series.push(e);
      this.barDim.set(e, cdim);
      this.applyLabelFmt(e);
      let centers: (number | null)[] = vals.slice();
      if (stacked) centers = vals.map((v, j) => {
        if (!isNum(v) || j >= accP.length) return v;
        if (v >= 0) { accP[j] += v; return accP[j]; }
        accN[j] += v; return accN[j];
      });
      const idx = vals.map((_, j) => j);
      this.errBars(s, e, idx, vals, centers, "cat", horizontal);
      this.trendlines(s, e, idx.map((j) => j + 1), vals, color, true);
    });
  }
  marker(s: El, groupDefault: boolean, i: number): [string, number, string | null] | null {
    const m = s.find(C + "marker"); const sym = _v(m, C + "symbol", null);
    if (sym === "none") return null;
    if (sym === null && !groupDefault) return null;
    const size = _v(m, C + "size", 5, "int");
    const shape = sym === null || sym === "auto" ? (this.modern ? "circle" : LEGACY_MARKERS[_v(s, C + "idx", i, "int") % LEGACY_MARKERS.length]) : (SYMBOLS[sym] ?? "circle");
    let col = m ? fillColor(m.find(C + "spPr"), this.theme) : null;
    if (m && noFill(m.find(C + "spPr")) && lineProps(m.find(C + "spPr"), this.theme)[2]) col = "transparent";
    return [shape, pyRound(size * 4 / 3 + 1, 1), col];
  }
  g_lineChart(g: El, sers: El[], area = false) {
    const grouping = _v(g, C + "grouping", "standard");
    const [catId, valId] = this.catValAxes(g);
    const [labels, dates, tag] = this.categories(sers, catId);
    const valsAll = sers.map((s) => this.values(s));
    const valFmt = valsAll.find(([, f]) => f)?.[1] ?? null;
    const percent = grouping === "percentStacked";
    let useTime = false;
    if (dates && tag === "dateAx") {
      const ds = dates.filter((d) => d !== null) as number[];
      const steps = new Set<number>(); for (let k = 0; k + 1 < ds.length; k++) steps.add(pyRound(ds[k + 1] - ds[k], 6));
      useTime = steps.size > 1;
    }
    let ci: number;
    if (useTime) {
      let catFmt: string | null = null;
      const cent = this.axes.get(catId); const cnf = cent ? cent[1].find(C + "numFmt") : null;
      if (cnf && (cnf.get("sourceLinked") === "0" || cnf.get("sourceLinked") === "false") && cnf.get("formatCode")) catFmt = cnf.get("formatCode")!;
      else {
        for (const s of sers) { catFmt = this.readData(s.find(C + "cat"))[1]; if (catFmt) break; }
        if (!isDateFormat(catFmt)) catFmt = null;
      }
      ci = this.axisFor(catId, "x", "time", { catFmt: catFmt || "yyyy-mm-dd" });
    } else ci = this.axisFor(catId, "x", "category", { categories: labels, boundaryGap: !area });
    const vi = this.axisFor(valId, "y", "value", { valFmt, percent });
    const groupMarker = area ? false : _bool(g, C + "marker", !area);
    const stacked = grouping === "stacked" || grouping === "percentStacked";
    const totals = percent ? this.percentTotals(valsAll, labels.length) : null;
    const stackId = `stack${this.option.series.length}`;
    const drop = !!g.find(C + "dropLines");
    sers.forEach((s, i) => {
      let [vals, fmt] = valsAll[i];
      const orig = vals;
      if (percent) vals = vals.map((v, j) => (v === null || !totals![j] ? null : pyRound(v / totals![j] * 100, 6)));
      const data = useTime ? dates!.slice(0, vals.length).map((d, k) => [d !== null ? isoLocal(serialToDate(d, this.wb.date1904)) : null, vals[k]]) : vals;
      const e: Obj = { name: this.seriesName(s, i), type: "line", data, xAxisIndex: ci, yAxisIndex: vi };
      if (area) {
        const color = this.seriesColor(s);
        const [lc, w, nol] = lineProps(s.find(C + "spPr"), this.theme);
        e.areaStyle = { color, opacity: 1 };
        e.lineStyle = { width: nol || !lc ? 0 : w || 1, color: lc || color };
        e.itemStyle = { color }; e.showSymbol = false; e.symbol = "none";
      } else {
        const [color, w, nol, dash] = this.seriesLine(s);
        e.itemStyle = { color };
        const ls: Obj = { color, width: w || (this.modern ? 2.25 * 4 / 3 : 2.67) };
        if (dash) ls.type = dash;
        if (nol) ls.width = 0;
        e.lineStyle = ls;
        const mk = this.marker(s, groupMarker, i);
        if (mk) { e.symbol = mk[0]; e.symbolSize = mk[1]; e.showSymbol = true; if (mk[2]) e.itemStyle.color = mk[2]; }
        else { e.showSymbol = false; e.symbol = "none"; }
        if (_bool(s, C + "smooth", false)) e.smooth = true;
      }
      if (stacked) e.stack = stackId;
      if (this.dispBlanks === "span") e.connectNulls = true;
      const lab = this.labels(g, s, "line", fmt);
      this.tip(e, lab, fmt, valFmt, percent);
      if (lab) { if (useTime) { const tcode = lab._fmt; delete lab._fmt; lab.formatter = lab.formatter.split("{c}").join("{@[1]}"); if (tcode) this.fmtHook(`series.${this.option.series.length}.label`, tcode); } e.label = lab; if (percent && !useTime) this.percentLabels(e, lab, orig, fmt); }
      if (drop) e.markLine = { silent: true, symbol: "none", data: [] };
      this.option.series.push(e);
      if (!useTime) this.applyLabelFmt(e);
      const xs: any[] = useTime ? (data as any[]).map((d) => d[0]) : vals.map((_, j) => j);
      let centers: (number | null)[] = vals.slice();
      if (stacked) { let acc = 0; centers = vals.map((v) => { if (isNum(v)) { acc += v; return acc; } return v; }); }
      this.errBars(s, e, xs, vals, centers, "cat");
      if (!useTime) this.trendlines(s, e, vals.map((_, j) => j + 1), vals, e.itemStyle.color, true);
    });
  }
  g_areaChart(g: El, sers: El[]) { this.g_lineChart(g, sers, true); }
  g_pieChart(g: El, sers: El[], hole: number | null = null) {
    this.pieLike = true;
    if (!sers.length) return;
    const s0 = sers[0];
    if (sers.length > 1 && hole === null) { this.warnings.push("pie chart with several series: Excel only draws the first one"); sers = sers.slice(0, 1); }
    const [labels] = this.categories([s0], null);
    const first = _v(g, C + "firstSliceAng", 0, "int");
    const vary = _bool(g, C + "varyColors", true);
    const nRings = hole !== null ? sers.length : 1;
    const outer = 75, inner0 = outer * (hole || 0) / 100, ringW = (outer - inner0) / nRings;
    sers.slice(0, nRings).forEach((s, ri) => {
      const [vals, fmt] = this.values(s);
      const dp = this.dpts(s); const base = this.seriesColor(s);
      const data = vals.map((v, j) => {
        const c = dp.get(j) || (vary ? this.autoColor(j) : base);
        const item: Obj = { name: j < labels.length ? labels[j] : String(j + 1), value: v, itemStyle: { color: c } };
        let expl: number | null = null;
        for (const d of s.findall(C + "dPt")) if (_v(d, C + "idx", -1, "int") === j) expl = _v(d, C + "explosion", null, "int");
        if (expl) item.selected = true;
        return item;
      });
      const rIn = inner0 + ringW * ri, rOut = inner0 + ringW * (ri + 1);
      const e: Obj = { name: this.seriesName(s, ri), type: "pie", data, radius: hole ? [pct(rIn), pct(rOut)] : `${outer}%`,
        center: ["50%", "title" in this.option || this.chartEl.find(C + "title") ? "55%" : "50%"], startAngle: 90 - first, clockwise: true,
        itemStyle: { borderColor: "#FFFFFF", borderWidth: 1 } };
      if (data.some((d) => d.selected)) { e.selectedMode = "multiple"; e.selectedOffset = 12; }
      const expl = _v(s, C + "explosion", null, "int");
      if (expl) { e.selectedMode = "multiple"; e.selectedOffset = 12; for (const d of data) d.selected = true; }
      const lab = this.labels(g, s, "pie", fmt);
      this.tip(e, lab, fmt, null, false);
      if (lab) {
        if (lab.position === "inside") lab.color = lab.color !== "#595959" ? lab.color : "#404040";
        e.label = lab;
        const sd = s.find(C + "dLbls");
        e.labelLine = { show: lab.position === "outside" && _bool(sd && sd.length ? sd : g.find(C + "dLbls"), C + "showLeaderLines", true) };
      } else { e.label = { show: false }; e.labelLine = { show: false }; }
      this.option.series.push(e);
      this.applyLabelFmt(e);
    });
  }
  g_doughnutChart(g: El, sers: El[]) { this.g_pieChart(g, sers, Math.max(1, _v(g, C + "holeSize", 10, "int"))); }
  g_scatterChart(g: El, sers: El[], bubble = false) {
    const style = _v(g, C + "scatterStyle", "marker");
    const [xId, yId] = this.catValAxes(g);
    const xfmt0 = sers.map((s) => this.readData(s.find(C + "xVal"))[1]).find((f) => f) ?? null;
    const xi = this.axisFor(xId, "x", "value", { valFmt: xfmt0 });
    const ys = sers.map((s) => this.values(s, "yVal"));
    const yi = this.axisFor(yId, "y", "value", { valFmt: ys.find(([, f]) => f)?.[1] ?? null });
    let allSizes: number[] = [];
    if (bubble) for (const s of sers) allSizes.push(...(this.values(s, "bubbleSize")[0].filter(isNum) as number[]));
    const smax = Math.max(...allSizes.map(Math.abs), 1);
    const scale = _v(g, C + "bubbleScale", 100, "int") / 100;
    sers.forEach((s, i) => {
      const [yv, fmt] = ys[i];
      let [xv, , xtext] = this.readData(s.find(C + "xVal"));
      if (!xv.length || xtext) xv = Array.from({ length: yv.length }, (_, k) => k + 1);
      const data = xv.slice(0, yv.length).map((x, k) => [x, yv[k]]);
      const [color, w, nol, dash] = this.seriesLine(s);
      const fill = fillColor(s.find(C + "spPr"), this.theme);
      const e: Obj = { name: this.seriesName(s, i), xAxisIndex: xi, yAxisIndex: yi };
      if (bubble) {
        const sz = this.values(s, "bubbleSize")[0];
        const pts = data.slice(0, sz.length).map(([x, y], k) => {
          const b = sz[k] || 0;
          const r = _v(g, C + "sizeRepresents", "area") === "area" ? Math.sqrt(Math.abs(b) / smax) * 60 * scale : Math.abs(b) / smax * 60 * scale;
          return { value: [x, y, b], symbolSize: pyRound(Math.max(r, 2), 2) };
        });
        Object.assign(e, { type: "scatter", data: pts, itemStyle: { color: fill || this.autoColor(_v(s, C + "idx", i, "int")), opacity: 0.85, borderColor: "#FFFFFF", borderWidth: 0.5 } });
      } else {
        const showLine = ["line", "smooth", "lineMarker", "smoothMarker"].includes(style) && !nol;
        const mk = this.marker(s, !(style === "line" || style === "smooth"), i);
        if (showLine) {
          Object.assign(e, { type: "line", data, lineStyle: { color, width: w || 2.67, ...(dash ? { type: dash } : {}) }, itemStyle: { color } });
          if (mk) { Object.assign(e, { symbol: mk[0], symbolSize: mk[1], showSymbol: true }); if (mk[2]) e.itemStyle.color = mk[2]; }
          else Object.assign(e, { symbol: "none", showSymbol: false });
          if (_bool(s, C + "smooth", style.startsWith("smooth"))) e.smooth = true;
        } else {
          const [shape, size, mcol] = mk || ["circle", 8, null];
          Object.assign(e, { type: "scatter", data, symbol: shape, symbolSize: size, itemStyle: { color: mcol || fill || this.autoColor(_v(s, C + "idx", i, "int")) } });
        }
      }
      const lab = this.labels(g, s, "scatter", fmt);
      if (lab) {
        const rng = lab._range; delete lab._range;
        if (rng !== undefined && !bubble) e.data = e.data.map((p: any, k: number) => ({ name: k < rng.length && rng[k] !== null ? rng[k] : "", value: p }));
        e.label = lab;
      }
      const xcode = this.dateAxes.get(`x${xi}`);
      if (xcode) this.tipFmt.set(e, ["date", xcode]);
      const tl = s.find(C + "trendline");
      if (tl && _v(tl, C + "trendlineType", null) === "linear") e.markLine = this.trend(data as any, color);
      this.option.series.push(e);
      const xs_ = data.map((p) => p[0]), ys_ = data.map((p) => p[1]);
      this.errBars(s, e, xs_, ys_, ys_, "xy");
      this.trendlines(s, e, xs_, ys_, color, false);
    });
  }
  trend(data: [any, any][], color: string) {
    const pts = data.filter(([x, y]) => isNum(x) && isNum(y)) as [number, number][];
    if (pts.length < 2) return null;
    const n = pts.length; let sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (const p of pts) sx += p[0]; for (const p of pts) sy += p[1]; for (const p of pts) sxx += p[0] ** 2; for (const p of pts) sxy += p[0] * p[1];
    const den = n * sxx - sx * sx; if (!den) return null;
    const k = (n * sxy - sx * sy) / den, b = (sy - k * sx) / n;
    const x0 = Math.min(...pts.map((p) => p[0])), x1 = Math.max(...pts.map((p) => p[0]));
    return { silent: true, symbol: "none", lineStyle: { color, type: "dashed" }, data: [[{ coord: [x0, sig(k * x0 + b)] }, { coord: [x1, sig(k * x1 + b)] }]] };
  }
  errBars(s: El, parent: Obj, xs: any[], vals: any[], centers: any[], mode: string, horizontal = false) {
    for (const eb of s.findall(C + "errBars")) {
      let d = _v(eb, C + "errDir", "y");
      if (mode === "cat") d = horizontal ? "x" : "y";
      let base: any[], cen: any[];
      if (mode === "cat") { base = vals; cen = centers; } else if (d === "x") { base = xs; cen = xs; } else { base = vals; cen = vals; }
      const amts = this.errAmounts(eb, base);
      if (!amts) continue;
      const [mList, pList, meanC] = amts;
      const data: any[] = [];
      for (let j = 0; j < base.length; j++) {
        let c = j < cen.length ? cen[j] : null;
        if (j >= xs.length) continue;
        if (!isNum(c) || !isNum(base[j])) continue;
        if (meanC !== null) c = meanC;
        const lo = sig(c - mList[j]), hi = sig(c + pList[j]);
        data.push(mode === "cat" ? (horizontal ? [sig(c), j, lo, hi] : [xs[j], sig(c), lo, hi]) : [xs[j], vals[j], lo, hi]);
      }
      const [col, w] = lineProps(eb.find(C + "spPr"), this.theme);
      const vert = d !== "x";
      const cs: Obj = { name: parent.name, type: "custom", "x-renderItem": "errorBar",
        "x-cfg": { dir: vert ? "v" : "h", cap: !_bool(eb, C + "noEndCap"), color: col || (this.modern ? "#595959" : "#000000"), width: w || 1 },
        xAxisIndex: parent.xAxisIndex ?? 0, yAxisIndex: parent.yAxisIndex ?? 0, data, encode: vert ? { x: [0], y: [1, 2, 3] } : { x: [0, 2, 3], y: [1] },
        z: 5, silent: true, tooltip: { show: false } };
      this.errPending.push([cs, parent.type === "bar" ? parent : null]);
    }
  }
  errAmounts(eb: El, base: any[]): [number[], number[], number | null] | null {
    const typ = _v(eb, C + "errValType", "fixedVal"), bt = _v(eb, C + "errBarType", "both");
    const val = _v(eb, C + "val", typ === "percentage" ? 5.0 : 1.0, "float");
    const nums = base.filter(isNum) as number[];
    const n = base.length;
    let meanC: number | null = null, p: number[], m: number[];
    if (typ === "cust") {
      const [pv] = this.readData(eb.find(C + "plus")), [mv] = this.readData(eb.find(C + "minus"));
      const pick = (arr: Val[], j: number) => { const x = arr.length === 1 ? arr[0] : j < arr.length ? arr[j] : null; return isNum(x) ? x : 0; };
      p = Array.from({ length: n }, (_, j) => pick(pv, j)); m = Array.from({ length: n }, (_, j) => pick(mv, j));
    } else {
      let amt: number[];
      if (typ === "fixedVal") amt = new Array(n).fill(val);
      else if (typ === "percentage") amt = base.map((v) => (isNum(v) ? Math.abs(v) * val / 100 : 0));
      else if (typ === "stdDev" || typ === "stdErr") {
        if (nums.length < 2) return null;
        const sd = stdev(nums);
        if (typ === "stdDev") { amt = new Array(n).fill(val * sd); meanC = mean(nums); }
        else amt = new Array(n).fill(sd / Math.sqrt(nums.length));
      } else { this.warnings.push(`error bar type ${pyrepr(typ)} not supported`); return null; }
      p = amt.slice(); m = amt.slice();
    }
    if (bt === "plus") m = new Array(n).fill(0); else if (bt === "minus") p = new Array(n).fill(0);
    return [m, p, meanC];
  }
  finalizeErrbars() {
    const series: Obj[] = this.option.series;
    for (const [cs, bar] of this.errPending) {
      if (bar) {
        const cdim = this.barDim.get(bar) ?? "x", keyAx = cdim + "AxisIndex";
        const same = series.filter((b) => b.type === "bar" && this.barDim.get(b) === cdim && (b[keyAx] ?? 0) === (bar[keyAx] ?? 0));
        const keys: string[] = []; let catGap = "20%", gap = "30%";
        for (const b of same) {
          const k = b.stack || `#${series.indexOf(b)}`;
          if (!keys.includes(k)) keys.push(k);
          if (b.barCategoryGap != null) catGap = b.barCategoryGap;
          if (b.barGap != null) gap = b.barGap;
        }
        const mykey = bar.stack || `#${series.indexOf(bar)}`;
        cs["x-cfg"].bar = { slot: keys.indexOf(mykey), slots: keys.length, catGap: parseFloat(catGap) / 100, gap: parseFloat(gap) / 100 };
      }
      series.push(cs);
    }
  }
  trendlines(s: El, parent: Obj, xs: any[], ys: any[], color: string, category: boolean) {
    const sname = parent.name;
    const LABELS: Obj = { linear: "Linear", exp: "Expon.", log: "Log.", poly: "Poly.", power: "Power", movingAvg: "Mov. Avg." };
    for (const tl of s.findall(C + "trendline")) {
      const typ = _v(tl, C + "trendlineType", "linear");
      if (!category && typ === "linear") continue;
      const label = LABELS[typ];
      if (label === undefined) { this.warnings.push(`trendline type ${pyrepr(typ)} not supported`); continue; }
      const period = _v(tl, C + "period", 2, "int"), order = _v(tl, C + "order", 2, "int");
      let nm = tl.findtext(C + "name");
      if (!nm) nm = typ === "movingAvg" ? `${period} per. ${label} (${sname})` : `${label} (${sname})`;
      if (_bool(tl, C + "dispEq") || _bool(tl, C + "dispRSqr")) this.warnings.push("trendline equation / R² label is not rendered");
      const pts: [number, number][] = [];
      for (let j = 0; j < Math.min(xs.length, ys.length); j++) if (isNum(xs[j]) && isNum(ys[j])) pts.push([xs[j], ys[j]]);
      let data: any[];
      if (typ === "movingAvg") {
        if (category) {
          data = ys.map((_, j) => {
            const win = j >= period - 1 ? ys.slice(j - period + 1, j + 1) : [];
            const ok = win.length === period && win.every(isNum);
            return ok ? sig(fsum(win) / period) : null;
          });
        } else {
          data = [];
          for (let j = period - 1; j < pts.length; j++) data.push([sig(pts[j][0]), sig(fsum(pts.slice(j - period + 1, j + 1).map((p) => p[1])) / period)]);
        }
      } else {
        const f = this.trendFn(typ, pts, order, _v(tl, C + "intercept", null, "float"));
        if (!f) { this.warnings.push(`${nm}: cannot fit ${typ} trendline to this data`); continue; }
        if (category) data = ys.map((_, j) => sig(f(j + 1)));
        else {
          let x0 = Math.min(...pts.map((p) => p[0])) - _v(tl, C + "backward", 0, "float");
          const x1 = Math.max(...pts.map((p) => p[0])) + _v(tl, C + "forward", 0, "float");
          if ((typ === "log" || typ === "power") && x0 <= 0) x0 = Math.min(...pts.map((p) => p[0]));
          const steps = typ === "linear" ? 1 : 40;
          data = [];
          for (let i = 0; i <= steps; i++) { const x = x0 + (x1 - x0) * i / steps; data.push([sig(x), sig(f(x))]); }
        }
      }
      const [lc, w, , dash] = lineProps(tl.find(C + "spPr"), this.theme);
      const ls = { color: lc || color, width: w || 2, type: dash || (this.modern ? "dotted" : "solid") };
      const e: Obj = { name: nm, type: "line", data, xAxisIndex: parent.xAxisIndex ?? 0, yAxisIndex: parent.yAxisIndex ?? 0, symbol: "none", showSymbol: false,
        smooth: typ !== "linear" && typ !== "movingAvg" && category, lineStyle: ls, itemStyle: { color: lc || color }, silent: true, z: 4, tooltip: { show: false } };
      if (typ === "movingAvg" || category) e.connectNulls = false;
      this.trendPending.push(e);
    }
  }
  trendFn(typ: string, pts: [number, number][], order: number, intercept: number | null): ((x: number) => number) | null {
    if (pts.length < 2) return null;
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    if (typ === "linear") {
      if (intercept !== null) {
        let sxx = 0, sxy = 0;
        for (let i = 0; i < xs.length; i++) { sxx += xs[i] * xs[i]; sxy += xs[i] * (ys[i] - intercept); }
        if (!sxx) return null;
        const k = sxy / sxx; return (x) => k * x + intercept;
      }
      const r = linreg(xs, ys); if (!r) return null;
      const [k, b] = r; return (x) => k * x + b;
    }
    if (typ === "exp") {
      if (ys.some((y) => y <= 0)) return null;
      const r = linreg(xs, ys.map((y) => Math.log(y))); if (!r) return null;
      const [k, b] = r, a = Math.exp(b); return (x) => a * Math.exp(k * x);
    }
    if (typ === "log") {
      if (xs.some((x) => x <= 0)) return null;
      const r = linreg(xs.map((x) => Math.log(x)), ys); if (!r) return null;
      const [k, b] = r; return (x) => k * Math.log(x) + b;
    }
    if (typ === "power") {
      if (xs.some((x) => x <= 0) || ys.some((y) => y <= 0)) return null;
      const r = linreg(xs.map((x) => Math.log(x)), ys.map((y) => Math.log(y))); if (!r) return null;
      const [k, b] = r, a = Math.exp(b); return (x) => a * x ** k;
    }
    if (typ === "poly") {
      const coef = polyfit(xs, ys, Math.max(2, Math.min(6, order))); if (!coef) return null;
      return (x) => polyval(coef, x);
    }
    return null;
  }
  g_bubbleChart(g: El, sers: El[]) { this.g_scatterChart(g, sers, true); }
  g_radarChart(g: El, sers: El[]) {
    const style = _v(g, C + "radarStyle", "marker");
    const [catId, valId] = this.catValAxes(g);
    const [labels] = this.categories(sers, catId);
    const valsAll = sers.map((s) => this.values(s));
    const ent = this.axes.get(valId); const ax = ent ? ent[1] : null;
    const sc = ax ? ax.find(C + "scaling") : null;
    let mx = _v(sc, C + "max", null, "float"), mn = _v(sc, C + "min", null, "float");
    const allv = valsAll.flatMap(([v]) => v.filter(isNum) as number[]);
    if (mx === null) mx = niceMax(Math.max(...allv, 1));
    if (mn === null) mn = Math.min(0, Math.min(...allv, 0));
    const font = this.font(null, this.baseFont.fontSize * 3 / 4);
    this.option.radar = { indicator: labels.map((l) => ({ name: l, max: mx, min: mn })), radius: "65%", center: ["50%", "55%"], shape: "polygon", splitNumber: 5,
      axisName: { color: font.color, fontSize: font.fontSize }, splitArea: { show: false }, splitLine: { show: true, lineStyle: { color: "#D9D9D9" } }, axisLine: { lineStyle: { color: "#D9D9D9" } } };
    const data = sers.map((s, i) => {
      const [vals, fmt] = valsAll[i];
      const [color, w] = this.seriesLine(s);
      const fill = fillColor(s.find(C + "spPr"), this.theme) || color;
      const d: Obj = { name: this.seriesName(s, i), value: vals, itemStyle: { color }, lineStyle: { color, width: w || 2.67 } };
      if (style === "filled") { d.areaStyle = { color: fill, opacity: sers.length === 1 ? 1 : 0.6 }; d.itemStyle = { color: fill }; d.symbol = "none"; }
      else { const mk = this.marker(s, style === "marker", i); if (mk) { d.symbol = mk[0]; d.symbolSize = mk[1]; } else d.symbol = "none"; }
      const lab = this.labels(g, s, "line", fmt);
      if (lab) d.label = lab;
      return d;
    });
    this.option.series.push({ type: "radar", data });
  }
  g_stockChart(g: El, sers: El[]) { this.warnings.push("stockChart rendered as line series"); this.g_lineChart(g, sers); }
  legend(lg: El | null) {
    if (!lg) { this.option.legend = { show: false }; return; }
    const pos = _v(lg, C + "legendPos", "r");
    const font = this.font(lg.find(C + "txPr"), this.baseFont.fontSize * 3 / 4);
    const e: Obj = { show: true, _pos: pos, textStyle: { color: font.color, fontSize: font.fontSize }, itemWidth: this.pieLike || !this.hasLine() ? 10 : 20, itemHeight: 10 };
    if (pos === "r" || pos === "l") Object.assign(e, { orient: "vertical", top: "middle", ...(pos === "r" ? { right: 10 } : { left: 10 }) });
    else if (pos === "tr") Object.assign(e, { orient: "vertical", top: 40, right: 10 });
    else if (pos === "t") Object.assign(e, { orient: "horizontal", top: this.option.title || this.chartEl.find(C + "title") ? 40 : 8, left: "center" });
    else Object.assign(e, { orient: "horizontal", bottom: 8, left: "center" });
    const mxy = manualXY(lg);
    if (mxy) { for (const k of ["left", "right", "top", "bottom"]) delete e[k]; [e.left, e.top] = mxy; }
    const deleted = new Set(lg.findall(C + "legendEntry").filter((le) => _bool(le, C + "delete")).map((le) => _v(le, C + "idx", -1, "int")));
    if (deleted.size) {
      let names: string[] = [];
      if (this.pieLike) names = this.option.series.length ? this.option.series[0].data.map((d: Obj) => d.name) : [];
      else for (const s of this.option.series) { if (s.type === "radar") names.push(...s.data.map((d: Obj) => d.name)); else names.push(s.name); }
      e.data = names.filter((_, i) => !deleted.has(i));
    }
    this.option.legend = e;
  }
  hasLine() { return this.option.series.some((s: Obj) => s.type === "line" && !("areaStyle" in s)); }
}

function xOccupied(lst: Obj[]) { return lst.some((a) => a.position !== "top" && (a.axisLabel.show || a.axisLine.show)); }
function manualXY(el: El | null): [string, string] | null {
  const ml = el ? el.find(`${C}layout/${C}manualLayout`) : null;
  if (!ml || _v(ml, C + "xMode", "factor") !== "edge" || _v(ml, C + "yMode", "factor") !== "edge") return null;
  const x = _v(ml, C + "x", null, "float"), y = _v(ml, C + "y", null, "float");
  if (x === null || y === null) return null;
  return [`${jnum(pyRound(x * 100, 2))}%`, `${jnum(pyRound(y * 100, 2))}%`];
}
function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (v <= m * p) return m * p;
  return 10 * p;
}
function pyrepr(s: string) { return s.includes("'") && !s.includes('"') ? `"${s}"` : `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`; }

function anchor(sheet: Sheet, anc: El): [string | null, number, number] {
  const tag = local(anc.tag); const fr = anc.find(XDR + "from"), to = anc.find(XDR + "to");
  const pos = (el: El) => [parseInt(el.findtext(XDR + "col")!, 10), parseInt(el.findtext(XDR + "colOff") || "0", 10), parseInt(el.findtext(XDR + "row")!, 10), parseInt(el.findtext(XDR + "rowOff") || "0", 10)];
  if (tag === "twoCellAnchor" && fr && to) {
    const [c1, co1, r1, ro1] = pos(fr), [c2, co2, r2, ro2] = pos(to);
    let w = 0; for (let c = c1; c < c2; c++) w += sheet.colPx(c + 1); w = w - co1 / EMU_PX + co2 / EMU_PX;
    let h = 0; for (let r = r1; r < r2; r++) h += sheet.rowPx(r + 1); h = h - ro1 / EMU_PX + ro2 / EMU_PX;
    return [`${num2col(c1 + 1)}${r1 + 1}:${num2col(c2 + 1)}${r2 + 1}`, pyRound(w), pyRound(h)];
  }
  const ext = anc.find(XDR + "ext");
  const w = ext ? parseInt(ext.get("cx")!, 10) / EMU_PX : 480, h = ext ? parseInt(ext.get("cy")!, 10) / EMU_PX : 288;
  if (fr) { const [c1, , r1] = pos(fr); return [`${num2col(c1 + 1)}${r1 + 1}`, pyRound(w), pyRound(h)]; }
  return [null, pyRound(w), pyRound(h)];
}

const MC = "{http://schemas.openxmlformats.org/markup-compatibility/2006}";
/** drawing anchors; anchors wrapped in mc:AlternateContent use the mc:Choice branch */
function anchors(droot: El): El[] {
  const out: El[] = [];
  for (const a of droot.children) {
    if (a.tag === MC + "AlternateContent") { const ch = a.find(MC + "Choice") ?? a.find(MC + "Fallback"); if (ch) out.push(...ch.children); }
    else out.push(a);
  }
  return out;
}
function one(wb: Workbook, cpart: string, sheet: string | null, anc: string | null, w: number, h: number, name: string | null, excelCompat: boolean, ex = false): ChartResult {
  const id = cpart.slice(cpart.lastIndexOf("/") + 1).replace(/\.[^.]*$/, "");
  try {
    const cv = new ChartConverter(wb, cpart, excelCompat);
    const r = ex ? new ChartEx(cv).convert() : cv.convert();
    return { id, part: cpart, sheet, anchor: anc, name, title: r.option?.title?.text ?? null, width: Math.max(w, 200), height: Math.max(h, 150), types: r.types, usedFormulaFallback: cv.usedFormulaFallback, warnings: r.warnings, option: r.option };
  } catch (e: any) {
    return { id, part: cpart, sheet, anchor: anc, name, title: null, width: w, height: h, types: [], warnings: [`conversion failed: ${e?.message ?? e}`], option: null };
  }
}

export type Input = Uint8Array | ArrayBuffer | Blob | string;

async function toBytes(src: Input): Promise<Uint8Array> {
  if (src instanceof Uint8Array) return src;
  if (src instanceof ArrayBuffer) return new Uint8Array(src);
  if (typeof Blob !== "undefined" && src instanceof Blob) return new Uint8Array(await src.arrayBuffer());
  if (typeof src === "string") { const fs: any = await import(/* webpackIgnore: true */ "node:fs/promises" as any); return new Uint8Array(await fs.readFile(src)); }
  throw new TypeError("convertXlsx: expected path, Uint8Array, ArrayBuffer or Blob");
}

/** Convert every native chart of an .xlsx/.xlsm into ECharts options. */
export async function convertXlsx(src: Input, opts: { excelCompat?: boolean; geojson?: any } = {}): Promise<ConvertResult> {
  const excelCompat = opts.excelCompat ?? true;
  const wb = await Workbook.open(await toBytes(src));
  (wb as any).geojson = typeof opts.geojson === "string" ? JSON.parse(opts.geojson) : opts.geojson ?? null;
  const charts: ChartResult[] = [], warnings: string[] = [], seen = new Set<string>();
  for (const sh of wb.sheetOrder) {
    for (const [, [dpart, typ]] of wb.rels(sh.part)) {
      if (typ !== "drawing" || !wb.names.includes(dpart)) continue;
      const droot = wb.xml(dpart), drels = wb.rels(dpart);
      for (const anc of anchors(droot)) {
        for (const gf of anc.iter(`{${NS.c}}chart`)) {
          const crid = gf.get(R_ID)!;
          if (!drels.has(crid)) continue;
          const cpart = drels.get(crid)![0]; seen.add(cpart);
          const nameEl = anc.find(`.//${XDR}cNvPr`);
          let a: string | null, w: number, h: number;
          if (sh.kind === "chartsheet") { a = null; w = 900; h = 560; }
          else { if (sh.kind === "worksheet") sh.cells; [a, w, h] = anchor(sh, anc); }
          charts.push(one(wb, cpart, sh.name, a, w, h, nameEl ? nameEl.get("name") ?? null : null, excelCompat));
        }
        for (const gf of anc.iter(`{${CXNS}}chart`)) {
          const crid = gf.get(R_ID)!;
          if (!drels.has(crid)) continue;
          const cpart = drels.get(crid)![0]; seen.add(cpart);
          const nameEl = anc.find(`.//${XDR}cNvPr`);
          let a: string | null, w: number, h: number;
          if (sh.kind === "chartsheet") { a = null; w = 900; h = 560; }
          else { if (sh.kind === "worksheet") sh.cells; [a, w, h] = anchor(sh, anc); }
          charts.push(one(wb, cpart, sh.name, a, w, h, nameEl ? nameEl.get("name") ?? null : null, excelCompat, true));
        }
      }
    }
  }
  for (const name of wb.names) if (/^xl\/charts\/chart(Ex)?\d+\.xml$/.test(name) && !seen.has(name)) charts.push(one(wb, name, null, null, 600, 360, null, excelCompat, name.includes("chartEx")));
  charts.forEach((c, i) => (c.index = i));
  if (wb.failedFormulas.length) warnings.push(`${wb.failedFormulas.length} formula(s) could not be evaluated: ` + wb.failedFormulas.slice(0, 5).join("; "));
  return { charts, warnings, sheets: wb.sheetOrder.map((s) => s.name), evaluatedFormulas: wb.evaluatedFormulas };
}
