import { z } from "zod";
import { textResult } from "./helpers.js";
import type { ToolModule } from "./types.js";

/**
 * Pre-flight validation tool. The LLM declares its intended topology in
 * structured form; this tool walks the plan and emits warnings BEFORE
 * anything touches the canvas. Designed to be called once per topology
 * (not per device) — the output should be presented verbatim to the user
 * for confirmation.
 *
 * No bridge calls. Pure validation against the cabling/topology
 * conventions documented in pt://convention/*.
 */

const RoleSchema = z.enum([
  "router",
  "switch",
  "pc",
  "server",
  "laptop",
  "ipphone",
  "accesspoint",
  "cloud",
  "other",
]);

const DeviceSchema = z.object({
  name: z.string().min(1),
  role: RoleSchema,
  model: z.string().optional().describe(
    "Optional PT model (e.g., 'ISR4331', '2960-24TT'). Helps the validator " +
    "spot FE/GE mismatches and L3 capability for inter-VLAN routing.",
  ),
});

const LinkSchema = z.object({
  a: z.string().min(1).describe("Name of device A (must exist in `devices`)."),
  b: z.string().min(1).describe("Name of device B."),
  cable: z.enum(["straight", "cross", "fiber", "serial", "console", "coaxial"]),
  purpose: z.enum(["lan", "wan_exterior", "trunk", "console", "other"]).optional().describe(
    "What this link represents in the brief: 'lan' = office segment, " +
    "'wan_exterior' = public/ISP P2P link between routers, 'trunk' = " +
    "switch-to-switch backbone, 'console' = mgmt console, 'other' = misc.",
  ),
});

const LanSchema = z.object({
  name: z.string().describe("e.g., 'LAN1'"),
  kind: z.enum(["user", "transit"]).describe(
    "'user' = has PCs/servers (regular office segment); " +
    "'transit' = inter-router segment with NO endpoints, only the switch.",
  ),
  endpoints: z.array(z.string()).default([]).describe("Names of PCs/servers expected on this LAN."),
});

const InputSchema = {
  devices: z.array(DeviceSchema).describe("Every device you plan to create."),
  links: z.array(LinkSchema).describe("Every cable you plan to create."),
  lans: z.array(LanSchema).default([]).describe(
    "Optional but recommended: declare each LAN's role (user vs transit) " +
    "and which endpoints belong to it. Lets the validator catch the common " +
    "mistake of adding PCs to a transit segment.",
  ),
  notes: z.string().optional().describe(
    "Free-form context: the brief, the user's intent, anything that would " +
    "help a human reader confirm the plan.",
  ),
};

const DESCRIPTION =
  "Validate a topology plan BEFORE touching the canvas. The LLM declares devices, " +
  "links and LAN roles; the tool returns a structured review with errors (will " +
  "definitely fail), warnings (likely wrong) and a human-readable summary. " +
  "MANDATORY for any topology with ≥3 routers or whenever the user supplies a diagram. " +
  "Present the output VERBATIM to the user and wait for confirmation before " +
  "calling pt_add_device. This is the single biggest leverage to avoid the common " +
  "mistakes (Gigabit on WAN exterior, PCs on transit LANs, ad-hoc layout).";

export interface Issue {
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
}

export interface PlanReviewDevice {
  name: string;
  role:
    | "router"
    | "switch"
    | "pc"
    | "server"
    | "laptop"
    | "ipphone"
    | "accesspoint"
    | "cloud"
    | "other";
  model?: string;
}

export interface PlanReviewLink {
  a: string;
  b: string;
  cable: "straight" | "cross" | "fiber" | "serial" | "console" | "coaxial";
  purpose?: "lan" | "wan_exterior" | "trunk" | "console" | "other";
}

export interface PlanReviewLan {
  name: string;
  kind: "user" | "transit";
  endpoints: string[];
}

export interface PlanReviewInput {
  devices: PlanReviewDevice[];
  links: PlanReviewLink[];
  lans: PlanReviewLan[];
}

export interface PlanReviewCounts {
  routers: number;
  switches: number;
  endpoints: number;
  wanLinks: number;
  lanLinks: number;
}

export interface PlanReviewResult {
  issues: Issue[];
  counts: PlanReviewCounts;
}

