/** Tiny namespace-aware XML parser with an ElementTree-like API ("{uri}local" tags). */
export class El {
  tag: string; attrib: Record<string, string>; children: El[] = []; text: string | null = null; tail: string | null = null;
  constructor(tag: string, attrib: Record<string, string> = {}) { this.tag = tag; this.attrib = attrib; }
  get(k: string, d?: string): string | undefined { return k in this.attrib ? this.attrib[k] : d; }
  get length() { return this.children.length; }
  *iter(tag?: string): Generator<El> {
    if (!tag || this.tag === tag) yield this;
    for (const c of this.children) yield* c.iter(tag);
  }
  findall(path: string): El[] {
    let cur: El[] = [this];
    let parts = splitPath(path);
    let deep = false;
    if (parts[0] === ".") parts = parts.slice(1);
    const out: El[] = [];
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (p === "") { deep = true; continue; }
      const nxt: El[] = [];
      for (const e of cur) {
        if (deep) { for (const d of e.iter()) if (d !== e) { if (d.tag === p) nxt.push(d); } }
        else for (const c of e.children) if (c.tag === p) nxt.push(c);
      }
      deep = false; cur = nxt;
    }
    out.push(...cur);
    return out;
  }
  find(path: string): El | null { return this.findall(path)[0] ?? null; }
  findtext(path: string, d: string | null = null): string | null { const e = this.find(path); return e ? (e.text ?? "") : d; }
}

function splitPath(p: string): string[] {
  const out: string[] = []; let cur = "", depth = 0;
  for (const ch of p) {
    if (ch === "{") depth++; else if (ch === "}") depth--;
    if (ch === "/" && depth === 0) { out.push(cur); cur = ""; } else cur += ch;
  }
  out.push(cur); return out;
}

const ENT: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };
function unesc(s: string) {
  if (s.indexOf("&") < 0) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|\w+);/g, (m, g: string) =>
    g[0] === "#" ? String.fromCodePoint(g[1] === "x" ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10)) : (ENT[g] ?? m));
}

export function parseXML(src: string): El {
  let i = 0; const n = src.length;
  if (src.charCodeAt(0) === 0xfeff) i = 1;
  const stack: { el: El; ns: Record<string, string> }[] = [];
  let root: El | null = null;
  let nsTop: Record<string, string> = { xml: "http://www.w3.org/XML/1998/namespace" };
  const addText = (t: string) => {
    if (!stack.length || !t) return;
    const el = stack[stack.length - 1].el;
    if (el.children.length) { const l = el.children[el.children.length - 1]; l.tail = (l.tail ?? "") + t; }
    else el.text = (el.text ?? "") + t;
  };
  const qn = (name: string, ns: Record<string, string>, isAttr: boolean) => {
    const k = name.indexOf(":");
    if (k < 0) return isAttr ? name : (ns[""] ? `{${ns[""]}}${name}` : name);
    const p = name.slice(0, k), uri = ns[p];
    return uri ? `{${uri}}${name.slice(k + 1)}` : name;
  };
  while (i < n) {
    const lt = src.indexOf("<", i);
    if (lt < 0) { addText(unesc(src.slice(i))); break; }
    if (lt > i) addText(unesc(src.slice(i, lt)));
    if (src.startsWith("<!--", lt)) { i = src.indexOf("-->", lt) + 3; if (i < 3) break; continue; }
    if (src.startsWith("<![CDATA[", lt)) { const e = src.indexOf("]]>", lt); addText(src.slice(lt + 9, e)); i = e + 3; continue; }
    if (src.startsWith("<?", lt)) { i = src.indexOf("?>", lt) + 2; continue; }
    if (src.startsWith("<!", lt)) { i = src.indexOf(">", lt) + 1; continue; }
    if (src[lt + 1] === "/") {
      const gt = src.indexOf(">", lt);
      const fin = stack.pop();
      if (fin) nsTop = stack.length ? stack[stack.length - 1].ns : nsTop;
      i = gt + 1; continue;
    }
    // start tag
    let j = lt + 1; let q: string | null = null;
    while (j < n) { const ch = src[j]; if (q) { if (ch === q) q = null; } else if (ch === '"' || ch === "'") q = ch; else if (ch === ">") break; j++; }
    let body = src.slice(lt + 1, j);
    const selfClose = body.endsWith("/");
    if (selfClose) body = body.slice(0, -1);
    const m = /^([^\s]+)/.exec(body)!;
    const rawName = m[1];
    const rawAttrs: [string, string][] = [];
    const re = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g; let a: RegExpExecArray | null;
    const rest = body.slice(rawName.length);
    while ((a = re.exec(rest))) rawAttrs.push([a[1], unesc(a[3] ?? a[4] ?? "")]);
    const parentNs = stack.length ? stack[stack.length - 1].ns : nsTop;
    let ns = parentNs;
    for (const [k, v] of rawAttrs) {
      if (k === "xmlns" || k.startsWith("xmlns:")) { if (ns === parentNs) ns = { ...parentNs }; ns[k === "xmlns" ? "" : k.slice(6)] = v; }
    }
    const attrib: Record<string, string> = {};
    for (const [k, v] of rawAttrs) if (!(k === "xmlns" || k.startsWith("xmlns:"))) attrib[qn(k, ns, true)] = v;
    const el = new El(qn(rawName, ns, false), attrib);
    if (stack.length) stack[stack.length - 1].el.children.push(el); else root = el;
    if (!selfClose) stack.push({ el, ns });
    i = j + 1;
  }
  if (!root) throw new Error("empty XML document");
  return root;
}
