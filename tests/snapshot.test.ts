import { describe, expect, test } from "bun:test";
import { parseSnapshotDump } from "../src/canvas/snapshot.js";

describe("parseSnapshotDump", () => {
  test("parses a minimal canvas with one device, one port and one link", () => {
    const raw = [
      "DEV|R1|2911|Router|100|200|1",
      "PORT|G0/0|10.0.0.1|255.255.255.252|1",
      "LINKPAIR|R1|G0/0|R2|G0/1",
      "DEV|R2|2911|Router|300|200|1",
      "PORT|G0/1|10.0.0.2|255.255.255.252|1",
      "LINKPAIR|R2|G0/1|R1|G0/0",
    ].join("\n");

    const snap = parseSnapshotDump(raw);
    expect(snap.devices).toHaveLength(2);
    expect(snap.devices[0]?.name).toBe("R1");
    expect(snap.devices[0]?.ports[0]).toEqual({
      name: "G0/0",
      ip: "10.0.0.1",
      mask: "255.255.255.252",
      linked: true,
    });
    expect(snap.devices[1]?.powered).toBe(true);
    expect(snap.links).toHaveLength(1);
    expect(snap.links[0]).toMatchObject({
      aDevice: "R1", aPort: "G0/0", bDevice: "R2", bPort: "G0/1",
    });
  });

  test("deduplicates the LINKPAIR rows that PT emits from both endpoints", () => {
    const raw = [
      "DEV|A|m|Router|0|0|1",
      "PORT|p1||| 0".replace(" 0", "0"),
      "LINKPAIR|A|p1|B|q1",
      "DEV|B|m|Router|0|0|1",
      "PORT|q1|||0",
      "LINKPAIR|B|q1|A|p1",
    ].join("\n");
    const snap = parseSnapshotDump(raw);
    expect(snap.links).toHaveLength(1);
  });

  test("ignores trailing blank lines", () => {
    const raw = [
      "DEV|R1|2911|Router|0|0|1",
      "PORT|G0/0||| 0".replace(" 0", "0"),
      "",
      "",
    ].join("\n");
    expect(parseSnapshotDump(raw).devices).toHaveLength(1);
  });

  test("powered=0 surfaces as powered:false", () => {
    const raw = "DEV|R1|2911|Router|0|0|0";
    const snap = parseSnapshotDump(raw);
    expect(snap.devices[0]?.powered).toBe(false);
  });

  test("linked ports can exist without an observable peer", () => {
    const raw = [
      "DEV|R1|2911|Router|0|0|1",
      "PORT|G0/0|||1",
    ].join("\n");
    expect(parseSnapshotDump(raw).links).toHaveLength(0);
  });

  test("malformed DEV row raises", () => {
    expect(() => parseSnapshotDump("DEV|R1")).toThrow(/malformed DEV/);
  });

  test("PORT row without enclosing DEV raises", () => {
    expect(() => parseSnapshotDump("PORT|G0/0|||0")).toThrow(/PORT row without enclosing DEV/);
  });

  test("unknown row tag raises", () => {
    expect(() => parseSnapshotDump("FOO|bar")).toThrow(/unknown row tag/);
  });
});
