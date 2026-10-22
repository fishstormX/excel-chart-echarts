// src/xml.ts
var El = class {
  constructor(tag, attrib = {}) {
    this.children = [];
    this.text = null;
    this.tail = null;
    this.tag = tag;
    this.attrib = attrib;
  }
  get(k, d) {
    return k in this.attrib ? this.attrib[k] : d;
  }
  get length() {
    return this.children.length;
  }
  *iter(tag) {
    if (!tag || this.tag === tag) yield this;
    for (const c of this.children) yield* c.iter(tag);
  }
  findall(path) {
    let cur = [this];
    let parts = splitPath(path);
    let deep = false;
    if (parts[0] === ".") parts = parts.slice(1);
    const out = [];
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (p === "") {
        deep = true;
        continue;
      }
      const nxt = [];
      for (const e of cur) {
        if (deep) {
          for (const d of e.iter()) if (d !== e) {
            if (d.tag === p) nxt.push(d);
          }
        } else for (const c of e.children) if (c.tag === p) nxt.push(c);
      }
      deep = false;
      cur = nxt;
    }
    out.push(...cur);
    return out;
  }
  find(path) {
    return this.findall(path)[0] ?? null;
  }
  findtext(path, d = null) {
    const e = this.find(path);
    return e ? e.text ?? "" : d;
  }
};
function splitPath(p) {
  const out = [];
  let cur = "", depth = 0;
  for (const ch of p) {
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    if (ch === "/" && depth === 0) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}
var ENT = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };
function unesc(s) {
  if (s.indexOf("&") < 0) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|\w+);/g, (m, g) => g[0] === "#" ? String.fromCodePoint(g[1] === "x" ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10)) : ENT[g] ?? m);
}
function parseXML(src) {
  let i = 0;
  const n = src.length;
  if (src.charCodeAt(0) === 65279) i = 1;
  const stack = [];
  let root = null;
  let nsTop = { xml: "http://www.w3.org/XML/1998/namespace" };
  const addText = (t) => {
    if (!stack.length || !t) return;
    const el = stack[stack.length - 1].el;
    if (el.children.length) {
      const l = el.children[el.children.length - 1];
      l.tail = (l.tail ?? "") + t;
    } else el.text = (el.text ?? "") + t;
  };
  const qn = (name, ns, isAttr) => {
    const k = name.indexOf(":");
    if (k < 0) return isAttr ? name : ns[""] ? `{${ns[""]}}${name}` : name;
    const p = name.slice(0, k), uri = ns[p];
    return uri ? `{${uri}}${name.slice(k + 1)}` : name;
  };
  while (i < n) {
    const lt = src.indexOf("<", i);
    if (lt < 0) {
      addText(unesc(src.slice(i)));
      break;
    }
    if (lt > i) addText(unesc(src.slice(i, lt)));
    if (src.startsWith("<!--", lt)) {
      i = src.indexOf("-->", lt) + 3;
      if (i < 3) break;
      continue;
    }
    if (src.startsWith("<![CDATA[", lt)) {
      const e = src.indexOf("]]>", lt);
      addText(src.slice(lt + 9, e));
      i = e + 3;
      continue;
    }
    if (src.startsWith("<?", lt)) {
      i = src.indexOf("?>", lt) + 2;
      continue;
    }
    if (src.startsWith("<!", lt)) {
      i = src.indexOf(">", lt) + 1;
      continue;
    }
    if (src[lt + 1] === "/") {
      const gt = src.indexOf(">", lt);
      const fin = stack.pop();
      if (fin) nsTop = stack.length ? stack[stack.length - 1].ns : nsTop;
      i = gt + 1;
      continue;
    }
    let j = lt + 1;
    let q = null;
    while (j < n) {
      const ch = src[j];
      if (q) {
        if (ch === q) q = null;
      } else if (ch === '"' || ch === "'") q = ch;
      else if (ch === ">") break;
      j++;
    }
    let body = src.slice(lt + 1, j);
    const selfClose = body.endsWith("/");
    if (selfClose) body = body.slice(0, -1);
    const m = /^([^\s]+)/.exec(body);
    const rawName = m[1];
    const rawAttrs = [];
    const re = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
    let a;
    const rest = body.slice(rawName.length);
    while (a = re.exec(rest)) rawAttrs.push([a[1], unesc(a[3] ?? a[4] ?? "")]);
    const parentNs = stack.length ? stack[stack.length - 1].ns : nsTop;
    let ns = parentNs;
    for (const [k, v] of rawAttrs) {
      if (k === "xmlns" || k.startsWith("xmlns:")) {
        if (ns === parentNs) ns = { ...parentNs };
        ns[k === "xmlns" ? "" : k.slice(6)] = v;
      }
    }
    const attrib = {};
    for (const [k, v] of rawAttrs) if (!(k === "xmlns" || k.startsWith("xmlns:"))) attrib[qn(k, ns, true)] = v;
    const el = new El(qn(rawName, ns, false), attrib);
    if (stack.length) stack[stack.length - 1].el.children.push(el);
    else root = el;
    if (!selfClose) stack.push({ el, ns });
    i = j + 1;
  }
  if (!root) throw new Error("empty XML document");
  return root;
}

// src/colors.ts
var A = "{http://schemas.openxmlformats.org/drawingml/2006/main}";
var PRST = { black: "000000", white: "FFFFFF", red: "FF0000", green: "008000", blue: "0000FF", yellow: "FFFF00", gray: "808080", orange: "FFA500", purple: "800080" };
var ALIAS = { tx1: "dk1", bg1: "lt1", tx2: "dk2", bg2: "lt2", phClr: "accent1" };
var clamp = (x) => Math.max(0, Math.min(1, x));
var local = (t) => t.slice(t.indexOf("}") + 1);
function rgbToHls(r, g, b) {
  const maxc = Math.max(r, g, b), minc = Math.min(r, g, b), sumc = maxc + minc, rangec = maxc - minc;
  const l = sumc / 2;
  if (minc === maxc) return [0, l, 0];
  const s = l <= 0.5 ? rangec / sumc : rangec / (2 - maxc - minc);
  const rc = (maxc - r) / rangec, gc = (maxc - g) / rangec, bc = (maxc - b) / rangec;
  let h = r === maxc ? bc - gc : g === maxc ? 2 + rc - bc : 4 + gc - rc;
  h = (h / 6 % 1 + 1) % 1;
  return [h, l, s];
}
function v_(m1, m2, hue) {
  hue = (hue % 1 + 1) % 1;
  if (hue < 1 / 6) return m1 + (m2 - m1) * hue * 6;
  if (hue < 0.5) return m2;
  if (hue < 2 / 3) return m1 + (m2 - m1) * (2 / 3 - hue) * 6;
  return m1;
}
function hlsToRgb(h, l, s) {
  if (s === 0) return [l, l, l];
  const m2 = l <= 0.5 ? l * (1 + s) : l + s - l * s, m1 = 2 * l - m2;
  return [v_(m1, m2, h + 1 / 3), v_(m1, m2, h), v_(m1, m2, h - 1 / 3)];
}
function pyRound(x, n = 0) {
  const k = 10 ** n, m = x * k, r = Math.round(m);
  if (Math.abs(m - Math.trunc(m)) === 0.5) return 2 * Math.round(m / 2) / k;
  return n ? Number((r / k).toFixed(n)) : r;
}
var hex2 = (n) => n.toString(16).toUpperCase().padStart(2, "0");
function resolveColor(el, theme) {
  if (!el) return null;
  const tag = local(el.tag);
  let hexv;
  if (tag === "srgbClr") hexv = el.get("val");
  else if (tag === "schemeClr") {
    const v = el.get("val");
    hexv = theme[ALIAS[v] ?? v];
  } else if (tag === "sysClr") hexv = el.get("lastClr") || (el.get("val") === "windowText" ? "000000" : "FFFFFF");
  else if (tag === "prstClr") hexv = PRST[el.get("val")] ?? "000000";
  else if (tag === "scrgbClr") hexv = ["r", "g", "b"].map((k) => hex2(Math.trunc(parseInt(el.get(k, "0"), 10) / 1e5 * 255))).join("");
  else return null;
  if (!hexv) return null;
  let r = parseInt(hexv.slice(0, 2), 16) / 255, g = parseInt(hexv.slice(2, 4), 16) / 255, b = parseInt(hexv.slice(4, 6), 16) / 255;
  let alpha = 1;
  for (const mod of el.children) {
    const mt = local(mod.tag), val = parseInt(mod.get("val", "0"), 10) / 1e5;
    if (mt === "lumMod" || mt === "lumOff") {
      let [h, l, s] = rgbToHls(r, g, b);
      l = mt === "lumMod" ? clamp(l * val) : clamp(l + val);
      [r, g, b] = hlsToRgb(h, l, s);
    } else if (mt === "tint") [r, g, b] = [r, g, b].map((c) => c + (1 - c) * (1 - val));
    else if (mt === "shade") [r, g, b] = [r, g, b].map((c) => c * val);
    else if (mt === "alpha") alpha = val;
  }
  const rgb = [r, g, b].map((c) => pyRound(clamp(c) * 255));
  if (alpha < 0.999) return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${Number(alpha.toPrecision(3))})`;
  return "#" + rgb.map(hex2).join("");
}
function fillColor(spPr, theme) {
  if (!spPr) return null;
  const sf = spPr.find(A + "solidFill");
  if (sf && sf.length) return resolveColor(sf.children[0], theme);
  const gf = spPr.find(A + "gradFill");
  if (gf) {
    const gs = gf.find(`${A}gsLst/${A}gs`);
    if (gs && gs.length) return resolveColor(gs.children[0], theme);
  }
  return null;
}
var noFill = (spPr) => !!spPr && !!spPr.find(A + "noFill");
function lineProps(spPr, theme) {
  if (!spPr) return [null, null, false, null];
  const ln = spPr.find(A + "ln");
  if (!ln) return [null, null, false, null];
  if (ln.find(A + "noFill")) return [null, null, true, null];
  let col = null;
  const sf = ln.find(A + "solidFill");
  if (sf && sf.length) col = resolveColor(sf.children[0], theme);
  const w = ln.get("w") ? parseInt(ln.get("w"), 10) / 12700 * 4 / 3 : null;
  let dash = null;
  const pd = ln.find(A + "prstDash");
  const pv = pd?.get("val");
  if (pd && pv !== void 0 && pv !== "solid") dash = pv.toLowerCase().includes("dot") && !pv.toLowerCase().includes("dash") ? "dotted" : "dashed";
  return [col, w, false, dash];
}

// src/formula.ts
var FormulaError = class extends Error {
};
var TOKEN = new RegExp(
  `(?<ws>\\s+)|(?<str>"(?:[^"]|"")*")|(?<ref>(?:(?:'(?:[^']|'')+'|[A-Za-z_][\\p{L}\\p{N}_.]*)!)?\\$?[A-Za-z]{1,3}\\$?\\p{Nd}+(?::\\$?[A-Za-z]{1,3}\\$?\\p{Nd}+)?)|(?<num>\\p{Nd}+(?:\\.\\p{Nd}*)?(?:[eE][+-]?\\p{Nd}+)?|\\.\\p{Nd}+(?:[eE][+-]?\\p{Nd}+)?)|(?<bool>TRUE|FALSE)(?![\\p{L}\\p{N}_(])|(?<func>[A-Za-z_][\\p{L}\\p{N}_.]*)\\(|(?<op><>|<=|>=|[-+*/^&=<>%])|(?<p>[(),;])`,
  "iuy"
);
function col2num(s) {
  let n = 0;
  for (const ch of s.toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64;
  return n;
}
function num2col(n) {
  let s = "";
  while (n) {
    const r = (n - 1) % 26;
    n = Math.floor((n - 1) / 26);
    s = String.fromCharCode(65 + r) + s;
  }
  return s;
}
var REF1 = /^\$?([A-Za-z]{1,3})\$?(\d+)$/;
function splitRef(ref) {
  let sheet = null;
  const k = ref.lastIndexOf("!");
  if (k >= 0) {
    sheet = ref.slice(0, k);
    ref = ref.slice(k + 1);
    if (sheet.startsWith("'")) sheet = sheet.slice(1, -1).replace(/''/g, "'");
  }
  const parts = ref.split(":");
  const m1 = REF1.exec(parts[0]), m2 = REF1.exec(parts[parts.length - 1]);
  if (!m1 || !m2) throw new FormulaError(ref);
  const r1 = +m1[2], c1 = col2num(m1[1]), r2 = +m2[2], c2 = col2num(m2[1]);
  return [sheet, Math.min(r1, r2), Math.min(c1, c2), Math.max(r1, r2), Math.max(c1, c2)];
}
function tokenize(src) {
  const out = [];
  let pos = 0;
  while (pos < src.length) {
    TOKEN.lastIndex = pos;
    const m = TOKEN.exec(src);
    if (!m) throw new FormulaError(`cannot parse at ${JSON.stringify(src.slice(pos, pos + 10))}`);
    pos = TOKEN.lastIndex;
    const g = m.groups;
    const k = Object.keys(g).find((x) => g[x] !== void 0);
    if (k === "ws") continue;
    let v = g[k];
    if (k === "func") {
      v = v.toUpperCase();
      if (v.startsWith("_XLFN.")) v = v.slice(6);
    }
    out.push([k, v]);
  }
  return out;
}
var isNum = (x) => typeof x === "number";
function num(v) {
  if (v === null || v === "") return 0;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const t = v.trim();
    const x = Number(t);
    if (t !== "" && !isNaN(x)) return x;
  }
  throw new FormulaError(`#VALUE! ${JSON.stringify(v)}`);
}
function* flat(args) {
  for (const a of args) {
    if (Array.isArray(a)) yield* a;
    else yield a;
  }
}
var numbers = (args) => [...flat(args)].filter(isNum);
function txt(v) {
  if (v === null) return "";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  return String(v);
}
var pyEscape = (s) => s.replace(/[()[\]{}?*+\-|^$\\.&~# \t\n\r\v\f]/g, "\\$&");
function criteria(c) {
  if (isNum(c)) return (v) => isNum(v) && v === c;
  const s = c === null ? "" : String(c);
  const m = /^(<>|<=|>=|=|<|>)?([\s\S]*)$/.exec(s);
  const op = m[1] || "=", rhs = m[2];
  const t = rhs.trim();
  const rn = t !== "" && !isNaN(Number(t)) ? Number(t) : null;
  if (rn !== null) {
    return (v) => {
      if (!isNum(v)) return op === "<>";
      return { "=": v === rn, "<>": v !== rn, "<": v < rn, ">": v > rn, "<=": v <= rn, ">=": v >= rn }[op];
    };
  }
  const pat = new RegExp("^" + pyEscape(rhs.toLowerCase()).split("\\*").join(".*").split("\\?").join(".").split("~.*").join("\\*") + "$", "s");
  return (v) => {
    let sv = v === null ? "" : (typeof v === "boolean" ? v ? "TRUE" : "FALSE" : String(v)).toLowerCase();
    const hit = rhs ? pat.test(sv) : v === null || v === "";
    if (op === "=") return hit;
    if (op === "<>") return !hit;
    return false;
  };
}
function ifs(pairs) {
  let idx = null;
  for (const [rng, crit] of pairs) {
    const f = criteria(crit);
    const ok = /* @__PURE__ */ new Set();
    rng.forEach((v, i) => {
      if (f(v)) ok.add(i);
    });
    const prev = idx;
    idx = prev === null ? ok : new Set([...prev].filter((x) => ok.has(x)));
  }
  return [...idx ?? []].sort((a, b) => a - b);
}
function rnd(x, d, mode) {
  const xv = num(x), dv = Math.trunc(num(d));
  const k = 10 ** dv;
  const sg = xv >= 0 ? 1 : -1;
  if (mode === 0) return Math.floor(Math.abs(xv) * k + 0.5) / k * sg;
  if (mode > 0) return Math.ceil(Math.abs(xv) * k - 1e-12) / k * sg;
  return Math.floor(Math.abs(xv) * k + 1e-12) / k * sg;
}
function avg(xs) {
  if (!xs.length) throw new FormulaError("#DIV/0!");
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
var sum = (xs) => xs.reduce((a, b) => a + b, 0);
var pairsOf = (p) => {
  const o = [];
  for (let i = 0; i + 1 < p.length; i += 2) o.push([p[i], p[i + 1]]);
  return o;
};
var at = (r, i) => r[i];
var FUNCS = {
  SUM: (...a) => sum(numbers(a)),
  PRODUCT: (...a) => numbers(a).reduce((x, y) => x * y, 1),
  COUNT: (...a) => numbers(a).length,
  COUNTA: (...a) => [...flat(a)].filter((x) => x !== null && x !== "").length,
  AVERAGE: (...a) => avg(numbers(a)),
  MIN: (...a) => {
    const n = numbers(a);
    return n.length ? Math.min(...n) : 0;
  },
  MAX: (...a) => {
    const n = numbers(a);
    return n.length ? Math.max(...n) : 0;
  },
  ABS: (x) => Math.abs(num(x)),
  INT: (x) => Math.floor(num(x)),
  MOD: (a, b) => {
    const bb = num(b);
    if (bb === 0) throw new FormulaError("#DIV/0!");
    const r = num(a) % bb;
    return r !== 0 && r < 0 !== bb < 0 ? r + bb : r;
  },
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
  SUMIF: (r, c, s = null) => {
    const src = s !== null ? s : r;
    return sum(ifs([[r, c]]).map((i) => at(src, i)).filter(isNum));
  },
  SUMIFS: (s, ...p) => sum(ifs(pairsOf(p)).map((i) => at(s, i)).filter(isNum)),
  COUNTIF: (r, c) => ifs([[r, c]]).length,
  COUNTIFS: (...p) => ifs(pairsOf(p)).length,
  AVERAGEIF: (r, c, s = null) => {
    const src = s !== null ? s : r;
    return avg(ifs([[r, c]]).map((i) => at(src, i)).filter(isNum));
  },
  AVERAGEIFS: (s, ...p) => avg(ifs(pairsOf(p)).map((i) => at(s, i)).filter(isNum))
};
var Evaluator = class _Evaluator {
  constructor(resolve) {
    this.resolve = resolve;
    this.toks = [];
    this.i = 0;
    this.sheet = "";
  }
  evaluate(formula, sheet) {
    this.toks = tokenize(formula.replace(/^=+/, ""));
    this.i = 0;
    this.sheet = sheet;
    let v = this.expr();
    if (this.i !== this.toks.length) throw new FormulaError("trailing tokens");
    if (Array.isArray(v)) v = v.length ? v[0] : null;
    return v;
  }
  peek() {
    return this.i < this.toks.length ? this.toks[this.i] : [null, null];
  }
  take() {
    const t = this.peek();
    this.i++;
    return t;
  }
  isOp(...ops) {
    const [k, v] = this.peek();
    return k === "op" && ops.includes(v);
  }
  static sc(v) {
    return Array.isArray(v) ? v.length ? v[0] : null : v;
  }
  expr() {
    let a = this.concat();
    while (this.isOp("=", "<>", "<", ">", "<=", ">=")) {
      const op = this.take()[1];
      let b = this.concat();
      const A3 = _Evaluator.sc(a), B = _Evaluator.sc(b);
      let x, y;
      if (typeof A3 === "string" || typeof B === "string") {
        x = txt(A3).toLowerCase();
        y = txt(B).toLowerCase();
      } else {
        x = num(A3);
        y = num(B);
      }
      a = { "=": x === y, "<>": x !== y, "<": x < y, ">": x > y, "<=": x <= y, ">=": x >= y }[op];
    }
    return a;
  }
  concat() {
    let a = this.add();
    while (this.isOp("&")) {
      this.take();
      a = txt(_Evaluator.sc(a)) + txt(_Evaluator.sc(this.add()));
    }
    return a;
  }
  add() {
    let a = this.mul();
    while (this.isOp("+", "-")) {
      const op = this.take()[1];
      const b = this.mul();
      a = num(_Evaluator.sc(a)) + (op === "+" ? num(_Evaluator.sc(b)) : -num(_Evaluator.sc(b)));
    }
    return a;
  }
  mul() {
    let a = this.pow();
    while (this.isOp("*", "/")) {
      const op = this.take()[1];
      const b = num(_Evaluator.sc(this.pow()));
      const x = num(_Evaluator.sc(a));
      if (op === "*") a = x * b;
      else {
        if (b === 0) throw new FormulaError("#DIV/0!");
        a = x / b;
      }
    }
    return a;
  }
  pow() {
    let a = this.unary();
    while (this.isOp("^")) {
      this.take();
      a = num(_Evaluator.sc(a)) ** num(_Evaluator.sc(this.unary()));
    }
    return a;
  }
  unary() {
    if (this.isOp("-", "+")) {
      const op = this.take()[1];
      const v2 = num(_Evaluator.sc(this.unary()));
      return op === "-" ? -v2 : v2;
    }
    let v = this.primary();
    if (this.isOp("%")) {
      this.take();
      v = num(_Evaluator.sc(v)) / 100;
    }
    return v;
  }
  primary() {
    const [k, v] = this.take();
    if (k === "num") return parseFloat(v);
    if (k === "str") return v.slice(1, -1).replace(/""/g, '"');
    if (k === "bool") return v.toUpperCase() === "TRUE";
    if (k === "ref") return this.ref(v);
    if (k === "p" && v === "(") {
      const e = this.expr();
      this.expect(")");
      return e;
    }
    if (k === "func") return this.call(v);
    throw new FormulaError(`unexpected ${JSON.stringify(v)}`);
  }
  expect(ch) {
    const [k, v] = this.take();
    if (!(k === "p" && v === ch)) throw new FormulaError(`expected ${ch}`);
  }
  argsRaw() {
    const args = [];
    if (this.peek()[0] === "p" && this.peek()[1] === ")") {
      this.take();
      return args;
    }
    for (; ; ) {
      const start = this.i;
      let depth = 0;
      for (; ; ) {
        const [k, v2] = this.peek();
        if (k === null) throw new FormulaError("unclosed (");
        if (k === "func" || k === "p" && v2 === "(") depth++;
        else if (k === "p" && v2 === ")") {
          if (depth === 0) break;
          depth--;
        } else if (k === "p" && (v2 === "," || v2 === ";") && depth === 0) break;
        this.i++;
      }
      args.push([start, this.i]);
      const [, v] = this.take();
      if (v === ")") return args;
    }
  }
  evalSpan(span) {
    const st = this.toks, si = this.i;
    this.toks = st.slice(0, span[1]);
    this.i = span[0];
    try {
      if (span[0] === span[1]) return null;
      return this.expr();
    } finally {
      this.toks = st;
      this.i = si;
    }
  }
  call(name) {
    const spans = this.argsRaw();
    if (name === "IFERROR") {
      try {
        return this.evalSpan(spans[0]);
      } catch (e) {
        if (!(e instanceof FormulaError)) throw e;
        return spans.length > 1 ? this.evalSpan(spans[1]) : "";
      }
    }
    if (name === "IF") {
      const c = _Evaluator.sc(this.evalSpan(spans[0]));
      const truth = typeof c === "string" ? !!c : !!num(c);
      if (truth) return spans.length > 1 ? this.evalSpan(spans[1]) : true;
      return spans.length > 2 ? this.evalSpan(spans[2]) : false;
    }
    const f = FUNCS[name];
    if (!f) throw new FormulaError(`unsupported function ${name}`);
    return f(...spans.map((s) => this.evalSpan(s)));
  }
  ref(ref) {
    let [sheet, r1, c1, r2, c2] = splitRef(ref);
    const sh = sheet || this.sheet;
    if (r1 === r2 && c1 === c2) return this.resolve(sh, r1, c1);
    if ((r2 - r1 + 1) * (c2 - c1 + 1) > 2e5) throw new FormulaError("range too large");
    const vals = [];
    for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) vals.push(this.resolve(sh, r, c));
    return vals;
  }
};
var SHIFT = /((?:'(?:[^']|'')+'|[A-Za-z_][\p{L}\p{N}_.]*)!)?(\$?)([A-Za-z]{1,3})(\$?)(\p{Nd}+)(?![\p{L}\p{N}_(])/gu;
function shiftPart(s, dr, dc) {
  return s.replace(SHIFT, (_m, sh, dcol, col, drow, row) => {
    if (!dcol) col = num2col(Math.max(1, col2num(col) + dc));
    if (!drow) row = String(Math.max(1, parseInt(row, 10) + dr));
    return `${sh || ""}${dcol}${col}${drow}${row}`;
  });
}
function shiftFormula(f, dr, dc) {
  const out = [];
  let pos = 0;
  const re = /"(?:[^"]|"")*"/g;
  let m;
  while (m = re.exec(f)) {
    out.push(shiftPart(f.slice(pos, m.index), dr, dc));
    out.push(m[0]);
    pos = m.index + m[0].length;
  }
  out.push(shiftPart(f.slice(pos), dr, dc));
  return out.join("");
}

