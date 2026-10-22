"""Minimal OOXML (SpreadsheetML) reader: sheets, cells, shared strings, number formats,
theme colours and part relationships. stdlib only (zipfile + ElementTree)."""
from __future__ import annotations

import datetime as _dt
import math
import posixpath
import re
import zipfile
import xml.etree.ElementTree as ET
from typing import Any, Dict, Optional, Tuple

from .formula import Evaluator, FormulaError, col2num, shift_formula

NS = {
    "m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "pr": "http://schemas.openxmlformats.org/package/2006/relationships",
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "c": "http://schemas.openxmlformats.org/drawingml/2006/chart",
    "xdr": "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing",
}
R_ID = "{%s}id" % NS["r"]
MAX_PART = 200 * 1024 * 1024  # zip-bomb guard (uncompressed bytes per part)

BUILTIN_FMT = {0: "General", 1: "0", 2: "0.00", 3: "#,##0", 4: "#,##0.00", 9: "0%", 10: "0.00%",
               11: "0.00E+00", 14: "yyyy/m/d", 15: "d-mmm-yy", 16: "d-mmm", 17: "mmm-yy",
               18: "h:mm AM/PM", 19: "h:mm:ss AM/PM", 20: "h:mm", 21: "h:mm:ss", 22: "yyyy/m/d h:mm",
               37: "#,##0 ;(#,##0)", 38: "#,##0 ;[Red](#,##0)", 39: "#,##0.00;(#,##0.00)",
               40: "#,##0.00;[Red](#,##0.00)", 45: "mm:ss", 46: "[h]:mm:ss", 47: "mmss.0", 48: "##0.0E+0", 49: "@",
               # CJK locale built-ins
               27: "yyyy\"年\"m\"月\"", 28: "m\"月\"d\"日\"", 29: "m\"月\"d\"日\"", 30: "m-d-yy",
               31: "yyyy\"年\"m\"月\"d\"日\"", 32: "h\"时\"mm\"分\"", 33: "h\"时\"mm\"分\"ss\"秒\"",
               34: "上午/下午h\"时\"mm\"分\"", 35: "上午/下午h\"时\"mm\"分\"ss\"秒\"", 36: "yyyy\"年\"m\"月\"",
               50: "yyyy\"年\"m\"月\"", 51: "m\"月\"d\"日\"", 52: "yyyy\"年\"m\"月\"", 53: "m\"月\"d\"日\"",
               56: "上午/下午h\"时\"mm\"分\"ss\"秒\"", 57: "yyyy\"年\"m\"月\"", 58: "m\"月\"d\"日\""}


def jnum(x) -> str:
    """number -> string the way JavaScript's String(x) prints it (for cross-language parity)"""
    x = float(x)
    if x.is_integer() and abs(x) < 1e21:
        return str(int(x))
    r = repr(x)
    if "e" in r:
        m, e = r.split("e")
        r = f"{m}e{'+' if not e.startswith('-') else ''}{int(e)}"
    return r


def jstr(v) -> str:
    if v is None:
        return ""
    if isinstance(v, bool):
        return "TRUE" if v else "FALSE"
    if isinstance(v, (int, float)):
        return jnum(v)
    return str(v)


def is_date_format(code: Optional[str]) -> bool:
    if not code or code == "General":
        return False
    s = re.sub(r'"[^"]*"|\\.|\[(?!h\]|m\]|s\])[^\]]*\]', "", code.split(";")[0])
    return bool(re.search(r"[dmyhs]", s, re.I)) and not re.search(r"[0#?]", s)


def serial_to_datetime(v: float, date1904=False) -> _dt.datetime:
    base = _dt.datetime(1904, 1, 1) if date1904 else _dt.datetime(1899, 12, 30)
    if not date1904 and v < 60:
        v += 1  # Excel's fake 1900-02-29
    return base + _dt.timedelta(days=float(v))


