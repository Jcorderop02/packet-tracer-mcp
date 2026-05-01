import { describe, expect, test } from "bun:test";
import {
  reviewPlan,
  type PlanReviewInput,
} from "../src/tools/plan-review.js";

function makeInput(over: Partial<PlanReviewInput> = {}): PlanReviewInput {
  return {
    devices: [],
    links: [],
    lans: [],
    ...over,
  };
}

describe("reviewPlan — existence checks", () => {
  test("flags links referencing unknown devices as error", () => {
    const r = reviewPlan(makeInput({
      devices: [{ name: "R1", role: "router" }],
      links: [{ a: "R1", b: "GHOST", cable: "straight" }],
    }));
    const errs = r.issues.filter(i => i.severity === "error" && i.code === "unknown_device");
    expect(errs.length).toBe(1);
    expect(errs[0]!.message).toContain("GHOST");
  });

  test("flags LAN endpoints that don't exist", () => {
    const r = reviewPlan(makeInput({
      devices: [{ name: "SW1", role: "switch" }],
      lans: [{ name: "LAN1", kind: "user", endpoints: ["PC-X"] }],
    }));
    const errs = r.issues.filter(i => i.code === "unknown_endpoint");
    expect(errs.length).toBe(1);
    expect(errs[0]!.message).toContain("PC-X");
  });
});

describe("reviewPlan — router↔router cabling", () => {
  test("declared WAN exterior with Ethernet → ERROR", () => {
    const r = reviewPlan(makeInput({
      devices: [
        { name: "R1", role: "router" },
        { name: "R2", role: "router" },
      ],
      links: [{ a: "R1", b: "R2", cable: "straight", purpose: "wan_exterior" }],
    }));
    const e = r.issues.find(i => i.code === "wan_with_ethernet");
    expect(e).toBeDefined();
    expect(e!.severity).toBe("error");
    expect(e!.message).toContain("HWIC-2T");
  });

  test("declared LAN purpose between two routers → WARNING (needs confirm_internal_lan)", () => {
    const r = reviewPlan(makeInput({
      devices: [
        { name: "R1", role: "router" },
        { name: "R2", role: "router" },
      ],
      links: [{ a: "R1", b: "R2", cable: "straight", purpose: "lan" }],
    }));
    const w = r.issues.find(i => i.code === "router_to_router_ethernet");
    expect(w).toBeDefined();
    expect(w!.severity).toBe("warning");
  });

  test("router↔router with cable=serial does not warn (correct)", () => {
    const r = reviewPlan(makeInput({
      devices: [
        { name: "R1", role: "router" },
        { name: "R2", role: "router" },
      ],
      links: [{ a: "R1", b: "R2", cable: "serial", purpose: "wan_exterior" }],
    }));
    expect(r.issues.find(i => i.code === "wan_with_ethernet")).toBeUndefined();
    expect(r.issues.find(i => i.code === "router_to_router_ethernet")).toBeUndefined();
    expect(r.issues.find(i => i.code === "serial_needs_hwic")).toBeDefined();
  });

  test("router↔router with no purpose → ambiguous warning", () => {
    const r = reviewPlan(makeInput({
      devices: [
        { name: "R1", role: "router" },
        { name: "R2", role: "router" },
      ],
      links: [{ a: "R1", b: "R2", cable: "cross" }],
    }));
    const w = r.issues.find(i => i.code === "router_to_router_ambiguous");
    expect(w).toBeDefined();
    expect(w!.severity).toBe("warning");
  });
});

describe("reviewPlan — switch↔switch trunk", () => {
  test("switch↔switch with straight → info", () => {
    const r = reviewPlan(makeInput({
      devices: [
        { name: "SW1", role: "switch" },
        { name: "SW2", role: "switch" },
      ],
      links: [{ a: "SW1", b: "SW2", cable: "straight" }],
    }));
    const i = r.issues.find(c => c.code === "switch_trunk_straight");
    expect(i).toBeDefined();
    expect(i!.severity).toBe("info");
  });

  test("switch↔switch with cross does not warn", () => {
    const r = reviewPlan(makeInput({
      devices: [
        { name: "SW1", role: "switch" },
        { name: "SW2", role: "switch" },
      ],
      links: [{ a: "SW1", b: "SW2", cable: "cross" }],
    }));
    expect(r.issues.find(c => c.code === "switch_trunk_straight")).toBeUndefined();
  });
});

