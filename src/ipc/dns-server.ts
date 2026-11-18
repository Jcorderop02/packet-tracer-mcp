import { jsStr } from "./escape.js";
import { nativeDevice } from "./integration-common.js";

export function readDnsJs(device: string): string {
  return nativeDevice(device, `var dns=d.getProcess("DnsServerProcess");if(!dns)return "ERR:no_dns_service";var records=[];for(var i=0;i<dns.getSizeOfNameServerDb();i++){var r=dns.getRrFromNameServerDbAt(i);records.push({name:String(r.name),ip:String(r.ipAddress),type:Number(r.type)});}return JSON.stringify({enabled:dns.isEnabled(),records:records});`);
}
export function configureDnsJs(device: string, enable: boolean | undefined, records: readonly {name: string;ip: string}[], remove: readonly {name: string;ip: string}[]): string {
  const changes = [...remove.map(r => `if(!dns.removeARecordFromNameServerDb(${jsStr(r.name)},${jsStr(r.ip)}))return "ERR:remove_record_failed:"+${jsStr(r.name)};`), ...records.map(r => `if(!dns.addARecordToNameServerDb(${jsStr(r.name)},${jsStr(r.ip)}))return "ERR:add_record_failed:"+${jsStr(r.name)};`)];
  return nativeDevice(device, `var dns=d.getProcess("DnsServerProcess");if(!dns)return "ERR:no_dns_service";${enable === undefined ? "" : `dns.setEnable(${enable});`}${changes.join("")}return "OK";`);
}
