import type { CableKind } from "../ipc/constants.js";

export const CABLE_DESCRIPTIONS: Record<CableKind, string> = {
  straight: "Copper Straight-Through",
  cross:    "Copper Cross-Over",
  fiber:    "Fiber",
  console:  "Console",
  coaxial:  "Coaxial",
  serial:   "Serial DCE",
};

const PAIR_RULES: Record<string, CableKind> = {
  "router|switch":      "straight",
  "switch|router":      "straight",
  "switch|pc":          "straight",
  "pc|switch":          "straight",
  "switch|server":      "straight",
  "server|switch":      "straight",
  "switch|laptop":      "straight",
  "laptop|switch":      "straight",
  "switch|accesspoint": "straight",
  "accesspoint|switch": "straight",
  "router|cloud":       "straight",
  "cloud|router":       "straight",
  "router|router":      "cross",
  "switch|switch":      "cross",
  "router|pc":          "cross",
  "pc|router":          "cross",
  "router|server":      "cross",
  "server|router":      "cross",
};

export function inferCable(catA: string, catB: string): CableKind {
  return PAIR_RULES[`${catA}|${catB}`] ?? "straight";
}
