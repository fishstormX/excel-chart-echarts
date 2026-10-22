/** regionMap support: bundled Natural Earth boundaries (public domain) + region-name matching. Mirrors xlsx2echarts/geo.py. */
import { GEO_INDEX } from "./geoindex.js";

const SUFFIXES = ["特别行政区", "维吾尔自治区", "壮族自治区", "回族自治区", "自治区", "省", "市"];
const PUNCT = /[\s.,'’`"()\-_/·&]+/g;
export const CUSTOM_KEYS = ["name", "NAME", "name_zh", "NAME_ZH", "name_en", "NAME_EN", "NAME_LONG", "ADMIN", "iso_a2", "ISO_A2", "iso_a3", "ISO_A3", "id", "code"];

export function norm(s: any): string {
  const t = String(s).toLowerCase().replace(PUNCT, "");
  for (const suf of SUFFIXES) if (t.endsWith(suf) && t.length > suf.length) return t.slice(0, -suf.length);
  return t;
}
export function customIndex(geojson: any): [Record<string, string>, string] {
  const feats: any[] = geojson?.features || [];
  const nameProp = CUSTOM_KEYS.find((k) => feats.some((f) => k in (f.properties || {}))) ?? "name";
  const idx: Record<string, string> = {};
  for (const k of CUSTOM_KEYS) for (const f of feats) {
    const p = f.properties || {}; const nm = p[nameProp];
    if (p[k] === null || p[k] === undefined || nm === null || nm === undefined) continue;
    const a = norm(p[k]); if (a && !(a in idx)) idx[a] = String(nm);
  }
  return [idx, nameProp];
}
export function match(names: any[], geojson?: any): [string, string, string | null, (string | null)[]] | null {
  const cands: [string, string, string | null, Record<string, string>][] = [];
  if (geojson !== undefined && geojson !== null) { const [idx, prop] = customIndex(geojson); cands.push(["x2e-custom", "custom", prop, idx]); }
  cands.push(["x2e-china", "china", null, GEO_INDEX.china], ["x2e-world", "world", null, GEO_INDEX.world]);
  let best: [number, [string, string, string | null, (string | null)[]]] | null = null;
  for (const [key, src, prop, idx] of cands) {
    const res = names.map((n) => (n === null || n === undefined ? null : Object.prototype.hasOwnProperty.call(idx, norm(n)) ? idx[norm(n)] : null));
    const hits = res.filter((r) => r !== null).length;
    if (hits && (best === null || hits > best[0])) best = [hits, [key, src, prop, res]];
  }
  return best ? best[1] : null;
}
