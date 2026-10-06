import { expect, test, describe } from "bun:test";
import { installWirelessJs, associateDefaultJs } from "../../src/ipc/wireless-client.js";
function run(code:string,ipc:unknown):unknown { return Function("ipc",`return (${code});`)(ipc); }
test("adapter replacement requires explicit authorization",()=>{let powerTouched=false;const d={getModel:()=>"Laptop-PT",getPort:()=>null,getRootModule:()=>({getModuleAt:()=>({})}),setPower:()=>powerTouched=true};expect(run(installWirelessJs("laptop",false),{network:()=>({getDevice:()=>d})})).toBe("ERR:slot_occupied:pass_replace_true");expect(powerTouched).toBe(false);});
test("Default workflow rejects incompatible profile before power cycle",()=>{let restarted=false;const d={getProcess:()=>({getCurrentProfile:()=>({ssid:"Other"})}),getPort:()=>({}),getPower:()=>true,setPower:()=>restarted=true};expect(run(associateDefaultJs("pc"),{network:()=>({getDevice:()=>d})})).toBe("ERR:current_profile_not_Default");expect(restarted).toBe(false);});
