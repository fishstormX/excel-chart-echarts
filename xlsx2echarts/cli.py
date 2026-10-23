"""xlsx2echarts CLI:  xlsx2echarts book.xlsx -o outdir   (also accepts .xlsm/.xltx/.xltm, several files / a folder)"""
from __future__ import annotations

import argparse
import html
import json
import shutil
import sys
from pathlib import Path

from .converter import convert_xlsx
from .formats import OOXML_GLOB
from .version import __version__

STATIC = Path(__file__).parent / "static"

PREVIEW = """<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>xlsx2echarts preview – {title}</title>
<script src="echarts.min.js"></script><script src="x2e-runtime.js"></script>
<style>body{{font-family:system-ui,sans-serif;background:#f3f4f6;margin:16px}}.c{{display:inline-block;vertical-align:top;margin:8px;background:#fff;
border:1px solid #ddd;border-radius:8px;padding:8px}}.c h3{{margin:0 0 6px;font-size:13px;color:#333}}.c small{{color:#888}}.w{{color:#b45309;font-size:12px;max-width:600px}}</style></head>
<body><h2>{title}</h2><div id="root"></div><script>
var DATA = {data};
var GEO = {geo};
DATA.forEach(function (c, i) {{
  var d = document.createElement("div"); d.className = "c";
  d.innerHTML = "<h3></h3><small></small><div class=chart></div><div class=w></div>";
  d.querySelector("h3").textContent = (c.file ? c.file + " · " : "") + c.id + (c.title ? " — " + c.title : "");
  d.querySelector("small").textContent = (c.sheet || "") + (c.anchor ? " " + c.anchor : "") + " · " + c.types.join(" + ");
  d.querySelector(".w").textContent = (c.warnings || []).join(" | ");
  var el = d.querySelector(".chart"); el.style.width = Math.max(c.width, 360) + "px"; el.style.height = Math.max(c.height, 260) + "px";
  document.getElementById("root").appendChild(d);
  if (c.option) X2E.registerMaps(echarts, c.option, {{maps: GEO}}).then(function () {{ echarts.init(el, null, {{renderer: "canvas"}}).setOption(X2E.prepare(c.option)); }});
}});
window.__done = true;
</script></body></html>"""


def write_geo(outdir: Path, charts, geojson_path):
    """copy the GeoJSON used by regionMap charts to outdir/geo/ ({world,china,custom}.json); returns the sources"""
    srcs = sorted({(c.get("option") or {}).get("x-geo", {}).get("source") for c in charts} - {None})
    if srcs:
        (outdir / "geo").mkdir(parents=True, exist_ok=True)
    for s in srcs:
        shutil.copy(geojson_path if s == "custom" else STATIC / "geo" / f"{s}.json", outdir / "geo" / f"{s}.json")
    return srcs


def write_preview(outdir: Path, charts, title: str, geo_srcs=()):
    for f in ("echarts.min.js", "x2e-runtime.js"):
        shutil.copy(STATIC / f, outdir / f)
    data = json.dumps(charts, ensure_ascii=False).replace("</", "<\\/")
    geo = "{" + ",".join(f'"{s}":' + (outdir / "geo" / f"{s}.json").read_text(encoding="utf-8").replace("</", "<\\/") for s in geo_srcs) + "}"
    (outdir / "preview.html").write_text(PREVIEW.format(title=html.escape(title), data=data, geo=geo), encoding="utf-8")


def main(argv=None):
    ap = argparse.ArgumentParser(prog="xlsx2echarts", description="Convert native Excel charts in .xlsx/.xlsm/.xltx/.xltm to ECharts option JSON")
    ap.add_argument("inputs", nargs="+", help=".xlsx / .xlsm / .xltx / .xltm files or folders")
    ap.add_argument("-o", "--out", default="echarts_out", help="output directory (default ./echarts_out)")
    ap.add_argument("--no-preview", action="store_true", help="do not write preview.html")
    ap.add_argument("--show-missing-axes", action="store_true",
                    help="show axes that have no <c:delete> element (Excel hides them; LibreOffice shows them)")
    ap.add_argument("--stdout", action="store_true", help="print the JSON result to stdout instead of writing files")
    ap.add_argument("--geojson", metavar="FILE", help="GeoJSON FeatureCollection for regionMap charts (default: bundled China provinces / world countries)")
    ap.add_argument("-V", "--version", action="version", version=f"xlsx2echarts {__version__}")
    a = ap.parse_args(argv)
    files = []
    for p in map(Path, a.inputs):
        files += sorted(x for x in p.glob(OOXML_GLOB) if not x.name.startswith("~$")) if p.is_dir() else [p]
    out = Path(a.out)
    gj = json.loads(Path(a.geojson).read_text(encoding="utf-8")) if a.geojson else None
    allc, index, rc = [], [], 0
    for f in files:
        try:
            res = convert_xlsx(str(f), excel_compat=not a.show_missing_axes, geojson=gj)
        except Exception as e:
            print(f"✗ {f}: {e}", file=sys.stderr)
            rc = 1
            continue
        if a.stdout:
            print(json.dumps({"file": f.name, **res}, ensure_ascii=False, indent=2))
            continue
        sub = out / f.stem if len(files) > 1 else out
        sub.mkdir(parents=True, exist_ok=True)
        entries = []
        for c in res["charts"]:
            fn = f"{c['sheet'] or 'chart'}_{c['id']}.json".replace("/", "_").replace(" ", "_")
            (sub / fn).write_text(json.dumps(c["option"], ensure_ascii=False, indent=2), encoding="utf-8")
            meta = {k: v for k, v in c.items() if k != "option"}
            meta["file"] = str((sub / fn).relative_to(out))
            entries.append(meta)
            allc.append({**c, "file": f.name})
        (sub / "index.json").write_text(json.dumps({"source": f.name, "sheets": res["sheets"], "warnings": res["warnings"],
                                                    "charts": entries}, ensure_ascii=False, indent=2), encoding="utf-8")
        index.append({"source": str(f), "charts": len(entries), "dir": str(sub)})
        print(f"✓ {f.name}: {len(entries)} chart(s) → {sub}" + (f"  ⚠ {'; '.join(res['warnings'])}" if res["warnings"] else ""))
        if not entries:
            print("  (no native Excel charts found — plain tables are not converted)")
    geo_srcs = write_geo(out, allc, a.geojson) if not a.stdout and allc else []
    if not a.stdout and allc and not a.no_preview:
        write_preview(out, allc, ", ".join(f.name for f in files), geo_srcs)
        print(f"preview: {out / 'preview.html'}")
    return rc


if __name__ == "__main__":
    sys.exit(main())
