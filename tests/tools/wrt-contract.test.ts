import { expect, test, describe } from "bun:test";
import { configureWrtJs } from "../../src/ipc/wireless-router.js";
function run(code:string,ipc:unknown):unknown { return Function("ipc",`return (${code});`)(ipc); }
test("WAN static selects enum 2 before setting its IP",()=>{const order:string[]=[];const port={setDhcpClientFlag:()=>{},setIpSubnetMask:()=>order.push("ip")};const d={getInternetConnectionType:()=>0,getPort:()=>port,setInternetConnectionType:(n:number)=>order.push(`mode:${n}`)};expect(run(configureWrtJs({device:"wrt",wanMode:"static",wanIp:"10.0.0.1",wanMask:"255.255.255.0"}),{network:()=>({getDevice:()=>d})})).toBe("OK");expect(order).toEqual(["mode:2","ip"]);});
