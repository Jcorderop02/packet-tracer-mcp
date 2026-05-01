#!/usr/bin/env bun
/**
 * Smoke end-to-end: ¿el CLI que `trunkPortCli` emite para los multilayer
 * IOS XE (3650-24PS, IE-3400) es aceptado por el parser de PT 9?
 *
 * Es la pareja del probe `scripts/probe-encapsulation-parser.ts`. Aquel
 * caracteriza qué verbo concreto rechaza cada parser. Éste valida la
 * salida real del recipe de switching tras el fix:
 *
 *   - `supportsExplicitTrunkEncapsulation` ahora devuelve `false` para
 *     3650/IE-3400 → `trunkPortCli` NO emite `switchport trunk encapsulation`
 *     en esos modelos.
 *   - Por tanto un trunk directo `switchport mode trunk` + `allowed vlan`
 *     debería pasar sin `% Invalid input`.
 *
 * Si el smoke falla, significa que aún hay un verbo del template trunk que
 * el parser IOS XE rechaza — habrá que iterar el filtro de cli.ts.
 *
 * NO se ejecuta en CI. Lánzalo con PT 9 abierto y el bootstrap pegado.
 */

import { Bridge } from "../src/bridge/http-bridge.js";
import {
  addDeviceJs,
  bulkCliJs,
  removeDeviceJs,
} from "../src/ipc/generator.js";
import { waitForCliReady } from "../src/ipc/cli-wait.js";
import { trunkPortCli, wrapInConfig } from "../src/recipes/switching/cli.js";
import { runShowRunning } from "../src/sim/runner.js";

const PORT = 54321;

interface MultilayerCase {
  readonly ptType: string;
  readonly port: string;
  readonly allowed: readonly number[];
  readonly native: number;
}

const CASES: readonly MultilayerCase[] = [
  // 3650-24PS — IOS XE 16.x. Sin encapsulation, allowed=10,20,30 native=99.
  { ptType: "3650-24PS", port: "GigabitEthernet1/0/24", allowed: [10, 20, 30], native: 99 },
  // IE-3400 — IOS XE 17.x industrial.
  { ptType: "IE-3400",   port: "GigabitEthernet1/1",    allowed: [10, 20, 30], native: 99 },
];

interface CaseResult {
  readonly ptType: string;
  readonly ok: boolean;
  readonly note: string;
}

async function waitBootstrap(bridge: Bridge): Promise<boolean> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (bridge.status().connected) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

async function smokeOne(bridge: Bridge, c: MultilayerCase): Promise<CaseResult> {
  const dev = `__SMK_${c.ptType.replace(/[^A-Z0-9]/gi, "_")}`;
  try {
    await bridge.sendAndWait(
      addDeviceJs({
        name: dev,
        category: "multilayerswitch",
        model: c.ptType,
        x: 200,
        y: 200,
      }),
      20_000,
    );
    await waitForCliReady(bridge, dev, 90_000);

    // Generamos exactamente el CLI que el recipe de producción emite:
    // sólo así validamos que el camino real a través de bulkCliJs +
    // trunkPortCli se traga PT 9. encapsulation="dot1q" intencional para
    // probar que el filtro lo retira (no debería aparecer en el output).
    const trunkBody = trunkPortCli({
      switch: dev,
      switchModel: c.ptType,
      port: c.port,
      encapsulation: "dot1q",
      allowed: c.allowed,
      native: c.native,
    });

    if (/switchport trunk encapsulation/i.test(trunkBody)) {
      return {
        ptType: c.ptType,
        ok: false,
        note: `trunkPortCli emitió 'switchport trunk encapsulation' para ${c.ptType} — fix de cli.ts roto`,
      };
    }

    const block = wrapInConfig(trunkBody);
    const reply = await bridge.sendAndWait(bulkCliJs(dev, block, 4_000), 30_000);
    const output = reply ?? "<null>";

    if (/Invalid input detected/i.test(output)) {
      return {
        ptType: c.ptType,
        ok: false,
        note: `parser rechazó algún verbo del trunk:\n${output}`,
      };
    }

    // Esperar que el running-config se estabilice tras `end`.
    await new Promise((r) => setTimeout(r, 1_500));
    const running = await runShowRunning(bridge, dev, c.port, 8_000);

    const checks = [
      { regex: /switchport mode trunk/i,                            label: "switchport mode trunk" },
      { regex: new RegExp(`switchport trunk allowed vlan ${c.allowed.join(",")}`, "i"), label: `allowed vlan ${c.allowed.join(",")}` },
      { regex: new RegExp(`switchport trunk native vlan ${c.native}`, "i"),               label: `native vlan ${c.native}` },
    ];
    const missing = checks.filter((ch) => !ch.regex.test(running)).map((ch) => ch.label);
    if (missing.length > 0) {
      return {
        ptType: c.ptType,
        ok: false,
        note: `running-config no contiene: ${missing.join(", ")}\n--- running-config ---\n${running}`,
      };
    }

    return { ptType: c.ptType, ok: true, note: `trunk persistido OK en ${c.port}` };
  } catch (e) {
    return { ptType: c.ptType, ok: false, note: `error: ${(e as Error).message}` };
  } finally {
    try {
      await bridge.sendAndWait(removeDeviceJs(dev), 5_000);
    } catch {
      /* best-effort cleanup */
    }
  }
}

async function main(): Promise<number> {
  const bridge = new Bridge(PORT);
  bridge.start();
  console.log(`[smoke-trunk] bridge :${PORT}, paste bootstrap in PT and click Run...`);
  if (!(await waitBootstrap(bridge))) {
    bridge.stop();
    console.error("[smoke-trunk] no bootstrap detected");
    return 2;
  }

  const results: CaseResult[] = [];
  for (const c of CASES) {
    process.stdout.write(`[smoke-trunk] ${c.ptType.padEnd(11)} ... `);
    const r = await smokeOne(bridge, c);
    results.push(r);
    process.stdout.write(`${r.ok ? "OK" : "FAIL"}\n`);
    if (!r.ok) {
      console.log(r.note.split("\n").map((l) => `        ${l}`).join("\n"));
    }
  }

  bridge.stop();

  console.log("\n=== Summary ===");
  for (const r of results) {
    console.log(`  ${r.ptType.padEnd(11)} ${r.ok ? "OK  " : "FAIL"} ${r.note.split("\n")[0]}`);
  }
  const fails = results.filter((r) => !r.ok);
  if (fails.length === 0) {
    console.log(`\n${results.length}/${results.length} multilayer trunks aceptados por PT 9.`);
    return 0;
  }
  console.log(`\n${fails.length}/${results.length} fallaron — revisar trunkPortCli + classRejectsEncapsulation.`);
  return 1;
}

main().then((code) => process.exit(code), (err) => {
  console.error("[smoke-trunk] fatal", err);
  process.exit(1);
});
