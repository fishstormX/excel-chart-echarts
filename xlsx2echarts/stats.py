"""Numeric helpers shared by chartEx (histogram/box) and trendline code. Mirrored 1:1 in ts/src/stats.ts —
same operation order so that both implementations produce identical floats."""
from __future__ import annotations

import math
from typing import List, Optional, Tuple


def sig(x: float):
    """round to 10 significant digits (hides last-ulp libm differences between CPython and V8)"""
    if not math.isfinite(x):
        return None
    return float("%.10g" % x)


def fsum(xs) -> float:
    s = 0.0
    for x in xs:
        s += x
    return s


def mean(xs: List[float]) -> float:
    return fsum(xs) / len(xs)


def stdev(xs: List[float]) -> float:
    """sample standard deviation (n-1)"""
    n = len(xs)
    if n < 2:
        return 0.0
    m = mean(xs)
    s = 0.0
    for x in xs:
        s += (x - m) * (x - m)
    return math.sqrt(s / (n - 1))


def quantile(xs: List[float], p: float, method: str) -> float:
    """xs sorted. Excel QUARTILE.INC (inclusive) / QUARTILE.EXC (exclusive), positions clamped."""
    n = len(xs)
    if n == 1:
        return xs[0]
    pos = p * (n - 1) if method == "inclusive" else p * (n + 1) - 1
    if pos <= 0:
        return xs[0]
    if pos >= n - 1:
        return xs[n - 1]
    i = int(math.floor(pos))
    f = pos - i
    return xs[i] + (xs[i + 1] - xs[i]) * f


def median(xs: List[float]) -> float:
    n = len(xs)
    if n % 2:
        return xs[n // 2]
    return (xs[n // 2 - 1] + xs[n // 2]) / 2


def linreg(xs: List[float], ys: List[float]) -> Optional[Tuple[float, float]]:
    """least squares y = k*x + b"""
    n = len(xs)
    if n < 2:
        return None
    sx = fsum(xs)
    sy = fsum(ys)
    sxx = 0.0
    sxy = 0.0
    for i in range(n):
        sxx += xs[i] * xs[i]
        sxy += xs[i] * ys[i]
    den = n * sxx - sx * sx
    if not den:
        return None
    k = (n * sxy - sx * sy) / den
    return k, (sy - k * sx) / n


def polyfit(xs: List[float], ys: List[float], order: int) -> Optional[List[float]]:
    """coefficients c0..c_order of the least-squares polynomial (normal equations, partial pivoting)"""
    m = order + 1
    if len(xs) < m:
        return None
    a = [[0.0] * (m + 1) for _ in range(m)]
    for r in range(m):
        for c in range(m):
            s = 0.0
            for x in xs:
                s += x ** (r + c)
            a[r][c] = s
        s = 0.0
        for i in range(len(xs)):
            s += ys[i] * xs[i] ** r
        a[r][m] = s
    for col in range(m):
        piv = col
        for r in range(col + 1, m):
            if abs(a[r][col]) > abs(a[piv][col]):
                piv = r
        if a[piv][col] == 0:
            return None
        a[col], a[piv] = a[piv], a[col]
        for r in range(m):
            if r != col:
                f = a[r][col] / a[col][col]
                for c in range(col, m + 1):
                    a[r][c] -= f * a[col][c]
    return [a[i][m] / a[i][i] for i in range(m)]


def polyval(coef: List[float], x: float) -> float:
    y = 0.0
    for i in range(len(coef) - 1, -1, -1):
        y = y * x + coef[i]
    return y