describe("reviewPlan — FE/GE mismatch hint", () => {
  test("router → 2960 with straight emits uplink hint", () => {
    const r = reviewPlan(makeInput({
      devices: [
        { name: "R1", role: "router", model: "ISR4331" },
        { name: "SW1", role: "switch", model: "2960-24TT" },
      ],
      links: [{ a: "R1", b: "SW1", cable: "straight" }],
    }));
    const hint = r.issues.find(i => i.code === "router_switch_uplink_hint");
    expect(hint).toBeDefined();
    expect(hint!.severity).toBe("info");
    expect(hint!.message).toContain("2960-24TT");
    expect(hint!.message).toContain("Gi0/1");
  });

  test("router → 3560 with straight also emits hint", () => {
    const r = reviewPlan(makeInput({
      devices: [
        { name: "R1", role: "router", model: "ISR4331" },
        { name: "SW1", role: "switch", model: "3560-24PS" },
      ],
      links: [{ a: "R1", b: "SW1", cable: "straight" }],
    }));
    expect(r.issues.find(i => i.code === "router_switch_uplink_hint")).toBeDefined();
  });

  test("router → switch with no model declared → no hint (benefit of doubt)", () => {
    const r = reviewPlan(makeInput({
      devices: [
        { name: "R1", role: "router" },
        { name: "SW1", role: "switch" },
      ],
      links: [{ a: "R1", b: "SW1", cable: "straight" }],
    }));
    expect(r.issues.find(i => i.code === "router_switch_uplink_hint")).toBeUndefined();
  });
});

describe("reviewPlan — inter-VLAN routing presence", () => {
  test("≥2 user LANs without router or L3 switch → WARNING", () => {
    const r = reviewPlan(makeInput({
      devices: [
        { name: "SW1", role: "switch", model: "2960-24TT" },
        { name: "PC1", role: "pc" },
        { name: "PC2", role: "pc" },
      ],
      lans: [
        { name: "LAN10", kind: "user", endpoints: ["PC1"] },
        { name: "LAN20", kind: "user", endpoints: ["PC2"] },
      ],
    }));
    const w = r.issues.find(i => i.code === "intervlan_no_l3");
    expect(w).toBeDefined();
    expect(w!.severity).toBe("warning");
  });

  test("≥2 user LANs with L3 switch (3560) → no warning", () => {
    const r = reviewPlan(makeInput({
      devices: [
        { name: "MLS1", role: "switch", model: "3560-24PS" },
        { name: "PC1", role: "pc" },
        { name: "PC2", role: "pc" },
      ],
      lans: [
        { name: "LAN10", kind: "user", endpoints: ["PC1"] },
        { name: "LAN20", kind: "user", endpoints: ["PC2"] },
      ],
    }));
    expect(r.issues.find(i => i.code === "intervlan_no_l3")).toBeUndefined();
    expect(r.issues.find(i => i.code === "intervlan_subinterfaces_reminder")).toBeUndefined();
  });

  test("≥2 user LANs with router but no L3 switch → router-on-a-stick reminder", () => {
    const r = reviewPlan(makeInput({
      devices: [
        { name: "R1", role: "router", model: "ISR4331" },
        { name: "SW1", role: "switch", model: "2960-24TT" },
        { name: "PC1", role: "pc" },
        { name: "PC2", role: "pc" },
      ],
      lans: [
        { name: "LAN10", kind: "user", endpoints: ["PC1"] },
        { name: "LAN20", kind: "user", endpoints: ["PC2"] },
      ],
    }));
    const i = r.issues.find(it => it.code === "intervlan_subinterfaces_reminder");
    expect(i).toBeDefined();
    expect(i!.severity).toBe("info");
    expect(i!.message).toContain("router-on-a-stick");
  });

  test("only 1 user LAN → no inter-VLAN check", () => {
    const r = reviewPlan(makeInput({
      devices: [
        { name: "SW1", role: "switch", model: "2960-24TT" },
        { name: "PC1", role: "pc" },
      ],
      lans: [{ name: "LAN1", kind: "user", endpoints: ["PC1"] }],
    }));
    expect(r.issues.find(i => i.code === "intervlan_no_l3")).toBeUndefined();
    expect(r.issues.find(i => i.code === "intervlan_subinterfaces_reminder")).toBeUndefined();
  });
});

