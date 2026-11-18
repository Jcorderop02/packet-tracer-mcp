import { expect, test } from "bun:test";
import { readWirelessJs } from "../../src/ipc/wireless-client.js";

import { resolveModel } from "../../src/catalog/devices.js";
import { addDeviceJs } from "../../src/ipc/generator.js";
import { registerListDevicesTool } from "../../src/tools/list-devices.js";
import type { ToolContext } from "../../src/tools/types.js";

test("lightweight APs use the distinct native factory ID and keep the AP layout role", () => {
  for (const model of ["LAP-PT", "3702i"]) {
    expect(resolveModel(model)?.category).toBe("accesspoint");
    expect(addDeviceJs({ name: "AP", model, category: "accesspoint", x: 40, y: 50 }))
      .toContain(`lw.addDevice(44,"${model}",40,50)`);
  }
  expect(addDeviceJs({ name: "AP", model: "AccessPoint-PT", category: "accesspoint", x: 40, y: 50 }))
    .toContain('lw.addDevice(7,"AccessPoint-PT",40,50)');
});

test("the live palette distinguishes installed and supported model names", async () => {
  let invoke!: (args: { source: string }) => Promise<{ content: { text: string }[] }>;
  const ipc = { appWindow: () => ({ getNetworkComponentBox: () => ({
    getDeviceTypes: () => ["Wireless Devices"],
    getDeviceModels: () => ["3702i", "Synthetic unsupported"],
  }) }) };
  registerListDevicesTool({
    bridge: {
      status: () => ({ connected: true }),
      sendAndWait: async (code: string) => Function("ipc", `return (${code})`)(ipc),
    },
    server: { tool: (_name: string, _description: string, _schema: unknown, action: typeof invoke) => { invoke = action; } },
  } as unknown as ToolContext);
  const result = await invoke({ source: "palette" });
  expect(JSON.parse(result.content[0]!.text)).toEqual([{ category: "Wireless Devices", models: [
    { name: "3702i", supported: true }, { name: "Synthetic unsupported", supported: false },
  ] }]);
});

test("wireless clients can identify a lightweight AP by its native radio MAC", () => {
  const port = {
    isWirelessPort: () => true, getLink: () => true, getName: () => "Wireless0",
    getIpAddress: () => "10.0.0.5", getSubnetMask: () => "255.255.255.0", isDhcpClientOn: () => true,
  };
  const pc = {
    getProcess: () => ({ getSsid: () => "ssid1", getCurrentApMac: () => "0090.0C1D.B202" }),
    getPortCount: () => 1, getPortAt: () => port, getModel: () => "PC-PT",
  };
  const ap = {
    getModel: () => "LAP-PT", getName: () => "Managed AP",
    getPort: (name: string) => name === "Dot11Radio0" ? { getMacAddress: () => "00:90:0c:1d:b2:02" } : null,
  };
  const ipc = { network: () => ({ getDevice: () => pc, getDeviceCount: () => 2, getDeviceAt: (i: number) => [pc, ap][i] }) };
  const run = Function("ipc", `return (${readWirelessJs("PC")});`);
  expect(JSON.parse(run(ipc))).toMatchObject({ associated: true, accessPoints: ["Managed AP"], ip: "10.0.0.5", dhcp: true });
});
