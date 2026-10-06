import { z } from "zod";
import type { ToolModule } from "./types.js";
import { ipv4, nativeCall, makeGuard } from "./integration-common.js";
import { readDhcpJs } from "../ipc/dhcp-read.js";
const device = z.string().min(1);

export const InputSchema = {device,port:z.string().default("FastEthernet0"),includeLeases:z.boolean().default(false)};
export { readDhcpJs as buildJs } from "../ipc/dhcp-read.js";
export { decodeNativeReply as decodeReply } from "./integration-common.js";
export const registerReadServerDhcpTool: ToolModule = ({bridge,server}) => {
const guard = makeGuard(bridge);
server.tool("pt_read_server_dhcp", "Read Server-PT DHCP pools and optionally inspect up to 1024 lease slots per pool; leaseError indicates an API limit.", InputSchema, async a=>guard(()=>nativeCall(bridge,readDhcpJs(a.device,a.port,a.includeLeases))));
};
