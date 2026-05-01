import { describe, expect, test } from "bun:test";
import { bgpCli } from "../src/recipes/routing/bgp.js";

describe("bgpCli", () => {
  test("minimal intent with one neighbor", () => {
    expect(
      bgpCli({
        device: "R1",
        asn: 65001,
        neighbors: [{ ip: "10.0.0.2", remoteAs: 65002 }],
      }),
    ).toBe(
      [
        "router bgp 65001",
        " neighbor 10.0.0.2 remote-as 65002",
        "exit",
      ].join("\n"),
    );
  });

  test("includes bgp router-id when provided", () => {
    expect(
      bgpCli({
        device: "R1",
        asn: 100,
        routerId: "1.1.1.1",
        neighbors: [{ ip: "10.0.0.2", remoteAs: 200 }],
      }),
    ).toBe(
      [
        "router bgp 100",
        " bgp router-id 1.1.1.1",
        " neighbor 10.0.0.2 remote-as 200",
        "exit",
      ].join("\n"),
    );
  });

  test("emits neighbor description after remote-as", () => {
    expect(
      bgpCli({
        device: "R1",
        asn: 100,
        neighbors: [{ ip: "10.0.0.2", remoteAs: 200, description: "peer-to-ISP" }],
      }),
    ).toBe(
      [
        "router bgp 100",
        " neighbor 10.0.0.2 remote-as 200",
        " neighbor 10.0.0.2 description peer-to-ISP",
        "exit",
      ].join("\n"),
    );
  });

  test("translates CIDR networks into network/mask form", () => {
    expect(
      bgpCli({
        device: "R1",
        asn: 100,
        neighbors: [{ ip: "10.0.0.2", remoteAs: 200 }],
        networks: ["10.0.0.0/24", "172.16.0.0/16"],
      }),
    ).toBe(
      [
        "router bgp 100",
        " neighbor 10.0.0.2 remote-as 200",
        " network 10.0.0.0 mask 255.255.255.0",
        " network 172.16.0.0 mask 255.255.0.0",
        "exit",
      ].join("\n"),
    );
  });

  test("emits one redistribute line per source", () => {
    expect(
      bgpCli({
        device: "R1",
        asn: 100,
        neighbors: [{ ip: "10.0.0.2", remoteAs: 200 }],
        redistribute: ["ospf", "connected", "static"],
      }),
    ).toBe(
      [
        "router bgp 100",
        " neighbor 10.0.0.2 remote-as 200",
        " redistribute ospf",
        " redistribute connected",
        " redistribute static",
        "exit",
      ].join("\n"),
    );
  });

  test("full intent with router-id, described neighbor, networks and redistribute", () => {
    expect(
      bgpCli({
        device: "R1",
        asn: 65001,
        routerId: "1.1.1.1",
        neighbors: [
          { ip: "10.0.0.2", remoteAs: 65002, description: "to-R2" },
          { ip: "10.0.0.6", remoteAs: 65003 },
        ],
        networks: ["192.168.1.0/24"],
        redistribute: ["ospf"],
      }),
    ).toBe(
      [
        "router bgp 65001",
        " bgp router-id 1.1.1.1",
        " neighbor 10.0.0.2 remote-as 65002",
        " neighbor 10.0.0.2 description to-R2",
        " neighbor 10.0.0.6 remote-as 65003",
        " network 192.168.1.0 mask 255.255.255.0",
        " redistribute ospf",
        "exit",
      ].join("\n"),
    );
  });
});
