import { describe, expect, test } from "bun:test";
import { ipv6Lab, previewIpv6Lab } from "../src/recipes/topologies/ipv6_lab.js";
import { findRecipe } from "../src/recipes/index.js";
import { validateBlueprintReferences } from "../src/recipes/blueprint.js";

describe("ipv6_lab recipe", () => {
  test("builds 2 routers + 2 switches + 2 PCs with 5 links", () => {
    const bp = ipv6Lab();
    const names = bp.devices.map(d => d.name).sort();
    expect(names).toEqual(["PCA", "PCB", "R6A", "R6B", "SWA", "SWB"]);
    expect(bp.links).toHaveLength(5);
  });

  test("blueprint references are valid", () => {
    expect(validateBlueprintReferences(ipv6Lab())).toEqual([]);
  });

  test("ipv6 intent has unicast-routing on, 4 interfaces, 2 ospf processes, 2 endpoints", () => {
    const bp = ipv6Lab();
    expect(bp.ipv6?.unicastRouting).toBe(true);
    expect(bp.ipv6?.interfaces).toHaveLength(4);
    expect(bp.ipv6?.ospf).toHaveLength(2);
    expect(bp.ipv6?.endpoints).toHaveLength(2);
  });

  test("each LAN interface binds to OSPFv3 area 0 by default", () => {
    const bp = ipv6Lab();
    for (const i of bp.ipv6?.interfaces ?? []) {
      expect(i.ospfPid).toBe(1);
      expect(i.ospfArea).toBe(0);
    }
  });

  test("enableOspf=false drops ospf processes and bindings", () => {
    const bp = ipv6Lab({ enableOspf: false });
    expect(bp.ipv6?.ospf ?? []).toEqual([]);
    for (const i of bp.ipv6?.interfaces ?? []) {
      expect(i.ospfPid).toBeUndefined();
    }
  });

  test("addresses follow 2001:DB8:N::/64 schema and gateways are ::1", () => {
    const bp = ipv6Lab();
    const r6aLan = bp.ipv6?.interfaces?.find(i => i.device === "R6A" && i.port.endsWith("0/0"));
    const pca = bp.ipv6?.endpoints?.find(e => e.device === "PCA");
    expect(r6aLan?.address).toBe("2001:DB8:1::1/64");
    expect(pca?.address).toBe("2001:DB8:1::2/64");
    expect(pca?.gateway).toBe("2001:DB8:1::1");
  });

  test("OSPFv3 router-ids are unique and dotted-quad", () => {
    const bp = ipv6Lab();
    const ids = bp.ipv6?.ospf?.map(o => o.routerId) ?? [];
    expect(ids).toEqual(["1.1.1.1", "2.2.2.2"]);
  });

  test("default routing is static so IPv4 stack still gets a route", () => {
    expect(ipv6Lab().routing).toBe("static");
  });

  test("recipe is registered under key ipv6_lab", () => {
    const r = findRecipe("ipv6_lab");
    expect(r).toBeDefined();
    const bp = r!.build({});
    expect(bp.name).toBe("ipv6-lab-2r-2pc");
    expect(bp.ipv6?.interfaces?.length).toBe(4);
  });

  test("custom ospfPid propagates everywhere", () => {
    const bp = ipv6Lab({ ospfPid: 42 });
    for (const o of bp.ipv6?.ospf ?? []) expect(o.pid).toBe(42);
    for (const i of bp.ipv6?.interfaces ?? []) expect(i.ospfPid).toBe(42);
  });

  test("preview reports the LAN/transit prefixes", () => {
    const p = previewIpv6Lab();
    expect(p.lans).toHaveLength(2);
    expect(p.transit.v6).toBe("2001:DB8:F::/64");
  });
});
