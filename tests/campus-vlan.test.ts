import { describe, expect, test } from "bun:test";
import { campusVlan, previewCampusVlanAllocations } from "../src/recipes/topologies/campus_vlan.js";

describe("campusVlan recipe", () => {
  test("rejects 0 VLANs", () => {
    expect(() => campusVlan({ vlans: 0, pcsPerVlan: 1 })).toThrow(/at least 1 VLAN/);
  });

  test("rejects when access ports would exceed 22", () => {
    // 4 VLANs * 6 PCs = 24 ports > 22
    expect(() => campusVlan({ vlans: 4, pcsPerVlan: 6 })).toThrow(/access ports/);
  });

  test("builds the expected device + link inventory", () => {
    const bp = campusVlan({ vlans: 2, pcsPerVlan: 2 });
    // GW + SW + 4 PCs = 6 devices
    expect(bp.devices.map(d => d.name).sort()).toEqual([
      "GW",
      "PC_V10_1",
      "PC_V10_2",
      "PC_V20_1",
      "PC_V20_2",
      "SW",
    ]);
    // 1 trunk + 4 PC links
    expect(bp.links.length).toBe(5);
    const trunk = bp.links.find(l => l.aDevice === "GW")!;
    expect(trunk.aPort).toBe("GigabitEthernet0/0");
    expect(trunk.bDevice).toBe("SW");
    expect(trunk.bPort).toBe("GigabitEthernet0/1");
  });

  test("declares VLANs with access ports and a trunk allowing all VLAN ids", () => {
    const bp = campusVlan({ vlans: 2, pcsPerVlan: 2 });
    expect(bp.switching).toBeDefined();
    expect(bp.switching!.vlans?.length).toBe(2);
    expect(bp.switching!.vlans!.map(v => v.id)).toEqual([10, 20]);
    const trunk = bp.switching!.trunks!.find(t => t.port === "GigabitEthernet0/1")!;
    expect(trunk.allowed).toEqual([10, 20]);
    expect(trunk.encapsulation).toBe("dot1q");
  });

  test("emits router subinterfaces in extraCli", () => {
    const bp = campusVlan({ vlans: 2, pcsPerVlan: 0 });
    expect(bp.extraCli?.length).toBe(1);
    const cli = bp.extraCli![0]!.commands;
    expect(cli).toContain("interface GigabitEthernet0/0");
    expect(cli).toContain("interface GigabitEthernet0/0.10");
    expect(cli).toContain("encapsulation dot1Q 10");
    expect(cli).toContain("interface GigabitEthernet0/0.20");
    expect(cli).toContain("encapsulation dot1Q 20");
  });

  test("LAN intents carry explicit /24 CIDRs from the pool", () => {
    const bp = campusVlan({ vlans: 3, pcsPerVlan: 1, lanPool: "10.50.0.0/16" });
    expect(bp.lans.length).toBe(3);
    expect(bp.lans[0]!.cidr).toBe("10.50.0.0/24");
    expect(bp.lans[1]!.cidr).toBe("10.50.1.0/24");
    expect(bp.lans[2]!.cidr).toBe("10.50.2.0/24");
    // gatewayPort is the subinterface name — this signals to applyAddressing
    // that the gateway is externally managed (via extraCli).
    expect(bp.lans[0]!.gatewayPort).toBe("GigabitEthernet0/0.10");
  });

  test("subinterface IP in extraCli matches the previewed allocation", () => {
    const opts = { vlans: 2, pcsPerVlan: 0, lanPool: "192.168.0.0/16" } as const;
    const preview = previewCampusVlanAllocations(opts);
    expect(preview[0]).toEqual({ vlanId: 10, cidr: "192.168.0.0/24", gateway: "192.168.0.1" });
    expect(preview[1]).toEqual({ vlanId: 20, cidr: "192.168.1.0/24", gateway: "192.168.1.1" });

    const bp = campusVlan(opts);
    const cli = bp.extraCli![0]!.commands;
    expect(cli).toContain("ip address 192.168.0.1 255.255.255.0");
    expect(cli).toContain("ip address 192.168.1.1 255.255.255.0");
  });

  test("custom startVlanId / vlanStep are honoured", () => {
    const bp = campusVlan({ vlans: 3, pcsPerVlan: 0, startVlanId: 100, vlanStep: 5 });
    expect(bp.switching!.vlans!.map(v => v.id)).toEqual([100, 105, 110]);
  });
});
