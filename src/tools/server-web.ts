import { z } from "zod";
import { jsStr } from "../ipc/escape.js";
import { nativeDevice } from "../ipc/integration-common.js";
import type { Bridge } from "../bridge/http-bridge.js";
import { makeGuard, nativeCall } from "./integration-common.js";
import type { ToolModule } from "./types.js";

const device = z.string().min(1);
const path = z.string().max(256).regex(/^\/[A-Za-z0-9_-][A-Za-z0-9_.-]*$/).default("/index.html");

export const registerServerWebTools: ToolModule = ({ bridge, server }) => {
  const guard = makeGuard(bridge);
  server.tool("pt_server_web", "Read or configure HTTP and TFTP on a simulated Server-PT. Optionally publish and read back one HTTP page.", {
    device,
    http: z.boolean().optional(),
    tftp: z.boolean().optional(),
    page: z.object({ path, content: z.string().max(32_000) }).optional(),
  }, args => guard(() => nativeCall(bridge, nativeDevice(args.device, `
    if(String(d.getModel())!=="Server-PT")return "ERR:not_server_pt";
    var http=d.getProcess("HttpServer"),tftp=d.getProcess("TftpServer");
    if(!http||!tftp)return "ERR:web_services_unavailable";
    ${args.http === undefined ? "" : `http.setEnable(${args.http});`}
    ${args.tftp === undefined ? "" : `tftp.setEnabled(${args.tftp});`}
    ${args.page ? `http.setPageContents(${jsStr(args.page.path.slice(1))},${jsStr(args.page.content)});` : ""}
    var result={http:http.isEnabled(),port:http.getPortNumber(),tftp:tftp.isEnabled()};
    ${args.page ? `result.pageMatches=String(http.getPage(${jsStr(args.page.path.slice(1))}))===${jsStr(args.page.content)};if(!result.pageMatches)return "ERR:page_readback_mismatch";` : ""}
    if(${args.http === undefined ? "false" : `result.http!==${args.http}`}||${args.tftp === undefined ? "false" : `result.tftp!==${args.tftp}`})return "ERR:service_readback_mismatch";
    return JSON.stringify(result);
  `))));

  server.tool("pt_verify_http", "Request a page from a simulated Server-PT using a simulated client. Requires a fresh response containing the expected marker.",
    HttpCheckSchema, args => guard(async () => JSON.stringify(await verifyHttp(bridge, args))));
};

export const HttpCheckSchema = {
  client: device, server: device, path, expected: z.string().min(1).max(256),
  timeout_ms: z.number().int().min(1000).max(30_000).default(12_000),
};
type HttpCheck = z.infer<z.ZodObject<typeof HttpCheckSchema>>;

export async function verifyHttp(bridge: Bridge, args: HttpCheck) {
  const start = JSON.parse(await nativeCall(bridge, nativeDevice(args.client, `
    var target=ipc.network().getDevice(${jsStr(args.server)});
    if(!target||String(target.getModel())!=="Server-PT")return "ERR:not_server_pt";
    var ip=String(target.getPort("FastEthernet0").getIpAddress());
    if(!/^[0-9.]+$/.test(ip)||ip==="0.0.0.0")return "ERR:server_has_no_ipv4";
    var http=target.getProcess("HttpServer"),c=d.getProcess("HttpClient");
    if(!http||!http.isEnabled()||!c)return "ERR:http_unavailable";
    var url="http://"+ip+(http.getPortNumber()==80?"":":"+http.getPortNumber())+${jsStr(args.path)};
    var prior=String(c.getLastPageContent()||"").indexOf(${jsStr(args.expected)})!==-1;
    if(prior)return "ERR:marker_already_present_use_fresh_marker";
    if(!c.go(url))return "ERR:http_request_rejected";
    return JSON.stringify({url:url});
  `))) as { url: string };
  const deadline = Date.now() + args.timeout_ms;
  do {
    const found = await nativeCall(bridge, nativeDevice(args.client, `
      var c=d.getProcess("HttpClient");
      return String(String(c.getLastPageContent()||"").indexOf(${jsStr(args.expected)})!==-1);
    `));
    if (found === "true") return { ...start, verified: true };
    await Bun.sleep(250);
  } while (Date.now() < deadline);
  throw new Error(`HTTP did not return the expected marker from ${start.url}`);
}
