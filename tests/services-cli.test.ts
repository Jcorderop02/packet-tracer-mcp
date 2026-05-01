import { describe, expect, test } from "bun:test";
import {
  aclCli,
  dhcpPoolCli,
  dhcpRelayCli,
  natCli,
  normaliseAclEndpoint,
  ntpCli,
  syslogCli,
  wrapInConfig,
} from "../src/recipes/services/cli.js";

describe("normaliseAclEndpoint", () => {
  test("any passes through", () => {
    expect(normaliseAclEndpoint("any")).toBe("any");
  });
  test("host form passes through", () => {
    expect(normaliseAclEndpoint("host 10.0.0.1")).toBe("host 10.0.0.1");
  });
  test("CIDR /32 collapses to host", () => {
    expect(normaliseAclEndpoint("10.0.0.1/32")).toBe("host 10.0.0.1");
  });
  test("CIDR /24 expands to network + wildcard", () => {
    expect(normaliseAclEndpoint("192.168.10.0/24")).toBe("192.168.10.0 0.0.0.255");
  });
  test("network + wildcard form passes through", () => {
    expect(normaliseAclEndpoint("10.0.0.0 0.0.0.255")).toBe("10.0.0.0 0.0.0.255");
  });
});

describe("aclCli", () => {
  test("numbered standard ACL emits global access-list lines", () => {
    const cli = aclCli({
      device: "R1",
      name: "1",
      kind: "standard",
      rules: [{ action: "permit", source: "192.168.10.0/24" }],
    });
    expect(cli).toBe("access-list 1 permit 192.168.10.0 0.0.0.255");
  });

  test("numbered extended ACL with port match", () => {
    const cli = aclCli({
      device: "R1",
      name: "100",
      kind: "extended",
      rules: [
        { action: "permit", protocol: "tcp", source: "any", destination: "host 10.0.0.5", portOp: "eq", ports: [80] },
      ],
    });
    expect(cli).toBe("access-list 100 permit tcp any host 10.0.0.5 eq 80");
  });

  test("named ACL uses sub-mode and binds to interface when applyTo is set", () => {
    const cli = aclCli({
      device: "R1",
      name: "INSIDE",
      kind: "extended",
      rules: [{ action: "deny", protocol: "ip", source: "any", destination: "any" }],
      applyTo: [{ port: "GigabitEthernet0/0", direction: "in" }],
    });
    expect(cli).toBe(
      [
        "ip access-list extended INSIDE",
        " deny ip any any",
        " exit",
        "interface GigabitEthernet0/0",
        " ip access-group INSIDE in",
        " exit",
      ].join("\n"),
    );
  });

  test("replaceExisting wipes the named ACL first", () => {
    const cli = aclCli({
      device: "R1",
      name: "INSIDE",
      kind: "standard",
      rules: [{ action: "permit", source: "any" }],
      replaceExisting: true,
    });
    expect(cli.startsWith("no ip access-list standard INSIDE")).toBe(true);
  });
});

describe("natCli", () => {
  test("interface roles + overload via outside interface", () => {
    const cli = natCli({
      device: "R1",
      interfaces: [
        { port: "Gi0/1", role: "inside" },
        { port: "Gi0/0", role: "outside" },
      ],
      overload: { aclName: "1", outsideInterface: "Gi0/0" },
    });
    expect(cli).toBe(
      [
        "interface Gi0/1",
        " ip nat inside",
        " exit",
        "interface Gi0/0",
        " ip nat outside",
        " exit",
        "ip nat inside source list 1 interface Gi0/0 overload",
      ].join("\n"),
    );
  });

  test("static port-forward emits protocol form", () => {
    const cli = natCli({
      device: "R1",
      statics: [{ insideLocal: "10.0.0.10", insideGlobal: "203.0.113.5", protocol: "tcp", localPort: 80, globalPort: 8080 }],
    });
    expect(cli).toContain("ip nat inside source static tcp 10.0.0.10 80 203.0.113.5 8080");
  });

  test("rejects overload with both pool and interface", () => {
    expect(() => natCli({
      device: "R1",
      overload: { aclName: "1", poolName: "P", outsideInterface: "Gi0/0" },
    })).toThrow(/exactly one/);
  });
});

