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

export const InputSchema = {device,enable:z.boolean().optional(),records:z.array(record).default([]),remove:z.array(record).default([])};
export { configureDnsJs as buildJs } from "../ipc/dns-server.js";
export { decodeNativeReply as decodeReply } from "./integration-common.js";
export const registerConfigureDnsTool: ToolModule = ({bridge,server}) => {
const guard = makeGuard(bridge);
server.tool("pt_configure_dns", "Enable DNS and add/update/delete A records. Updates remove existing A records of the same name, preserving other record types.", InputSchema, async a=>guard(async()=>{
    const before=JSON.parse(await nativeCall(bridge,readDnsJs(a.device))) as {records:{name:string;ip:string;type:number}[]};
    const remove=[...a.remove];
    for(const r of a.records)for(const old of before.records)if(old.type===1&&old.name.toLowerCase()===r.name.toLowerCase()&&!remove.some(x=>x.name===old.name&&x.ip===old.ip))remove.push(old);
    await nativeCall(bridge,configureDnsJs(a.device,a.enable,a.records,remove));
    const reply=await nativeCall(bridge,readDnsJs(a.device));const state=JSON.parse(reply);
    if(a.enable!==undefined&&state.enabled!==a.enable || a.records.some(r=>!state.records.some((s:{name:string;ip:string;type:number})=>s.type===1&&s.name.toLowerCase()===r.name.toLowerCase()&&s.ip===r.ip)))throw new Error("DNS readback mismatch after configuration.");
    return reply;
  }));
};
