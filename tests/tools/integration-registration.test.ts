import { expect, test } from "bun:test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Bridge } from "../../src/bridge/http-bridge.js";
import { ALL_TOOLS } from "../../src/tools/index.js";
async function connected(bridge:Bridge){
  const server=new McpServer({name:"integration-test",version:"1"});for(const register of ALL_TOOLS)register({bridge,server});
  const [a,b]=InMemoryTransport.createLinkedPair();await server.connect(a);const client=new Client({name:"tests",version:"1"});await client.connect(b);return {server,client};
}
test("all new tools register through the actual MCP SDK without duplicate names",async()=>{
  const {server,client}=await connected({} as Bridge);
  try{const listed=await client.listTools();const names=listed.tools.map(t=>t.name);expect(new Set(names).size).toBe(names.length);for(const name of ["pt_read_endpoint","pt_configure_wireless_router","pt_read_wireless_router","pt_configure_dns","pt_read_dns","pt_verify_dns","pt_read_server_dhcp","pt_install_wireless_adapter","pt_associate_default_wireless","pt_read_wireless_client","pt_checkpoint_pkt","pt_latest_checkpoint"])expect(names).toContain(name);}finally{await client.close();await server.close();}
});
test("pt_set_pc accepts OK suffix and verifies requested DHCP interface through MCP",async()=>{
  const fake={status:()=>({connected:true}),sendAndWait:async(code:string)=>code.includes('method=')?"OK:setDhcpFlag+portDhcp(Wireless0)+renew":JSON.stringify({ports:[{name:"Wireless0",ip:"192.0.2.110",mask:"255.255.255.0",dhcp:true}]})} as unknown as Bridge;
  const {server,client}=await connected(fake);
  try{const result=await client.callTool({name:"pt_set_pc",arguments:{device:"Notebook",mode:"dhcp",port:"Wireless0"}});expect(result.isError).not.toBe(true);expect(JSON.stringify(result.content)).toContain("Wireless0");}finally{await client.close();await server.close();}
});
