"""Convert DrawingML charts (xl/charts/chartN.xml) inside an .xlsx into ECharts options."""
from __future__ import annotations

import datetime as _dt
import io
import math
import posixpath
import re
from typing import Any, Dict, List, Optional

from .chartex import CXNS, ChartEx
from .colors import fill_color, line_props, no_fill, resolve_color
from .formula import FormulaError, num2col, split_ref
from .stats import fsum, linreg, mean, polyfit, polyval, sig, stdev
from .workbook import jnum, jstr, NS, R_ID, Workbook, format_date, format_number, is_date_format, serial_to_datetime

C = "{%s}" % NS["c"]
A = "{%s}" % NS["a"]
XDR = "{%s}" % NS["xdr"]
EMU_PX = 9525

GROUP_TAGS = ["barChart", "bar3DChart", "lineChart", "line3DChart", "areaChart", "area3DChart",
              "pieChart", "pie3DChart", "doughnutChart", "ofPieChart", "scatterChart", "radarChart",
              "bubbleChart", "stockChart", "surfaceChart", "surface3DChart"]
AX_TAGS = ["catAx", "valAx", "dateAx", "serAx"]
SYMBOLS = {"circle": "circle", "square": "rect", "diamond": "diamond", "triangle": "triangle",
           "x": "path://M0,0L10,10M10,0L0,10", "star": "path://M5,0L5,10M0,5L10,5M1.5,1.5L8.5,8.5M8.5,1.5L1.5,8.5",
           "plus": "path://M5,0L5,10M0,5L10,5", "dash": "path://M0,4h10v2h-10z", "dot": "circle",
           "picture": "rect"}
LEGACY_MARKERS = ["diamond", "rect", "triangle", SYMBOLS["x"], SYMBOLS["star"], "circle", SYMBOLS["plus"]]


def _v(el, path, default=None, cast=str):
    if el is None:
        return default
    x = el.find(path) if path else el
    if x is None or x.get("val") is None:
        return default
    try:
        return cast(x.get("val"))
    except ValueError:
        return default


def _bool(el, path, default=False):
    if el is None:
        return default
    x = el.find(path)
    if x is None:
        return default
    return x.get("val", "1") in ("1", "true")


C15 = "{http://schemas.microsoft.com/office/drawing/2012/chart}"


