"""regionMap support: bundled Natural Earth boundaries (public domain) + region-name matching.
Mirrored 1:1 in ts/src/geo.ts."""
from __future__ import annotations

import json
import os
import re
from typing import Any, Dict, List, Optional, Tuple

_SUFFIXES = ["特别行政区", "维吾尔自治区", "壮族自治区", "回族自治区", "自治区", "省", "市"]
_PUNCT = re.compile(r"[\s.,'’`\"()\-_/·&]+")
CUSTOM_KEYS = ["name", "NAME", "name_zh", "NAME_ZH", "name_en", "NAME_EN", "NAME_LONG", "ADMIN", "iso_a2", "ISO_A2",
               "iso_a3", "ISO_A3", "id", "code"]
_INDEX: Optional[Dict[str, Dict[str, str]]] = None


def norm(s: Any) -> str:
    t = _PUNCT.sub("", str(s).lower())
    for suf in _SUFFIXES:
        if t.endswith(suf) and len(t) > len(suf):
            return t[: -len(suf)]
    return t


def index() -> Dict[str, Dict[str, str]]:
    global _INDEX
    if _INDEX is None:
        with open(os.path.join(os.path.dirname(__file__), "static", "geo", "index.json"), encoding="utf-8") as f:
            _INDEX = json.load(f)
    return _INDEX


def custom_index(geojson: Dict[str, Any]) -> Tuple[Dict[str, str], str]:
    """-> ({normalized alias: feature name}, nameProperty). The first key in CUSTOM_KEYS present on features names them."""
    feats = geojson.get("features") or []
    name_prop = next((k for k in CUSTOM_KEYS if any(k in (f.get("properties") or {}) for f in feats)), "name")
    idx: Dict[str, str] = {}
    for k in CUSTOM_KEYS:
        for f in feats:
            p = f.get("properties") or {}
            nm = p.get(name_prop)
            if p.get(k) is None or nm is None:
                continue
            a = norm(p[k])
            if a and a not in idx:
                idx[a] = str(nm)
    return idx, name_prop


def match(names: List[Any], geojson: Optional[Dict[str, Any]] = None):
    """-> (mapKey, source, nameProperty|None, [feature name|None per input]) or None when nothing matches."""
    cands = []
    if geojson is not None:
        idx, prop = custom_index(geojson)
        cands.append(("x2e-custom", "custom", prop, idx))
    ix = index()
    cands += [("x2e-china", "china", None, ix["china"]), ("x2e-world", "world", None, ix["world"])]
    best = None
    for key, src, prop, idx in cands:
        res = [idx.get(norm(n)) if n is not None else None for n in names]
        hits = sum(1 for r in res if r is not None)
        if hits and (best is None or hits > best[0]):
            best = (hits, (key, src, prop, res))
    return best[1] if best else None
