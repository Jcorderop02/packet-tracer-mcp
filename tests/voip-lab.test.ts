import { describe, expect, test } from "bun:test";
import { previewVoipLab, voipLab } from "../src/recipes/topologies/voip_lab.js";
import { findRecipe } from "../src/recipes/index.js";
import { resolveModel } from "../src/catalog/devices.js";

describe("voip_lab recipe", () => {
  test("rejects 0 phones and >6 phones", () => {
    expect(() => voipLab({ phones: 0 })).toThrow(/phones/);
    expect(() => voipLab({ phones: 7 })).toThrow(/phones/);
  });

  test("builds CME + VSW + N IP Phones with N+1 links", () => {
    const bp = voipLab({ phones: 2 });
    const names = bp.devices.map(d => d.name);
    expect(names).toContain("CME");
    expect(names).toContain("VSW");
    expect(names).toContain("PHONE1");
    expect(names).toContain("PHONE2");
    expect(bp.devices.find(d => d.name === "PHONE1")?.model).toBe("7960");
    expect(bp.links.length).toBe(3);
    const phoneLink = bp.links.find(l => l.aDevice === "PHONE1");
    expect(phoneLink?.aPort).toBe("Port 0");
  });

  test("LAN intent disables router-side dhcp because services owns the voice pool", () => {
    const bp = voipLab({ phones: 2 });
    expect(bp.lans).toHaveLength(1);
    expect(bp.lans[0]?.dhcp).toBe(false);
  });

  test("services bundle has DHCP pool with option-150 pointing to gateway", () => {
    const bp = voipLab({ phones: 3 });
    const pool = bp.services?.dhcpPools?.[0];
    expect(pool?.tftpServer).toBeDefined();
    expect(pool?.tftpServer).toBe(pool?.defaultRouter);
  });

  test("switching VLANs include data + voice", () => {
    const bp = voipLab({ phones: 2, voiceVlanId: 200, dataVlanId: 20 });
    const ids = bp.switching?.vlans?.map(v => v.id) ?? [];
    expect(ids).toContain(20);
    expect(ids).toContain(200);
  });

  test("voip block uses auto-assign and ephone-dns; no ephones with synthetic MACs", () => {
    const bp = voipLab({ phones: 3, startingExtension: 2001 });
    expect(bp.voip?.cme?.[0]?.maxEphones).toBe(3);
    expect(bp.voip?.cme?.[0]?.maxDn).toBe(3);
    expect(bp.voip?.cme?.[0]?.autoAssign).toEqual({ first: 1, last: 3 });
    const dnNumbers = bp.voip?.ephoneDns?.map(d => d.number) ?? [];
    expect(dnNumbers).toEqual(["2001", "2002", "2003"]);
    expect(bp.voip?.ephones).toBeUndefined();
    expect(bp.voip?.voiceVlans?.length).toBe(3);
    expect(bp.voip?.voiceVlans?.[0]?.port).toBe("FastEthernet0/1");
  });

  test("default router is 2811 (CME ready out-of-the-box) and uses FastEthernet for LAN port", () => {
    const bp = voipLab({ phones: 1 });
    const cme = bp.devices.find(d => d.name === "CME");
    expect(cme?.model).toBe("2811");
    const cmeLink = bp.links.find(l => l.aDevice === "CME" || l.bDevice === "CME");
    expect(cmeLink?.aPort).toBe("FastEthernet0/0");
  });

  test("router model 2911 selects GigabitEthernet0/0 LAN port from catalog", () => {
    const bp = voipLab({ phones: 1, routerModel: "2911" });
    const cmeLink = bp.links.find(l => l.aDevice === "CME" || l.bDevice === "CME");
    expect(cmeLink?.aPort).toBe("GigabitEthernet0/0");
  });

  test("previewVoipLab agrees with the recipe", () => {
    const preview = previewVoipLab({ phones: 2, lanPool: "192.168.50.0/24" });
    expect(preview.network).toBe("192.168.50.0/24");
    expect(preview.gateway).toBe("192.168.50.1");
    expect(preview.extensions).toEqual(["1001", "1002"]);
  });

  test("recipe is registered in RECIPES under key voip_lab", () => {
    const r = findRecipe("voip_lab");
    expect(r).toBeDefined();
    const bp = r!.build({ phones: 1 });
    expect(bp.name).toBe("voip-lab-1p");
  });

  test("catalog resolves the IP Phone via ptType and aliases", () => {
    expect(resolveModel("7960")?.category).toBe("ipphone");
    expect(resolveModel("7960")?.ports[0]?.fullName).toBe("Switch");
    expect(resolveModel("7960")?.ports[1]?.fullName).toBe("PC");
    expect(resolveModel("phone")?.ptType).toBe("7960");
    expect(resolveModel("ipphone")?.ptType).toBe("7960");
  });
});
