import { z } from "zod";
import type { ToolModule } from "./types.js";
import { makeGuard } from "./integration-common.js";
import { associateOpenDefault } from "../ipc/wireless-client.js";
const device = z.string().min(1);

export const InputSchema = {device,ap:device,allowRestart:z.literal(true)};
export { associateDefaultJs as buildJs } from "../ipc/wireless-client.js";
export { decodeNativeReply as decodeReply } from "./integration-common.js";
export const registerAssociateDefaultWirelessTool: ToolModule = ({bridge,server}) => {
const guard = makeGuard(bridge);
server.tool("pt_associate_default_wireless", "Request the verified open Default-profile notebook association. Requires an AP already advertising open Default, and a power cycle. Polls and verifies association; arbitrary SSIDs are not supported by this workflow.", InputSchema, a => guard(async () => JSON.stringify(await associateOpenDefault(bridge, a.device, a.ap))));
};
