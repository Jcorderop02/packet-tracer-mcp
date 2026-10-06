import { z } from "zod";
import type { ToolModule } from "./types.js";
import { ipv4, nativeCall, makeGuard } from "./integration-common.js";
import { installWirelessJs, readWirelessJs, associateDefaultJs } from "../ipc/wireless-client.js";
const device = z.string().min(1);

export const InputSchema = {device,ap:device,allowRestart:z.literal(true)};
export { associateDefaultJs as buildJs } from "../ipc/wireless-client.js";
export { decodeNativeReply as decodeReply } from "./integration-common.js";
export const registerAssociateDefaultWirelessTool: ToolModule = ({bridge,server}) => {
const guard = makeGuard(bridge);
server.tool("pt_associate_default_wireless", "Request the verified open Default-profile notebook association. Requires an AP already advertising open Default, and a power cycle. Polls and verifies association; arbitrary SSIDs are not supported by this workflow.", InputSchema, async a=>guard(async()=>{
    // Validate the AP before restarting a client or changing its profile.
    const apState=JSON.parse(await nativeCall(bridge,`(function(){var d=ipc.network().getDevice(${JSON.stringify(a.ap)});if(!d)return "ERR:ap_not_found";var w=d.getProcess("WirelessServerProcess");if(!w)return "ERR:no_ap_radio";return JSON.stringify({ssid:String(w.getSsid()),encryption:Number(w.getEncryptType())});})()`));
    if(apState.ssid!=="Default"||apState.encryption!==0)throw new Error("AP must already advertise open Default (encryption=0).");
    await nativeCall(bridge,associateDefaultJs(a.device));
    const until=Date.now()+30000;let reply="";
    while(Date.now()<until){reply=await nativeCall(bridge,readWirelessJs(a.device));const state=JSON.parse(reply);if(state.associated&&state.accessPoints.includes(a.ap))return reply;await new Promise(r=>setTimeout(r,500));}
    throw new Error(`Association not confirmed with ${a.ap}: ${reply}`);
  }));
};
