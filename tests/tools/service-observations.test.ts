import { expect, test } from "bun:test";
import { registerReadPlcIoTool } from "../../src/tools/read-plc-io.js";
import type { ToolContext } from "../../src/tools/types.js";

import { parseDiscovery } from "../../src/tools/read-discovery.js";
import { ftpGreeting } from "../../src/tools/verify-ftp.js";
import { parseNtp } from "../../src/tools/verify-ntp.js";

test("discovery accepts Cisco abbreviated interfaces with a separating space", () => {
  const output = "Device ID    Local Intrfce   Holdtme    Capability   Platform    Port ID\n" +
    "Switch       Gig 0/0          172            S       2960        Fas 0/1\nRouter#";
  expect(parseDiscovery(output)).toMatchObject([
    { neighbor: "Switch", localPort: "Gig 0/0", remotePort: "Fas 0/1", holdSeconds: 172 },
  ]);
  expect(parseDiscovery("% LLDP is not enabled")).toEqual([]);
});

test("NTP distinguishes a configured server from a selected synchronized peer", () => {
  const pending = parseNtp("Clock is unsynchronized, stratum 16, no reference clock",
    " ~192.0.2.12 .INIT. 16 - 64 0 0.00");
  expect(pending).toMatchObject({ synchronized: false, peers: [{ address: "192.0.2.12", selected: false }] });
  const synced = parseNtp("Clock is synchronized, stratum 2, reference is 192.0.2.12",
    "*~192.0.2.12 .GPS. 1 2 64 377 0.00");
  expect(synced).toMatchObject({ synchronized: true, reference: "192.0.2.12",
    peers: [{ address: "192.0.2.12", selected: true, reach: "377" }] });
});

test("FTP needs a fresh connected endpoint and protocol greeting", () => {
  const output = "Trying to connect...192.0.2.12\nConnected to 192.0.2.12\n220- Welcome to PT Ftp server\nUsername:";
  expect(ftpGreeting(output, "192.0.2.12")).toBe("220- Welcome to PT Ftp server");
  expect(ftpGreeting(output, "192.0.2.13")).toBeUndefined();
  expect(ftpGreeting("Trying to connect...192.0.2.12", "192.0.2.12")).toBeUndefined();
});

test("PLC reads the digital and analog slots using each native offset", async () => {
  const offsets: number[] = [];
  const plc = {
    getModel: () => "PLC-PT", getName: () => "PLC1",
    getDigitalSlotsCount: () => 1, getDigitalSlotsOffset: () => 0,
    getAnalogSlotsCount: () => 1, getAnalogSlotsOffset: () => 10,
    getComponentAtSlot: (slot: number) => {
      offsets.push(slot);
      return { getSlotName: () => "Slot " + slot, digitalRead: () => 1, analogRead: () => 123 };
    },
  };
  const ipc = { network: () => ({ getDevice: () => plc }) };
  let call!: ({ device }: { device: string }) => Promise<{ content: { text: string }[] }>;
  registerReadPlcIoTool({
    bridge: {
      status: () => ({ connected: true }),
      sendAndWait: async (code: string) => Function("ipc", `return (${code});`)(ipc),
    },
    server: { tool: (_name: string, _description: string, _schema: unknown, handler: typeof call) => { call = handler; } },
  } as unknown as ToolContext);
  const reply = await call({ device: "PLC1" });
  expect(JSON.parse(reply.content[0]!.text)).toMatchObject({
    digital: [{ slot: 0, value: 1 }], analog: [{ slot: 10, value: 123 }],
  });
  expect(offsets).toEqual([0, 10]);
});