// src/geoindex.ts
var GEO_INDEX = { "china": { "anhui": "\u5B89\u5FBD", "beijing": "\u5317\u4EAC", "b\u011Bij\u012Bng": "\u5317\u4EAC", "chongqing": "\u91CD\u5E86", "ch\xF3ngq\xECng": "\u91CD\u5E86", "fujian": "\u798F\u5EFA", "f\xFAji\xE0n": "\u798F\u5EFA", "gansu": "\u7518\u8083", "guangdong": "\u5E7F\u4E1C", "guangxi": "\u5E7F\u897F", "guangxizhuang": "\u5E7F\u897F", "guangxizhu\xE0ngz\xFA": "\u5E7F\u897F", "guizhou": "\u8D35\u5DDE", "gu\u01CEngd\u014Dng": "\u5E7F\u4E1C", "g\xF9izh\u014Du": "\u8D35\u5DDE", "g\u0101ns\xF9": "\u7518\u8083", "hainan": "\u6D77\u5357", "hebei": "\u6CB3\u5317", "heilongjiang": "\u9ED1\u9F99\u6C5F", "henan": "\u6CB3\u5357", "hk": "\u9999\u6E2F", "hksar": "\u9999\u6E2F", "hongkong": "\u9999\u6E2F", "hongkongsar": "\u9999\u6E2F", "hubei": "\u6E56\u5317", "hunan": "\u6E56\u5357", "h\xE9b\u011Bi": "\u6CB3\u5317", "h\xE9n\xE1n": "\u6CB3\u5357", "h\xFAb\u011Bi": "\u6E56\u5317", "h\xFAn\xE1n": "\u6E56\u5357", "h\u0113il\xF3ngji\u0101ng": "\u9ED1\u9F99\u6C5F", "h\u01CEin\xE1n": "\u6D77\u5357", "innermongol": "\u5185\u8499\u53E4", "innermongolia": "\u5185\u8499\u53E4", "jiangsu": "\u6C5F\u82CF", "jiangxi": "\u6C5F\u897F", "jilin": "\u5409\u6797", "ji\u0101ngs\u016B": "\u6C5F\u82CF", "ji\u0101ngx\u012B": "\u6C5F\u897F", "j\xEDl\xEDn": "\u5409\u6797", "liaoning": "\u8FBD\u5B81", "li\xE1on\xEDng": "\u8FBD\u5B81", "macao": "\u6FB3\u95E8", "macaosar": "\u6FB3\u95E8", "macau": "\u6FB3\u95E8", "macausar": "\u6FB3\u95E8", "neimenggu": "\u5185\u8499\u53E4", "neimongol": "\u5185\u8499\u53E4", "ningxia": "\u5B81\u590F", "ningxiahui": "\u5B81\u590F", "n\xE8im\u011Bngg\u01D4": "\u5185\u8499\u53E4", "n\xEDngxi\xE0h\xFAiz\xFA": "\u5B81\u590F", "qinghai": "\u9752\u6D77", "shaanxi": "\u9655\u897F", "shandong": "\u5C71\u4E1C", "shanghai": "\u4E0A\u6D77", "shanxi": "\u5C71\u897F", "sh\xE0ngh\u01CEi": "\u4E0A\u6D77", "sh\u0101nd\u014Dng": "\u5C71\u4E1C", "sh\u0101nx\u012B": "\u5C71\u897F", "sh\u01CEnx\u012B": "\u9655\u897F", "sichuan": "\u56DB\u5DDD", "s\xECchu\u0101n": "\u56DB\u5DDD", "taiwan": "\u53F0\u6E7E", "taiwanprovince": "\u53F0\u6E7E", "tianjin": "\u5929\u6D25", "tibet": "\u897F\u85CF", "ti\u0101nj\u012Bn": "\u5929\u6D25", "xianggang": "\u9999\u6E2F", "xinjiang": "\u65B0\u7586", "xinjianguyghur": "\u65B0\u7586", "xinjianguygur": "\u65B0\u7586", "xizang": "\u897F\u85CF", "x\u012Bnji\u0101ngw\xE9iw\xFA\u011Br": "\u65B0\u7586", "x\u012Bz\xE0ng": "\u897F\u85CF", "yunnan": "\u4E91\u5357", "y\xFAnn\xE1n": "\u4E91\u5357", "zhejiang": "\u6D59\u6C5F", "zh\xE8ji\u0101ng": "\u6D59\u6C5F", "\u0101nhu\u012B": "\u5B89\u5FBD", "\u4E0A\u6D77": "\u4E0A\u6D77", "\u4E91\u5357": "\u4E91\u5357", "\u5185\u8499\u53E4": "\u5185\u8499\u53E4", "\u5317\u4EAC": "\u5317\u4EAC", "\u53F0\u6E7E": "\u53F0\u6E7E", "\u5409\u6797": "\u5409\u6797", "\u56DB\u5DDD": "\u56DB\u5DDD", "\u5929\u6D25": "\u5929\u6D25", "\u5B81\u590F": "\u5B81\u590F", "\u5B89\u5FBD": "\u5B89\u5FBD", "\u5C71\u4E1C": "\u5C71\u4E1C", "\u5C71\u897F": "\u5C71\u897F", "\u5E7F\u4E1C": "\u5E7F\u4E1C", "\u5E7F\u897F": "\u5E7F\u897F", "\u65B0\u7586": "\u65B0\u7586", "\u6C5F\u82CF": "\u6C5F\u82CF", "\u6C5F\u897F": "\u6C5F\u897F", "\u6CB3\u5317": "\u6CB3\u5317", "\u6CB3\u5357": "\u6CB3\u5357", "\u6D59\u6C5F": "\u6D59\u6C5F", "\u6D77\u5357": "\u6D77\u5357", "\u6E56\u5317": "\u6E56\u5317", "\u6E56\u5357": "\u6E56\u5357", "\u6FB3\u95E8": "\u6FB3\u95E8", "\u7518\u8083": "\u7518\u8083", "\u798F\u5EFA": "\u798F\u5EFA", "\u897F\u85CF": "\u897F\u85CF", "\u8D35\u5DDE": "\u8D35\u5DDE", "\u8FBD\u5B81": "\u8FBD\u5B81", "\u91CD\u5E86": "\u91CD\u5E86", "\u9655\u897F": "\u9655\u897F", "\u9752\u6D77": "\u9752\u6D77", "\u9999\u6E2F": "\u9999\u6E2F", "\u9ED1\u9F99\u6C5F": "\u9ED1\u9F99\u6C5F" }, "world": { "abw": "Aruba", "ad": "Andorra", "ae": "United Arab Emirates", "af": "Afghanistan", "afg": "Afghanistan", "afghanistan": "Afghanistan", "ag": "Antigua and Barb.", "ago": "Angola", "ai": "Anguilla", "aia": "Anguilla", "al": "Albania", "ala": "\xC5land", "aland": "\xC5land", "alb": "Albania", "albania": "Albania", "ald": "\xC5land", "alg": "Algeria", "algeria": "Algeria", "am": "Armenia", "america": "United States of America", "americansamoa": "American Samoa", "amsamoa": "American Samoa", "and": "Andorra", "andorra": "Andorra", "ang": "Anguilla", "angola": "Angola", "anguilla": "Anguilla", "ant": "Antarctica", "antarctica": "Antarctica", "antb": "Antigua and Barb.", "antiguaandbarb": "Antigua and Barb.", "antiguaandbarbuda": "Antigua and Barb.", "ao": "Angola", "aq": "Antarctica", "ar": "Argentina", "arabrepublicofegypt": "Egypt", "are": "United Arab Emirates", "arg": "Argentina", "argentina": "Argentina", "argentinerepublic": "Argentina", "arm": "Armenia", "armenia": "Armenia", "aruba": "Aruba", "as": "American Samoa", "asm": "American Samoa", "at": "Austria", "ata": "Antarctica", "atf": "Fr. S. Antarctic Lands", "atg": "Antigua and Barb.", "au": "Australia", "aus": "Australia", "aust": "Austria", "australia": "Australia", "australianindianoceanterritories": "Indian Ocean Ter.", "austria": "Austria", "aut": "Austria", "auz": "Australia", "aw": "Aruba", "ax": "\xC5land", "az": "Azerbaijan", "aze": "Azerbaijan", "azerbaijan": "Azerbaijan", "ba": "Bosnia and Herz.", "bahamas": "Bahamas", "bahamasthe": "Bahamas", "bahr": "Bahrain", "bahrain": "Bahrain", "bailiwickofguernsey": "Guernsey", "bailiwickofjersey": "Jersey", "bang": "Bangladesh", "bangladesh": "Bangladesh", "barb": "Barbados", "barbados": "Barbados", "bb": "Barbados", "bd": "Bangladesh", "bdi": "Burundi", "be": "Belgium", "bel": "Belgium", "bela": "Belarus", "belarus": "Belarus", "belg": "Belgium", "belgium": "Belgium", "belize": "Belize", "ben": "Benin", "benin": "Benin", "berm": "Bermuda", "bermuda": "Bermuda", "bf": "Burkina Faso", "bfa": "Burkina Faso", "bg": "Bulgaria", "bgd": "Bangladesh", "bgr": "Bulgaria", "bh": "Bosnia and Herz.", "bhr": "Bahrain", "bhs": "Bahamas", "bhutan": "Bhutan", "bi": "Burundi", "bih": "Bosnia and Herz.", "bj": "Benin", "bl": "St-Barth\xE9lemy", "blm": "St-Barth\xE9lemy", "blr": "Belarus", "blz": "Belize", "bm": "Bermuda", "bmu": "Bermuda", "bn": "Brunei", "bo": "Bolivia", "bol": "Bolivia", "bolivarianrepublicofvenezuela": "Venezuela", "bolivia": "Bolivia", "bosniaandherz": "Bosnia and Herz.", "bosniaandherzegovina": "Bosnia and Herz.", "botswana": "Botswana", "br": "Brazil", "bra": "Brazil", "brazil": "Brazil", "brb": "Barbados", "brindianoceanter": "Br. Indian Ocean Ter.", "britain": "United Kingdom", "britishindianoceanterritory": "Br. Indian Ocean Ter.", "britishvirginis": "British Virgin Is.", "britishvirginislands": "British Virgin Is.", "brn": "Brunei", "brunei": "Brunei", "bruneidarussalam": "Brunei", "bs": "Bahamas", "bt": "Bhutan", "btn": "Bhutan", "bulg": "Bulgaria", "bulgaria": "Bulgaria", "bur": "Burundi", "burkinafaso": "Burkina Faso", "burma": "Myanmar", "burundi": "Burundi", "bw": "Botswana", "bwa": "Botswana", "by": "Belarus", "bz": "Belize", "ca": "Canada", "caboverde": "Cabo Verde", "caf": "Central African Rep.", "cam": "Cameroon", "camb": "Cambodia", "cambodia": "Cambodia", "cameroon": "Cameroon", "can": "Canada", "canada": "Canada", "capeverde": "Cabo Verde", "car": "Central African Rep.", "caymanis": "Cayman Is.", "caymanislands": "Cayman Is.", "cd": "Dem. Rep. Congo", "centralafricanrep": "Central African Rep.", "centralafricanrepublic": "Central African Rep.", "cf": "Central African Rep.", "cg": "Congo", "ch": "Switzerland", "chad": "Chad", "che": "Switzerland", "chile": "Chile", "china": "China", "chl": "Chile", "chn": "China", "ci": "C\xF4te d'Ivoire", "civ": "C\xF4te d'Ivoire", "ck": "Cook Is.", "cl": "Chile", "cm": "Cameroon", "cmr": "Cameroon", "cn": "China", "co": "Colombia", "cod": "Dem. Rep. Congo", "cog": "Congo", "cok": "Cook Is.", "col": "Colombia", "colombia": "Colombia", "com": "Comoros", "commonwealthofaustralia": "Australia", "commonwealthofdominica": "Dominica", "commonwealthofpuertorico": "Puerto Rico", "commonwealthofthebahamas": "Bahamas", "commonwealthofthenorthernmarianaislands": "N. Mariana Is.", "comoros": "Comoros", "congo": "Congo", "congobrazzaville": "Congo", "congodemrep": "Dem. Rep. Congo", "congokinshasa": "Dem. Rep. Congo", "congorep": "Congo", "cookis": "Cook Is.", "cookislands": "Cook Is.", "cooperativerepublicofguyana": "Guyana", "costarica": "Costa Rica", "cpv": "Cabo Verde", "cr": "Costa Rica", "cri": "Costa Rica", "cro": "Croatia", "croatia": "Croatia", "cu": "Cuba", "cub": "Cuba", "cuba": "Cuba", "cur": "Cura\xE7ao", "cura\xE7ao": "Cura\xE7ao", "cuw": "Cura\xE7ao", "cv": "Cabo Verde", "cvd": "Cabo Verde", "cw": "Cura\xE7ao", "cy": "Cyprus", "cym": "Cayman Is.", "cymis": "Cayman Is.", "cyn": "N. Cyprus", "cyp": "Cyprus", "cyprus": "Cyprus", "cyprusnorthern": "N. Cyprus", "cz": "Czechia", "cze": "Czechia", "czechia": "Czechia", "czechrepublic": "Czechia", "c\xF4tedivoire": "C\xF4te d'Ivoire", "de": "Germany", "democraticpeoplesrepublicofkorea": "North Korea", "democraticrepublicofs\xE3otom\xE9andprincipe": "S\xE3o Tom\xE9 and Principe", "democraticrepublicofthecongo": "Dem. Rep. Congo", "democraticrepublicoftimorleste": "Timor-Leste", "democraticsocialistrepublicofsrilanka": "Sri Lanka", "demrepcongo": "Dem. Rep. Congo", "demrepkorea": "North Korea", "den": "Denmark", "denmark": "Denmark", "deu": "Germany", "dinca": "Dominica", "dj": "Djibouti", "dji": "Djibouti", "djibouti": "Djibouti", "dk": "Denmark", "dm": "Dominica", "dma": "Dominica", "dnk": "Denmark", "do": "Dominican Rep.", "dom": "Dominican Rep.", "dominica": "Dominica", "dominicanrep": "Dominican Rep.", "dominicanrepublic": "Dominican Rep.", "domrep": "Dominican Rep.", "dprk": "North Korea", "drc": "Dem. Rep. Congo", "drcongo": "Dem. Rep. Congo", "dz": "Algeria", "dza": "Algeria", "easttimor": "Timor-Leste", "ec": "Ecuador", "ecu": "Ecuador", "ecuador": "Ecuador", "ee": "Estonia", "eg": "Egypt", "egy": "Egypt", "egypt": "Egypt", "egyptarabrep": "Egypt", "eh": "W. Sahara", "els": "El Salvador", "elsalvador": "El Salvador", "england": "United Kingdom", "eqg": "Eq. Guinea", "eqguinea": "Eq. Guinea", "equatorialguinea": "Eq. Guinea", "er": "Eritrea", "eri": "Eritrea", "erit": "Eritrea", "eritrea": "Eritrea", "es": "Spain", "esh": "W. Sahara", "esp": "Spain", "est": "Estonia", "estonia": "Estonia", "esw": "eSwatini", "eswatini": "eSwatini", "et": "Ethiopia", "eth": "Ethiopia", "ethiopia": "Ethiopia", "faeroeis": "Faeroe Is.", "faeroeislands": "Faeroe Is.", "falklandis": "Falkland Is.", "falklandislands": "Falkland Is.", "falklandislandsmalvinas": "Falkland Is.", "faroeislands": "Faeroe Is.", "federaldemocraticrepublicofethiopia": "Ethiopia", "federalrepublicofgermany": "Germany", "federalrepublicofnigeria": "Nigeria", "federalrepublicofsomalia": "Somalia", "federatedstatesofmicronesia": "Micronesia", "federationofsaintkittsandnevis": "St. Kitts and Nevis", "federativerepublicofbrazil": "Brazil", "fi": "Finland", "fiji": "Fiji", "fin": "Finland", "finland": "Finland", "fj": "Fiji", "fji": "Fiji", "fk": "Falkland Is.", "flk": "Falkland Is.", "flkis": "Falkland Is.", "fm": "Micronesia", "fo": "Faeroe Is.", "fr": "France", "fra": "France", "france": "France", "frenchpolynesia": "Fr. Polynesia", "frenchrepublic": "France", "frenchsouthernandantarcticlands": "Fr. S. Antarctic Lands", "fro": "Faeroe Is.", "frpoly": "Fr. Polynesia", "frpolynesia": "Fr. Polynesia", "frsal": "Fr. S. Antarctic Lands", "frsandantarcticlands": "Fr. S. Antarctic Lands", "frsantarcticlands": "Fr. S. Antarctic Lands", "fsm": "Micronesia", "f\xF8royarisfaeroeis": "Faeroe Is.", "ga": "Gabon", "gab": "Gabon", "gabon": "Gabon", "gaboneserepublic": "Gabon", "gambia": "Gambia", "gambiathe": "Gambia", "gb": "United Kingdom", "gbr": "United Kingdom", "gd": "Grenada", "ge": "Georgia", "geo": "Georgia", "georgia": "Georgia", "ger": "Germany", "germany": "Germany", "gg": "Guernsey", "ggy": "Guernsey", "gh": "Ghana", "gha": "Ghana", "ghana": "Ghana", "gin": "Guinea", "gl": "Greenland", "gm": "Gambia", "gmb": "Gambia", "gn": "Guinea", "gnb": "Guinea-Bissau", "gnq": "Eq. Guinea", "gq": "Eq. Guinea", "gr": "Greece", "grandduchyofluxembourg": "Luxembourg", "grc": "Greece", "grd": "Grenada", "greatbritain": "United Kingdom", "greece": "Greece", "greenland": "Greenland", "gren": "Grenada", "grenada": "Grenada", "grl": "Greenland", "grlnd": "Greenland", "gs": "S. Geo. and the Is.", "gt": "Guatemala", "gtm": "Guatemala", "gu": "Guam", "guam": "Guam", "guat": "Guatemala", "guatemala": "Guatemala", "guern": "Guernsey", "guernsey": "Guernsey", "guinea": "Guinea", "guineabissau": "Guinea-Bissau", "gum": "Guam", "guy": "Guyana", "guyana": "Guyana", "gw": "Guinea-Bissau", "gy": "Guyana", "haiti": "Haiti", "hashemitekingdomofjordan": "Jordan", "heardiandmcdonaldis": "Heard I. and McDonald Is.", "heardiandmcdonaldislands": "Heard I. and McDonald Is.", "heardislandandmcdonaldislands": "Heard I. and McDonald Is.", "hellenicrepublic": "Greece", "hk": "Hong Kong", "hkg": "Hong Kong", "hm": "Heard I. and McDonald Is.", "hmd": "Heard I. and McDonald Is.", "hmis": "Heard I. and McDonald Is.", "hn": "Honduras", "hnd": "Honduras", "hond": "Honduras", "honduras": "Honduras", "hongkong": "Hong Kong", "hongkongsar": "Hong Kong", "hongkongsarchina": "Hong Kong", "hongkongspecialadministrativeregionprc": "Hong Kong", "hr": "Croatia", "hrv": "Croatia", "ht": "Haiti", "hti": "Haiti", "hu": "Hungary", "hun": "Hungary", "hungary": "Hungary", "ic": "C\xF4te d'Ivoire", "iceland": "Iceland", "id": "Indonesia", "idn": "Indonesia", "ie": "Ireland", "il": "Israel", "im": "Isle of Man", "imn": "Isle of Man", "in": "India", "ind": "India", "independentstateofpapuanewguinea": "Papua New Guinea", "independentstateofsamoa": "Samoa", "india": "India", "indianoceanter": "Indian Ocean Ter.", "indianoceanterritories": "Indian Ocean Ter.", "indo": "Indonesia", "indocter": "Indian Ocean Ter.", "indonesia": "Indonesia", "io": "Br. Indian Ocean Ter.", "ioa": "Indian Ocean Ter.", "ioman": "Isle of Man", "iot": "Br. Indian Ocean Ter.", "iq": "Iraq", "ir": "Iran", "iran": "Iran", "iranislamicrep": "Iran", "iraq": "Iraq", "ire": "Ireland", "ireland": "Ireland", "irl": "Ireland", "irn": "Iran", "irq": "Iraq", "is": "Iceland", "isl": "Iceland", "islamicrepublicofiran": "Iran", "islamicrepublicofmauritania": "Mauritania", "islamicrepublicofpakistan": "Pakistan", "islamicstateofafghanistan": "Afghanistan", "isleofman": "Isle of Man", "isr": "Israel", "israel": "Israel", "it": "Italy", "ita": "Italy", "italianrepublic": "Italy", "italy": "Italy", "ivorycoast": "C\xF4te d'Ivoire", "jam": "Jamaica", "jamaica": "Jamaica", "japan": "Japan", "je": "Jersey", "jersey": "Jersey", "jey": "Jersey", "jm": "Jamaica", "jo": "Jordan", "jor": "Jordan", "jord": "Jordan", "jordan": "Jordan", "jp": "Japan", "jpn": "Japan", "kas": "Siachen Glacier", "kashmir": "Siachen Glacier", "kaz": "Kazakhstan", "kazakhstan": "Kazakhstan", "ke": "Kenya", "ken": "Kenya", "kenya": "Kenya", "kg": "Kyrgyzstan", "kgz": "Kyrgyzstan", "kh": "Cambodia", "khm": "Cambodia", "ki": "Kiribati", "kingdomofbahrain": "Bahrain", "kingdomofbelgium": "Belgium", "kingdomofbhutan": "Bhutan", "kingdomofcambodia": "Cambodia", "kingdomofdenmark": "Denmark", "kingdomofeswatini": "eSwatini", "kingdomoflesotho": "Lesotho", "kingdomofmorocco": "Morocco", "kingdomofnorway": "Norway", "kingdomofsaudiarabia": "Saudi Arabia", "kingdomofspain": "Spain", "kingdomofsweden": "Sweden", "kingdomofthailand": "Thailand", "kingdomofthenetherlands": "Netherlands", "kingdomoftonga": "Tonga", "kir": "Kiribati", "kiribati": "Kiribati", "km": "Comoros", "kn": "St. Kitts and Nevis", "kna": "St. Kitts and Nevis", "kor": "South Korea", "korea": "South Korea", "koreademrep": "North Korea", "korearep": "South Korea", "kos": "Kosovo", "kosovo": "Kosovo", "kp": "North Korea", "kr": "South Korea", "kuwait": "Kuwait", "kw": "Kuwait", "kwt": "Kuwait", "ky": "Cayman Is.", "kyrgyzrepublic": "Kyrgyzstan", "kyrgyzstan": "Kyrgyzstan", "kz": "Kazakhstan", "la": "Laos", "lao": "Laos", "laopdr": "Laos", "laopeoplesdemocraticrepublic": "Laos", "laos": "Laos", "lat": "Latvia", "latvia": "Latvia", "lb": "Lebanon", "lbn": "Lebanon", "lbr": "Liberia", "lby": "Libya", "lc": "Saint Lucia", "lca": "Saint Lucia", "leb": "Lebanon", "lebaneserepublic": "Lebanon", "lebanon": "Lebanon", "les": "Lesotho", "lesotho": "Lesotho", "li": "Liechtenstein", "liberia": "Liberia", "libya": "Libya", "lie": "Liechtenstein", "liech": "Liechtenstein", "liechtenstein": "Liechtenstein", "lith": "Lithuania", "lithuania": "Lithuania", "lk": "Sri Lanka", "lka": "Sri Lanka", "lr": "Liberia", "ls": "Lesotho", "lso": "Lesotho", "lt": "Lithuania", "ltu": "Lithuania", "lu": "Luxembourg", "lux": "Luxembourg", "luxembourg": "Luxembourg", "lv": "Latvia", "lva": "Latvia", "ly": "Libya", "ma": "Morocco", "macao": "China", "macau": "China", "macedonia": "North Macedonia", "mad": "Madagascar", "madagascar": "Madagascar", "maf": "St-Martin", "mal": "Malawi", "malawi": "Malawi", "malay": "Malaysia", "malaysia": "Malaysia", "mali": "Mali", "malta": "Malta", "mar": "Morocco", "marshallis": "Marshall Is.", "marshallislands": "Marshall Is.", "mauritania": "Mauritania", "mauritius": "Mauritius", "md": "Moldova", "mda": "Moldova", "mdg": "Madagascar", "me": "Montenegro", "mex": "Mexico", "mexico": "Mexico", "mf": "St-Martin", "mg": "Madagascar", "mh": "Marshall Is.", "mhl": "Marshall Is.", "micronesia": "Micronesia", "micronesiafederatedstatesof": "Micronesia", "mis": "Marshall Is.", "mk": "North Macedonia", "mkd": "North Macedonia", "ml": "Mali", "mli": "Mali", "mlt": "Malta", "mm": "Myanmar", "mmr": "Myanmar", "mn": "Mongolia", "mne": "Montenegro", "mng": "Mongolia", "mnp": "N. Mariana Is.", "moldova": "Moldova", "mong": "Mongolia", "mongolia": "Mongolia", "mont": "Montenegro", "montenegro": "Montenegro", "monts": "Montserrat", "montserrat": "Montserrat", "mor": "Morocco", "morocco": "Morocco", "moz": "Mozambique", "mozambique": "Mozambique", "mp": "N. Mariana Is.", "mr": "Mauritania", "mrt": "Mauritania", "ms": "Montserrat", "msr": "Montserrat", "mt": "Malta", "mu": "Mauritius", "mus": "Mauritius", "mw": "Malawi", "mwi": "Malawi", "mx": "Mexico", "my": "Malaysia", "myan": "Myanmar", "myanmar": "Myanmar", "mys": "Malaysia", "mz": "Mozambique", "na": "Namibia", "nam": "Namibia", "namibia": "Namibia", "nc": "New Caledonia", "ncl": "New Caledonia", "ncy": "N. Cyprus", "ncyprus": "N. Cyprus", "ne": "Niger", "negarabruneidarussalam": "Brunei", "nepal": "Nepal", "ner": "Niger", "neth": "Netherlands", "netherlands": "Netherlands", "newc": "New Caledonia", "newcaledonia": "New Caledonia", "newzealand": "New Zealand", "nf": "Norfolk Island", "nfk": "Norfolk Island", "nfki": "Norfolk Island", "ng": "Nigeria", "nga": "Nigeria", "ni": "Nicaragua", "nic": "Nicaragua", "nicaragua": "Nicaragua", "niger": "Niger", "nigeria": "Nigeria", "niu": "Niue", "niue": "Niue", "nk": "North Korea", "nl": "Netherlands", "nld": "Netherlands", "nmac": "North Macedonia", "nmarianais": "N. Mariana Is.", "nmi": "N. Mariana Is.", "nor": "Norway", "norfolkisland": "Norfolk Island", "northerncyprus": "N. Cyprus", "northernmarianaislands": "N. Mariana Is.", "northkorea": "North Korea", "northmacedonia": "North Macedonia", "norway": "Norway", "np": "Nepal", "npl": "Nepal", "nu": "Niue", "nz": "New Zealand", "nzl": "New Zealand", "om": "Oman", "oman": "Oman", "omn": "Oman", "orientalrepublicofuruguay": "Uruguay", "pa": "Panama", "pak": "Pakistan", "pakistan": "Pakistan", "pal": "Palestine", "palau": "Palau", "palestine": "Palestine", "palestinewestbankandgaza": "Palestine", "pan": "Panama", "panama": "Panama", "papuanewguinea": "Papua New Guinea", "para": "Paraguay", "paraguay": "Paraguay", "pe": "Peru", "peoplesdemocraticrepublicofalgeria": "Algeria", "peoplesrepublicofangola": "Angola", "peoplesrepublicofbangladesh": "Bangladesh", "peoplesrepublicofchina": "China", "per": "Peru", "persia": "Iran", "peru": "Peru", "pf": "Fr. Polynesia", "pg": "Papua New Guinea", "ph": "Philippines", "phil": "Philippines", "philippines": "Philippines", "phl": "Philippines", "pk": "Pakistan", "pl": "Poland", "plurinationalstateofbolivia": "Bolivia", "plw": "Palau", "pm": "St. Pierre and Miquelon", "png": "Papua New Guinea", "pol": "Poland", "poland": "Poland", "port": "Portugal", "portugal": "Portugal", "portugueserepublic": "Portugal", "pr": "Puerto Rico", "prc": "China", "pri": "Puerto Rico", "principalityofandorra": "Andorra", "principalityofliechtenstein": "Liechtenstein", "prk": "North Korea", "prt": "Portugal", "pry": "Paraguay", "ps": "Palestine", "pse": "Palestine", "psx": "Palestine", "pt": "Portugal", "puertorico": "Puerto Rico", "pw": "Palau", "py": "Paraguay", "pyf": "Fr. Polynesia", "qa": "Qatar", "qat": "Qatar", "qatar": "Qatar", "repcongo": "Congo", "republicofalbania": "Albania", "republicofarmenia": "Armenia", "republicofaustria": "Austria", "republicofazerbaijan": "Azerbaijan", "republicofbelarus": "Belarus", "republicofbenin": "Benin", "republicofbotswana": "Botswana", "republicofbulgaria": "Bulgaria", "republicofburundi": "Burundi", "republicofcaboverde": "Cabo Verde", "republicofcameroon": "Cameroon", "republicofchad": "Chad", "republicofchile": "Chile", "republicofcolombia": "Colombia", "republicofcostarica": "Costa Rica", "republicofcroatia": "Croatia", "republicofcuba": "Cuba", "republicofcyprus": "Cyprus", "republicofdjibouti": "Djibouti", "republicofecuador": "Ecuador", "republicofelsalvador": "El Salvador", "republicofequatorialguinea": "Eq. Guinea", "republicofestonia": "Estonia", "republicoffiji": "Fiji", "republicoffinland": "Finland", "republicofghana": "Ghana", "republicofguatemala": "Guatemala", "republicofguinea": "Guinea", "republicofguineabissau": "Guinea-Bissau", "republicofhaiti": "Haiti", "republicofhonduras": "Honduras", "republicofhungary": "Hungary", "republicoficeland": "Iceland", "republicofindia": "India", "republicofindonesia": "Indonesia", "republicofiraq": "Iraq", "republicofivorycoast": "C\xF4te d'Ivoire", "republicofkazakhstan": "Kazakhstan", "republicofkenya": "Kenya", "republicofkiribati": "Kiribati", "republicofkorea": "South Korea", "republicofkosovo": "Kosovo", "republicoflatvia": "Latvia", "republicofliberia": "Liberia", "republicoflithuania": "Lithuania", "republicofmadagascar": "Madagascar", "republicofmalawi": "Malawi", "republicofmali": "Mali", "republicofmalta": "Malta", "republicofmauritius": "Mauritius", "republicofmoldova": "Moldova", "republicofmozambique": "Mozambique", "republicofnamibia": "Namibia", "republicofnicaragua": "Nicaragua", "republicofniger": "Niger", "republicofnorthmacedonia": "North Macedonia", "republicofpalau": "Palau", "republicofpanama": "Panama", "republicofparaguay": "Paraguay", "republicofperu": "Peru", "republicofpoland": "Poland", "republicofrwanda": "Rwanda", "republicofsanmarino": "San Marino", "republicofsenegal": "Senegal", "republicofserbia": "Serbia", "republicofseychelles": "Seychelles", "republicofsierraleone": "Sierra Leone", "republicofsingapore": "Singapore", "republicofslovenia": "Slovenia", "republicofsomaliland": "Somaliland", "republicofsouthafrica": "South Africa", "republicofsouthsudan": "S. Sudan", "republicofsuriname": "Suriname", "republicoftajikistan": "Tajikistan", "republicofthecongo": "Congo", "republicofthegambia": "Gambia", "republicofthemarshallislands": "Marshall Is.", "republicofthephilippines": "Philippines", "republicofthesudan": "Sudan", "republicoftheunionofmyanmar": "Myanmar", "republicoftrinidadandtobago": "Trinidad and Tobago", "republicoftunisia": "Tunisia", "republicofturkey": "Turkey", "republicofuganda": "Uganda", "republicofuzbekistan": "Uzbekistan", "republicofvanuatu": "Vanuatu", "republicofyemen": "Yemen", "republicofzambia": "Zambia", "republicofzimbabwe": "Zimbabwe", "ro": "Romania", "rom": "Romania", "romania": "Romania", "rou": "Romania", "rs": "Serbia", "ru": "Russia", "rus": "Russia", "russia": "Russia", "russianfederation": "Russia", "rw": "Rwanda", "rwa": "Rwanda", "rwanda": "Rwanda", "sa": "Saudi Arabia", "saf": "South Africa", "sah": "W. Sahara", "sahrawiarabdemocraticrepublic": "W. Sahara", "saintbarthelemy": "St-Barth\xE9lemy", "saintbarth\xE9lemy": "St-Barth\xE9lemy", "sainthelena": "Saint Helena", "saintkittsandnevis": "St. Kitts and Nevis", "saintlucia": "Saint Lucia", "saintmartin": "St-Martin", "saintmartinfrenchpart": "St-Martin", "saintpierreandmiquelon": "St. Pierre and Miquelon", "saintvincentandthegrenadines": "St. Vin. and Gren.", "samoa": "Samoa", "sanmarino": "San Marino", "saotomeandprincipe": "S\xE3o Tom\xE9 and Principe", "sau": "Saudi Arabia", "saud": "Saudi Arabia", "saudiarabia": "Saudi Arabia", "sb": "Solomon Is.", "sc": "Seychelles", "sd": "Sudan", "sdn": "Sudan", "sds": "S. Sudan", "se": "Sweden", "sen": "Senegal", "senegal": "Senegal", "serb": "Serbia", "serbia": "Serbia", "seychelles": "Seychelles", "sg": "Singapore", "sgeoandtheis": "S. Geo. and the Is.", "sgis": "S. Geo. and the Is.", "sgp": "Singapore", "sgs": "S. Geo. and the Is.", "sh": "Saint Helena", "shn": "Saint Helena", "si": "Slovenia", "siachen": "Siachen Glacier", "siachenglacier": "Siachen Glacier", "sierraleone": "Sierra Leone", "sing": "Singapore", "singapore": "Singapore", "sis": "Solomon Is.", "sk": "South Korea", "sl": "Sierra Leone", "slb": "Solomon Is.", "sle": "Sierra Leone", "slo": "Slovenia", "slovakia": "Slovakia", "slovakrepublic": "Slovakia", "slovenia": "Slovenia", "slv": "El Salvador", "sm": "San Marino", "smr": "San Marino", "sn": "Senegal", "so": "Somalia", "socialistrepublicofvietnam": "Vietnam", "sol": "Somaliland", "solnd": "Somaliland", "solomonis": "Solomon Is.", "solomonislands": "Solomon Is.", "som": "Somalia", "somalia": "Somalia", "somaliland": "Somaliland", "southafrica": "South Africa", "southgeorgiaandtheislands": "S. Geo. and the Is.", "southgeorgiaandthesouthsandwichislands": "S. Geo. and the Is.", "southkorea": "South Korea", "southsudan": "S. Sudan", "sp": "Spain", "spain": "Spain", "spm": "St. Pierre and Miquelon", "sr": "Suriname", "srb": "Serbia", "sril": "Sri Lanka", "srilanka": "Sri Lanka", "ss": "S. Sudan", "ssd": "S. Sudan", "ssud": "S. Sudan", "ssudan": "S. Sudan", "st": "S\xE3o Tom\xE9 and Principe", "stateoferitrea": "Eritrea", "stateofisrael": "Israel", "stateofkuwait": "Kuwait", "stateofqatar": "Qatar", "stb": "St-Barth\xE9lemy", "stbarth\xE9lemy": "St-Barth\xE9lemy", "sth": "Saint Helena", "sthelena": "Saint Helena", "stkittsandnevis": "St. Kitts and Nevis", "stkn": "St. Kitts and Nevis", "stlucia": "Saint Lucia", "stm": "St-Martin", "stmartin": "St-Martin", "stmartinfrenchpart": "St-Martin", "stp": "S\xE3o Tom\xE9 and Principe", "stpierreandmiquelon": "St. Pierre and Miquelon", "stpm": "St. Pierre and Miquelon", "stvg": "St. Vin. and Gren.", "stvinandgren": "St. Vin. and Gren.", "stvincentandthegrenadines": "St. Vin. and Gren.", "sudan": "Sudan", "sultanateofoman": "Oman", "sur": "Suriname", "suriname": "Suriname", "sv": "El Salvador", "svk": "Slovakia", "svn": "Slovenia", "swaziland": "eSwatini", "swe": "Sweden", "sweden": "Sweden", "swissconfederation": "Switzerland", "switz": "Switzerland", "switzerland": "Switzerland", "swz": "eSwatini", "sy": "Syria", "syc": "Seychelles", "syr": "Syria", "syria": "Syria", "syrianarabrepublic": "Syria", "sz": "eSwatini", "s\xE3otom\xE9andprincipe": "S\xE3o Tom\xE9 and Principe", "s\xE3otom\xE9andpr\xEDncipe": "S\xE3o Tom\xE9 and Principe", "taiwan": "China", "tajikistan": "Tajikistan", "tanz": "Tanzania", "tanzania": "Tanzania", "tc": "Turks and Caicos Is.", "tca": "Turks and Caicos Is.", "tcd": "Chad", "tcis": "Turks and Caicos Is.", "td": "Chad", "territoryofguam": "Guam", "territoryofheardislandandmcdonaldislands": "Heard I. and McDonald Is.", "territoryofnorfolkisland": "Norfolk Island", "territoryofthefrenchsouthernandantarcticlands": "Fr. S. Antarctic Lands", "tf": "Fr. S. Antarctic Lands", "tg": "Togo", "tgo": "Togo", "th": "Thailand", "tha": "Thailand", "thai": "Thailand", "thailand": "Thailand", "thebahamas": "Bahamas", "thebermudasorsomersisles": "Bermuda", "thegambia": "Gambia", "timorleste": "Timor-Leste", "tj": "Tajikistan", "tjk": "Tajikistan", "tkm": "Turkmenistan", "tl": "Timor-Leste", "tls": "Timor-Leste", "tm": "Turkmenistan", "tn": "Tunisia", "to": "Tonga", "togo": "Togo", "togoleserepublic": "Togo", "ton": "Tonga", "tonga": "Tonga", "tongo": "Tonga", "tr": "Turkey", "trinidadandtobago": "Trinidad and Tobago", "trt": "Trinidad and Tobago", "tt": "Trinidad and Tobago", "tto": "Trinidad and Tobago", "tun": "Tunisia", "tunisia": "Tunisia", "tur": "Turkey", "turkey": "Turkey", "turkishrepublicofnortherncyprus": "N. Cyprus", "turkm": "Turkmenistan", "turkmenistan": "Turkmenistan", "turksandcaicosis": "Turks and Caicos Is.", "turksandcaicosislands": "Turks and Caicos Is.", "tz": "Tanzania", "tza": "Tanzania", "t\xFCrkiye": "Turkey", "ua": "Ukraine", "uae": "United Arab Emirates", "ug": "Uganda", "uga": "Uganda", "uganda": "Uganda", "uk": "United Kingdom", "ukr": "Ukraine", "ukraine": "Ukraine", "unionofthecomoros": "Comoros", "unitedarabemirates": "United Arab Emirates", "unitedkingdom": "United Kingdom", "unitedkingdomofgreatbritainandnorthernireland": "United Kingdom", "unitedmexicanstates": "Mexico", "unitedrepublicoftanzania": "Tanzania", "unitedstates": "United States of America", "unitedstatesofamerica": "United States of America", "unitedstatesvirginislands": "U.S. Virgin Is.", "uruguay": "Uruguay", "ury": "Uruguay", "us": "United States of America", "usa": "United States of America", "usvirginis": "U.S. Virgin Is.", "uy": "Uruguay", "uz": "Uzbekistan", "uzb": "Uzbekistan", "uzbekistan": "Uzbekistan", "van": "Vanuatu", "vanuatu": "Vanuatu", "vc": "St. Vin. and Gren.", "vct": "St. Vin. and Gren.", "ve": "Venezuela", "ven": "Venezuela", "venezuela": "Venezuela", "venezuelarb": "Venezuela", "vg": "British Virgin Is.", "vgb": "British Virgin Is.", "vi": "U.S. Virgin Is.", "vibr": "British Virgin Is.", "viet": "Vietnam", "vietnam": "Vietnam", "vir": "U.S. Virgin Is.", "virginislandsoftheunitedstates": "U.S. Virgin Is.", "virginislandsus": "U.S. Virgin Is.", "vius": "U.S. Virgin Is.", "vn": "Vietnam", "vnm": "Vietnam", "vu": "Vanuatu", "vut": "Vanuatu", "westbankandgaza": "Palestine", "westernsahara": "W. Sahara", "ws": "Samoa", "wsah": "W. Sahara", "wsahara": "W. Sahara", "wsm": "Samoa", "ye": "Yemen", "yem": "Yemen", "yemen": "Yemen", "yemenrep": "Yemen", "za": "South Africa", "zaf": "South Africa", "zambia": "Zambia", "zimb": "Zimbabwe", "zimbabwe": "Zimbabwe", "zm": "Zambia", "zmb": "Zambia", "zw": "Zimbabwe", "zwe": "Zimbabwe", "\xE5land": "\xC5land", "\xE5landislands": "\xC5land", "\u4E0D\u4E39": "Bhutan", "\u4E1C\u5E1D\u6C76": "Timor-Leste", "\u4E2D\u534E\u4EBA\u6C11\u5171\u548C\u56FD": "China", "\u4E2D\u56FD": "China", "\u4E2D\u56FD\u53F0\u6E7E": "China", "\u4E2D\u975E\u5171\u548C\u56FD": "Central African Rep.", "\u4E39\u9EA6": "Denmark", "\u4E4C\u514B\u5170": "Ukraine", "\u4E4C\u5179\u522B\u514B\u65AF\u5766": "Uzbekistan", "\u4E4C\u5E72\u8FBE": "Uganda", "\u4E4C\u62C9\u572D": "Uruguay", "\u4E4D\u5F97": "Chad", "\u4E5F\u95E8": "Yemen", "\u4E9A\u7F8E\u5C3C\u4E9A": "Armenia", "\u4EE5\u8272\u5217": "Israel", "\u4F0A\u62C9\u514B": "Iraq", "\u4F0A\u6717": "Iran", "\u4F2F\u5229\u5179": "Belize", "\u4F5B\u5F97\u89D2": "Cabo Verde", "\u4FC4\u7F57\u65AF": "Russia", "\u4FDD\u52A0\u5229\u4E9A": "Bulgaria", "\u514B\u7F57\u5730\u4E9A": "Croatia", "\u5173\u5C9B": "Guam", "\u5188\u6BD4\u4E9A": "Gambia", "\u51B0\u5C9B": "Iceland", "\u51E0\u5185\u4E9A": "Guinea", "\u51E0\u5185\u4E9A\u6BD4\u7ECD": "Guinea-Bissau", "\u5217\u652F\u6566\u58EB\u767B": "Liechtenstein", "\u521A\u679C\u5171\u548C\u56FD": "Congo", "\u521A\u679C\u6C11\u4E3B\u5171\u548C\u56FD": "Dem. Rep. Congo", "\u5229\u6BD4\u4E9A": "Libya", "\u5229\u6BD4\u91CC\u4E9A": "Liberia", "\u52A0\u62FF\u5927": "Canada", "\u52A0\u7EB3": "Ghana", "\u52A0\u84EC": "Gabon", "\u5308\u7259\u5229": "Hungary", "\u5317\u585E\u6D66\u8DEF\u65AF\u571F\u8033\u5176\u5171\u548C\u56FD": "N. Cyprus", "\u5317\u9A6C\u5176\u987F": "North Macedonia", "\u5317\u9A6C\u91CC\u4E9A\u7EB3\u7FA4\u5C9B": "N. Mariana Is.", "\u5357\u4E54\u6CBB\u4E9A\u548C\u5357\u6851\u5A01\u5947\u7FA4\u5C9B": "S. Geo. and the Is.", "\u5357\u6781\u6D32": "Antarctica", "\u5357\u82CF\u4E39": "S. Sudan", "\u5357\u975E": "South Africa", "\u535A\u8328\u74E6\u7EB3": "Botswana", "\u5361\u5854\u5C14": "Qatar", "\u5362\u65FA\u8FBE": "Rwanda", "\u5362\u68EE\u5821": "Luxembourg", "\u5370\u5EA6": "India", "\u5370\u5EA6\u5C3C\u897F\u4E9A": "Indonesia", "\u5371\u5730\u9A6C\u62C9": "Guatemala", "\u5384\u74DC\u591A\u5C14": "Ecuador", "\u5384\u7ACB\u7279\u91CC\u4E9A": "Eritrea", "\u53D9\u5229\u4E9A": "Syria", "\u53E4\u5DF4": "Cuba", "\u53F0\u6E7E": "China", "\u5409\u5C14\u5409\u65AF\u65AF\u5766": "Kyrgyzstan", "\u5409\u5E03\u63D0": "Djibouti", "\u54C8\u8428\u514B\u65AF\u5766": "Kazakhstan", "\u54E5\u4F26\u6BD4\u4E9A": "Colombia", "\u54E5\u65AF\u8FBE\u9ECE\u52A0": "Costa Rica", "\u5580\u9EA6\u9686": "Cameroon", "\u571F\u5E93\u66FC\u65AF\u5766": "Turkmenistan", "\u571F\u8033\u5176": "Turkey", "\u5723\u5362\u897F\u4E9A": "Saint Lucia", "\u5723\u57FA\u8328\u548C\u5C3C\u7EF4\u65AF": "St. Kitts and Nevis", "\u5723\u591A\u7F8E\u548C\u666E\u6797\u897F\u6BD4": "S\xE3o Tom\xE9 and Principe", "\u5723\u5DF4\u6CF0\u52D2\u7C73": "St-Barth\xE9lemy", "\u5723\u6587\u68EE\u7279\u548C\u683C\u6797\u7EB3\u4E01\u65AF": "St. Vin. and Gren.", "\u5723\u76AE\u57C3\u5C14\u548C\u5BC6\u514B\u9686": "St. Pierre and Miquelon", "\u5723\u8D6B\u52D2\u62FF": "Saint Helena", "\u5723\u9A6C\u529B\u8BFA": "San Marino", "\u572D\u4E9A\u90A3": "Guyana", "\u5766\u6851\u5C3C\u4E9A": "Tanzania", "\u57C3\u53CA": "Egypt", "\u57C3\u585E\u4FC4\u6BD4\u4E9A": "Ethiopia", "\u57FA\u91CC\u5DF4\u65AF": "Kiribati", "\u5854\u5409\u514B\u65AF\u5766": "Tajikistan", "\u585E\u5185\u52A0\u5C14": "Senegal", "\u585E\u5C14\u7EF4\u4E9A": "Serbia", "\u585E\u62C9\u5229\u6602": "Sierra Leone", "\u585E\u6D66\u8DEF\u65AF": "Cyprus", "\u585E\u820C\u5C14": "Seychelles", "\u58A8\u897F\u54E5": "Mexico", "\u591A\u54E5": "Togo", "\u591A\u7C73\u5C3C\u514B": "Dominica", "\u591A\u7C73\u5C3C\u52A0": "Dominican Rep.", "\u5927\u97E9\u6C11\u56FD": "South Korea", "\u5965\u5170": "\xC5land", "\u5965\u5730\u5229": "Austria", "\u59D4\u5185\u745E\u62C9": "Venezuela", "\u5B5F\u52A0\u62C9\u56FD": "Bangladesh", "\u5B89\u54E5\u62C9": "Angola", "\u5B89\u572D\u62C9": "Anguilla", "\u5B89\u63D0\u74DC\u548C\u5DF4\u5E03\u8FBE": "Antigua and Barb.", "\u5B89\u9053\u5C14": "Andorra", "\u5BC6\u514B\u7F57\u5C3C\u897F\u4E9A\u8054\u90A6": "Micronesia", "\u5C3C\u52A0\u62C9\u74DC": "Nicaragua", "\u5C3C\u65E5\u5229\u4E9A": "Nigeria", "\u5C3C\u65E5\u5C14": "Niger", "\u5C3C\u6CCA\u5C14": "Nepal", "\u5DF4\u52D2\u65AF\u5766": "Palestine", "\u5DF4\u54C8\u9A6C": "Bahamas", "\u5DF4\u57FA\u65AF\u5766": "Pakistan", "\u5DF4\u5DF4\u591A\u65AF": "Barbados", "\u5DF4\u5E03\u4E9A\u65B0\u51E0\u5185\u4E9A": "Papua New Guinea", "\u5DF4\u62C9\u572D": "Paraguay", "\u5DF4\u62FF\u9A6C": "Panama", "\u5DF4\u6797": "Bahrain", "\u5DF4\u897F": "Brazil", "\u5E03\u57FA\u7EB3\u6CD5\u7D22": "Burkina Faso", "\u5E03\u9686\u8FEA": "Burundi", "\u5E0C\u814A": "Greece", "\u5E15\u52B3": "Palau", "\u5E93\u514B\u7FA4\u5C9B": "Cook Is.", "\u5E93\u62C9\u7D22": "Cura\xE7ao", "\u5F00\u66FC\u7FA4\u5C9B": "Cayman Is.", "\u5FB7\u56FD": "Germany", "\u610F\u5927\u5229": "Italy", "\u6240\u7F57\u95E8\u7FA4\u5C9B": "Solomon Is.", "\u62C9\u8131\u7EF4\u4E9A": "Latvia", "\u632A\u5A01": "Norway", "\u6377\u514B": "Czechia", "\u6469\u5C14\u591A\u74E6": "Moldova", "\u6469\u6D1B\u54E5": "Morocco", "\u6587\u83B1": "Brunei", "\u6590\u6D4E": "Fiji", "\u65AF\u5A01\u58EB\u5170": "eSwatini", "\u65AF\u6D1B\u4F10\u514B": "Slovakia", "\u65AF\u6D1B\u6587\u5C3C\u4E9A": "Slovenia", "\u65AF\u91CC\u5170\u5361": "Sri Lanka", "\u65B0\u52A0\u5761": "Singapore", "\u65B0\u5580\u91CC\u591A\u5C3C\u4E9A": "New Caledonia", "\u65B0\u897F\u5170": "New Zealand", "\u65E5\u672C": "Japan", "\u667A\u5229": "Chile", "\u671D\u9C9C": "North Korea", "\u671D\u9C9C\u6C11\u4E3B\u4E3B\u4E49\u4EBA\u6C11\u5171\u548C\u56FD": "North Korea", "\u67EC\u57D4\u5BE8": "Cambodia", "\u6839\u897F": "Guernsey", "\u683C\u6797\u7EB3\u8FBE": "Grenada", "\u683C\u9675\u5170": "Greenland", "\u683C\u9C81\u5409\u4E9A": "Georgia", "\u6BD4\u5229\u65F6": "Belgium", "\u6BDB\u91CC\u5854\u5C3C\u4E9A": "Mauritania", "\u6BDB\u91CC\u6C42\u65AF": "Mauritius", "\u6C64\u52A0": "Tonga", "\u6C99\u7279\u963F\u62C9\u4F2F": "Saudi Arabia", "\u6CD5\u56FD": "France", "\u6CD5\u5C5E\u5357\u90E8\u548C\u5357\u6781\u9886\u5730": "Fr. S. Antarctic Lands", "\u6CD5\u5C5E\u5723\u9A6C\u4E01": "St-Martin", "\u6CD5\u5C5E\u6CE2\u5229\u5C3C\u897F\u4E9A": "Fr. Polynesia", "\u6CD5\u7F57\u7FA4\u5C9B": "Faeroe Is.", "\u6CE2\u5170": "Poland", "\u6CE2\u591A\u9ECE\u5404": "Puerto Rico", "\u6CE2\u65AF\u5C3C\u4E9A\u548C\u9ED1\u585E\u54E5\u7EF4\u90A3": "Bosnia and Herz.", "\u6CF0\u56FD": "Thailand", "\u6CFD\u897F": "Jersey", "\u6D25\u5DF4\u5E03\u97E6": "Zimbabwe", "\u6D2A\u90FD\u62C9\u65AF": "Honduras", "\u6D77\u5730": "Haiti", "\u6FB3\u5927\u5229\u4E9A": "Australia", "\u6FB3\u5C6C\u5370\u5EA6\u6D0B\u9818\u5730": "Indian Ocean Ter.", "\u6FB3\u95E8": "China", "\u7231\u5C14\u5170": "Ireland", "\u7231\u6C99\u5C3C\u4E9A": "Estonia", "\u7259\u4E70\u52A0": "Jamaica", "\u7279\u514B\u65AF\u548C\u51EF\u79D1\u65AF\u7FA4\u5C9B": "Turks and Caicos Is.", "\u7279\u7ACB\u5C3C\u8FBE\u548C\u591A\u5DF4\u54E5": "Trinidad and Tobago", "\u73BB\u5229\u7EF4\u4E9A": "Bolivia", "\u745E\u5178": "Sweden", "\u745E\u58EB": "Switzerland", "\u74E6\u52AA\u963F\u56FE": "Vanuatu", "\u767D\u4FC4\u7F57\u65AF": "Belarus", "\u767E\u6155\u5927": "Bermuda", "\u798F\u514B\u5170\u7FA4\u5C9B": "Falkland Is.", "\u79D1\u5A01\u7279": "Kuwait", "\u79D1\u6469\u7F57": "Comoros", "\u79D1\u7279\u8FEA\u74E6": "C\xF4te d'Ivoire", "\u79D1\u7D22\u6C83": "Kosovo", "\u79D8\u9C81": "Peru", "\u7A81\u5C3C\u65AF": "Tunisia", "\u7ACB\u9676\u5B9B": "Lithuania", "\u7D22\u9A6C\u91CC": "Somalia", "\u7D22\u9A6C\u91CC\u5170": "Somaliland", "\u7EA6\u65E6": "Jordan", "\u7EB3\u7C73\u6BD4\u4E9A": "Namibia", "\u7EBD\u57C3": "Niue", "\u7F05\u7538": "Myanmar", "\u7F57\u9A6C\u5C3C\u4E9A": "Romania", "\u7F8E\u5229\u575A\u5408\u4F17\u56FD": "United States of America", "\u7F8E\u56FD": "United States of America", "\u7F8E\u5C5E\u7EF4\u5C14\u4EAC\u7FA4\u5C9B": "U.S. Virgin Is.", "\u7F8E\u5C5E\u8428\u6469\u4E9A": "American Samoa", "\u8001\u631D": "Laos", "\u80AF\u5C3C\u4E9A": "Kenya", "\u82AC\u5170": "Finland", "\u82CF\u4E39": "Sudan", "\u82CF\u91CC\u5357": "Suriname", "\u82F1\u56FD": "United Kingdom", "\u82F1\u5C5E\u5370\u5EA6\u6D0B\u9886\u5730": "Br. Indian Ocean Ter.", "\u82F1\u5C5E\u7EF4\u5C14\u4EAC\u7FA4\u5C9B": "British Virgin Is.", "\u8377\u5170": "Netherlands", "\u83AB\u6851\u6BD4\u514B": "Mozambique", "\u83B1\u7D22\u6258": "Lesotho", "\u83F2\u5F8B\u5BBE": "Philippines", "\u8428\u5C14\u74E6\u591A": "El Salvador", "\u8428\u6469\u4E9A": "Samoa", "\u8461\u8404\u7259": "Portugal", "\u8499\u53E4\u56FD": "Mongolia", "\u8499\u7279\u585E\u62C9\u7279": "Montserrat", "\u897F\u6492\u54C8\u62C9": "W. Sahara", "\u897F\u73ED\u7259": "Spain", "\u8BFA\u798F\u514B\u5C9B": "Norfolk Island", "\u8D1D\u5B81": "Benin", "\u8D5E\u6BD4\u4E9A": "Zambia", "\u8D64\u9053\u51E0\u5185\u4E9A": "Eq. Guinea", "\u8D6B\u5FB7\u5C9B\u548C\u9EA6\u514B\u5510\u7EB3\u7FA4\u5C9B": "Heard I. and McDonald Is.", "\u8D8A\u5357": "Vietnam", "\u9521\u4E9A\u7434\u51B0\u5DDD": "Siachen Glacier", "\u963F\u585E\u62DC\u7586": "Azerbaijan", "\u963F\u5BCC\u6C57": "Afghanistan", "\u963F\u5C14\u53CA\u5229\u4E9A": "Algeria", "\u963F\u5C14\u5DF4\u5C3C\u4E9A": "Albania", "\u963F\u62C9\u4F2F\u8054\u5408\u914B\u957F\u56FD": "United Arab Emirates", "\u963F\u66FC": "Oman", "\u963F\u6839\u5EF7": "Argentina", "\u963F\u9C81\u5DF4": "Aruba", "\u97E9\u56FD": "South Korea", "\u9999\u6E2F": "Hong Kong", "\u9A6C\u6069\u5C9B": "Isle of Man", "\u9A6C\u62C9\u7EF4": "Malawi", "\u9A6C\u6765\u897F\u4E9A": "Malaysia", "\u9A6C\u7ECD\u5C14\u7FA4\u5C9B": "Marshall Is.", "\u9A6C\u8033\u4ED6": "Malta", "\u9A6C\u8FBE\u52A0\u65AF\u52A0": "Madagascar", "\u9A6C\u91CC": "Mali", "\u9ECE\u5DF4\u5AE9": "Lebanon", "\u9ED1\u5C71": "Montenegro" } };

