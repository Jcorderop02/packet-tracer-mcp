import { z } from "zod";
import type { ToolModule } from "./types.js";
import { ipv4, nativeCall, makeGuard } from "./integration-common.js";
import { configureDnsJs, readDnsJs } from "../ipc/dns-server.js";
import { runPing } from "../sim/runner.js";
const device = z.string().min(1);

const record = z.object({name:z.string().regex(/^[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*\.?$/),ip:ipv4});

export function resolvedAddress(raw: string): string | undefined {
  return /Pinging\s+[^\r\n]*?\[((?:\d{1,3}\.){3}\d{1,3})\]/i.exec(raw)?.[1]??/ICMP Echos? to\s+((?:\d{1,3}\.){3}\d{1,3})/i.exec(raw)?.[1]??/^Pinging\s+((?:\d{1,3}\.){3}\d{1,3})\b/im.exec(raw)?.[1];
}

export const InputSchema = {device,hostname:z.string().regex(/^[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)+\.?$/)};
export { enterCommandJs as buildJs } from "../ipc/generator.js";
export { decodeNativeReply as decodeReply } from "./integration-common.js";
export const registerVerifyDnsTool: ToolModule = ({bridge,server}) => {
const guard = makeGuard(bridge);
server.tool("pt_verify_dns", "Resolve a hostname using a client ping; report DNS resolution independently of ICMP reachability.", InputSchema, async a=>guard(async()=>{
    const {raw,result}=await runPing(bridge,a.device,a.hostname);
    const ip=resolvedAddress(raw);
    return JSON.stringify({resolved:Boolean(ip),address:ip??null,icmp:result});
  }));
};
