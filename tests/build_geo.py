"""Build bundled GeoJSON (Natural Earth, public domain) + alias index. Inputs in /tmp/geo (naturalearthdata.com v5)."""
import json, sys, pathlib, shutil
ROOT = pathlib.Path(__file__).resolve().parents[1]; sys.path.insert(0, str(ROOT))
from xlsx2echarts.geo import norm
G = pathlib.Path("/tmp/geo")

def dp(pts, tol):
    if len(pts) < 3: return pts
    keep = [False] * len(pts); keep[0] = keep[-1] = True; st = [(0, len(pts) - 1)]
    while st:
        a, b = st.pop(); (x1, y1), (x2, y2) = pts[a], pts[b]; dx, dy = x2 - x1, y2 - y1; L = dx * dx + dy * dy
        md, mi = -1, -1
        for i in range(a + 1, b):
            x, y = pts[i]
            d = ((x - x1) ** 2 + (y - y1) ** 2) if L == 0 else (abs(dy * x - dx * y + x2 * y1 - y2 * x1) ** 2 / L)
            if d > md: md, mi = d, i
        if md > tol * tol: keep[mi] = True; st += [(a, mi), (mi, b)]
    return [p for p, k in zip(pts, keep) if k]

def ring(r, tol, nd):
    out = []
    for x, y in dp(r, tol):
        p = [round(x, nd), round(y, nd)]
        if not out or out[-1] != p: out.append(p)
    if len(out) < 4: return None
    if out[0] != out[-1]: out.append(out[0])
    return out

def polys(geom):
    return [geom["coordinates"]] if geom["type"] == "Polygon" else geom["coordinates"]

def simplify(polylist, tol, nd):
    res = []
    for poly in polylist:
        rs = [ring(r, tol, nd) for r in poly]
        if rs[0] is None: continue
        res.append([rs[0]] + [r for r in rs[1:] if r])
    return res

def feat(name, polylist, tol, nd):
    p = simplify(polylist, tol, nd)
    return {"type": "Feature", "properties": {"name": name}, "geometry": {"type": "MultiPolygon", "coordinates": p}} if p else None

w = json.load(open(G / "ne_50m_admin_0_countries.geojson"))
a1 = json.load(open(G / "ne_10m_admin_1_states_provinces.geojson"))
by3 = {f["properties"]["ADM0_A3"]: f for f in w["features"]}
# ---- world (Taiwan shown as part of China) ----
world, widx = [], {}
for f in w["features"]:
    p = f["properties"]
    if p["ADM0_A3"] == "TWN": continue
    pl = polys(f["geometry"])
    if p["ADM0_A3"] == "CHN": pl = pl + polys(by3["TWN"]["geometry"])
    ft = feat(p["NAME"], pl, 0.04, 2)
    if not ft: continue
    world.append(ft)
    for k in ("NAME", "NAME_LONG", "ADMIN", "FORMAL_EN", "NAME_EN", "NAME_ZH", "NAME_SORT", "ABBREV", "ISO_A2", "ISO_A3", "ADM0_A3", "BRK_NAME"):
        v = p.get(k)
        if v and v != "-99": widx.setdefault(norm(v), p["NAME"])
EXTRA_W = {"United States of America": ["USA", "US", "America", "美国", "美利坚合众国"], "United Kingdom": ["UK", "Britain", "Great Britain", "England", "英国"],
           "China": ["PRC", "中华人民共和国", "中国", "Taiwan", "台湾", "中国台湾", "Hong Kong", "香港", "Macau", "Macao", "澳门"],
           "Russia": ["Russian Federation", "俄罗斯"], "South Korea": ["Korea", "Republic of Korea", "韩国"], "North Korea": ["DPRK", "朝鲜"],
           "Czechia": ["Czech Republic"], "Vietnam": ["Viet Nam"], "Iran": ["Persia"], "Myanmar": ["Burma"], "Côte d'Ivoire": ["Ivory Coast"],
           "eSwatini": ["Swaziland"], "North Macedonia": ["Macedonia"], "Turkey": ["Türkiye"], "Dem. Rep. Congo": ["DR Congo", "DRC", "Congo (Kinshasa)"], "Congo": ["Congo (Brazzaville)"]}
names_w = {f["properties"]["name"] for f in world}
for nm, al in EXTRA_W.items():
    if nm in names_w:
        for a in al: widx.setdefault(norm(a), nm)
# ---- China provinces ----
china, cidx = [], {}
prov = {}
for f in a1["features"]:
    p = f["properties"]
    if p["adm0_a3"] != "CHN": continue
    if p["name"] == "Paracel Islands":
        prov.setdefault("海南", [None, []])[1].extend(polys(f["geometry"])); continue
    short = norm(p["name_zh"])  # ascii-free so norm == short Chinese name
    e = prov.setdefault(short, [p, []]); e[0] = p; e[1].extend(polys(f["geometry"]))
for zh, en, a3 in (("台湾", "Taiwan", "TWN"), ("香港", "Hong Kong", "HKG"), ("澳门", "Macao", "MAC")):
    prov[zh] = [{"name": en, "name_zh": zh + ("省" if zh == "台湾" else "特别行政区"), "name_alt": {"MAC": "Macau", "HKG": "HK|Xianggang", "TWN": "Taiwan Province"}[a3]}, polys(by3[a3]["geometry"])]
for short, (p, pl) in prov.items():
    ft = feat(short, pl, 0.01, 3)
    if not ft: continue
    china.append(ft)
    for v in [short, p["name_zh"], p["name"]] + (p.get("name_alt") or "").split("|"):
        if v: cidx.setdefault(norm(v), short)
EXTRA_C = {"内蒙古": ["Inner Mongolia", "Neimenggu"], "西藏": ["Tibet", "Xizang"], "陕西": ["Shaanxi"], "山西": ["Shanxi"], "广西": ["Guangxi Zhuang"],
           "宁夏": ["Ningxia Hui"], "新疆": ["Xinjiang Uyghur"], "澳门": ["Macao SAR", "Macau SAR"], "香港": ["Hong Kong SAR", "HKSAR"]}
for nm, al in EXTRA_C.items():
    for a in al: cidx.setdefault(norm(a), nm)
world.sort(key=lambda f: f["properties"]["name"]); china.sort(key=lambda f: f["properties"]["name"])
dump = lambda o: json.dumps(o, ensure_ascii=False, separators=(",", ":"), sort_keys=False)
src = "Natural Earth 1:50m admin-0 countries and 1:10m admin-1 states/provinces (v5, public domain, naturalearthdata.com); simplified"
outs = {"world.json": {"type": "FeatureCollection", "x-source": src, "features": world},
        "china.json": {"type": "FeatureCollection", "x-source": src, "features": china},
        "index.json": {"china": dict(sorted(cidx.items())), "world": dict(sorted(widx.items()))}}
for d in (ROOT / "xlsx2echarts/static/geo", ROOT / "ts/geo", ROOT / "frontend/geo"):
    d.mkdir(parents=True, exist_ok=True)
    for n, o in outs.items():
        if n == "index.json" and d.name == "geo" and "frontend" in str(d): continue
        (d / n).write_text(dump(o), encoding="utf-8")
(ROOT / "ts/src/geoindex.ts").write_text("// generated by tests/build_geo.py — do not edit\nexport const GEO_INDEX: Record<string, Record<string, string>> = " + dump(outs["index.json"]) + ";\n", encoding="utf-8")
print(len(world), len(china), len(widx), len(cidx), [(n, len(dump(o)) // 1024) for n, o in outs.items()])
