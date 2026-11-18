import { z } from "zod";
import type { ToolModule } from "./types.js";
import { ipv4, nativeCall, makeGuard } from "./integration-common.js";
import { configureWrtJs, readWrtJs } from "../ipc/wireless-router.js";
const device = z.string().min(1);

export const InputSchema = {
    device,wanMode:z.enum(["dhcp","static","pppoe"]).optional(),wanIp:ipv4.optional(),wanMask:ipv4.optional(),gateway:ipv4.optional(),dns:ipv4.optional(),lanIp:ipv4.optional(),lanMask:ipv4.optional(),dhcpEnabled:z.boolean().optional()
  };
export { configureWrtJs as buildJs } from "../ipc/wireless-router.js";
export { decodeNativeReply as decodeReply } from "./integration-common.js";
export const registerConfigureWirelessRouterTool: ToolModule = ({bridge,server}) => {
const guard = makeGuard(bridge);
server.tool("pt_configure_wireless_router", "Configure WRT WAN mode (DHCP=0, PPPoE=1, static=2), static WAN, LAN and DHCP enable. PPPoE authentication must be configured in native UI; this tool does not claim to configure credentials.", InputSchema, async a=>guard(async()=>{
    if(a.wanMode==="static"&&(!a.wanIp||!a.wanMask))throw new Error("Static WAN requires wanIp and wanMask.");
    if(Boolean(a.lanIp)!==Boolean(a.lanMask)||Boolean(a.wanIp)!==Boolean(a.wanMask))throw new Error("Address and mask must be supplied together.");
    if(a.wanIp&&a.wanMode!=="static")throw new Error("WAN static address requires wanMode=static.");
    await nativeCall(bridge,configureWrtJs(a));
    const state=JSON.parse(await nativeCall(bridge,readWrtJs(a.device)));
    if(a.wanMode && state.mode!==({dhcp:0,pppoe:1,static:2}[a.wanMode]))throw new Error("WAN mode readback mismatch.");
    if(a.wanIp && state.wan.ip!==a.wanIp || a.lanIp && state.lan.ip!==a.lanIp || a.dhcpEnabled!==undefined && state.dhcpEnabled!==a.dhcpEnabled)throw new Error("WRT configuration readback mismatch.");
    return JSON.stringify(state);
  }));
};
