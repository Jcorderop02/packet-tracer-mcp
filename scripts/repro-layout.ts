import { gridLayoutCanvas } from "../src/canvas/layout.js";
import type { CanvasSnapshot, DeviceObservation, LinkObservation } from "../src/canvas/types.js";
import type { DeviceCategory } from "../src/ipc/constants.js";

function dev(name: string, category: DeviceCategory, x: number, y: number): DeviceObservation {
  return { name, model: name, className: category, category, x, y, powered: true, ports: [] };
}
function link(a: string, b: string): LinkObservation {
  return { aDevice: a, aPort: "p", bDevice: b, bPort: "p" };
}

const snapshot: CanvasSnapshot = {
  capturedAt: "x",
  devices: [
    dev("R1", "router", 100, 100),
    dev("R2", "router", 325, 100),
    dev("R3", "router", 550, 100),
    dev("R4", "router", 775, 100),
    dev("Internet", "router", 1000, 100),
    dev("SW1", "switch", 100, 250),
    dev("SW2", "switch", 319, 250),
    dev("SW3", "switch", 538, 250),
    dev("SW4", "switch", 757, 250),
    dev("SW5", "switch", 976, 250),
    dev("SW6", "switch", 1195, 250),
    dev("SW_INET", "switch", 1414, 250),
    dev("PC1", "pc", 100, 400),
    dev("PC2", "pc", 327, 400),
    dev("PC5", "pc", 554, 400),
    dev("PC6", "pc", 781, 400),
    dev("WebDNS", "server", 100, 480),
  ],
  links: [
    link("R1", "SW1"),
    link("SW1", "PC1"),
    link("R1", "SW2"),
    link("SW2", "PC2"),
    link("R1", "SW3"),
    link("R2", "SW3"),
    link("R2", "Internet"),
    link("R3", "Internet"),
    link("R3", "SW4"),
    link("R4", "SW4"),
    link("R4", "SW5"),
    link("SW5", "PC5"),
    link("R4", "SW6"),
    link("SW6", "PC6"),
    link("Internet", "SW_INET"),
    link("SW_INET", "WebDNS"),
  ],
};

const moves = gridLayoutCanvas(snapshot);
for (const m of moves) console.log(`  ${m.name.padEnd(10)} -> (${m.x}, ${m.y})`);
