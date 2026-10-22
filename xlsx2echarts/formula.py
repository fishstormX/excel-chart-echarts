"""Tiny Excel formula evaluator — used only when a chart references cells whose
cached value is missing (e.g. files written by openpyxl / pandas without recalculation).
Supports arithmetic, comparison, &, references/ranges (incl. other sheets) and common
functions: SUM SUMIF(S) COUNT COUNTA COUNTIF(S) AVERAGE AVERAGEIF(S) MIN MAX IF IFERROR
ROUND ROUNDUP ROUNDDOWN ABS AND OR NOT CONCAT(ENATE) LEN UPPER LOWER INT MOD PRODUCT.
Anything unsupported evaluates to None (rendered as a gap)."""
from __future__ import annotations

import math
import re
from typing import Any, Callable, List, Optional

TOKEN = re.compile(r"""
 (?P<ws>\s+)
|(?P<str>"(?:[^"]|"")*")
|(?P<ref>(?:(?:'(?:[^']|'')+'|[A-Za-z_][\w\.]*)!)?\$?[A-Za-z]{1,3}\$?\d+(?::\$?[A-Za-z]{1,3}\$?\d+)?)
|(?P<num>\d+(?:\.\d*)?(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)
|(?P<bool>TRUE|FALSE)(?![\w(])
|(?P<func>[A-Za-z_][\w\.]*)\(
|(?P<op><>|<=|>=|[-+*/^&=<>%])
|(?P<p>[(),;])
""", re.X | re.I)


class FormulaError(Exception):
    pass


def col2num(s: str) -> int:
    n = 0
    for ch in s.upper():
        n = n * 26 + ord(ch) - 64
    return n


def num2col(n: int) -> str:
    s = ""
    while n:
        n, r = divmod(n - 1, 26)
        s = chr(65 + r) + s
    return s


REF1 = re.compile(r"\$?([A-Za-z]{1,3})\$?(\d+)")


def split_ref(ref: str):
    """'Sheet 1'!$A$1:$B$3 -> (sheet|None, r1, c1, r2, c2)"""
    sheet = None
    if "!" in ref:
        sheet, ref = ref.rsplit("!", 1)
        if sheet.startswith("'"):
            sheet = sheet[1:-1].replace("''", "'")
    parts = ref.split(":")
    m1 = REF1.fullmatch(parts[0])
    m2 = REF1.fullmatch(parts[-1])
    if not m1 or not m2:
        raise FormulaError(ref)
    r1, c1, r2, c2 = int(m1.group(2)), col2num(m1.group(1)), int(m2.group(2)), col2num(m2.group(1))
    return sheet, min(r1, r2), min(c1, c2), max(r1, r2), max(c1, c2)


def tokenize(src: str):
    out, pos = [], 0
    while pos < len(src):
        m = TOKEN.match(src, pos)
        if not m:
            raise FormulaError(f"cannot parse at {src[pos:pos+10]!r}")
        pos = m.end()
        k = m.lastgroup
        if k == "ws":
            continue
        v = m.group(k)
        if k == "func":
            v = v.upper()
            if v.startswith("_XLFN."):
                v = v[6:]
        out.append((k, v))
    return out


class Range(list):
    """flattened 2D list of values; keeps shape"""
    def __init__(self, vals, rows, cols):
        super().__init__(vals)
        self.rows, self.cols = rows, cols


def _num(v) -> float:
    if v is None or v == "":
        return 0.0
    if isinstance(v, bool):
        return float(v)
    if isinstance(v, (int, float)):
        return float(v)
    try:
        return float(v)
    except (TypeError, ValueError):
        raise FormulaError(f"#VALUE! {v!r}")


def _flat(args):
    for a in args:
        if isinstance(a, list):
            for x in a:
                yield x
        else:
            yield a


def _numbers(args):
    return [float(x) for x in _flat(args) if isinstance(x, (int, float)) and not isinstance(x, bool)]


