import { z } from "zod";
import type { ToolModule } from "./types.js";
import { ipv4, nativeCall, makeGuard } from "./integration-common.js";
import { installWirelessJs, readWirelessJs, associateDefaultJs } from "../ipc/wireless-client.js";
const device = z.string().min(1);

export const InputSchema = {device};
export { readWirelessJs as buildJs } from "../ipc/wireless-client.js";
export { decodeNativeReply as decodeReply } from "./integration-common.js";
export const registerReadWirelessClientTool: ToolModule = ({bridge,server}) => {
const guard = makeGuard(bridge);
server.tool("pt_read_wireless_client", "Read actual association/AP MAC, interface and current profile. Profile DNS/gateway may be stale; use ipconfig /all.", InputSchema, async a=>guard(()=>nativeCall(bridge,readWirelessJs(a.device))));
};
