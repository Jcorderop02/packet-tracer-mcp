/**
 * Per-router-model module slot catalog.
 *
 * Validates `pt_add_module` BEFORE sending to PT 9, so the user gets a clean
 * error like "1941 only has 2 EHWIC slots: 0/0 and 0/1" instead of PT's
 * silent fail. Slot paths follow PT's chassis/bay format ("0/0", "0/1", ...).
 *
 * Sources:
 *   - Cisco ISR G2 ordering guide (1900/2900 series)
 *   - Cisco ISR 4000 platform documentation (4321, 4331, NIM family)
 *   - Verified port layouts in `src/catalog/devices.ts` (probe runs on 2026-04-29)
 *
 * Notes:
 *   - "0/0" on ISR4xxx is the built-in NIM (the integrated GE ports);
 *     user-installable bays start at 0/1.
 *   - HWIC and EHWIC are physically the same form factor; EHWIC adds
 *     enhanced capabilities. Both fit in HWIC bays on G2 routers.
 *   - Some modules (NM, NME, double-wide HWIC) consume more than one bay.
 *     We don't model that here — the catalog only lists the bay paths PT
 *     accepts as starting positions.
 */

export interface SlotInfo {
  /** Bay paths the chassis accepts modules in. */
  readonly bays: readonly string[];
  /** Module families the chassis is rated for (informational). */
  readonly families: readonly ("HWIC" | "EHWIC" | "NIM" | "WIC" | "NM" | "PVDM" | "SM-X")[];
}

/**
 * Map of PT model → installable bays. Keys MUST match `DeviceModel.ptType`
 * in `src/catalog/devices.ts`. Models not listed here (PT-Empty generics,
 * fixed-chassis branch routers, etc.) accept any bay path — the validator
 * skips them.
 */
export const ROUTER_SLOT_CATALOG: Readonly<Record<string, SlotInfo>> = {
  // ISR G1 (FastEthernet generation, HWIC slots).
  // 1841: 2 HWIC slots, no NM. PT 9 also accepts NIM-2T in HWIC bays
  // "por compatibilidad" (probe-module-bays 2026-05-01) — real Cisco
  // would reject because NIM modules need a 4xxx chassis, but PT is
  // permissive and we mirror its policy.
  "1841": { bays: ["0/0", "0/1"], families: ["HWIC", "WIC", "NIM"] },
  // 2620XM/2621XM: 2 WIC bays. PT 9 accepts HWIC and NIM as well
  // (probe-module-bays 2026-05-01).
  "2620XM": { bays: ["0/0", "0/1"], families: ["WIC", "HWIC", "NIM"] },
  "2621XM": { bays: ["0/0", "0/1"], families: ["WIC", "HWIC", "NIM"] },
  // 2811: 4 HWIC + 1 NM. HWIC bays 0/0..0/3. NIM permitted by PT 9.
  "2811": { bays: ["0/0", "0/1", "0/2", "0/3"], families: ["HWIC", "WIC", "NM", "NIM"] },

  // ISR G2 (Gigabit generation, EHWIC slots).
  // 1941: 2 EHWIC bays. NIM permitted by PT 9 (probe-module-bays 2026-05-01).
  "1941": { bays: ["0/0", "0/1"], families: ["EHWIC", "HWIC", "WIC", "NIM"] },
  // 2901: 4 EHWIC bays.
  "2901": { bays: ["0/0", "0/1", "0/2", "0/3"], families: ["EHWIC", "HWIC", "WIC", "NIM"] },
  // 2911: 4 EHWIC + 1 ISM. EHWIC bays 0/0..0/3.
  "2911": { bays: ["0/0", "0/1", "0/2", "0/3"], families: ["EHWIC", "HWIC", "WIC", "NIM"] },

  // ISR 4000 (NIM slots; 0/0 is the built-in front-panel GE block,
  // pre-occupied — probe-module-bays sees it returning "occupied").
  // ISR4321: 2 NIM bays (0/1, 0/2) + 1 SM-X (1/0). 0/2 verified by
  // probe-module-bays 2026-05-01 (PT accepts HWIC-2T at 0/2).
  // CAVEAT: bay 1/0 only accepts SM-X — probe shows PT rejecting NIM-2T
  // and HWIC-2T there. We can't model per-bay families with our flat
  // schema, so the catalog says "valid" and PT enforces the SM-X-only
  // rule at runtime. Add-module surfaces PT's rejection to the user.
  "ISR4321": { bays: ["0/1", "0/2", "1/0"], families: ["NIM", "SM-X", "HWIC"] },
  // ISR4331: 2 NIM bays (0/1, 0/2) + 1 SM-X (1/0). Same per-bay caveat
  // as ISR4321 — bay 1/0 is SM-X-only.
  "ISR4331": { bays: ["0/1", "0/2", "1/0"], families: ["NIM", "SM-X", "HWIC"] },
} as const;

