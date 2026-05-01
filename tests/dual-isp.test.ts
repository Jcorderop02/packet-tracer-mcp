import { describe, expect, test } from "bun:test";
import { dualIsp } from "../src/recipes/topologies/dual_isp.js";
import { validateBlueprintReferences } from "../src/recipes/blueprint.js";

describe("dualIsp recipe", () => {
  test("rejects 0 PCs", () => {
    expect(() => dualIsp({ pcs: 0 })).toThrow(/at least 1 PC/);
  });

  test("rejects more than 6 PCs", () => {
    expect(() => dualIsp({ pcs: 7 })).toThrow(/caps at 6/);
  });

  test("builds 4 base devices + N PCs and 5 base links + N PC links", () => {
    const bp = dualIsp({ pcs: 2 });
    expect(bp.devices.map(d => d.name).sort()).toEqual([
      "EDGE1", "EDGE2", "ISP", "PC1", "PC2", "SW_LAN",
    ]);
    expect(bp.devices.length).toBe(6);
    expect(bp.links.length).toBe(7);
  });

  test("HSRP and per-edge LAN IP move to extraCli (EDGE1=.2 active, EDGE2=.3 standby, virtual=.1)", () => {
    const bp = dualIsp({ pcs: 1, lanPool: "192.168.0.0/16" });
    expect(bp.advancedRouting?.hsrp).toBeUndefined();
    const extra = bp.extraCli ?? [];
    expect(extra.length).toBe(2);
    const e1 = extra.find(b => b.device === "EDGE1")!;
    const e2 = extra.find(b => b.device === "EDGE2")!;
    expect(e1.commands).toContain("interface GigabitEthernet0/2");
    expect(e1.commands).toContain("ip address 192.168.0.2 255.255.255.0");
    expect(e1.commands).toContain("standby 1 ip 192.168.0.1");
    expect(e1.commands).toContain("standby 1 priority 110");
    expect(e1.commands).toContain("standby 1 preempt");
    expect(e2.commands).toContain("ip address 192.168.0.3 255.255.255.0");
    expect(e2.commands).toContain("standby 1 ip 192.168.0.1");
    expect(e2.commands).toContain("standby 1 priority 100");
    expect(e2.commands).not.toContain("preempt");
  });

  test("BGP: EDGE1=65001, EDGE2=65002, ISP=65000 with two neighbors on ISP", () => {
    const bp = dualIsp({ pcs: 1 });
    const bgp = bp.advancedRouting?.bgp ?? [];
    expect(bgp.length).toBe(3);
    const e1 = bgp.find(b => b.device === "EDGE1")!;
    const e2 = bgp.find(b => b.device === "EDGE2")!;
    const isp = bgp.find(b => b.device === "ISP")!;
    expect(e1.asn).toBe(65001);
    expect(e2.asn).toBe(65002);
    expect(isp.asn).toBe(65000);
    expect(e1.neighbors.some(n => n.remoteAs === 65000)).toBe(true);
    expect(e2.neighbors.some(n => n.remoteAs === 65000)).toBe(true);
    expect(isp.neighbors.length).toBe(2);
    const ispRemoteAs = isp.neighbors.map(n => n.remoteAs).sort();
    expect(ispRemoteAs).toEqual([65001, 65002]);
  });

  test("DHCP comes from the addressing recipe (lan.dhcp=true) with EDGE1 as the gateway role", () => {
    const bp = dualIsp({ pcs: 2, lanPool: "10.10.0.0/16" });
    expect(bp.services).toBeUndefined();
    expect(bp.lans.length).toBe(1);
    const lan = bp.lans[0]!;
    expect(lan.gatewayDevice).toBe("EDGE1");
    expect(lan.dhcp).toBe(true);
    expect(lan.cidr).toBe("10.10.0.0/24");
  });

  test("validateBlueprintReferences finds no errors", () => {
    const bp = dualIsp({ pcs: 3 });
    expect(validateBlueprintReferences(bp)).toEqual([]);
  });
});