export function reviewPlan(input: PlanReviewInput): PlanReviewResult {
  const { devices, links, lans } = input;
  const issues: Issue[] = [];
  const byName = new Map(devices.map(d => [d.name, d]));
  const role = (n: string) => byName.get(n)?.role;

  // -- Existence checks --
  for (const link of links) {
    if (!byName.has(link.a)) {
      issues.push({ severity: "error", code: "unknown_device",
        message: `Link references unknown device '${link.a}'. Add it to 'devices' or fix the name.` });
    }
    if (!byName.has(link.b)) {
      issues.push({ severity: "error", code: "unknown_device",
        message: `Link references unknown device '${link.b}'.` });
    }
  }
  for (const lan of lans) {
    for (const ep of lan.endpoints) {
      if (!byName.has(ep)) {
        issues.push({ severity: "error", code: "unknown_endpoint",
          message: `LAN '${lan.name}' lists unknown endpoint '${ep}'.` });
      }
    }
  }

  // -- Cabling convention checks --
  for (const link of links) {
    const ra = role(link.a);
    const rb = role(link.b);
    if (!ra || !rb) continue;

    // Router↔Router with non-serial cable: classic mistake.
    if (ra === "router" && rb === "router" && link.cable !== "serial") {
      if (link.purpose === "wan_exterior") {
        issues.push({ severity: "error", code: "wan_with_ethernet",
          message: `${link.a} ↔ ${link.b}: declared purpose=wan_exterior but cable=${link.cable}. ` +
                   `WAN exterior P2P between routers must be 'serial'. Add HWIC-2T to both routers and use Serial0/1/0.` });
      } else if (link.purpose === "lan" || link.purpose === "trunk") {
        issues.push({ severity: "warning", code: "router_to_router_ethernet",
          message: `${link.a} ↔ ${link.b}: two routers connected with cable=${link.cable}. ` +
                   `Confirmed as internal LAN — pt_create_link will require confirm_internal_lan=true.` });
      } else {
        issues.push({ severity: "warning", code: "router_to_router_ambiguous",
          message: `${link.a} ↔ ${link.b}: two routers cabled with ${link.cable}. ` +
                   `Declare 'purpose' (wan_exterior or lan) so the validator can advise. ` +
                   `If this is between offices via the public Internet, use cable='serial' + HWIC-2T.` });
      }
    }

    // Switch↔Switch should be cross (trunk). Straight works on PT auto-MDIX
    // but is not the academic convention.
    if (ra === "switch" && rb === "switch" && link.cable === "straight") {
      issues.push({ severity: "info", code: "switch_trunk_straight",
        message: `${link.a} ↔ ${link.b}: switch trunk usually uses cable='cross'.` });
    }

    // Serial without explicit HWIC mention — info, not warning.
    if (link.cable === "serial" && (ra === "router" || rb === "router")) {
      issues.push({ severity: "info", code: "serial_needs_hwic",
        message: `${link.a} ↔ ${link.b}: serial link — remember pt_add_module HWIC-2T on both routers BEFORE creating the link.` });
    }
  }

  // -- FE/GE mismatch hint on router↔switch links --
  for (const link of links) {
    const ra = role(link.a);
    const rb = role(link.b);
    if (!ra || !rb) continue;
    const switchEnd =
      ra === "router" && rb === "switch"
        ? byName.get(link.b)
        : ra === "switch" && rb === "router"
        ? byName.get(link.a)
        : null;
    if (!switchEnd) continue;
    const isFePrincipallySwitch =
      switchEnd.model && /(2960|3560|2950)/i.test(switchEnd.model);
    if (link.cable === "straight" && isFePrincipallySwitch) {
      issues.push({
        severity: "info",
        code: "router_switch_uplink_hint",
        message:
          `${link.a} ↔ ${link.b}: router→${switchEnd.model} link — ` +
          `prefer a GigabitEthernet uplink (Gi0/1 or Gi0/2) on the switch ` +
          `side. Plugging into a FastEthernet downlink (Fa0/N) works but ` +
          `caps the trunk at 100 Mbps via autoneg.`,
      });
    }
  }

  // -- Inter-VLAN routing presence check --
  const userLans = lans.filter(l => l.kind === "user");
  if (userLans.length >= 2) {
    const hasRouter = devices.some(d => d.role === "router");
    const hasL3Switch = devices.some(
      d => d.role === "switch" && d.model && /(3560|3650|IE-3400|IE-9320)/i.test(d.model),
    );
    if (!hasRouter && !hasL3Switch) {
      issues.push({
        severity: "warning",
        code: "intervlan_no_l3",
        message:
          `Plan declares ${userLans.length} user LANs but contains no router ` +
          `and no L3-capable switch (3560/3650/IE-3400/IE-9320). Hosts on ` +
          `different LANs won't be able to reach each other. Add a router ` +
          `(router-on-a-stick with subinterfaces) or a multilayer switch.`,
      });
    } else if (hasRouter && !hasL3Switch) {
      issues.push({
        severity: "info",
        code: "intervlan_subinterfaces_reminder",
        message:
          `Plan has ${userLans.length} user LANs. If they share one switch and ` +
          `one router uplink, configure router-on-a-stick: trunk between switch ` +
          `and router + subinterfaces (e.g., Gi0/0.10, Gi0/0.20) with 802.1Q tags. ` +
          `Otherwise inter-VLAN traffic won't route.`,
      });
    }
  }

  // -- Transit LAN checks --
  for (const lan of lans) {
    if (lan.kind === "transit" && lan.endpoints.length > 0) {
      issues.push({ severity: "warning", code: "transit_with_endpoints",
        message: `LAN '${lan.name}' is declared as transit but has ${lan.endpoints.length} endpoint(s) (${lan.endpoints.join(", ")}). ` +
                 `Transit segments between routers normally have no PCs/servers — only the switch joining the routers.` });
    }
    if (lan.kind === "user" && lan.endpoints.length === 0) {
      issues.push({ severity: "info", code: "user_lan_no_endpoints",
        message: `LAN '${lan.name}' is declared as user-LAN but has no endpoints listed. Confirm with the user that this is intended.` });
    }
  }

  const counts: PlanReviewCounts = {
    routers: devices.filter(d => d.role === "router").length,
    switches: devices.filter(d => d.role === "switch").length,
    endpoints: devices.filter(d => ["pc", "server", "laptop", "ipphone"].includes(d.role)).length,
    wanLinks: links.filter(l => l.purpose === "wan_exterior").length,
    lanLinks: links.filter(l => l.purpose === "lan").length,
  };

  return { issues, counts };
}

