import { expect, test, describe } from "bun:test";
import { installWirelessJs, associateDefaultJs, readWirelessJs } from "../../src/ipc/wireless-client.js";
function run(code:string,ipc:unknown):unknown { return Function("ipc",`return (${code});`)(ipc); }
test("adapter replacement requires explicit authorization",()=>{let powerTouched=false;const d={getModel:()=>"Laptop-PT",getPort:()=>null,getRootModule:()=>({getModuleAt:()=>({})}),setPower:()=>powerTouched=true};expect(run(installWirelessJs("laptop",false),{network:()=>({getDevice:()=>d})})).toBe("ERR:slot_occupied:pass_replace_true");expect(powerTouched).toBe(false);});
test("Default workflow rejects incompatible profile before power cycle",()=>{let restarted=false;const d={getProcess:()=>({getCurrentProfile:()=>({ssid:"Other"})}),getPort:()=>({}),getPower:()=>true,setPower:()=>restarted=true};expect(run(associateDefaultJs("pc"),{network:()=>({getDevice:()=>d})})).toBe("ERR:current_profile_not_Default");expect(restarted).toBe(false);});

test("failed adapter replacement restores the original module and power", () => {
  let module = "Ethernet";
  let power = true;
  const root = {
    getModuleAt: () => module ? { getModuleNameAsString: () => module } : null,
    removeModuleAt: () => { module = ""; },
    addModuleAt: (name: string) => { module = name; return true; },
  };
  const device = {
    getModel: () => "Laptop-PT",
    getPort: () => null,
    getPower: () => power,
    getRootModule: () => root,
    setPower: (on: boolean) => { power = on; },
  };
  expect(run(installWirelessJs("laptop", true), {
    network: () => ({ getDevice: () => device }),
  })).toBe("ERR:wireless_module_not_installed");
  expect(module).toBe("Ethernet");
  expect(power).toBe(true);
});

test("association readback does not inspect the wireless profile", () => {
  const port = {
    isWirelessPort: () => true, getLink: () => ({}), getName: () => "Wireless0",
    getIpAddress: () => "192.0.2.1", getSubnetMask: () => "255.255.255.0", isDhcpClientOn: () => false,
  };
  const device = {
    getPortCount: () => 1, getPortAt: () => port,
    getProcess: () => ({
      getCurrentApMac: () => "00:00:00:00:00:01", getSsid: () => "Default",
      getCurrentProfile: () => { throw new Error("Profile must not be read"); },
    }),
  };
  const state = JSON.parse(String(run(readWirelessJs("laptop"), {
    network: () => ({ getDevice: () => device, getDeviceCount: () => 0 }),
  })));
  expect(state.port).toBe("Wireless0");
  expect(state).not.toHaveProperty("profile");
});
