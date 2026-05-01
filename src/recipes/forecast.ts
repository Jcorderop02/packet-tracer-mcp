/**
 * Dry-run estimator. Given a blueprint, predict how many devices, links and
 * subnets it will allocate without touching the live canvas. The forecast
 * uses the same allocator the addressing recipe runs against PT, so a clean
 * forecast is a strong predictor of a clean apply.
 *
 * The output is intentionally human-shaped (counts + first few sample
 * allocations) — it's meant for humans to sanity-check before they commit.
 */

import { resolveModel } from "../catalog/devices.js";
import { SubnetIterator } from "../canvas/subnetting.js";
import { withDefaults, validateBlueprintReferences, type Blueprint } from "./blueprint.js";

export interface SubnetSample {
  readonly purpose: string;
  readonly cidr: string;
}

export interface Forecast {
  readonly blueprint: string;
  readonly devices: number;
  readonly links: number;
  readonly lans: number;
  readonly transitLinks: number;
  readonly sampleSubnets: readonly SubnetSample[];
  readonly warnings: readonly string[];
}

export function forecast(rawBlueprint: Blueprint): Forecast {
  const errors = validateBlueprintReferences(rawBlueprint);
  if (errors.length > 0) {
    throw new Error(`blueprint references invalid devices:\n  - ${errors.join("\n  - ")}`);
  }
  const b = withDefaults(rawBlueprint);

  const warnings: string[] = [];
  for (const dev of b.devices) {
    if (!resolveModel(dev.model)) {
      warnings.push(`unknown model '${dev.model}' for device '${dev.name}'`);
    }
  }

  const lanIter = new SubnetIterator(b.addressing.lanPool ?? "192.168.0.0/16", 24);
  const transitIter = new SubnetIterator(b.addressing.transitPool ?? "10.0.0.0/16", 30);

  const samples: SubnetSample[] = [];
  for (const lan of b.lans) {
    const subnet = lan.cidr ?? `${lanIter.next().network}/24`;
    samples.push({ purpose: `LAN behind ${lan.gatewayDevice}/${lan.gatewayPort}`, cidr: subnet });
  }

  // A "transit" link is one between two routers — use the link list to
  // approximate the count without consulting the live canvas.
  const routerNames = new Set(
    b.devices
      .filter(d => {
        const m = resolveModel(d.model);
        return m?.category === "router";
      })
      .map(d => d.name),
  );
  let transitCount = 0;
  for (const lnk of b.links) {
    if (routerNames.has(lnk.aDevice) && routerNames.has(lnk.bDevice)) {
      transitCount++;
      if (samples.length < 16) {
        samples.push({
          purpose: `transit ${lnk.aDevice}<->${lnk.bDevice}`,
          cidr: `${transitIter.next().network}/30`,
        });
      }
    }
  }

  return {
    blueprint: b.name,
    devices: b.devices.length,
    links: b.links.length,
    lans: b.lans.length,
    transitLinks: transitCount,
    sampleSubnets: samples,
    warnings,
  };
}

export function summarizeForecast(f: Forecast): string {
  const lines: string[] = [
    `Forecast for blueprint '${f.blueprint}':`,
    `  devices: ${f.devices}`,
    `  links:   ${f.links} (transit between routers: ${f.transitLinks})`,
    `  LANs:    ${f.lans}`,
  ];
  if (f.sampleSubnets.length > 0) {
    lines.push("", "Allocations (first sample):");
    for (const s of f.sampleSubnets) lines.push(`  - ${s.purpose} -> ${s.cidr}`);
  }
  if (f.warnings.length > 0) {
    lines.push("", "Warnings:");
    for (const w of f.warnings) lines.push(`  ! ${w}`);
  }
  return lines.join("\n");
}
