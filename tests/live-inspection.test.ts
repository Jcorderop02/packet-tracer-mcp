import { expect, test } from "bun:test";
import type { Bridge } from "../src/bridge/http-bridge.js";
import { captureSnapshot } from "../src/canvas/snapshot.js";
import { bgpPeers, ospfPeers, learnedRoutes, ospfv3Peers, ospfv3Routes } from "../src/tools/verify-routing.js";

test("live snapshot reads both native cable ends once and does not need a prior registry", async () => {
  let endpointReads = 0;
  const cable = {
    getObjectUuid: () => "one-cable",
    getPort1: () => { endpointReads++; return a.port; },
    getPort2: () => b.port,
  };
  function device(name: string, portName: string) {
    const port = {
      getName: () => portName, getOwnerDevice: () => dev, getLink: () => cable,
    };
    const dev = {
      getName: () => name, getModel: () => "1941", getClassName: () => "Router",
      getXCoordinate: () => 10, getYCoordinate: () => 20, getPortCount: () => 1,
      getPortAt: () => port, getPower: () => true,
    };
    return { port, dev };
  }
  const a = device("R1", "GigabitEthernet0/0"), b = device("R2", "GigabitEthernet0/1");
  const ipc = {
    network: () => ({ getDeviceCount: () => 2, getDeviceAt: (i: number) => [a.dev, b.dev][i] }),
    appWindow: () => ({ getActiveWorkspace: () => ({ getLogicalWorkspace: () => ({}) }) }),
  };
  const bridge = { sendAndWait: async (source: string) => Function("ipc", `return (${source});`)(ipc) } as unknown as Bridge;
  expect((await captureSnapshot(bridge)).links).toEqual([
    { aDevice: "R1", aPort: "GigabitEthernet0/0", bDevice: "R2", bPort: "GigabitEthernet0/1" },
  ]);
  expect(endpointReads).toBe(1);
});

test("routing diagnostics distinguish established peers and installed protocol routes", () => {
  const peers = bgpPeers("BGP neighbor is 10.0.0.2, remote AS 65001, external link\n  BGP state = Established, up for 00:05:05\nBGP neighbor is 10.0.0.6, remote AS 65002, external link\n  BGP state = Connecting, up for 00:00:05");
  expect(peers.map(peer => peer.established)).toEqual([true, false]);
  expect(ospfPeers("1.1.1.1 1 FULL/DR 00:00:37 10.0.0.2 GigabitEthernet0/0")[0]?.full).toBe(true);
  const routes = "  O IA 192.0.2.0/24 [110/2] via 10.0.0.2\nB 198.51.100.0/24 [20/0] via 10.0.0.6\nC 10.0.0.0/30 is directly connected";
  expect(learnedRoutes(routes, "ospf")).toEqual(["192.0.2.0/24"]);
  expect(learnedRoutes(routes, "bgp")).toEqual(["198.51.100.0/24"]);
});

test("IPv6 routing recognizes OSPFv3 router IDs and canonicalizes learned prefixes", () => {
  expect(ospfv3Peers("192.0.2.1  1  FULL/DR  00:00:31  5  GigabitEthernet0/1")).toEqual([
    { routerId: "192.0.2.1", state: "FULL/DR", full: true, interface: "GigabitEthernet0/1" },
  ]);
  expect(ospfv3Routes("O   2001:0DB8:0020:0000::/64 [110/2]\n     via FE80::1\nC  2001:DB8:1::/64")).toEqual(["2001:db8:20::/64"]);
});