def _criteria(c) -> Callable[[Any], bool]:
    if isinstance(c, (int, float)) and not isinstance(c, bool):
        return lambda v: isinstance(v, (int, float)) and not isinstance(v, bool) and float(v) == float(c)
    s = "" if c is None else str(c)
    m = re.match(r"(<>|<=|>=|=|<|>)?(.*)", s, re.S)
    op, rhs = m.group(1) or "=", m.group(2)
    try:
        rn = float(rhs)
    except ValueError:
        rn = None
    if rn is not None:
        def f(v):
            if not isinstance(v, (int, float)) or isinstance(v, bool):
                return op == "<>"
            v = float(v)
            return {"=": v == rn, "<>": v != rn, "<": v < rn, ">": v > rn, "<=": v <= rn, ">=": v >= rn}[op]
        return f
    pat = re.compile("^" + re.escape(rhs.lower()).replace(r"\*", ".*").replace(r"\?", ".").replace("~.*", r"\*") + "$", re.S)
    def g(v):
        sv = "" if v is None else (str(v).upper() if isinstance(v, bool) else str(v)).lower()
        if isinstance(v, float) and v.is_integer():
            sv = str(int(v))
        hit = bool(pat.match(sv)) if rhs else (v is None or v == "")
        if op == "=":
            return hit
        if op == "<>":
            return not hit
        return False
    return g


def _ifs(sum_rng, pairs):
    idx = None
    for rng, crit in pairs:
        f = _criteria(crit)
        ok = {i for i, v in enumerate(rng) if f(v)}
        idx = ok if idx is None else idx & ok
    return sorted(idx or [])


def _round(x, d, mode):
    x, d = _num(x), int(_num(d))
    k = 10 ** d
    if mode == 0:
        return math.floor(abs(x) * k + 0.5) / k * (1 if x >= 0 else -1)
    if mode > 0:
        return math.ceil(abs(x) * k - 1e-12) / k * (1 if x >= 0 else -1)
    return math.floor(abs(x) * k + 1e-12) / k * (1 if x >= 0 else -1)


def _avg(xs):
    if not xs:
        raise FormulaError("#DIV/0!")
    return sum(xs) / len(xs)


FUNCS = {
    "SUM": lambda *a: sum(_numbers(a)),
    "PRODUCT": lambda *a: math.prod(_numbers(a)),
    "COUNT": lambda *a: len(_numbers(a)),
    "COUNTA": lambda *a: sum(1 for x in _flat(a) if x not in (None, "")),
    "AVERAGE": lambda *a: _avg(_numbers(a)),
    "MIN": lambda *a: min(_numbers(a) or [0]),
    "MAX": lambda *a: max(_numbers(a) or [0]),
    "ABS": lambda x: abs(_num(x)),
    "INT": lambda x: math.floor(_num(x)),
    "MOD": lambda a, b: _num(a) % _num(b),
    "ROUND": lambda x, d=0: _round(x, d, 0),
    "ROUNDUP": lambda x, d=0: _round(x, d, 1),
    "ROUNDDOWN": lambda x, d=0: _round(x, d, -1),
    "IF": lambda c, a=True, b=False: a if (_num(c) if not isinstance(c, str) else bool(c)) else b,
    "AND": lambda *a: all(_num(x) for x in _flat(a)),
    "OR": lambda *a: any(_num(x) for x in _flat(a)),
    "NOT": lambda x: not _num(x),
    "LEN": lambda x: len("" if x is None else str(x)),
    "UPPER": lambda x: str(x or "").upper(),
    "LOWER": lambda x: str(x or "").lower(),
    "CONCATENATE": lambda *a: "".join(_txt(x) for x in _flat(a)),
    "CONCAT": lambda *a: "".join(_txt(x) for x in _flat(a)),
    "SUMIF": lambda r, c, s=None: sum(_num((s if s is not None else r)[i]) for i in _ifs(None, [(r, c)])
                                     if isinstance((s if s is not None else r)[i], (int, float))),
    "SUMIFS": lambda s, *p: sum(float(s[i]) for i in _ifs(s, list(zip(p[::2], p[1::2])))
                                if isinstance(s[i], (int, float)) and not isinstance(s[i], bool)),
    "COUNTIF": lambda r, c: len(_ifs(None, [(r, c)])),
    "COUNTIFS": lambda *p: len(_ifs(None, list(zip(p[::2], p[1::2])))),
    "AVERAGEIF": lambda r, c, s=None: _avg([float((s if s is not None else r)[i]) for i in _ifs(None, [(r, c)])
                                            if isinstance((s if s is not None else r)[i], (int, float))]),
    "AVERAGEIFS": lambda s, *p: _avg([float(s[i]) for i in _ifs(s, list(zip(p[::2], p[1::2])))
                                      if isinstance(s[i], (int, float))]),
}
LAZY = {"IFERROR"}


