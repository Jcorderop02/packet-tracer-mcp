import { expect, test, describe } from "bun:test";
import { setEndpointDhcpJs } from "../../src/ipc/generator.js";
function run(code:string,ipc:unknown):unknown { return Function("ipc",`return (${code});`)(ipc); }
test("DHCP respects explicit Wireless0 instead of a linked Ethernet port",()=>{const selected:string[]=[];const p=(name:string)=>({getName:()=>name,getLink:()=>({}),isWirelessPort:()=>name==="Wireless0",setDhcpClientFlag:()=>selected.push(name),isDhcpClientOn:()=>selected.includes(name)});const wired=p("FastEthernet0"),wireless=p("Wireless0");const d={getPortCount:()=>2,getPortAt:(i:number)=>[wired,wireless][i],getPort:(name:string)=>name==="Wireless0"?wireless:null,setDhcpFlag:()=>{},getCommandLine:()=>({enterCommand:()=>{}})};expect(run(setEndpointDhcpJs("pc","Wireless0"),{network:()=>({getDevice:()=>d})})).toContain("OK:");expect(selected).toEqual(["Wireless0"]);});
test("DHCP invalid port returns an error before changing addressing",()=>{const d={getPortCount:()=>0,getPort:()=>null};expect(run(setEndpointDhcpJs("pc","Missing"),{network:()=>({getDevice:()=>d})})).toBe("ERR:port_not_found");});
test("DHCP reports when the port setter has no effect", () => {
  const port = { getName: () => "Wireless0", setDhcpClientFlag() {}, isDhcpClientOn: () => false };
  const device = { getPortCount: () => 0, getPort: () => port, setDhcpFlag() {} };
  expect(run(setEndpointDhcpJs("pc", "Wireless0"), {network: () => ({getDevice: () => device})})).toBe("ERR:dhcp_not_enabled");
});
