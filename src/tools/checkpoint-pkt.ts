import { z } from "zod";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync, statSync } from "node:fs";
import { join, isAbsolute } from "node:path";
import { createHash } from "node:crypto";
import type { ToolModule } from "./types.js";
import type { Bridge } from "../bridge/http-bridge.js";
import { nativeCall } from "./integration-common.js";
import { fileSaveAsNoPromptJs, fileOpenJs, fileNewJs } from "../ipc/files.js";
import { requireConnectedBridge, textResult, errorResult } from "./helpers.js";
import { linkRegistry } from "../canvas/link-registry.js";
const locks=new WeakMap<Bridge,Promise<unknown>>();

export function nextCheckpointPath(directory:string,name:string):string {
  const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
  const pattern=new RegExp(`^${escaped}-(\\d+)\\.pkt$`);
  let next=1;
  for(const file of readdirSync(directory)){const match=pattern.exec(file);if(match)next=Math.max(next,Number(match[1])+1);}
  return join(directory,`${name}-${String(next).padStart(4,"0")}.pkt`);
}

export async function confirmedSave(bridge:Bridge,path:string):Promise<{path:string;bytes:number;sha256:string;confirmedAt:string}> {
  if(existsSync(path))throw new Error("Checkpoint already exists; refusing overwrite.");
  const sent=await nativeCall(bridge,fileSaveAsNoPromptJs(path));if(sent!=="OK")throw new Error(`Save not dispatched: ${sent}`);
  const until=Date.now()+30000;let last=-1,stableSince=0;
  while(Date.now()<until){
    const size=existsSync(path)?statSync(path).size:0;
    if(size>0&&size===last){if(!stableSince)stableSince=Date.now();if(Date.now()-stableSince>=800){const bytes=readFileSync(path);return {path,bytes:bytes.length,sha256:createHash("sha256").update(bytes).digest("hex"),confirmedAt:new Date().toISOString()};}}
    else stableSince=0;
    last=size;await new Promise(r=>setTimeout(r,200));
  }
  throw new Error(`Save not confirmed on shared filesystem: ${path}`);
}

export function persistenceStateJs():string {
  return `(function(){var net=ipc.network(),devices=[];for(var i=0;i<net.getDeviceCount();i++){var d=net.getDeviceAt(i);if(d.getModel()==="Power Distribution Device")continue;var v={name:d.getName(),model:d.getModel(),ports:[]};for(var j=0;j<d.getPortCount();j++){var p=d.getPortAt(j);try{var dhcp=p.isDhcpClientOn();v.ports.push({name:p.getName(),dhcp:dhcp,ip:dhcp?null:String(p.getIpAddress()),mask:dhcp?null:String(p.getSubnetMask())});}catch(e){}}try{v.wanMode=d.getInternetConnectionType();v.gateway=String(d.getDefaultGateway());}catch(e){}try{var dns=d.getProcess("DnsServerProcess");if(dns){v.dns={enabled:dns.isEnabled(),records:[]};for(var k=0;k<dns.getSizeOfNameServerDb();k++){var r=dns.getRrFromNameServerDbAt(k);v.dns.records.push({name:String(r.name),ip:String(r.ipAddress),type:Number(r.type)});}v.dns.records.sort(function(a,b){return JSON.stringify(a).localeCompare(JSON.stringify(b));});}}catch(e){v.dnsError=String(e);}try{var mp=d.getProcess("DhcpServerMainProcess");if(mp){var sp=mp.getDhcpServerProcessByPortName("FastEthernet0");v.dhcp={enabled:sp.isEnable(),pools:[]};for(var k=0;k<sp.getPoolCount();k++){var p=sp.getPoolAt(k);v.dhcp.pools.push({name:p.getDhcpPoolName(),network:String(p.getNetworkAddress()),mask:String(p.getSubnetMask()),start:String(p.getStartIp()),end:String(p.getEndIp()),gw:String(p.getDefaultRouter()),dns:String(p.getDnsServerIp()),max:p.getMaxUsers()});}v.dhcp.pools.sort(function(a,b){return a.name.localeCompare(b.name);});}}catch(e){v.dhcpError=String(e);}try{var wr=d.getProcess("WirelessServerProcess");if(wr)v.ssid=String(wr.getSsid());}catch(e){}try{if(typeof d.getInternetConnectionType==="function")v.lanDhcp=d.getProcess("DhcpServerProcess").isEnable();}catch(e){v.wrtDhcpError=String(e);}v.ports.sort(function(a,b){return a.name.localeCompare(b.name);});devices.push(v);}devices.sort(function(a,b){return a.name.localeCompare(b.name);});return JSON.stringify(devices);})()`;
}

