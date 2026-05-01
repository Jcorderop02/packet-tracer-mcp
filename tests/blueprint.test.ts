import { describe, expect, test } from "bun:test";
import {
  DEFAULT_LAN_POOL,
  DEFAULT_TRANSIT_POOL,
  validateBlueprintReferences,
  withDefaults,
  type Blueprint,
} from "../src/recipes/blueprint.js";

const minimal: Blueprint = {
  name: "tiny",
  devices: [
    { name: "R1", model: "2911", x: 0, y: 0 },
    { name: "PC1", model: "PC-PT", x: 0, y: 0 },
  ],
  links: [],
  lans: [],
  routing: "none",
  addressing: {},
};

describe("withDefaults", () => {
  test("fills in lanPool and transitPool when omitted", () => {
    const out = withDefaults(minimal);
    expect(out.addressing.lanPool).toBe(DEFAULT_LAN_POOL);
    expect(out.addressing.transitPool).toBe(DEFAULT_TRANSIT_POOL);
  });

  test("preserves explicit pools", () => {
    const out = withDefaults({
      ...minimal,
      addressing: { lanPool: "172.16.0.0/12", transitPool: "192.0.2.0/24" },
    });
    expect(out.addressing.lanPool).toBe("172.16.0.0/12");
    expect(out.addressing.transitPool).toBe("192.0.2.0/24");
  });

  test("preserves protocol-specific knobs", () => {
    const out = withDefaults({ ...minimal, routing: "ospf", addressing: { ospfPid: 42 } });
    expect(out.addressing.ospfPid).toBe(42);
  });
});

describe("validateBlueprintReferences", () => {
  test("clean blueprint → no errors", () => {
    expect(validateBlueprintReferences(minimal)).toEqual([]);
  });

  test("link to missing device is reported", () => {
    const errs = validateBlueprintReferences({
      ...minimal,
      links: [{ aDevice: "R1", aPort: "G0/0", bDevice: "R-ghost", bPort: "G0/0", cable: "straight" }],
    });
    expect(errs.some(e => e.includes("R-ghost"))).toBe(true);
  });

  test("LAN gateway pointing at a missing device is reported", () => {
    const errs = validateBlueprintReferences({
      ...minimal,
      lans: [{ gatewayDevice: "R-ghost", gatewayPort: "G0/0", endpoints: ["PC1"] }],
    });
    expect(errs.some(e => e.includes("R-ghost"))).toBe(true);
  });

  test("LAN endpoint missing is reported", () => {
    const errs = validateBlueprintReferences({
      ...minimal,
      lans: [{ gatewayDevice: "R1", gatewayPort: "G0/0", endpoints: ["PC-ghost"] }],
    });
    expect(errs.some(e => e.includes("PC-ghost"))).toBe(true);
  });
});
