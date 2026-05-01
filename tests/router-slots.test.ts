import { describe, expect, test } from "bun:test";
import {
  ROUTER_SLOT_CATALOG,
  resolveSlotCatalogKey,
  validateModuleFamily,
  validateModuleSlot,
} from "../src/catalog/router-slots.js";

describe("validateModuleSlot", () => {
  test("ISR G2 — 1941 accepts only 0/0 and 0/1", () => {
    expect(validateModuleSlot("1941", "0/0")).toBeNull();
    expect(validateModuleSlot("1941", "0/1")).toBeNull();
    expect(validateModuleSlot("1941", "0/2")).toContain("not a valid module bay");
    expect(validateModuleSlot("1941", "0/2")).toContain("0/0, 0/1");
  });

  test("ISR G2 — 2911 accepts 0/0..0/3 (4 EHWIC bays)", () => {
    expect(validateModuleSlot("2911", "0/0")).toBeNull();
    expect(validateModuleSlot("2911", "0/3")).toBeNull();
    expect(validateModuleSlot("2911", "0/4")).toContain("not a valid module bay");
  });

  test("ISR G1 — 2811 accepts 4 HWIC bays", () => {
    expect(validateModuleSlot("2811", "0/0")).toBeNull();
    expect(validateModuleSlot("2811", "0/3")).toBeNull();
    expect(validateModuleSlot("2811", "0/4")).toContain("not a valid module bay");
  });

  test("ISR G1 — 1841 has only 2 HWIC bays", () => {
    expect(validateModuleSlot("1841", "0/0")).toBeNull();
    expect(validateModuleSlot("1841", "0/1")).toBeNull();
    expect(validateModuleSlot("1841", "0/2")).toContain("not a valid module bay");
  });

  test("ISR4321 — 0/0 is BUILTIN (rejected); 0/1 and 0/2 are NIM bays; 1/0 is SM-X", () => {
    // Empirically verified 2026-05-01 via probe-module-bays: 0/2 accepts
    // HWIC-2T, so it must be a valid bay. Original docs were too narrow.
    expect(validateModuleSlot("ISR4321", "0/0")).toContain("not a valid module bay");
    expect(validateModuleSlot("ISR4321", "0/1")).toBeNull();
    expect(validateModuleSlot("ISR4321", "0/2")).toBeNull();
    expect(validateModuleSlot("ISR4321", "1/0")).toBeNull();
    expect(validateModuleSlot("ISR4321", "0/3")).toContain("not a valid module bay");
  });

  test("ISR4331 — 2 NIM bays (0/1, 0/2) + SM-X (1/0)", () => {
    expect(validateModuleSlot("ISR4331", "0/0")).toContain("not a valid module bay");
    expect(validateModuleSlot("ISR4331", "0/1")).toBeNull();
    expect(validateModuleSlot("ISR4331", "0/2")).toBeNull();
    expect(validateModuleSlot("ISR4331", "1/0")).toBeNull();
    expect(validateModuleSlot("ISR4331", "0/3")).toContain("not a valid module bay");
  });

  test("Unknown model → no validation (returns null)", () => {
    expect(validateModuleSlot("UnknownRouter", "9/9")).toBeNull();
    expect(validateModuleSlot("PT8200", "0/0")).toBeNull();
  });

  test("Error message lists available bays for the chassis", () => {
    const msg = validateModuleSlot("1941", "0/5");
    expect(msg).not.toBeNull();
    expect(msg!).toContain("0/0");
    expect(msg!).toContain("0/1");
  });

  test("Catalog covers all expected ISR models", () => {
    const expected = ["1841", "2620XM", "2621XM", "2811", "1941", "2901", "2911", "ISR4321", "ISR4331"];
    for (const model of expected) {
      expect(ROUTER_SLOT_CATALOG[model]).toBeDefined();
      expect(ROUTER_SLOT_CATALOG[model]!.bays.length).toBeGreaterThan(0);
    }
  });
});