def format_date(v: float, code: str, date1904=False) -> str:
    d = serial_to_datetime(v, date1904)
    c = re.sub(r"\[[^\]]*\]", "", (code or "").split(";")[0])
    has_time = bool(re.search(r"h|s", re.sub(r'"[^"]*"', "", c), re.I))
    has_date = bool(re.search(r"[dy]", re.sub(r'"[^"]*"', "", c), re.I)) or ("m" in c.lower() and not has_time)
    out = []
    i, prev_h = 0, False
    lc = c
    while i < len(lc):
        ch = lc[i]
        if ch == '"':
            j = lc.find('"', i + 1)
            j = len(lc) if j < 0 else j
            out.append(lc[i + 1:j]); i = j + 1; continue
        if ch == "\\" and i + 1 < len(lc):
            out.append(lc[i + 1]); i += 2; continue
        m = re.match(r"y+|m+|d+|h+|s+|AM/PM|上午/下午", lc[i:], re.I)
        if m:
            t = m.group(0); tl = t.lower(); i += len(t)
            if tl[0] == "y":
                out.append(str(d.year) if len(t) > 2 else f"{d.year % 100:02d}")
            elif tl[0] == "d":
                out.append({1: str(d.day), 2: f"{d.day:02d}", 3: d.strftime("%a")}.get(len(t), d.strftime("%A")))
            elif tl[0] == "h":
                prev_h = True
                h = d.hour
                if re.search("AM/PM|上午/下午", lc, re.I):
                    h = h % 12 or 12
                out.append(str(h) if len(t) == 1 else f"{h:02d}")
            elif tl[0] == "s":
                out.append(str(d.second) if len(t) == 1 else f"{d.second:02d}")
            elif tl[0] == "m":
                minute = prev_h or re.match(r"[^dy]*s", lc[i:], re.I) and not re.search(r"[dy]", lc[i:i + 3], re.I)
                if minute and len(t) <= 2:
                    out.append(str(d.minute) if len(t) == 1 else f"{d.minute:02d}")
                else:
                    out.append({1: str(d.month), 2: f"{d.month:02d}", 3: d.strftime("%b")}.get(len(t), d.strftime("%B")))
                prev_h = False
            elif tl == "am/pm":
                out.append("AM" if d.hour < 12 else "PM")
            else:
                out.append("上午" if d.hour < 12 else "下午")
            continue
        if ch not in "_*":
            out.append(ch)
        else:
            i += 1
        i += 1
    s = "".join(out).strip()
    if not s or not (has_date or has_time):
        s = d.strftime("%Y-%m-%d") if d.time() == _dt.time() else d.strftime("%Y-%m-%d %H:%M")
    return s


def _fixed_half_up(x: float, dec: int) -> str:
    """Excel-style rounding (half away from zero) on the shortest decimal repr — same as the TS port."""
    from decimal import Decimal, ROUND_HALF_UP
    q = Decimal(repr(abs(float(x)))).quantize(Decimal(1).scaleb(-dec), rounding=ROUND_HALF_UP)
    body = f"{q:.{dec}f}"
    if x < 0 and any(ch not in "0." for ch in body):
        body = "-" + body
    return body


def format_number(v: Any, code: Optional[str]) -> str:
    """Very small subset of Excel number formatting for category labels."""
    if not isinstance(v, (int, float)) or isinstance(v, bool):
        return jstr(v)
    if not code or code in ("General", "@"):
        return jnum(float(f"{v:.10f}")) if abs(v) < 1e15 else jnum(v)
    sec = code.split(";")
    c = sec[1] if v < 0 and len(sec) > 1 else sec[0]
    neg = v < 0 and len(sec) > 1
    c = re.sub(r"\[[^\]]*\]|_.|\*.|\\|\"", "", c)
    pct = "%" in c
    x = v * 100 if pct else v
    if neg:
        x = abs(x)
    m = re.search(r"[0#]+(?:[.,][0#]+)*", c)
    if not m:
        return jnum(v)
    pat = m.group(0)
    dec = len(pat.split(".")[1]) if "." in pat else 0
    body = _fixed_half_up(x, dec)
    if "," in pat.split(".")[0]:
        ip, _, fp = body.partition(".")
        sign = "-" if ip.startswith("-") else ""
        ip = f"{int(ip.lstrip('-')):,}"
        body = sign + ip + ("." + fp if fp else "")
    return c[:m.start()] + body + c[m.end():]


def _rels(z: zipfile.ZipFile, part: str) -> Dict[str, Tuple[str, str]]:
    d, b = posixpath.split(part)
    rp = posixpath.join(d, "_rels", b + ".rels")
    out = {}
    if rp not in z.namelist():
        return out
    for rel in ET.fromstring(read(z, rp)).findall("pr:Relationship", NS):
        tgt = rel.get("Target", "")
        if rel.get("TargetMode") == "External":
            continue
        full = tgt.lstrip("/") if tgt.startswith("/") else posixpath.normpath(posixpath.join(d, tgt))
        out[rel.get("Id")] = (full, rel.get("Type", "").rsplit("/", 1)[-1])
    return out


def read(z: zipfile.ZipFile, name: str) -> bytes:
    info = z.getinfo(name)
    if info.file_size > MAX_PART:
        raise ValueError(f"part {name} too large")
    return z.read(name)


