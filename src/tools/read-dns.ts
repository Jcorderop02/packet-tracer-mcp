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

export const InputSchema = {device};
export { readDnsJs as buildJs } from "../ipc/dns-server.js";
export { decodeNativeReply as decodeReply } from "./integration-common.js";
export const registerReadDnsTool: ToolModule = ({bridge,server}) => {
const guard = makeGuard(bridge);
server.tool("pt_read_dns", "Read DNS service state and authoritative resource records (not the resolution cache).", InputSchema, async a=>guard(()=>nativeCall(bridge,readDnsJs(a.device))));
};
