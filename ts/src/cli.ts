#!/usr/bin/env node
/** excel-chart-echarts CLI: excel-chart-echarts book.xlsx -o outdir  (also .xlsm/.xltx/.xltm; same layout as Python CLI)
 *
 * Quick JSON only:
 *   excel-chart-echarts book.xlsx -j
 *   excel-chart-echarts book.xlsx -j -o out.json
 */
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { convertXlsx } from "./converter.js";
import { OOXML_EXT_RE } from "./formats.js";
import { VERSION } from "./index.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#x27;" } as any)[c]);

const PREVIEW = (title: string, data: string, geo: string) => `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>xlsx2echarts preview – ${title}</title>
<script src="echarts.min.js"></script><script src="x2e-runtime.js"></script>
<style>body{font-family:system-ui,sans-serif;background:#f3f4f6;margin:16px}.c{display:inline-block;vertical-align:top;margin:8px;background:#fff;
border:1px solid #ddd;border-radius:8px;padding:8px}.c h3{margin:0 0 6px;font-size:13px;color:#333}.c small{color:#888}.w{color:#b45309;font-size:12px;max-width:600px}</style></head>
<body><h2>${title}</h2><div id="root"></div><script>
var DATA = ${data};
var GEO = ${geo};
DATA.forEach(function (c, i) {
  var d = document.createElement("div"); d.className = "c";
  d.innerHTML = "<h3></h3><small></small><div class=chart></div><div class=w></div>";
  d.querySelector("h3").textContent = (c.file ? c.file + " · " : "") + c.id + (c.title ? " — " + c.title : "");
  d.querySelector("small").textContent = (c.sheet || "") + (c.anchor ? " " + c.anchor : "") + " · " + c.types.join(" + ");
  d.querySelector(".w").textContent = (c.warnings || []).join(" | ");
  var el = d.querySelector(".chart"); el.style.width = Math.max(c.width, 360) + "px"; el.style.height = Math.max(c.height, 260) + "px";
  document.getElementById("root").appendChild(d);
  if (c.option) X2E.registerMaps(echarts, c.option, {maps: GEO}).then(function () { echarts.init(el, null, {renderer: "canvas"}).setOption(X2E.prepare(c.option)); });
});
window.__done = true;
</script></body></html>`;

