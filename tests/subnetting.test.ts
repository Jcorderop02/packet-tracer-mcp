import { describe, expect, test } from "bun:test";
import {
  intToIp,
  ipToInt,
  iterSubnets,
  parseCidr,
  parseInterface,
  prefixToMask,
  prefixToWildcard,
  sameSubnet,
  SubnetIterator,
  subnetHosts,
  subnetMask,
} from "../src/canvas/subnetting.js";

describe("ipToInt / intToIp", () => {
  test("roundtrips classful and CIDR boundary addresses", () => {
    const samples = ["0.0.0.0", "255.255.255.255", "10.0.0.1", "192.168.1.1", "172.16.255.254"];
    for (const ip of samples) expect(intToIp(ipToInt(ip))).toBe(ip);
  });

  test("rejects malformed addresses", () => {
    expect(() => ipToInt("256.0.0.0")).toThrow();
    expect(() => ipToInt("10.0.0")).toThrow();
    expect(() => ipToInt("a.b.c.d")).toThrow();
  });
});

describe("prefixToMask / prefixToWildcard", () => {
  test("classic prefixes round-trip", () => {
    expect(prefixToMask(0)).toBe("0.0.0.0");
    expect(prefixToMask(8)).toBe("255.0.0.0");
    expect(prefixToMask(16)).toBe("255.255.0.0");
    expect(prefixToMask(24)).toBe("255.255.255.0");
    expect(prefixToMask(30)).toBe("255.255.255.252");
    expect(prefixToMask(32)).toBe("255.255.255.255");
  });

  test("wildcard mirrors the mask", () => {
    expect(prefixToWildcard(0)).toBe("255.255.255.255");
    expect(prefixToWildcard(8)).toBe("0.255.255.255");
    expect(prefixToWildcard(24)).toBe("0.0.0.255");
    expect(prefixToWildcard(30)).toBe("0.0.0.3");
    expect(prefixToWildcard(32)).toBe("0.0.0.0");
  });

  test("rejects out-of-range prefixes", () => {
    expect(() => prefixToMask(-1)).toThrow();
    expect(() => prefixToMask(33)).toThrow();
    expect(() => prefixToWildcard(-1)).toThrow();
    expect(() => prefixToWildcard(33)).toThrow();
  });
});

describe("parseCidr", () => {
  test("normalises a host address into a network address", () => {
    expect(parseCidr("192.168.1.55/24")).toEqual({ network: "192.168.1.0", prefix: 24 });
    expect(parseCidr("10.0.0.5/30")).toEqual({ network: "10.0.0.4", prefix: 30 });
    expect(parseCidr("0.0.0.0/0")).toEqual({ network: "0.0.0.0", prefix: 0 });
  });

  test("rejects malformed CIDRs", () => {
    expect(() => parseCidr("10.0.0.0")).toThrow();
    expect(() => parseCidr("10.0.0.0/33")).toThrow();
    expect(() => parseCidr("10.0.0.0/abc")).toThrow();
  });
});

describe("parseInterface", () => {
  test("keeps the host address while tracking the subnet", () => {
    const iface = parseInterface("10.0.0.5/30");
    expect(iface.host).toBe("10.0.0.5");
    expect(iface.subnet).toEqual({ network: "10.0.0.4", prefix: 30 });
  });

  test("rejects bad host", () => {
    expect(() => parseInterface("10.0.0.999/30")).toThrow();
  });
});

describe("iterSubnets", () => {
  test("splits a /24 into four /26s in order", () => {
    const out = [...iterSubnets("192.168.0.0/24", 26)];
    expect(out).toEqual([
      { network: "192.168.0.0",   prefix: 26 },
      { network: "192.168.0.64",  prefix: 26 },
      { network: "192.168.0.128", prefix: 26 },
      { network: "192.168.0.192", prefix: 26 },
    ]);
  });

  test("splits a /16 into 65536 /32s without exhaustion of the generator (sample first 4)", () => {
    const it = iterSubnets("10.0.0.0/16", 32);
    const taken: string[] = [];
    for (const s of it) {
      taken.push(s.network);
      if (taken.length === 4) break;
    }
    expect(taken).toEqual(["10.0.0.0", "10.0.0.1", "10.0.0.2", "10.0.0.3"]);
  });

  test("rejects coarser child than parent", () => {
    expect(() => [...iterSubnets("10.0.0.0/24", 16)]).toThrow();
  });
});

describe("SubnetIterator", () => {
  test("hands out fresh /30s and finally throws on exhaustion", () => {
    const it = new SubnetIterator("10.0.0.0/29", 30);
    expect(it.next()).toEqual({ network: "10.0.0.0", prefix: 30 });
    expect(it.next()).toEqual({ network: "10.0.0.4", prefix: 30 });
    expect(() => it.next()).toThrow(/exhausted/);
  });
});

describe("subnetHosts", () => {
  test("/24 has 254 usable hosts, network and broadcast excluded", () => {
    const hosts = subnetHosts({ network: "192.168.0.0", prefix: 24 });
    expect(hosts.length).toBe(254);
    expect(hosts[0]).toBe("192.168.0.1");
    expect(hosts[hosts.length - 1]).toBe("192.168.0.254");
  });

  test("/30 yields exactly two usable addresses", () => {
    expect(subnetHosts({ network: "10.0.0.4", prefix: 30 })).toEqual(["10.0.0.5", "10.0.0.6"]);
  });

  test("/31 RFC 3021 yields both endpoints", () => {
    expect(subnetHosts({ network: "10.0.0.0", prefix: 31 })).toEqual(["10.0.0.0", "10.0.0.1"]);
  });

  test("/32 yields a single address", () => {
    expect(subnetHosts({ network: "10.0.0.5", prefix: 32 })).toEqual(["10.0.0.5"]);
  });
});

describe("subnetMask / sameSubnet", () => {
  test("subnetMask matches prefixToMask", () => {
    expect(subnetMask({ network: "10.0.0.0", prefix: 30 })).toBe("255.255.255.252");
  });
  test("sameSubnet on identity and difference", () => {
    expect(sameSubnet({ network: "10.0.0.0", prefix: 30 }, { network: "10.0.0.0", prefix: 30 })).toBe(true);
    expect(sameSubnet({ network: "10.0.0.0", prefix: 30 }, { network: "10.0.0.4", prefix: 30 })).toBe(false);
  });
});
