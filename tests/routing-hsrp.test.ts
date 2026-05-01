import { describe, expect, test } from "bun:test";
import { hsrpCli } from "../src/recipes/routing/hsrp.js";

describe("hsrpCli", () => {
  test("minimal intent emits ip + no shutdown + exit", () => {
    expect(
      hsrpCli({ device: "R1", port: "GigabitEthernet0/0", group: 1, virtualIp: "10.0.0.1" }),
    ).toBe(
      [
        "interface GigabitEthernet0/0",
        " standby 1 ip 10.0.0.1",
        " no shutdown",
        " exit",
      ].join("\n"),
    );
  });

  test("includes priority line when provided", () => {
    expect(
      hsrpCli({ device: "R1", port: "Gi0/0", group: 1, virtualIp: "10.0.0.1", priority: 110 }),
    ).toBe(
      [
        "interface Gi0/0",
        " standby 1 ip 10.0.0.1",
        " standby 1 priority 110",
        " no shutdown",
        " exit",
      ].join("\n"),
    );
  });

  test("includes preempt line when true", () => {
    expect(
      hsrpCli({ device: "R1", port: "Gi0/0", group: 1, virtualIp: "10.0.0.1", preempt: true }),
    ).toBe(
      [
        "interface Gi0/0",
        " standby 1 ip 10.0.0.1",
        " standby 1 preempt",
        " no shutdown",
        " exit",
      ].join("\n"),
    );
  });

  test("emits priority + preempt + authentication in order", () => {
    expect(
      hsrpCli({
        device: "R1",
        port: "Gi0/0",
        group: 5,
        virtualIp: "192.168.1.254",
        priority: 120,
        preempt: true,
        authKey: "cisco123",
      }),
    ).toBe(
      [
        "interface Gi0/0",
        " standby 5 ip 192.168.1.254",
        " standby 5 priority 120",
        " standby 5 preempt",
        " standby 5 authentication cisco123",
        " no shutdown",
        " exit",
      ].join("\n"),
    );
  });

  test("HSRPv2 allows group 1000 and emits version line", () => {
    expect(
      hsrpCli({ device: "R1", port: "Gi0/0", group: 1000, virtualIp: "10.0.0.1", version: 2 }),
    ).toBe(
      [
        "interface Gi0/0",
        " standby version 2",
        " standby 1000 ip 10.0.0.1",
        " no shutdown",
        " exit",
      ].join("\n"),
    );
  });

  test("rejects HSRPv1 group 256", () => {
    expect(() =>
      hsrpCli({ device: "R1", port: "Gi0/0", group: 256, virtualIp: "10.0.0.1" }),
    ).toThrow(/group 256 out of range/);
  });

  test("rejects priority 0", () => {
    expect(() =>
      hsrpCli({ device: "R1", port: "Gi0/0", group: 1, virtualIp: "10.0.0.1", priority: 0 }),
    ).toThrow(/priority 0 out of range/);
  });

  test("rejects priority 256", () => {
    expect(() =>
      hsrpCli({ device: "R1", port: "Gi0/0", group: 1, virtualIp: "10.0.0.1", priority: 256 }),
    ).toThrow(/priority 256 out of range/);
  });

  test("rejects virtualIp with octet > 255", () => {
    expect(() =>
      hsrpCli({ device: "R1", port: "Gi0/0", group: 1, virtualIp: "256.0.0.1" }),
    ).toThrow(/not a valid dotted-quad/);
  });

  test("rejects virtualIp with too few octets", () => {
    expect(() =>
      hsrpCli({ device: "R1", port: "Gi0/0", group: 1, virtualIp: "10.0.0" }),
    ).toThrow(/not a valid dotted-quad/);
  });

  test("rejects virtualIp non-numeric", () => {
    expect(() =>
      hsrpCli({ device: "R1", port: "Gi0/0", group: 1, virtualIp: "abc" }),
    ).toThrow(/not a valid dotted-quad/);
  });
});
