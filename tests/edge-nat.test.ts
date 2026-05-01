import { describe, expect, test } from "bun:test";
import { edgeNat, previewEdgeNatLan } from "../src/recipes/topologies/edge_nat.js";

describe("edgeNat recipe", () => {
  test("rejects 0 PCs", () => {
    expect(() => edgeNat({ pcs: 0 })).toThrow(/at least 1 PC/);
  });

  test("rejects more than 22 PCs", () => {
    expect(() => edgeNat({ pcs: 23 })).toThrow(/caps at 22/);
  });

  test("builds EDGE + ISP + SW + N PCs and 2 + N links", () => {
    const bp = edgeNat({ pcs: 3 });
    expect(bp.devices.map(d => d.name).sort()).toEqual([
      "EDGE", "ISP", "PC1", "PC2", "PC3", "SW",
    ]);
    expect(bp.links.length).toBe(2 + 3);
  });

  test("inside LAN uses the first /24 of the lan pool with DHCP enabled", () => {
    const bp = edgeNat({ pcs: 2, lanPool: "172.16.0.0/16" });
    expect(bp.lans.length).toBe(1);
    const lan = bp.lans[0]!;
    expect(lan.cidr).toBe("172.16.0.0/24");
    expect(lan.dhcp).toBe(true);
  });

  test("services bundle has ACL 1 + NAT overload + DHCP pool", () => {
    const bp = edgeNat({ pcs: 1 });
    expect(bp.services).toBeDefined();
    expect(bp.services!.acls?.length).toBe(1);
    expect(bp.services!.acls![0]!.name).toBe("1");
    expect(bp.services!.nat?.length).toBe(1);
    expect(bp.services!.nat![0]!.overload?.outsideInterface).toBe("GigabitEthernet0/0");
    expect(bp.services!.dhcpPools?.length).toBe(1);
  });

  test("withTelemetry adds NTP + Syslog targets", () => {
    const bp = edgeNat({ pcs: 1, withTelemetry: true });
    expect(bp.services!.ntp?.length).toBe(1);
    expect(bp.services!.syslog?.length).toBe(1);
  });

  test("previewEdgeNatLan agrees with the recipe's allocations", () => {
    const preview = previewEdgeNatLan({ pcs: 1, lanPool: "10.20.0.0/16" });
    expect(preview.network).toBe("10.20.0.0/24");
    expect(preview.gateway).toBe("10.20.0.1");
    expect(preview.mask).toBe("255.255.255.0");
  });
});
