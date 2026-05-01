import { describe, expect, test } from "bun:test";
import {
  ipv6InterfaceCli,
  ipv6OspfCli,
  ipv6StaticRouteCli,
  routerIpv6Body,
  unicastRoutingCli,
  validateIpv6Interface,
  validateIpv6Ospf,
  validateIpv6Static,
  wrapInConfig,
} from "../src/recipes/ipv6/cli.js";

describe("ipv6 CLI builders", () => {
  test("ipv6InterfaceCli emits enable + address + no shutdown by default", () => {
    const cli = ipv6InterfaceCli({
      device: "R1",
      port: "GigabitEthernet0/0",
      address: "2001:DB8:1::1/64",
    });
    expect(cli).toContain("interface GigabitEthernet0/0");
    expect(cli).toContain(" ipv6 enable");
    expect(cli).toContain(" ipv6 address 2001:DB8:1::1/64");
    expect(cli).toContain(" no shutdown");
    expect(cli).not.toContain("ipv6 ospf");
  });

  test("ipv6InterfaceCli omits link-local when enableLinkLocal is false", () => {
    const cli = ipv6InterfaceCli({
      device: "R1",
      port: "GigabitEthernet0/0",
      address: "2001:DB8:1::1/64",
      enableLinkLocal: false,
    });
    expect(cli).not.toContain("ipv6 enable");
  });

  test("ipv6InterfaceCli adds ospf binding with default area 0", () => {
    const cli = ipv6InterfaceCli({
      device: "R1",
      port: "GigabitEthernet0/0",
      address: "2001:DB8:1::1/64",
      ospfPid: 1,
    });
    expect(cli).toContain(" ipv6 ospf 1 area 0");
  });

  test("ipv6OspfCli emits process and optional router-id", () => {
    expect(ipv6OspfCli({ device: "R1", pid: 1 })).toBe(["ipv6 router ospf 1", " exit"].join("\n"));
    expect(ipv6OspfCli({ device: "R1", pid: 1, routerId: "1.1.1.1" })).toContain(" router-id 1.1.1.1");
  });

  test("ipv6StaticRouteCli emits prefix + next-hop + optional distance", () => {
    expect(ipv6StaticRouteCli({ device: "R1", prefix: "::/0", nextHop: "2001:DB8:F::2" })).toBe("ipv6 route ::/0 2001:DB8:F::2");
    expect(ipv6StaticRouteCli({ device: "R1", prefix: "2001:DB8:2::/64", nextHop: "2001:DB8:F::2", distance: 200 })).toBe(
      "ipv6 route 2001:DB8:2::/64 2001:DB8:F::2 200",
    );
  });

  test("unicastRoutingCli is the literal global switch", () => {
    expect(unicastRoutingCli()).toBe("ipv6 unicast-routing");
  });

  test("routerIpv6Body orders unicast-routing -> ospf -> interfaces -> static", () => {
    const body = routerIpv6Body({
      enableUnicastRouting: true,
      ospf: [{ device: "R1", pid: 1 }],
      interfaces: [{ device: "R1", port: "Gi0/0", address: "2001:DB8:1::1/64", ospfPid: 1 }],
      staticRoutes: [{ device: "R1", prefix: "::/0", nextHop: "2001:DB8:F::2" }],
    });
    expect(body.indexOf("ipv6 unicast-routing")).toBeLessThan(body.indexOf("ipv6 router ospf"));
    expect(body.indexOf("ipv6 router ospf")).toBeLessThan(body.indexOf("interface Gi0/0"));
    expect(body.indexOf("interface Gi0/0")).toBeLessThan(body.indexOf("ipv6 route ::/0"));
  });

  test("routerIpv6Body skips unicast-routing when disabled", () => {
    const body = routerIpv6Body({
      enableUnicastRouting: false,
      ospf: [],
      interfaces: [{ device: "R1", port: "Gi0/0", address: "2001:DB8:1::1/64" }],
      staticRoutes: [],
    });
    expect(body).not.toContain("ipv6 unicast-routing");
    expect(body).toContain("interface Gi0/0");
  });

  test("wrapInConfig wraps in the canonical PT-9-safe prologue", () => {
    expect(wrapInConfig("foo")).toBe(
      "enable\nterminal length 0\nconfigure terminal\nno ip domain-lookup\nfoo\nend",
    );
  });
});

describe("ipv6 validation", () => {
  test("validateIpv6Interface rejects bad CIDR", () => {
    expect(() => validateIpv6Interface({ device: "R", port: "Gi0/0", address: "2001:DB8:1::1" })).toThrow(/CIDR/);
    expect(() => validateIpv6Interface({ device: "R", port: "Gi0/0", address: "2001:DB8:1::1/200" })).toThrow(/prefix/);
    expect(() => validateIpv6Interface({ device: "R", port: "Gi0/0", address: "ZZZ::1/64" })).toThrow(/CIDR|address/);
  });

  test("validateIpv6Interface bounds ospf pid + area", () => {
    expect(() => validateIpv6Interface({ device: "R", port: "Gi0/0", address: "2001:DB8:1::1/64", ospfPid: 0 })).toThrow(/pid/);
    expect(() => validateIpv6Interface({ device: "R", port: "Gi0/0", address: "2001:DB8:1::1/64", ospfPid: 1, ospfArea: -1 })).toThrow(/area/);
  });

  test("validateIpv6Ospf bounds pid and validates router-id format", () => {
    expect(() => validateIpv6Ospf({ device: "R", pid: 0 })).toThrow(/pid/);
    expect(() => validateIpv6Ospf({ device: "R", pid: 1, routerId: "not-an-ipv4" })).toThrow(/router-id/);
  });

  test("validateIpv6Static rejects bad next-hop", () => {
    expect(() => validateIpv6Static({ device: "R", prefix: "::/0", nextHop: "WAT" })).toThrow(/next-hop/);
    expect(() => validateIpv6Static({ device: "R", prefix: "1.2.3.4/24", nextHop: "2001:DB8::1" })).toThrow(/CIDR|address/);
    expect(() => validateIpv6Static({ device: "R", prefix: "::/0", nextHop: "2001:DB8::1", distance: 0 })).toThrow(/distance/);
  });

  test("rejects multiple :: abbreviations", () => {
    expect(() => validateIpv6Interface({ device: "R", port: "Gi0/0", address: "2001::DB8::1/64" })).toThrow(/address/);
  });
});
