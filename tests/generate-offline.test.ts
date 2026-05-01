import { describe, expect, test } from "bun:test";
import { findRecipe } from "../src/recipes/index.js";
import { generateConfigs } from "../src/recipes/generate-offline.js";

describe("generateConfigs (offline pipeline)", () => {
  test("chain with OSPF emits interfaces + router ospf for every router", () => {
    const bp = findRecipe("chain")!.build({ routers: 3, pcsPerLan: 1, routing: "ospf" });
    const out = generateConfigs(bp);

    const r1 = out.devices.find(d => d.device === "R1")!;
    expect(r1.config).toContain("ip address 192.168.0.1 255.255.255.0");
    expect(r1.config).toContain("router ospf 1");
    expect(r1.config).toContain("network 192.168.0.0 0.0.0.255 area 0");
    expect(r1.config).toContain("network 10.0.0.0 0.0.0.3 area 0");
    expect(r1.config.startsWith("enable\nterminal length 0\nconfigure terminal\nno ip domain-lookup\n")).toBe(true);
    expect(r1.config.endsWith("\nend")).toBe(true);

    expect(out.allocations.transit.size).toBe(2); // R1-R2, R2-R3
    expect(out.allocations.lans.size).toBe(3);
  });

  test("static routing installs routes only for non-attached networks", () => {
    const bp = findRecipe("chain")!.build({ routers: 3, pcsPerLan: 1, routing: "static" });
    const out = generateConfigs(bp);

    const r1 = out.devices.find(d => d.device === "R1")!;
    // R1 already has 192.168.0.0/24 connected — must not appear as static.
    expect(r1.config).not.toMatch(/ip route 192\.168\.0\.0 /);
    // R1 must reach R2's LAN and R3's LAN via R2.
    expect(r1.config).toMatch(/ip route 192\.168\.1\.0 255\.255\.255\.0 10\.0\.0\.2/);
    expect(r1.config).toMatch(/ip route 192\.168\.2\.0 255\.255\.255\.0 10\.0\.0\.2/);
  });

  test("DHCP-flagged LAN emits a DHCP pool block on the gateway and a note on each PC", () => {
    const bp = findRecipe("chain")!.build({ routers: 2, pcsPerLan: 2, routing: "static", dhcp: true });
    const out = generateConfigs(bp);

    const r1 = out.devices.find(d => d.device === "R1")!;
    expect(r1.config).toContain("ip dhcp pool LAN_R1_GigabitEthernet00");
    expect(r1.config).toContain("default-router 192.168.0.1");

    const pcNotes = out.devices.filter(d => d.device.startsWith("PC1_"));
    expect(pcNotes.length).toBe(2);
    for (const pc of pcNotes) {
      expect(pc.notes.some(n => n.includes("DHCP"))).toBe(true);
    }
  });

  test("edge_nat propagates ACL + NAT + DHCP into the EDGE config", () => {
    const bp = findRecipe("edge_nat")!.build({ pcs: 2 });
    const out = generateConfigs(bp);

    const edge = out.devices.find(d => d.device === "EDGE")!;
    expect(edge.config).toContain("access-list 1 permit 192.168.0.0 0.0.0.255");
    expect(edge.config).toContain("ip nat inside");
    expect(edge.config).toContain("ip nat outside");
    expect(edge.config).toContain("ip nat inside source list 1 interface GigabitEthernet0/0 overload");
    expect(edge.config).toContain("ip dhcp pool ");
  });

  test("voip_lab emits CME + ephone-dn on the router and DHCP option-150", () => {
    const bp = findRecipe("voip_lab")!.build({ phones: 2 });
    const out = generateConfigs(bp);
    const router = out.devices.find(d => d.category === "router")!;
    expect(router.config).toContain("telephony-service");
    expect(router.config).toMatch(/ephone-dn 1\n number 1001/);
    expect(router.config).toMatch(/option 150 ip /);
  });

  test("ipv6_lab emits ipv6 unicast-routing + per-interface OSPFv3 binding", () => {
    const bp = findRecipe("ipv6_lab")!.build({});
    const out = generateConfigs(bp);
    const r6a = out.devices.find(d => d.device === "R6A")!;
    expect(r6a.config).toContain("ipv6 unicast-routing");
    expect(r6a.config).toContain("ipv6 router ospf 1");
    expect(r6a.config).toContain("ipv6 address 2001:DB8:1::1/64");
    expect(r6a.config).toContain("ipv6 ospf 1 area 0");
  });

  test("non-IOS endpoints (PCs) get notes and an empty config", () => {
    const bp = findRecipe("chain")!.build({ routers: 2, pcsPerLan: 1, routing: "static" });
    const out = generateConfigs(bp);
    const pc = out.devices.find(d => d.category === "pc")!;
    expect(pc.config).toBe("");
    expect(pc.notes.length).toBeGreaterThan(0);
    expect(pc.notes[0]!).toMatch(/static ip=/);
  });

  test("routing=none skips every router-protocol block", () => {
    const bp = findRecipe("chain")!.build({ routers: 2, pcsPerLan: 1, routing: "none" });
    const out = generateConfigs(bp);
    for (const d of out.devices) {
      expect(d.config).not.toMatch(/router (ospf|eigrp|rip|bgp)/);
      expect(d.config).not.toMatch(/^ip route /m);
    }
  });
});