class Sheet:
    def __init__(self, wb: "Workbook", name: str, part: str):
        self.wb, self.name, self.part = wb, name, part
        self._cells: Optional[Dict[Tuple[int, int], list]] = None  # (r,c) -> [value, formula, style]
        self.col_widths: Dict[int, float] = {}
        self.row_heights: Dict[int, float] = {}
        self.default_col_width = 8.43
        self.default_row_height = 15.0

    @property
    def cells(self):
        if self._cells is None:
            self._load()
        return self._cells

    def _load(self):
        self._cells = {}
        root = ET.fromstring(read(self.wb.z, self.part))
        m = "{%s}" % NS["m"]
        fmt = root.find(m + "sheetFormatPr")
        if fmt is not None:
            if fmt.get("defaultColWidth"):
                self.default_col_width = float(fmt.get("defaultColWidth"))
            elif fmt.get("baseColWidth"):
                self.default_col_width = float(fmt.get("baseColWidth")) + 0.71
            if fmt.get("defaultRowHeight"):
                self.default_row_height = float(fmt.get("defaultRowHeight"))
        for col in root.iter(m + "col"):
            if col.get("width"):
                for i in range(int(col.get("min")), min(int(col.get("max")), 300) + 1):
                    self.col_widths[i] = float(col.get("width"))
        shared: Dict[str, Tuple[str, int, int]] = {}
        sd = root.find(m + "sheetData")
        if sd is None:
            return
        for row in sd.findall(m + "row"):
            rn = int(row.get("r", 0) or 0)
            if row.get("ht"):
                self.row_heights[rn] = float(row.get("ht"))
            cn = 0
            for c in row.findall(m + "c"):
                ref = c.get("r")
                if ref:
                    mm = re.match(r"([A-Z]+)(\d+)", ref)
                    cn, rn = col2num(mm.group(1)), int(mm.group(2))
                else:
                    cn += 1
                t = c.get("t", "n")
                s = int(c.get("s", 0) or 0)
                ve = c.find(m + "v")
                fe = c.find(m + "f")
                val: Any = None
                if t == "inlineStr":
                    ie = c.find(m + "is")
                    val = "".join(x.text or "" for x in ie.iter(m + "t")) if ie is not None else ""
                elif ve is not None and ve.text is not None:
                    txt = ve.text
                    if t == "s":
                        try:
                            val = self.wb.shared_strings[int(txt)]
                        except (ValueError, IndexError):
                            val = None
                    elif t in ("str", "e"):
                        val = txt if t == "str" else None
                    elif t == "b":
                        val = txt == "1"
                    else:
                        try:
                            val = float(txt)
                        except ValueError:
                            val = txt
                formula = None
                if fe is not None:
                    if fe.get("t") == "shared" and fe.get("si") is not None:
                        si = fe.get("si")
                        if fe.text:
                            shared[si] = (fe.text, rn, cn)
                            formula = fe.text
                        elif si in shared:
                            f0, r0, c0 = shared[si]
                            formula = shift_formula(f0, rn - r0, cn - c0)
                    elif fe.text and fe.get("t") != "array":
                        formula = fe.text
                    elif fe.text:
                        formula = fe.text
                has_cache = ve is not None and ve.text is not None or t == "inlineStr"
                self._cells[(rn, cn)] = [val, None if has_cache else formula, s]

    def col_px(self, c: int) -> float:
        w = self.col_widths.get(c, self.default_col_width)
        return int(w * 7 + 5) if w > 0 else 0

    def row_px(self, r: int) -> float:
        return self.row_heights.get(r, self.default_row_height) * 4 / 3