async function main(argv: string[]) {
  const a = { inputs: [] as string[], out: "echarts_out", preview: true, compat: true, json: false, stdout: false, geojson: null as string | null };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === "-o" || x === "--out") a.out = argv[++i];
    else if (x === "-j" || x === "--json") a.json = true;
    else if (x === "--no-preview") a.preview = false;
    else if (x === "--show-missing-axes") a.compat = false;
    else if (x === "--stdout") { a.stdout = true; a.json = true; }
    else if (x === "--geojson") a.geojson = argv[++i];
    else if (x === "-V" || x === "--version") { console.log(`excel-chart-echarts ${VERSION}`); return 0; }
    else if (x === "-h" || x === "--help") {
      console.log(`usage: excel-chart-echarts [-j] [-o OUT] [--no-preview] [--show-missing-axes] [--geojson FILE] inputs...

Convert native Excel charts in .xlsx/.xlsm/.xltx/.xltm to ECharts option JSON

  -j, --json          one-shot JSON only (stdout, or -o FILE.json); no preview / split files
  -o, --out OUT       output directory (full export) or .json path (with -j)
  --no-preview        skip preview.html (full export only)

examples:
  excel-chart-echarts book.xlsx -j
  excel-chart-echarts book.xlsx -j -o out.json
  excel-chart-echarts book.xlsx -o out/`);
      return 0;
    } else a.inputs.push(x);
  }
  if (!a.inputs.length) { console.error("excel-chart-echarts: error: the following arguments are required: inputs"); return 2; }
  const files: string[] = [];
  for (const p of a.inputs) {
    const st = await fs.stat(p).catch(() => null);
    if (st?.isDirectory()) files.push(...(await fs.readdir(p)).filter((n) => OOXML_EXT_RE.test(n) && !n.startsWith("~$")).sort().map((n) => path.join(p, n)));
    else files.push(p);
  }
  const gj = a.geojson ? JSON.parse(await fs.readFile(a.geojson, "utf8")) : null;
  const jsonOnly = a.json || a.stdout;

  if (jsonOnly) {
    const results: any[] = [];
    let rc = 0;
    for (const f of files) {
      try {
        const res = await convertXlsx(f, { excelCompat: a.compat, geojson: gj });
        results.push({ file: path.basename(f), ...res });
      } catch (e: any) {
        console.error(`✗ ${f}: ${e?.message ?? e}`);
        rc = 1;
      }
    }
    if (!results.length && rc) return rc;
    const payload = results.length === 1 ? results[0] : { files: results };
    const text = JSON.stringify(payload, null, 2);
    if (a.json && a.out !== "echarts_out") {
      await fs.mkdir(path.dirname(path.resolve(a.out)), { recursive: true });
      await fs.writeFile(a.out, text + "\n");
      console.error(`✓ JSON → ${a.out}`);
    } else {
      console.log(text);
    }
    return rc;
  }

  const all: any[] = []; let rc = 0;
  for (const f of files) {
    let res;
    try { res = await convertXlsx(f, { excelCompat: a.compat, geojson: gj }); } catch (e: any) { console.error(`✗ ${f}: ${e?.message ?? e}`); rc = 1; continue; }
    const base = path.basename(f);
    const sub = files.length > 1 ? path.join(a.out, base.replace(/\.[^.]*$/, "")) : a.out;
    await fs.mkdir(sub, { recursive: true });
    const entries: any[] = [];
    for (const c of res.charts) {
      const fn = `${c.sheet || "chart"}_${c.id}.json`.replace(/\//g, "_").replace(/ /g, "_");
      await fs.writeFile(path.join(sub, fn), JSON.stringify(c.option, null, 2));
      const { option, ...meta } = c as any;
      meta.file = path.relative(a.out, path.join(sub, fn));
      entries.push(meta); all.push({ ...c, file: base });
    }
    await fs.writeFile(path.join(sub, "index.json"), JSON.stringify({ source: base, sheets: res.sheets, warnings: res.warnings, charts: entries }, null, 2));
    console.log(`✓ ${base}: ${entries.length} chart(s) → ${sub}` + (res.warnings.length ? `  ⚠ ${res.warnings.join("; ")}` : ""));
    if (!entries.length) console.log("  (no native Excel charts found — plain tables are not converted)");
  }
  const geoSrcs = [...new Set(all.map((c) => c.option?.["x-geo"]?.source).filter((s) => s))].sort() as string[];
  if (geoSrcs.length) {
    await fs.mkdir(path.join(a.out, "geo"), { recursive: true });
    for (const s of geoSrcs) await fs.copyFile(s === "custom" ? a.geojson! : path.join(HERE, "..", "geo", `${s}.json`), path.join(a.out, "geo", `${s}.json`));
  }
  if (all.length && a.preview) {
    for (const f of ["echarts.min.js", "x2e-runtime.js"]) await fs.copyFile(path.join(HERE, "..", "static", f), path.join(a.out, f));
    let geo = "{";
    for (const s of geoSrcs) geo += (geo.length > 1 ? "," : "") + `"${s}":` + (await fs.readFile(path.join(a.out, "geo", `${s}.json`), "utf8")).replace(/<\//g, "<\\/");
    geo += "}";
    await fs.writeFile(path.join(a.out, "preview.html"), PREVIEW(esc(files.map((f) => path.basename(f)).join(", ")), JSON.stringify(all).replace(/<\//g, "<\\/"), geo));
    console.log(`preview: ${path.join(a.out, "preview.html")}`);
  }
  return rc;
}
main(process.argv.slice(2)).then((c) => process.exit(c));
