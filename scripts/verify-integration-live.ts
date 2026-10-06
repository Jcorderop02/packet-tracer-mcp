/** Read-only validation against an already connected upstream MCP server.
 * No user topology/configuration is modified. */
import { z } from "zod";
import { ALL_TOOLS } from "../src/tools/index.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { mkdirSync } from "node:fs";
import { runPing } from "../src/sim/runner.js";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {StreamableHTTPClientTransport} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {Bridge} from "../src/bridge/http-bridge.js";
import {readDhcpJs,readDnsJs,readEndpointJs,readWirelessJs,readWrtJs} from "../src/ipc/integration.js";
function report(value: string) { process.stdout.write(value+"\n"); }
const client=new Client({name:"fork-readonly-validation",version:"1.0"});
await client.connect(new StreamableHTTPClientTransport(new URL(process.env.UPSTREAM_MCP_URL??"http://127.0.0.1:39001/mcp")));
const bridge=new Bridge(54322);bridge.start();let active=true;
const worker=(async()=>{while(active){const code=await (await fetch("http://127.0.0.1:54322/next")).text();if(code){
  // Relay the exact inner expression through the existing extension; avoid
  // nesting __mcpEval, whose shared webview callback is not reentrant.
  const match=/__mcpEval\((.*),54322\);$/.exec(code);if(!match)throw new Error("Unexpected wire command");
  const inner=JSON.parse(match[1]!);
  const result=await client.callTool({name:"pt_send_raw",arguments:{code:inner,timeout_ms:15000}});
  const content=result.content as {type:string;text?:string}[];
  const text=content.filter(c=>c.type==="text").map(c=>c.text??"").join("\n");
  if(result.isError)throw new Error(`Upstream read-only probe failed: ${text}`);
  const hex=Array.from(text,c=>c.charCodeAt(0).toString(16).padStart(2,"0")).join("");
  await fetch("http://127.0.0.1:54322/result",{method:"POST",body:hex});
}else await Bun.sleep(100);}})();
try{
  const echo=await bridge.sendAndWait(JSON.stringify("quotes ' \" backslash \\ newline\n español 漢字"));
  if(echo!=="quotes ' \" backslash \\ newline\n español 漢字")throw new Error(`Transport echo mismatch: ${echo}`);
  report("PASS: correlated bridge, special characters and Unicode on native PT");
  const raw=await bridge.sendAndWait('(function(){var n=ipc.network(),out=[];for(var i=0;i<n.getDeviceCount();i++){var d=n.getDeviceAt(i);out.push({name:d.getName(),model:String(d.getModel())});}return JSON.stringify(out);})()');
  const devices=(JSON.parse(raw??"[]") as {name:string;model:string}[]).filter(d=>d.model!=="Power Distribution Device");
  if(process.argv.includes("--fixture") || process.argv.includes("--resume-fixture")){
    const resume = process.argv.includes("--resume-fixture");
    if(!resume && devices.filter(d=>d.model!=="Power Distribution Device").length)throw new Error("Fixture requires an empty canvas; refusing to replace user work.");
    if(resume && (devices.length!==7 || devices.some(d=>!/^Test(?:WRT|SW1|SW2|AP|DNS|DHCP|Laptop)$/.test(d.name))))throw new Error("Resume requires only the seven known synthetic devices.");
    const handlers=new Map<string,{schema:z.ZodObject;run:(a:unknown)=>Promise<{isError?:boolean;content:{type:string;text?:string}[]}>}>();
    const server={tool:(name:string,_description:string,schema:z.ZodRawShape,run:never)=>handlers.set(name,{schema:z.object(schema),run})} as unknown as McpServer;
    for(const register of ALL_TOOLS)register({bridge,server});
    const invoke=async(name:string,args:unknown)=>{const t=handlers.get(name)!;const r=await t.run(t.schema.parse(args));const value=r.content.map(c=>c.text??"").join("\n");if(r.isError)throw new Error(`${name}: ${value}`);report(`PASS: ${name}`);if(name==="pt_verify_dns")report(value);return value;};
    const directory=process.env.PT_FIXTURE_DIR??"/private/tmp/packet-tracer-mcp-integration-fixture";mkdirSync(directory,{recursive:true});
    if(!resume){
    for(const [name,model] of [["TestWRT","wrt300n"],["TestSW1","2960-24TT"],["TestSW2","2960-24TT"],["TestAP","ap-n"],["TestDNS","Server-PT"],["TestDHCP","Server-PT"],["TestLaptop","Laptop-PT"]])await invoke("pt_add_device",{name,model});
    await invoke("pt_checkpoint_pkt",{directory,name:"fixture-created"});
    for(const [a,pa,b,pb,cable] of [["TestWRT","Ethernet 1","TestSW1","FastEthernet0/1","straight"],["TestSW1","FastEthernet0/2","TestSW2","FastEthernet0/1","cross"],["TestSW2","FastEthernet0/2","TestAP","Port 0","straight"],["TestSW1","FastEthernet0/3","TestDHCP","FastEthernet0","straight"],["TestWRT","Internet","TestDNS","FastEthernet0","cross"]])await invoke("pt_create_link",{device_a:a,port_a:pa,device_b:b,port_b:pb,cable});
    }
    await invoke("pt_configure_wireless_router",{device:"TestWRT",wanMode:"static",wanIp:"10.10.10.1",wanMask:"255.255.255.0",lanIp:"192.168.50.1",lanMask:"255.255.255.0",dhcpEnabled:false});
    for(const [device,ip,gw] of [["TestDNS","10.10.10.33","10.10.10.1"],["TestDHCP","192.168.50.2","192.168.50.1"]])await invoke("pt_set_pc",{device,mode:"static",ip,mask:"255.255.255.0",gateway:gw,dns:"10.10.10.33"});
    await invoke("pt_configure_dns",{device:"TestDNS",enable:true,records:[{name:"test.example","ip":"10.10.10.33"}]});
    await invoke("pt_configure_dns",{device:"TestDNS",records:[{name:"test.example","ip":"10.10.10.33"}]});
    await invoke("pt_read_server_dhcp",{device:"TestDHCP",includeLeases:true});
    await invoke("pt_configure_server_dhcp",{device:"TestDHCP",enable:true,pools:[{name:"serverPool",network:"192.168.50.0",subnetMask:"255.255.255.0",defaultRouter:"192.168.50.1",dnsServer:"10.10.10.33",startIp:"192.168.50.110",endIp:"192.168.50.200",maxUsers:91}]});
    await invoke("pt_install_wireless_adapter",{device:"TestLaptop",replace:true});
    await invoke("pt_apply_wireless",{aps:[{device:"TestAP",ssid:"Default",security:"open"}]});
    const disable=await bridge.sendAndWait('(function(){ipc.network().getDevice("TestWRT").getProcess("WirelessServerProcess").setNetworkType(0);return "OK";})()');if(disable!=="OK")throw new Error("Unable to isolate AP radio.");
    await invoke("pt_associate_default_wireless",{device:"TestLaptop",ap:"TestAP",allowRestart:true});
    await invoke("pt_set_pc",{device:"TestLaptop",mode:"dhcp",port:"Wireless0"});
    await invoke("pt_read_wireless_client",{device:"TestLaptop"});
    await invoke("pt_run_cli_bulk",{device:"TestSW1",commands:"enable\nshow ip interface brief"});
    await invoke("pt_run_cli",{device:"TestDHCP",command:"ipconfig /all"});
    await invoke("pt_auto_layout",{});
    await invoke("pt_checkpoint_pkt",{directory,name:"fixture-complete",verifyReopen:true});
    await invoke("pt_latest_checkpoint",{directory});
    const until=Date.now()+45000;let ping;do{ping=JSON.parse(await invoke("pt_verify_dns",{device:"TestLaptop",hostname:"test.example"}));if(ping.resolved&&ping.icmp.successRate===100&&ping.icmp.complete)break;await Bun.sleep(1000);}while(Date.now()<until);
    if(!ping?.resolved||ping.icmp.successRate!==100||!ping.icmp.complete)throw new Error("DNS/ICMP verification failed after convergence.");
    report("PASS: fixture configuration, association, CLI, layout, DNS resolution and save/reopen persistence");
  }
  if(process.argv.includes("--verify-connectivity")){report(await bridge.sendAndWait(readWirelessJs("TestLaptop")));report(JSON.stringify(await runPing(bridge,"TestLaptop","test.example")));}
  let checked=0;
  for(const d of devices){
    const probes=/WRT/i.test(d.model)?[readWrtJs(d.name)]:/Server/i.test(d.model)?[readDnsJs(d.name),readDhcpJs(d.name,"FastEthernet0",true)]:/Laptop|Notebook/i.test(d.model)?[readWirelessJs(d.name),readEndpointJs(d.name)]:[];
    for(const code of probes){const reply=await bridge.sendAndWait(code);if(!reply||/^(ERR|ERROR):/.test(reply))throw new Error(`Native readback failed (${d.model}): ${reply}`);JSON.parse(reply);checked++;}
  }
  report(`PASS: ${checked} native readbacks; no topology modified`);
}finally{active=false;await worker;bridge.stop();await client.close();}
