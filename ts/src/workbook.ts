/** Minimal SpreadsheetML reader (port of xlsx2echarts/workbook.py — keep in sync). */
import { El, parseXML } from "./xml.js";
import { Evaluator, FormulaError, Val, col2num, num2col, shiftFormula } from "./formula.js";
import { openZip } from "./zip.js";

export const NS = {
  m: "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
  r: "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
  pr: "http://schemas.openxmlformats.org/package/2006/relationships",
  a: "http://schemas.openxmlformats.org/drawingml/2006/main",
  c: "http://schemas.openxmlformats.org/drawingml/2006/chart",
  xdr: "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing",
};
export const R_ID = `{${NS.r}}id`;
const M = `{${NS.m}}`;

const BUILTIN_FMT: Record<number, string> = {
  0: "General", 1: "0", 2: "0.00", 3: "#,##0", 4: "#,##0.00", 9: "0%", 10: "0.00%", 11: "0.00E+00", 14: "yyyy/m/d", 15: "d-mmm-yy",
  16: "d-mmm", 17: "mmm-yy", 18: "h:mm AM/PM", 19: "h:mm:ss AM/PM", 20: "h:mm", 21: "h:mm:ss", 22: "yyyy/m/d h:mm",
  37: "#,##0 ;(#,##0)", 38: "#,##0 ;[Red](#,##0)", 39: "#,##0.00;(#,##0.00)", 40: "#,##0.00;[Red](#,##0.00)", 45: "mm:ss",
  46: "[h]:mm:ss", 47: "mmss.0", 48: "##0.0E+0", 49: "@",
  27: 'yyyy"年"m"月"', 28: 'm"月"d"日"', 29: 'm"月"d"日"', 30: "m-d-yy", 31: 'yyyy"年"m"月"d"日"', 32: 'h"时"mm"分"',
  33: 'h"时"mm"分"ss"秒"', 34: '上午/下午h"时"mm"分"', 35: '上午/下午h"时"mm"分"ss"秒"', 36: 'yyyy"年"m"月"',
  50: 'yyyy"年"m"月"', 51: 'm"月"d"日"', 52: 'yyyy"年"m"月"', 53: 'm"月"d"日"', 56: '上午/下午h"时"mm"分"ss"秒"',
  57: 'yyyy"年"m"月"', 58: 'm"月"d"日"',
};

export function jnum(x: number): string { return String(x); }
export function jstr(v: Val): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  return String(v);
}