// src/geo.ts
var SUFFIXES = ["\u7279\u522B\u884C\u653F\u533A", "\u7EF4\u543E\u5C14\u81EA\u6CBB\u533A", "\u58EE\u65CF\u81EA\u6CBB\u533A", "\u56DE\u65CF\u81EA\u6CBB\u533A", "\u81EA\u6CBB\u533A", "\u7701", "\u5E02"];
var PUNCT = /[\s.,'’`"()\-_/·&]+/g;
var CUSTOM_KEYS = ["name", "NAME", "name_zh", "NAME_ZH", "name_en", "NAME_EN", "NAME_LONG", "ADMIN", "iso_a2", "ISO_A2", "iso_a3", "ISO_A3", "id", "code"];
function norm(s) {
  const t = String(s).toLowerCase().replace(PUNCT, "");
  for (const suf of SUFFIXES) if (t.endsWith(suf) && t.length > suf.length) return t.slice(0, -suf.length);
  return t;
}
function customIndex(geojson) {
  const feats = geojson?.features || [];
  const nameProp = CUSTOM_KEYS.find((k) => feats.some((f) => k in (f.properties || {}))) ?? "name";
  const idx = {};
  for (const k of CUSTOM_KEYS) for (const f of feats) {
    const p = f.properties || {};
    const nm = p[nameProp];
    if (p[k] === null || p[k] === void 0 || nm === null || nm === void 0) continue;
    const a = norm(p[k]);
    if (a && !(a in idx)) idx[a] = String(nm);
  }
  return [idx, nameProp];
}
function match(names, geojson) {
  const cands = [];
  if (geojson !== void 0 && geojson !== null) {
    const [idx, prop] = customIndex(geojson);
    cands.push(["x2e-custom", "custom", prop, idx]);
  }
  cands.push(["x2e-china", "china", null, GEO_INDEX.china], ["x2e-world", "world", null, GEO_INDEX.world]);
  let best = null;
  for (const [key, src, prop, idx] of cands) {
    const res = names.map((n) => n === null || n === void 0 ? null : Object.prototype.hasOwnProperty.call(idx, norm(n)) ? idx[norm(n)] : null);
    const hits = res.filter((r) => r !== null).length;
    if (hits && (best === null || hits > best[0])) best = [hits, [key, src, prop, res]];
  }
  return best ? best[1] : null;
}

// src/stats.ts
function sig(x) {
  return isFinite(x) ? Number(x.toPrecision(10)) : null;
}
function fsum(xs) {
  let s = 0;
  for (const x of xs) s += x;
  return s;
}
function mean(xs) {
  return fsum(xs) / xs.length;
}
function stdev(xs) {
  const n = xs.length;
  if (n < 2) return 0;
  const m = mean(xs);
  let s = 0;
  for (const x of xs) s += (x - m) * (x - m);
  return Math.sqrt(s / (n - 1));
}
function quantile(xs, p, method) {
  const n = xs.length;
  if (n === 1) return xs[0];
  const pos = method === "inclusive" ? p * (n - 1) : p * (n + 1) - 1;
  if (pos <= 0) return xs[0];
  if (pos >= n - 1) return xs[n - 1];
  const i = Math.floor(pos), f = pos - i;
  return xs[i] + (xs[i + 1] - xs[i]) * f;
}
function median(xs) {
  const n = xs.length;
  return n % 2 ? xs[(n - 1) / 2] : (xs[n / 2 - 1] + xs[n / 2]) / 2;
}
function linreg(xs, ys) {
  const n = xs.length;
  if (n < 2) return null;
  const sx = fsum(xs), sy = fsum(ys);
  let sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += xs[i] * xs[i];
    sxy += xs[i] * ys[i];
  }
  const den = n * sxx - sx * sx;
  if (!den) return null;
  const k = (n * sxy - sx * sy) / den;
  return [k, (sy - k * sx) / n];
}
function polyfit(xs, ys, order) {
  const m = order + 1;
  if (xs.length < m) return null;
  const a = Array.from({ length: m }, () => new Array(m + 1).fill(0));
  for (let r = 0; r < m; r++) {
    for (let c = 0; c < m; c++) {
      let s2 = 0;
      for (const x of xs) s2 += x ** (r + c);
      a[r][c] = s2;
    }
    let s = 0;
    for (let i = 0; i < xs.length; i++) s += ys[i] * xs[i] ** r;
    a[r][m] = s;
  }
  for (let col = 0; col < m; col++) {
    let piv = col;
    for (let r = col + 1; r < m; r++) if (Math.abs(a[r][col]) > Math.abs(a[piv][col])) piv = r;
    if (a[piv][col] === 0) return null;
    [a[col], a[piv]] = [a[piv], a[col]];
    for (let r = 0; r < m; r++) if (r !== col) {
      const f = a[r][col] / a[col][col];
      for (let c = col; c <= m; c++) a[r][c] -= f * a[col][c];
    }
  }
  return a.map((row, i) => row[m] / row[i]);
}
function polyval(coef, x) {
  let y = 0;
  for (let i = coef.length - 1; i >= 0; i--) y = y * x + coef[i];
  return y;
}

