import { describe, expect, test } from "bun:test";
import { diffSnapshots, summarizeDiff } from "../src/canvas/diff.js";
import type { CanvasSnapshot } from "../src/canvas/types.js";

function snap(devices: CanvasSnapshot["devices"], links: CanvasSnapshot["links"] = []): CanvasSnapshot {
  return { capturedAt: new Date().toISOString(), devices, links };
}

const baseDevice = (over: Partial<CanvasSnapshot["devices"][number]> & { name: string }): CanvasSnapshot["devices"][number] => ({
  name: over.name,
  model: over.model ?? "2911",
  className: over.className ?? "Router",
  x: over.x ?? 0,
  y: over.y ?? 0,
  powered: over.powered ?? true,
  ports: over.ports ?? [],
});

describe("diffSnapshots", () => {
  test("identical snapshots → no changes", () => {
    const before = snap([baseDevice({ name: "R1" })]);
    const after = snap([baseDevice({ name: "R1" })]);
    const d = diffSnapshots(before, after);
    expect(d.addedDevices).toHaveLength(0);
    expect(d.removedDevices).toHaveLength(0);
    expect(d.changedDevices).toHaveLength(0);
    expect(d.changedPorts).toHaveLength(0);
    expect(d.addedLinks).toHaveLength(0);
    expect(d.removedLinks).toHaveLength(0);
    expect(summarizeDiff(d)).toBe("No changes between snapshots.");
  });

  test("added and removed devices", () => {
    const before = snap([baseDevice({ name: "R1" })]);
    const after = snap([baseDevice({ name: "R2" })]);
    const d = diffSnapshots(before, after);
    expect(d.addedDevices.map(x => x.name)).toEqual(["R2"]);
    expect(d.removedDevices.map(x => x.name)).toEqual(["R1"]);
  });

  test("port IP change is reported once", () => {
    const before = snap([
      baseDevice({ name: "R1", ports: [{ name: "G0/0", ip: "10.0.0.1", mask: "255.255.255.252", linked: true }] }),
    ]);
    const after = snap([
      baseDevice({ name: "R1", ports: [{ name: "G0/0", ip: "10.0.0.5", mask: "255.255.255.252", linked: true }] }),
    ]);
    const d = diffSnapshots(before, after);
    expect(d.changedPorts).toHaveLength(1);
    expect(d.changedPorts[0]?.ip).toEqual({ from: "10.0.0.1", to: "10.0.0.5" });
  });

  test("link added between R1 and R2", () => {
    const before = snap([baseDevice({ name: "R1" }), baseDevice({ name: "R2" })]);
    const after = snap(
      [baseDevice({ name: "R1" }), baseDevice({ name: "R2" })],
      [{ aDevice: "R1", aPort: "G0/0", bDevice: "R2", bPort: "G0/0" }],
    );
    const d = diffSnapshots(before, after);
    expect(d.addedLinks).toHaveLength(1);
    expect(d.removedLinks).toHaveLength(0);
  });

  test("powered flip on a device", () => {
    const before = snap([baseDevice({ name: "R1", powered: true })]);
    const after = snap([baseDevice({ name: "R1", powered: false })]);
    const d = diffSnapshots(before, after);
    expect(d.changedDevices).toHaveLength(1);
    expect(d.changedDevices[0]?.powered).toEqual({ from: true, to: false });
  });
});
