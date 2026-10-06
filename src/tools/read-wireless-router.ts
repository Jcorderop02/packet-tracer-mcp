import { z } from "zod";
import type { ToolModule } from "./types.js";
import { ipv4, nativeCall, makeGuard } from "./integration-common.js";
import { configureWrtJs, readWrtJs } from "../ipc/wireless-router.js";
const device = z.string().min(1);

export const InputSchema = {device};
export { readWrtJs as buildJs } from "../ipc/wireless-router.js";
export { decodeNativeReply as decodeReply } from "./integration-common.js";
export const registerReadWirelessRouterTool: ToolModule = ({bridge,server}) => {
const guard = makeGuard(bridge);
server.tool("pt_read_wireless_router", "Read WRT WAN mode, addresses and LAN DHCP status.", InputSchema, async a=>guard(()=>nativeCall(bridge,readWrtJs(a.device))));
};