export function isDateFormat(code: string | null | undefined): boolean {
  if (!code || code === "General") return false;
  const s = code.split(";")[0].replace(/"[^"]*"|\\.|\[(?!h\]|m\]|s\])[^\]]*\]/g, "");
  return /[dmyhs]/i.test(s) && !/[0#?]/.test(s);
}
export function serialToDate(v: number, date1904 = false): Date {
  const base = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  if (!date1904 && v < 60) v += 1;
  return new Date(base + Math.round(v * 86400000000) / 1000);
}
const pad = (n: number) => (n < 10 ? "0" : "") + n;
const WD = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MO = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export function isoLocal(d: Date) {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

export function formatDate(v: number, code: string, date1904 = false): string {
  const d = serialToDate(v, date1904);
  const c = (code || "").split(";")[0].replace(/\[[^\]]*\]/g, "");
  const noq = c.replace(/"[^"]*"/g, "");
  const hasTime = /h|s/i.test(noq);
  const hasDate = /[dy]/i.test(noq) || (c.toLowerCase().includes("m") && !hasTime);
  const out: string[] = []; let i = 0, prevH = false; const lc = c;
  while (i < lc.length) {
    const ch = lc[i];
    if (ch === '"') { let j = lc.indexOf('"', i + 1); if (j < 0) j = lc.length; out.push(lc.slice(i + 1, j)); i = j + 1; continue; }
    if (ch === "\\" && i + 1 < lc.length) { out.push(lc[i + 1]); i += 2; continue; }
    const m = /^(y+|m+|d+|h+|s+|AM\/PM|上午\/下午)/i.exec(lc.slice(i));
    if (m) {
      const t = m[0], tl = t.toLowerCase(); i += t.length;
      if (tl[0] === "y") out.push(t.length > 2 ? String(d.getUTCFullYear()) : pad(d.getUTCFullYear() % 100));
      else if (tl[0] === "d") out.push(t.length === 1 ? String(d.getUTCDate()) : t.length === 2 ? pad(d.getUTCDate()) : t.length === 3 ? WD[d.getUTCDay()].slice(0, 3) : WD[d.getUTCDay()]);
      else if (tl[0] === "h") { prevH = true; let h = d.getUTCHours(); if (/AM\/PM|上午\/下午/i.test(lc)) h = h % 12 || 12; out.push(t.length === 1 ? String(h) : pad(h)); }
      else if (tl[0] === "s") out.push(t.length === 1 ? String(d.getUTCSeconds()) : pad(d.getUTCSeconds()));
      else if (tl[0] === "m") {
        const rest = lc.slice(i);
        const minute = prevH || (/^[^dy]*s/i.test(rest) && !/[dy]/i.test(lc.slice(i, i + 3)));
        if (minute && t.length <= 2) out.push(t.length === 1 ? String(d.getUTCMinutes()) : pad(d.getUTCMinutes()));
        else out.push(t.length === 1 ? String(d.getUTCMonth() + 1) : t.length === 2 ? pad(d.getUTCMonth() + 1) : t.length === 3 ? MO[d.getUTCMonth()].slice(0, 3) : MO[d.getUTCMonth()]);
        prevH = false;
      } else if (tl === "am/pm") out.push(d.getUTCHours() < 12 ? "AM" : "PM");
      else out.push(d.getUTCHours() < 12 ? "上午" : "下午");
      continue;
    }
    if (ch !== "_" && ch !== "*") out.push(ch); else i += 1;
    i += 1;
  }
  let s = out.join("").trim();
  if (!s || !(hasDate || hasTime)) {
    const midnight = d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0;
    s = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` + (midnight ? "" : ` ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`);
  }
  return s;
}

/** Excel-style rounding (half away from zero) on the shortest decimal repr — same as the Python port. */
export function fixedHalfUp(x: number, dec: number): string {
  const a = Math.abs(x);
  let r: number;
  const s = String(a);
  if (s.includes("e")) r = Number(a.toFixed(dec));
  else { const [ip, fp = ""] = s.split("."); const digits = ip + fp.padEnd(dec + 1, "0").slice(0, dec + 1);
    let n = BigInt(digits.slice(0, digits.length - 1) || "0"); if (+digits[digits.length - 1] >= 5) n += 1n;
    let t = n.toString().padStart(dec + 1, "0"); return (x < 0 && /[1-9]/.test(t) ? "-" : "") + (dec ? t.slice(0, -dec) + "." + t.slice(-dec) : t); }
  let body = r.toFixed(dec);
  return (x < 0 && /[1-9]/.test(body) ? "-" : "") + body;
}

export function formatNumber(v: Val, code: string | null | undefined): string {
  if (typeof v !== "number") return jstr(v);
  if (!code || code === "General" || code === "@") return Math.abs(v) < 1e15 ? String(Number(v.toFixed(10))) : String(v);
  const sec = code.split(";");
  let c = v < 0 && sec.length > 1 ? sec[1] : sec[0];
  const neg = v < 0 && sec.length > 1;
  c = c.replace(/\[[^\]]*\]|_.|\*.|\\|"/g, "");
  const pct = c.includes("%");
  let x = pct ? v * 100 : v;
  if (neg) x = Math.abs(x);
  const m = /[0#]+(?:[.,][0#]+)*/.exec(c);
  if (!m) return String(v);
  const pat = m[0];
  const dec = pat.includes(".") ? pat.split(".")[1].length : 0;
  let body = fixedHalfUp(x, dec);
  if (pat.split(".")[0].includes(",")) { const p = body.split("."); p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ","); body = p.join("."); }
  return c.slice(0, m.index) + body + c.slice(m.index + pat.length);
}

function normPath(p: string) {
  const out: string[] = [];
  for (const s of p.split("/")) { if (s === "" || s === ".") continue; if (s === "..") out.pop(); else out.push(s); }
  return out.join("/");
}
const dirname = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
const basename = (p: string) => p.slice(p.lastIndexOf("/") + 1);

type Cell = [Val, string | null, number];

export class Sheet {
  private _cells: Map<string, Cell> | null = null;
  colWidths = new Map<number, number>(); rowHeights = new Map<number, number>();
  defaultColWidth = 8.43; defaultRowHeight = 15.0; kind = "worksheet"; state = "visible";
  constructor(public wb: Workbook, public name: string, public part: string) {}
  get cells() { if (!this._cells) this.load(); return this._cells!; }
  private load() {
    this._cells = new Map();
    const root = this.wb.xml(this.part);
    const fmt = root.find(M + "sheetFormatPr");
    if (fmt) {
      if (fmt.get("defaultColWidth")) this.defaultColWidth = parseFloat(fmt.get("defaultColWidth")!);
      else if (fmt.get("baseColWidth")) this.defaultColWidth = parseFloat(fmt.get("baseColWidth")!) + 0.71;
      if (fmt.get("defaultRowHeight")) this.defaultRowHeight = parseFloat(fmt.get("defaultRowHeight")!);
    }
    for (const col of root.iter(M + "col")) {
      if (col.get("width")) for (let i = parseInt(col.get("min")!, 10); i <= Math.min(parseInt(col.get("max")!, 10), 300); i++) this.colWidths.set(i, parseFloat(col.get("width")!));
    }
    const shared = new Map<string, [string, number, number]>();
    const sd = root.find(M + "sheetData");
    if (!sd) return;
    for (const row of sd.findall(M + "row")) {
      let rn = parseInt(row.get("r", "0") || "0", 10) || 0;
      if (row.get("ht")) this.rowHeights.set(rn, parseFloat(row.get("ht")!));
      let cn = 0;
      for (const c of row.findall(M + "c")) {
        const ref = c.get("r");
        if (ref) { const mm = /([A-Z]+)(\d+)/.exec(ref)!; cn = col2num(mm[1]); rn = parseInt(mm[2], 10); } else cn += 1;
        const t = c.get("t", "n")!;
        const s = parseInt(c.get("s", "0") || "0", 10) || 0;
        const ve = c.find(M + "v"), fe = c.find(M + "f");
        let val: Val = null;
        if (t === "inlineStr") {
          const ie = c.find(M + "is");
          val = ie ? [...ie.iter(M + "t")].map((x) => x.text ?? "").join("") : "";
        } else if (ve && ve.text !== null) {
          const txt = ve.text;
          if (t === "s") { const k = Number(txt); val = Number.isInteger(k) && k >= 0 && k < this.wb.sharedStrings.length ? this.wb.sharedStrings[k] : null; }
          else if (t === "str" || t === "e") val = t === "str" ? txt : null;
          else if (t === "b") val = txt === "1";
          else { const x = txt.trim() === "" ? NaN : Number(txt); val = isNaN(x) ? txt : x; }
        }
        let formula: string | null = null;
        if (fe) {
          if (fe.get("t") === "shared" && fe.get("si") !== undefined) {
            const si = fe.get("si")!;
            if (fe.text) { shared.set(si, [fe.text, rn, cn]); formula = fe.text; }
            else if (shared.has(si)) { const [f0, r0, c0] = shared.get(si)!; formula = shiftFormula(f0, rn - r0, cn - c0); }
          } else if (fe.text) formula = fe.text;
        }
        const hasCache = (ve !== null && ve.text !== null) || t === "inlineStr";
        this._cells.set(`${rn},${cn}`, [val, hasCache ? null : formula, s]);
      }
    }
  }
  colPx(c: number) { const w = this.colWidths.get(c) ?? this.defaultColWidth; return w > 0 ? Math.trunc(w * 7 + 5) : 0; }
  rowPx(r: number) { return (this.rowHeights.get(r) ?? this.defaultRowHeight) * 4 / 3; }
}

export class Workbook {
  names: string[] = []; files = new Map<string, string>(); sizes = new Map<string, number>();
  sharedStrings: string[] = []; numfmts: Record<number, string> = {}; xfFmt: number[] = [];
  theme: Record<string, string> = {}; sheets = new Map<string, Sheet>(); sheetOrder: Sheet[] = [];
  date1904 = false; definedNames = new Map<string, string>();
  private evaluating = new Set<string>(); private memo = new Map<string, Val>();
  evaluatedFormulas = 0; failedFormulas: string[] = [];
  private xmlCache = new Map<string, El>();

  static async open(buf: Uint8Array): Promise<Workbook> {
    const wb = new Workbook();
    const z = await openZip(buf);
    wb.names = z.names; wb.files = z.files; wb.sizes = z.sizes;
    wb.sharedStrings = wb.loadSst(); [wb.numfmts, wb.xfFmt] = wb.loadStyles(); wb.theme = wb.loadTheme(); wb.loadWorkbook();
    return wb;
  }
  has(name: string) { return this.files.has(name); }
  xml(part: string): El {
    let e = this.xmlCache.get(part);
    if (!e) { const s = this.files.get(part); if (s === undefined) throw new Error(`missing part ${part}`); e = parseXML(s); if (!part.includes("worksheets/")) this.xmlCache.set(part, e); }
    return e;
  }
  raw(part: string) { return this.files.get(part) ?? ""; }
  rels(part: string): Map<string, [string, string]> {
    const d = dirname(part), b = basename(part);
    const rp = (d ? d + "/" : "") + "_rels/" + b + ".rels";
    const out = new Map<string, [string, string]>();
    if (!this.files.has(rp)) return out;
    for (const rel of this.xml(rp).findall(`{${NS.pr}}Relationship`)) {
      const tgt = rel.get("Target", "")!;
      if (rel.get("TargetMode") === "External") continue;
      const full = tgt.startsWith("/") ? tgt.replace(/^\/+/, "") : normPath((d ? d + "/" : "") + tgt);
      const typ = rel.get("Type", "")!;
      out.set(rel.get("Id")!, [full, typ.slice(typ.lastIndexOf("/") + 1)]);
    }
    return out;
  }
  private loadSst(): string[] {
    const p = "xl/sharedStrings.xml";
    if (!this.files.has(p)) return [];
    const out: string[] = [];
    for (const si of this.xml(p).findall(M + "si")) {
      const skip = new Set<El>();
      for (const rph of si.findall(M + "rPh")) for (const x of rph.iter()) skip.add(x);
      out.push([...si.iter(M + "t")].filter((t) => !skip.has(t)).map((t) => t.text ?? "").join(""));
    }
    return out;
  }
  private loadStyles(): [Record<number, string>, number[]] {
    const fmts: Record<number, string> = { ...BUILTIN_FMT }; let xf: number[] = [];
    const p = "xl/styles.xml";
    if (this.files.has(p)) {
      const root = this.xml(p);
      const nf = root.find(M + "numFmts");
      if (nf) for (const f of nf.findall(M + "numFmt")) fmts[parseInt(f.get("numFmtId")!, 10)] = f.get("formatCode")!;
      const cx = root.find(M + "cellXfs");
      if (cx) xf = cx.findall(M + "xf").map((x) => parseInt(x.get("numFmtId", "0") || "0", 10) || 0);
    }
    return [fmts, xf];
  }
  private loadTheme() {
    const colors: Record<string, string> = { dk1: "000000", lt1: "FFFFFF", dk2: "44546A", lt2: "E7E6E6", accent1: "4472C4", accent2: "ED7D31", accent3: "A5A5A5", accent4: "FFC000", accent5: "5B9BD5", accent6: "70AD47", hlink: "0563C1", folHlink: "954F72" };
    for (const name of this.names) {
      if (/^xl\/theme\/theme\d*\.xml$/.test(name) && this.files.has(name)) {
        const cs = this.xml(name).find(`.//{${NS.a}}clrScheme`);
        if (cs) for (const el of cs.children) {
          const tag = el.tag.slice(el.tag.indexOf("}") + 1);
          for (const sub of el.children) { const v = sub.tag.endsWith("srgbClr") ? sub.get("val") : sub.get("lastClr"); if (v) colors[tag] = v; }
        }
        break;
      }
    }
    return colors;
  }
  private loadWorkbook() {
    const root = this.xml("xl/workbook.xml");
    const rels = this.rels("xl/workbook.xml");
    const pr = root.find(M + "workbookPr");
    if (pr && (pr.get("date1904") === "1" || pr.get("date1904") === "true")) this.date1904 = true;
    for (const s of root.findall(`${M}sheets/${M}sheet`)) {
      const rid = s.get(R_ID)!;
      if (rels.has(rid)) {
        const [part, typ] = rels.get(rid)!;
        const sh = new Sheet(this, s.get("name")!, part); sh.kind = typ; sh.state = s.get("state", "visible")!;
        this.sheets.set(sh.name, sh); this.sheetOrder.push(sh);
      }
    }
    for (const dn of root.findall(`${M}definedNames/${M}definedName`)) if (dn.text && dn.get("localSheetId") === undefined) this.definedNames.set(dn.get("name")!, dn.text);
  }
  numfmt(i: number) { const id = this.xfFmt[i]; return id === undefined ? "General" : (this.numfmts[id] ?? "General"); }
  sheet(name: string): Sheet | undefined {
    if (this.sheets.has(name)) return this.sheets.get(name);
    for (const [k, v] of this.sheets) if (k.toLowerCase() === (name || "").toLowerCase()) return v;
    return undefined;
  }
  value = (sheetName: string, r: number, c: number): Val => {
    const sh = this.sheet(sheetName);
    if (!sh || sh.kind !== "worksheet") return null;
    const cell = sh.cells.get(`${r},${c}`);
    if (!cell) return null;
    const [val, formula] = cell;
    if (formula === null) return val;
    const key = `${sh.name}\u0000${r},${c}`;
    if (this.memo.has(key)) return this.memo.get(key)!;
    if (this.evaluating.has(key) || this.evaluating.size > 200) throw new FormulaError("#CIRC!");
    this.evaluating.add(key);
    let v: Val;
    try { v = new Evaluator(this.value).evaluate(formula, sh.name); this.evaluatedFormulas++; }
    catch (e: any) {
      if (e instanceof RangeError) e = new FormulaError("maximum recursion depth exceeded");
      this.failedFormulas.push(`${sh.name}!${num2col(c)}${r}: =${formula} (${e instanceof FormulaError ? e.message : "#VALUE!"})`);
      v = null;
    } finally { this.evaluating.delete(key); }
    if (typeof v === "number" && !isFinite(v)) v = null;
    this.memo.set(key, v);
    return v;
  };
  style(sheetName: string, r: number, c: number) {
    const sh = this.sheet(sheetName); if (!sh) return "General";
    const cell = sh.cells.get(`${r},${c}`); return cell ? this.numfmt(cell[2]) : "General";
  }
}