// src/zip.ts
var MAX_PART = 200 * 1024 * 1024;
function u16(b, o) {
  return b[o] | b[o + 1] << 8;
}
function u32(b, o) {
  return (b[o] | b[o + 1] << 8 | b[o + 2] << 16 | b[o + 3] << 24) >>> 0;
}
function listEntries(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (u32(buf, i) === 101010256) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a zip file (no end of central directory)");
  let n = u16(buf, eocd + 10), off = u32(buf, eocd + 16);
  const out = [];
  const dec = new TextDecoder("utf-8");
  for (let k = 0; k < n; k++) {
    if (u32(buf, off) !== 33639248) throw new Error("corrupt zip central directory");
    const method = u16(buf, off + 10), csize = u32(buf, off + 20), usize = u32(buf, off + 24);
    const nl = u16(buf, off + 28), el = u16(buf, off + 30), cl = u16(buf, off + 32), lho = u32(buf, off + 42);
    const name = dec.decode(buf.subarray(off + 46, off + 46 + nl));
    out.push({ name, method, csize, usize, offset: lho });
    off += 46 + nl + el + cl;
  }
  return out;
}
var inflater = null;
async function getInflater() {
  if (inflater) return inflater;
  const isNode = typeof process !== "undefined" && !!process.versions?.node;
  if (isNode) {
    const zlib = await import(
      /* webpackIgnore: true */
      "node:zlib"
    );
    inflater = async (d) => new Uint8Array(zlib.inflateRawSync(d));
  } else if (typeof globalThis.DecompressionStream !== "undefined") {
    inflater = async (d) => {
      const ds = new globalThis.DecompressionStream("deflate-raw");
      const stream = new Blob([d]).stream().pipeThrough(ds);
      return new Uint8Array(await new Response(stream).arrayBuffer());
    };
  } else throw new Error("no inflate implementation available (need Node or DecompressionStream)");
  return inflater;
}
async function readEntry(buf, e) {
  if (e.usize > MAX_PART) throw new Error(`part ${e.name} too large`);
  const o = e.offset;
  if (u32(buf, o) !== 67324752) throw new Error("corrupt zip local header");
  const start = o + 30 + u16(buf, o + 26) + u16(buf, o + 28);
  const data = buf.subarray(start, start + e.csize);
  if (e.method === 0) return data;
  if (e.method === 8) return (await getInflater())(data);
  throw new Error(`unsupported zip compression method ${e.method}`);
}
async function openZip(buf) {
  const entries = listEntries(buf);
  const files = /* @__PURE__ */ new Map(), sizes = /* @__PURE__ */ new Map();
  const dec = new TextDecoder("utf-8");
  for (const e of entries) {
    sizes.set(e.name, e.usize);
    if (/\.(xml|rels)$/i.test(e.name)) files.set(e.name, dec.decode(await readEntry(buf, e)));
  }
  return { names: entries.map((e) => e.name), files, sizes };
}

// src/workbook.ts
var NS = {
  m: "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
  r: "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
  pr: "http://schemas.openxmlformats.org/package/2006/relationships",
  a: "http://schemas.openxmlformats.org/drawingml/2006/main",
  c: "http://schemas.openxmlformats.org/drawingml/2006/chart",
  xdr: "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"
};
var R_ID = `{${NS.r}}id`;
var M = `{${NS.m}}`;
var BUILTIN_FMT = {
  0: "General",
  1: "0",
  2: "0.00",
  3: "#,##0",
  4: "#,##0.00",
  9: "0%",
  10: "0.00%",
  11: "0.00E+00",
  14: "yyyy/m/d",
  15: "d-mmm-yy",
  16: "d-mmm",
  17: "mmm-yy",
  18: "h:mm AM/PM",
  19: "h:mm:ss AM/PM",
  20: "h:mm",
  21: "h:mm:ss",
  22: "yyyy/m/d h:mm",
  37: "#,##0 ;(#,##0)",
  38: "#,##0 ;[Red](#,##0)",
  39: "#,##0.00;(#,##0.00)",
  40: "#,##0.00;[Red](#,##0.00)",
  45: "mm:ss",
  46: "[h]:mm:ss",
  47: "mmss.0",
  48: "##0.0E+0",
  49: "@",
  27: 'yyyy"\u5E74"m"\u6708"',
  28: 'm"\u6708"d"\u65E5"',
  29: 'm"\u6708"d"\u65E5"',
  30: "m-d-yy",
  31: 'yyyy"\u5E74"m"\u6708"d"\u65E5"',
  32: 'h"\u65F6"mm"\u5206"',
  33: 'h"\u65F6"mm"\u5206"ss"\u79D2"',
  34: '\u4E0A\u5348/\u4E0B\u5348h"\u65F6"mm"\u5206"',
  35: '\u4E0A\u5348/\u4E0B\u5348h"\u65F6"mm"\u5206"ss"\u79D2"',
  36: 'yyyy"\u5E74"m"\u6708"',
  50: 'yyyy"\u5E74"m"\u6708"',
  51: 'm"\u6708"d"\u65E5"',
  52: 'yyyy"\u5E74"m"\u6708"',
  53: 'm"\u6708"d"\u65E5"',
  56: '\u4E0A\u5348/\u4E0B\u5348h"\u65F6"mm"\u5206"ss"\u79D2"',
  57: 'yyyy"\u5E74"m"\u6708"',
  58: 'm"\u6708"d"\u65E5"'
};
function jnum(x) {
  return String(x);
}
function jstr(v) {
  if (v === null || v === void 0) return "";
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  return String(v);
}
function isDateFormat(code) {
  if (!code || code === "General") return false;
  const s = code.split(";")[0].replace(/"[^"]*"|\\.|\[(?!h\]|m\]|s\])[^\]]*\]/g, "");
  return /[dmyhs]/i.test(s) && !/[0#?]/.test(s);
}
function serialToDate(v, date1904 = false) {
  const base = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  if (!date1904 && v < 60) v += 1;
  return new Date(base + Math.round(v * 864e8) / 1e3);
}
var pad = (n) => (n < 10 ? "0" : "") + n;
var WD = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
var MO = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function isoLocal(d) {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}
function formatDate(v, code, date1904 = false) {
  const d = serialToDate(v, date1904);
  const c = (code || "").split(";")[0].replace(/\[[^\]]*\]/g, "");
  const noq = c.replace(/"[^"]*"/g, "");
  const hasTime = /h|s/i.test(noq);
  const hasDate = /[dy]/i.test(noq) || c.toLowerCase().includes("m") && !hasTime;
  const out = [];
  let i = 0, prevH = false;
  const lc = c;
  while (i < lc.length) {
    const ch = lc[i];
    if (ch === '"') {
      let j = lc.indexOf('"', i + 1);
      if (j < 0) j = lc.length;
      out.push(lc.slice(i + 1, j));
      i = j + 1;
      continue;
    }
    if (ch === "\\" && i + 1 < lc.length) {
      out.push(lc[i + 1]);
      i += 2;
      continue;
    }
    const m = /^(y+|m+|d+|h+|s+|AM\/PM|上午\/下午)/i.exec(lc.slice(i));
    if (m) {
      const t = m[0], tl = t.toLowerCase();
      i += t.length;
      if (tl[0] === "y") out.push(t.length > 2 ? String(d.getUTCFullYear()) : pad(d.getUTCFullYear() % 100));
      else if (tl[0] === "d") out.push(t.length === 1 ? String(d.getUTCDate()) : t.length === 2 ? pad(d.getUTCDate()) : t.length === 3 ? WD[d.getUTCDay()].slice(0, 3) : WD[d.getUTCDay()]);
      else if (tl[0] === "h") {
        prevH = true;
        let h = d.getUTCHours();
        if (/AM\/PM|上午\/下午/i.test(lc)) h = h % 12 || 12;
        out.push(t.length === 1 ? String(h) : pad(h));
      } else if (tl[0] === "s") out.push(t.length === 1 ? String(d.getUTCSeconds()) : pad(d.getUTCSeconds()));
      else if (tl[0] === "m") {
        const rest = lc.slice(i);
        const minute = prevH || /^[^dy]*s/i.test(rest) && !/[dy]/i.test(lc.slice(i, i + 3));
        if (minute && t.length <= 2) out.push(t.length === 1 ? String(d.getUTCMinutes()) : pad(d.getUTCMinutes()));
        else out.push(t.length === 1 ? String(d.getUTCMonth() + 1) : t.length === 2 ? pad(d.getUTCMonth() + 1) : t.length === 3 ? MO[d.getUTCMonth()].slice(0, 3) : MO[d.getUTCMonth()]);
        prevH = false;
      } else if (tl === "am/pm") out.push(d.getUTCHours() < 12 ? "AM" : "PM");
      else out.push(d.getUTCHours() < 12 ? "\u4E0A\u5348" : "\u4E0B\u5348");
      continue;
    }
    if (ch !== "_" && ch !== "*") out.push(ch);
    else i += 1;
    i += 1;
  }
  let s = out.join("").trim();
  if (!s || !(hasDate || hasTime)) {
    const midnight = d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0;
    s = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` + (midnight ? "" : ` ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`);
  }
  return s;
}
function fixedHalfUp(x, dec) {
  const a = Math.abs(x);
  let r;
  const s = String(a);
  if (s.includes("e")) r = Number(a.toFixed(dec));
  else {
    const [ip, fp = ""] = s.split(".");
    const digits = ip + fp.padEnd(dec + 1, "0").slice(0, dec + 1);
    let n = BigInt(digits.slice(0, digits.length - 1) || "0");
    if (+digits[digits.length - 1] >= 5) n += 1n;
    let t = n.toString().padStart(dec + 1, "0");
    return (x < 0 && /[1-9]/.test(t) ? "-" : "") + (dec ? t.slice(0, -dec) + "." + t.slice(-dec) : t);
  }
  let body = r.toFixed(dec);
  return (x < 0 && /[1-9]/.test(body) ? "-" : "") + body;
}
function formatNumber(v, code) {
  if (typeof v !== "number") return jstr(v);
  if (!code || code === "General" || code === "@") return Math.abs(v) < 1e15 ? String(Number(v.toFixed(10))) : String(v);
  const sec = code.split(";");
  let c = v < 0 && sec.length > 1 ? sec[1] : sec[0];
  const neg = v < 0 && sec.length > 1;
  c = c.replace(/\[[^\]]*\]|_.|\*.|\\|"/g, "");
  const pct2 = c.includes("%");
  let x = pct2 ? v * 100 : v;
  if (neg) x = Math.abs(x);
  const m = /[0#]+(?:[.,][0#]+)*/.exec(c);
  if (!m) return String(v);
  const pat = m[0];
  const dec = pat.includes(".") ? pat.split(".")[1].length : 0;
  let body = fixedHalfUp(x, dec);
  if (pat.split(".")[0].includes(",")) {
    const p = body.split(".");
    p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    body = p.join(".");
  }
  return c.slice(0, m.index) + body + c.slice(m.index + pat.length);
}
function normPath(p) {
  const out = [];
  for (const s of p.split("/")) {
    if (s === "" || s === ".") continue;
    if (s === "..") out.pop();
    else out.push(s);
  }
  return out.join("/");
}
var dirname = (p) => p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "";
var basename = (p) => p.slice(p.lastIndexOf("/") + 1);
var Sheet = class {
  constructor(wb, name, part) {
    this.wb = wb;
    this.name = name;
    this.part = part;
    this._cells = null;
    this.colWidths = /* @__PURE__ */ new Map();
    this.rowHeights = /* @__PURE__ */ new Map();
    this.defaultColWidth = 8.43;
    this.defaultRowHeight = 15;
    this.kind = "worksheet";
    this.state = "visible";
  }
  get cells() {
    if (!this._cells) this.load();
    return this._cells;
  }
  load() {
    this._cells = /* @__PURE__ */ new Map();
    const root = this.wb.xml(this.part);
    const fmt = root.find(M + "sheetFormatPr");
    if (fmt) {
      if (fmt.get("defaultColWidth")) this.defaultColWidth = parseFloat(fmt.get("defaultColWidth"));
      else if (fmt.get("baseColWidth")) this.defaultColWidth = parseFloat(fmt.get("baseColWidth")) + 0.71;
      if (fmt.get("defaultRowHeight")) this.defaultRowHeight = parseFloat(fmt.get("defaultRowHeight"));
    }
    for (const col of root.iter(M + "col")) {
      if (col.get("width")) for (let i = parseInt(col.get("min"), 10); i <= Math.min(parseInt(col.get("max"), 10), 300); i++) this.colWidths.set(i, parseFloat(col.get("width")));
    }
    const shared = /* @__PURE__ */ new Map();
    const sd = root.find(M + "sheetData");
    if (!sd) return;
    for (const row of sd.findall(M + "row")) {
      let rn = parseInt(row.get("r", "0") || "0", 10) || 0;
      if (row.get("ht")) this.rowHeights.set(rn, parseFloat(row.get("ht")));
      let cn = 0;
      for (const c of row.findall(M + "c")) {
        const ref = c.get("r");
        if (ref) {
          const mm = /([A-Z]+)(\d+)/.exec(ref);
          cn = col2num(mm[1]);
          rn = parseInt(mm[2], 10);
        } else cn += 1;
        const t = c.get("t", "n");
        const s = parseInt(c.get("s", "0") || "0", 10) || 0;
        const ve = c.find(M + "v"), fe = c.find(M + "f");
        let val = null;
        if (t === "inlineStr") {
          const ie = c.find(M + "is");
          val = ie ? [...ie.iter(M + "t")].map((x) => x.text ?? "").join("") : "";
        } else if (ve && ve.text !== null) {
          const txt2 = ve.text;
          if (t === "s") {
            const k = Number(txt2);
            val = Number.isInteger(k) && k >= 0 && k < this.wb.sharedStrings.length ? this.wb.sharedStrings[k] : null;
          } else if (t === "str" || t === "e") val = t === "str" ? txt2 : null;
          else if (t === "b") val = txt2 === "1";
          else {
            const x = txt2.trim() === "" ? NaN : Number(txt2);
            val = isNaN(x) ? txt2 : x;
          }
        }
        let formula = null;
        if (fe) {
          if (fe.get("t") === "shared" && fe.get("si") !== void 0) {
            const si = fe.get("si");
            if (fe.text) {
              shared.set(si, [fe.text, rn, cn]);
              formula = fe.text;
            } else if (shared.has(si)) {
              const [f0, r0, c0] = shared.get(si);
              formula = shiftFormula(f0, rn - r0, cn - c0);
            }
          } else if (fe.text) formula = fe.text;
        }
        const hasCache = ve !== null && ve.text !== null || t === "inlineStr";
        this._cells.set(`${rn},${cn}`, [val, hasCache ? null : formula, s]);
      }
    }
  }
  colPx(c) {
    const w = this.colWidths.get(c) ?? this.defaultColWidth;
    return w > 0 ? Math.trunc(w * 7 + 5) : 0;
  }
  rowPx(r) {
    return (this.rowHeights.get(r) ?? this.defaultRowHeight) * 4 / 3;
  }
};
var Workbook = class _Workbook {
  constructor() {
    this.names = [];
    this.files = /* @__PURE__ */ new Map();
    this.sizes = /* @__PURE__ */ new Map();
    this.sharedStrings = [];
    this.numfmts = {};
    this.xfFmt = [];
    this.theme = {};
    this.sheets = /* @__PURE__ */ new Map();
    this.sheetOrder = [];
    this.date1904 = false;
    this.definedNames = /* @__PURE__ */ new Map();
    this.evaluating = /* @__PURE__ */ new Set();
    this.memo = /* @__PURE__ */ new Map();
    this.evaluatedFormulas = 0;
    this.failedFormulas = [];
    this.xmlCache = /* @__PURE__ */ new Map();
    this.value = (sheetName, r, c) => {
      const sh = this.sheet(sheetName);
      if (!sh || sh.kind !== "worksheet") return null;
      const cell = sh.cells.get(`${r},${c}`);
      if (!cell) return null;
      const [val, formula] = cell;
      if (formula === null) return val;
      const key = `${sh.name}\0${r},${c}`;
      if (this.memo.has(key)) return this.memo.get(key);
      if (this.evaluating.has(key) || this.evaluating.size > 200) throw new FormulaError("#CIRC!");
      this.evaluating.add(key);
      let v;
      try {
        v = new Evaluator(this.value).evaluate(formula, sh.name);
        this.evaluatedFormulas++;
      } catch (e) {
        if (e instanceof RangeError) e = new FormulaError("maximum recursion depth exceeded");
        this.failedFormulas.push(`${sh.name}!${num2col(c)}${r}: =${formula} (${e instanceof FormulaError ? e.message : "#VALUE!"})`);
        v = null;
      } finally {
        this.evaluating.delete(key);
      }
      if (typeof v === "number" && !isFinite(v)) v = null;
      this.memo.set(key, v);
      return v;
    };
  }
  static async open(buf) {
    const wb = new _Workbook();
    const z = await openZip(buf);
    wb.names = z.names;
    wb.files = z.files;
    wb.sizes = z.sizes;
    wb.sharedStrings = wb.loadSst();
    [wb.numfmts, wb.xfFmt] = wb.loadStyles();
    wb.theme = wb.loadTheme();
    wb.loadWorkbook();
    return wb;
  }
  has(name) {
    return this.files.has(name);
  }
  xml(part) {
    let e = this.xmlCache.get(part);
    if (!e) {
      const s = this.files.get(part);
      if (s === void 0) throw new Error(`missing part ${part}`);
      e = parseXML(s);
      if (!part.includes("worksheets/")) this.xmlCache.set(part, e);
    }
    return e;
  }
  raw(part) {
    return this.files.get(part) ?? "";
  }
  rels(part) {
    const d = dirname(part), b = basename(part);
    const rp = (d ? d + "/" : "") + "_rels/" + b + ".rels";
    const out = /* @__PURE__ */ new Map();
    if (!this.files.has(rp)) return out;
    for (const rel of this.xml(rp).findall(`{${NS.pr}}Relationship`)) {
      const tgt = rel.get("Target", "");
      if (rel.get("TargetMode") === "External") continue;
      const full = tgt.startsWith("/") ? tgt.replace(/^\/+/, "") : normPath((d ? d + "/" : "") + tgt);
      const typ = rel.get("Type", "");
      out.set(rel.get("Id"), [full, typ.slice(typ.lastIndexOf("/") + 1)]);
    }
    return out;
  }
  loadSst() {
    const p = "xl/sharedStrings.xml";
    if (!this.files.has(p)) return [];
    const out = [];
    for (const si of this.xml(p).findall(M + "si")) {
      const skip = /* @__PURE__ */ new Set();
      for (const rph of si.findall(M + "rPh")) for (const x of rph.iter()) skip.add(x);
      out.push([...si.iter(M + "t")].filter((t) => !skip.has(t)).map((t) => t.text ?? "").join(""));
    }
    return out;
  }
  loadStyles() {
    const fmts = { ...BUILTIN_FMT };
    let xf = [];
    const p = "xl/styles.xml";
    if (this.files.has(p)) {
      const root = this.xml(p);
      const nf = root.find(M + "numFmts");
      if (nf) for (const f of nf.findall(M + "numFmt")) fmts[parseInt(f.get("numFmtId"), 10)] = f.get("formatCode");
      const cx = root.find(M + "cellXfs");
      if (cx) xf = cx.findall(M + "xf").map((x) => parseInt(x.get("numFmtId", "0") || "0", 10) || 0);
    }
    return [fmts, xf];
  }
  loadTheme() {
    const colors = { dk1: "000000", lt1: "FFFFFF", dk2: "44546A", lt2: "E7E6E6", accent1: "4472C4", accent2: "ED7D31", accent3: "A5A5A5", accent4: "FFC000", accent5: "5B9BD5", accent6: "70AD47", hlink: "0563C1", folHlink: "954F72" };
    for (const name of this.names) {
      if (/^xl\/theme\/theme\d*\.xml$/.test(name) && this.files.has(name)) {
        const cs = this.xml(name).find(`.//{${NS.a}}clrScheme`);
        if (cs) for (const el of cs.children) {
          const tag = el.tag.slice(el.tag.indexOf("}") + 1);
          for (const sub of el.children) {
            const v = sub.tag.endsWith("srgbClr") ? sub.get("val") : sub.get("lastClr");
            if (v) colors[tag] = v;
          }
        }
        break;
      }
    }
    return colors;
  }
  loadWorkbook() {
    const root = this.xml("xl/workbook.xml");
    const rels = this.rels("xl/workbook.xml");
    const pr = root.find(M + "workbookPr");
    if (pr && (pr.get("date1904") === "1" || pr.get("date1904") === "true")) this.date1904 = true;
    for (const s of root.findall(`${M}sheets/${M}sheet`)) {
      const rid = s.get(R_ID);
      if (rels.has(rid)) {
        const [part, typ] = rels.get(rid);
        const sh = new Sheet(this, s.get("name"), part);
        sh.kind = typ;
        sh.state = s.get("state", "visible");
        this.sheets.set(sh.name, sh);
        this.sheetOrder.push(sh);
      }
    }
    for (const dn of root.findall(`${M}definedNames/${M}definedName`)) if (dn.text && dn.get("localSheetId") === void 0) this.definedNames.set(dn.get("name"), dn.text);
  }
  numfmt(i) {
    const id = this.xfFmt[i];
    return id === void 0 ? "General" : this.numfmts[id] ?? "General";
  }
  sheet(name) {
    if (this.sheets.has(name)) return this.sheets.get(name);
    for (const [k, v] of this.sheets) if (k.toLowerCase() === (name || "").toLowerCase()) return v;
    return void 0;
  }
  style(sheetName, r, c) {
    const sh = this.sheet(sheetName);
    if (!sh) return "General";
    const cell = sh.cells.get(`${r},${c}`);
    return cell ? this.numfmt(cell[2]) : "General";
  }
};

