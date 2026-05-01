/**
 * Returns the one-liner that the user pastes into a PT 9.0 webview-backed
 * code editor (e.g. Marvel's editor, or any extension that exposes
 * `window.webview.evaluateJavaScriptAsync`). Once running, the inner
 * `setInterval` polls the bridge and routes commands to the Script Engine
 * via `$se('runCode', ...)`.
 *
 * Polling at 500 ms is the smallest interval where bursts of `addDevice`
 * calls are still rendered visibly without hammering the embedded HTTP
 * stack — verified empirically.
 */
export function buildBootstrap(port: number = 54321, intervalMs: number = 500): string {
  const url = `http://127.0.0.1:${port}/next`;
  return (
    `/* packet-tracer-mcp bridge */ ` +
    `window.webview.evaluateJavaScriptAsync(` +
    `"setInterval(function(){` +
    `var x=new XMLHttpRequest();` +
    `x.open('GET','${url}',true);` +
    `x.onload=function(){if(x.status===200&&x.responseText){\\$se('runCode',x.responseText)}};` +
    `x.onerror=function(){};` +
    `x.send()` +
    `},${intervalMs})"` +
    `);`
  );
}
