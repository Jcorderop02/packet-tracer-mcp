/**
 * Single source of truth for "what model is this live device?".
 *
 * Identified empirically 2026-05-01 by scripts/probe-model-api.ts:
 *   d.getModel() returns the exact ptType ("1941", "ISR4321", "2950-24")
 *   on every router and switch tested.
 *
 * Earlier code used d.getClassName() — that returns the generic JS class
 * ("Router" for ALL ISR routers, "CiscoDevice" for L2/L3 switches), not
 * the model. Using getClassName broke two pre-flight checks silently:
 *   1. resolveSlotCatalogKey() never matched any catalog key, so
 *      pt_add_module skipped chassis-specific bay/family validation.
 *   2. classRejectsEncapsulation() regex /(2950|2960)/ never matched
 *      "CiscoDevice", so pt_run_cli_bulk never stripped the unsupported
 *      `switchport trunk encapsulation` line on 2950/2960.
 * The switch to getModel() restores both checks.
 */

import type { Bridge } from "../bridge/http-bridge.js";

/**
 * Returns the device's PT model string (e.g. "1941", "ISR4321",
 * "2950-24") or `null` if the device is missing / PT replied with an
 * error / the lookup failed.
 *
 * Callers must treat `null` as "unknown — give the benefit of the doubt
 * and skip chassis-specific validation". DO NOT block on null.
 */
export async function fetchDeviceModel(bridge: Bridge, deviceName: string): Promise<string | null> {
  const js =
    `(function(){var d=ipc.network().getDevice(${JSON.stringify(deviceName)});` +
    `if(!d)return"?";` +
    `try{return String(d.getModel());}catch(e){return"ERR:"+e;}})()`;
  const reply = await bridge.sendAndWait(js, {
    timeoutMs: 3_000,
    label: `Consultando modelo de ${deviceName}`,
  });
  if (!reply || reply === "?" || reply.startsWith("ERR")) return null;
  return reply;
}