describe("dhcpPoolCli", () => {
  test("converts CIDR to network + mask and emits options", () => {
    const cli = dhcpPoolCli({
      device: "R1",
      name: "LAN",
      network: "192.168.10.0/24",
      defaultRouter: "192.168.10.1",
      dnsServer: "8.8.8.8",
      excluded: [{ start: "192.168.10.1", end: "192.168.10.10" }],
    });
    expect(cli).toBe(
      [
        "ip dhcp excluded-address 192.168.10.1 192.168.10.10",
        "ip dhcp pool LAN",
        " network 192.168.10.0 255.255.255.0",
        " default-router 192.168.10.1",
        " dns-server 8.8.8.8",
        " exit",
      ].join("\n"),
    );
  });
});

describe("dhcpRelayCli", () => {
  test("emits one helper-address per server", () => {
    const cli = dhcpRelayCli({
      device: "R1",
      port: "Gi0/1",
      helpers: ["10.0.0.5", "10.0.0.6"],
    });
    expect(cli).toBe(
      [
        "interface Gi0/1",
        " ip helper-address 10.0.0.5",
        " ip helper-address 10.0.0.6",
        " exit",
      ].join("\n"),
    );
  });
});

describe("ntpCli / syslogCli", () => {
  test("ntpCli emits one line per server", () => {
    expect(ntpCli({ device: "R1", servers: ["10.0.0.1", "10.0.0.2"] })).toBe(
      "ntp server 10.0.0.1\nntp server 10.0.0.2",
    );
  });

  test("syslogCli emits hosts and trap level when requested", () => {
    expect(syslogCli({ device: "R1", hosts: ["10.0.0.5"], trapLevel: 4 })).toBe(
      "logging host 10.0.0.5\nlogging trap 4",
    );
  });

  test("ntpCli rejects 0 servers", () => {
    expect(() => ntpCli({ device: "R1", servers: [] })).toThrow(/at least 1/);
  });

  test("ntpCli throws transparent error on every PT 9 router with multiple servers", () => {
    // Universal in PT 9 — verified 2026-05-01 via probe-router-services-cli-coverage.
    for (const routerModel of ["1941", "2901", "2911", "ISR4321", "IR1101", "IR8340"]) {
      expect(() =>
        ntpCli({
          device: "R1",
          servers: ["10.0.0.1", "10.0.0.2"],
          routerModel,
        }),
      ).toThrow(/Multiple NTP servers not supported.*PT 9/i);
    }
  });

  test("ntpCli accepts a single server on every PT 9 router", () => {
    for (const routerModel of ["1941", "2901", "2911", "ISR4321", "IR1101", "IR8340"]) {
      expect(
        ntpCli({ device: "R1", servers: ["10.0.0.1"], routerModel }),
      ).toBe("ntp server 10.0.0.1");
    }
  });

  test("ntpCli does not gate when routerModel is omitted (trust by default)", () => {
    expect(() =>
      ntpCli({ device: "R1", servers: ["10.0.0.1", "10.0.0.2"] }),
    ).not.toThrow();
  });

  test("ntpCli does not gate unknown PT models (trust by default)", () => {
    expect(() =>
      ntpCli({
        device: "R1",
        servers: ["10.0.0.1", "10.0.0.2"],
        routerModel: "Future-Router-Model",
      }),
    ).not.toThrow();
  });

  test("syslogCli throws transparent error on every PT 9 router when trapLevel is set", () => {
    for (const routerModel of ["1941", "2901", "2911", "ISR4321", "IR1101", "IR8340"]) {
      expect(() =>
        syslogCli({
          device: "R1",
          hosts: ["10.0.0.5"],
          trapLevel: 4,
          routerModel,
        }),
      ).toThrow(/logging trap.*not supported.*PT 9/i);
    }
  });

  test("syslogCli accepts every PT 9 router when trapLevel is omitted", () => {
    for (const routerModel of ["1941", "2901", "2911", "ISR4321", "IR1101", "IR8340"]) {
      expect(
        syslogCli({ device: "R1", hosts: ["10.0.0.5"], routerModel }),
      ).toBe("logging host 10.0.0.5");
    }
  });

  test("syslogCli does not gate when routerModel is omitted (trust by default)", () => {
    expect(() =>
      syslogCli({ device: "R1", hosts: ["10.0.0.5"], trapLevel: 4 }),
    ).not.toThrow();
  });
});

describe("wrapInConfig (services)", () => {
  test("wraps body identically to switching", () => {
    expect(wrapInConfig("ntp server 10.0.0.1")).toBe(
      "enable\nterminal length 0\nconfigure terminal\nno ip domain-lookup\nntp server 10.0.0.1\nend",
    );
  });
});