class ChartConverter:
    def __init__(self, wb: Workbook, part: str, excel_compat: bool = True):
        self.wb, self.part, self.excel_compat = wb, part, excel_compat
        self.root = wb.xml(part)
        self.theme = wb.theme
        self.warnings: List[str] = []
        self.formats: List[dict] = []  # runtime number-format hooks
        self.chart_el = self.root.find(C + "chart")
        # legacy look (openpyxl/XlsxWriter style 2 charts without explicit text props) vs Office 2013+
        raw = wb.z.read(part).decode("utf-8", "replace")
        self.modern = "c14:style" in raw or "<c:txPr" in raw[:4000] or self.root.find(C + "txPr") is not None
        self.base_font = self._font(self.root.find(C + "txPr"), 10.0 if not self.modern else 9.0)

    # ---------- text helpers ----------
    def _font(self, txPr, default_pt, bold=False):
        sz, color, b = default_pt, None, bold
        if txPr is not None:
            d = txPr.find(f".//{A}defRPr")
            r = txPr.find(f".//{A}rPr")
            for e in (d, r):
                if e is None:
                    continue
                if e.get("sz"):
                    sz = int(e.get("sz")) / 100
                if e.get("b") is not None:
                    b = e.get("b") in ("1", "true")
                sf = e.find(A + "solidFill")
                if sf is not None and len(sf):
                    color = resolve_color(sf[0], self.theme)
        return {"fontSize": round(sz * 4 / 3, 1), "color": color or "#595959", "fontWeight": "bold" if b else "normal"}

    def _rich_text(self, tx):
        rich = tx.find(C + "rich") if tx is not None else None
        if rich is not None:
            paras = []
            for p in rich.findall(A + "p"):
                paras.append("".join((t.text or "") for t in p.iter(A + "t")))
            return "\n".join(paras), rich
        if tx is not None:
            sr = tx.find(C + "strRef")
            if sr is not None:
                vals, _, _ = self.read_data(tx)
                return " ".join(jstr(v) for v in vals if v is not None), None
            if tx.find(C + "v") is not None:
                return tx.find(C + "v").text or "", None
        return None, None

    def _title(self, title_el, default_pt, auto_text=None):
        if title_el is None:
            return None
        text, rich = self._rich_text(title_el.find(C + "tx"))
        if text is None:
            text = auto_text
        if not text:
            return None
        font = self._font(title_el.find(C + "txPr"), default_pt, bold=not self.modern or default_pt > 12)
        if rich is not None:
            font = self._font(rich, default_pt, bold=font["fontWeight"] == "bold")
        return text, font

    # ---------- data ----------
    def read_data(self, el):
        """el: c:cat / c:val / c:xVal / c:yVal / c:tx / c:bubbleSize. -> (values, formatCode, is_text)"""
        if el is None:
            return [], None, False
        for kind in ("numRef", "strRef", "multiLvlStrRef", "numLit", "strLit"):
            src = el.find(C + kind)
            if src is None:
                continue
            cache = src.find(C + {"numRef": "numCache", "strRef": "strCache", "multiLvlStrRef": "multiLvlStrCache"}.get(kind, "")) \
                if kind.endswith("Ref") else src
            fmt = None
            vals: List[Any] = []
            if cache is not None and kind == "multiLvlStrRef":
                lvls = cache.findall(C + "lvl")
                n = _v(cache, C + "ptCount", 0, int)
                if lvls and n:
                    levels = []
                    for lvl in lvls:
                        arr = [None] * n
                        for pt in lvl.findall(C + "pt"):
                            i = int(pt.get("idx"))
                            if i < n:
                                arr[i] = pt.findtext(C + "v")
                        levels.append(arr)
                    # innermost level first; fill outer labels downwards and join "outer inner"
                    outer = levels[1:]
                    for o in outer:
                        last = None
                        for i in range(n):
                            if o[i] is None:
                                o[i] = last
                            last = o[i]
                    vals = [" ".join(x for x in [*(o[i] for o in reversed(outer)), levels[0][i]] if x) for i in range(n)]
                    return vals, None, True
            if cache is not None and (cache.find(C + "ptCount") is not None or cache.findall(C + "pt")):
                n = _v(cache, C + "ptCount", 0, int)
                pts = cache.findall(C + "pt")
                if n == 0 and pts:
                    n = max(int(p.get("idx")) for p in pts) + 1
                if pts or n:
                    fmt = cache.findtext(C + "formatCode")
                    arr = [None] * n
                    for pt in pts:
                        i = int(pt.get("idx"))
                        if i >= n:
                            continue
                        t = pt.findtext(C + "v")
                        if kind in ("numRef", "numLit"):
                            try:
                                arr[i] = float(t)
                            except (TypeError, ValueError):
                                arr[i] = None
                        else:
                            arr[i] = t
                        if pt.get("formatCode"):
                            fmt = fmt or pt.get("formatCode")
                    if pts:
                        if fmt in (None, "General") and src.findtext(C + "f"):
                            fmt = self.ref_format(src.findtext(C + "f")) or fmt
                        return arr, fmt, kind not in ("numRef", "numLit")
            f = src.findtext(C + "f")
            if f:
                vals, fmt = self.resolve_ref(f, multi=kind == "multiLvlStrRef" or el.tag == C + "cat")
                return vals, fmt, kind not in ("numRef", "numLit") or any(isinstance(v, str) for v in vals)
            return vals, fmt, kind not in ("numRef", "numLit")
        return [], None, False

    def _parts(self, f):
        f = f.strip()
        if f.startswith("(") and f.endswith(")"):
            f = f[1:-1]
        if f in self.wb.defined_names:
            f = self.wb.defined_names[f]
        return re.findall(r"(?:'(?:[^']|'')+'|[^,'])+", f)

    def ref_format(self, f: str):
        """number format of the first non-General source cell (no formula evaluation)"""
        for part in self._parts(f):
            try:
                sheet, r1, c1, r2, c2 = split_ref(part.strip())
            except FormulaError:
                continue
            if sheet is None or (r2 - r1 + 1) * (c2 - c1 + 1) > 100000:
                continue
            for r in range(r1, r2 + 1):
                for c in range(c1, c2 + 1):
                    st = self.wb.style(sheet, r, c)
                    if st != "General":
                        return st
        return None

    def resolve_ref(self, f: str, multi: bool = False):
        parts = self._parts(f)
        if multi and len(parts) == 1:
            try:
                sheet, r1, c1, r2, c2 = split_ref(parts[0].strip())
            except FormulaError:
                sheet = None
            if sheet is not None and r2 > r1 and c2 > c1 and (r2 - r1 + 1) * (c2 - c1 + 1) <= 100000:
                rows, fmt = [], None
                for r in range(r1, r2 + 1):
                    rows.append([self.wb.value(sheet, r, c) for c in range(c1, c2 + 1)])
                if r2 - r1 < c2 - c1:  # levels laid out in rows -> transpose
                    rows = [list(x) for x in zip(*rows)]
                for lvl in range(len(rows[0]) - 1):  # fill outer levels downwards
                    last = None
                    for row in rows:
                        if row[lvl] is None or row[lvl] == "":
                            row[lvl] = last
                        last = row[lvl]
                self.used_formula_fallback = True
                return [" ".join(jstr(x) for x in row if jstr(x)) for row in rows], fmt
        f = f.strip()
        if f.startswith("(") and f.endswith(")"):
            f = f[1:-1]
        if f in self.wb.defined_names:
            f = self.wb.defined_names[f]
        vals, fmt = [], None
        for part in re.findall(r"(?:'(?:[^']|'')+'|[^,'])+", f):
            try:
                sheet, r1, c1, r2, c2 = split_ref(part.strip())
            except FormulaError:
                self.warnings.append(f"cannot resolve reference {part!r}")
                continue
            if sheet is None:
                self.warnings.append(f"reference without sheet {part!r}")
                continue
            if (r2 - r1 + 1) * (c2 - c1 + 1) > 100000:
                self.warnings.append(f"reference too large {part!r}")
                continue
            for r in range(r1, r2 + 1):
                for c in range(c1, c2 + 1):
                    vals.append(self.wb.value(sheet, r, c))
                    if fmt is None:
                        st = self.wb.style(sheet, r, c)
                        if st != "General":
                            fmt = st
        self.used_formula_fallback = True
        return vals, fmt

    # ---------- main ----------
    def convert(self) -> Dict[str, Any]:
        ch = self.chart_el
        pa = ch.find(C + "plotArea")
        groups = [g for g in pa if g.tag.split("}")[1] in GROUP_TAGS]
        axes = {}
        for ax in pa:
            t = ax.tag.split("}")[1]
            if t in AX_TAGS:
                axes[ax.findtext(C + "axId") or _v(ax, C + "axId")] = (t, ax)
        self.axes = axes
        self.disp_blanks = _v(ch, C + "dispBlanksAs", "gap")
        self.option: Dict[str, Any] = {
            "backgroundColor": self._chart_bg(),
            "textStyle": {"fontFamily": "Calibri, 'Microsoft YaHei', 'PingFang SC', sans-serif"},
            "tooltip": {"trigger": "item"},
            "series": [],
        }
        types = []
        all_series = []
        self.palette_i = 0
        self.xaxes: List[dict] = []
        self.auto_axes: List[tuple] = []
        self.date_axes: Dict[tuple, str] = {}
        self.yaxes: List[dict] = []
        self.axmap: Dict[str, tuple] = {}
        self.pie_like = False
        self.err_pending: List[tuple] = []
        self.tip_fmt: Dict[int, str] = {}
        self.auto_names: set = set()
        self.trend_pending: List[dict] = []
        self.bar_dim: Dict[int, str] = {}
        for gi, g in enumerate(groups):
            t = g.tag.split("}")[1]
            types.append(t)
            sers = sorted(g.findall(C + "ser"), key=lambda s: _v(s, C + "order", 0, int))
            all_series.extend(sers)
            fn = getattr(self, "_g_" + {"bar3DChart": "barChart", "line3DChart": "lineChart", "area3DChart": "areaChart",
                                        "pie3DChart": "pieChart", "ofPieChart": "pieChart"}.get(t, t), None)
            if fn is None:
                self.warnings.append(f"{t} is not supported — rendered as line chart")
                fn = self._g_lineChart
            if t.endswith("3DChart"):
                self.warnings.append(f"{t}: 3-D rendered as 2-D")
            fn(g, sers)
        self._finalize_errbars()
        self.option["series"].extend(self.trend_pending)
        self._auto_scale()
        # title
        auto = None
        if len(all_series) == 1:
            auto = self._series_name(all_series[0], 0)
        elif all_series:
            auto = "Chart Title"
        if _bool(ch, C + "autoTitleDeleted"):
            t = None
        else:
            t = self._title(ch.find(C + "title"), 14.0 if self.modern else 18.0, auto)
        if t:
            self.option["title"] = {"text": t[0], "left": "center", "top": 6, "textStyle": t[1]}
            mxy = self._manual_xy(ch.find(C + "title"))
            if mxy:
                self.option["title"]["left"], self.option["title"]["top"] = mxy
        self._legend(ch.find(C + "legend"))
        if not self.option["legend"].get("show") and self.auto_names:
            # Excel shows its default "Series1" name only in a legend; without one keep tooltips clean
            for s in self.option["series"]:
                if s.get("name") in self.auto_names:
                    s["name"] = ""
                for d in (s.get("data") or []) if s.get("type") == "radar" else []:
                    if d.get("name") in self.auto_names:
                        d["name"] = ""
        for i, s in enumerate(self.option["series"]):
            code = self.tip_fmt.get(id(s))
            if isinstance(code, tuple):
                self.formats.append({"path": f"series.{i}.tooltip", "formatCode": code[1], "tooltip": True, "date": True,
                                     "serial": 1904 if self.wb.date1904 else 1900})
            elif code:
                self.formats.append({"path": f"series.{i}.tooltip", "formatCode": code, "tooltip": True})
        if self.xaxes:
            self.option["xAxis"] = self.xaxes if len(self.xaxes) > 1 else self.xaxes[0]
        if self.yaxes:
            self.option["yAxis"] = self.yaxes if len(self.yaxes) > 1 else self.yaxes[0]
        if self.xaxes or self.yaxes:
            top = 50 if "title" in self.option else 24
            leg = self.option.get("legend", {})
            grid = {"left": 16, "right": 24, "top": top, "bottom": 16, "containLabel": True}
            if leg.get("show"):
                pos = leg.get("_pos")
                if pos == "b":
                    grid["bottom"] = 40
                elif pos in ("t",):
                    grid["top"] = top + 28
                elif pos in ("r", "tr"):
                    grid["right"] = 130
                elif pos == "l":
                    grid["left"] = 130
            for ax in self.yaxes:
                if ax.get("name"):
                    side = "right" if ax.get("position") == "right" else "left"
                    grid[side] += 28
            if any(ax.get("name") for ax in self.xaxes):
                grid["bottom"] += 24
            self.option["grid"] = grid
            self.option["tooltip"] = {"trigger": "axis", "axisPointer": {"type": "shadow" if any("bar" in x for x in types) else "line"}}
            if any(t == "scatterChart" or t == "bubbleChart" for t in types):
                self.option["tooltip"] = {"trigger": "item"}
        if "legend" in self.option:
            self.option["legend"].pop("_pos", None)
        if self.formats:
            self.option["x-numFmt"] = self.formats
        return {"types": types, "option": self.option, "warnings": self.warnings}

    def _chart_bg(self):
        sp = self.root.find(C + "spPr")
        if no_fill(sp):
            return "transparent"
        return fill_color(sp, self.theme) or "#FFFFFF"

    # ---------- colours ----------
    def _auto_color(self, i):
        acc = ["accent1", "accent2", "accent3", "accent4", "accent5", "accent6"]
        base = self.theme.get(acc[i % 6], "4472C4")
        round_ = i // 6
        if round_ == 0:
            return "#" + base.upper()
        from xml.etree.ElementTree import Element, SubElement
        e = Element(A + "srgbClr", val=base)
        if round_ % 2 == 1:
            SubElement(e, A + "lumMod", val="60000")
        else:
            SubElement(e, A + "lumMod", val="80000")
            SubElement(e, A + "lumOff", val="20000")
        return resolve_color(e, self.theme)

    def _series_color(self, ser, line=False):
        sp = ser.find(C + "spPr")
        idx = _v(ser, C + "idx", 0, int)
        if line:
            col, w, nol, dash = line_props(sp, self.theme)
            return col or self._auto_color(idx), w, nol, dash
        return fill_color(sp, self.theme) or self._auto_color(idx)

    def _series_name(self, ser, i):
        tx = ser.find(C + "tx")
        if tx is not None:
            text, _ = self._rich_text(tx)
            if text:
                return text
        nm = f"Series{_v(ser, C + 'idx', i, int) + 1}"
        self.auto_names.add(nm)
        return nm

    def _tip(self, e, lab, fmt, axis_fmt, skip):
        """tooltip number format = data-label format, else source format, else axis format"""
        if skip:
            return
        code = (lab or {}).get("_fmt") or (fmt if fmt not in (None, "General") else None) or \
            (axis_fmt if axis_fmt not in (None, "General") else None)
        if code and not is_date_format(code):
            self.tip_fmt[id(e)] = code

    # ---------- axes ----------
    def _axis_for(self, ax_id, dim, kind, categories=None, horizontal=False, cat_fmt=None, val_fmt=None, percent=False,
                  boundary_gap=True, dates=None):
        """Return index of ECharts axis in dim ('x'|'y') for the OOXML axis ax_id."""
        if ax_id in self.axmap:
            return self.axmap[ax_id][1]
        lst = self.xaxes if dim == "x" else self.yaxes
        tag, ax = self.axes.get(ax_id, ("valAx", None))
        # openpyxl ≥3.1 writes neither <c:delete> nor <c:tickLblPos>; Excel then hides the axis.
        # (XlsxWriter also omits <c:delete> but writes tickLblPos, and Excel shows those axes.)
        implicit_hide = ax is not None and self.excel_compat and ax.find(C + "delete") is None and ax.find(C + "tickLblPos") is None
        deleted = _bool(ax, C + "delete", default=implicit_hide) if ax is not None else True
        if implicit_hide:
            self.warnings.append(f"axis {ax_id}: no <c:delete> element — Excel hides such axes (typical openpyxl ≥3.1 output); "
                                 "labels hidden to match Excel")
        e: Dict[str, Any] = {}
        font = self._font(ax.find(C + "txPr") if ax is not None else None, self.base_font["fontSize"] * 3 / 4)
        e["axisLabel"] = {"show": not deleted and _v(ax, C + "tickLblPos", "nextTo") != "none",
                          "color": font["color"], "fontSize": font["fontSize"]}
        rot = None
        if ax is not None:
            bp = ax.find(f"{C}txPr/{A}bodyPr")
            if bp is not None and bp.get("rot") not in (None, "-60000000"):
                rot = -int(bp.get("rot")) / 60000
                if rot:
                    e["axisLabel"]["rotate"] = rot
        line_col = "#D9D9D9" if self.modern else "#868686"
        line_w = None
        if ax is not None:
            c, line_w, nol, _ = line_props(ax.find(C + "spPr"), self.theme)
            if c:
                line_col = c
            axis_line_show = not nol and not deleted
        else:
            axis_line_show = False
        e["axisLine"] = {"show": axis_line_show, "lineStyle": {"color": line_col, **({"width": line_w} if line_w and line_w > 1.5 else {})}}
        major_tick = _v(ax, C + "majorTickMark", "out" if not self.modern else "none")
        e["axisTick"] = {"show": not deleted and major_tick != "none", "inside": major_tick == "in",
                         "lineStyle": {"color": line_col}}
        if kind == "category":
            e["axisTick"]["alignWithLabel"] = True
        mg = ax.find(C + "majorGridlines") if ax is not None else None
        gcol = "#D9D9D9" if self.modern else "#878787"
        if mg is not None:
            c, w, _, dash = line_props(mg.find(C + "spPr"), self.theme)
            e["splitLine"] = {"show": True, "lineStyle": {"color": c or gcol, **({"width": w} if w else {}),
                                                          **({"type": dash} if dash else {})}}
        else:
            e["splitLine"] = {"show": False}
        if ax is not None and ax.find(C + "minorGridlines") is not None:
            e["minorSplitLine"] = {"show": True, "lineStyle": {"color": "#F2F2F2"}}
            e["minorTick"] = {"show": False}
        title = self._title(ax.find(C + "title"), 10.0, None) if ax is not None else None
        if title:
            e["name"] = title[0]
            e["nameLocation"] = "middle"
            e["nameTextStyle"] = {**title[1]}
            e["nameGap"] = 32 if dim == "x" else 45
        scaling = ax.find(C + "scaling") if ax is not None else None
        if _v(scaling, C + "orientation", "minMax") == "maxMin":
            e["inverse"] = True
        pos = _v(ax, C + "axPos")
        if kind == "category":
            e["type"] = "category"
            e["data"] = categories or []
            e["boundaryGap"] = boundary_gap
            skip = _v(ax, C + "tickLblSkip", None, int)
            if skip:
                e["axisLabel"]["interval"] = skip - 1
            elif categories and not rot:
                e["axisLabel"]["interval"] = "auto"
            if cat_fmt and dates is None and not is_date_format(cat_fmt):
                pass
        elif kind == "time":
            e["type"] = "time"
            e["boundaryGap"] = False
            if cat_fmt:
                self._fmt_hook(f"{dim}Axis.{len(lst)}.axisLabel", cat_fmt, date=True)
        else:
            e["type"] = "value"
            lb = _v(scaling, C + "logBase", None, float)
            if lb:
                e["type"] = "log"
                e["logBase"] = lb
            mn, mx = _v(scaling, C + "min", None, float), _v(scaling, C + "max", None, float)
            if percent:
                mn = 0 if mn is None else mn * 100
                mx = 100 if mx is None else mx * 100
            if mn is not None:
                e["min"] = mn
            if mx is not None:
                e["max"] = mx
            mu = _v(ax, C + "majorUnit", None, float)
            if mu:
                e["interval"] = mu * (100 if percent else 1)
            e["scale"] = mn is None and self._excel_scale_hint()
            if mn is None and not lb and not percent:
                self.auto_axes.append((dim, len(lst), mx, mu))
            nf = ax.find(C + "numFmt") if ax is not None else None
            code = None
            if nf is not None and nf.get("sourceLinked") in ("0", "false"):
                code = nf.get("formatCode")
            elif val_fmt:
                code = val_fmt
            if percent:
                e["axisLabel"]["formatter"] = "{value}%"
            elif code and is_date_format(code):
                self._fmt_hook(f"{dim}Axis.{len(lst)}.axisLabel", code, date=True, serial=True)
                self.date_axes[(dim, len(lst))] = code
            elif code and code != "General":
                self._fmt_hook(f"{dim}Axis.{len(lst)}.axisLabel", code)
            if dim == "y" and (pos == "r" or len(lst) >= 1):
                e["position"] = "right" if len(lst) >= 1 else "left"
            if dim == "x" and (pos == "t" or self._x_occupied(lst)):
                e["position"] = "top"
        if dim == "x" and kind != "value" and (pos == "t" or self._x_occupied(lst)):
            e["position"] = "top"
        if dim == "x" and lst and "position" not in e:
            e["position"] = "bottom"
        lst.append(e)
        idx = len(lst) - 1
        self.axmap[ax_id] = (dim, idx)
        return idx

    def _excel_scale_hint(self):
        return False

    @staticmethod
    def _x_occupied(lst):
        """a visible x axis already sits at the bottom -> a further one goes to the top"""
        return any(a.get("position") != "top" and (a["axisLabel"]["show"] or a["axisLine"]["show"]) for a in lst)

    @staticmethod
    def _manual_xy(el):
        ml = el.find(f"{C}layout/{C}manualLayout") if el is not None else None
        if ml is None or _v(ml, C + "xMode", "factor") != "edge" or _v(ml, C + "yMode", "factor") != "edge":
            return None
        x, y = _v(ml, C + "x", None, float), _v(ml, C + "y", None, float)
        if x is None or y is None:
            return None
        return f"{jnum(round(x * 100, 2))}%", f"{jnum(round(y * 100, 2))}%"

    def _fmt_hook(self, path, code, date=False, serial=False):
        h = {"path": path, "formatCode": code}
        if date:
            h["date"] = True
        if serial:
            h["serial"] = 1904 if self.wb.date1904 else 1900
        self.formats.append(h)

    def _auto_scale(self):
        """Excel's automatic value-axis minimum: when all data are >= 0 and min > 5/6·max (or the mirror
        for negative data), the axis does not start at 0 but at min − (max − min)/2, rounded down to the major unit."""
        for dim, idx, mx_fixed, mu in self.auto_axes:
            vals = []
            for s in self.option["series"]:
                if s.get(dim + "AxisIndex", 0) != idx or s.get("stack"):
                    continue
                vals += self._axis_vals(s, dim)
            vals = [v for v in vals if isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)]
            if not vals:
                continue
            lo, hi = min(vals), max(vals)
            if mx_fixed is not None:
                hi = max(hi, mx_fixed)
            ax = (self.xaxes if dim == "x" else self.yaxes)[idx]
            if lo > 0 and lo > hi * 5 / 6 and hi > lo:
                mn = lo - (hi - lo) / 2
            elif hi < 0 and hi < lo * 5 / 6 and hi > lo:
                mn = None
                ax["scale"] = True
                continue
            else:
                continue
            if mu:
                ax["min"] = sig(math.floor(mn / mu) * mu)
            else:
                ax["scale"] = True

    def _axis_vals(self, s, dim):
        d = s.get("data") or []
        out = []
        t = s.get("type")
        if t == "custom":
            enc = (s.get("encode") or {}).get(dim) or []
            for p in d:
                p = p.get("value") if isinstance(p, dict) else p
                if isinstance(p, list):
                    out += [p[k] for k in enc if k < len(p)]
            return out
        cat_dim = self.bar_dim.get(id(s), "x") if t == "bar" else "x"
        for p in d:
            p = p.get("value") if isinstance(p, dict) else p
            if isinstance(p, list):
                if t in ("scatter", "line") and len(p) >= 2:
                    out.append(p[0] if dim == "x" else p[1])
            elif t in ("bar", "line") and dim != cat_dim:
                out.append(p)
        return out

    # ---------- labels ----------
    def _labels(self, group, ser, kind, fmt=None):
        d = ser.find(C + "dLbls")
        if d is None:
            d = group.find(C + "dLbls")
        if d is None or _bool(d, C + "delete"):
            return None
        flags = {k: _bool(d, C + k) for k in ("showVal", "showPercent", "showCatName", "showSerName", "showLegendKey")}
        rng = None
        if any(x.get("val") in ("1", "true") for x in d.iter(C15 + "showDataLabelsRange")):
            cache = next(ser.iter(C15 + "dlblRangeCache"), None)
            if cache is not None:
                n = _v(cache, C + "ptCount", 0, int)
                rng = [None] * n
                for pt in cache.findall(C + "pt"):
                    k = int(pt.get("idx"))
                    if k < n:
                        rng[k] = pt.findtext(C + "v")
        if rng is not None:
            font = self._font(d.find(C + "txPr"), self.base_font["fontSize"] * 3 / 4)
            pmap = {"t": "top", "b": "bottom", "l": "left", "r": "right", "ctr": "inside"}
            return {"show": True, "formatter": "{b}", "color": font["color"], "fontSize": font["fontSize"],
                    "position": pmap.get(_v(d, C + "dLblPos"), "right"), "_range": rng}
        if not any(flags[k] for k in ("showVal", "showPercent", "showCatName", "showSerName")):
            return None
        sep = d.findtext(C + "separator") or (", " if kind != "pie" else ", ")
        parts = []
        if flags["showSerName"]:
            parts.append("{a}")
        if flags["showCatName"]:
            parts.append("{b}")
        if flags["showVal"]:
            parts.append("{@[1]}" if kind == "scatter" else "{c}")
        if flags["showPercent"] and kind == "pie":
            parts.append("{d}%")
        font = self._font(d.find(C + "txPr"), self.base_font["fontSize"] * 3 / 4)
        lab = {"show": True, "formatter": sep.join(parts), "color": font["color"], "fontSize": font["fontSize"]}
        pos = _v(d, C + "dLblPos")
        pmap = {"outEnd": "top", "inEnd": "insideTop", "ctr": "inside", "inBase": "insideBottom",
                "t": "top", "b": "bottom", "l": "left", "r": "right", "bestFit": "outside"}
        if kind == "pie":
            lab["position"] = {"outEnd": "outside", "bestFit": "outside", "inEnd": "inside", "ctr": "inside"}.get(pos, "outside" if pos else "outside")
        elif kind == "hbar":
            lab["position"] = {"outEnd": "right", "inEnd": "insideRight", "ctr": "inside", "inBase": "insideLeft"}.get(pos, "right")
        elif kind == "stackbar":
            lab["position"] = pmap.get(pos, "inside")
        else:
            lab["position"] = pmap.get(pos, "top" if kind != "line" else "right")
        nf = d.find(C + "numFmt")
        code = nf.get("formatCode") if nf is not None and nf.get("sourceLinked") in ("0", "false") else fmt
        if code and code != "General" and flags["showVal"] and kind != "scatter":
            lab["_fmt"] = code
        return lab

    def _apply_label_fmt(self, s, values):
        lab = s.get("label")
        if not lab or "_fmt" not in lab:
            return
        code = lab.pop("_fmt")
        if lab["formatter"] == "{c}":
            data = []
            for v in s["data"]:
                raw = v["value"] if isinstance(v, dict) else v
                item = dict(v) if isinstance(v, dict) else {"value": v}
                if raw is not None:
                    item.setdefault("label", {})["formatter"] = format_number(raw, code)
                data.append(item)
            s["data"] = data
        else:
            self._fmt_hook(f"series.{len(self.option['series']) - 1}.label", code)

    # ---------- categories ----------
    def _categories(self, sers, ax_id):
        cats, fmt, is_text = [], None, True
        for s in sers:
            cats, fmt, is_text = self.read_data(s.find(C + "cat"))
            if cats:
                break
        n = max([len(self.read_data(s.find(C + "val"))[0]) for s in sers] + [len(cats)])
        tag = self.axes.get(ax_id, ("catAx", None))[0]
        ax = self.axes.get(ax_id, (None, None))[1]
        nf = ax.find(C + "numFmt") if ax is not None else None
        if nf is not None and nf.get("sourceLinked") in ("0", "false"):
            fmt = nf.get("formatCode") or fmt
        numeric = cats and all(isinstance(c, (int, float)) and not isinstance(c, bool) for c in cats if c is not None)
        dates = None
        if numeric and (is_date_format(fmt) or tag == "dateAx"):
            dates = [c for c in cats]
            labels = [format_date(c, fmt or "yyyy-mm-dd", self.wb.date1904) if c is not None else "" for c in cats]
        elif numeric:
            labels = [format_number(c, fmt) for c in cats]
        else:
            labels = [jstr(c) for c in cats]
        if not labels:
            labels = [str(i + 1) for i in range(n)]
        while len(labels) < n:
            labels.append(str(len(labels) + 1))
        return labels, dates, tag

    def _values(self, ser, tag="val", percent_tot=None):
        vals, fmt, _ = self.read_data(ser.find(C + tag))
        out = []
        for v in vals:
            if isinstance(v, bool):
                v = float(v)
            if isinstance(v, str):
                try:
                    v = float(v)
                except ValueError:
                    v = None
            if v is None and self.disp_blanks == "zero":
                v = 0.0
            if isinstance(v, float):
                v = int(v) if v.is_integer() and abs(v) < 1e15 else float(f"{v:.12g}")
            out.append(v)
        return out, fmt

    # ---------- groups ----------
    def _cat_val_axes(self, g):
        ids = [a.get("val") for a in g.findall(C + "axId")]
        return (ids + [None, None])[:2]

    def _g_barChart(self, g, sers):
        horizontal = _v(g, C + "barDir", "col") == "bar"
        grouping = _v(g, C + "grouping", "clustered")
        cat_id, val_id = self._cat_val_axes(g)
        labels, dates, _ = self._categories(sers, cat_id)
        cdim, vdim = ("y", "x") if horizontal else ("x", "y")
        vals_all = [self._values(s) for s in sers]
        val_fmt = next((f for _, f in vals_all if f), None)
        percent = grouping == "percentStacked"
        ci = self._axis_for(cat_id, cdim, "category", labels)
        vi = self._axis_for(val_id, vdim, "value", val_fmt=val_fmt, percent=percent)
        gap = _v(g, C + "gapWidth", 150, int) / 100
        overlap = _v(g, C + "overlap", 100 if grouping in ("stacked", "percentStacked") else 0, int)
        stacked = grouping in ("stacked", "percentStacked")
        nbars = 1 if stacked else max(1, len(sers))
        totals = None
        if percent:
            totals = [fsum(abs(v[i]) for v, _ in vals_all if i < len(v) and v[i] is not None) for i in range(len(labels))]
        vary = _bool(g, C + "varyColors") and len(sers) == 1
        stack_id = f"stack{len(self.option['series'])}"
        acc_p = [0.0] * len(labels)
        acc_n = [0.0] * len(labels)
        for i, (s, (vals, fmt)) in enumerate(zip(sers, vals_all)):
            color = self._series_color(s)
            orig = vals
            if percent:
                vals = [None if v is None or not totals[j] else round(v / totals[j] * 100, 6) for j, v in enumerate(vals)]
            it = {"color": color}
            col, w, nol, _ = line_props(s.find(C + "spPr"), self.theme)
            if col and not nol:
                it.update(borderColor=col, borderWidth=w or 1)
            if no_fill(s.find(C + "spPr")):
                it["color"] = "transparent"
            e = {"name": self._series_name(s, i), "type": "bar", "data": vals, "itemStyle": it,
                 ("yAxisIndex" if not horizontal else "xAxisIndex"): vi,
                 ("xAxisIndex" if not horizontal else "yAxisIndex"): ci}
            if stacked:
                e["stack"] = stack_id
            if i == 0 or not stacked:
                e["barCategoryGap"] = f"{jnum(round(gap / (nbars + gap) * 100, 2))}%"
                e["barGap"] = f"{-overlap}%"
            if vary or _v(s, C + "invertIfNegative", "0") == "1" and False:
                pass
            dpts = self._dpts(s)
            if vary or dpts:
                e["data"] = [{"value": v, "itemStyle": {"color": dpts.get(j) or (self._auto_color(j) if vary else color)}}
                             for j, v in enumerate(vals)]
            lab = self._labels(g, s, "hbar" if horizontal and not stacked else ("stackbar" if stacked else "bar"), fmt)
            self._tip(e, lab, fmt, val_fmt, percent)
            if lab:
                e["label"] = lab
                if percent:
                    self._percent_labels(e, lab, orig, fmt)
            self.option["series"].append(e)
            self.bar_dim[id(e)] = cdim
            self._apply_label_fmt(e, vals)
            centers = list(vals)
            if stacked:
                centers = []
                for j, v in enumerate(vals):
                    if not isinstance(v, (int, float)) or j >= len(acc_p):
                        centers.append(v)
                    elif v >= 0:
                        acc_p[j] += v
                        centers.append(acc_p[j])
                    else:
                        acc_n[j] += v
                        centers.append(acc_n[j])
            idx = list(range(len(vals)))
            self._err_bars(s, e, idx, vals, centers, "cat", horizontal)
            self._trendlines(s, e, [float(j + 1) for j in idx], vals, color, True)

    def _percent_labels(self, e, lab, orig, fmt):
        """100% stacked charts: Excel labels show the original values, not the percentages."""
        code = lab.pop("_fmt", None) or fmt
        if lab["formatter"] == "{c}":
            data = []
            for v, ov in zip(e["data"], orig):
                item = dict(v) if isinstance(v, dict) else {"value": v}
                if ov is not None:
                    item["label"] = {"formatter": format_number(ov, code)}
                data.append(item)
            e["data"] = data
        else:
            lab["formatter"] = lab["formatter"].replace("{c}", "{c}%")

    def _dpts(self, s):
        out = {}
        for dp in s.findall(C + "dPt"):
            c = fill_color(dp.find(C + "spPr"), self.theme)
            if c:
                out[_v(dp, C + "idx", 0, int)] = c
        return out

    def _marker(self, s, group_marker_default, i):
        m = s.find(C + "marker")
        sym = _v(m, C + "symbol", None)
        if sym == "none":
            return None
        if sym is None and not group_marker_default:
            return None
        size = _v(m, C + "size", 5 if not self.modern else 5, int)
        if sym in (None, "auto"):
            shape = LEGACY_MARKERS[_v(s, C + "idx", i, int) % len(LEGACY_MARKERS)] if not self.modern else "circle"
        else:
            shape = SYMBOLS.get(sym, "circle")
        col = fill_color(m.find(C + "spPr"), self.theme) if m is not None else None
        if m is not None and no_fill(m.find(C + "spPr")) and line_props(m.find(C + "spPr"), self.theme)[2]:
            col = "transparent"
        return shape, round(size * 4 / 3 + 1, 1), col

    def _g_lineChart(self, g, sers, area=False):
        grouping = _v(g, C + "grouping", "standard")
        cat_id, val_id = self._cat_val_axes(g)
        labels, dates, tag = self._categories(sers, cat_id)
        vals_all = [self._values(s) for s in sers]
        val_fmt = next((f for _, f in vals_all if f), None)
        percent = grouping == "percentStacked"
        use_time = False
        if dates and tag == "dateAx":
            ds = [d for d in dates if d is not None]
            steps = {round(b - a, 6) for a, b in zip(ds, ds[1:])}
            use_time = len(steps) > 1
        cat_fmt = None
        if use_time:
            cax = self.axes.get(cat_id, (None, None))[1]
            cnf = cax.find(C + "numFmt") if cax is not None else None
            if cnf is not None and cnf.get("sourceLinked") in ("0", "false") and cnf.get("formatCode"):
                cat_fmt = cnf.get("formatCode")
            else:
                for s in sers:
                    _, cat_fmt, _ = self.read_data(s.find(C + "cat"))
                    if cat_fmt:
                        break
                if not is_date_format(cat_fmt):
                    cat_fmt = None
            ci = self._axis_for(cat_id, "x", "time", cat_fmt=cat_fmt or "yyyy-mm-dd")
        else:
            ci = self._axis_for(cat_id, "x", "category", labels, boundary_gap=not area and
                                _v(self.axes.get(cat_id, (None, None))[1], C + "crossBetween", "between") != "midCat"
                                if False else not area)
        vi = self._axis_for(val_id, "y", "value", val_fmt=val_fmt, percent=percent)
        group_marker = _bool(g, C + "marker", default=not area) if not area else False
        stacked = grouping in ("stacked", "percentStacked")
        totals = None
        if percent:
            totals = [fsum(abs(v[i]) for v, _ in vals_all if i < len(v) and v[i] is not None) for i in range(len(labels))]
        stack_id = f"stack{len(self.option['series'])}"
        drop = g.find(C + "dropLines") is not None
        for i, (s, (vals, fmt)) in enumerate(zip(sers, vals_all)):
            orig = vals
            if percent:
                vals = [None if v is None or not totals[j] else round(v / totals[j] * 100, 6) for j, v in enumerate(vals)]
            if use_time:
                data = [[serial_to_datetime(d, self.wb.date1904).strftime("%Y-%m-%dT%H:%M:%S") if d is not None else None, v]
                        for d, v in zip(dates, vals)]
            else:
                data = vals
            e: Dict[str, Any] = {"name": self._series_name(s, i), "type": "line", "data": data,
                                 "xAxisIndex": ci, "yAxisIndex": vi}
            if area:
                color = self._series_color(s)
                lc, w, nol, dash = line_props(s.find(C + "spPr"), self.theme)
                e["areaStyle"] = {"color": color, "opacity": 1}
                e["lineStyle"] = {"width": 0 if nol or not lc else (w or 1), "color": lc or color}
                e["itemStyle"] = {"color": color}
                e["showSymbol"] = False
                e["symbol"] = "none"
            else:
                color, w, nol, dash = self._series_color(s, line=True)
                e["itemStyle"] = {"color": color}
                ls = {"color": color, "width": w or (2.25 * 4 / 3 if self.modern else 2.67)}
                if dash:
                    ls["type"] = dash
                if nol:
                    ls["width"] = 0
                e["lineStyle"] = ls
                mk = self._marker(s, group_marker, i)
                if mk:
                    e["symbol"], e["symbolSize"] = mk[0], mk[1]
                    e["showSymbol"] = True
                    if mk[2]:
                        e["itemStyle"]["color"] = mk[2]
                else:
                    e["showSymbol"] = False
                    e["symbol"] = "none"
                if _bool(s, C + "smooth", default=False):
                    e["smooth"] = True
            if stacked:
                e["stack"] = stack_id
            if self.disp_blanks == "span":
                e["connectNulls"] = True
            lab = self._labels(g, s, "line", fmt)
            self._tip(e, lab, fmt, val_fmt, percent)
            if lab:
                if use_time:
                    tcode = lab.pop("_fmt", None)
                    lab["formatter"] = lab["formatter"].replace("{c}", "{@[1]}")
                    if tcode:
                        self._fmt_hook(f"series.{len(self.option['series'])}.label", tcode)
                e["label"] = lab
                if percent and not use_time:
                    self._percent_labels(e, lab, orig, fmt)
            if drop:
                e["markLine"] = {"silent": True, "symbol": "none", "data": []}
            self.option["series"].append(e)
            if not use_time:
                self._apply_label_fmt(e, vals)
            xs = [d[0] for d in data] if use_time else list(range(len(vals)))
            centers = list(vals)
            if stacked:
                centers, acc = [], 0.0
                for v in vals:
                    if isinstance(v, (int, float)):
                        acc += v
                        centers.append(acc)
                    else:
                        centers.append(v)
            self._err_bars(s, e, xs, vals, centers, "cat")
            if not use_time:
                self._trendlines(s, e, [float(j + 1) for j in range(len(vals))], vals, e["itemStyle"]["color"], True)

    def _g_areaChart(self, g, sers):
        self._g_lineChart(g, sers, area=True)

    def _g_pieChart(self, g, sers, hole=None):
        self.pie_like = True
        if not sers:
            return
        s = sers[0]
        if len(sers) > 1 and hole is None:
            self.warnings.append("pie chart with several series: Excel only draws the first one")
            sers = sers[:1]
        labels, _, _ = self._categories([s], None)
        first = _v(g, C + "firstSliceAng", 0, int)
        vary = _bool(g, C + "varyColors", default=True)
        n_rings = len(sers) if hole is not None else 1
        outer = 75
        inner0 = outer * (hole or 0) / 100
        ring_w = (outer - inner0) / n_rings
        for ri, s in enumerate(sers[:n_rings]):
            vals, fmt = self._values(s)
            dpts = self._dpts(s)
            base = self._series_color(s)
            data = []
            for j, v in enumerate(vals):
                c = dpts.get(j) or (self._auto_color(j) if vary else base)
                item = {"name": labels[j] if j < len(labels) else str(j + 1), "value": v, "itemStyle": {"color": c}}
                expl = None
                for dp in s.findall(C + "dPt"):
                    if _v(dp, C + "idx", -1, int) == j:
                        expl = _v(dp, C + "explosion", None, int)
                if expl:
                    item["selected"] = True
                data.append(item)
            r_in = inner0 + ring_w * ri
            r_out = inner0 + ring_w * (ri + 1)
            e = {"name": self._series_name(s, ri), "type": "pie", "data": data,
                 "radius": [f"{jnum(round(r_in, 2))}%", f"{jnum(round(r_out, 2))}%"] if hole else f"{outer}%",
                 "center": ["50%", "55%" if "title" in self.option or self.chart_el.find(C + "title") is not None else "50%"],
                 "startAngle": 90 - first, "clockwise": True,
                 "itemStyle": {"borderColor": "#FFFFFF", "borderWidth": 1}}
            if any(d.get("selected") for d in data):
                e["selectedMode"] = "multiple"
                e["selectedOffset"] = 12
            expl = _v(s, C + "explosion", None, int)
            if expl:
                e["selectedMode"] = "multiple"
                e["selectedOffset"] = 12
                for d in data:
                    d["selected"] = True
            lab = self._labels(g, s, "pie", fmt)
            self._tip(e, lab, fmt, None, False)
            if lab:
                if lab["position"] == "inside":
                    lab["color"] = lab["color"] if lab["color"] != "#595959" else "#404040"
                e["label"] = lab
                e["labelLine"] = {"show": lab["position"] == "outside" and _bool(s.find(C + "dLbls") or g.find(C + "dLbls"), C + "showLeaderLines", True)}
            else:
                e["label"] = {"show": False}
                e["labelLine"] = {"show": False}
            self.option["series"].append(e)
            self._apply_label_fmt(e, vals)

    def _g_doughnutChart(self, g, sers):
        hole = _v(g, C + "holeSize", 10, int)
        self._g_pieChart(g, sers, hole=max(1, hole))

    def _g_scatterChart(self, g, sers, bubble=False):
        style = _v(g, C + "scatterStyle", "marker")
        x_id, y_id = self._cat_val_axes(g)
        xfmt0 = next((f for f in (self.read_data(s.find(C + "xVal"))[1] for s in sers) if f), None)
        xi = self._axis_for(x_id, "x", "value", val_fmt=xfmt0)
        ys = [self._values(s, "yVal") for s in sers]
        yi = self._axis_for(y_id, "y", "value", val_fmt=next((f for _, f in ys if f), None))
        all_sizes = []
        if bubble:
            for s in sers:
                all_sizes += [v for v in self._values(s, "bubbleSize")[0] if isinstance(v, (int, float))]
        smax = max([abs(x) for x in all_sizes] + [1])
        scale = _v(g, C + "bubbleScale", 100, int) / 100
        for i, (s, (yv, fmt)) in enumerate(zip(sers, ys)):
            xv, xfmt, xtext = self.read_data(s.find(C + "xVal"))
            if not xv or xtext:
                xv = list(range(1, len(yv) + 1))
            data = [[x, y] for x, y in zip(xv, yv)]
            color, w, nol, dash = self._series_color(s, line=True)
            fill = fill_color(s.find(C + "spPr"), self.theme)
            e: Dict[str, Any] = {"name": self._series_name(s, i), "xAxisIndex": xi, "yAxisIndex": yi}
            if bubble:
                sz = self._values(s, "bubbleSize")[0]
                pts = []
                for (x, y), b in zip(data, sz):
                    b = b or 0
                    r = math.sqrt(abs(b) / smax) * 60 * scale if _v(g, C + "sizeRepresents", "area") == "area" else abs(b) / smax * 60 * scale
                    pts.append({"value": [x, y, b], "symbolSize": round(max(r, 2), 2)})
                e.update(type="scatter", data=pts, itemStyle={"color": fill or self._auto_color(_v(s, C + "idx", i, int)), "opacity": 0.85,
                                                              "borderColor": "#FFFFFF", "borderWidth": 0.5})
            else:
                show_line = style in ("line", "smooth", "lineMarker", "smoothMarker") and not nol
                if style in ("lineMarker", "smoothMarker") and s.find(C + "spPr") is None and False:
                    show_line = True
                mk = self._marker(s, style not in ("line", "smooth"), i)
                if show_line:
                    e.update(type="line", data=data, lineStyle={"color": color, "width": w or 2.67, **({"type": dash} if dash else {})},
                             itemStyle={"color": color})
                    if mk:
                        e.update(symbol=mk[0], symbolSize=mk[1], showSymbol=True)
                        if mk[2]:
                            e["itemStyle"]["color"] = mk[2]
                    else:
                        e.update(symbol="none", showSymbol=False)
                    if _bool(s, C + "smooth", default=style.startswith("smooth")):
                        e["smooth"] = True
                else:
                    shape, size, mcol = mk or ("circle", 8, None)
                    e.update(type="scatter", data=data, symbol=shape, symbolSize=size,
                             itemStyle={"color": mcol or fill or self._auto_color(_v(s, C + "idx", i, int))})
            lab = self._labels(g, s, "scatter", fmt)
            if lab:
                rng = lab.pop("_range", None)
                if rng is not None and not bubble:
                    e["data"] = [{"name": rng[k] if k < len(rng) and rng[k] is not None else "", "value": p} for k, p in enumerate(e["data"])]
                e["label"] = lab
            xcode = self.date_axes.get(("x", xi))
            if xcode:
                self.tip_fmt[id(e)] = ("date", xcode)
            tl = s.find(C + "trendline")
            if tl is not None and _v(tl, C + "trendlineType") == "linear":
                e["markLine"] = self._trend(data, color)
            self.option["series"].append(e)
            xs_ = [p[0] for p in data]
            ys_ = [p[1] for p in data]
            self._err_bars(s, e, xs_, ys_, ys_, "xy")
            self._trendlines(s, e, xs_, ys_, color, False)

    def _trend(self, data, color):
        pts = [(x, y) for x, y in data if isinstance(x, (int, float)) and isinstance(y, (int, float))]
        if len(pts) < 2:
            return None
        n = len(pts)
        sx = fsum(p[0] for p in pts); sy = fsum(p[1] for p in pts)
        sxx = fsum(p[0] ** 2 for p in pts); sxy = fsum(p[0] * p[1] for p in pts)
        den = n * sxx - sx * sx
        if not den:
            return None
        k = (n * sxy - sx * sy) / den
        b = (sy - k * sx) / n
        x0, x1 = min(p[0] for p in pts), max(p[0] for p in pts)
        return {"silent": True, "symbol": "none", "lineStyle": {"color": color, "type": "dashed"},
                "data": [[{"coord": [x0, sig(k * x0 + b)]}, {"coord": [x1, sig(k * x1 + b)]}]]}

    # ---------- error bars ----------
    def _err_bars(self, s, parent, xs, vals, centers, mode, horizontal=False, ys=None):
        """mode 'cat': bar/line (x = category index or time); 'xy': scatter (xs/vals = x and y values)."""
        for eb in s.findall(C + "errBars"):
            d = _v(eb, C + "errDir", "y")
            if mode == "cat":
                d = "x" if horizontal else "y"
            if mode == "cat":
                base, cen = vals, centers
            elif d == "x":
                base, cen = xs, xs
            else:
                base, cen = vals, vals
            amts = self._err_amounts(eb, base)
            if amts is None:
                continue
            m_list, p_list, mean_c = amts
            data = []
            for j in range(len(base)):
                c = cen[j] if j < len(cen) else None
                if j >= len(xs):
                    continue
                if not isinstance(c, (int, float)) or not isinstance(base[j], (int, float)):
                    continue
                if mean_c is not None:
                    c = mean_c
                lo, hi = sig(c - m_list[j]), sig(c + p_list[j])
                if mode == "cat":
                    item = [sig(c), j, lo, hi] if horizontal else [xs[j], sig(c), lo, hi]
                else:
                    item = [xs[j], vals[j], lo, hi]
                data.append(item)
            col, w, nol, dash = line_props(eb.find(C + "spPr"), self.theme)
            vert = d != "x"
            cs = {"name": parent.get("name"), "type": "custom", "x-renderItem": "errorBar",
                  "x-cfg": {"dir": "v" if vert else "h", "cap": not _bool(eb, C + "noEndCap"),
                            "color": col or ("#595959" if self.modern else "#000000"), "width": w or 1},
                  "xAxisIndex": parent.get("xAxisIndex", 0), "yAxisIndex": parent.get("yAxisIndex", 0),
                  "data": data, "encode": {"x": [0], "y": [1, 2, 3]} if vert else {"x": [0, 2, 3], "y": [1]},
                  "z": 5, "silent": True, "tooltip": {"show": False}}
            self.err_pending.append((cs, parent if parent.get("type") == "bar" else None))

    def _err_amounts(self, eb, base):
        typ = _v(eb, C + "errValType", "fixedVal")
        bt = _v(eb, C + "errBarType", "both")
        val = _v(eb, C + "val", 5.0 if typ == "percentage" else 1.0, float)
        nums = [v for v in base if isinstance(v, (int, float))]
        n = len(base)
        mean_c = None
        if typ == "cust":
            pv, _, _ = self.read_data(eb.find(C + "plus"))
            mv, _, _ = self.read_data(eb.find(C + "minus"))

            def pick(arr, j):
                if len(arr) == 1:
                    x = arr[0]
                else:
                    x = arr[j] if j < len(arr) else None
                return x if isinstance(x, (int, float)) else 0.0
            p = [pick(pv, j) for j in range(n)]
            m = [pick(mv, j) for j in range(n)]
        else:
            if typ == "fixedVal":
                amt = [val] * n
            elif typ == "percentage":
                amt = [abs(v) * val / 100 if isinstance(v, (int, float)) else 0.0 for v in base]
            elif typ in ("stdDev", "stdErr"):
                if len(nums) < 2:
                    return None
                sd = stdev(nums)
                if typ == "stdDev":
                    amt = [val * sd] * n
                    mean_c = mean(nums)
                else:
                    amt = [sd / math.sqrt(len(nums))] * n
            else:
                self.warnings.append(f"error bar type {typ!r} not supported")
                return None
            p, m = list(amt), list(amt)
        if bt == "plus":
            m = [0.0] * n
        elif bt == "minus":
            p = [0.0] * n
        return m, p, mean_c

    def _finalize_errbars(self):
        series = self.option["series"]
        for cs, bar in self.err_pending:
            if bar is not None:
                cdim = self.bar_dim.get(id(bar), "x")
                key_ax = cdim + "AxisIndex"
                same = [b for b in series if b.get("type") == "bar" and self.bar_dim.get(id(b)) == cdim
                        and b.get(key_ax, 0) == bar.get(key_ax, 0)]
                keys, cat_gap, gap = [], "20%", "30%"
                for b in same:
                    k = b.get("stack") or ("#%d" % series.index(b))
                    if k not in keys:
                        keys.append(k)
                    if b.get("barCategoryGap") is not None:
                        cat_gap = b["barCategoryGap"]
                    if b.get("barGap") is not None:
                        gap = b["barGap"]
                mykey = bar.get("stack") or ("#%d" % series.index(bar))
                cs["x-cfg"]["bar"] = {"slot": keys.index(mykey), "slots": len(keys),
                                      "catGap": float(cat_gap.rstrip("%")) / 100, "gap": float(gap.rstrip("%")) / 100}
            series.append(cs)

    # ---------- trendlines ----------
    def _trendlines(self, s, parent, xs, ys, color, category):
        sname = parent.get("name")
        for tl in s.findall(C + "trendline"):
            typ = _v(tl, C + "trendlineType", "linear")
            if not category and typ == "linear":
                continue  # scatter linear trendline: markLine (see _trend)
            label = {"linear": "Linear", "exp": "Expon.", "log": "Log.", "poly": "Poly.", "power": "Power",
                     "movingAvg": "Mov. Avg."}.get(typ)
            if label is None:
                self.warnings.append(f"trendline type {typ!r} not supported")
                continue
            period = _v(tl, C + "period", 2, int)
            order = _v(tl, C + "order", 2, int)
            nm = tl.findtext(C + "name")
            if not nm:
                nm = f"{period} per. {label} ({sname})" if typ == "movingAvg" else f"{label} ({sname})"
            if _bool(tl, C + "dispEq") or _bool(tl, C + "dispRSqr"):
                self.warnings.append("trendline equation / R² label is not rendered")
            pts = [(xs[j], ys[j]) for j in range(min(len(xs), len(ys)))
                   if isinstance(xs[j], (int, float)) and isinstance(ys[j], (int, float))]
            data = None
            if typ == "movingAvg":
                if category:
                    data = []
                    for j in range(len(ys)):
                        win = ys[j - period + 1:j + 1] if j >= period - 1 else []
                        ok = len(win) == period and all(isinstance(v, (int, float)) for v in win)
                        data.append(sig(fsum(win) / period) if ok else None)
                else:
                    data = [[sig(pts[j][0]), sig(fsum([p[1] for p in pts[j - period + 1:j + 1]]) / period)]
                            for j in range(period - 1, len(pts))]
            else:
                f = self._trend_fn(typ, pts, order, _v(tl, C + "intercept", None, float))
                if f is None:
                    self.warnings.append(f"{nm}: cannot fit {typ} trendline to this data")
                    continue
                if category:
                    data = [sig(f(float(j + 1))) for j in range(len(ys))]
                else:
                    x0 = min(p[0] for p in pts) - _v(tl, C + "backward", 0.0, float)
                    x1 = max(p[0] for p in pts) + _v(tl, C + "forward", 0.0, float)
                    if typ in ("log", "power") and x0 <= 0:
                        x0 = min(p[0] for p in pts)
                    steps = 1 if typ == "linear" else 40
                    data = []
                    for i in range(steps + 1):
                        x = x0 + (x1 - x0) * i / steps
                        data.append([sig(x), sig(f(x))])
            lc, w, nol, dash = line_props(tl.find(C + "spPr"), self.theme)
            ls = {"color": lc or color, "width": w or 2, "type": dash or ("dotted" if self.modern else "solid")}
            e = {"name": nm, "type": "line", "data": data, "xAxisIndex": parent.get("xAxisIndex", 0),
                 "yAxisIndex": parent.get("yAxisIndex", 0), "symbol": "none", "showSymbol": False,
                 "smooth": typ not in ("linear", "movingAvg") and category, "lineStyle": ls,
                 "itemStyle": {"color": lc or color}, "silent": True, "z": 4, "tooltip": {"show": False}}
            if typ == "movingAvg" or category:
                e["connectNulls"] = False
            self.trend_pending.append(e)

    def _trend_fn(self, typ, pts, order, intercept):
        if len(pts) < 2:
            return None
        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        if typ == "linear":
            if intercept is not None:
                sxx = 0.0
                sxy = 0.0
                for i in range(len(xs)):
                    sxx += xs[i] * xs[i]
                    sxy += xs[i] * (ys[i] - intercept)
                if not sxx:
                    return None
                k = sxy / sxx
                return lambda x: k * x + intercept
            r = linreg(xs, ys)
            if r is None:
                return None
            k, b = r
            return lambda x: k * x + b
        if typ == "exp":
            if any(y <= 0 for y in ys):
                return None
            r = linreg(xs, [math.log(y) for y in ys])
            if r is None:
                return None
            k, b = r
            a = math.exp(b)
            return lambda x: a * math.exp(k * x)
        if typ == "log":
            if any(x <= 0 for x in xs):
                return None
            r = linreg([math.log(x) for x in xs], ys)
            if r is None:
                return None
            k, b = r
            return lambda x: k * math.log(x) + b
        if typ == "power":
            if any(x <= 0 for x in xs) or any(y <= 0 for y in ys):
                return None
            r = linreg([math.log(x) for x in xs], [math.log(y) for y in ys])
            if r is None:
                return None
            k, b = r
            a = math.exp(b)
            return lambda x: a * x ** k
        if typ == "poly":
            coef = polyfit(xs, ys, max(2, min(6, order)))
            if coef is None:
                return None
            return lambda x: polyval(coef, x)
        return None

    def _g_bubbleChart(self, g, sers):
        self._g_scatterChart(g, sers, bubble=True)

    def _g_radarChart(self, g, sers):
        style = _v(g, C + "radarStyle", "marker")
        cat_id, val_id = self._cat_val_axes(g)
        labels, _, _ = self._categories(sers, cat_id)
        vals_all = [self._values(s) for s in sers]
        ax = self.axes.get(val_id, (None, None))[1]
        sc = ax.find(C + "scaling") if ax is not None else None
        mx = _v(sc, C + "max", None, float)
        mn = _v(sc, C + "min", None, float)
        allv = [v for vs, _ in vals_all for v in vs if isinstance(v, (int, float))]
        if mx is None:
            mx = _nice_max(max(allv + [1]))
        if mn is None:
            mn = min(0, min(allv + [0]))
        font = self._font(None, self.base_font["fontSize"] * 3 / 4)
        has_grid = ax is not None and ax.find(C + "majorGridlines") is not None
        self.option["radar"] = {"indicator": [{"name": l, "max": mx, "min": mn} for l in labels],
                                "radius": "65%", "center": ["50%", "55%"], "shape": "polygon",
                                "splitNumber": 5, "axisName": {"color": font["color"], "fontSize": font["fontSize"]},
                                "splitArea": {"show": False},
                                "splitLine": {"show": has_grid or True, "lineStyle": {"color": "#D9D9D9"}},
                                "axisLine": {"lineStyle": {"color": "#D9D9D9"}}}
        data = []
        for i, (s, (vals, fmt)) in enumerate(zip(sers, vals_all)):
            color, w, nol, dash = self._series_color(s, line=True)
            fill = fill_color(s.find(C + "spPr"), self.theme) or color
            d = {"name": self._series_name(s, i), "value": vals, "itemStyle": {"color": color},
                 "lineStyle": {"color": color, "width": w or 2.67}}
            if style == "filled":
                d["areaStyle"] = {"color": fill, "opacity": 1 if len(sers) == 1 else 0.6}
                d["itemStyle"] = {"color": fill}
                d["symbol"] = "none"
            else:
                mk = self._marker(s, style == "marker", i)
                if mk:
                    d["symbol"], d["symbolSize"] = mk[0], mk[1]
                else:
                    d["symbol"] = "none"
            lab = self._labels(g, s, "line", fmt)
            if lab:
                d["label"] = lab
            data.append(d)
        self.option["series"].append({"type": "radar", "data": data})

    def _g_stockChart(self, g, sers):
        self.warnings.append("stockChart rendered as line series")
        self._g_lineChart(g, sers)

    # ---------- legend ----------
    def _legend(self, lg):
        if lg is None:
            self.option["legend"] = {"show": False}
            return
        pos = _v(lg, C + "legendPos", "r")
        font = self._font(lg.find(C + "txPr"), self.base_font["fontSize"] * 3 / 4)
        e: Dict[str, Any] = {"show": True, "_pos": pos, "textStyle": {"color": font["color"], "fontSize": font["fontSize"]},
                             "itemWidth": 10 if self.pie_like or not self._has_line() else 20, "itemHeight": 10}
        if pos in ("r", "l"):
            e.update(orient="vertical", top="middle", **({"right": 10} if pos == "r" else {"left": 10}))
        elif pos == "tr":
            e.update(orient="vertical", top=40, right=10)
        elif pos == "t":
            e.update(orient="horizontal", top=40 if self.option.get("title") or self.chart_el.find(C + "title") is not None else 8,
                     left="center")
        else:
            e.update(orient="horizontal", bottom=8, left="center")
        mxy = self._manual_xy(lg)
        if mxy:
            for k in ("left", "right", "top", "bottom"):
                e.pop(k, None)
            e["left"], e["top"] = mxy
        deleted = {_v(le, C + "idx", -1, int) for le in lg.findall(C + "legendEntry") if _bool(le, C + "delete")}
        if deleted:
            names = []
            if self.pie_like:
                names = [d["name"] for d in self.option["series"][0]["data"]] if self.option["series"] else []
            else:
                for s in self.option["series"]:
                    if s.get("type") == "radar":
                        names += [d["name"] for d in s["data"]]
                    else:
                        names.append(s["name"])
            e["data"] = [n for i, n in enumerate(names) if i not in deleted]
        self.option["legend"] = e

    def _has_line(self):
        return any(s.get("type") == "line" and "areaStyle" not in s for s in self.option["series"])


