import { describe, expect, test } from "bun:test";
import { inspect, isClean } from "../src/canvas/inspect.js";
import type { CanvasSnapshot, DeviceObservation, LinkObservation, PortObservation } from "../src/canvas/types.js";

function mkPort(p: Partial<PortObservation> & { name: string }): PortObservation {
  return { name: p.name, ip: p.ip ?? "", mask: p.mask ?? "", linked: p.linked ?? false };
}

function mkDevice(d: Partial<DeviceObservation> & { name: string; className: string }): DeviceObservation {
  return {
    name: d.name,
    model: d.model ?? "MockModel",
    className: d.className,
    x: d.x ?? 0,
    y: d.y ?? 0,
    powered: d.powered ?? true,
    ports: d.ports ?? [],
    ...(d.category ? { category: d.category } : {}),
  };
}

function mkSnapshot(devices: DeviceObservation[], links: LinkObservation[] = []): CanvasSnapshot {
  return { capturedAt: new Date().toISOString(), devices, links };
}

describe("inspect", () => {
  test("clean canvas → no issues", () => {
    const snap = mkSnapshot([
      mkDevice({
        name: "R1", className: "Router",
        ports: [mkPort({ name: "G0/0", ip: "10.0.0.1", mask: "255.255.255.252", linked: true })],
      }),
      mkDevice({
        name: "R2", className: "Router",
        ports: [mkPort({ name: "G0/0", ip: "10.0.0.2", mask: "255.255.255.252", linked: true })],
      }),
    ], [
      { aDevice: "R1", aPort: "G0/0", bDevice: "R2", bPort: "G0/0" },
    ]);
    const issues = inspect(snap);
    expect(issues.length).toBe(0);
    expect(isClean(issues)).toBe(true);
  });

  test("DUPLICATE_IP", () => {
    const snap = mkSnapshot([
      mkDevice({
        name: "R1", className: "Router",
        ports: [mkPort({ name: "G0/0", ip: "10.0.0.1", mask: "255.255.255.0" })],
      }),
      mkDevice({
        name: "PC1", className: "PC",
        ports: [mkPort({ name: "Fa0", ip: "10.0.0.1", mask: "255.255.255.0", linked: true })],
      }),
    ]);
    const codes = inspect(snap).map(i => i.code);
    expect(codes).toContain("DUPLICATE_IP");
  });

  test("INVALID_MASK on non-contiguous bits", () => {
    const snap = mkSnapshot([
      mkDevice({
        name: "R1", className: "Router",
        ports: [mkPort({ name: "G0/0", ip: "10.0.0.1", mask: "255.0.255.0" })],
      }),
    ]);
    const codes = inspect(snap).map(i => i.code);
    expect(codes).toContain("INVALID_MASK");
  });

  test("INVALID_IP on bad host", () => {
    const snap = mkSnapshot([
      mkDevice({
        name: "R1", className: "Router",
        ports: [mkPort({ name: "G0/0", ip: "10.0.0.999", mask: "255.255.255.0" })],
      }),
    ]);
    const codes = inspect(snap).map(i => i.code);
    expect(codes).toContain("INVALID_IP");
  });

  test("DEVICE_POWERED_OFF when off-but-linked", () => {
    const snap = mkSnapshot([
      mkDevice({
        name: "R1", className: "Router", powered: false,
        ports: [mkPort({ name: "G0/0", ip: "10.0.0.1", mask: "255.255.255.0", linked: true })],
      }),
    ]);
    const codes = inspect(snap).map(i => i.code);
    expect(codes).toContain("DEVICE_POWERED_OFF");
  });

  test("ROUTER_UPLINK_UNADDRESSED when linked and no IP", () => {
    const snap = mkSnapshot([
      mkDevice({
        name: "R1", className: "Router",
        ports: [mkPort({ name: "G0/0", linked: true })],
      }),
    ]);
    const codes = inspect(snap).map(i => i.code);
    expect(codes).toContain("ROUTER_UPLINK_UNADDRESSED");
  });

  test("ROUTER_PEER_DIFFERENT_SUBNET", () => {
    const snap = mkSnapshot([
      mkDevice({
        name: "R1", className: "Router",
        ports: [mkPort({ name: "G0/0", ip: "10.0.0.1", mask: "255.255.255.252", linked: true })],
      }),
      mkDevice({
        name: "R2", className: "Router",
        ports: [mkPort({ name: "G0/0", ip: "10.0.1.1", mask: "255.255.255.252", linked: true })],
      }),
    ], [
      { aDevice: "R1", aPort: "G0/0", bDevice: "R2", bPort: "G0/0" },
    ]);
    const codes = inspect(snap).map(i => i.code);
    expect(codes).toContain("ROUTER_PEER_DIFFERENT_SUBNET");
  });

  test("PORT_LINKED_BUT_DOWN on PC without IP", () => {
    const snap = mkSnapshot([
      mkDevice({
        name: "PC1", className: "PC",
        ports: [mkPort({ name: "Fa0", linked: true })],
      }),
    ]);
    const codes = inspect(snap).map(i => i.code);
    expect(codes).toContain("PORT_LINKED_BUT_DOWN");
  });

  test("isClean returns false when any error is present", () => {
    const snap = mkSnapshot([
      mkDevice({
        name: "R1", className: "Router",
        ports: [mkPort({ name: "G0/0", ip: "10.0.0.1", mask: "255.0.255.0" })],
      }),
    ]);
    expect(isClean(inspect(snap))).toBe(false);
  });
});
