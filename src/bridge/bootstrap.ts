/** Bootstrap a PT webview with one outstanding command request at a time. */
export function buildBootstrap(port: number = 54321): string {
  const url = `http://127.0.0.1:${port}/next`;
  const code = `(function poll(){` +
    `var x=new XMLHttpRequest();x.open('GET','${url}',true);x.timeout=2000;` +
    `x.onload=function(){try{if(x.status===200&&x.responseText){$se('runCode',x.responseText)}}` +
    `finally{setTimeout(poll,x.status===200?0:500)}};` +
    `x.onerror=x.ontimeout=function(){setTimeout(poll,500)};x.send();})()`;
  return `/* packet-tracer-mcp bridge */ window.webview.evaluateJavaScriptAsync(${JSON.stringify(code)});`;
}