def _nice_max(v):
    if v <= 0:
        return 1
    p = 10 ** math.floor(math.log10(v))
    for m in (1, 2, 2.5, 5, 10):
        if v <= m * p:
            return m * p
    return 10 * p


# ---------- anchors ----------
def _anchor(sheet, anc):
    tag = anc.tag.split("}")[1]
    fr, to = anc.find(XDR + "from"), anc.find(XDR + "to")

    def pos(el):
        c = int(el.findtext(XDR + "col")); co = int(el.findtext(XDR + "colOff") or 0)
        r = int(el.findtext(XDR + "row")); ro = int(el.findtext(XDR + "rowOff") or 0)
        return c, co, r, ro

    if tag == "twoCellAnchor" and fr is not None and to is not None:
        c1, co1, r1, ro1 = pos(fr)
        c2, co2, r2, ro2 = pos(to)
        w = sum(sheet.col_px(c + 1) for c in range(c1, c2)) - co1 / EMU_PX + co2 / EMU_PX
        h = sum(sheet.row_px(r + 1) for r in range(r1, r2)) - ro1 / EMU_PX + ro2 / EMU_PX
        return f"{num2col(c1 + 1)}{r1 + 1}:{num2col(c2 + 1)}{r2 + 1}", round(w), round(h)
    ext = anc.find(XDR + "ext")
    w = int(ext.get("cx")) / EMU_PX if ext is not None else 480
    h = int(ext.get("cy")) / EMU_PX if ext is not None else 288
    if fr is not None:
        c1, _, r1, _ = pos(fr)
        return f"{num2col(c1 + 1)}{r1 + 1}", round(w), round(h)
    return None, round(w), round(h)


