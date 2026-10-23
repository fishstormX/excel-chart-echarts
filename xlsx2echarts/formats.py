"""OOXML workbook extensions accepted by CLI / upload UIs.

Parse path is extension-agnostic (ZIP + xl/workbook.xml). These names only
gate file pickers and folder scans. Macros in .xlsm/.xltm are never executed.
Legacy .xls (BIFF) and binary .xlsb are rejected.
"""
from __future__ import annotations

from pathlib import Path
from typing import Union

# .xlsx workbook · .xlsm macro workbook · .xltx template · .xltm macro template
OOXML_EXTS = (".xlsx", ".xlsm", ".xltx", ".xltm")

# pathlib / shell glob used when scanning a folder (matches the four above)
OOXML_GLOB = "*.xl[st][xm]"


def is_ooxml_workbook(name: Union[str, Path]) -> bool:
    """True if *name* has an accepted OOXML spreadsheet extension."""
    return Path(name).suffix.lower() in OOXML_EXTS