/**
 * Map of module name → family. Used to reject obvious mismatches before
 * sending to PT (e.g. installing HWIC-2T on an ISR4321 NIM bay). Unknown
 * modules are not gated — we give the benefit of the doubt rather than
 * blocking the call.
 *
 * Sources: Cisco module ordering guides + PT 9 stock module list.
 */
export const MODULE_FAMILY: Readonly<Record<string, "HWIC" | "EHWIC" | "NIM" | "WIC" | "NM" | "PVDM" | "SM-X">> = {
  // HWIC / EHWIC family (ISR G1 + G2).
  "HWIC-1T": "HWIC",
  "HWIC-2T": "HWIC",
  "HWIC-4T": "HWIC",
  "HWIC-8A": "HWIC",
  "HWIC-1FE": "HWIC",
  "HWIC-2FE": "HWIC",
  "EHWIC-1GE-SFP-CU": "EHWIC",
  "EHWIC-4ESG": "EHWIC",
  // WIC (ISR G1 + 2600).
  "WIC-1T": "WIC",
  "WIC-2T": "WIC",
  "WIC-1ENET": "WIC",
  // NIM family (ISR 4xxx).
  "NIM-1T": "NIM",
  "NIM-2T": "NIM",
  "NIM-4T": "NIM",
  "NIM-ES2-4": "NIM",
  "NIM-ES2-8": "NIM",
  "NIM-1MFT-T1/E1": "NIM",
  "NIM-2MFT-T1/E1": "NIM",
  // SM-X (ISR G2 service modules + ISR 4xxx).
  "SM-X-PVDM-500": "SM-X",
  "SM-X-PVDM-1000": "SM-X",
  // PVDM (DSP add-on; doesn't fit in HWIC/NIM bays — separate slot).
  "PVDM2-32": "PVDM",
  "PVDM3-32": "PVDM",
  "PVDM4-32": "PVDM",
};

/**
 * Reject a clear chassis/module-family mismatch. Returns null when the
 * combination is OK (or unknown — we don't gate). Otherwise a human error.
 *
 * Rules:
 *  - HWIC/EHWIC modules need an HWIC or EHWIC bay (G1/G2 routers).
 *  - NIM modules need a NIM bay (ISR 4xxx).
 *  - Trying HWIC on a NIM bay (or vice-versa) is a clear bug.
 */
export function validateModuleFamily(model: string, moduleName: string): string | null {
  const key = resolveSlotCatalogKey(model);
  if (!key) return null;
  const info = ROUTER_SLOT_CATALOG[key]!;
  const family = MODULE_FAMILY[moduleName];
  if (!family) return null; // Unknown module — don't gate.
  if (info.families.includes(family)) return null;
  return (
    `Module '${moduleName}' is a ${family} card, but ${key} only accepts ` +
    `${info.families.join("/")} cards. ` +
    (family === "HWIC" || family === "EHWIC"
      ? `For ISR 4xxx routers use NIM-2T / NIM-4T instead.`
      : family === "NIM"
      ? `For ISR G1/G2 routers (1841/2811/1941/2901/2911) use HWIC-2T instead.`
      : `Choose a module from the ${info.families.join("/")} family.`)
  );
}

/**
 * Resolve a catalog key from whatever `getClassName()` returns. PT 9 has
 * been observed to return strings that may or may not match the catalog
 * key exactly (e.g. "Router1941", "1941", "Cisco1941"). To stay safe we
 * try exact match first, then look for a catalog key as a substring.
 *
 * Returns the catalog key (e.g. "1941") or null if no match.
 */
export function resolveSlotCatalogKey(className: string | null | undefined): string | null {
  if (!className) return null;
  if (ROUTER_SLOT_CATALOG[className]) return className;
  const lc = className.toLowerCase();
  // Iterate longest-key first so "ISR4331" wins over "1941" if both could
  // theoretically match (defensive — they cannot today, but cheap).
  const keys = Object.keys(ROUTER_SLOT_CATALOG).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (lc.includes(key.toLowerCase())) return key;
  }
  return null;
}

/**
 * Validate a slot path for a known router model. Returns null if the slot
 * is valid (or the model is not in the catalog — we don't gate unknowns).
 * Otherwise returns a human-readable error string.
 *
 * Accepts either the exact catalog key ("1941") or whatever PT's
 * `getClassName()` returns ("Router1941", "Cisco1941", ...).
 */
export function validateModuleSlot(model: string, slot: string): string | null {
  const key = resolveSlotCatalogKey(model);
  if (!key) return null;
  const info = ROUTER_SLOT_CATALOG[key]!;
  if (info.bays.includes(slot)) return null;
  return (
    `Slot '${slot}' is not a valid module bay on ${key}. ` +
    `Available bays: ${info.bays.join(", ")} (families: ${info.families.join(", ")}).`
  );
}