def convert_xlsx(src, excel_compat: bool = True, geojson=None) -> Dict[str, Any]:
    """src: path, bytes or file-like. geojson: optional FeatureCollection (dict, JSON text or path) used for
    regionMap charts instead of the bundled China / world maps. Returns {"charts": [...], "warnings": [...], ...}"""
    if isinstance(src, (bytes, bytearray)):
        src = io.BytesIO(src)
    wb = Workbook(src)
    wb.geojson = _load_geojson(geojson)
    charts, warnings = [], []
    seen = set()
    for sh in wb.sheet_order:
        rels = wb.rels(sh.part)
        for rid, (dpart, typ) in rels.items():
            if typ != "drawing" or dpart not in wb.z.namelist():
                continue
            droot = wb.xml(dpart)
            drels = wb.rels(dpart)
            for anc in _anchors(droot):
                for gf in anc.iter(f"{{{NS['c']}}}chart"):
                    crid = gf.get(R_ID)
                    if crid not in drels:
                        continue
                    cpart = drels[crid][0]
                    seen.add(cpart)
                    name_el = anc.find(f".//{XDR}cNvPr")
                    if sh.kind == "chartsheet":
                        anchor, w, h = None, 900, 560
                    else:
                        if sh.kind == "worksheet":
                            sh.cells  # load col widths
                        anchor, w, h = _anchor(sh, anc)
                    charts.append(_one(wb, cpart, sh.name, anchor, w, h,
                                       name_el.get("name") if name_el is not None else None, excel_compat))
                for gf in anc.iter(f"{{{CXNS}}}chart"):
                    crid = gf.get(R_ID)
                    if crid not in drels:
                        continue
                    cpart = drels[crid][0]
                    seen.add(cpart)
                    name_el = anc.find(f".//{XDR}cNvPr")
                    if sh.kind == "chartsheet":
                        anchor, w, h = None, 900, 560
                    else:
                        if sh.kind == "worksheet":
                            sh.cells
                        anchor, w, h = _anchor(sh, anc)
                    charts.append(_one(wb, cpart, sh.name, anchor, w, h,
                                       name_el.get("name") if name_el is not None else None, excel_compat, ex=True))
    for name in wb.z.namelist():
        if re.match(r"xl/charts/chart(Ex)?\d+\.xml$", name) and name not in seen:
            charts.append(_one(wb, name, None, None, 600, 360, None, excel_compat, ex="chartEx" in name))
    for i, c in enumerate(charts):
        c["index"] = i
    if wb.failed_formulas:
        warnings.append(f"{len(wb.failed_formulas)} formula(s) could not be evaluated: " + "; ".join(wb.failed_formulas[:5]))
    return _js({"charts": charts, "warnings": warnings, "sheets": [s.name for s in wb.sheet_order],
                "evaluatedFormulas": wb.evaluated_formulas})


