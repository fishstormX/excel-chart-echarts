"""Office 2016+ chartEx parts (xl/charts/chartExN.xml): waterfall, treemap, sunburst, histogram, pareto,
funnel, box & whisker. regionMap is reported as unsupported. Mirrored 1:1 in ts/src/chartex.ts."""
from __future__ import annotations

import math
from typing import Any, Dict, List, Optional

from .colors import fill_color, line_props, no_fill, resolve_color
from . import geo
from .formula import FormulaError, split_ref
from .stats import fsum, mean, median, quantile, sig, stdev
from .workbook import _fixed_half_up, format_number, jnum, jstr

CXNS = "http://schemas.microsoft.com/office/drawing/2014/chartex"
CX = "{%s}" % CXNS
A = "{http://schemas.openxmlformats.org/drawingml/2006/main}"
FONT = "Calibri, 'Microsoft YaHei', 'PingFang SC', sans-serif"
TXT = "#595959"


def _f(s, d=None):
    try:
        return float(s)
    except (TypeError, ValueError):
        return d


def _bool_attr(el, name, default):
    if el is None or el.get(name) is None:
        return default
    return el.get(name) in ("1", "true")


class ChartEx:
    def __init__(self, h, part: str):
        self.h = h  # ChartConverter helper: refs, theme colours, warnings, formats
        self.wb = h.wb
        self.root = h.root
        self.theme = h.theme
        self.warnings = h.warnings

    # ---------- data ----------
    def _ref_levels(self, f: str, num: bool, by_row: bool):
        f = f.strip()
        if f in self.wb.defined_names:
            f = self.wb.defined_names[f]
        try:
            sheet, r1, c1, r2, c2 = split_ref(f)
        except FormulaError:
            self.warnings.append(f"cannot resolve reference {f!r}")
            return [], None
        if sheet is None or (r2 - r1 + 1) * (c2 - c1 + 1) > 100000:
            self.warnings.append(f"cannot resolve reference {f!r}")
            return [], None
        self.h.used_formula_fallback = True
        grid = [[self.wb.value(sheet, r, c) for c in range(c1, c2 + 1)] for r in range(r1, r2 + 1)]
        if r1 == r2:
            lines = [grid[0]]
        elif c1 == c2:
            lines = [[row[0] for row in grid]]
        elif by_row:
            lines = grid
        else:
            lines = [[row[j] for row in grid] for j in range(c2 - c1 + 1)]
        out = []
        for ln in reversed(lines):  # outermost first in the sheet -> leaf level first
            if num:
                out.append([float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None for v in ln])
            else:
                out.append([None if v is None or jstr(v) == "" else jstr(v) for v in ln])
        return out, self.h.ref_format(f) if num else None

    def _dim(self, d):
        num = d.tag == CX + "numDim"
        levels, fmt = [], None
        for lvl in d.findall(CX + "lvl"):
            pts = lvl.findall(CX + "pt")
            n = int(lvl.get("ptCount") or 0)
            if not n and pts:
                n = max(int(p.get("idx")) for p in pts) + 1
            arr: List[Any] = [None] * n
            for p in pts:
                i = int(p.get("idx"))
                if i < n:
                    arr[i] = _f(p.text) if num else (p.text if p.text is not None else None)
            if fmt is None and lvl.get("formatCode"):
                fmt = lvl.get("formatCode")
            levels.append(arr)
        fe = d.find(CX + "f")
        if not any(v is not None for lv in levels for v in lv) and fe is not None and (fe.text or "").strip():
            levels, rf = self._ref_levels(fe.text, num, fe.get("dir") == "row")
            fmt = fmt or rf
        elif num and fmt in (None, "General") and fe is not None and (fe.text or "").strip():
            fmt = self.h.ref_format(fe.text.strip()) or fmt
        return {"type": d.get("type"), "num": num, "levels": levels, "fmt": fmt}

    def _text(self, tx):
        """cx:tx -> string (txData/v, txData/f or rich)"""
        if tx is None:
            return None
        td = tx.find(CX + "txData")
        if td is not None:
            v = td.findtext(CX + "v")
            if v is not None:
                return v
            f = td.findtext(CX + "f")
            if f:
                vals, _ = self.h.resolve_ref(f)
                return " ".join(jstr(x) for x in vals if x is not None)
        rich = tx.find(CX + "rich")
        if rich is not None:
            return "\n".join("".join((t.text or "") for t in p.iter(A + "t")) for p in rich.findall(A + "p"))
        return None

    def _font(self, el, pt, bold=False):
        return self.h._font(el.find(CX + "txPr") if el is not None else None, pt, bold)

    # ---------- main ----------
    def convert(self) -> Dict[str, Any]:
        root = self.root
        self.data = {}
        cd = root.find(CX + "chartData")
        for d in (cd.findall(CX + "data") if cd is not None else []):
            self.data[d.get("id")] = [self._dim(x) for x in d if x.tag in (CX + "numDim", CX + "strDim")]
        ch = root.find(CX + "chart")
        pa = ch.find(CX + "plotArea") if ch is not None else None
        region = pa.find(CX + "plotAreaRegion") if pa is not None else None
        sers = [s for s in (region.findall(CX + "series") if region is not None else []) if not _bool_attr(s, "hidden", False)]
        self.axes = {a.get("id"): a for a in (pa.findall(CX + "axis") if pa is not None else [])}
        types = []
        for s in sers:
            if s.get("layoutId") not in types:
                types.append(s.get("layoutId"))
        sp = root.find(CX + "spPr")
        self.option: Dict[str, Any] = {
            "backgroundColor": "transparent" if no_fill(sp) else (fill_color(sp, self.theme) or "#FFFFFF"),
            "textStyle": {"fontFamily": FONT}, "tooltip": {"trigger": "item"}, "series": []}
        # title
        te = ch.find(CX + "title") if ch is not None else None
        if te is not None:
            text = self._text(te.find(CX + "tx"))
            if text is None:
                text = "Chart Title"
            if text:
                self.option["title"] = {"text": text, "left": "center", "top": 6, "textStyle": self._font(te, 14.0)}
        kind = types[0] if types else None
        fn = {"waterfall": self._waterfall, "treemap": self._treemap, "sunburst": self._sunburst,
              "clusteredColumn": self._histogram, "paretoLine": self._histogram, "funnel": self._funnel,
              "boxWhisker": self._box, "regionMap": None}.get(kind, "x")
        if kind is None:
            self.warnings.append("chartEx without series")
            return {"types": types, "option": None, "warnings": self.warnings}
        if fn is None:
            if not self._region_map(sers):
                return {"types": types, "option": None, "warnings": self.warnings}
            fn = lambda _s: None
        if fn == "x":
            self.warnings.append(f"chartEx layout {kind!r} is not supported — rendered as column chart")
            fn = self._histogram
        fn(sers)
        lg = ch.find(CX + "legend") if ch is not None else None
        self._legend(lg if kind != "regionMap" else None)
        if "grid" in self.option:
            g = self.option["grid"]
            if "title" in self.option:
                g["top"] += 26
            leg = self.option["legend"]
            if leg.get("show"):
                p = leg.pop("_pos")
                if p == "t":
                    g["top"] += 28
                elif p == "b":
                    g["bottom"] += 28
                elif p == "r":
                    g["right"] = 130
                elif p == "l":
                    g["left"] = 130
        self.option["legend"].pop("_pos", None)
        if self.h.formats:
            self.option["x-numFmt"] = self.h.formats
        return {"types": types, "option": self.option, "warnings": self.warnings}

    def _legend(self, lg):
        if lg is None:
            self.option["legend"] = {"show": False}
            return
        pos = lg.get("pos", "t")
        font = self._font(lg, 9.0)
        e = {"show": True, "_pos": pos, "textStyle": {"color": font["color"], "fontSize": font["fontSize"]},
             "itemWidth": 10, "itemHeight": 10}
        if pos in ("l", "r"):
            e.update(orient="vertical", top="middle", **({"right": 10} if pos == "r" else {"left": 10}))
        elif pos == "b":
            e.update(orient="horizontal", bottom=8, left="center")
        else:
            e.update(orient="horizontal", top=40 if "title" in self.option else 8, left="center")
        ld = getattr(self, "legend_data", None)
        if ld is not None:
            if not ld:
                self.option["legend"] = {"show": False}
                return
            e["data"] = ld
        self.option["legend"] = e

    # ---------- regionMap ----------
    def _region_map(self, sers):
        s = sers[0]
        cat, val = self._series_dims(s)
        vals = val["levels"][0] if val and val["levels"] else []
        names = list(cat["levels"][0]) if cat and cat["levels"] else []
        names = names[:len(vals)] + [None] * (len(vals) - len(names))
        gj = getattr(self.wb, "geojson", None)
        m = geo.match(names, gj)
        if m is None:
            self.warnings.append("regionMap: none of the region names matched " +
                                 ("the supplied GeoJSON or " if gj is not None else "") + "the bundled China-province / world-country maps" +
                                 " — supply your own GeoJSON (geojson option / --geojson)")
            return False
        key, src, prop, res = m
        data, unmatched = [], []
        lp = s.find(CX + "layoutPr")
        rl = lp.find(CX + "regionLabelLayout") if lp is not None else None
        show_lab = (rl.get("val") if rl is not None else "bestFitOnly") != "none"
        for nm, f, v in zip(names, res, vals):
            if f is None:
                if nm is not None:
                    unmatched.append(jstr(nm))
                continue
            d = {"name": f, "value": v}
            if show_lab:
                d["label"] = {"show": True}
            data.append(d)
        if unmatched:
            self.warnings.append(f"regionMap: {len(unmatched)} region name(s) not found on the {src} map: " +
                                 ", ".join(unmatched[:10]) + (" …" if len(unmatched) > 10 else ""))
        c = self._color(s, 0)
        colors = None
        vc = lp.find(CX + "valueColors") if lp is not None else None
        if vc is not None:
            cs = []
            for t in ("minColor", "midColor", "maxColor"):
                el = vc.find(CX + t)
                col = resolve_color(el[0], self.theme) if el is not None and len(el) else None
                if col:
                    cs.append(col)
            if len(cs) >= 2:
                colors = cs
        if colors is None:
            rgb = [int(c[i:i + 2], 16) for i in (1, 3, 5)] if c.startswith("#") and len(c) == 7 else [68, 114, 196]
            light = "#%02X%02X%02X" % tuple(x + ((255 - x) * 85 + 50) // 100 for x in rgb)
            colors = [light, c]
        nums = [v for v in (d["value"] for d in data) if isinstance(v, (int, float))]
        mn, mx = (min(nums), max(nums)) if nums else (0, 1)
        if mx == mn:
            mx = mn + 1
        e = {"name": self._name(s, 0), "type": "map", "map": key}
        if prop and prop != "name":
            e["nameProperty"] = prop
        lab = self._labels_vis(s)
        e.update({"roam": True, "showLegendSymbol": False, "data": data, "label": {"show": False, "fontSize": 10, "color": "#404040"},
                  "itemStyle": {"areaColor": "#F2F2F2", "borderColor": "#A6A6A6", "borderWidth": 0.5},
                  "emphasis": {"label": {"show": True}, "itemStyle": {"areaColor": "#FFE699"}}})
        self.option["series"].append(e)
        self.option["visualMap"] = {"type": "continuous", "min": mn, "max": mx, "calculable": False, "left": 10, "bottom": 10,
                                    "inRange": {"color": colors}, "textStyle": {"color": "#595959"}}
        fmt = (lab or {}).get("fmt") or (val.get("fmt") if val else None)
        if fmt and fmt != "General":
            self.h.formats.append({"path": "series.0.tooltip", "formatCode": fmt, "tooltip": True})
        self.option["x-geo"] = {"map": key, "source": src}
        return True

    # ---------- helpers ----------
    def _series_dims(self, s):
        dims = self.data.get(_v_attr(s.find(CX + "dataId")), [])
        cat = next((d for d in dims if d["type"] == "cat"), None)
        val = next((d for d in dims if d["type"] in ("val", "size")), None)
        if val is None:
            val = next((d for d in dims if d["num"] and d["type"] != "cat"), None)
        return cat, val

    def _name(self, s, i):
        t = self._text(s.find(CX + "tx"))
        return t if t else f"Series{i + 1}"

    def _color(self, s, i):
        return fill_color(s.find(CX + "spPr"), self.theme) or self.h._auto_color(i)

    def _dpts(self, s):
        out = {}
        for dp in s.findall(CX + "dataPt"):
            c = fill_color(dp.find(CX + "spPr"), self.theme)
            if c:
                out[int(dp.get("idx", "0"))] = c
        return out

    def _labels_vis(self, s):
        dl = s.find(CX + "dataLabels")
        if dl is None:
            return None
        vis = dl.find(CX + "visibility")
        flags = {"value": _bool_attr(vis, "value", True), "categoryName": _bool_attr(vis, "categoryName", False),
                 "seriesName": _bool_attr(vis, "seriesName", False)}
        if not any(flags.values()):
            return None
        nf = dl.find(CX + "numFmt")
        flags["fmt"] = nf.get("formatCode") if nf is not None and nf.get("sourceLinked") in ("0", "false") else None
        flags["pos"] = dl.get("pos")
        flags["font"] = self._font(dl, 9.0)
        return flags

    @staticmethod
    def _flat_cats(cat, n):
        """category labels: leaf level, outer levels prefixed like multi-level classic categories"""
        if cat is None or not cat["levels"]:
            return [str(i + 1) for i in range(n)]
        lv = cat["levels"]
        outer = [list(x) for x in lv[1:]]
        for o in outer:
            last = None
            for i in range(len(o)):
                if o[i] is None:
                    o[i] = last
                last = o[i]
        out = []
        for i in range(n):
            parts = [o[i] for o in reversed(outer) if i < len(o) and o[i]]
            leaf = lv[0][i] if i < len(lv[0]) else None
            parts.append(jstr(leaf) if leaf is not None else "")
            out.append(" ".join(p for p in parts if p) if outer else (jstr(leaf) if leaf is not None else ""))
        return out

    def _axis(self, aid, kind, data=None, fmt=None, dim="x"):
        ax = self.axes.get(aid)
        hidden = _bool_attr(ax, "hidden", False)
        ticks = ax is not None and ax.find(CX + "tickLabels") is not None
        font = self._font(ax, 9.0)
        e: Dict[str, Any] = {"type": kind, "show": not hidden,
                             "axisLabel": {"show": ticks or ax is None, "color": font["color"], "fontSize": font["fontSize"]},
                             "axisTick": {"show": False}, "axisLine": {"show": kind == "category", "lineStyle": {"color": "#D9D9D9"}}}
        mg = ax is not None and ax.find(CX + "majorGridlines") is not None
        e["splitLine"] = {"show": bool(mg), "lineStyle": {"color": "#D9D9D9"}}
        if kind == "category":
            e["data"] = data or []
        else:
            sc = ax.find(CX + "valScaling") if ax is not None else None
            for k in ("min", "max"):
                v = _f(sc.get(k)) if sc is not None and sc.get(k) not in (None, "auto") else None
                if v is not None:
                    e[k] = v
            nf = ax.find(CX + "numFmt") if ax is not None else None
            code = nf.get("formatCode") if nf is not None and nf.get("sourceLinked") in ("0", "false") else fmt
            if code and code != "General":
                self.h._fmt_hook(f"{dim}Axis.axisLabel", code)
        te = ax.find(CX + "title") if ax is not None else None
        if te is not None:
            t = self._text(te.find(CX + "tx"))
            if t:
                e.update(name=t, nameLocation="middle", nameGap=32 if dim == "x" else 48,
                         nameTextStyle=self._font(te, 10.0))
        return e

    def _gap(self, default):
        ax = self.axes.get("0")
        sc = ax.find(CX + "catScaling") if ax is not None else None
        g = _f(sc.get("gapWidth")) if sc is not None and sc.get("gapWidth") not in (None, "auto") else None
        g = default if g is None else g
        return f"{jnum(round(g / (1 + g) * 100, 2))}%"

    def _grid(self):
        self.option["grid"] = {"left": 16, "right": 24, "top": 24, "bottom": 16, "containLabel": True}
        self.option["tooltip"] = {"trigger": "axis", "axisPointer": {"type": "shadow"}}

    # ---------- waterfall ----------
    def _waterfall(self, sers):
        s = sers[0]
        cat, val = self._series_dims(s)
        vals = val["levels"][0] if val and val["levels"] else []
        n = len(vals)
        cats = self._flat_cats(cat, n)
        lp = s.find(CX + "layoutPr")
        subs = set()
        st = lp.find(CX + "subtotals") if lp is not None else None
        for ix in (st.findall(CX + "idx") if st is not None else []):
            subs.add(int(ix.get("val")))
        vis = lp.find(CX + "visibility") if lp is not None else None
        connectors = _bool_attr(vis, "connectorLines", False)
        dpts = self._dpts(s)
        colors = {"inc": self.h._auto_color(0), "dec": self.h._auto_color(1), "tot": self.h._auto_color(2)}
        names = {"inc": "Increase", "dec": "Decrease", "tot": "Total"}
        lab = self._labels_vis(s)
        fmt = (lab or {}).get("fmt") or (val.get("fmt") if val else None)
        base_p, base_n = [], []
        seg = {k: ([], []) for k in ("inc", "dec", "tot")}  # (positive part, negative part)
        running = 0.0
        ends = []
        used = []
        for j in range(n):
            v = vals[j] if vals[j] is not None else 0.0
            if j in subs:
                a, b, k = 0.0, v, "tot"
                running = v
            else:
                a, b = running, running + v
                running = running + v
                k = "inc" if v >= 0 else "dec"
            ends.append(running)
            lo, hi = (a, b) if a <= b else (b, a)
            if k not in used:
                used.append(k)
            if lo >= 0:
                bp, bn, pp, nn = lo, None, hi - lo, None
            elif hi <= 0:
                bp, bn, pp, nn = None, hi, None, lo - hi
            else:
                bp, bn, pp, nn = 0.0, 0.0, hi, lo
            base_p.append(sig(bp) if bp is not None else None)
            base_n.append(sig(bn) if bn is not None else None)
            for kk in seg:
                if kk == k:
                    item_p = {"value": sig(pp)} if pp is not None else None
                    item_n = {"value": sig(nn)} if nn is not None else None
                    col = dpts.get(j)
                    for it in (item_p, item_n):
                        if it is not None and col:
                            it["itemStyle"] = {"color": col}
                    if lab:
                        txt = self._label_text(lab, cats[j], names[k], v, fmt)
                        tgt = item_p if (v >= 0 and item_p is not None) or item_n is None else item_n
                        tgt["label"] = {"show": True, "formatter": txt,
                                        "position": "top" if tgt is item_p else "bottom"}
                    seg[kk][0].append(item_p)
                    seg[kk][1].append(item_n)
                else:
                    seg[kk][0].append(None)
                    seg[kk][1].append(None)
        self._grid()
        self.option["xAxis"] = self._axis("0", "category", cats)
        self.option["yAxis"] = self._axis("1", "value", fmt=val.get("fmt") if val else None, dim="y")
        gap = self._gap(0.5)
        base = {"type": "bar", "stack": "wf", "silent": True, "itemStyle": {"color": "transparent"},
                "emphasis": {"disabled": True}, "tooltip": {"show": False}}
        out = [dict(base, name="", data=base_p, barCategoryGap=gap)]
        if any(v is not None for v in base_n):
            out.append(dict(base, name="", data=base_n))
        for k in ("inc", "dec", "tot"):
            if k not in used:
                continue
            e = {"name": names[k], "type": "bar", "stack": "wf", "data": seg[k][0], "itemStyle": {"color": colors[k]}}
            if lab:
                e["label"] = {"show": False, "color": lab["font"]["color"], "fontSize": lab["font"]["fontSize"]}
            if any(x is not None for x in seg[k][0]):
                out.append(dict(e, data=seg[k][0]))
            if any(x is not None for x in seg[k][1]):
                out.append(dict(e, data=seg[k][1]))
        if connectors and n > 1:
            out[0]["markLine"] = {"silent": True, "symbol": "none", "lineStyle": {"color": "#A6A6A6", "type": "solid", "width": 1},
                                  "label": {"show": False},
                                  "data": [[{"coord": [j, sig(ends[j])]}, {"coord": [j + 1, sig(ends[j])]}] for j in range(n - 1)]}
        self.option["series"] = out
        self.legend_data = [names[k] for k in ("inc", "dec", "tot") if k in used]
        self.option["tooltip"] = {"trigger": "item"}

    def _label_text(self, lab, cat, sname, v, fmt):
        parts = []
        if lab["seriesName"]:
            parts.append(sname)
        if lab["categoryName"]:
            parts.append(cat)
        if lab["value"]:
            parts.append(format_number(v, fmt))
        return ", ".join(parts)

    # ---------- funnel ----------
    def _funnel(self, sers):
        s = sers[0]
        cat, val = self._series_dims(s)
        vals = val["levels"][0] if val and val["levels"] else []
        n = len(vals)
        cats = self._flat_cats(cat, n)
        mx = 0.0
        for v in vals:
            if v is not None and abs(v) > mx:
                mx = abs(v)
        color = self._color(s, 0)
        dpts = self._dpts(s)
        lab = self._labels_vis(s)
        fmt = (lab or {}).get("fmt") or (val.get("fmt") if val else None)
        pad, data = [], []
        for j, v in enumerate(vals):
            a = abs(v) if v is not None else 0.0
            pad.append(sig((mx - a) / 2))
            it: Dict[str, Any] = {"value": a}
            if dpts.get(j):
                it["itemStyle"] = {"color": dpts[j]}
            if lab:
                it["label"] = {"formatter": self._label_text(lab, cats[j], self._name(s, 0), v if v is not None else 0, fmt)}
            data.append(it)
        self._grid()
        self.option["grid"]["left"] = 16
        self.option["xAxis"] = {"type": "value", "show": False, "min": 0, "max": mx or 1}
        ya = self._axis("0", "category", cats, dim="y")
        ya["inverse"] = True
        ya["axisLine"] = {"show": False}
        self.option["yAxis"] = ya
        gap = self._gap(0.06)
        e = {"name": self._name(s, 0), "type": "bar", "stack": "funnel", "data": data, "itemStyle": {"color": color},
             "barCategoryGap": gap}
        if lab:
            e["label"] = {"show": True, "position": "inside", "color": "#FFFFFF", "fontSize": lab["font"]["fontSize"]}
        self.option["series"] = [
            {"name": "", "type": "bar", "stack": "funnel", "data": pad, "silent": True, "itemStyle": {"color": "transparent"},
             "emphasis": {"disabled": True}, "tooltip": {"show": False}, "barCategoryGap": gap}, e]
        self.legend_data = [e["name"]]

    # ---------- hierarchy ----------
    def _tree(self, s):
        cat, val = self._series_dims(s)
        vals = val["levels"][0] if val and val["levels"] else []
        levels = cat["levels"] if cat else []
        L = len(levels)
        roots: List[dict] = []
        prev: List[str] = []
        for i, v in enumerate(vals):
            raw = [levels[L - 1 - d][i] if i < len(levels[L - 1 - d]) else None for d in range(L)]
            k = max([d for d in range(L) if raw[d] not in (None, "")] or [-1])
            if k < 0 or v is None or v <= 0:
                continue
            path = []
            for d in range(k + 1):
                nm = raw[d] if raw[d] not in (None, "") else (prev[d] if d < len(prev) else "")
                path.append(jstr(nm))
            prev = path
            lst = roots
            node = None
            for nm in path:
                node = next((x for x in lst if x["name"] == nm), None)
                if node is None:
                    node = {"name": nm, "own": 0.0, "children": []}
                    lst.append(node)
                lst = node["children"]
            node["own"] += v
        return roots, val

    def _finish_tree(self, nodes, color=None, depth=0):
        out = []
        for i, nd in enumerate(nodes):
            c = color or self.h._auto_color(i)
            kids = self._finish_tree(nd["children"], c, depth + 1)
            tot = nd["own"]
            for k in kids:
                tot += k["value"]
            e = {"name": nd["name"], "value": sig(tot), "itemStyle": {"color": c}}
            if kids:
                e["children"] = kids
            out.append(e)
        return out

    def _treemap(self, sers):
        s = sers[0]
        roots, val = self._tree(s)
        data = self._finish_tree(roots)
        lp = s.find(CX + "layoutPr")
        pll = lp.find(CX + "parentLabelLayout") if lp is not None else None
        mode = pll.get("val") if pll is not None else "overlapping"
        lab = self._labels_vis(s) or {"value": False, "categoryName": True, "seriesName": False, "fmt": None,
                                      "font": {"fontSize": 12, "color": "#FFFFFF"}}
        fmt = lab.get("fmt") or (val.get("fmt") if val else None)
        parts = (["{b}"] if lab["categoryName"] or not lab["value"] else []) + (["{c}"] if lab["value"] else [])
        label = {"show": True, "formatter": "\n".join(parts), "color": "#FFFFFF", "fontSize": lab["font"]["fontSize"],
                 "position": "insideTopLeft", "overflow": "truncate"}
        e = {"name": self._name(s, 0), "type": "treemap", "data": data, "roam": False, "nodeClick": False,
             "breadcrumb": {"show": False}, "left": 8, "right": 8, "bottom": 8, "top": 40 if "title" in self.option else 8,
             "label": label, "upperLabel": {"show": mode != "none", "height": 20, "color": "#404040",
                                            "fontSize": lab["font"]["fontSize"], "fontWeight": "bold"},
             "itemStyle": {"borderColor": "#FFFFFF", "borderWidth": 1, "gapWidth": 1},
             "levels": [{"itemStyle": {"borderWidth": 0, "gapWidth": 3}, "upperLabel": {"show": False}},
                        {"itemStyle": {"borderColor": "#FFFFFF", "borderWidth": 2, "gapWidth": 1}},
                        {"itemStyle": {"borderColor": "#FFFFFF", "borderWidth": 1, "gapWidth": 1}}]}
        if lab["value"] and fmt and fmt != "General":
            self.h._fmt_hook("series.0.label", fmt)
        self.option["series"] = [e]
        self.legend_data = []

    def _sunburst(self, sers):
        s = sers[0]
        roots, val = self._tree(s)
        data = self._finish_tree(roots)
        lab = self._labels_vis(s) or {"value": False, "categoryName": True, "seriesName": False, "fmt": None,
                                      "font": {"fontSize": 12, "color": "#FFFFFF"}}
        parts = (["{b}"] if lab["categoryName"] or not lab["value"] else []) + (["{c}"] if lab["value"] else [])
        e = {"name": self._name(s, 0), "type": "sunburst", "data": data, "radius": ["0%", "78%"],
             "center": ["50%", "55%" if "title" in self.option else "50%"], "sort": None, "nodeClick": False,
             "itemStyle": {"borderColor": "#FFFFFF", "borderWidth": 1},
             "label": {"show": True, "formatter": "\n".join(parts), "rotate": "radial", "color": "#FFFFFF",
                       "fontSize": lab["font"]["fontSize"], "minAngle": 6}}
        fmt = lab.get("fmt") or (val.get("fmt") if val else None)
        if lab["value"] and fmt and fmt != "General":
            self.h._fmt_hook("series.0.label", fmt)
        self.option["series"] = [e]
        self.legend_data = []

    # ---------- histogram / pareto ----------
    def _histogram(self, sers):
        bar = next((s for s in sers if s.get("layoutId") != "paretoLine"), sers[0])
        pareto = any(s.get("layoutId") == "paretoLine" for s in sers)
        cat, val = self._series_dims(bar)
        vals = val["levels"][0] if val and val["levels"] else []
        fmt = val.get("fmt") if val else None
        lp = bar.find(CX + "layoutPr")
        binning = lp.find(CX + "binning") if lp is not None else None
        agg = lp is not None and lp.find(CX + "aggregation") is not None
        if bar.get("layoutId") != "clusteredColumn" or (binning is None and (agg or cat is not None)):
            agg = True
        if agg:
            cats_all = self._flat_cats(cat, len(vals))
            labels, counts = [], []
            for c, v in zip(cats_all, vals):
                if v is None:
                    continue
                if c in labels:
                    counts[labels.index(c)] += v
                else:
                    labels.append(c)
                    counts.append(v)
            counts = [sig(x) for x in counts]
        else:
            labels, counts = self._bins([v for v in vals if v is not None], binning, fmt)
        if pareto:
            order = sorted(range(len(counts)), key=lambda i: (-counts[i], i))
            labels = [labels[i] for i in order]
            counts = [counts[i] for i in order]
        self._grid()
        self.option["xAxis"] = self._axis("0", "category", labels)
        self.option["xAxis"]["axisLabel"]["interval"] = 0
        ya = self._axis("1", "value", fmt=fmt if agg else None, dim="y")
        color = self._color(bar, 0)
        dpts = self._dpts(bar)
        e = {"name": self._name(bar, 0), "type": "bar", "data": counts, "itemStyle": {"color": color},
             "barCategoryGap": self._gap(0 if not agg or not pareto else 0.5), "yAxisIndex": 0}
        if dpts:
            e["data"] = [{"value": v, "itemStyle": {"color": dpts.get(j, color)}} for j, v in enumerate(counts)]
        lab = self._labels_vis(bar)
        if lab:
            e["label"] = {"show": True, "position": "top", "color": lab["font"]["color"], "fontSize": lab["font"]["fontSize"]}
        series = [e]
        if pareto:
            ps = next(s for s in sers if s.get("layoutId") == "paretoLine")
            tot = fsum(counts)
            cum, acc = [], 0.0
            for c in counts:
                acc += c
                cum.append(sig(acc / tot * 100) if tot else 0)
            lc, w, _, _ = line_props(ps.find(CX + "spPr"), self.theme)
            lc = lc or self.h._auto_color(1)
            series.append({"name": self._name(ps, 1) if ps.find(CX + "tx") is not None else "Pareto", "type": "line",
                           "data": cum, "yAxisIndex": 1, "symbol": "none", "itemStyle": {"color": lc},
                           "lineStyle": {"color": lc, "width": w or 2.67}})
            y2 = self._axis("2", "value", dim="y")
            y2.update(min=0, max=100, position="right")
            y2["axisLabel"]["formatter"] = "{value}%"
            y2["splitLine"] = {"show": False}
            ya = [ya, y2]
            self.option["grid"]["right"] = 24
        self.option["yAxis"] = ya
        self.option["series"] = series
        self.legend_data = [x["name"] for x in series]

    def _bins(self, xs, binning, fmt):
        xs = sorted(xs)
        n = len(xs)
        if not n:
            return [], []
        closed_r = (binning.get("intervalClosed", "r") if binning is not None else "r") != "l"

        def num_attr(k):
            if binning is None:
                return None
            el = binning.find(CX + k)
            v = el.get("val") if el is not None else binning.get(k)
            return None if v in (None, "auto") else _f(v)

        uf, of = num_attr("underflow"), num_attr("overflow")
        size_v, count_v = num_attr("binSize"), num_attr("binCount")
        lo = uf if uf is not None else xs[0]
        hi = of if of is not None else xs[-1]
        if size_v and size_v > 0:
            w = size_v
            nb = max(1, int(math.ceil((hi - lo) / w - 1e-9)))
        elif count_v and count_v >= 1:
            nb = int(count_v)
            w = (hi - lo) / nb if hi > lo else 1.0
        else:
            sd = stdev(xs)
            w = 3.5 * sd / (n ** (1 / 3)) if sd > 0 else 1.0
            w = sig(w)
            nb = max(1, int(math.ceil((hi - lo) / w - 1e-9)))
        counts = [0] * nb
        under = over = 0
        for x in xs:
            if uf is not None and (x <= uf if closed_r else x < uf):
                under += 1
            elif of is not None and (x > of if closed_r else x >= of):
                over += 1
            else:
                t = (x - lo) / w
                k = int(math.ceil(t - 1e-9)) - 1 if closed_r else int(math.floor(t + 1e-9))
                k = min(max(k, 0), nb - 1)
                counts[k] += 1

        def fx(x):
            if fmt in (None, "General"):
                return jnum(float(_fixed_half_up(sig(x), 2)))
            return format_number(sig(x), fmt)

        labels = []
        for k in range(nb):
            a, b = lo + k * w, lo + (k + 1) * w
            if closed_r:
                labels.append(f"{'[' if k == 0 and uf is None else '('}{fx(a)}, {fx(b)}]")
            else:
                labels.append(f"[{fx(a)}, {fx(b)}{']' if k == nb - 1 and of is None else ')'}")
        if uf is not None:
            labels.insert(0, f"{'≤' if closed_r else '<'}{fx(uf)}")
            counts.insert(0, under)
        if of is not None:
            labels.append(f"{'>' if closed_r else '≥'}{fx(of)}")
            counts.append(over)
        return labels, counts

    # ---------- box & whisker ----------
    def _box(self, sers):
        groups: List[str] = []
        per = []
        for s in sers:
            cat, val = self._series_dims(s)
            vals = val["levels"][0] if val and val["levels"] else []
            cats = self._flat_cats(cat, len(vals)) if cat is not None else ["" for _ in vals]
            d: Dict[str, List[float]] = {}
            for c, v in zip(cats, vals):
                if c not in groups:
                    groups.append(c)
                if v is not None:
                    d.setdefault(c, []).append(v)
            per.append((s, d))
        self._grid()
        self.option["tooltip"] = {"trigger": "item"}
        self.option["xAxis"] = self._axis("0", "category", groups)
        self.option["yAxis"] = self._axis("1", "value", dim="y")
        out = []
        ns = len(per)
        for si, (s, d) in enumerate(per):
            lp = s.find(CX + "layoutPr")
            vis = lp.find(CX + "visibility") if lp is not None else None
            stt = lp.find(CX + "statistics") if lp is not None else None
            method = stt.get("quartileMethod", "exclusive") if stt is not None else "exclusive"
            show_mean_m = _bool_attr(vis, "meanMarker", True)
            show_mean_l = _bool_attr(vis, "meanLine", False)
            show_inner = _bool_attr(vis, "nonoutliers", False)
            show_out = _bool_attr(vis, "outliers", True)
            color = self._color(s, si)
            name = self._name(s, si)
            box, pts, means = [], [], []
            for gi, gname in enumerate(groups):
                xs = sorted(d.get(gname, []))
                if not xs:
                    box.append(None)
                    continue
                q1 = quantile(xs, 0.25, method)
                q3 = quantile(xs, 0.75, method)
                med = median(xs)
                iqr = q3 - q1
                lf, hf = q1 - 1.5 * iqr, q3 + 1.5 * iqr
                inside = [x for x in xs if lf <= x <= hf]
                lo = inside[0] if inside else q1
                hi = inside[-1] if inside else q3
                box.append([sig(lo), sig(q1), sig(med), sig(q3), sig(hi)])
                m = mean(xs)
                means.append((gi, sig(m)))
                if show_mean_m:
                    pts.append([gi, sig(m), 0])
                for x in xs:
                    if x < lf or x > hf:
                        if show_out:
                            pts.append([gi, sig(x), 1])
                    elif show_inner:
                        pts.append([gi, sig(x), 2])
            out.append({"name": name, "type": "boxplot", "data": box,
                        "itemStyle": {"color": color, "borderColor": "#595959", "borderWidth": 1},
                        "boxWidth": [7, "60%"]})
            cfg = {"slot": si, "slots": ns, "color": color}
            if pts:
                out.append({"name": name, "type": "custom", "x-renderItem": "boxPoints", "x-cfg": cfg, "data": pts,
                            "encode": {"x": [0], "y": [1]}, "z": 5, "silent": True, "tooltip": {"show": False}})
            if show_mean_l and len(means) > 1:
                segs = [[means[i][0], means[i][1], means[i + 1][0], means[i + 1][1]] for i in range(len(means) - 1)]
                out.append({"name": name, "type": "custom", "x-renderItem": "boxMeanLine", "x-cfg": cfg, "data": segs,
                            "encode": {"x": [0, 2], "y": [1, 3]}, "z": 4, "silent": True, "tooltip": {"show": False}})
        self.option["series"] = out
        self.legend_data = [{"name": s["name"], "itemStyle": {"color": s["itemStyle"]["color"]}} for s in out if s["type"] == "boxplot"]


def _v_attr(el):
    return el.get("val") if el is not None else None