// src/chartex.ts
var CXNS = "http://schemas.microsoft.com/office/drawing/2014/chartex";
var CX = `{${CXNS}}`;
var A2 = "{http://schemas.openxmlformats.org/drawingml/2006/main}";
var FONT = "Calibri, 'Microsoft YaHei', 'PingFang SC', sans-serif";
var isNum2 = (x) => typeof x === "number";
function toF(s, d = null) {
  if (s === null || s === void 0 || s.trim() === "") return d;
  const v = Number(s.trim());
  return isNaN(v) ? d : v;
}
function boolAttr(el, name, def) {
  if (!el || el.get(name) === void 0) return def;
  const v = el.get(name);
  return v === "1" || v === "true";
}
var ChartEx = class _ChartEx {
  constructor(h) {
    this.h = h;
    this.data = /* @__PURE__ */ new Map();
    this.axes = /* @__PURE__ */ new Map();
    this.option = {};
    this.legendData = null;
    this.wb = h.wb;
    this.root = h.root;
    this.theme = h.theme;
    this.warnings = h.warnings;
  }
  refLevels(f, num2, byRow) {
    f = f.trim();
    if (this.wb.definedNames.has(f)) f = this.wb.definedNames.get(f);
    let sp;
    try {
      sp = splitRef(f);
    } catch (e) {
      if (!(e instanceof FormulaError)) throw e;
      this.warnings.push(`cannot resolve reference ${pyrepr(f)}`);
      return [[], null];
    }
    const [sheet, r1, c1, r2, c2] = sp;
    if (sheet === null || (r2 - r1 + 1) * (c2 - c1 + 1) > 1e5) {
      this.warnings.push(`cannot resolve reference ${pyrepr(f)}`);
      return [[], null];
    }
    this.h.usedFormulaFallback = true;
    const grid = [];
    for (let r = r1; r <= r2; r++) {
      const row = [];
      for (let c = c1; c <= c2; c++) row.push(this.wb.value(sheet, r, c));
      grid.push(row);
    }
    let lines;
    if (r1 === r2) lines = [grid[0]];
    else if (c1 === c2) lines = [grid.map((row) => row[0])];
    else if (byRow) lines = grid;
    else lines = Array.from({ length: c2 - c1 + 1 }, (_, j) => grid.map((row) => row[j]));
    const out = lines.slice().reverse().map((ln) => num2 ? ln.map((v) => isNum2(v) ? v : null) : ln.map((v) => v === null || jstr(v) === "" ? null : jstr(v)));
    return [out, num2 ? this.h.refFormat(f) : null];
  }
  dim(d) {
    const num2 = d.tag === CX + "numDim";
    let levels = [], fmt = null;
    for (const lvl of d.findall(CX + "lvl")) {
      const pts = lvl.findall(CX + "pt");
      let n = parseInt(lvl.get("ptCount") || "0", 10) || 0;
      if (!n && pts.length) n = Math.max(...pts.map((p) => parseInt(p.get("idx"), 10))) + 1;
      const arr = new Array(n).fill(null);
      for (const p of pts) {
        const i = parseInt(p.get("idx"), 10);
        if (i < n) arr[i] = num2 ? toF(p.text) : p.text ?? null;
      }
      if (fmt === null && lvl.get("formatCode")) fmt = lvl.get("formatCode");
      levels.push(arr);
    }
    const fe = d.find(CX + "f");
    const ftxt = fe ? (fe.text || "").trim() : "";
    if (!levels.some((lv) => lv.some((v) => v !== null)) && fe && ftxt) {
      const [lv, rf] = this.refLevels(fe.text, num2, fe.get("dir") === "row");
      levels = lv;
      fmt = fmt || rf;
    } else if (num2 && (fmt === null || fmt === "General") && fe && ftxt) fmt = this.h.refFormat(ftxt) || fmt;
    return { type: d.get("type") ?? null, num: num2, levels, fmt };
  }
  text(tx) {
    if (!tx) return null;
    const td = tx.find(CX + "txData");
    if (td) {
      const v = td.findtext(CX + "v");
      if (v !== null) return v;
      const f = td.findtext(CX + "f");
      if (f) {
        const [vals] = this.h.resolveRef(f);
        return vals.filter((x) => x !== null).map(jstr).join(" ");
      }
    }
    const rich = tx.find(CX + "rich");
    if (rich) return rich.findall(A2 + "p").map((p) => [...p.iter(A2 + "t")].map((t) => t.text || "").join("")).join("\n");
    return null;
  }
  font(el, pt, bold = false) {
    return this.h.font(el ? el.find(CX + "txPr") : null, pt, bold);
  }
  convert() {
    const root = this.root;
    const cd = root.find(CX + "chartData");
    for (const d of cd ? cd.findall(CX + "data") : []) this.data.set(d.get("id"), d.children.filter((x) => x.tag === CX + "numDim" || x.tag === CX + "strDim").map((x) => this.dim(x)));
    const ch = root.find(CX + "chart");
    const pa = ch ? ch.find(CX + "plotArea") : null;
    const region = pa ? pa.find(CX + "plotAreaRegion") : null;
    const sers = (region ? region.findall(CX + "series") : []).filter((s) => !boolAttr(s, "hidden", false));
    for (const a of pa ? pa.findall(CX + "axis") : []) this.axes.set(a.get("id"), a);
    const types = [];
    for (const s of sers) {
      const l = s.get("layoutId") ?? null;
      if (!types.includes(l)) types.push(l);
    }
    const sp = root.find(CX + "spPr");
    this.option = { backgroundColor: noFill(sp) ? "transparent" : fillColor(sp, this.theme) || "#FFFFFF", textStyle: { fontFamily: FONT }, tooltip: { trigger: "item" }, series: [] };
    const te = ch ? ch.find(CX + "title") : null;
    if (te) {
      let text = this.text(te.find(CX + "tx"));
      if (text === null) text = "Chart Title";
      if (text) this.option.title = { text, left: "center", top: 6, textStyle: this.font(te, 14) };
    }
    const kind = types.length ? types[0] : null;
    const map = { waterfall: this.waterfall, treemap: this.treemap, sunburst: this.sunburst, clusteredColumn: this.histogram, paretoLine: this.histogram, funnel: this.funnel, boxWhisker: this.box, regionMap: null };
    if (kind === null) {
      this.warnings.push("chartEx without series");
      return { types, option: null, warnings: this.warnings };
    }
    let fn = kind in map ? map[kind] : void 0;
    if (fn === null) {
      if (!this.regionMap(sers)) return { types, option: null, warnings: this.warnings };
      fn = () => {
      };
    }
    if (fn === void 0) {
      this.warnings.push(`chartEx layout ${pyrepr(kind)} is not supported \u2014 rendered as column chart`);
      fn = this.histogram;
    }
    fn.call(this, sers);
    this.legend(ch && kind !== "regionMap" ? ch.find(CX + "legend") : null);
    if ("grid" in this.option) {
      const g = this.option.grid;
      if ("title" in this.option) g.top += 26;
      const leg = this.option.legend;
      if (leg.show) {
        const p = leg._pos;
        delete leg._pos;
        if (p === "t") g.top += 28;
        else if (p === "b") g.bottom += 28;
        else if (p === "r") g.right = 130;
        else if (p === "l") g.left = 130;
      }
    }
    delete this.option.legend._pos;
    if (this.h.formats.length) this.option["x-numFmt"] = this.h.formats;
    return { types, option: this.option, warnings: this.warnings };
  }
  legend(lg) {
    if (!lg) {
      this.option.legend = { show: false };
      return;
    }
    const pos = lg.get("pos", "t");
    const font = this.font(lg, 9);
    const e = { show: true, _pos: pos, textStyle: { color: font.color, fontSize: font.fontSize }, itemWidth: 10, itemHeight: 10 };
    if (pos === "l" || pos === "r") Object.assign(e, { orient: "vertical", top: "middle", ...pos === "r" ? { right: 10 } : { left: 10 } });
    else if (pos === "b") Object.assign(e, { orient: "horizontal", bottom: 8, left: "center" });
    else Object.assign(e, { orient: "horizontal", top: "title" in this.option ? 40 : 8, left: "center" });
    const ld = this.legendData;
    if (ld !== null) {
      if (!ld.length) {
        this.option.legend = { show: false };
        return;
      }
      e.data = ld;
    }
    this.option.legend = e;
  }
  regionMap(sers) {
    const s = sers[0];
    const [cat, val] = this.seriesDims(s);
    const vals = val && val.levels.length ? val.levels[0] : [];
    let names = cat && cat.levels.length ? [...cat.levels[0]] : [];
    names = names.slice(0, vals.length);
    while (names.length < vals.length) names.push(null);
    const gj = this.wb.geojson;
    const m = match(names, gj);
    if (m === null) {
      this.warnings.push("regionMap: none of the region names matched " + (gj !== void 0 && gj !== null ? "the supplied GeoJSON or " : "") + "the bundled China-province / world-country maps \u2014 supply your own GeoJSON (geojson option / --geojson)");
      return false;
    }
    const [key, src, prop, res] = m;
    const data = [], unmatched = [];
    const lp = s.find(CX + "layoutPr");
    const rl = lp ? lp.find(CX + "regionLabelLayout") : null;
    const showLab = (rl ? rl.get("val") : "bestFitOnly") !== "none";
    names.forEach((nm, k) => {
      const f = res[k], v = vals[k];
      if (f === null) {
        if (nm !== null && nm !== void 0) unmatched.push(jstr(nm));
        return;
      }
      const d = { name: f, value: v };
      if (showLab) d.label = { show: true };
      data.push(d);
    });
    if (unmatched.length) this.warnings.push(`regionMap: ${unmatched.length} region name(s) not found on the ${src} map: ` + unmatched.slice(0, 10).join(", ") + (unmatched.length > 10 ? " \u2026" : ""));
    const c = this.color(s, 0);
    let colors = null;
    const vc = lp ? lp.find(CX + "valueColors") : null;
    if (vc) {
      const cs = [];
      for (const t of ["minColor", "midColor", "maxColor"]) {
        const el = vc.find(CX + t);
        const col = el && el.length ? resolveColor(el.children[0], this.theme) : null;
        if (col) cs.push(col);
      }
      if (cs.length >= 2) colors = cs;
    }
    if (colors === null) {
      const rgb = c.startsWith("#") && c.length === 7 ? [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)) : [68, 114, 196];
      colors = ["#" + rgb.map((x) => (x + Math.floor(((255 - x) * 85 + 50) / 100)).toString(16).toUpperCase().padStart(2, "0")).join(""), c];
    }
    const nums = data.map((d) => d.value).filter((v) => typeof v === "number");
    let mn = nums.length ? Math.min(...nums) : 0, mx = nums.length ? Math.max(...nums) : 1;
    if (mx === mn) mx = mn + 1;
    const e = { name: this.name(s, 0), type: "map", map: key };
    if (prop && prop !== "name") e.nameProperty = prop;
    const lab = this.labelsVis(s);
    Object.assign(e, { roam: true, showLegendSymbol: false, data, label: { show: false, fontSize: 10, color: "#404040" }, itemStyle: { areaColor: "#F2F2F2", borderColor: "#A6A6A6", borderWidth: 0.5 }, emphasis: { label: { show: true }, itemStyle: { areaColor: "#FFE699" } } });
    this.option.series.push(e);
    this.option.visualMap = { type: "continuous", min: mn, max: mx, calculable: false, left: 10, bottom: 10, inRange: { color: colors }, textStyle: { color: "#595959" } };
    const fmt = lab && lab.fmt || (val ? val.fmt : null);
    if (fmt && fmt !== "General") this.h.formats.push({ path: "series.0.tooltip", formatCode: fmt, tooltip: true });
    this.option["x-geo"] = { map: key, source: src };
    return true;
  }
  seriesDims(s) {
    const did = s.find(CX + "dataId");
    const dims = this.data.get(did ? did.get("val") : void 0) || [];
    const cat = dims.find((d) => d.type === "cat") ?? null;
    let val = dims.find((d) => d.type === "val" || d.type === "size") ?? null;
    if (!val) val = dims.find((d) => d.num && d.type !== "cat") ?? null;
    return [cat, val];
  }
  name(s, i) {
    const t = this.text(s.find(CX + "tx"));
    return t ? t : `Series${i + 1}`;
  }
  color(s, i) {
    return fillColor(s.find(CX + "spPr"), this.theme) || this.h.autoColor(i);
  }
  dpts(s) {
    const out = /* @__PURE__ */ new Map();
    for (const dp of s.findall(CX + "dataPt")) {
      const c = fillColor(dp.find(CX + "spPr"), this.theme);
      if (c) out.set(parseInt(dp.get("idx", "0"), 10), c);
    }
    return out;
  }
  labelsVis(s) {
    const dl = s.find(CX + "dataLabels");
    if (!dl) return null;
    const vis = dl.find(CX + "visibility");
    const fl = { value: boolAttr(vis, "value", true), categoryName: boolAttr(vis, "categoryName", false), seriesName: boolAttr(vis, "seriesName", false) };
    if (!(fl.value || fl.categoryName || fl.seriesName)) return null;
    const nf = dl.find(CX + "numFmt");
    fl.fmt = nf && (nf.get("sourceLinked") === "0" || nf.get("sourceLinked") === "false") ? nf.get("formatCode") ?? null : null;
    fl.pos = dl.get("pos") ?? null;
    fl.font = this.font(dl, 9);
    return fl;
  }
  static flatCats(cat, n) {
    if (!cat || !cat.levels.length) return Array.from({ length: n }, (_, i) => String(i + 1));
    const lv = cat.levels;
    const outer = lv.slice(1).map((x) => x.slice());
    for (const o of outer) {
      let last = null;
      for (let i = 0; i < o.length; i++) {
        if (o[i] === null) o[i] = last;
        last = o[i];
      }
    }
    const out = [];
    for (let i = 0; i < n; i++) {
      const parts = outer.slice().reverse().filter((o) => i < o.length && o[i]).map((o) => o[i]);
      const leaf = i < lv[0].length ? lv[0][i] : null;
      parts.push(leaf !== null ? jstr(leaf) : "");
      out.push(outer.length ? parts.filter((p) => p).join(" ") : leaf !== null ? jstr(leaf) : "");
    }
    return out;
  }
  axis(aid, kind, data = null, fmt = null, dim = "x") {
    const ax = this.axes.get(aid) ?? null;
    const hidden = boolAttr(ax, "hidden", false);
    const ticks = !!ax && !!ax.find(CX + "tickLabels");
    const font = this.font(ax, 9);
    const e = { type: kind, show: !hidden, axisLabel: { show: ticks || !ax, color: font.color, fontSize: font.fontSize }, axisTick: { show: false }, axisLine: { show: kind === "category", lineStyle: { color: "#D9D9D9" } } };
    const mg = !!ax && !!ax.find(CX + "majorGridlines");
    e.splitLine = { show: mg, lineStyle: { color: "#D9D9D9" } };
    if (kind === "category") e.data = data || [];
    else {
      const sc = ax ? ax.find(CX + "valScaling") : null;
      for (const k of ["min", "max"]) {
        const v = sc && sc.get(k) !== void 0 && sc.get(k) !== "auto" ? toF(sc.get(k)) : null;
        if (v !== null) e[k] = v;
      }
      const nf = ax ? ax.find(CX + "numFmt") : null;
      const code = nf && (nf.get("sourceLinked") === "0" || nf.get("sourceLinked") === "false") ? nf.get("formatCode") ?? null : fmt;
      if (code && code !== "General") this.h.fmtHook(`${dim}Axis.axisLabel`, code);
    }
    const te = ax ? ax.find(CX + "title") : null;
    if (te) {
      const t = this.text(te.find(CX + "tx"));
      if (t) Object.assign(e, { name: t, nameLocation: "middle", nameGap: dim === "x" ? 32 : 48, nameTextStyle: this.font(te, 10) });
    }
    return e;
  }
  gap(def) {
    const ax = this.axes.get("0");
    const sc = ax ? ax.find(CX + "catScaling") : null;
    let g = sc && sc.get("gapWidth") !== void 0 && sc.get("gapWidth") !== "auto" ? toF(sc.get("gapWidth")) : null;
    if (g === null) g = def;
    return `${jnum(pyRound(g / (1 + g) * 100, 2))}%`;
  }
  grid() {
    this.option.grid = { left: 16, right: 24, top: 24, bottom: 16, containLabel: true };
    this.option.tooltip = { trigger: "axis", axisPointer: { type: "shadow" } };
  }
  labelText(lab, cat, sname, v, fmt) {
    const parts = [];
    if (lab.seriesName) parts.push(sname);
    if (lab.categoryName) parts.push(cat);
    if (lab.value) parts.push(formatNumber(v, fmt));
    return parts.join(", ");
  }
  waterfall(sers) {
    const s = sers[0];
    const [cat, val] = this.seriesDims(s);
    const vals = val && val.levels.length ? val.levels[0] : [];
    const n = vals.length, cats = _ChartEx.flatCats(cat, n);
    const lp = s.find(CX + "layoutPr");
    const subs = /* @__PURE__ */ new Set();
    const st = lp ? lp.find(CX + "subtotals") : null;
    for (const ix of st ? st.findall(CX + "idx") : []) subs.add(parseInt(ix.get("val"), 10));
    const vis = lp ? lp.find(CX + "visibility") : null;
    const connectors = boolAttr(vis, "connectorLines", false);
    const dpts = this.dpts(s);
    const colors = { inc: this.h.autoColor(0), dec: this.h.autoColor(1), tot: this.h.autoColor(2) };
    const names = { inc: "Increase", dec: "Decrease", tot: "Total" };
    const lab = this.labelsVis(s);
    const fmt = (lab || {}).fmt || (val ? val.fmt : null);
    const baseP = [], baseN = [];
    const seg2 = { inc: [[], []], dec: [[], []], tot: [[], []] };
    let running = 0;
    const ends = [], used = [];
    for (let j = 0; j < n; j++) {
      const v = vals[j] !== null ? vals[j] : 0;
      let a, b, k;
      if (subs.has(j)) {
        a = 0;
        b = v;
        k = "tot";
        running = v;
      } else {
        a = running;
        b = running + v;
        running = running + v;
        k = v >= 0 ? "inc" : "dec";
      }
      ends.push(running);
      const [lo, hi] = a <= b ? [a, b] : [b, a];
      if (!used.includes(k)) used.push(k);
      let bp, bn, pp, nn;
      if (lo >= 0) [bp, bn, pp, nn] = [lo, null, hi - lo, null];
      else if (hi <= 0) [bp, bn, pp, nn] = [null, hi, null, lo - hi];
      else [bp, bn, pp, nn] = [0, 0, hi, lo];
      baseP.push(bp !== null ? sig(bp) : null);
      baseN.push(bn !== null ? sig(bn) : null);
      for (const kk of Object.keys(seg2)) {
        if (kk === k) {
          const itemP = pp !== null ? { value: sig(pp) } : null, itemN = nn !== null ? { value: sig(nn) } : null;
          const col = dpts.get(j);
          for (const it of [itemP, itemN]) if (it && col) it.itemStyle = { color: col };
          if (lab) {
            const txt2 = this.labelText(lab, cats[j], names[k], v, fmt);
            const tgt = v >= 0 && itemP !== null || itemN === null ? itemP : itemN;
            tgt.label = { show: true, formatter: txt2, position: tgt === itemP ? "top" : "bottom" };
          }
          seg2[kk][0].push(itemP);
          seg2[kk][1].push(itemN);
        } else {
          seg2[kk][0].push(null);
          seg2[kk][1].push(null);
        }
      }
    }
    this.grid();
    this.option.xAxis = this.axis("0", "category", cats);
    this.option.yAxis = this.axis("1", "value", null, val ? val.fmt : null, "y");
    const gap = this.gap(0.5);
    const base = { type: "bar", stack: "wf", silent: true, itemStyle: { color: "transparent" }, emphasis: { disabled: true }, tooltip: { show: false } };
    const out = [{ ...base, name: "", data: baseP, barCategoryGap: gap }];
    if (baseN.some((v) => v !== null)) out.push({ ...base, name: "", data: baseN });
    for (const k of ["inc", "dec", "tot"]) {
      if (!used.includes(k)) continue;
      const e = { name: names[k], type: "bar", stack: "wf", data: seg2[k][0], itemStyle: { color: colors[k] } };
      if (lab) e.label = { show: false, color: lab.font.color, fontSize: lab.font.fontSize };
      if (seg2[k][0].some((x) => x !== null)) out.push({ ...e, data: seg2[k][0] });
      if (seg2[k][1].some((x) => x !== null)) out.push({ ...e, data: seg2[k][1] });
    }
    if (connectors && n > 1)
      out[0].markLine = {
        silent: true,
        symbol: "none",
        lineStyle: { color: "#A6A6A6", type: "solid", width: 1 },
        label: { show: false },
        data: Array.from({ length: n - 1 }, (_, j) => [{ coord: [j, sig(ends[j])] }, { coord: [j + 1, sig(ends[j])] }])
      };
    this.option.series = out;
    this.legendData = ["inc", "dec", "tot"].filter((k) => used.includes(k)).map((k) => names[k]);
    this.option.tooltip = { trigger: "item" };
  }
  funnel(sers) {
    const s = sers[0];
    const [cat, val] = this.seriesDims(s);
    const vals = val && val.levels.length ? val.levels[0] : [];
    const n = vals.length, cats = _ChartEx.flatCats(cat, n);
    let mx = 0;
    for (const v of vals) if (v !== null && Math.abs(v) > mx) mx = Math.abs(v);
    const color = this.color(s, 0), dpts = this.dpts(s), lab = this.labelsVis(s);
    const fmt = (lab || {}).fmt || (val ? val.fmt : null);
    const pad3 = [], data = [];
    vals.forEach((v, j) => {
      const a = v !== null ? Math.abs(v) : 0;
      pad3.push(sig((mx - a) / 2));
      const it = { value: a };
      if (dpts.get(j)) it.itemStyle = { color: dpts.get(j) };
      if (lab) it.label = { formatter: this.labelText(lab, cats[j], this.name(s, 0), v !== null ? v : 0, fmt) };
      data.push(it);
    });
    this.grid();
    this.option.grid.left = 16;
    this.option.xAxis = { type: "value", show: false, min: 0, max: mx || 1 };
    const ya = this.axis("0", "category", cats, null, "y");
    ya.inverse = true;
    ya.axisLine = { show: false };
    this.option.yAxis = ya;
    const gap = this.gap(0.06);
    const e = { name: this.name(s, 0), type: "bar", stack: "funnel", data, itemStyle: { color }, barCategoryGap: gap };
    if (lab) e.label = { show: true, position: "inside", color: "#FFFFFF", fontSize: lab.font.fontSize };
    this.option.series = [{ name: "", type: "bar", stack: "funnel", data: pad3, silent: true, itemStyle: { color: "transparent" }, emphasis: { disabled: true }, tooltip: { show: false }, barCategoryGap: gap }, e];
    this.legendData = [e.name];
  }
  tree(s) {
    const [cat, val] = this.seriesDims(s);
    const vals = val && val.levels.length ? val.levels[0] : [];
    const levels = cat ? cat.levels : [];
    const L = levels.length;
    const roots = [];
    let prev = [];
    vals.forEach((v, i) => {
      const raw = Array.from({ length: L }, (_, d) => i < levels[L - 1 - d].length ? levels[L - 1 - d][i] : null);
      const blank = (x) => x === null || x === "";
      let k = -1;
      for (let d = 0; d < L; d++) if (!blank(raw[d])) k = d;
      if (k < 0 || v === null || v <= 0) return;
      const path = [];
      for (let d = 0; d <= k; d++) path.push(jstr(!blank(raw[d]) ? raw[d] : d < prev.length ? prev[d] : ""));
      prev = path;
      let lst = roots, node = null;
      for (const nm of path) {
        node = lst.find((x) => x.name === nm) ?? null;
        if (!node) {
          node = { name: nm, own: 0, children: [] };
          lst.push(node);
        }
        lst = node.children;
      }
      node.own += v;
    });
    return [roots, val];
  }
  finishTree(nodes, color = null, depth = 0) {
    return nodes.map((nd, i) => {
      const c = color || this.h.autoColor(i);
      const kids = this.finishTree(nd.children, c, depth + 1);
      let tot = nd.own;
      for (const k of kids) tot += k.value;
      const e = { name: nd.name, value: sig(tot), itemStyle: { color: c } };
      if (kids.length) e.children = kids;
      return e;
    });
  }
  treemap(sers) {
    const s = sers[0];
    const [roots, val] = this.tree(s);
    const data = this.finishTree(roots);
    const lp = s.find(CX + "layoutPr");
    const pll = lp ? lp.find(CX + "parentLabelLayout") : null;
    const mode = pll ? pll.get("val") : "overlapping";
    const lab = this.labelsVis(s) || { value: false, categoryName: true, seriesName: false, fmt: null, font: { fontSize: 12, color: "#FFFFFF" } };
    const fmt = lab.fmt || (val ? val.fmt : null);
    const parts = [...lab.categoryName || !lab.value ? ["{b}"] : [], ...lab.value ? ["{c}"] : []];
    const label = { show: true, formatter: parts.join("\n"), color: "#FFFFFF", fontSize: lab.font.fontSize, position: "insideTopLeft", overflow: "truncate" };
    const e = {
      name: this.name(s, 0),
      type: "treemap",
      data,
      roam: false,
      nodeClick: false,
      breadcrumb: { show: false },
      left: 8,
      right: 8,
      bottom: 8,
      top: "title" in this.option ? 40 : 8,
      label,
      upperLabel: { show: mode !== "none", height: 20, color: "#404040", fontSize: lab.font.fontSize, fontWeight: "bold" },
      itemStyle: { borderColor: "#FFFFFF", borderWidth: 1, gapWidth: 1 },
      levels: [{ itemStyle: { borderWidth: 0, gapWidth: 3 }, upperLabel: { show: false } }, { itemStyle: { borderColor: "#FFFFFF", borderWidth: 2, gapWidth: 1 } }, { itemStyle: { borderColor: "#FFFFFF", borderWidth: 1, gapWidth: 1 } }]
    };
    if (lab.value && fmt && fmt !== "General") this.h.fmtHook("series.0.label", fmt);
    this.option.series = [e];
    this.legendData = [];
  }
  sunburst(sers) {
    const s = sers[0];
    const [roots, val] = this.tree(s);
    const data = this.finishTree(roots);
    const lab = this.labelsVis(s) || { value: false, categoryName: true, seriesName: false, fmt: null, font: { fontSize: 12, color: "#FFFFFF" } };
    const parts = [...lab.categoryName || !lab.value ? ["{b}"] : [], ...lab.value ? ["{c}"] : []];
    const e = {
      name: this.name(s, 0),
      type: "sunburst",
      data,
      radius: ["0%", "78%"],
      center: ["50%", "title" in this.option ? "55%" : "50%"],
      sort: null,
      nodeClick: false,
      itemStyle: { borderColor: "#FFFFFF", borderWidth: 1 },
      label: { show: true, formatter: parts.join("\n"), rotate: "radial", color: "#FFFFFF", fontSize: lab.font.fontSize, minAngle: 6 }
    };
    const fmt = lab.fmt || (val ? val.fmt : null);
    if (lab.value && fmt && fmt !== "General") this.h.fmtHook("series.0.label", fmt);
    this.option.series = [e];
    this.legendData = [];
  }
  histogram(sers) {
    const bar = sers.find((s) => s.get("layoutId") !== "paretoLine") ?? sers[0];
    const pareto = sers.some((s) => s.get("layoutId") === "paretoLine");
    const [cat, val] = this.seriesDims(bar);
    const vals = val && val.levels.length ? val.levels[0] : [];
    const fmt = val ? val.fmt : null;
    const lp = bar.find(CX + "layoutPr");
    const binning = lp ? lp.find(CX + "binning") : null;
    let agg = !!lp && !!lp.find(CX + "aggregation");
    if (bar.get("layoutId") !== "clusteredColumn" || !binning && (agg || cat !== null)) agg = true;
    let labels = [], counts = [];
    if (agg) {
      const catsAll = _ChartEx.flatCats(cat, vals.length);
      const sums = [];
      for (let i = 0; i < Math.min(catsAll.length, vals.length); i++) {
        const c = catsAll[i], v = vals[i];
        if (v === null) continue;
        const ix = labels.indexOf(c);
        if (ix >= 0) sums[ix] += v;
        else {
          labels.push(c);
          sums.push(v);
        }
      }
      counts = sums.map(sig);
    } else [labels, counts] = this.bins(vals.filter((v) => v !== null), binning, fmt);
    if (pareto) {
      const order = counts.map((_, i) => i).sort((a, b) => -counts[a] - -counts[b] || a - b);
      labels = order.map((i) => labels[i]);
      counts = order.map((i) => counts[i]);
    }
    this.grid();
    this.option.xAxis = this.axis("0", "category", labels);
    this.option.xAxis.axisLabel.interval = 0;
    let ya = this.axis("1", "value", null, agg ? fmt : null, "y");
    const color = this.color(bar, 0), dpts = this.dpts(bar);
    const e = { name: this.name(bar, 0), type: "bar", data: counts, itemStyle: { color }, barCategoryGap: this.gap(!agg || !pareto ? 0 : 0.5), yAxisIndex: 0 };
    if (dpts.size) e.data = counts.map((v, j) => ({ value: v, itemStyle: { color: dpts.get(j) || color } }));
    const lab = this.labelsVis(bar);
    if (lab) e.label = { show: true, position: "top", color: lab.font.color, fontSize: lab.font.fontSize };
    const series = [e];
    if (pareto) {
      const ps = sers.find((s) => s.get("layoutId") === "paretoLine");
      const tot = fsum(counts);
      const cum = [];
      let acc = 0;
      for (const c of counts) {
        acc += c;
        cum.push(tot ? sig(acc / tot * 100) : 0);
      }
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
  bins(xsIn, binning, fmt) {
    const xs = xsIn.slice().sort((a, b) => a - b);
    const n = xs.length;
    if (!n) return [[], []];
    const closedR = (binning ? binning.get("intervalClosed", "r") : "r") !== "l";
    const numAttr = (k) => {
      if (!binning) return null;
      const el = binning.find(CX + k);
      const v = el ? el.get("val") : binning.get(k);
      return v === void 0 || v === "auto" ? null : toF(v);
    };
    const uf = numAttr("underflow"), of = numAttr("overflow"), sizeV = numAttr("binSize"), countV = numAttr("binCount");
    const lo = uf !== null ? uf : xs[0], hi = of !== null ? of : xs[n - 1];
    let w, nb;
    if (sizeV && sizeV > 0) {
      w = sizeV;
      nb = Math.max(1, Math.ceil((hi - lo) / w - 1e-9));
    } else if (countV && countV >= 1) {
      nb = Math.trunc(countV);
      w = hi > lo ? (hi - lo) / nb : 1;
    } else {
      const sd = stdev(xs);
      w = sd > 0 ? 3.5 * sd / n ** (1 / 3) : 1;
      w = sig(w);
      nb = Math.max(1, Math.ceil((hi - lo) / w - 1e-9));
    }
    const counts = new Array(nb).fill(0);
    let under = 0, over = 0;
    for (const x of xs) {
      if (uf !== null && (closedR ? x <= uf : x < uf)) under++;
      else if (of !== null && (closedR ? x > of : x >= of)) over++;
      else {
        const t = (x - lo) / w;
        let k = closedR ? Math.ceil(t - 1e-9) - 1 : Math.floor(t + 1e-9);
        k = Math.min(Math.max(k, 0), nb - 1);
        counts[k]++;
      }
    }
    const fx = (x) => fmt === null || fmt === "General" ? jnum(Number(fixedHalfUp(sig(x), 2))) : formatNumber(sig(x), fmt);
    const labels = [];
    for (let k = 0; k < nb; k++) {
      const a = lo + k * w, b = lo + (k + 1) * w;
      if (closedR) labels.push(`${k === 0 && uf === null ? "[" : "("}${fx(a)}, ${fx(b)}]`);
      else labels.push(`[${fx(a)}, ${fx(b)}${k === nb - 1 && of === null ? "]" : ")"}`);
    }
    if (uf !== null) {
      labels.unshift(`${closedR ? "\u2264" : "<"}${fx(uf)}`);
      counts.unshift(under);
    }
    if (of !== null) {
      labels.push(`${closedR ? ">" : "\u2265"}${fx(of)}`);
      counts.push(over);
    }
    return [labels, counts];
  }
  box(sers) {
    const groups = [];
    const per = [];
    for (const s of sers) {
      const [cat, val] = this.seriesDims(s);
      const vals = val && val.levels.length ? val.levels[0] : [];
      const cats = cat !== null ? _ChartEx.flatCats(cat, vals.length) : vals.map(() => "");
      const d = /* @__PURE__ */ new Map();
      for (let i = 0; i < Math.min(cats.length, vals.length); i++) {
        const c = cats[i], v = vals[i];
        if (!groups.includes(c)) groups.push(c);
        if (v !== null) {
          if (!d.has(c)) d.set(c, []);
          d.get(c).push(v);
        }
      }
      per.push([s, d]);
    }
    this.grid();
    this.option.tooltip = { trigger: "item" };
    this.option.xAxis = this.axis("0", "category", groups);
    this.option.yAxis = this.axis("1", "value", null, null, "y");
    const out = [];
    const ns = per.length;
    per.forEach(([s, d], si) => {
      const lp = s.find(CX + "layoutPr");
      const vis = lp ? lp.find(CX + "visibility") : null, stt = lp ? lp.find(CX + "statistics") : null;
      const method = stt ? stt.get("quartileMethod", "exclusive") : "exclusive";
      const showMeanM = boolAttr(vis, "meanMarker", true), showMeanL = boolAttr(vis, "meanLine", false);
      const showInner = boolAttr(vis, "nonoutliers", false), showOut = boolAttr(vis, "outliers", true);
      const color = this.color(s, si), name = this.name(s, si);
      const box = [], pts = [], means = [];
      groups.forEach((gname, gi) => {
        const xs = (d.get(gname) || []).slice().sort((a, b) => a - b);
        if (!xs.length) {
          box.push(null);
          return;
        }
        const q1 = quantile(xs, 0.25, method), q3 = quantile(xs, 0.75, method), med = median(xs);
        const iqr = q3 - q1, lf = q1 - 1.5 * iqr, hf = q3 + 1.5 * iqr;
        const inside = xs.filter((x) => lf <= x && x <= hf);
        const lo = inside.length ? inside[0] : q1, hi = inside.length ? inside[inside.length - 1] : q3;
        box.push([sig(lo), sig(q1), sig(med), sig(q3), sig(hi)]);
        const m = mean(xs);
        means.push([gi, sig(m)]);
        if (showMeanM) pts.push([gi, sig(m), 0]);
        for (const x of xs) {
          if (x < lf || x > hf) {
            if (showOut) pts.push([gi, sig(x), 1]);
          } else if (showInner) pts.push([gi, sig(x), 2]);
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
    this.legendData = out.filter((s) => s.type === "boxplot").map((s) => ({ name: s.name, itemStyle: { color: s.itemStyle.color } }));
  }
};
function pyrepr(s) {
  return s.includes("'") && !s.includes('"') ? `"${s}"` : `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

// src/converter.ts
var C15 = "{http://schemas.microsoft.com/office/drawing/2012/chart}";
var C = `{${NS.c}}`;
var XDR = `{${NS.xdr}}`;
var EMU_PX = 9525;
var GROUP_TAGS = ["barChart", "bar3DChart", "lineChart", "line3DChart", "areaChart", "area3DChart", "pieChart", "pie3DChart", "doughnutChart", "ofPieChart", "scatterChart", "radarChart", "bubbleChart", "stockChart", "surfaceChart", "surface3DChart"];
var AX_TAGS = ["catAx", "valAx", "dateAx", "serAx"];
var SYMBOLS = { circle: "circle", square: "rect", diamond: "diamond", triangle: "triangle", x: "path://M0,0L10,10M10,0L0,10", star: "path://M5,0L5,10M0,5L10,5M1.5,1.5L8.5,8.5M8.5,1.5L1.5,8.5", plus: "path://M5,0L5,10M0,5L10,5", dash: "path://M0,4h10v2h-10z", dot: "circle", picture: "rect" };
var LEGACY_MARKERS = ["diamond", "rect", "triangle", SYMBOLS.x, SYMBOLS.star, "circle", SYMBOLS.plus];
var ALIAS_FN = { bar3DChart: "barChart", line3DChart: "lineChart", area3DChart: "areaChart", pie3DChart: "pieChart", ofPieChart: "pieChart" };
var isNum3 = (x) => typeof x === "number";
var INT = /^[+-]?\d+$/;
function _v(el, path, def, cast = "str") {
  if (!el) return def;
  const x = path ? el.find(path) : el;
  if (!x || x.get("val") === void 0) return def;
  const s = x.get("val");
  if (cast === "int") return INT.test(s.trim()) ? parseInt(s, 10) : def;
  if (cast === "float") {
    const f = s.trim() === "" ? NaN : Number(s);
    return isNaN(f) ? def : f;
  }
  return s;
}
function _bool(el, path, def = false) {
  if (!el) return def;
  const x = el.find(path);
  if (!x) return def;
  const v = x.get("val", "1");
  return v === "1" || v === "true";
}
var pct = (x) => `${jnum(pyRound(x, 2))}%`;
var ChartConverter = class {
  constructor(wb, part, excelCompat = true) {
    this.wb = wb;
    this.part = part;
    this.excelCompat = excelCompat;
    this.warnings = [];
    this.formats = [];
    this.axes = /* @__PURE__ */ new Map();
    this.dispBlanks = "gap";
    this.option = {};
    this.xaxes = [];
    this.yaxes = [];
    this.axmap = /* @__PURE__ */ new Map();
    this.pieLike = false;
    this.usedFormulaFallback = false;
    this.errPending = [];
    this.tipFmt = /* @__PURE__ */ new Map();
    this.autoAxes = [];
    this.dateAxes = /* @__PURE__ */ new Map();
    this.autoNames = /* @__PURE__ */ new Set();
    this.trendPending = [];
    this.barDim = /* @__PURE__ */ new Map();
    this.root = wb.xml(part);
    this.theme = wb.theme;
    this.chartEl = this.root.find(C + "chart");
    const raw = wb.raw(part);
    this.modern = raw.includes("c14:style") || raw.slice(0, 4e3).includes("<c:txPr") || !!this.root.find(C + "txPr");
    this.baseFont = this.font(this.root.find(C + "txPr"), this.modern ? 9 : 10);
  }
  font(txPr, defPt, bold = false) {
    let sz = defPt, color = null, b = bold;
    if (txPr) {
      for (const e of [txPr.find(`.//${A}defRPr`), txPr.find(`.//${A}rPr`)]) {
        if (!e) continue;
        if (e.get("sz")) sz = parseInt(e.get("sz"), 10) / 100;
        if (e.get("b") !== void 0) b = e.get("b") === "1" || e.get("b") === "true";
        const sf = e.find(A + "solidFill");
        if (sf && sf.length) color = resolveColor(sf.children[0], this.theme);
      }
    }
    return { fontSize: pyRound(sz * 4 / 3, 1), color: color || "#595959", fontWeight: b ? "bold" : "normal" };
  }
  richText(tx) {
    const rich = tx ? tx.find(C + "rich") : null;
    if (rich) return [rich.findall(A + "p").map((p) => [...p.iter(A + "t")].map((t) => t.text || "").join("")).join("\n"), rich];
    if (tx) {
      if (tx.find(C + "strRef")) {
        const [vals] = this.readData(tx);
        return [vals.filter((v) => v !== null).map(jstr).join(" "), null];
      }
      if (tx.find(C + "v")) return [tx.find(C + "v").text || "", null];
    }
    return [null, null];
  }
  title(el, defPt, auto) {
    if (!el) return null;
    let [text, rich] = this.richText(el.find(C + "tx"));
    if (text === null) text = auto;
    if (!text) return null;
    let f = this.font(el.find(C + "txPr"), defPt, !this.modern || defPt > 12);
    if (rich) f = this.font(rich, defPt, f.fontWeight === "bold");
    return [text, f];
  }
  readData(el) {
    if (!el) return [[], null, false];
    for (const kind of ["numRef", "strRef", "multiLvlStrRef", "numLit", "strLit"]) {
      const src = el.find(C + kind);
      if (!src) continue;
      const cache = kind.endsWith("Ref") ? src.find(C + { numRef: "numCache", strRef: "strCache", multiLvlStrRef: "multiLvlStrCache" }[kind]) : src;
      let fmt = null;
      let vals = [];
      if (cache && kind === "multiLvlStrRef") {
        const lvls = cache.findall(C + "lvl");
        const n = _v(cache, C + "ptCount", 0, "int");
        if (lvls.length && n) {
          const levels = lvls.map((lvl) => {
            const arr = new Array(n).fill(null);
            for (const pt of lvl.findall(C + "pt")) {
              const i = parseInt(pt.get("idx"), 10);
              if (i < n) arr[i] = pt.findtext(C + "v");
            }
            return arr;
          });
          const outer = levels.slice(1);
          for (const o of outer) {
            let last = null;
            for (let i = 0; i < n; i++) {
              if (o[i] === null) o[i] = last;
              last = o[i];
            }
          }
          vals = [];
          for (let i = 0; i < n; i++) vals.push([...[...outer].reverse().map((o) => o[i]), levels[0][i]].filter((x) => x).join(" "));
          return [vals, null, true];
        }
      }
      if (cache && (cache.find(C + "ptCount") || cache.findall(C + "pt").length)) {
        let n = _v(cache, C + "ptCount", 0, "int");
        const pts = cache.findall(C + "pt");
        if (n === 0 && pts.length) n = Math.max(...pts.map((p) => parseInt(p.get("idx"), 10))) + 1;
        if (pts.length || n) {
          fmt = cache.findtext(C + "formatCode");
          const arr = new Array(n).fill(null);
          for (const pt of pts) {
            const i = parseInt(pt.get("idx"), 10);
            if (i >= n) continue;
            const t = pt.findtext(C + "v");
            if (kind === "numRef" || kind === "numLit") {
              const x = t === null || t.trim() === "" ? NaN : Number(t);
              arr[i] = isNaN(x) ? null : x;
            } else arr[i] = t;
            if (pt.get("formatCode")) fmt = fmt || pt.get("formatCode");
          }
          if (pts.length) {
            if ((fmt === null || fmt === "General") && src.findtext(C + "f")) fmt = this.refFormat(src.findtext(C + "f")) || fmt;
            return [arr, fmt, !(kind === "numRef" || kind === "numLit")];
          }
        }
      }
      const f = src.findtext(C + "f");
      if (f) {
        const [v2, f2] = this.resolveRef(f, kind === "multiLvlStrRef" || el.tag === C + "cat");
        return [v2, f2, !(kind === "numRef" || kind === "numLit") || v2.some((v) => typeof v === "string")];
      }
      return [vals, fmt, !(kind === "numRef" || kind === "numLit")];
    }
    return [[], null, false];
  }
  parts(f) {
    f = f.trim();
    if (f.startsWith("(") && f.endsWith(")")) f = f.slice(1, -1);
    if (this.wb.definedNames.has(f)) f = this.wb.definedNames.get(f);
    return f.match(/(?:'(?:[^']|'')+'|[^,'])+/g) || [];
  }
  refFormat(f) {
    for (const part of this.parts(f)) {
      let sp;
      try {
        sp = splitRef(part.trim());
      } catch (e) {
        if (e instanceof FormulaError) continue;
        throw e;
      }
      const [sheet, r1, c1, r2, c2] = sp;
      if (sheet === null || (r2 - r1 + 1) * (c2 - c1 + 1) > 1e5) continue;
      for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) {
        const st = this.wb.style(sheet, r, c);
        if (st !== "General") return st;
      }
    }
    return null;
  }
  resolveRef(f, multi = false) {
    const parts = this.parts(f);
    if (multi && parts.length === 1) {
      let sp = null;
      try {
        sp = splitRef(parts[0].trim());
      } catch (e) {
        if (!(e instanceof FormulaError)) throw e;
      }
      if (sp && sp[0] !== null && sp[3] > sp[1] && sp[4] > sp[2] && (sp[3] - sp[1] + 1) * (sp[4] - sp[2] + 1) <= 1e5) {
        const [sheet, r1, c1, r2, c2] = sp;
        let rows = [];
        for (let r = r1; r <= r2; r++) {
          const row = [];
          for (let c = c1; c <= c2; c++) row.push(this.wb.value(sheet, r, c));
          rows.push(row);
        }
        if (r2 - r1 < c2 - c1) rows = rows[0].map((_, k) => rows.map((row) => row[k]));
        for (let lvl = 0; lvl < rows[0].length - 1; lvl++) {
          let last = null;
          for (const row of rows) {
            if (row[lvl] === null || row[lvl] === "") row[lvl] = last;
            last = row[lvl];
          }
        }
        this.usedFormulaFallback = true;
        return [rows.map((row) => row.map(jstr).filter((x) => x).join(" ")), null];
      }
    }
    const vals = [];
    let fmt = null;
    for (const part of parts) {
      let sp;
      try {
        sp = splitRef(part.trim());
      } catch (e) {
        if (!(e instanceof FormulaError)) throw e;
        this.warnings.push(`cannot resolve reference ${pyrepr2(part)}`);
        continue;
      }
      const [sheet, r1, c1, r2, c2] = sp;
      if (sheet === null) {
        this.warnings.push(`reference without sheet ${pyrepr2(part)}`);
        continue;
      }
      if ((r2 - r1 + 1) * (c2 - c1 + 1) > 1e5) {
        this.warnings.push(`reference too large ${pyrepr2(part)}`);
        continue;
      }
      for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) {
        vals.push(this.wb.value(sheet, r, c));
        if (fmt === null) {
          const st = this.wb.style(sheet, r, c);
          if (st !== "General") fmt = st;
        }
      }
    }
    this.usedFormulaFallback = true;
    return [vals, fmt];
  }
  convert() {
    const ch = this.chartEl, pa = ch.find(C + "plotArea");
    const groups = pa.children.filter((g) => GROUP_TAGS.includes(local(g.tag)));
    for (const ax of pa.children) {
      const t2 = local(ax.tag);
      if (AX_TAGS.includes(t2)) this.axes.set(ax.findtext(C + "axId") || _v(ax, C + "axId", null), [t2, ax]);
    }
    this.dispBlanks = _v(ch, C + "dispBlanksAs", "gap");
    this.option = { backgroundColor: this.chartBg(), textStyle: { fontFamily: "Calibri, 'Microsoft YaHei', 'PingFang SC', sans-serif" }, tooltip: { trigger: "item" }, series: [] };
    const types = [], allSeries = [];
    for (const g of groups) {
      const t2 = local(g.tag);
      types.push(t2);
      const sers = g.findall(C + "ser").map((s, i) => [s, i]).sort((a, b) => _v(a[0], C + "order", 0, "int") - _v(b[0], C + "order", 0, "int") || a[1] - b[1]).map((x) => x[0]);
      allSeries.push(...sers);
      const name = "g_" + (ALIAS_FN[t2] ?? t2);
      let fn = this[name];
      if (!fn) {
        this.warnings.push(`${t2} is not supported \u2014 rendered as line chart`);
        fn = this.g_lineChart;
      }
      if (t2.endsWith("3DChart")) this.warnings.push(`${t2}: 3-D rendered as 2-D`);
      fn.call(this, g, sers);
    }
    this.finalizeErrbars();
    this.option.series.push(...this.trendPending);
    this.autoScale();
    let auto = null;
    if (allSeries.length === 1) auto = this.seriesName(allSeries[0], 0);
    else if (allSeries.length) auto = "Chart Title";
    const t = _bool(ch, C + "autoTitleDeleted") ? null : this.title(ch.find(C + "title"), this.modern ? 14 : 18, auto);
    if (t) {
      this.option.title = { text: t[0], left: "center", top: 6, textStyle: t[1] };
      const mxy = manualXY(ch.find(C + "title"));
      if (mxy) [this.option.title.left, this.option.title.top] = mxy;
    }
    this.legend(ch.find(C + "legend"));
    if (!this.option.legend.show && this.autoNames.size) {
      for (const s of this.option.series) {
        if (this.autoNames.has(s.name)) s.name = "";
        if (s.type === "radar") {
          for (const d of s.data || []) if (this.autoNames.has(d.name)) d.name = "";
        }
      }
    }
    this.option.series.forEach((s, i) => {
      const code = this.tipFmt.get(s);
      if (Array.isArray(code)) this.formats.push({ path: `series.${i}.tooltip`, formatCode: code[1], tooltip: true, date: true, serial: this.wb.date1904 ? 1904 : 1900 });
      else if (code) this.formats.push({ path: `series.${i}.tooltip`, formatCode: code, tooltip: true });
    });
    if (this.xaxes.length) this.option.xAxis = this.xaxes.length > 1 ? this.xaxes : this.xaxes[0];
    if (this.yaxes.length) this.option.yAxis = this.yaxes.length > 1 ? this.yaxes : this.yaxes[0];
    if (this.xaxes.length || this.yaxes.length) {
      const top = "title" in this.option ? 50 : 24;
      const leg = this.option.legend || {};
      const grid = { left: 16, right: 24, top, bottom: 16, containLabel: true };
      if (leg.show) {
        const pos = leg._pos;
        if (pos === "b") grid.bottom = 40;
        else if (pos === "t") grid.top = top + 28;
        else if (pos === "r" || pos === "tr") grid.right = 130;
        else if (pos === "l") grid.left = 130;
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
  chartBg() {
    const sp = this.root.find(C + "spPr");
    if (noFill(sp)) return "transparent";
    return fillColor(sp, this.theme) || "#FFFFFF";
  }
  autoColor(i) {
    const acc = ["accent1", "accent2", "accent3", "accent4", "accent5", "accent6"];
    const base = this.theme[acc[i % 6]] ?? "4472C4";
    const r = Math.floor(i / 6);
    if (r === 0) return "#" + base.toUpperCase();
    const e = new El(A + "srgbClr", { val: base });
    if (r % 2 === 1) e.children.push(new El(A + "lumMod", { val: "60000" }));
    else {
      e.children.push(new El(A + "lumMod", { val: "80000" }));
      e.children.push(new El(A + "lumOff", { val: "20000" }));
    }
    return resolveColor(e, this.theme);
  }
  seriesColor(ser) {
    const sp = ser.find(C + "spPr");
    return fillColor(sp, this.theme) || this.autoColor(_v(ser, C + "idx", 0, "int"));
  }
  seriesLine(ser) {
    const [col, w, nol, dash] = lineProps(ser.find(C + "spPr"), this.theme);
    return [col || this.autoColor(_v(ser, C + "idx", 0, "int")), w, nol, dash];
  }
  seriesName(ser, i) {
    const tx = ser.find(C + "tx");
    if (tx) {
      const [text] = this.richText(tx);
      if (text) return text;
    }
    const nm = `Series${_v(ser, C + "idx", i, "int") + 1}`;
    this.autoNames.add(nm);
    return nm;
  }
  tip(e, lab, fmt, axisFmt, skip) {
    if (skip) return;
    const ok = (c) => c && c !== "General" ? c : null;
    const code = lab && lab._fmt || ok(fmt) || ok(axisFmt);
    if (code && !isDateFormat(code)) this.tipFmt.set(e, code);
  }
  axisFor(axId, dim, kind, o = {}) {
    if (this.axmap.has(axId)) return this.axmap.get(axId)[1];
    const lst = dim === "x" ? this.xaxes : this.yaxes;
    const ent = this.axes.get(axId);
    const ax = ent ? ent[1] : null;
    const implicitHide = !!ax && this.excelCompat && !ax.find(C + "delete") && !ax.find(C + "tickLblPos");
    const deleted = ax ? _bool(ax, C + "delete", implicitHide) : true;
    if (implicitHide)
      this.warnings.push(`axis ${axId}: no <c:delete> element \u2014 Excel hides such axes (typical openpyxl \u22653.1 output); labels hidden to match Excel`);
    const e = {};
    const font = this.font(ax ? ax.find(C + "txPr") : null, this.baseFont.fontSize * 3 / 4);
    e.axisLabel = { show: !deleted && _v(ax, C + "tickLblPos", "nextTo") !== "none", color: font.color, fontSize: font.fontSize };
    let rot = null;
    if (ax) {
      const bp = ax.find(`${C}txPr/${A}bodyPr`);
      if (bp && bp.get("rot") !== void 0 && bp.get("rot") !== "-60000000") {
        rot = -parseInt(bp.get("rot"), 10) / 6e4;
        if (rot) e.axisLabel.rotate = rot;
      }
    }
    let lineCol = this.modern ? "#D9D9D9" : "#868686";
    let axisLineShow = false;
    let lineW = null;
    if (ax) {
      const [c, w, nol] = lineProps(ax.find(C + "spPr"), this.theme);
      lineW = w;
      if (c) lineCol = c;
      axisLineShow = !nol && !deleted;
    }
    e.axisLine = { show: axisLineShow, lineStyle: { color: lineCol, ...lineW && lineW > 1.5 ? { width: lineW } : {} } };
    const majorTick = _v(ax, C + "majorTickMark", this.modern ? "none" : "out");
    e.axisTick = { show: !deleted && majorTick !== "none", inside: majorTick === "in", lineStyle: { color: lineCol } };
    if (kind === "category") e.axisTick.alignWithLabel = true;
    const mg = ax ? ax.find(C + "majorGridlines") : null;
    const gcol = this.modern ? "#D9D9D9" : "#878787";
    if (mg) {
      const [c, w, , dash] = lineProps(mg.find(C + "spPr"), this.theme);
      e.splitLine = { show: true, lineStyle: { color: c || gcol, ...w ? { width: w } : {}, ...dash ? { type: dash } : {} } };
    } else e.splitLine = { show: false };
    if (ax && ax.find(C + "minorGridlines")) {
      e.minorSplitLine = { show: true, lineStyle: { color: "#F2F2F2" } };
      e.minorTick = { show: false };
    }
    const title = ax ? this.title(ax.find(C + "title"), 10, null) : null;
    if (title) {
      e.name = title[0];
      e.nameLocation = "middle";
      e.nameTextStyle = { ...title[1] };
      e.nameGap = dim === "x" ? 32 : 45;
    }
    const scaling = ax ? ax.find(C + "scaling") : null;
    if (_v(scaling, C + "orientation", "minMax") === "maxMin") e.inverse = true;
    const pos = _v(ax, C + "axPos", null);
    if (kind === "category") {
      e.type = "category";
      e.data = o.categories || [];
      e.boundaryGap = o.boundaryGap ?? true;
      const skip = _v(ax, C + "tickLblSkip", null, "int");
      if (skip) e.axisLabel.interval = skip - 1;
      else if (o.categories && o.categories.length && !rot) e.axisLabel.interval = "auto";
    } else if (kind === "time") {
      e.type = "time";
      e.boundaryGap = false;
      if (o.catFmt) this.fmtHook(`${dim}Axis.${lst.length}.axisLabel`, o.catFmt, true);
    } else {
      e.type = "value";
      const lb = _v(scaling, C + "logBase", null, "float");
      if (lb) {
        e.type = "log";
        e.logBase = lb;
      }
      let mn = _v(scaling, C + "min", null, "float"), mx = _v(scaling, C + "max", null, "float");
      if (o.percent) {
        mn = mn === null ? 0 : mn * 100;
        mx = mx === null ? 100 : mx * 100;
      }
      if (mn !== null) e.min = mn;
      if (mx !== null) e.max = mx;
      const mu = _v(ax, C + "majorUnit", null, "float");
      if (mu) e.interval = mu * (o.percent ? 100 : 1);
      e.scale = false;
      if (mn === null && !lb && !o.percent) this.autoAxes.push([dim, lst.length, mx, mu]);
      const nf = ax ? ax.find(C + "numFmt") : null;
      let code = null;
      if (nf && (nf.get("sourceLinked") === "0" || nf.get("sourceLinked") === "false")) code = nf.get("formatCode") ?? null;
      else if (o.valFmt) code = o.valFmt;
      if (o.percent) e.axisLabel.formatter = "{value}%";
      else if (code && isDateFormat(code)) {
        this.fmtHook(`${dim}Axis.${lst.length}.axisLabel`, code, true, true);
        this.dateAxes.set(`${dim}${lst.length}`, code);
      } else if (code && code !== "General") this.fmtHook(`${dim}Axis.${lst.length}.axisLabel`, code);
      if (dim === "y" && (pos === "r" || lst.length >= 1)) e.position = lst.length >= 1 ? "right" : "left";
      if (dim === "x" && (pos === "t" || xOccupied(lst))) e.position = "top";
    }
    if (dim === "x" && kind !== "value" && (pos === "t" || xOccupied(lst))) e.position = "top";
    if (dim === "x" && lst.length && !("position" in e)) e.position = "bottom";
    lst.push(e);
    const idx = lst.length - 1;
    this.axmap.set(axId, [dim, idx]);
    return idx;
  }
  fmtHook(path, code, date = false, serial = false) {
    const h = { path, formatCode: code };
    if (date) h.date = true;
    if (serial) h.serial = this.wb.date1904 ? 1904 : 1900;
    this.formats.push(h);
  }
  /** Excel's automatic value-axis minimum (see converter.py _auto_scale). */
  autoScale() {
    for (const [dim, idx, mxFixed, mu] of this.autoAxes) {
      let vals = [];
      for (const s of this.option.series) {
        if ((s[dim + "AxisIndex"] ?? 0) !== idx || s.stack) continue;
        vals.push(...this.axisVals(s, dim));
      }
      vals = vals.filter((v) => typeof v === "number" && isFinite(v));
      if (!vals.length) continue;
      let lo = Math.min(...vals), hi = Math.max(...vals);
      if (mxFixed !== null) hi = Math.max(hi, mxFixed);
      const ax = (dim === "x" ? this.xaxes : this.yaxes)[idx];
      let mn;
      if (lo > 0 && lo > hi * 5 / 6 && hi > lo) mn = lo - (hi - lo) / 2;
      else if (hi < 0 && hi < lo * 5 / 6 && hi > lo) {
        ax.scale = true;
        continue;
      } else continue;
      if (mu) ax.min = sig(Math.floor(mn / mu) * mu);
      else ax.scale = true;
    }
  }
  axisVals(s, dim) {
    const d = s.data || [], out = [], t = s.type;
    if (t === "custom") {
      const enc = (s.encode || {})[dim] || [];
      for (let p of d) {
        p = p !== null && typeof p === "object" && !Array.isArray(p) ? p.value : p;
        if (Array.isArray(p)) {
          for (const k of enc) if (k < p.length) out.push(p[k]);
        }
      }
      return out;
    }
    const catDim = t === "bar" ? this.barDim.get(s) ?? "x" : "x";
    for (let p of d) {
      p = p !== null && typeof p === "object" && !Array.isArray(p) ? p.value : p;
      if (Array.isArray(p)) {
        if ((t === "scatter" || t === "line") && p.length >= 2) out.push(dim === "x" ? p[0] : p[1]);
      } else if ((t === "bar" || t === "line") && dim !== catDim) out.push(p);
    }
    return out;
  }
  labels(group, ser, kind, fmt) {
    let d = ser.find(C + "dLbls");
    if (!d) d = group.find(C + "dLbls");
    if (!d || _bool(d, C + "delete")) return null;
    const fl = {};
    for (const k of ["showVal", "showPercent", "showCatName", "showSerName", "showLegendKey"]) fl[k] = _bool(d, C + k);
    let rng = null;
    if ([...d.iter(C15 + "showDataLabelsRange")].some((x) => x.get("val") === "1" || x.get("val") === "true")) {
      const cache = ser.iter(C15 + "dlblRangeCache").next().value;
      if (cache) {
        const n = _v(cache, C + "ptCount", 0, "int");
        rng = new Array(n).fill(null);
        for (const pt of cache.findall(C + "pt")) {
          const k = parseInt(pt.get("idx"), 10);
          if (k < n) {
            const t = pt.findtext(C + "v");
            rng[k] = t == null ? null : t.replace(/\r\n?/g, "\n");
          }
        }
      }
    }
    if (rng !== null) {
      const font2 = this.font(d.find(C + "txPr"), this.baseFont.fontSize * 3 / 4);
      const pm = { t: "top", b: "bottom", l: "left", r: "right", ctr: "inside" };
      return { show: true, formatter: "{b}", color: font2.color, fontSize: font2.fontSize, position: pm[_v(d, C + "dLblPos", null)] ?? "right", _range: rng };
    }
    if (!(fl.showVal || fl.showPercent || fl.showCatName || fl.showSerName)) return null;
    const sep = d.findtext(C + "separator") || ", ";
    const parts = [];
    if (fl.showSerName) parts.push("{a}");
    if (fl.showCatName) parts.push("{b}");
    if (fl.showVal) parts.push(kind === "scatter" ? "{@[1]}" : "{c}");
    if (fl.showPercent && kind === "pie") parts.push("{d}%");
    const font = this.font(d.find(C + "txPr"), this.baseFont.fontSize * 3 / 4);
    const lab = { show: true, formatter: parts.join(sep), color: font.color, fontSize: font.fontSize };
    const pos = _v(d, C + "dLblPos", null);
    const pmap = { outEnd: "top", inEnd: "insideTop", ctr: "inside", inBase: "insideBottom", t: "top", b: "bottom", l: "left", r: "right", bestFit: "outside" };
    if (kind === "pie") lab.position = { outEnd: "outside", bestFit: "outside", inEnd: "inside", ctr: "inside" }[pos] ?? "outside";
    else if (kind === "hbar") lab.position = { outEnd: "right", inEnd: "insideRight", ctr: "inside", inBase: "insideLeft" }[pos] ?? "right";
    else if (kind === "stackbar") lab.position = pmap[pos] ?? "inside";
    else lab.position = pmap[pos] ?? (kind !== "line" ? "top" : "right");
    const nf = d.find(C + "numFmt");
    const code = nf && (nf.get("sourceLinked") === "0" || nf.get("sourceLinked") === "false") ? nf.get("formatCode") ?? null : fmt;
    if (code && code !== "General" && fl.showVal && kind !== "scatter") lab._fmt = code;
    return lab;
  }
  applyLabelFmt(s) {
    const lab = s.label;
    if (!lab || !("_fmt" in lab)) return;
    const code = lab._fmt;
    delete lab._fmt;
    if (lab.formatter === "{c}") {
      s.data = s.data.map((v) => {
        const isObj = v !== null && typeof v === "object" && !Array.isArray(v);
        const raw = isObj ? v.value : v;
        const item = isObj ? { ...v } : { value: v };
        if (raw !== null && raw !== void 0) {
          item.label = item.label || {};
          item.label.formatter = formatNumber(raw, code);
        }
        return item;
      });
    } else this.fmtHook(`series.${this.option.series.length - 1}.label`, code);
  }
  categories(sers, axId) {
    let cats = [], fmt = null;
    for (const s of sers) {
      [cats, fmt] = this.readData(s.find(C + "cat"));
      if (cats.length) break;
    }
    const n = Math.max(...sers.map((s) => this.readData(s.find(C + "val"))[0].length), cats.length);
    const ent = this.axes.get(axId);
    const tag = ent ? ent[0] : "catAx";
    const ax = ent ? ent[1] : null;
    const nf = ax ? ax.find(C + "numFmt") : null;
    if (nf && (nf.get("sourceLinked") === "0" || nf.get("sourceLinked") === "false")) fmt = nf.get("formatCode") || fmt;
    const numeric = cats.length > 0 && cats.every((c) => c === null || isNum3(c));
    let dates = null, labels;
    if (numeric && (isDateFormat(fmt) || tag === "dateAx")) {
      dates = cats;
      labels = cats.map((c) => c !== null ? formatDate(c, fmt || "yyyy-mm-dd", this.wb.date1904) : "");
    } else if (numeric) labels = cats.map((c) => formatNumber(c, fmt));
    else labels = cats.map(jstr);
    if (!labels.length) labels = Array.from({ length: n }, (_, i) => String(i + 1));
    while (labels.length < n) labels.push(String(labels.length + 1));
    return [labels, dates, tag];
  }
  values(ser, tag = "val") {
    const [vals, fmt] = this.readData(ser.find(C + tag));
    const out = vals.map((v) => {
      if (typeof v === "boolean") v = v ? 1 : 0;
      if (typeof v === "string") {
        const t = v.trim();
        const x = t === "" ? NaN : Number(t);
        v = isNaN(x) ? null : x;
      }
      if (Array.isArray(v)) v = null;
      if (v === null && this.dispBlanks === "zero") v = 0;
      if (isNum3(v)) v = Number.isInteger(v) && Math.abs(v) < 1e15 ? v : Number(v.toPrecision(12));
      return v;
    });
    return [out, fmt];
  }
  catValAxes(g) {
    const ids = g.findall(C + "axId").map((a) => a.get("val") ?? null);
    return [ids[0] ?? null, ids[1] ?? null];
  }
  percentLabels(e, lab, orig, fmt) {
    const code = lab._fmt || fmt;
    delete lab._fmt;
    if (lab.formatter === "{c}") {
      const n = Math.min(e.data.length, orig.length);
      const data = [];
      for (let k = 0; k < n; k++) {
        const v = e.data[k];
        const isObj = v !== null && typeof v === "object" && !Array.isArray(v);
        const item = isObj ? { ...v } : { value: v };
        if (orig[k] !== null) item.label = { formatter: formatNumber(orig[k], code) };
        data.push(item);
      }
      e.data = data;
    } else lab.formatter = lab.formatter.split("{c}").join("{c}%");
  }
  dpts(s) {
    const out = /* @__PURE__ */ new Map();
    for (const dp of s.findall(C + "dPt")) {
      const c = fillColor(dp.find(C + "spPr"), this.theme);
      if (c) out.set(_v(dp, C + "idx", 0, "int"), c);
    }
    return out;
  }
  percentTotals(valsAll, n) {
    return Array.from({ length: n }, (_, i) => valsAll.reduce((a, [v]) => a + (i < v.length && v[i] !== null ? Math.abs(v[i]) : 0), 0));
  }
  g_barChart(g, sers) {
    const horizontal = _v(g, C + "barDir", "col") === "bar", grouping = _v(g, C + "grouping", "clustered");
    const [catId, valId] = this.catValAxes(g);
    const [labels] = this.categories(sers, catId);
    const [cdim, vdim] = horizontal ? ["y", "x"] : ["x", "y"];
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
    const accP = new Array(labels.length).fill(0), accN = new Array(labels.length).fill(0);
    sers.forEach((s, i) => {
      let [vals, fmt] = valsAll[i];
      const orig = vals;
      const color = this.seriesColor(s);
      if (percent) vals = vals.map((v, j) => v === null || !totals[j] ? null : pyRound(v / totals[j] * 100, 6));
      const it = { color };
      const [col, w, nol] = lineProps(s.find(C + "spPr"), this.theme);
      if (col && !nol) {
        it.borderColor = col;
        it.borderWidth = w || 1;
      }
      if (noFill(s.find(C + "spPr"))) it.color = "transparent";
      const e = { name: this.seriesName(s, i), type: "bar", data: vals, itemStyle: it, [horizontal ? "xAxisIndex" : "yAxisIndex"]: vi, [horizontal ? "yAxisIndex" : "xAxisIndex"]: ci };
      if (stacked) e.stack = stackId;
      if (i === 0 || !stacked) {
        e.barCategoryGap = pct(gap / (nbars + gap) * 100);
        e.barGap = `${jnum(-overlap)}%`;
      }
      const dp = this.dpts(s);
      if (vary || dp.size) e.data = vals.map((v, j) => ({ value: v, itemStyle: { color: dp.get(j) || (vary ? this.autoColor(j) : color) } }));
      const lab = this.labels(g, s, horizontal && !stacked ? "hbar" : stacked ? "stackbar" : "bar", fmt);
      this.tip(e, lab, fmt, valFmt, percent);
      if (lab) {
        e.label = lab;
        if (percent) this.percentLabels(e, lab, orig, fmt);
      }
      this.option.series.push(e);
      this.barDim.set(e, cdim);
      this.applyLabelFmt(e);
      let centers = vals.slice();
      if (stacked) centers = vals.map((v, j) => {
        if (!isNum3(v) || j >= accP.length) return v;
        if (v >= 0) {
          accP[j] += v;
          return accP[j];
        }
        accN[j] += v;
        return accN[j];
      });
      const idx = vals.map((_, j) => j);
      this.errBars(s, e, idx, vals, centers, "cat", horizontal);
      this.trendlines(s, e, idx.map((j) => j + 1), vals, color, true);
    });
  }
  marker(s, groupDefault, i) {
    const m = s.find(C + "marker");
    const sym = _v(m, C + "symbol", null);
    if (sym === "none") return null;
    if (sym === null && !groupDefault) return null;
    const size = _v(m, C + "size", 5, "int");
    const shape = sym === null || sym === "auto" ? this.modern ? "circle" : LEGACY_MARKERS[_v(s, C + "idx", i, "int") % LEGACY_MARKERS.length] : SYMBOLS[sym] ?? "circle";
    let col = m ? fillColor(m.find(C + "spPr"), this.theme) : null;
    if (m && noFill(m.find(C + "spPr")) && lineProps(m.find(C + "spPr"), this.theme)[2]) col = "transparent";
    return [shape, pyRound(size * 4 / 3 + 1, 1), col];
  }
  g_lineChart(g, sers, area = false) {
    const grouping = _v(g, C + "grouping", "standard");
    const [catId, valId] = this.catValAxes(g);
    const [labels, dates, tag] = this.categories(sers, catId);
    const valsAll = sers.map((s) => this.values(s));
    const valFmt = valsAll.find(([, f]) => f)?.[1] ?? null;
    const percent = grouping === "percentStacked";
    let useTime = false;
    if (dates && tag === "dateAx") {
      const ds = dates.filter((d) => d !== null);
      const steps = /* @__PURE__ */ new Set();
      for (let k = 0; k + 1 < ds.length; k++) steps.add(pyRound(ds[k + 1] - ds[k], 6));
      useTime = steps.size > 1;
    }
    let ci;
    if (useTime) {
      let catFmt = null;
      const cent = this.axes.get(catId);
      const cnf = cent ? cent[1].find(C + "numFmt") : null;
      if (cnf && (cnf.get("sourceLinked") === "0" || cnf.get("sourceLinked") === "false") && cnf.get("formatCode")) catFmt = cnf.get("formatCode");
      else {
        for (const s of sers) {
          catFmt = this.readData(s.find(C + "cat"))[1];
          if (catFmt) break;
        }
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
      if (percent) vals = vals.map((v, j) => v === null || !totals[j] ? null : pyRound(v / totals[j] * 100, 6));
      const data = useTime ? dates.slice(0, vals.length).map((d, k) => [d !== null ? isoLocal(serialToDate(d, this.wb.date1904)) : null, vals[k]]) : vals;
      const e = { name: this.seriesName(s, i), type: "line", data, xAxisIndex: ci, yAxisIndex: vi };
      if (area) {
        const color = this.seriesColor(s);
        const [lc, w, nol] = lineProps(s.find(C + "spPr"), this.theme);
        e.areaStyle = { color, opacity: 1 };
        e.lineStyle = { width: nol || !lc ? 0 : w || 1, color: lc || color };
        e.itemStyle = { color };
        e.showSymbol = false;
        e.symbol = "none";
      } else {
        const [color, w, nol, dash] = this.seriesLine(s);
        e.itemStyle = { color };
        const ls = { color, width: w || (this.modern ? 2.25 * 4 / 3 : 2.67) };
        if (dash) ls.type = dash;
        if (nol) ls.width = 0;
        e.lineStyle = ls;
        const mk = this.marker(s, groupMarker, i);
        if (mk) {
          e.symbol = mk[0];
          e.symbolSize = mk[1];
          e.showSymbol = true;
          if (mk[2]) e.itemStyle.color = mk[2];
        } else {
          e.showSymbol = false;
          e.symbol = "none";
        }
        if (_bool(s, C + "smooth", false)) e.smooth = true;
      }
      if (stacked) e.stack = stackId;
      if (this.dispBlanks === "span") e.connectNulls = true;
      const lab = this.labels(g, s, "line", fmt);
      this.tip(e, lab, fmt, valFmt, percent);
      if (lab) {
        if (useTime) {
          const tcode = lab._fmt;
          delete lab._fmt;
          lab.formatter = lab.formatter.split("{c}").join("{@[1]}");
          if (tcode) this.fmtHook(`series.${this.option.series.length}.label`, tcode);
        }
        e.label = lab;
        if (percent && !useTime) this.percentLabels(e, lab, orig, fmt);
      }
      if (drop) e.markLine = { silent: true, symbol: "none", data: [] };
      this.option.series.push(e);
      if (!useTime) this.applyLabelFmt(e);
      const xs = useTime ? data.map((d) => d[0]) : vals.map((_, j) => j);
      let centers = vals.slice();
      if (stacked) {
        let acc = 0;
        centers = vals.map((v) => {
          if (isNum3(v)) {
            acc += v;
            return acc;
          }
          return v;
        });
      }
      this.errBars(s, e, xs, vals, centers, "cat");
      if (!useTime) this.trendlines(s, e, vals.map((_, j) => j + 1), vals, e.itemStyle.color, true);
    });
  }
  g_areaChart(g, sers) {
    this.g_lineChart(g, sers, true);
  }
  g_pieChart(g, sers, hole = null) {
    this.pieLike = true;
    if (!sers.length) return;
    const s0 = sers[0];
    if (sers.length > 1 && hole === null) {
      this.warnings.push("pie chart with several series: Excel only draws the first one");
      sers = sers.slice(0, 1);
    }
    const [labels] = this.categories([s0], null);
    const first = _v(g, C + "firstSliceAng", 0, "int");
    const vary = _bool(g, C + "varyColors", true);
    const nRings = hole !== null ? sers.length : 1;
    const outer = 75, inner0 = outer * (hole || 0) / 100, ringW = (outer - inner0) / nRings;
    sers.slice(0, nRings).forEach((s, ri) => {
      const [vals, fmt] = this.values(s);
      const dp = this.dpts(s);
      const base = this.seriesColor(s);
      const data = vals.map((v, j) => {
        const c = dp.get(j) || (vary ? this.autoColor(j) : base);
        const item = { name: j < labels.length ? labels[j] : String(j + 1), value: v, itemStyle: { color: c } };
        let expl2 = null;
        for (const d of s.findall(C + "dPt")) if (_v(d, C + "idx", -1, "int") === j) expl2 = _v(d, C + "explosion", null, "int");
        if (expl2) item.selected = true;
        return item;
      });
      const rIn = inner0 + ringW * ri, rOut = inner0 + ringW * (ri + 1);
      const e = {
        name: this.seriesName(s, ri),
        type: "pie",
        data,
        radius: hole ? [pct(rIn), pct(rOut)] : `${outer}%`,
        center: ["50%", "title" in this.option || this.chartEl.find(C + "title") ? "55%" : "50%"],
        startAngle: 90 - first,
        clockwise: true,
        itemStyle: { borderColor: "#FFFFFF", borderWidth: 1 }
      };
      if (data.some((d) => d.selected)) {
        e.selectedMode = "multiple";
        e.selectedOffset = 12;
      }
      const expl = _v(s, C + "explosion", null, "int");
      if (expl) {
        e.selectedMode = "multiple";
        e.selectedOffset = 12;
        for (const d of data) d.selected = true;
      }
      const lab = this.labels(g, s, "pie", fmt);
      this.tip(e, lab, fmt, null, false);
      if (lab) {
        if (lab.position === "inside") lab.color = lab.color !== "#595959" ? lab.color : "#404040";
        e.label = lab;
        const sd = s.find(C + "dLbls");
        e.labelLine = { show: lab.position === "outside" && _bool(sd && sd.length ? sd : g.find(C + "dLbls"), C + "showLeaderLines", true) };
      } else {
        e.label = { show: false };
        e.labelLine = { show: false };
      }
      this.option.series.push(e);
      this.applyLabelFmt(e);
    });
  }
  g_doughnutChart(g, sers) {
    this.g_pieChart(g, sers, Math.max(1, _v(g, C + "holeSize", 10, "int")));
  }
  g_scatterChart(g, sers, bubble = false) {
    const style = _v(g, C + "scatterStyle", "marker");
    const [xId, yId] = this.catValAxes(g);
    const xfmt0 = sers.map((s) => this.readData(s.find(C + "xVal"))[1]).find((f) => f) ?? null;
    const xi = this.axisFor(xId, "x", "value", { valFmt: xfmt0 });
    const ys = sers.map((s) => this.values(s, "yVal"));
    const yi = this.axisFor(yId, "y", "value", { valFmt: ys.find(([, f]) => f)?.[1] ?? null });
    let allSizes = [];
    if (bubble) for (const s of sers) allSizes.push(...this.values(s, "bubbleSize")[0].filter(isNum3));
    const smax = Math.max(...allSizes.map(Math.abs), 1);
    const scale = _v(g, C + "bubbleScale", 100, "int") / 100;
    sers.forEach((s, i) => {
      const [yv, fmt] = ys[i];
      let [xv, , xtext] = this.readData(s.find(C + "xVal"));
      if (!xv.length || xtext) xv = Array.from({ length: yv.length }, (_, k) => k + 1);
      const data = xv.slice(0, yv.length).map((x, k) => [x, yv[k]]);
      const [color, w, nol, dash] = this.seriesLine(s);
      const fill = fillColor(s.find(C + "spPr"), this.theme);
      const e = { name: this.seriesName(s, i), xAxisIndex: xi, yAxisIndex: yi };
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
          Object.assign(e, { type: "line", data, lineStyle: { color, width: w || 2.67, ...dash ? { type: dash } : {} }, itemStyle: { color } });
          if (mk) {
            Object.assign(e, { symbol: mk[0], symbolSize: mk[1], showSymbol: true });
            if (mk[2]) e.itemStyle.color = mk[2];
          } else Object.assign(e, { symbol: "none", showSymbol: false });
          if (_bool(s, C + "smooth", style.startsWith("smooth"))) e.smooth = true;
        } else {
          const [shape, size, mcol] = mk || ["circle", 8, null];
          Object.assign(e, { type: "scatter", data, symbol: shape, symbolSize: size, itemStyle: { color: mcol || fill || this.autoColor(_v(s, C + "idx", i, "int")) } });
        }
      }
      const lab = this.labels(g, s, "scatter", fmt);
      if (lab) {
        const rng = lab._range;
        delete lab._range;
        if (rng !== void 0 && !bubble) e.data = e.data.map((p, k) => ({ name: k < rng.length && rng[k] !== null ? rng[k] : "", value: p }));
        e.label = lab;
      }
      const xcode = this.dateAxes.get(`x${xi}`);
      if (xcode) this.tipFmt.set(e, ["date", xcode]);
      const tl = s.find(C + "trendline");
      if (tl && _v(tl, C + "trendlineType", null) === "linear") e.markLine = this.trend(data, color);
      this.option.series.push(e);
      const xs_ = data.map((p) => p[0]), ys_ = data.map((p) => p[1]);
      this.errBars(s, e, xs_, ys_, ys_, "xy");
      this.trendlines(s, e, xs_, ys_, color, false);
    });
  }
  trend(data, color) {
    const pts = data.filter(([x, y]) => isNum3(x) && isNum3(y));
    if (pts.length < 2) return null;
    const n = pts.length;
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (const p of pts) sx += p[0];
    for (const p of pts) sy += p[1];
    for (const p of pts) sxx += p[0] ** 2;
    for (const p of pts) sxy += p[0] * p[1];
    const den = n * sxx - sx * sx;
    if (!den) return null;
    const k = (n * sxy - sx * sy) / den, b = (sy - k * sx) / n;
    const x0 = Math.min(...pts.map((p) => p[0])), x1 = Math.max(...pts.map((p) => p[0]));
    return { silent: true, symbol: "none", lineStyle: { color, type: "dashed" }, data: [[{ coord: [x0, sig(k * x0 + b)] }, { coord: [x1, sig(k * x1 + b)] }]] };
  }
  errBars(s, parent, xs, vals, centers, mode, horizontal = false) {
    for (const eb of s.findall(C + "errBars")) {
      let d = _v(eb, C + "errDir", "y");
      if (mode === "cat") d = horizontal ? "x" : "y";
      let base, cen;
      if (mode === "cat") {
        base = vals;
        cen = centers;
      } else if (d === "x") {
        base = xs;
        cen = xs;
      } else {
        base = vals;
        cen = vals;
      }
      const amts = this.errAmounts(eb, base);
      if (!amts) continue;
      const [mList, pList, meanC] = amts;
      const data = [];
      for (let j = 0; j < base.length; j++) {
        let c = j < cen.length ? cen[j] : null;
        if (j >= xs.length) continue;
        if (!isNum3(c) || !isNum3(base[j])) continue;
        if (meanC !== null) c = meanC;
        const lo = sig(c - mList[j]), hi = sig(c + pList[j]);
        data.push(mode === "cat" ? horizontal ? [sig(c), j, lo, hi] : [xs[j], sig(c), lo, hi] : [xs[j], vals[j], lo, hi]);
      }
      const [col, w] = lineProps(eb.find(C + "spPr"), this.theme);
      const vert = d !== "x";
      const cs = {
        name: parent.name,
        type: "custom",
        "x-renderItem": "errorBar",
        "x-cfg": { dir: vert ? "v" : "h", cap: !_bool(eb, C + "noEndCap"), color: col || (this.modern ? "#595959" : "#000000"), width: w || 1 },
        xAxisIndex: parent.xAxisIndex ?? 0,
        yAxisIndex: parent.yAxisIndex ?? 0,
        data,
        encode: vert ? { x: [0], y: [1, 2, 3] } : { x: [0, 2, 3], y: [1] },
        z: 5,
        silent: true,
        tooltip: { show: false }
      };
      this.errPending.push([cs, parent.type === "bar" ? parent : null]);
    }
  }
  errAmounts(eb, base) {
    const typ = _v(eb, C + "errValType", "fixedVal"), bt = _v(eb, C + "errBarType", "both");
    const val = _v(eb, C + "val", typ === "percentage" ? 5 : 1, "float");
    const nums = base.filter(isNum3);
    const n = base.length;
    let meanC = null, p, m;
    if (typ === "cust") {
      const [pv] = this.readData(eb.find(C + "plus")), [mv] = this.readData(eb.find(C + "minus"));
      const pick = (arr, j) => {
        const x = arr.length === 1 ? arr[0] : j < arr.length ? arr[j] : null;
        return isNum3(x) ? x : 0;
      };
      p = Array.from({ length: n }, (_, j) => pick(pv, j));
      m = Array.from({ length: n }, (_, j) => pick(mv, j));
    } else {
      let amt;
      if (typ === "fixedVal") amt = new Array(n).fill(val);
      else if (typ === "percentage") amt = base.map((v) => isNum3(v) ? Math.abs(v) * val / 100 : 0);
      else if (typ === "stdDev" || typ === "stdErr") {
        if (nums.length < 2) return null;
        const sd = stdev(nums);
        if (typ === "stdDev") {
          amt = new Array(n).fill(val * sd);
          meanC = mean(nums);
        } else amt = new Array(n).fill(sd / Math.sqrt(nums.length));
      } else {
        this.warnings.push(`error bar type ${pyrepr2(typ)} not supported`);
        return null;
      }
      p = amt.slice();
      m = amt.slice();
    }
    if (bt === "plus") m = new Array(n).fill(0);
    else if (bt === "minus") p = new Array(n).fill(0);
    return [m, p, meanC];
  }
  finalizeErrbars() {
    const series = this.option.series;
    for (const [cs, bar] of this.errPending) {
      if (bar) {
        const cdim = this.barDim.get(bar) ?? "x", keyAx = cdim + "AxisIndex";
        const same = series.filter((b) => b.type === "bar" && this.barDim.get(b) === cdim && (b[keyAx] ?? 0) === (bar[keyAx] ?? 0));
        const keys = [];
        let catGap = "20%", gap = "30%";
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
  trendlines(s, parent, xs, ys, color, category) {
    const sname = parent.name;
    const LABELS = { linear: "Linear", exp: "Expon.", log: "Log.", poly: "Poly.", power: "Power", movingAvg: "Mov. Avg." };
    for (const tl of s.findall(C + "trendline")) {
      const typ = _v(tl, C + "trendlineType", "linear");
      if (!category && typ === "linear") continue;
      const label = LABELS[typ];
      if (label === void 0) {
        this.warnings.push(`trendline type ${pyrepr2(typ)} not supported`);
        continue;
      }
      const period = _v(tl, C + "period", 2, "int"), order = _v(tl, C + "order", 2, "int");
      let nm = tl.findtext(C + "name");
      if (!nm) nm = typ === "movingAvg" ? `${period} per. ${label} (${sname})` : `${label} (${sname})`;
      if (_bool(tl, C + "dispEq") || _bool(tl, C + "dispRSqr")) this.warnings.push("trendline equation / R\xB2 label is not rendered");
      const pts = [];
      for (let j = 0; j < Math.min(xs.length, ys.length); j++) if (isNum3(xs[j]) && isNum3(ys[j])) pts.push([xs[j], ys[j]]);
      let data;
      if (typ === "movingAvg") {
        if (category) {
          data = ys.map((_, j) => {
            const win = j >= period - 1 ? ys.slice(j - period + 1, j + 1) : [];
            const ok = win.length === period && win.every(isNum3);
            return ok ? sig(fsum(win) / period) : null;
          });
        } else {
          data = [];
          for (let j = period - 1; j < pts.length; j++) data.push([sig(pts[j][0]), sig(fsum(pts.slice(j - period + 1, j + 1).map((p) => p[1])) / period)]);
        }
      } else {
        const f = this.trendFn(typ, pts, order, _v(tl, C + "intercept", null, "float"));
        if (!f) {
          this.warnings.push(`${nm}: cannot fit ${typ} trendline to this data`);
          continue;
        }
        if (category) data = ys.map((_, j) => sig(f(j + 1)));
        else {
          let x0 = Math.min(...pts.map((p) => p[0])) - _v(tl, C + "backward", 0, "float");
          const x1 = Math.max(...pts.map((p) => p[0])) + _v(tl, C + "forward", 0, "float");
          if ((typ === "log" || typ === "power") && x0 <= 0) x0 = Math.min(...pts.map((p) => p[0]));
          const steps = typ === "linear" ? 1 : 40;
          data = [];
          for (let i = 0; i <= steps; i++) {
            const x = x0 + (x1 - x0) * i / steps;
            data.push([sig(x), sig(f(x))]);
          }
        }
      }
      const [lc, w, , dash] = lineProps(tl.find(C + "spPr"), this.theme);
      const ls = { color: lc || color, width: w || 2, type: dash || (this.modern ? "dotted" : "solid") };
      const e = {
        name: nm,
        type: "line",
        data,
        xAxisIndex: parent.xAxisIndex ?? 0,
        yAxisIndex: parent.yAxisIndex ?? 0,
        symbol: "none",
        showSymbol: false,
        smooth: typ !== "linear" && typ !== "movingAvg" && category,
        lineStyle: ls,
        itemStyle: { color: lc || color },
        silent: true,
        z: 4,
        tooltip: { show: false }
      };
      if (typ === "movingAvg" || category) e.connectNulls = false;
      this.trendPending.push(e);
    }
  }
  trendFn(typ, pts, order, intercept) {
    if (pts.length < 2) return null;
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    if (typ === "linear") {
      if (intercept !== null) {
        let sxx = 0, sxy = 0;
        for (let i = 0; i < xs.length; i++) {
          sxx += xs[i] * xs[i];
          sxy += xs[i] * (ys[i] - intercept);
        }
        if (!sxx) return null;
        const k2 = sxy / sxx;
        return (x) => k2 * x + intercept;
      }
      const r = linreg(xs, ys);
      if (!r) return null;
      const [k, b] = r;
      return (x) => k * x + b;
    }
    if (typ === "exp") {
      if (ys.some((y) => y <= 0)) return null;
      const r = linreg(xs, ys.map((y) => Math.log(y)));
      if (!r) return null;
      const [k, b] = r, a = Math.exp(b);
      return (x) => a * Math.exp(k * x);
    }
    if (typ === "log") {
      if (xs.some((x) => x <= 0)) return null;
      const r = linreg(xs.map((x) => Math.log(x)), ys);
      if (!r) return null;
      const [k, b] = r;
      return (x) => k * Math.log(x) + b;
    }
    if (typ === "power") {
      if (xs.some((x) => x <= 0) || ys.some((y) => y <= 0)) return null;
      const r = linreg(xs.map((x) => Math.log(x)), ys.map((y) => Math.log(y)));
      if (!r) return null;
      const [k, b] = r, a = Math.exp(b);
      return (x) => a * x ** k;
    }
    if (typ === "poly") {
      const coef = polyfit(xs, ys, Math.max(2, Math.min(6, order)));
      if (!coef) return null;
      return (x) => polyval(coef, x);
    }
    return null;
  }
  g_bubbleChart(g, sers) {
    this.g_scatterChart(g, sers, true);
  }
  g_radarChart(g, sers) {
    const style = _v(g, C + "radarStyle", "marker");
    const [catId, valId] = this.catValAxes(g);
    const [labels] = this.categories(sers, catId);
    const valsAll = sers.map((s) => this.values(s));
    const ent = this.axes.get(valId);
    const ax = ent ? ent[1] : null;
    const sc = ax ? ax.find(C + "scaling") : null;
    let mx = _v(sc, C + "max", null, "float"), mn = _v(sc, C + "min", null, "float");
    const allv = valsAll.flatMap(([v]) => v.filter(isNum3));
    if (mx === null) mx = niceMax(Math.max(...allv, 1));
    if (mn === null) mn = Math.min(0, Math.min(...allv, 0));
    const font = this.font(null, this.baseFont.fontSize * 3 / 4);
    this.option.radar = {
      indicator: labels.map((l) => ({ name: l, max: mx, min: mn })),
      radius: "65%",
      center: ["50%", "55%"],
      shape: "polygon",
      splitNumber: 5,
      axisName: { color: font.color, fontSize: font.fontSize },
      splitArea: { show: false },
      splitLine: { show: true, lineStyle: { color: "#D9D9D9" } },
      axisLine: { lineStyle: { color: "#D9D9D9" } }
    };
    const data = sers.map((s, i) => {
      const [vals, fmt] = valsAll[i];
      const [color, w] = this.seriesLine(s);
      const fill = fillColor(s.find(C + "spPr"), this.theme) || color;
      const d = { name: this.seriesName(s, i), value: vals, itemStyle: { color }, lineStyle: { color, width: w || 2.67 } };
      if (style === "filled") {
        d.areaStyle = { color: fill, opacity: sers.length === 1 ? 1 : 0.6 };
        d.itemStyle = { color: fill };
        d.symbol = "none";
      } else {
        const mk = this.marker(s, style === "marker", i);
        if (mk) {
          d.symbol = mk[0];
          d.symbolSize = mk[1];
        } else d.symbol = "none";
      }
      const lab = this.labels(g, s, "line", fmt);
      if (lab) d.label = lab;
      return d;
    });
    this.option.series.push({ type: "radar", data });
  }
  g_stockChart(g, sers) {
    this.warnings.push("stockChart rendered as line series");
    this.g_lineChart(g, sers);
  }
  legend(lg) {
    if (!lg) {
      this.option.legend = { show: false };
      return;
    }
    const pos = _v(lg, C + "legendPos", "r");
    const font = this.font(lg.find(C + "txPr"), this.baseFont.fontSize * 3 / 4);
    const e = { show: true, _pos: pos, textStyle: { color: font.color, fontSize: font.fontSize }, itemWidth: this.pieLike || !this.hasLine() ? 10 : 20, itemHeight: 10 };
    if (pos === "r" || pos === "l") Object.assign(e, { orient: "vertical", top: "middle", ...pos === "r" ? { right: 10 } : { left: 10 } });
    else if (pos === "tr") Object.assign(e, { orient: "vertical", top: 40, right: 10 });
    else if (pos === "t") Object.assign(e, { orient: "horizontal", top: this.option.title || this.chartEl.find(C + "title") ? 40 : 8, left: "center" });
    else Object.assign(e, { orient: "horizontal", bottom: 8, left: "center" });
    const mxy = manualXY(lg);
    if (mxy) {
      for (const k of ["left", "right", "top", "bottom"]) delete e[k];
      [e.left, e.top] = mxy;
    }
    const deleted = new Set(lg.findall(C + "legendEntry").filter((le) => _bool(le, C + "delete")).map((le) => _v(le, C + "idx", -1, "int")));
    if (deleted.size) {
      let names = [];
      if (this.pieLike) names = this.option.series.length ? this.option.series[0].data.map((d) => d.name) : [];
      else for (const s of this.option.series) {
        if (s.type === "radar") names.push(...s.data.map((d) => d.name));
        else names.push(s.name);
      }
      e.data = names.filter((_, i) => !deleted.has(i));
    }
    this.option.legend = e;
  }
  hasLine() {
    return this.option.series.some((s) => s.type === "line" && !("areaStyle" in s));
  }
};
function xOccupied(lst) {
  return lst.some((a) => a.position !== "top" && (a.axisLabel.show || a.axisLine.show));
}
function manualXY(el) {
  const ml = el ? el.find(`${C}layout/${C}manualLayout`) : null;
  if (!ml || _v(ml, C + "xMode", "factor") !== "edge" || _v(ml, C + "yMode", "factor") !== "edge") return null;
  const x = _v(ml, C + "x", null, "float"), y = _v(ml, C + "y", null, "float");
  if (x === null || y === null) return null;
  return [`${jnum(pyRound(x * 100, 2))}%`, `${jnum(pyRound(y * 100, 2))}%`];
}
function niceMax(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (v <= m * p) return m * p;
  return 10 * p;
}
function pyrepr2(s) {
  return s.includes("'") && !s.includes('"') ? `"${s}"` : `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}
function anchor(sheet, anc) {
  const tag = local(anc.tag);
  const fr = anc.find(XDR + "from"), to = anc.find(XDR + "to");
  const pos = (el) => [parseInt(el.findtext(XDR + "col"), 10), parseInt(el.findtext(XDR + "colOff") || "0", 10), parseInt(el.findtext(XDR + "row"), 10), parseInt(el.findtext(XDR + "rowOff") || "0", 10)];
  if (tag === "twoCellAnchor" && fr && to) {
    const [c1, co1, r1, ro1] = pos(fr), [c2, co2, r2, ro2] = pos(to);
    let w2 = 0;
    for (let c = c1; c < c2; c++) w2 += sheet.colPx(c + 1);
    w2 = w2 - co1 / EMU_PX + co2 / EMU_PX;
    let h2 = 0;
    for (let r = r1; r < r2; r++) h2 += sheet.rowPx(r + 1);
    h2 = h2 - ro1 / EMU_PX + ro2 / EMU_PX;
    return [`${num2col(c1 + 1)}${r1 + 1}:${num2col(c2 + 1)}${r2 + 1}`, pyRound(w2), pyRound(h2)];
  }
  const ext = anc.find(XDR + "ext");
  const w = ext ? parseInt(ext.get("cx"), 10) / EMU_PX : 480, h = ext ? parseInt(ext.get("cy"), 10) / EMU_PX : 288;
  if (fr) {
    const [c1, , r1] = pos(fr);
    return [`${num2col(c1 + 1)}${r1 + 1}`, pyRound(w), pyRound(h)];
  }
  return [null, pyRound(w), pyRound(h)];
}
var MC = "{http://schemas.openxmlformats.org/markup-compatibility/2006}";
function anchors(droot) {
  const out = [];
  for (const a of droot.children) {
    if (a.tag === MC + "AlternateContent") {
      const ch = a.find(MC + "Choice") ?? a.find(MC + "Fallback");
      if (ch) out.push(...ch.children);
    } else out.push(a);
  }
  return out;
}
function one(wb, cpart, sheet, anc, w, h, name, excelCompat, ex = false) {
  const id = cpart.slice(cpart.lastIndexOf("/") + 1).replace(/\.[^.]*$/, "");
  try {
    const cv = new ChartConverter(wb, cpart, excelCompat);
    const r = ex ? new ChartEx(cv).convert() : cv.convert();
    return { id, part: cpart, sheet, anchor: anc, name, title: r.option?.title?.text ?? null, width: Math.max(w, 200), height: Math.max(h, 150), types: r.types, usedFormulaFallback: cv.usedFormulaFallback, warnings: r.warnings, option: r.option };
  } catch (e) {
    return { id, part: cpart, sheet, anchor: anc, name, title: null, width: w, height: h, types: [], warnings: [`conversion failed: ${e?.message ?? e}`], option: null };
  }
}
async function toBytes(src) {
  if (src instanceof Uint8Array) return src;
  if (src instanceof ArrayBuffer) return new Uint8Array(src);
  if (typeof Blob !== "undefined" && src instanceof Blob) return new Uint8Array(await src.arrayBuffer());
  if (typeof src === "string") {
    const fs = await import(
      /* webpackIgnore: true */
      "node:fs/promises"
    );
    return new Uint8Array(await fs.readFile(src));
  }
  throw new TypeError("convertXlsx: expected path, Uint8Array, ArrayBuffer or Blob");
}
async function convertXlsx(src, opts = {}) {
  const excelCompat = opts.excelCompat ?? true;
  const wb = await Workbook.open(await toBytes(src));
  wb.geojson = typeof opts.geojson === "string" ? JSON.parse(opts.geojson) : opts.geojson ?? null;
  const charts = [], warnings = [], seen = /* @__PURE__ */ new Set();
  for (const sh of wb.sheetOrder) {
    for (const [, [dpart, typ]] of wb.rels(sh.part)) {
      if (typ !== "drawing" || !wb.names.includes(dpart)) continue;
      const droot = wb.xml(dpart), drels = wb.rels(dpart);
      for (const anc of anchors(droot)) {
        for (const gf of anc.iter(`{${NS.c}}chart`)) {
          const crid = gf.get(R_ID);
          if (!drels.has(crid)) continue;
          const cpart = drels.get(crid)[0];
          seen.add(cpart);
          const nameEl = anc.find(`.//${XDR}cNvPr`);
          let a, w, h;
          if (sh.kind === "chartsheet") {
            a = null;
            w = 900;
            h = 560;
          } else {
            if (sh.kind === "worksheet") sh.cells;
            [a, w, h] = anchor(sh, anc);
          }
          charts.push(one(wb, cpart, sh.name, a, w, h, nameEl ? nameEl.get("name") ?? null : null, excelCompat));
        }
        for (const gf of anc.iter(`{${CXNS}}chart`)) {
          const crid = gf.get(R_ID);
          if (!drels.has(crid)) continue;
          const cpart = drels.get(crid)[0];
          seen.add(cpart);
          const nameEl = anc.find(`.//${XDR}cNvPr`);
          let a, w, h;
          if (sh.kind === "chartsheet") {
            a = null;
            w = 900;
            h = 560;
          } else {
            if (sh.kind === "worksheet") sh.cells;
            [a, w, h] = anchor(sh, anc);
          }
          charts.push(one(wb, cpart, sh.name, a, w, h, nameEl ? nameEl.get("name") ?? null : null, excelCompat, true));
        }
      }
    }
  }
  for (const name of wb.names) if (/^xl\/charts\/chart(Ex)?\d+\.xml$/.test(name) && !seen.has(name)) charts.push(one(wb, name, null, null, 600, 360, null, excelCompat, name.includes("chartEx")));
  charts.forEach((c, i) => c.index = i);
  if (wb.failedFormulas.length) warnings.push(`${wb.failedFormulas.length} formula(s) could not be evaluated: ` + wb.failedFormulas.slice(0, 5).join("; "));
  return { charts, warnings, sheets: wb.sheetOrder.map((s) => s.name), evaluatedFormulas: wb.evaluatedFormulas };
}

