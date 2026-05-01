import { describe, expect, test } from "bun:test";
import { igpExtrasCli } from "../src/recipes/routing/igp-extras.js";

describe("igpExtrasCli", () => {
  test("OSPF minimal with implicit pid and one passive-interface", () => {
    expect(
      igpExtrasCli({
        device: "R1",
        protocol: "ospf",
        passiveInterfaces: ["GigabitEthernet0/0"],
      }),
    ).toBe(
      [
        "router ospf 1",
        "passive-interface GigabitEthernet0/0",
        "exit",
      ].join("\n"),
    );
  });

  test("OSPF with pid=2 and three passive-interfaces", () => {
    expect(
      igpExtrasCli({
        device: "R1",
        protocol: "ospf",
        processId: 2,
        passiveInterfaces: [
          "GigabitEthernet0/0",
          "GigabitEthernet0/1",
          "GigabitEthernet0/2",
        ],
      }),
    ).toBe(
      [
        "router ospf 2",
        "passive-interface GigabitEthernet0/0",
        "passive-interface GigabitEthernet0/1",
        "passive-interface GigabitEthernet0/2",
        "exit",
      ].join("\n"),
    );
  });

  test("OSPF with default-information originate only", () => {
    expect(
      igpExtrasCli({
        device: "R1",
        protocol: "ospf",
        defaultOriginate: true,
      }),
    ).toBe(
      [
        "router ospf 1",
        "default-information originate",
        "exit",
      ].join("\n"),
    );
  });

  test("OSPF with passives and default-information originate combined", () => {
    expect(
      igpExtrasCli({
        device: "R1",
        protocol: "ospf",
        processId: 10,
        passiveInterfaces: ["GigabitEthernet0/0"],
        defaultOriginate: true,
      }),
    ).toBe(
      [
        "router ospf 10",
        "passive-interface GigabitEthernet0/0",
        "default-information originate",
        "exit",
      ].join("\n"),
    );
  });

  test("EIGRP minimal with asn=1 and one passive", () => {
    expect(
      igpExtrasCli({
        device: "R1",
        protocol: "eigrp",
        passiveInterfaces: ["GigabitEthernet0/0"],
      }),
    ).toBe(
      [
        "router eigrp 1",
        "passive-interface GigabitEthernet0/0",
        "exit",
      ].join("\n"),
    );
  });

  test("EIGRP with default-information originate emits redistribute static", () => {
    expect(
      igpExtrasCli({
        device: "R1",
        protocol: "eigrp",
        processId: 100,
        defaultOriginate: true,
      }),
    ).toBe(
      [
        "router eigrp 100",
        "redistribute static",
        "exit",
      ].join("\n"),
    );
  });

  test("RIP minimal with two passives", () => {
    expect(
      igpExtrasCli({
        device: "R1",
        protocol: "rip",
        passiveInterfaces: ["GigabitEthernet0/0", "GigabitEthernet0/1"],
      }),
    ).toBe(
      [
        "router rip",
        "passive-interface GigabitEthernet0/0",
        "passive-interface GigabitEthernet0/1",
        "exit",
      ].join("\n"),
    );
  });

  test("RIP with default-information originate", () => {
    expect(
      igpExtrasCli({
        device: "R1",
        protocol: "rip",
        defaultOriginate: true,
      }),
    ).toBe(
      [
        "router rip",
        "default-information originate",
        "exit",
      ].join("\n"),
    );
  });

  test("empty intent without passives nor default-info returns empty string", () => {
    expect(
      igpExtrasCli({
        device: "R1",
        protocol: "ospf",
      }),
    ).toBe("");
  });

  test("RIP with processId throws", () => {
    expect(() =>
      igpExtrasCli({
        device: "R1",
        protocol: "rip",
        processId: 1,
        passiveInterfaces: ["GigabitEthernet0/0"],
      }),
    ).toThrow(/RIP does not accept a processId/);
  });

  test("OSPF with processId 0 throws", () => {
    expect(() =>
      igpExtrasCli({
        device: "R1",
        protocol: "ospf",
        processId: 0,
        passiveInterfaces: ["GigabitEthernet0/0"],
      }),
    ).toThrow(/invalid OSPF processId/);
  });

  test("OSPF with processId 65536 throws", () => {
    expect(() =>
      igpExtrasCli({
        device: "R1",
        protocol: "ospf",
        processId: 65536,
        passiveInterfaces: ["GigabitEthernet0/0"],
      }),
    ).toThrow(/invalid OSPF processId/);
  });
});
