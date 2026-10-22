"""regionMap fixtures: world countries, China provinces (Chinese + English/pinyin names), custom GeoJSON regions."""
import sys, json, runpy, tempfile
OUT = sys.argv[1] if len(sys.argv) > 1 else "fixtures"
argv = sys.argv; sys.argv = [argv[0], tempfile.mkdtemp()]
g = runpy.run_path(__file__.replace("gen_maps.py", "gen_chartex.py")); sys.argv = argv
strdim, numdim, rng, ser, chart_xml, build = (g[k] for k in ("strdim", "numdim", "rng", "ser", "chart_xml", "build"))
W = [["United States", 331], ["China", 1412], ["India", 1408], ["Brazil", 214], ["Russia", 144], ["日本", 125], ["德国", 83], ["Atlantis", 1]]
C = [["广东省", 12657], ["山东", 10163], ["Henan", 9872], ["四川省", 8372], ["江苏", 8505], ["新疆维吾尔自治区", 2587],
     ["Inner Mongolia", 2401], ["北京市", 2184], ["Hong Kong", 733], ["台湾", 2326]]
R = [["North", 120], ["South", 80], ["East", 65], ["West", 40], ["Central", 95]]
LP = '<cx:layoutPr><cx:regionLabelLayout val="{l}"/><cx:geography cultureLanguage="en-US" cultureRegion="US" attribution="Powered by Bing"/></cx:layoutPr>'
def mk(sheet, rows, name, ttl, lay, fmt="General"):
    n = len(rows)
    return chart_xml(f'<cx:data id="0">{strdim(rng(sheet, 0, 1, n), [[r[0] for r in rows]])}{numdim(rng(sheet, 1, 1, n), [r[1] for r in rows], fmt=fmt)}</cx:data>',
                     ser("regionMap", 0, name, f"{sheet}!$B$1", LP.format(l=lay), labels=False), "", ttl)
sheets = {"World": [["Country", "Population (M)"]] + W, "China": [["Province", "Population (10k)"]] + C, "Regions": [["Region", "Sales"]] + R}
charts = [("World", (3, 1, 13, 20), "World map", mk("World", W, "Population (M)", "World population (M)", "bestFitOnly", "#,##0")),
          ("China", (3, 1, 13, 20), "China map", mk("China", C, "Population (10k)", "中国人口（万）", "showAll", "#,##0")),
          ("Regions", (3, 1, 13, 20), "Custom map", mk("Regions", R, "Sales", "Sales by region (custom GeoJSON)", "showAll"))]
build(f"{OUT}/chartex_maps.xlsx", sheets, charts)
# custom regions: 5 squares
def sq(x, y): return [[[x, y], [x + 10, y], [x + 10, y + 10], [x, y + 10], [x, y]]]
fc = {"type": "FeatureCollection", "features": [
    {"type": "Feature", "properties": {"name": n, "code": c}, "geometry": {"type": "Polygon", "coordinates": sq(x, y)}}
    for n, c, x, y in (("North", "N", 10, 20), ("South", "S", 10, 0), ("East", "E", 20, 10), ("West", "W", 0, 10), ("Central", "C", 10, 10))]}
open(f"{OUT}/custom_regions.geojson", "w").write(json.dumps(fc, indent=1))
print("ok")
