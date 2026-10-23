/** OOXML workbook extensions accepted by CLI / upload UIs.
 *
 * Parse path is extension-agnostic (ZIP + xl/workbook.xml). These names only
 * gate file pickers and folder scans. Macros in .xlsm/.xltm are never executed.
 * Legacy .xls (BIFF) and binary .xlsb are rejected.
 */
export const OOXML_EXTS = [".xlsx", ".xlsm", ".xltx", ".xltm"] as const;

/** Case-insensitive match for the four OOXML spreadsheet extensions. */
export const OOXML_EXT_RE = /\.xl[st][xm]$/i;

export function isOoxmlWorkbook(name: string): boolean {
  const i = name.lastIndexOf(".");
  if (i < 0) return false;
  return (OOXML_EXTS as readonly string[]).includes(name.slice(i).toLowerCase());
}
