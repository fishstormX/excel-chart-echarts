"""Parity test: Python and TypeScript implementations must produce identical JSON for every fixture."""
import json, math, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from xlsx2echarts import convert_xlsx  # noqa: E402

JS = """import {convertXlsx} from '%s/ts/dist/index.js';
import {readFileSync} from 'node:fs';
const GJ = JSON.parse(readFileSync('%s/fixtures/custom_regions.geojson', 'utf8'));
const out = {}; for (const f of process.argv.slice(1)) { for (const c of [true,false]) out[f+'|'+c] = await convertXlsx(f, {excelCompat:c}); if (f.includes('maps')) out[f+'|geo'] = await convertXlsx(f, {geojson: GJ}); }
process.stdout.write(JSON.stringify(out));"""


def diff(a, b, path="$", out=None):
    out = [] if out is None else out
    if isinstance(a, bool) or isinstance(b, bool):
        if a is not b: out.append(f"{path}: {a!r} != {b!r}")
    elif isinstance(a, (int, float)) and isinstance(b, (int, float)):
        if not math.isclose(a, b, rel_tol=1e-9, abs_tol=1e-9): out.append(f"{path}: {a!r} != {b!r}")
    elif isinstance(a, dict) and isinstance(b, dict):
        for k in sorted(set(a) | set(b)):
            if k not in a or k not in b: out.append(f"{path}.{k}: missing in {'py' if k not in a else 'ts'}")
            else: diff(a[k], b[k], f"{path}.{k}", out)
    elif isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b): out.append(f"{path}: len {len(a)} != {len(b)}")
        for i, (x, y) in enumerate(zip(a, b)): diff(x, y, f"{path}[{i}]", out)
    elif a != b:
        out.append(f"{path}: {a!r} != {b!r}")
    return out


def main():
    files = sorted(str(p) for p in (ROOT / "fixtures").rglob("*.xl[st][xm]"))
    js = subprocess.run(["node", "--input-type=module", "-e", JS % (ROOT, ROOT), *files], capture_output=True, text=True, check=True)
    ts = json.loads(js.stdout)
    bad = 0
    for f in files:
        for compat in (True, False):
            py = json.loads(json.dumps(convert_xlsx(f, excel_compat=compat)))
            d = diff(py, ts[f"{f}|{'true' if compat else 'false'}"])
            n = len(py["charts"])
            print(f"{'✓' if not d else '✗'} {Path(f).name} excelCompat={compat}: {n} chart(s){'' if not d else f', {len(d)} difference(s)'}")
            for x in d[:15]: print("    ", x)
            bad += bool(d)
        if "maps" in f:
            gj = json.loads((ROOT / "fixtures/custom_regions.geojson").read_text())
            py = json.loads(json.dumps(convert_xlsx(f, geojson=gj)))
            d = diff(py, ts[f"{f}|geo"])
            print(f"{'✓' if not d else '✗'} {Path(f).name} geojson=custom_regions: {len(py['charts'])} chart(s)")
            for x in d[:15]: print("    ", x)
            bad += bool(d)
    # CLI output files must be byte-identical too
    import tempfile, filecmp
    with tempfile.TemporaryDirectory() as tmp:
        a, b = Path(tmp, "py"), Path(tmp, "ts")
        subprocess.run([sys.executable, "-m", "xlsx2echarts", *files, "-o", str(a), "--no-preview", "--geojson", str(ROOT / "fixtures/custom_regions.geojson")], cwd=ROOT, check=True, capture_output=True)
        subprocess.run(["node", str(ROOT / "ts/dist/cli.js"), *files, "-o", str(b), "--no-preview", "--geojson", str(ROOT / "fixtures/custom_regions.geojson")], check=True, capture_output=True)
        pa = sorted(p.relative_to(a) for p in a.rglob("*.json")); pb = sorted(p.relative_to(b) for p in b.rglob("*.json"))
        same = pa == pb and all(filecmp.cmp(a / x, b / x, shallow=False) for x in pa)
        print(f"{'✓' if same else '✗'} CLI output byte-identical: {len(pa)} JSON files")
        bad += not same
    print("PARITY OK" if not bad else f"PARITY FAILED ({bad})")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
