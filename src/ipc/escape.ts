/**
 * Escape a value so it can be safely embedded inside a JS double-quoted string
 * literal sent to PT's Script Engine. Backslash and double quote are escaped;
 * single quote is also escaped because the bridge sometimes wraps the payload
 * in single quotes when shelling out via `evaluateJavaScriptAsync`.
 */
export function escapeJsString(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/'/g, "\\'")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r");
}

/** Quote a string as a JS string literal: `hello` → `"hello"`. */
export function jsStr(s: string): string {
  return `"${escapeJsString(s)}"`;
}
