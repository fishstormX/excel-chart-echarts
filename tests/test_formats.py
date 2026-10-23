"""Unit tests for OOXML extension allowlist (no binary fixtures)."""
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from xlsx2echarts.formats import OOXML_EXTS, OOXML_GLOB, is_ooxml_workbook  # noqa: E402


def test_allowlist():
    assert OOXML_EXTS == (".xlsx", ".xlsm", ".xltx", ".xltm")
    for ok in ("a.xlsx", "B.XLSM", "t.xltx", "m.XLTM", Path("dir/book.xlsx")):
        assert is_ooxml_workbook(ok), ok
    for bad in ("a.xls", "b.xlsb", "c.XLS", "d.csv", "e.xlsx.bak", "noext", "f.xlsmx"):
        assert not is_ooxml_workbook(bad), bad


def test_glob_matches_four_extensions():
    """Folder scan glob must match the four OOXML names and skip .xls/.xlsb."""
    with tempfile.TemporaryDirectory() as td:
        d = Path(td)
        for name in ("a.xlsx", "b.xlsm", "c.xltx", "d.xltm", "legacy.xls", "bin.xlsb", "notes.txt"):
            (d / name).write_text("", encoding="utf-8")
        hits = sorted(p.name for p in d.glob(OOXML_GLOB))
    assert hits == ["a.xlsx", "b.xlsm", "c.xltx", "d.xltm"], hits


if __name__ == "__main__":
    test_allowlist()
    test_glob_matches_four_extensions()
    print("✓ test_formats: allowlist + glob OK")