def _load_geojson(g):
    if g is None or isinstance(g, dict):
        return g
    import json as _json
    if isinstance(g, (bytes, bytearray)):
        g = g.decode("utf-8")
    if isinstance(g, str) and not g.lstrip().startswith("{"):
        with open(g, encoding="utf-8") as f:
            return _json.load(f)
    return _json.loads(g)


MC = "{http://schemas.openxmlformats.org/markup-compatibility/2006}"


def _anchors(droot):
    """drawing anchors; anchors wrapped in mc:AlternateContent use the mc:Choice branch"""
    out = []
    for a in droot:
        if a.tag == MC + "AlternateContent":
            ch = a.find(MC + "Choice")
            if ch is None:
                ch = a.find(MC + "Fallback")
            out.extend(list(ch) if ch is not None else [])
        else:
            out.append(a)
    return out


def _js(o):
    """integral floats -> int so json.dumps matches JavaScript's JSON.stringify byte for byte"""
    if isinstance(o, float):
        return int(o) if o.is_integer() and abs(o) < 1e21 else o
    if isinstance(o, dict):
        return {k: _js(v) for k, v in o.items()}
    if isinstance(o, list):
        return [_js(v) for v in o]
    return o


def _one(wb, cpart, sheet, anchor, w, h, name, excel_compat, ex=False):
    try:
        cv = ChartConverter(wb, cpart, excel_compat)
        r = ChartEx(cv, cpart).convert() if ex else cv.convert()
        title = ((r["option"] or {}).get("title") or {}).get("text")
        return {"id": posixpath.splitext(posixpath.basename(cpart))[0], "part": cpart, "sheet": sheet, "anchor": anchor,
                "name": name, "title": title, "width": max(w, 200), "height": max(h, 150), "types": r["types"],
                "usedFormulaFallback": getattr(cv, "used_formula_fallback", False),
                "warnings": r["warnings"], "option": r["option"]}
    except Exception as e:  # keep converting other charts
        return {"id": posixpath.splitext(posixpath.basename(cpart))[0], "part": cpart, "sheet": sheet, "anchor": anchor,
                "name": name, "title": None, "width": w, "height": h, "types": [], "warnings": [f"conversion failed: {e!r}"],
                "option": None}
