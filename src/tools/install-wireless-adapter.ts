import { z } from "zod";
import type { ToolModule } from "./types.js";
import { ipv4, nativeCall, makeGuard } from "./integration-common.js";
import { installWirelessJs, readWirelessJs, associateDefaultJs } from "../ipc/wireless-client.js";
const device = z.string().min(1);

export const InputSchema = {device,replace:z.boolean().default(false)};
export { installWirelessJs as buildJs } from "../ipc/wireless-client.js";
export { decodeNativeReply as decodeReply } from "./integration-common.js";
export const registerInstallWirelessAdapterTool: ToolModule = ({bridge,server}) => {
const guard = makeGuard(bridge);
server.tool("pt_install_wireless_adapter", "Install Linksys-WPC300N in notebook root slot 0, preserving power state. Explicit replace=true required to remove an occupied module.", InputSchema, async a=>guard(()=>nativeCall(bridge,installWirelessJs(a.device,a.replace))));
};
