"""DrawingML colour resolution (srgbClr / schemeClr / sysClr / prstClr + lumMod/lumOff/tint/shade/alpha)."""
from __future__ import annotations

import math
from typing import Dict, Optional

A = "{http://schemas.openxmlformats.org/drawingml/2006/main}"
PRST = {"black": "000000", "white": "FFFFFF", "red": "FF0000", "green": "008000", "blue": "0000FF",
        "yellow": "FFFF00", "gray": "808080", "orange": "FFA500", "purple": "800080"}
SCHEME_ALIAS = {"tx1": "dk1", "bg1": "lt1", "tx2": "dk2", "bg2": "lt2", "phClr": "accent1"}


def _rgb_to_hls(r, g, b):
    """same arithmetic as ts/src/colors.ts (colorsys differs between Python versions)"""
    maxc, minc = max(r, g, b), min(r, g, b)
    sumc, rangec = maxc + minc, maxc - minc
    l = sumc / 2
    if minc == maxc:
        return 0.0, l, 0.0
    s = rangec / sumc if l <= 0.5 else rangec / (2 - maxc - minc)
    rc, gc, bc = (maxc - r) / rangec, (maxc - g) / rangec, (maxc - b) / rangec
    h = bc - gc if r == maxc else (2 + rc - bc if g == maxc else 4 + gc - rc)
    h = math.fmod(math.fmod(h / 6, 1) + 1, 1)
    return h, l, s


def _v(m1, m2, hue):
    hue = math.fmod(math.fmod(hue, 1) + 1, 1)
    if hue < 1 / 6:
        return m1 + (m2 - m1) * hue * 6
    if hue < 0.5:
        return m2
    if hue < 2 / 3:
        return m1 + (m2 - m1) * (2 / 3 - hue) * 6
    return m1


def _hls_to_rgb(h, l, s):
    if s == 0:
        return l, l, l
    m2 = l * (1 + s) if l <= 0.5 else l + s - l * s
    m1 = 2 * l - m2
    return _v(m1, m2, h + 1 / 3), _v(m1, m2, h), _v(m1, m2, h - 1 / 3)


def _clamp(x):
    return max(0.0, min(1.0, x))


def resolve_color(el, theme: Dict[str, str]) -> Optional[str]:
    """el: a colour-choice element (a:srgbClr, a:schemeClr...). Returns '#RRGGBB' or rgba()."""
    if el is None:
        return None
    tag = el.tag.split("}")[-1]
    if tag == "srgbClr":
        hexv = el.get("val")
    elif tag == "schemeClr":
        v = el.get("val")
        hexv = theme.get(SCHEME_ALIAS.get(v, v))
    elif tag == "sysClr":
        hexv = el.get("lastClr") or ("000000" if el.get("val") == "windowText" else "FFFFFF")
    elif tag == "prstClr":
        hexv = PRST.get(el.get("val"), "000000")
    elif tag == "scrgbClr":
        hexv = "%02X%02X%02X" % tuple(int(int(el.get(k, 0)) / 100000 * 255) for k in "rgb")
    else:
        return None
    if not hexv:
        return None
    r, g, b = (int(hexv[i:i + 2], 16) / 255 for i in (0, 2, 4))
    alpha = 1.0
    for mod in el:
        mt, val = mod.tag.split("}")[-1], int(mod.get("val", 0)) / 100000
        if mt in ("lumMod", "lumOff"):
            h, l, s = _rgb_to_hls(r, g, b)
            l = _clamp(l * val) if mt == "lumMod" else _clamp(l + val)
            r, g, b = _hls_to_rgb(h, l, s)
        elif mt == "tint":
            r, g, b = (c + (1 - c) * (1 - val) for c in (r, g, b))
        elif mt == "shade":
            r, g, b = (c * val for c in (r, g, b))
        elif mt == "alpha":
            alpha = val
    rgb = tuple(int(round(_clamp(c) * 255)) for c in (r, g, b))
    if alpha < 0.999:
        return "rgba(%d,%d,%d,%.3g)" % (*rgb, alpha)
    return "#%02X%02X%02X" % rgb


def fill_color(spPr, theme) -> Optional[str]:
    if spPr is None:
        return None
    sf = spPr.find(A + "solidFill")
    if sf is not None and len(sf):
        return resolve_color(sf[0], theme)
    gf = spPr.find(A + "gradFill")
    if gf is not None:
        gs = gf.find(f"{A}gsLst/{A}gs")
        if gs is not None and len(gs):
            return resolve_color(gs[0], theme)
    return None


def no_fill(spPr) -> bool:
    return spPr is not None and spPr.find(A + "noFill") is not None


def line_props(spPr, theme):
    """-> (color|None, width_px|None, noline:bool, dash|None)"""
    if spPr is None:
        return None, None, False, None
    ln = spPr.find(A + "ln")
    if ln is None:
        return None, None, False, None
    if ln.find(A + "noFill") is not None:
        return None, None, True, None
    col = None
    sf = ln.find(A + "solidFill")
    if sf is not None and len(sf):
        col = resolve_color(sf[0], theme)
    w = int(ln.get("w")) / 12700 * 4 / 3 if ln.get("w") else None
    dash = None
    pd = ln.find(A + "prstDash")
    if pd is not None and pd.get("val") not in (None, "solid"):
        dash = "dotted" if "dot" in pd.get("val").lower() and "dash" not in pd.get("val").lower() else "dashed"
    return col, w, False, dash