export function formatPlanReview(
  result: PlanReviewResult,
  meta: { devices: number; links: number; lans: PlanReviewLan[]; notes?: string },
): string {
  const { issues, counts } = result;
  const errors = issues.filter(i => i.severity === "error");
  const warnings = issues.filter(i => i.severity === "warning");
  const infos = issues.filter(i => i.severity === "info");

  const lines: string[] = [];
  lines.push("# Topology plan review");
  lines.push("");
  if (meta.notes) {
    lines.push("## Context");
    lines.push(meta.notes);
    lines.push("");
  }
  lines.push("## Counts");
  lines.push(`- Routers: ${counts.routers}`);
  lines.push(`- Switches: ${counts.switches}`);
  lines.push(`- Endpoints (PC/server/laptop/phone): ${counts.endpoints}`);
  lines.push(`- WAN exterior links: ${counts.wanLinks}`);
  lines.push(`- LAN links: ${counts.lanLinks}`);
  lines.push(`- Total devices: ${meta.devices}, total links: ${meta.links}, declared LANs: ${meta.lans.length}`);
  lines.push("");

  if (meta.lans.length > 0) {
    lines.push("## LAN roles");
    for (const lan of meta.lans) {
      const ep = lan.endpoints.length > 0 ? `[${lan.endpoints.join(", ")}]` : "(no endpoints)";
      lines.push(`- ${lan.name}: ${lan.kind} ${ep}`);
    }
    lines.push("");
  }

  if (errors.length > 0) {
    lines.push(`## Errors (${errors.length}) — MUST fix before applying`);
    for (const e of errors) lines.push(`- [${e.code}] ${e.message}`);
    lines.push("");
  }
  if (warnings.length > 0) {
    lines.push(`## Warnings (${warnings.length}) — likely wrong, confirm with user`);
    for (const w of warnings) lines.push(`- [${w.code}] ${w.message}`);
    lines.push("");
  }
  if (infos.length > 0) {
    lines.push(`## Notes (${infos.length})`);
    for (const i of infos) lines.push(`- [${i.code}] ${i.message}`);
    lines.push("");
  }

  lines.push("## Next step");
  if (errors.length > 0) {
    lines.push("Fix the errors above and call pt_plan_review again. Do NOT call pt_add_device until the plan is clean.");
  } else if (warnings.length > 0) {
    lines.push("Present this review to the user verbatim, get explicit confirmation, then proceed with pt_add_device.");
  } else {
    lines.push("Plan looks consistent. Present the counts to the user for a final OK, then proceed with pt_add_device.");
  }

  return lines.join("\n");
}

export const registerPlanReviewTool: ToolModule = ({ server }) => {
  server.tool(
    "pt_plan_review",
    DESCRIPTION,
    InputSchema,
    async ({ devices, links, lans, notes }) => {
      const result = reviewPlan({ devices, links, lans });
      const text = formatPlanReview(result, {
        devices: devices.length,
        links: links.length,
        lans,
        notes,
      });
      return textResult(text);
    },
  );
};
