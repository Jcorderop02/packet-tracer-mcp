import { expect, test, describe } from "bun:test";
import { configureDnsJs } from "../../src/ipc/dns-server.js";
function run(code:string,ipc:unknown):unknown { return Function("ipc",`return (${code});`)(ipc); }
test("DNS add failure is returned instead of hidden",()=>{const dns={addARecordToNameServerDb:()=>false};expect(run(configureDnsJs("dns",undefined,[{name:"test.example",ip:"192.0.2.2"}],[]),{network:()=>({getDevice:()=>({getProcess:()=>dns})})})).toContain("ERR:add_record_failed");});