export const InputSchema = {directory:z.string().min(1),name:z.string().regex(/^[a-zA-Z0-9_-]+$/).default("checkpoint"),verifyReopen:z.boolean().default(false)};
export { fileSaveAsNoPromptJs as buildJs } from "../ipc/files.js";
export { decodeNativeReply as decodeReply } from "./integration-common.js";
export const registerCheckpointPktTool: ToolModule = ({bridge,server}) => {
server.tool("pt_checkpoint_pkt", "Create a numbered .pkt checkpoint and atomically record confirmed size/SHA-256 in latest-checkpoint.json. verifyReopen=true replaces the active canvas with this checkpoint and compares persistent addresses, WRT, DNS and DHCP. Shared filesystem required.", InputSchema, async a=>{
    const blocked=requireConnectedBridge(bridge);if(blocked)return blocked;
    if(!isAbsolute(a.directory))return errorResult("Checkpoint directory must be absolute.");
    const previous=locks.get(bridge)??Promise.resolve();
    const next=previous.catch(()=>{}).then(async()=>{
      mkdirSync(a.directory,{recursive:true});
      const before=a.verifyReopen?JSON.parse(await nativeCall(bridge,persistenceStateJs())):undefined;
      if(before && before.some((d:Record<string,unknown>)=>["dnsError","dhcpError","wrtDhcpError"].some(k=>k in d)))throw new Error(`Cannot verify persistence: native readback incomplete: ${JSON.stringify(before)}`);
      const saved=await confirmedSave(bridge,nextCheckpointPath(a.directory,a.name));
      const manifest=join(a.directory,"latest-checkpoint.json"),tmp=manifest+"."+crypto.randomUUID()+".tmp";
      writeFileSync(tmp,JSON.stringify(saved,null,2)+"\n",{flag:"wx"});renameSync(tmp,manifest);
      if(a.verifyReopen){
        const links=linkRegistry.all();
        const cleared=await nativeCall(bridge,fileNewJs(false));if(!/^OK\|(?:true|undefined)$/.test(cleared))throw new Error(`Workspace replacement failed; saved checkpoint remains at ${saved.path}: ${cleared}`);
        linkRegistry.clear();
        const opened=await nativeCall(bridge,fileOpenJs(saved.path));if(opened!=="OK|number|0")throw new Error(`Reopen failed; recover from ${saved.path}: ${opened}`);
        let after:unknown;const deadline=Date.now()+15000;
        do{await new Promise(r=>setTimeout(r,500));after=JSON.parse(await nativeCall(bridge,persistenceStateJs()));if(JSON.stringify(after)===JSON.stringify(before))break;}while(Date.now()<deadline);
        if(JSON.stringify(after)!==JSON.stringify(before))throw new Error(`Persistence mismatch; checkpoint retained: ${saved.path}. Before=${JSON.stringify(before)} After=${JSON.stringify(after)}`);
        for(const l of links)linkRegistry.register(l.aDevice,l.aPort,l.bDevice,l.bPort);
      }
      return {...saved,persistenceVerified:a.verifyReopen};
    });locks.set(bridge,next);
    try{return textResult(JSON.stringify(await next,null,2));}catch(e){return errorResult(String(e));}finally{if(locks.get(bridge)===next)locks.delete(bridge);}
  });
};
