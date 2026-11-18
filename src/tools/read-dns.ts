import { z } from "zod";
import type { ToolModule } from "./types.js";
import { nativeCall, makeGuard } from "./integration-common.js";
import { readDnsJs } from "../ipc/dns-server.js";
const device = z.string().min(1);

export const InputSchema = {device};
export { readDnsJs as buildJs } from "../ipc/dns-server.js";
export { decodeNativeReply as decodeReply } from "./integration-common.js";
export const registerReadDnsTool: ToolModule = ({bridge,server}) => {
const guard = makeGuard(bridge);
server.tool("pt_read_dns", "Read DNS service state and authoritative resource records (not the resolution cache).", InputSchema, async a=>guard(()=>nativeCall(bridge,readDnsJs(a.device))));
};