describe("reviewPlan — transit LAN checks", () => {
  test("transit LAN with endpoints → WARNING", () => {
    const r = reviewPlan(makeInput({
      devices: [
        { name: "R1", role: "router" },
        { name: "PC1", role: "pc" },
      ],
      lans: [{ name: "TRANSIT", kind: "transit", endpoints: ["PC1"] }],
    }));
    const w = r.issues.find(i => i.code === "transit_with_endpoints");
    expect(w).toBeDefined();
    expect(w!.severity).toBe("warning");
  });

  test("user LAN with no endpoints → info", () => {
    const r = reviewPlan(makeInput({
      lans: [{ name: "LAN1", kind: "user", endpoints: [] }],
    }));
    const i = r.issues.find(it => it.code === "user_lan_no_endpoints");
    expect(i).toBeDefined();
    expect(i!.severity).toBe("info");
  });
});

describe("reviewPlan — counts", () => {
  test("counts routers/switches/endpoints/WAN/LAN links correctly", () => {
    const r = reviewPlan(makeInput({
      devices: [
        { name: "R1", role: "router" },
        { name: "R2", role: "router" },
        { name: "SW1", role: "switch" },
        { name: "PC1", role: "pc" },
        { name: "SRV1", role: "server" },
        { name: "PHONE1", role: "ipphone" },
      ],
      links: [
        { a: "R1", b: "R2", cable: "serial", purpose: "wan_exterior" },
        { a: "R1", b: "SW1", cable: "straight", purpose: "lan" },
        { a: "SW1", b: "PC1", cable: "straight", purpose: "lan" },
      ],
    }));
    expect(r.counts.routers).toBe(2);
    expect(r.counts.switches).toBe(1);
    expect(r.counts.endpoints).toBe(3);
    expect(r.counts.wanLinks).toBe(1);
    expect(r.counts.lanLinks).toBe(2);
  });
});

describe("reviewPlan — clean plan", () => {
  test("a well-formed 2-router WAN topology produces no errors and no warnings", () => {
    const r = reviewPlan(makeInput({
      devices: [
        { name: "R1", role: "router", model: "ISR4331" },
        { name: "R2", role: "router", model: "ISR4331" },
        { name: "SW1", role: "switch", model: "3560-24PS" },
        { name: "SW2", role: "switch", model: "3560-24PS" },
        { name: "PC1", role: "pc" },
        { name: "PC2", role: "pc" },
      ],
      links: [
        { a: "R1", b: "R2", cable: "serial", purpose: "wan_exterior" },
        { a: "R1", b: "SW1", cable: "straight", purpose: "lan" },
        { a: "R2", b: "SW2", cable: "straight", purpose: "lan" },
        { a: "SW1", b: "PC1", cable: "straight", purpose: "lan" },
        { a: "SW2", b: "PC2", cable: "straight", purpose: "lan" },
      ],
      lans: [
        { name: "LAN-A", kind: "user", endpoints: ["PC1"] },
        { name: "LAN-B", kind: "user", endpoints: ["PC2"] },
      ],
    }));
    expect(r.issues.filter(i => i.severity === "error").length).toBe(0);
    expect(r.issues.filter(i => i.severity === "warning").length).toBe(0);
  });
});
