/** Tiny Excel formula evaluator (port of xlsx2echarts/formula.py — keep in sync). */
export class FormulaError extends Error {}
export type Val = number | string | boolean | null | Val[];

const TOKEN = new RegExp(
  "(?<ws>\\s+)" +
  "|(?<str>\"(?:[^\"]|\"\")*\")" +
  "|(?<ref>(?:(?:'(?:[^']|'')+'|[A-Za-z_][\\p{L}\\p{N}_.]*)!)?\\$?[A-Za-z]{1,3}\\$?\\p{Nd}+(?::\\$?[A-Za-z]{1,3}\\$?\\p{Nd}+)?)" +
  "|(?<num>\\p{Nd}+(?:\\.\\p{Nd}*)?(?:[eE][+-]?\\p{Nd}+)?|\\.\\p{Nd}+(?:[eE][+-]?\\p{Nd}+)?)" +
  "|(?<bool>TRUE|FALSE)(?![\\p{L}\\p{N}_(])" +
  "|(?<func>[A-Za-z_][\\p{L}\\p{N}_.]*)\\(" +
  "|(?<op><>|<=|>=|[-+*/^&=<>%])" +
  "|(?<p>[(),;])", "iuy");

export function col2num(s: string) { let n = 0; for (const ch of s.toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64; return n; }
export function num2col(n: number) { let s = ""; while (n) { const r = (n - 1) % 26; n = Math.floor((n - 1) / 26); s = String.fromCharCode(65 + r) + s; } return s; }

const REF1 = /^\$?([A-Za-z]{1,3})\$?(\d+)$/;
export function splitRef(ref: string): [string | null, number, number, number, number] {
  let sheet: string | null = null;
  const k = ref.lastIndexOf("!");
  if (k >= 0) { sheet = ref.slice(0, k); ref = ref.slice(k + 1); if (sheet.startsWith("'")) sheet = sheet.slice(1, -1).replace(/''/g, "'"); }
  const parts = ref.split(":");
  const m1 = REF1.exec(parts[0]), m2 = REF1.exec(parts[parts.length - 1]);
  if (!m1 || !m2) throw new FormulaError(ref);
  const r1 = +m1[2], c1 = col2num(m1[1]), r2 = +m2[2], c2 = col2num(m2[1]);
  return [sheet, Math.min(r1, r2), Math.min(c1, c2), Math.max(r1, r2), Math.max(c1, c2)];
}

type Tok = [string | null, string | null];
export function tokenize(src: string): Tok[] {
  const out: Tok[] = []; let pos = 0;
  while (pos < src.length) {
    TOKEN.lastIndex = pos;
    const m = TOKEN.exec(src);
    if (!m) throw new FormulaError(`cannot parse at ${JSON.stringify(src.slice(pos, pos + 10))}`);
    pos = TOKEN.lastIndex;
    const g = m.groups!; const k = Object.keys(g).find((x) => g[x] !== undefined)!;
    if (k === "ws") continue;
    let v = g[k];
    if (k === "func") { v = v.toUpperCase(); if (v.startsWith("_XLFN.")) v = v.slice(6); }
    out.push([k, v]);
  }
  return out;
}

const isNum = (x: any): x is number => typeof x === "number";
function num(v: Val): number {
  if (v === null || v === "") return 0;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number") return v;
  if (typeof v === "string") { const t = v.trim(); const x = Number(t); if (t !== "" && !isNaN(x)) return x; }
  throw new FormulaError(`#VALUE! ${JSON.stringify(v)}`);
}
function* flat(args: Val[]): Generator<Val> { for (const a of args) { if (Array.isArray(a)) yield* a; else yield a; } }
const numbers = (args: Val[]) => [...flat(args)].filter(isNum) as number[];
export function txt(v: Val): string {
  if (v === null) return "";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  return String(v);
}
const pyEscape = (s: string) => s.replace(/[()[\]{}?*+\-|^$\\.&~# \t\n\r\v\f]/g, "\\$&");

function criteria(c: Val): (v: Val) => boolean {
  if (isNum(c)) return (v) => isNum(v) && v === c;
  const s = c === null ? "" : String(c);
  const m = /^(<>|<=|>=|=|<|>)?([\s\S]*)$/.exec(s)!;
  const op = m[1] || "=", rhs = m[2];
  const t = rhs.trim(); const rn = t !== "" && !isNaN(Number(t)) ? Number(t) : null;
  if (rn !== null) {
    return (v) => {
      if (!isNum(v)) return op === "<>";
      return ({ "=": v === rn, "<>": v !== rn, "<": v < rn, ">": v > rn, "<=": v <= rn, ">=": v >= rn } as any)[op];
    };
  }
  const pat = new RegExp("^" + pyEscape(rhs.toLowerCase()).split("\\*").join(".*").split("\\?").join(".").split("~.*").join("\\*") + "$", "s");
  return (v) => {
    let sv = v === null ? "" : (typeof v === "boolean" ? (v ? "TRUE" : "FALSE") : String(v)).toLowerCase();
    const hit = rhs ? pat.test(sv) : (v === null || v === "");
    if (op === "=") return hit;
    if (op === "<>") return !hit;
    return false;
  };
}
function ifs(pairs: [Val, Val][]): number[] {
  let idx: Set<number> | null = null;
  for (const [rng, crit] of pairs) {
    const f = criteria(crit); const ok = new Set<number>();
    (rng as Val[]).forEach((v, i) => { if (f(v)) ok.add(i); });
    const prev: Set<number> | null = idx; idx = prev === null ? ok : new Set([...prev].filter((x: number) => ok.has(x)));
  }
  return [...(idx ?? [])].sort((a, b) => a - b);
}
function rnd(x: Val, d: Val, mode: number) {
  const xv = num(x), dv = Math.trunc(num(d)); const k = 10 ** dv; const sg = xv >= 0 ? 1 : -1;
  if (mode === 0) return Math.floor(Math.abs(xv) * k + 0.5) / k * sg;
  if (mode > 0) return Math.ceil(Math.abs(xv) * k - 1e-12) / k * sg;
  return Math.floor(Math.abs(xv) * k + 1e-12) / k * sg;
}
function avg(xs: number[]) { if (!xs.length) throw new FormulaError("#DIV/0!"); return xs.reduce((a, b) => a + b, 0) / xs.length; }
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const pairsOf = (p: Val[]) => { const o: [Val, Val][] = []; for (let i = 0; i + 1 < p.length; i += 2) o.push([p[i], p[i + 1]]); return o; };
const at = (r: Val, i: number) => (r as Val[])[i];

const FUNCS: Record<string, (...a: Val[]) => Val> = {
  SUM: (...a) => sum(numbers(a)),
  PRODUCT: (...a) => numbers(a).reduce((x, y) => x * y, 1),
  COUNT: (...a) => numbers(a).length,
  COUNTA: (...a) => [...flat(a)].filter((x) => x !== null && x !== "").length,
  AVERAGE: (...a) => avg(numbers(a)),
  MIN: (...a) => { const n = numbers(a); return n.length ? Math.min(...n) : 0; },
  MAX: (...a) => { const n = numbers(a); return n.length ? Math.max(...n) : 0; },
  ABS: (x) => Math.abs(num(x)),
  INT: (x) => Math.floor(num(x)),
  MOD: (a, b) => { const bb = num(b); if (bb === 0) throw new FormulaError("#DIV/0!"); const r = num(a) % bb; return r !== 0 && (r < 0) !== (bb < 0) ? r + bb : r; },
  ROUND: (x, d = 0) => rnd(x, d, 0),
  ROUNDUP: (x, d = 0) => rnd(x, d, 1),
  ROUNDDOWN: (x, d = 0) => rnd(x, d, -1),
  AND: (...a) => [...flat(a)].every((x) => !!num(x)),
  OR: (...a) => [...flat(a)].some((x) => !!num(x)),
  NOT: (x) => !num(x),
  LEN: (x) => (x === null ? "" : String(x)).length,
  UPPER: (x) => String(x || "").toUpperCase(),
  LOWER: (x) => String(x || "").toLowerCase(),
  CONCATENATE: (...a) => [...flat(a)].map(txt).join(""),
  CONCAT: (...a) => [...flat(a)].map(txt).join(""),
  SUMIF: (r, c, s = null) => { const src = s !== null ? s : r; return sum(ifs([[r, c]]).map((i) => at(src, i)).filter(isNum) as number[]); },
  SUMIFS: (s, ...p) => sum(ifs(pairsOf(p)).map((i) => at(s, i)).filter(isNum) as number[]),
  COUNTIF: (r, c) => ifs([[r, c]]).length,
  COUNTIFS: (...p) => ifs(pairsOf(p)).length,
  AVERAGEIF: (r, c, s = null) => { const src = s !== null ? s : r; return avg(ifs([[r, c]]).map((i) => at(src, i)).filter(isNum) as number[]); },
  AVERAGEIFS: (s, ...p) => avg(ifs(pairsOf(p)).map((i) => at(s, i)).filter(isNum) as number[]),
};

export type Resolver = (sheet: string, r: number, c: number) => Val;

export class Evaluator {
  toks: Tok[] = []; i = 0; sheet = "";
  constructor(public resolve: Resolver) {}
  evaluate(formula: string, sheet: string): Val {
    this.toks = tokenize(formula.replace(/^=+/, "")); this.i = 0; this.sheet = sheet;
    let v = this.expr();
    if (this.i !== this.toks.length) throw new FormulaError("trailing tokens");
    if (Array.isArray(v)) v = v.length ? v[0] : null;
    return v;
  }
  peek(): Tok { return this.i < this.toks.length ? this.toks[this.i] : [null, null]; }
  take(): Tok { const t = this.peek(); this.i++; return t; }
  isOp(...ops: string[]) { const [k, v] = this.peek(); return k === "op" && ops.includes(v!); }
  static sc(v: Val): Val { return Array.isArray(v) ? (v.length ? v[0] : null) : v; }
  expr(): Val {
    let a = this.concat();
    while (this.isOp("=", "<>", "<", ">", "<=", ">=")) {
      const op = this.take()[1]!; let b = this.concat();
      const A = Evaluator.sc(a), B = Evaluator.sc(b);
      let x: any, y: any;
      if (typeof A === "string" || typeof B === "string") { x = txt(A).toLowerCase(); y = txt(B).toLowerCase(); } else { x = num(A); y = num(B); }
      a = ({ "=": x === y, "<>": x !== y, "<": x < y, ">": x > y, "<=": x <= y, ">=": x >= y } as any)[op];
    }
    return a;
  }
  concat(): Val { let a = this.add(); while (this.isOp("&")) { this.take(); a = txt(Evaluator.sc(a)) + txt(Evaluator.sc(this.add())); } return a; }
  add(): Val {
    let a = this.mul();
    while (this.isOp("+", "-")) { const op = this.take()[1]; const b = this.mul(); a = num(Evaluator.sc(a)) + (op === "+" ? num(Evaluator.sc(b)) : -num(Evaluator.sc(b))); }
    return a;
  }
  mul(): Val {
    let a = this.pow();
    while (this.isOp("*", "/")) {
      const op = this.take()[1]; const b = num(Evaluator.sc(this.pow())); const x = num(Evaluator.sc(a));
      if (op === "*") a = x * b; else { if (b === 0) throw new FormulaError("#DIV/0!"); a = x / b; }
    }
    return a;
  }
  pow(): Val { let a = this.unary(); while (this.isOp("^")) { this.take(); a = num(Evaluator.sc(a)) ** num(Evaluator.sc(this.unary())); } return a; }
  unary(): Val {
    if (this.isOp("-", "+")) { const op = this.take()[1]; const v = num(Evaluator.sc(this.unary())); return op === "-" ? -v : v; }
    let v = this.primary();
    if (this.isOp("%")) { this.take(); v = num(Evaluator.sc(v)) / 100; }
    return v;
  }
  primary(): Val {
    const [k, v] = this.take();
    if (k === "num") return parseFloat(v!);
    if (k === "str") return v!.slice(1, -1).replace(/""/g, '"');
    if (k === "bool") return v!.toUpperCase() === "TRUE";
    if (k === "ref") return this.ref(v!);
    if (k === "p" && v === "(") { const e = this.expr(); this.expect(")"); return e; }
    if (k === "func") return this.call(v!);
    throw new FormulaError(`unexpected ${JSON.stringify(v)}`);
  }
  expect(ch: string) { const [k, v] = this.take(); if (!(k === "p" && v === ch)) throw new FormulaError(`expected ${ch}`); }
  argsRaw(): [number, number][] {
    const args: [number, number][] = [];
    if (this.peek()[0] === "p" && this.peek()[1] === ")") { this.take(); return args; }
    for (;;) {
      const start = this.i; let depth = 0;
      for (;;) {
        const [k, v] = this.peek();
        if (k === null) throw new FormulaError("unclosed (");
        if (k === "func" || (k === "p" && v === "(")) depth++;
        else if (k === "p" && v === ")") { if (depth === 0) break; depth--; }
        else if (k === "p" && (v === "," || v === ";") && depth === 0) break;
        this.i++;
      }
      args.push([start, this.i]);
      const [, v] = this.take();
      if (v === ")") return args;
    }
  }
  evalSpan(span: [number, number]): Val {
    const st = this.toks, si = this.i;
    this.toks = st.slice(0, span[1]); this.i = span[0];
    try { if (span[0] === span[1]) return null; return this.expr(); } finally { this.toks = st; this.i = si; }
  }
  call(name: string): Val {
    const spans = this.argsRaw();
    if (name === "IFERROR") {
      try { return this.evalSpan(spans[0]); } catch (e) { if (!(e instanceof FormulaError)) throw e; return spans.length > 1 ? this.evalSpan(spans[1]) : ""; }
    }
    if (name === "IF") {
      const c = Evaluator.sc(this.evalSpan(spans[0]));
      const truth = typeof c === "string" ? !!c : !!num(c);
      if (truth) return spans.length > 1 ? this.evalSpan(spans[1]) : true;
      return spans.length > 2 ? this.evalSpan(spans[2]) : false;
    }
    const f = FUNCS[name];
    if (!f) throw new FormulaError(`unsupported function ${name}`);
    return f(...spans.map((s) => this.evalSpan(s)));
  }
  ref(ref: string): Val {
    let [sheet, r1, c1, r2, c2] = splitRef(ref);
    const sh = sheet || this.sheet;
    if (r1 === r2 && c1 === c2) return this.resolve(sh, r1, c1);
    if ((r2 - r1 + 1) * (c2 - c1 + 1) > 200000) throw new FormulaError("range too large");
    const vals: Val[] = [];
    for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) vals.push(this.resolve(sh, r, c));
    return vals;
  }
}

const SHIFT = /((?:'(?:[^']|'')+'|[A-Za-z_][\p{L}\p{N}_.]*)!)?(\$?)([A-Za-z]{1,3})(\$?)(\p{Nd}+)(?![\p{L}\p{N}_(])/gu;
function shiftPart(s: string, dr: number, dc: number) {
  return s.replace(SHIFT, (_m, sh, dcol, col, drow, row) => {
    if (!dcol) col = num2col(Math.max(1, col2num(col) + dc));
    if (!drow) row = String(Math.max(1, parseInt(row, 10) + dr));
    return `${sh || ""}${dcol}${col}${drow}${row}`;
  });
}
export function shiftFormula(f: string, dr: number, dc: number) {
  const out: string[] = []; let pos = 0; const re = /"(?:[^"]|"")*"/g; let m: RegExpExecArray | null;
  while ((m = re.exec(f))) { out.push(shiftPart(f.slice(pos, m.index), dr, dc)); out.push(m[0]); pos = m.index + m[0].length; }
  out.push(shiftPart(f.slice(pos), dr, dc));
  return out.join("");
}