class Workbook:
    def __init__(self, path_or_file):
        self.z = zipfile.ZipFile(path_or_file)
        self.shared_strings = self._load_sst()
        self.numfmts, self.xf_fmt = self._load_styles()
        self.theme = self._load_theme()
        self.sheets: Dict[str, Sheet] = {}
        self.sheet_order = []
        self.date1904 = False
        self.defined_names: Dict[str, str] = {}
        self._load_workbook()
        self._evaluating = set()
        self._memo: Dict[Tuple[str, int, int], Any] = {}
        self.evaluated_formulas = 0
        self.failed_formulas: list = []

    # ---------- parts ----------
    def _load_sst(self):
        p = "xl/sharedStrings.xml"
        if p not in self.z.namelist():
            # some writers use a different name; resolve through workbook rels
            return []
        out = []
        root = ET.fromstring(read(self.z, p))
        m = "{%s}" % NS["m"]
        for si in root.findall(m + "si"):
            out.append("".join(t.text or "" for t in si.iter(m + "t") if not _in_rph(si, t)))
        return out

    def _load_styles(self):
        p = "xl/styles.xml"
        fmts = dict(BUILTIN_FMT)
        xf = []
        if p in self.z.namelist():
            root = ET.fromstring(read(self.z, p))
            m = "{%s}" % NS["m"]
            nf = root.find(m + "numFmts")
            if nf is not None:
                for f in nf.findall(m + "numFmt"):
                    fmts[int(f.get("numFmtId"))] = f.get("formatCode")
            cx = root.find(m + "cellXfs")
            if cx is not None:
                xf = [int(x.get("numFmtId", 0) or 0) for x in cx.findall(m + "xf")]
        return fmts, xf

    def _load_theme(self):
        colors = {"dk1": "000000", "lt1": "FFFFFF", "dk2": "44546A", "lt2": "E7E6E6",
                  "accent1": "4472C4", "accent2": "ED7D31", "accent3": "A5A5A5", "accent4": "FFC000",
                  "accent5": "5B9BD5", "accent6": "70AD47", "hlink": "0563C1", "folHlink": "954F72"}
        for name in self.z.namelist():
            if re.match(r"xl/theme/theme\d*\.xml$", name):
                root = ET.fromstring(read(self.z, name))
                cs = root.find(".//a:clrScheme", NS)
                if cs is not None:
                    for el in cs:
                        tag = el.tag.split("}")[1]
                        for sub in el:
                            v = sub.get("val") if sub.tag.endswith("srgbClr") else sub.get("lastClr")
                            if v:
                                colors[tag] = v
                break
        return colors

    def _load_workbook(self):
        root = ET.fromstring(read(self.z, "xl/workbook.xml"))
        rels = _rels(self.z, "xl/workbook.xml")
        pr = root.find("m:workbookPr", NS)
        if pr is not None and pr.get("date1904") in ("1", "true"):
            self.date1904 = True
        for s in root.findall("m:sheets/m:sheet", NS):
            rid = s.get(R_ID)
            if rid in rels:
                part, typ = rels[rid]
                sh = Sheet(self, s.get("name"), part)
                sh.kind = typ
                sh.state = s.get("state", "visible")
                self.sheets[s.get("name")] = sh
                self.sheet_order.append(sh)
        for dn in root.findall("m:definedNames/m:definedName", NS):
            if dn.text and dn.get("localSheetId") is None:
                self.defined_names[dn.get("name")] = dn.text

    def rels(self, part):
        return _rels(self.z, part)

    def xml(self, part):
        return ET.fromstring(read(self.z, part))

    # ---------- values ----------
    def numfmt(self, style_idx: int) -> str:
        try:
            return self.numfmts.get(self.xf_fmt[style_idx], "General")
        except IndexError:
            return "General"

    def sheet(self, name: str) -> Optional[Sheet]:
        if name in self.sheets:
            return self.sheets[name]
        low = {k.lower(): v for k, v in self.sheets.items()}
        return low.get((name or "").lower())

    def value(self, sheet_name: str, r: int, c: int):
        sh = self.sheet(sheet_name)
        if sh is None or sh.kind != "worksheet":
            return None
        cell = sh.cells.get((r, c))
        if cell is None:
            return None
        val, formula, _ = cell
        if formula is None:
            return val
        key = (sh.name, r, c)
        if key in self._memo:
            return self._memo[key]
        if key in self._evaluating or len(self._evaluating) > 200:
            raise FormulaError("#CIRC!")
        self._evaluating.add(key)
        try:
            v = Evaluator(self.value).evaluate(formula, sh.name)
            if isinstance(v, bool):
                pass
            self.evaluated_formulas += 1
        except (FormulaError, ZeroDivisionError, ValueError, TypeError, OverflowError, RecursionError) as e:
            msg = str(e) if isinstance(e, FormulaError) else ("maximum recursion depth exceeded" if isinstance(e, RecursionError) else "#VALUE!")
            self.failed_formulas.append(f"{sh.name}!{_a1(r, c)}: ={formula} ({msg})")
            v = None
        finally:
            self._evaluating.discard(key)
        if isinstance(v, float) and not math.isfinite(v):
            v = None
        self._memo[key] = v
        return v

    def style(self, sheet_name: str, r: int, c: int) -> str:
        sh = self.sheet(sheet_name)
        if sh is None:
            return "General"
        cell = sh.cells.get((r, c))
        return self.numfmt(cell[2]) if cell else "General"


def _a1(r, c):
    from .formula import num2col
    return f"{num2col(c)}{r}"


def _in_rph(si, t):
    # skip phonetic runs (rPh) in shared strings
    for rph in si.findall("{%s}rPh" % NS["m"]):
        if t in list(rph.iter()):
            return True
    return False
