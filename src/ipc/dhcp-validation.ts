import type { DhcpPoolSpec } from "./dhcp-server.js";
export function ipNumber(ip: string): number {
  if (!/^(?:\d{1,3}\.){3}\d{1,3}$/.test(ip) || ip.split(".").some(x => Number(x)>255)) throw new Error(`Invalid IPv4: ${ip}`);
  return ip.split(".").reduce((n,x)=>n*256+Number(x),0);
}
export function maskNumber(mask: string): number {
  const n=ipNumber(mask),inverse=(~n)>>>0;
  if ((inverse & (inverse+1))!==0) throw new Error(`Noncontiguous subnet mask: ${mask}`);
  return n;
}
export function validateDhcpPools(pools: readonly DhcpPoolSpec[]): void {
  const ranges:{name:string;start:number;end:number}[]=[];
  const names=new Set<string>();
  for(const p of pools){
    if(names.has(p.name))throw new Error(`Duplicate DHCP pool: ${p.name}`);names.add(p.name);
    const mask=maskNumber(p.subnetMask),network=ipNumber(p.network),broadcast=(network|(~mask))>>>0;
    if(((network&mask)>>>0)!==network)throw new Error(`Pool ${p.name}: network is not a subnet address.`);
    for(const ip of [p.defaultRouter,p.dnsServer])if(ip!==undefined)ipNumber(ip);
    if(p.startIp===undefined)continue;
    const start=ipNumber(p.startIp),end=p.endIp!==undefined?ipNumber(p.endIp):p.maxUsers!==undefined?start+p.maxUsers-1:start;
    if(start<=network||end>=broadcast||end<start)throw new Error(`Pool ${p.name}: range must contain usable addresses in the subnet.`);
    if(p.maxUsers!==undefined&&p.endIp!==undefined&&end-start+1!==p.maxUsers)throw new Error(`Pool ${p.name}: maxUsers contradicts endIp.`);
    if(p.defaultRouter && ipNumber(p.defaultRouter)>=start&&ipNumber(p.defaultRouter)<=end)throw new Error(`Pool ${p.name}: range includes its gateway.`);
    ranges.push({name:p.name,start,end});
  }
  for(let i=0;i<ranges.length;i++)for(let j=i+1;j<ranges.length;j++)if(ranges[i]!.start<=ranges[j]!.end&&ranges[j]!.start<=ranges[i]!.end)throw new Error(`Overlapping DHCP pools: ${ranges[i]!.name} and ${ranges[j]!.name}. Configure persistent serverPool rather than removing it.`);
}
export function ipText(number:number):string {
  if(!Number.isInteger(number)||number<0||number>0xffffffff)throw new Error("IPv4 range overflow");
  return [24,16,8,0].map(bits=>(number>>>bits)&255).join(".");
}
/** Model PT's coupled maxUsers/endIp setters when only one is provided. */
export function mergeDhcpPool(previous:DhcpPoolSpec|undefined,update:DhcpPoolSpec):DhcpPoolSpec {
  const merged={...previous,...update};
  if(!previous&&(!update.startIp || update.endIp===undefined&&update.maxUsers===undefined))throw new Error(`New pool ${update.name} requires startIp and endIp/maxUsers.`);
  if(merged.startIp && update.endIp!==undefined && update.maxUsers===undefined)merged.maxUsers=ipNumber(update.endIp)-ipNumber(merged.startIp)+1;
  if(merged.startIp && update.maxUsers!==undefined && update.endIp===undefined)merged.endIp=ipText(ipNumber(merged.startIp)+update.maxUsers-1);
  return merged;
}
