import { describe, expect, test } from "bun:test";
import { wrapInConfig } from "../src/ipc/cli-prologue.js";
import { subinterfaceCli } from "../src/tools/configure-subinterface.js";

describe("subinterfaceCli", () => {
  test("emits parent up + one subinterface block", () => {
    const cli = subinterfaceCli({
      parent: "GigabitEthernet0/0",
      subinterfaces: [
        { vlan: 10, ip: "192.168.10.1", mask: "255.255.255.0" },
      ],
    });
    expect(cli).toBe(
      [
        "interface GigabitEthernet0/0",
        " no shutdown",
        " exit",
        "interface GigabitEthernet0/0.10",
        " encapsulation dot1Q 10",
        " ip address 192.168.10.1 255.255.255.0",
        " no shutdown",
        " exit",
      ].join("\n"),
    );
  });

  test("includes 'description' line when provided", () => {
    const cli = subinterfaceCli({
      parent: "GigabitEthernet0/0",
      subinterfaces: [
        { vlan: 20, ip: "10.0.20.1", mask: "255.255.255.0", description: "VOICE" },
      ],
    });
    expect(cli).toContain(" description VOICE");
    // Description must come before encapsulation per IOS practice.
    expect(cli.indexOf(" description VOICE")).toBeLessThan(cli.indexOf(" encapsulation dot1Q 20"));
  });

  test("multiple VLANs produce one block each, parent emitted once", () => {
    const cli = subinterfaceCli({
      parent: "GigabitEthernet0/1",
      subinterfaces: [
        { vlan: 10, ip: "192.168.10.1", mask: "255.255.255.0" },
        { vlan: 20, ip: "192.168.20.1", mask: "255.255.255.0" },
        { vlan: 99, ip: "192.168.99.1", mask: "255.255.255.0" },
      ],
    });
    // Parent appears exactly once at the very top.
    const parentLines = cli.split("\n").filter((l) => l === "interface GigabitEthernet0/1");
    expect(parentLines.length).toBe(1);
    // Each VLAN gets a subinterface header.
    expect(cli).toContain("interface GigabitEthernet0/1.10");
    expect(cli).toContain("interface GigabitEthernet0/1.20");
    expect(cli).toContain("interface GigabitEthernet0/1.99");
    expect(cli).toContain(" encapsulation dot1Q 10");
    expect(cli).toContain(" encapsulation dot1Q 20");
    expect(cli).toContain(" encapsulation dot1Q 99");
  });

  test("preserves ordering of subinterfaces", () => {
    const cli = subinterfaceCli({
      parent: "GigabitEthernet0/0",
      subinterfaces: [
        { vlan: 99, ip: "10.99.0.1", mask: "255.255.255.0" },
        { vlan: 10, ip: "10.10.0.1", mask: "255.255.255.0" },
      ],
    });
    expect(cli.indexOf("encapsulation dot1Q 99")).toBeLessThan(
      cli.indexOf("encapsulation dot1Q 10"),
    );
  });

  test("dot1Q tag matches the subinterface number (PT requires this for traffic to flow)", () => {
    const cli = subinterfaceCli({
      parent: "GigabitEthernet0/0",
      subinterfaces: [{ vlan: 42, ip: "192.168.42.1", mask: "255.255.255.0" }],
    });
    // The .42 subinterface is tagged with dot1Q 42 — mismatched values are
    // a real footgun in router-on-a-stick because PT will silently drop frames.
    expect(cli).toContain("interface GigabitEthernet0/0.42");
    expect(cli).toContain("encapsulation dot1Q 42");
  });
});

describe("wrapInConfig", () => {
  test("wraps body with the canonical PT-9-safe prologue", () => {
    expect(wrapInConfig("interface Gi0/0\n no shutdown")).toBe(
      "enable\nterminal length 0\nconfigure terminal\nno ip domain-lookup\ninterface Gi0/0\n no shutdown\nend",
    );
  });
});