describe("resolveSlotCatalogKey", () => {
  test("exact key match", () => {
    expect(resolveSlotCatalogKey("1941")).toBe("1941");
    expect(resolveSlotCatalogKey("ISR4331")).toBe("ISR4331");
  });

  test("substring match (PT may return 'Router1941' or 'Cisco1941')", () => {
    expect(resolveSlotCatalogKey("Router1941")).toBe("1941");
    expect(resolveSlotCatalogKey("Cisco1941")).toBe("1941");
    expect(resolveSlotCatalogKey("CiscoISR4331")).toBe("ISR4331");
  });

  test("case-insensitive", () => {
    expect(resolveSlotCatalogKey("router1941")).toBe("1941");
    expect(resolveSlotCatalogKey("ROUTERISR4321")).toBe("ISR4321");
  });

  test("longer key wins (prevents 1941 swallowing ISR4321 etc)", () => {
    // "ISR4321" contains nothing from other keys, but defensive ordering is good.
    expect(resolveSlotCatalogKey("ISR4321")).toBe("ISR4321");
  });

  test("null / unknown → null (no validation, benefit of doubt)", () => {
    expect(resolveSlotCatalogKey(null)).toBeNull();
    expect(resolveSlotCatalogKey("")).toBeNull();
    expect(resolveSlotCatalogKey("PT8200")).toBeNull();
    expect(resolveSlotCatalogKey("RouterUnknown")).toBeNull();
  });

  test("validateModuleSlot accepts fuzzy className", () => {
    expect(validateModuleSlot("Router1941", "0/0")).toBeNull();
    expect(validateModuleSlot("Cisco2811", "0/3")).toBeNull();
    const err = validateModuleSlot("Router1941", "0/9");
    expect(err).not.toBeNull();
    expect(err!).toContain("1941");
  });
});

describe("validateModuleFamily", () => {
  test("HWIC-2T fits ISR G1/G2 routers", () => {
    expect(validateModuleFamily("1841", "HWIC-2T")).toBeNull();
    expect(validateModuleFamily("2811", "HWIC-2T")).toBeNull();
    expect(validateModuleFamily("1941", "HWIC-2T")).toBeNull();
    expect(validateModuleFamily("2901", "HWIC-2T")).toBeNull();
    expect(validateModuleFamily("2911", "HWIC-2T")).toBeNull();
  });

  test("HWIC-2T accepted on ISR 4xxx in PT 9 (compatibility shim, verified 2026-05-01)", () => {
    // PT 9 accepts HWIC-2T in NIM bays "por compatibilidad" — so we no
    // longer reject the combination at the family layer. Real Cisco only
    // accepts NIM there, but PT is permissive and AGENTS.md documents it.
    expect(validateModuleFamily("ISR4321", "HWIC-2T")).toBeNull();
    expect(validateModuleFamily("ISR4331", "HWIC-2T")).toBeNull();
  });

  test("NIM-2T fits ISR 4xxx", () => {
    expect(validateModuleFamily("ISR4321", "NIM-2T")).toBeNull();
    expect(validateModuleFamily("ISR4331", "NIM-2T")).toBeNull();
  });

  test("NIM-2T accepted on ISR G2 in PT 9 (compatibility shim, verified 2026-05-01)", () => {
    // PT 9 accepts NIM-2T in HWIC/EHWIC bays "por compatibilidad" — the
    // real Cisco ordering guides forbid this combination, but PT's chassis
    // simulation is permissive and we mirror that policy. Same approach as
    // HWIC-2T in ISR 4xxx NIM bays (see test above).
    expect(validateModuleFamily("1941", "NIM-2T")).toBeNull();
    expect(validateModuleFamily("2901", "NIM-2T")).toBeNull();
    expect(validateModuleFamily("2911", "NIM-2T")).toBeNull();
    expect(validateModuleFamily("1841", "NIM-2T")).toBeNull();
    expect(validateModuleFamily("2811", "NIM-2T")).toBeNull();
  });

  test("Unknown module is not gated (benefit of doubt)", () => {
    expect(validateModuleFamily("1941", "MYSTERY-MODULE")).toBeNull();
    expect(validateModuleFamily("ISR4321", "FOO-BAR")).toBeNull();
  });

  test("Unknown chassis skips validation", () => {
    expect(validateModuleFamily("UnknownRouter", "HWIC-2T")).toBeNull();
  });

  test("Accepts fuzzy className like 'Router1941' (defensive — getModel() now returns the exact ptType)", () => {
    expect(validateModuleFamily("Router1941", "HWIC-2T")).toBeNull();
    expect(validateModuleFamily("CiscoISR4321", "NIM-2T")).toBeNull();
    // PT 9 allows NIM in HWIC chassis, so this is now expected to pass too.
    expect(validateModuleFamily("Router1941", "NIM-2T")).toBeNull();
  });

  test("WIC fits 2620XM/2621XM (legacy)", () => {
    expect(validateModuleFamily("2620XM", "WIC-2T")).toBeNull();
    expect(validateModuleFamily("2621XM", "WIC-1T")).toBeNull();
  });
});
