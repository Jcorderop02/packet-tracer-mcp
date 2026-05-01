import { describe, expect, test } from "bun:test";
import {
  classRejectsEncapsulation,
  stripEncapsulationLines,
} from "../src/tools/run-cli-bulk.js";

describe("classRejectsEncapsulation", () => {
  test("Legacy IOS (2950 / 2960) rejects the encapsulation subcommand", () => {
    expect(classRejectsEncapsulation("2950-24")).toBe(true);
    expect(classRejectsEncapsulation("2950T-24")).toBe(true);
    expect(classRejectsEncapsulation("2960-24TT")).toBe(true);
  });

  test("3560 (IOS 12.x multilayer) is the only switch that ACCEPTS the verb", () => {
    // Verified empirically 2026-05-01 with probe-encapsulation-parser:
    // 3560 needs `encapsulation dot1q` BEFORE `mode trunk`, but the verb
    // itself is in the parser. We must NOT filter it out.
    expect(classRejectsEncapsulation("3560-24PS")).toBe(false);
  });

  test("IOS XE chassis (3650 / IE-3400 / IE-9320) reject the verb (PT 9 parser drops it)", () => {
    // PT 9 ships an IOS XE 16.x/17.x parser that doesn't expose
    // `encapsulation` — verified 2026-05-01 with probe-encapsulation-parser
    // (got "% Invalid input detected at '^' marker" pointing at the verb).
    expect(classRejectsEncapsulation("3650-24PS")).toBe(true);
    expect(classRejectsEncapsulation("IE-3400")).toBe(true);
    expect(classRejectsEncapsulation("IE-9320")).toBe(true);
  });

  test("Routers and unknowns are not filtered (benefit of doubt)", () => {
    expect(classRejectsEncapsulation("2811")).toBe(false);
    expect(classRejectsEncapsulation("ISR4331")).toBe(false);
    expect(classRejectsEncapsulation(null)).toBe(false);
    expect(classRejectsEncapsulation("Unknown-PT")).toBe(false);
  });
});

describe("stripEncapsulationLines", () => {
  test("removes plain dot1q encapsulation line", () => {
    const block = [
      "interface FastEthernet0/24",
      "switchport trunk encapsulation dot1q",
      "switchport mode trunk",
      "switchport trunk allowed vlan 50,60",
      "exit",
    ].join("\n");
    const r = stripEncapsulationLines(block);
    expect(r.droppedCount).toBe(1);
    expect(r.droppedSamples[0]).toBe("switchport trunk encapsulation dot1q");
    expect(r.filtered).not.toContain("encapsulation dot1q");
    expect(r.filtered).toContain("switchport mode trunk");
  });

  test("removes ISL variant too", () => {
    const block = "switchport trunk encapsulation isl\nswitchport mode trunk";
    const r = stripEncapsulationLines(block);
    expect(r.droppedCount).toBe(1);
  });

  test("keeps router subinterface 'encapsulation dot1Q <vlan>' (different command path)", () => {
    const block = [
      "interface FastEthernet0/0.50",
      "encapsulation dot1Q 50",
      "ip address 172.16.50.1 255.255.255.0",
      "no shutdown",
    ].join("\n");
    const r = stripEncapsulationLines(block);
    expect(r.droppedCount).toBe(0);
    expect(r.filtered).toContain("encapsulation dot1Q 50");
  });

  test("preserves comment-style blocks unchanged", () => {
    const block = "! switchport trunk encapsulation comment\nswitchport mode trunk";
    const r = stripEncapsulationLines(block);
    expect(r.droppedCount).toBe(0);
  });

  test("handles indented and mixed-case input", () => {
    const block = "  Switchport Trunk Encapsulation Dot1Q\nfoo";
    const r = stripEncapsulationLines(block);
    expect(r.droppedCount).toBe(1);
  });

  test("preserves order of remaining commands", () => {
    const block = [
      "vlan 50",
      "switchport trunk encapsulation dot1q",
      "name datos",
      "exit",
    ].join("\n");
    const r = stripEncapsulationLines(block);
    expect(r.filtered.split("\n")).toEqual(["vlan 50", "name datos", "exit"]);
  });

  test("droppedSamples capped at 3", () => {
    const lines = [];
    for (let i = 0; i < 10; i++) lines.push("switchport trunk encapsulation dot1q");
    const r = stripEncapsulationLines(lines.join("\n"));
    expect(r.droppedCount).toBe(10);
    expect(r.droppedSamples.length).toBe(3);
  });
});
