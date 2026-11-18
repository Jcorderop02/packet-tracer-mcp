import { expect, test } from "bun:test";
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