// src/runtime.ts
function fmtNumber(v, code) {
  if (typeof v !== "number" || !isFinite(v)) return v == null ? "" : String(v);
  if (!code || code === "General" || code === "@") return String(+v.toPrecision(12));
  const sec = code.split(";");
  let c = v < 0 && sec.length > 1 ? sec[1] : sec[0];
  const neg = v < 0 && sec.length > 1;
  if (v === 0 && sec.length > 2) c = sec[2];
  c = c.replace(/\[[^\]]*\]|_.|\*.|\\|"/g, "");
  const pct2 = c.includes("%");
  let x = pct2 ? v * 100 : v;
  if (neg) x = Math.abs(x);
  const m = /[0#]+(?:[.,][0#]+)*/.exec(c);
  if (!m) return c;
  const pat = m[0], dec = pat.includes(".") ? pat.split(".")[1].length : 0;
  if (/^E\+?0+/i.test(c.slice(m.index + pat.length))) return x.toExponential(dec).toUpperCase().replace(/E([+-]?)(\d+)$/, (_m, sg, d) => "E" + (sg === "-" ? "-" : "+") + (d.length < 2 ? "0" + d : d));
  let body = x.toFixed(dec);
  if (pat.split(".")[0].includes(",")) {
    const p = body.split(".");
    p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    body = p.join(".");
  }
  return c.slice(0, m.index) + body + c.slice(m.index + pat.length);
}
var pad2 = (n) => (n < 10 ? "0" : "") + n;
function fmtDate(t, code) {
  const d = new Date(t);
  if (isNaN(+d)) return String(t);
  const c = (code || "yyyy-mm-dd").split(";")[0].replace(/\[[^\]]*\]/g, "");
  let out = "", i = 0, prevH = false;
  while (i < c.length) {
    const ch = c[i];
    if (ch === '"') {
      let j = c.indexOf('"', i + 1);
      if (j < 0) j = c.length;
      out += c.slice(i + 1, j);
      i = j + 1;
      continue;
    }
    if (ch === "\\") {
      out += c[i + 1] || "";
      i += 2;
      continue;
    }
    const m = /^(y+|m+|d+|h+|s+|AM\/PM)/i.exec(c.slice(i));
    if (m) {
      const tk = m[0], l = tk.toLowerCase();
      i += tk.length;
      if (l[0] === "y") out += tk.length > 2 ? d.getFullYear() : pad2(d.getFullYear() % 100);
      else if (l[0] === "d") out += tk.length === 1 ? d.getDate() : pad2(d.getDate());
      else if (l[0] === "h") {
        prevH = true;
        out += tk.length === 1 ? d.getHours() : pad2(d.getHours());
      } else if (l[0] === "s") out += pad2(d.getSeconds());
      else if (l[0] === "m") {
        if (prevH && tk.length <= 2) out += tk.length === 1 ? d.getMinutes() : pad2(d.getMinutes());
        else out += tk.length === 1 ? d.getMonth() + 1 : tk.length === 2 ? pad2(d.getMonth() + 1) : d.toLocaleString("en", { month: tk.length === 3 ? "short" : "long" });
        prevH = false;
      } else out += d.getHours() < 12 ? "AM" : "PM";
      continue;
    }
    if (ch !== "_" && ch !== "*") out += ch;
    else i++;
    i++;
  }
  return out;
}
function getPath(o, path) {
  let cur = o;
  for (const k of path.split(".")) {
    if (cur == null) return null;
    if (/^\d+$/.test(k) && !Array.isArray(cur)) {
      if (+k !== 0) return null;
      continue;
    }
    if (cur[k] == null) cur[k] = {};
    cur = cur[k];
  }
  return cur;
}
function seriesFmt(tpl, code) {
  return (p) => {
    const v = Array.isArray(p.value) ? p.value[1] : p.value;
    return tpl.replace(/\{a\}/g, p.seriesName || "").replace(/\{b\}/g, p.name || "").replace(/\{c\}|\{@\[1\]\}/g, fmtNumber(v, code)).replace(/\{d\}/g, p.percent != null ? String(p.percent) : "");
  };
}
var seg = (x1, y1, x2, y2, style) => ({ type: "line", shape: { x1, y1, x2, y2 }, style });
function barOffset(band, b) {
  const w = Math.max((band - band * b.catGap) / (b.slots + (b.slots - 1) * b.gap), 0);
  const sum2 = w * b.slots + (b.slots - 1) * b.gap * w;
  return -sum2 / 2 + b.slot * w * (1 + b.gap) + w / 2;
}
function boxOffset(band, slot, slots) {
  const h = 0.8 * band - 2, c = h / slots * 0.3, p = (h - c * (slots - 1)) / slots;
  return p / 2 - h / 2 + slot * (c + p);
}
var renderers = {
  /** item [x, y, lo, hi]: error bar from lo to hi along y (dir v) or x (dir h), aligned with clustered/stacked bars */
  errorBar: (cfg) => (_p, api) => {
    const x = api.value(0), y = api.value(1), lo = api.value(2), hi = api.value(3);
    if ([x, y, lo, hi].some((v2) => v2 == null || typeof v2 === "number" && isNaN(v2))) return null;
    const v = cfg.dir !== "h";
    const p0 = api.coord(v ? [x, lo] : [lo, y]), p1 = api.coord(v ? [x, hi] : [hi, y]);
    if (cfg.bar) {
      const off = barOffset(v ? api.size([1, 0])[0] : api.size([0, 1])[1], cfg.bar);
      const k = v ? 0 : 1;
      p0[k] += off;
      p1[k] += off;
    }
    const st = { stroke: cfg.color || "#595959", lineWidth: cfg.width || 1, fill: null }, c = 4;
    const ch = [seg(p0[0], p0[1], p1[0], p1[1], st)];
    if (cfg.cap !== false) for (const p of [p0, p1]) ch.push(v ? seg(p[0] - c, p[1], p[0] + c, p[1], st) : seg(p[0], p[1] - c, p[0], p[1] + c, st));
    return { type: "group", children: ch };
  },
  /** item [categoryIndex, y, kind]: kind 0 = mean marker (×), 1 = outlier, 2 = inner point */
  boxPoints: (cfg) => (_p, api) => {
    const ci = api.value(0), y = api.value(1), k = api.value(2);
    const p = api.coord([ci, y]);
    p[0] += boxOffset(api.size([1, 0])[0], cfg.slot, cfg.slots);
    if (k === 0) {
      const st = { stroke: "#262626", lineWidth: 1.5 }, r = 4;
      return { type: "group", children: [seg(p[0] - r, p[1] - r, p[0] + r, p[1] + r, st), seg(p[0] - r, p[1] + r, p[0] + r, p[1] - r, st)] };
    }
    return { type: "circle", shape: { cx: p[0], cy: p[1], r: k === 1 ? 3 : 2.5 }, style: k === 1 ? { fill: cfg.color, stroke: "#FFFFFF", lineWidth: 0.5 } : { fill: "#FFFFFF", stroke: cfg.color, lineWidth: 1 } };
  },
  /** item [ci1, mean1, ci2, mean2]: mean line segment between neighbouring categories */
  boxMeanLine: (cfg) => (_p, api) => {
    const band = api.size([1, 0])[0], off = boxOffset(band, cfg.slot, cfg.slots);
    const a = api.coord([api.value(0), api.value(1)]), b = api.coord([api.value(2), api.value(3)]);
    return seg(a[0] + off, a[1], b[0] + off, b[1], { stroke: cfg.color, lineWidth: 1.5 });
  }
};
function serialToLocal(v, sys) {
  if (typeof v !== "number" || !isFinite(v)) return v;
  const ms = Math.round((v - (sys === 1904 ? 24107 : 25569)) * 864e5);
  return new Date(ms).toISOString().slice(0, 19);
}
function prepare(option) {
  const o = JSON.parse(JSON.stringify(option));
  for (const s of Array.isArray(o.series) ? o.series : []) {
    const r = s["x-renderItem"];
    if (!r) continue;
    if (renderers[r]) s.renderItem = renderers[r](s["x-cfg"] || {});
    delete s["x-renderItem"];
    delete s["x-cfg"];
  }
  for (const h of o["x-numFmt"] || []) {
    const tgt = getPath(o, h.path);
    if (!tgt) continue;
    const code = h.formatCode;
    const dt = (v) => fmtDate(h.serial ? serialToLocal(v, h.serial) : v, code);
    if (h.tooltip && h.date) {
      tgt.valueFormatter = (v) => Array.isArray(v) ? [dt(v[0]), ...v.slice(1).map((x) => fmtNumber(x, "General"))].join(", ") : dt(v);
      continue;
    }
    if (h.tooltip) {
      tgt.valueFormatter = (v) => fmtNumber(Array.isArray(v) ? v[v.length - 1] : v, code);
      continue;
    }
    tgt.formatter = h.date ? dt : h.path.startsWith("series") ? seriesFmt(typeof tgt.formatter === "string" ? tgt.formatter : "{c}", code) : (v) => fmtNumber(v, code);
  }
  delete o["x-numFmt"];
  return o;
}
async function registerMaps(echarts, option, opts = {}) {
  const g = option && option["x-geo"];
  if (!g) return;
  if (echarts.getMap && echarts.getMap(g.map) && g.source !== "custom") return;
  let fc = g.source === "custom" && opts.geojson ? opts.geojson : opts.maps && opts.maps[g.source];
  if (typeof fc === "string") fc = JSON.parse(fc);
  if (!fc) {
    const r = await fetch((opts.baseUrl ?? "geo/") + g.source + ".json");
    fc = await r.json();
  }
  echarts.registerMap(g.map, fc);
}

// src/index.ts
var VERSION = "1.1.1";
export {
  VERSION,
  convertXlsx,
  fmtDate,
  fmtNumber,
  match as geoMatch,
  norm as geoNorm,
  prepare,
  registerMaps,
  renderers
};
