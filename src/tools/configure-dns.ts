import { z } from "zod";
import type { ToolModule } from "./types.js";
import { ipv4, nativeCall, makeGuard } from "./integration-common.js";
import { configureDnsJs, readDnsJs } from "../ipc/dns-server.js";
const device = z.string().min(1);

const record = z.object({name:z.string().regex(/^[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*\.?$/),ip:ipv4});

export const InputSchema = {device,enable:z.boolean().optional(),records:z.array(record).default([]),remove:z.array(record).default([])};
export { configureDnsJs as buildJs } from "../ipc/dns-server.js";
export { decodeNativeReply as decodeReply } from "./integration-common.js";
export const registerConfigureDnsTool: ToolModule = ({bridge,server}) => {
const guard = makeGuard(bridge);
server.tool("pt_configure_dns", "Enable DNS and add/update/delete A records. Updates remove existing A records of the same name, preserving other record types.", InputSchema, async a=>guard(async()=>{
    type RecordA = { name: string; ip: string };
    type DnsState = { enabled: boolean; records: (RecordA & { type: number })[] };
    const dnsName = (name: string) => name.toLowerCase().replace(/\.$/, "");
    const sameRecord = (left: RecordA, right: RecordA) =>
      dnsName(left.name) === dnsName(right.name) && left.ip === right.ip;
    const read = () => nativeCall(bridge, readDnsJs(a.device));
    const before = JSON.parse(await read()) as DnsState;
    const remove = before.records.filter(old => old.type === 1 && (
      a.remove.some(record => sameRecord(old, record)) ||
      a.records.some(record => dnsName(old.name) === dnsName(record.name))
    ));

    await nativeCall(bridge, configureDnsJs(a.device, a.enable, a.records, remove));
    const reply = await read();
    const state = JSON.parse(reply) as DnsState;
    const present = (record: RecordA) =>
      state.records.some(observed => observed.type === 1 && sameRecord(record, observed));
    if (
      (a.enable !== undefined && state.enabled !== a.enable) ||
      a.records.some(record => !present(record)) ||
      remove.some(record => !a.records.some(added => sameRecord(record, added)) && present(record))
    ) throw new Error("DNS readback mismatch after configuration.");
    return reply;
  }));
};