def _txt(v):
    if v is None:
        return ""
    if isinstance(v, bool):
        return "TRUE" if v else "FALSE"
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v)


class Evaluator:
    """resolve(sheet, row, col) -> value ; called for references."""

    def __init__(self, resolve: Callable[[str, int, int], Any]):
        self.resolve = resolve

    def evaluate(self, formula: str, sheet: str):
        self.toks, self.i, self.sheet = tokenize(formula.lstrip("=")), 0, sheet
        v = self.expr()
        if self.i != len(self.toks):
            raise FormulaError("trailing tokens")
        if isinstance(v, list):
            v = v[0] if v else None
        return v

    # --- recursive descent ---
    def peek(self):
        return self.toks[self.i] if self.i < len(self.toks) else (None, None)

    def take(self):
        t = self.peek()
        self.i += 1
        return t

    def expr(self):
        a = self.concat()
        while self.peek()[0] == "op" and self.peek()[1] in ("=", "<>", "<", ">", "<=", ">="):
            op = self.take()[1]
            b = self.concat()
            a, b = self._scalar(a), self._scalar(b)
            if isinstance(a, str) or isinstance(b, str):
                x, y = _txt(a).lower(), _txt(b).lower()
            else:
                x, y = _num(a), _num(b)
            a = {"=": x == y, "<>": x != y, "<": x < y, ">": x > y, "<=": x <= y, ">=": x >= y}[op]
        return a

    def concat(self):
        a = self.add()
        while self.peek() == ("op", "&"):
            self.take()
            a = _txt(self._scalar(a)) + _txt(self._scalar(self.add()))
        return a

    def add(self):
        a = self.mul()
        while self.peek()[0] == "op" and self.peek()[1] in "+-" and self.peek()[1] != "":
            op = self.take()[1]
            b = self.mul()
            a = _num(self._scalar(a)) + (_num(self._scalar(b)) if op == "+" else -_num(self._scalar(b)))
        return a

    def mul(self):
        a = self.pow()
        while self.peek()[0] == "op" and self.peek()[1] in ("*", "/"):
            op = self.take()[1]
            b = _num(self._scalar(self.pow()))
            a = _num(self._scalar(a))
            if op == "*":
                a = a * b
            else:
                if b == 0:
                    raise FormulaError("#DIV/0!")
                a = a / b
        return a

    def pow(self):
        a = self.unary()
        while self.peek() == ("op", "^"):
            self.take()
            a = _num(self._scalar(a)) ** _num(self._scalar(self.unary()))
        return a

    def unary(self):
        if self.peek() in (("op", "-"), ("op", "+")):
            op = self.take()[1]
            v = _num(self._scalar(self.unary()))
            return -v if op == "-" else v
        v = self.primary()
        if self.peek() == ("op", "%"):
            self.take()
            v = _num(self._scalar(v)) / 100
        return v

    def primary(self):
        k, v = self.take()
        if k == "num":
            return float(v)
        if k == "str":
            return v[1:-1].replace('""', '"')
        if k == "bool":
            return v.upper() == "TRUE"
        if k == "ref":
            return self._ref(v)
        if k == "p" and v == "(":
            e = self.expr()
            self._expect(")")
            return e
        if k == "func":
            return self._call(v)
        raise FormulaError(f"unexpected {v!r}")

    def _expect(self, ch):
        t = self.take()
        if t != ("p", ch):
            raise FormulaError(f"expected {ch}")

    def _args_raw(self):
        """returns list of (start,end) token spans for lazy eval"""
        args = []
        if self.peek() == ("p", ")"):
            self.take()
            return args
        while True:
            start, depth = self.i, 0
            while True:
                k, v = self.peek()
                if k is None:
                    raise FormulaError("unclosed (")
                if k == "func" or (k == "p" and v == "("):
                    depth += 1
                elif k == "p" and v == ")":
                    if depth == 0:
                        break
                    depth -= 1
                elif k == "p" and v in ",;" and depth == 0:
                    break
                self.i += 1
            args.append((start, self.i))
            k, v = self.take()
            if v == ")":
                return args

    def _eval_span(self, span):
        save_t, save_i = self.toks, self.i
        self.toks, self.i = save_t[:span[1]], span[0]
        try:
            if span[0] == span[1]:
                return None
            return self.expr()
        finally:
            self.toks, self.i = save_t, save_i

    def _call(self, name):
        spans = self._args_raw()
        if name == "IFERROR":
            try:
                v = self._eval_span(spans[0])
                return v
            except FormulaError:
                return self._eval_span(spans[1]) if len(spans) > 1 else ""
        if name == "IF":
            c = self._scalar(self._eval_span(spans[0]))
            truth = bool(c) if isinstance(c, str) else bool(_num(c))
            if truth:
                return self._eval_span(spans[1]) if len(spans) > 1 else True
            return self._eval_span(spans[2]) if len(spans) > 2 else False
        f = FUNCS.get(name)
        if not f:
            raise FormulaError(f"unsupported function {name}")
        return f(*[self._eval_span(s) for s in spans])

    def _ref(self, ref):
        sheet, r1, c1, r2, c2 = split_ref(ref)
        sheet = sheet or self.sheet
        if r1 == r2 and c1 == c2:
            return self.resolve(sheet, r1, c1)
        if (r2 - r1 + 1) * (c2 - c1 + 1) > 200000:
            raise FormulaError("range too large")
        vals = [self.resolve(sheet, r, c) for r in range(r1, r2 + 1) for c in range(c1, c2 + 1)]
        return Range(vals, r2 - r1 + 1, c2 - c1 + 1)

    @staticmethod
    def _scalar(v):
        if isinstance(v, list):
            return v[0] if v else None
        return v


SHIFT = re.compile(r"((?:'(?:[^']|'')+'|[A-Za-z_][\w\.]*)!)?(\$?)([A-Za-z]{1,3})(\$?)(\d+)(?![\w(])")


def shift_formula(f: str, dr: int, dc: int) -> str:
    """Translate a shared formula by (dr, dc), leaving $-anchored parts and strings alone."""
    out, pos = [], 0
    for m in re.finditer(r'"(?:[^"]|"")*"', f):
        out.append(_shift_part(f[pos:m.start()], dr, dc))
        out.append(m.group(0))
        pos = m.end()
    out.append(_shift_part(f[pos:], dr, dc))
    return "".join(out)


def _shift_part(s, dr, dc):
    def rep(m):
        sh, dcol, col, drow, row = m.groups()
        if not dcol:
            col = num2col(max(1, col2num(col) + dc))
        if not drow:
            row = str(max(1, int(row) + dr))
        return f"{sh or ''}{dcol}{col}{drow}{row}"
    return SHIFT.sub(rep, s)
