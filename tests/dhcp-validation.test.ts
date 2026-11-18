import { expect, test, describe } from "bun:test";
import { validateDhcpPools, mergeDhcpPool } from "../src/ipc/dhcp-validation.js";
describe("DHCP validation",()=>{
  const pool={name:"serverPool",network:"192.168.50.0",subnetMask:"255.255.255.0",startIp:"192.168.50.110",endIp:"192.168.50.200",maxUsers:91};
  test("valid persistent default pool",()=>expect(()=>validateDhcpPools([pool])).not.toThrow());
  test("detect overlap including existing pools",()=>expect(()=>validateDhcpPools([pool,{...pool,name:"Other"}])).toThrow("Overlapping"));
  test("reject contradictory capacity",()=>expect(()=>validateDhcpPools([{...pool,maxUsers:100}])).toThrow("contradicts"));
  test("reject subnet crossing or gateway allocation",()=>{expect(()=>validateDhcpPools([{...pool,endIp:"192.168.51.1"}])).toThrow();expect(()=>validateDhcpPools([{...pool,defaultRouter:pool.startIp}])).toThrow("gateway");});
  test("reject noncontiguous masks before mutation",()=>expect(()=>validateDhcpPools([{...pool,subnetMask:"255.0.255.0"}])).toThrow("Noncontiguous"));
});

test("updating endIp without maxUsers respects native coupling",()=>{const old={name:"serverPool",network:"192.168.50.0",subnetMask:"255.255.255.0",startIp:"192.168.50.110",endIp:"192.168.50.200",maxUsers:91};const merged=mergeDhcpPool(old,{name:old.name,network:old.network,subnetMask:old.subnetMask,endIp:"192.168.50.150"});expect(merged.maxUsers).toBe(41);expect(()=>validateDhcpPools([merged])).not.toThrow();});
test("updating capacity without endIp recalculates the observed range",()=>{const p=mergeDhcpPool(undefined,{name:"p",network:"192.168.50.0",subnetMask:"255.255.255.0",startIp:"192.168.50.110",maxUsers:20});expect(p.endIp).toBe("192.168.50.129");});
