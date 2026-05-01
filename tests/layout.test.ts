import { describe, expect, test } from "bun:test";
import { gridLayoutCanvas, LAYOUT } from "../src/canvas/layout.js";
import type { CanvasSnapshot, DeviceObservation, LinkObservation } from "../src/canvas/types.js";
import type { DeviceCategory } from "../src/ipc/constants.js";

function dev(name: string, category: DeviceCategory, x = 0, y = 0): DeviceObservation {
  return {
    name,
    model: name,
    className: category,
    category,
    x,
    y,
    powered: true,
    ports: [],
  };
}
function link(a: string, b: string): LinkObservation {
  return { aDevice: a, aPort: "p", bDevice: b, bPort: "p" };
}
function snap(devices: DeviceObservation[], links: LinkObservation[]): CanvasSnapshot {
  return { capturedAt: "test", devices, links };
}
function placedAt(moves: readonly { name: string; x: number; y: number }[], name: string) {
  return moves.find(m => m.name === name);
}

describe("gridLayoutCanvas — algoritmo v2", () => {
  test("orden de routers respeta la X actual del snapshot", () => {
    // Routers desordenados en X: R3 a la izquierda. El layout debe respetar
    // la posición visual que el usuario ya tenía.
    const devices = [
      dev("R3", "router", 0, 0),
      dev("R1", "router", 50, 0),
      dev("R2", "router", 100, 0),
      dev("R4", "router", 200, 0),
    ];
    const links = [link("R1", "R2"), link("R2", "R3"), link("R3", "R4")];
    const moves = gridLayoutCanvas(snap(devices, links));
    const r3 = placedAt(moves, "R3")!;
    const r1 = placedAt(moves, "R1")!;
    const r2 = placedAt(moves, "R2")!;
    const r4 = placedAt(moves, "R4")!;
    expect(r3.x).toBeLessThan(r1.x);
    expect(r1.x).toBeLessThan(r2.x);
    expect(r2.x).toBeLessThan(r4.x);
    expect(r3.y).toBe(LAYOUT.Y_ROUTER);
    expect(r4.y).toBe(LAYOUT.Y_ROUTER);
  });

  test("topología fresca (todos los routers en la misma X) ordena por nombre", () => {
    // Caso típico de un canvas recién cocinado: R1-R4 en (0,0) salvo orden
    // alfabético del nombre. El desempate por nombre da R1-R2-R3-R4.
    const devices = [
      dev("R4", "router"), dev("R2", "router"),
      dev("R1", "router"), dev("R3", "router"),
    ];
    const links = [link("R1", "R2"), link("R2", "R3"), link("R3", "R4")];
    const moves = gridLayoutCanvas(snap(devices, links));
    const xs = ["R1", "R2", "R3", "R4"].map(n => placedAt(moves, n)!.x);
    expect(xs[0]!).toBeLessThan(xs[1]!);
    expect(xs[1]!).toBeLessThan(xs[2]!);
    expect(xs[2]!).toBeLessThan(xs[3]!);
  });

  test("las clouds se reparten arriba y abajo del router, no todas en la fila superior", () => {
    // Un router con 4 clouds → mitad arriba (Y_CLOUD), mitad abajo (Y_CLOUD_BOTTOM).
    const devices = [
      dev("R1", "router"),
      dev("LAN1", "cloud"),
      dev("LAN2", "cloud"),
      dev("LAN3", "cloud"),
      dev("LAN4", "cloud"),
    ];
    const links = [link("R1", "LAN1"), link("R1", "LAN2"), link("R1", "LAN3"), link("R1", "LAN4")];
    const moves = gridLayoutCanvas(snap(devices, links));
    const ys = ["LAN1", "LAN2", "LAN3", "LAN4"]
      .map(n => placedAt(moves, n)!.y);
    const top = ys.filter(y => y === LAYOUT.Y_CLOUD).length;
    const bottom = ys.filter(y => y === LAYOUT.Y_CLOUD_BOTTOM).length;
    expect(top).toBeGreaterThan(0);
    expect(bottom).toBeGreaterThan(0);
    expect(top + bottom).toBe(4);
  });

  test("nodo compartido por dos routers queda centrado entre ellos", () => {
    // Internet conectado a R2 y R3 → x ≈ promedio de centros de R2 y R3.
    const devices = [
      dev("R1", "router"), dev("R2", "router"),
      dev("R3", "router"), dev("R4", "router"),
      dev("Internet", "cloud"),
    ];
    const links = [
      link("R1", "R2"), link("R2", "R3"), link("R3", "R4"),
      link("Internet", "R2"), link("Internet", "R3"),
    ];
    const moves = gridLayoutCanvas(snap(devices, links));
    const r2 = placedAt(moves, "R2")!;
    const r3 = placedAt(moves, "R3")!;
    const inet = placedAt(moves, "Internet")!;
    const mid = (r2.x + r3.x) / 2;
    // Tolerancia 2px de redondeo.
    expect(Math.abs(inet.x - mid)).toBeLessThan(2);
    // Y de cloud "compartida" cae a la banda inferior.
    expect(inet.y).toBe(LAYOUT.Y_CLOUD_BOTTOM);
  });

  test("switches hermanos bajo el mismo router se reparten horizontalmente, sin colisión", () => {
    // R1 con 3 switches hermanos. Deben estar en la misma fila Y_SWITCH y a
    // distinta X (sin pisarse).
    const devices = [
      dev("R1", "router"),
      dev("S1", "switch"), dev("S2", "switch"), dev("S3", "switch"),
    ];
    const links = [link("R1", "S1"), link("R1", "S2"), link("R1", "S3")];
    const moves = gridLayoutCanvas(snap(devices, links));
    const sw = ["S1", "S2", "S3"].map(n => placedAt(moves, n)!);
    expect(sw.every(s => s.y === LAYOUT.Y_SWITCH)).toBe(true);
    const xs = sw.map(s => s.x).sort((a, b) => a - b);
    expect(xs[1]! - xs[0]!).toBeGreaterThanOrEqual(60);
    expect(xs[2]! - xs[1]!).toBeGreaterThanOrEqual(60);
  });

  test("endpoints de un switch se centran bajo ese switch (no bajo el router)", () => {
    const devices = [
      dev("R1", "router"),
      dev("S1", "switch"),
      dev("S2", "switch"),
      dev("PC1", "pc"), dev("PC2", "pc"),
      dev("PC3", "pc"), dev("PC4", "pc"),
    ];
    const links = [
      link("R1", "S1"), link("R1", "S2"),
      link("S1", "PC1"), link("S1", "PC2"),
      link("S2", "PC3"), link("S2", "PC4"),
    ];
    const moves = gridLayoutCanvas(snap(devices, links));
    const s1 = placedAt(moves, "S1")!.x;
    const s2 = placedAt(moves, "S2")!.x;
    const pc1 = placedAt(moves, "PC1")!.x;
    const pc2 = placedAt(moves, "PC2")!.x;
    const pc3 = placedAt(moves, "PC3")!.x;
    const pc4 = placedAt(moves, "PC4")!.x;
    // PC1/PC2 centrados sobre S1; PC3/PC4 centrados sobre S2.
    expect(Math.abs((pc1 + pc2) / 2 - s1)).toBeLessThan(2);
    expect(Math.abs((pc3 + pc4) / 2 - s2)).toBeLessThan(2);
  });

  test("idempotencia: aplicar el layout y volver a llamarlo no produce moves nuevos", () => {
    const devices = [
      dev("R1", "router"), dev("R2", "router"),
      dev("S1", "switch"), dev("PC1", "pc"), dev("PC2", "pc"),
      dev("LAN1", "cloud"), dev("LAN2", "cloud"),
    ];
    const links = [
      link("R1", "R2"), link("R1", "S1"),
      link("S1", "PC1"), link("S1", "PC2"),
      link("R1", "LAN1"), link("R2", "LAN2"),
    ];
    const moves1 = gridLayoutCanvas(snap(devices, links));
    expect(moves1.length).toBeGreaterThan(0);
    // Aplicar y volver a llamar.
    const moved = devices.map(d => {
      const m = moves1.find(x => x.name === d.name);
      return m ? { ...d, x: m.x, y: m.y } : d;
    });
    const moves2 = gridLayoutCanvas(snap(moved, links));
    expect(moves2).toHaveLength(0);
  });

  test("router sin hijos sigue ocupando un slot mínimo (no choca con el siguiente)", () => {
    const devices = [
      dev("R1", "router"),
      dev("R2", "router"),
      dev("R3", "router"),
    ];
    const links = [link("R1", "R2"), link("R2", "R3")];
    const moves = gridLayoutCanvas(snap(devices, links));
    const xs = ["R1", "R2", "R3"].map(n => placedAt(moves, n)!.x);
    // Routers separados al menos 2 unidades + GAP.
    expect(xs[1]! - xs[0]!).toBeGreaterThanOrEqual(2 * LAYOUT.PC_X_SPACING);
    expect(xs[2]! - xs[1]!).toBeGreaterThanOrEqual(2 * LAYOUT.PC_X_SPACING);
  });

  test("switches huérfanos (sin router) van a una columna lateral", () => {
    const devices = [
      dev("R1", "router"),
      dev("S1", "switch"),
      dev("S_orphan", "switch"),
      dev("PC_orphan", "pc"),
    ];
    const links = [
      link("R1", "S1"),
      link("S_orphan", "PC_orphan"),
    ];
    const moves = gridLayoutCanvas(snap(devices, links));
    const r1 = placedAt(moves, "R1")!.x;
    const sOrphan = placedAt(moves, "S_orphan");
    expect(sOrphan).toBeDefined();
    expect(sOrphan!.x).toBeGreaterThan(r1);
  });

  test("RO2-P2: práctica VoIP+QoS con dos sedes y enlace serial", () => {
    // Réplica fiel de la topología pedida en la práctica RO2-P2 (Voz sobre IP
    // y QoS) — dos routers 2811 unidos por serial, sede 1 con switch 2950 +
    // 3560 + Server-PT DHCP + 4 PCs + 3 IP phones + 1 ATA, sede 2 con un
    // 3560 y 3 IP phones. Sirve como test de integración del algoritmo de
    // layout v2 contra una topología real.
    const devices = [
      // Routers (backbone)
      dev("R1", "router"),
      dev("R2", "router"),
      // Switches sede 1
      dev("S_access", "switch"),         // Cisco 2950
      dev("S_main", "multilayerswitch"), // Cisco 3560
      // Switch sede 2
      dev("S2", "multilayerswitch"),     // Cisco 3560
      // Endpoints sede 1 — colgados de S_access
      dev("PC01", "pc"),
      dev("PC02", "pc"),
      dev("PC03", "pc"),
      dev("Phone1001", "ipphone"),
      dev("Phone1002", "ipphone"),
      // Endpoints sede 1 — colgados de S_main
      dev("Server_DHCP", "server"),
      dev("Phone1003", "ipphone"),
      dev("PC04", "pc"),
      dev("ATA1004", "iot"),             // Home-VoIP-PT
      dev("AnalogPhone1004", "tdm"),     // Analog-Phone-PT colgada del ATA
      // Endpoints sede 2 — colgados de S2
      dev("Phone4001", "ipphone"),
      dev("Phone4002", "ipphone"),
      dev("Phone4003", "ipphone"),
    ];
    const links = [
      // Backbone serial 2M
      link("R1", "R2"),
      // Sede 1 — R1 ↔ S_main (trunk a 3560), S_main ↔ S_access (trunk)
      link("R1", "S_main"),
      link("S_main", "S_access"),
      // S_access: PC01-03 + Phone1001-1002
      link("S_access", "PC01"),
      link("S_access", "PC02"),
      link("S_access", "PC03"),
      link("S_access", "Phone1001"),
      link("S_access", "Phone1002"),
      // S_main: Server DHCP + Phone1003 + PC04 + ATA
      link("S_main", "Server_DHCP"),
      link("S_main", "Phone1003"),
      link("S_main", "PC04"),
      link("S_main", "ATA1004"),
      link("ATA1004", "AnalogPhone1004"),
      // Sede 2 — R2 ↔ S2 + 3 phones
      link("R2", "S2"),
      link("S2", "Phone4001"),
      link("S2", "Phone4002"),
      link("S2", "Phone4003"),
    ];
    const moves = gridLayoutCanvas(snap(devices, links));

    // Helper para todas las posiciones (incluso las que no cambiaron). En
    // este test partimos de coords (0,0), así que todo está en moves.
    const pos = (n: string) => placedAt(moves, n)!;

    // ---- Filas ----
    expect(pos("R1").y).toBe(LAYOUT.Y_ROUTER);
    expect(pos("R2").y).toBe(LAYOUT.Y_ROUTER);
    expect(pos("S_access").y).toBe(LAYOUT.Y_SWITCH);
    expect(pos("S_main").y).toBe(LAYOUT.Y_SWITCH);
    expect(pos("S2").y).toBe(LAYOUT.Y_SWITCH);
    expect(pos("PC01").y).toBe(LAYOUT.Y_ENDPOINT);
    expect(pos("Phone1001").y).toBe(LAYOUT.Y_ENDPOINT);
    expect(pos("Phone4001").y).toBe(LAYOUT.Y_ENDPOINT);
    expect(pos("Server_DHCP").y).toBe(LAYOUT.Y_SERVER);

    // ---- Backbone: R1 a la izquierda, R2 a la derecha ----
    expect(pos("R1").x).toBeLessThan(pos("R2").x);

    // ---- Sede 1 más ancha que sede 2 (por subárbol mayor) ----
    // R1 lleva 2 switches con 5+3 endpoints; R2 lleva 1 switch con 3 phones.
    // El gap entre R1 y R2 debe reflejar ese desbalance de ancho.
    const gap = pos("R2").x - pos("R1").x;
    expect(gap).toBeGreaterThanOrEqual(5 * LAYOUT.PC_X_SPACING);

    // ---- Switches de sede 1 ambos en la mitad izquierda (cerca de R1) ----
    expect(pos("S_access").x).toBeLessThan(pos("R2").x);
    expect(pos("S_main").x).toBeLessThan(pos("R2").x);
    // S2 (sede 2) está cerca de R2.
    expect(Math.abs(pos("S2").x - pos("R2").x)).toBeLessThan(
      Math.abs(pos("S2").x - pos("R1").x),
    );

    // ---- PCs y phones de S_access centrados bajo S_access ----
    const sxAccess = pos("S_access").x;
    const accessKids = ["PC01", "PC02", "PC03", "Phone1001", "Phone1002"];
    const accessAvg = accessKids
      .map(n => pos(n).x).reduce((a, b) => a + b, 0) / accessKids.length;
    expect(Math.abs(accessAvg - sxAccess)).toBeLessThan(LAYOUT.PC_X_SPACING);

    // ---- Phones de sede 2 centrados bajo S2 ----
    const s2x = pos("S2").x;
    const s2Avg = ["Phone4001", "Phone4002", "Phone4003"]
      .map(n => pos(n).x).reduce((a, b) => a + b, 0) / 3;
    expect(Math.abs(s2Avg - s2x)).toBeLessThan(LAYOUT.PC_X_SPACING);

    // ---- Server DHCP en su fila, no encima de un PC ----
    expect(pos("Server_DHCP").y).toBe(LAYOUT.Y_SERVER);
    // No debe colisionar (mismo X exacto) con ningún endpoint de S_main.
    const sMainEndpoints = ["Phone1003", "PC04", "ATA1004"];
    for (const ep of sMainEndpoints) {
      const dx = Math.abs(pos("Server_DHCP").x - pos(ep).x);
      const dy = Math.abs(pos("Server_DHCP").y - pos(ep).y);
      // Servidor está en otra banda Y que los endpoints, así que mismo X
      // está OK; lo que no debe haber es coincidencia exacta de X+Y.
      expect(dx >= 1 || dy >= 1).toBe(true);
    }

    // ---- Ningún par de dispositivos comparte la misma posición exacta ----
    const occupied = new Set<string>();
    for (const d of devices) {
      const p = pos(d.name);
      const key = `${p.x},${p.y}`;
      expect(occupied.has(key)).toBe(false);
      occupied.add(key);
    }

    // ---- AnalogPhone1004 ahora cuelga debajo del ATA, no en columna huérfana ----
    const ata = pos("ATA1004");
    const analog = pos("AnalogPhone1004");
    expect(analog.y).toBe(LAYOUT.Y_ENDPOINT + 60);
    expect(Math.abs(analog.x - ata.x)).toBeLessThan(2);

    // ---- Endpoints de S_access no deben pisar a los de S_main ----
    // Iconos PT ~50px de ancho; con PC_X_SPACING=80 imponemos al menos 60px
    // de separación entre cualquier endpoint de switches hermanos en la
    // misma fila Y, para que no se solapen visualmente.
    const accessEps = ["PC01", "PC02", "PC03", "Phone1001", "Phone1002"];
    const mainEps = ["Phone1003", "PC04", "ATA1004"];
    for (const a of accessEps) for (const b of mainEps) {
      const pa = pos(a), pb = pos(b);
      if (pa.y !== pb.y) continue; // diferentes filas, OK
      expect(Math.abs(pa.x - pb.x)).toBeGreaterThanOrEqual(60);
    }

    // ---- Idempotencia: re-aplicar no produce moves nuevos ----
    const moved = devices.map(d => {
      const p = pos(d.name);
      return { ...d, x: p.x, y: p.y };
    });
    const moves2 = gridLayoutCanvas(snap(moved, links));
    expect(moves2).toHaveLength(0);
  });

  test("hub-and-spoke con muchos endpoints (>6) parte en dos filas", () => {
    // Caso de la imagen "DNS-AAA-X": un solo switch central con 10 endpoints
    // colgando. La fórmula de ancho debe partir en dos filas para que no se
    // solapen.
    const devices = [
      dev("R1", "router"),
      dev("S1", "switch"),
      ...Array.from({ length: 10 }, (_, i) => dev(`H${i + 1}`, "pc")),
    ];
    const links = [
      link("R1", "S1"),
      ...Array.from({ length: 10 }, (_, i) => link("S1", `H${i + 1}`)),
    ];
    const moves = gridLayoutCanvas(snap(devices, links));
    const ys = Array.from({ length: 10 }, (_, i) =>
      moves.find(m => m.name === `H${i + 1}`)!.y);
    const row1 = ys.filter(y => y === LAYOUT.Y_ENDPOINT).length;
    const row2 = ys.filter(y => y === LAYOUT.Y_ENDPOINT + 60).length;
    expect(row1).toBeGreaterThan(0);
    expect(row2).toBeGreaterThan(0);
    expect(row1 + row2).toBe(10);

    // Endpoints de la fila superior: mínimo 60px de separación entre ellos.
    const xs1 = Array.from({ length: 10 }, (_, i) =>
      moves.find(m => m.name === `H${i + 1}`)!)
      .filter(m => m.y === LAYOUT.Y_ENDPOINT)
      .map(m => m.x).sort((a, b) => a - b);
    for (let i = 1; i < xs1.length; i++) {
      expect(xs1[i]! - xs1[i - 1]!).toBeGreaterThanOrEqual(60);
    }
  });

  test("malla de 5 routers (R3-R5, R3-R6, R5-R6, R5-R4, R4-R2): todos en fila router", () => {
    // Caso de la imagen con triangulación R3-R5-R6 + R5-R4-R2. No es una
    // cadena lineal — el grafo router↔router tiene ciclos. El layout debe
    // mantener todos los routers en Y_ROUTER, sin posiciones repetidas.
    const devices = [
      dev("R2", "router"), dev("R3", "router"),
      dev("R4", "router"), dev("R5", "router"), dev("R6", "router"),
      dev("S1", "switch"),
      dev("PC1", "pc"), dev("PC2", "pc"), dev("PC3", "pc"),
      dev("PC4", "pc"), dev("PC5", "pc"), dev("PC6", "pc"),
      dev("ServerR5", "server"),
    ];
    const links = [
      link("R3", "R5"), link("R3", "R6"), link("R5", "R6"),
      link("R5", "R4"), link("R4", "R2"),
      link("R2", "S1"),
      link("S1", "PC1"), link("S1", "PC2"), link("S1", "PC3"),
      link("S1", "PC4"), link("S1", "PC5"), link("S1", "PC6"),
      link("R5", "ServerR5"),
    ];
    const moves = gridLayoutCanvas(snap(devices, links));
    const allRouters = ["R2", "R3", "R4", "R5", "R6"];
    for (const r of allRouters) {
      const p = moves.find(m => m.name === r)!;
      expect(p.y).toBe(LAYOUT.Y_ROUTER);
    }
    // Todas las X distintas (sin pisarse).
    const rxs = allRouters.map(r => moves.find(m => m.name === r)!.x);
    const uniq = new Set(rxs);
    expect(uniq.size).toBe(allRouters.length);
    // ServerR5 cuelga directamente de R5 → en fila Y_SERVER, X cercano al de R5.
    const serverPos = moves.find(m => m.name === "ServerR5")!;
    const r5x = moves.find(m => m.name === "R5")!.x;
    expect(serverPos.y).toBe(LAYOUT.Y_SERVER);
    expect(Math.abs(serverPos.x - r5x)).toBeLessThanOrEqual(LAYOUT.SERVER_X_SPACING);
  });

  test("backbone lineal 4 routers con cargas iguales: separación uniforme", () => {
    // Caso "linear chain": R0-R1-R2-R3 unidos por serial, cada uno con un
    // switch + 2 PCs. Subárboles iguales → distancia entre routers
    // consecutivos también igual (con tolerancia de redondeo).
    const devices: DeviceObservation[] = [];
    const links: LinkObservation[] = [];
    for (let i = 0; i < 4; i++) {
      devices.push(dev(`R${i}`, "router"));
      devices.push(dev(`Sw${i}`, "switch"));
      devices.push(dev(`PC${2 * i + 1}`, "pc"));
      devices.push(dev(`PC${2 * i + 2}`, "pc"));
      links.push(link(`R${i}`, `Sw${i}`));
      links.push(link(`Sw${i}`, `PC${2 * i + 1}`));
      links.push(link(`Sw${i}`, `PC${2 * i + 2}`));
      if (i > 0) links.push(link(`R${i - 1}`, `R${i}`));
    }
    const moves = gridLayoutCanvas(snap(devices, links));
    const xs = [0, 1, 2, 3].map(i => moves.find(m => m.name === `R${i}`)!.x);
    const gaps = [xs[1]! - xs[0]!, xs[2]! - xs[1]!, xs[3]! - xs[2]!];
    // Todas las separaciones deben coincidir (subárboles iguales) — 1px tol.
    expect(Math.abs(gaps[0]! - gaps[1]!)).toBeLessThanOrEqual(1);
    expect(Math.abs(gaps[1]! - gaps[2]!)).toBeLessThanOrEqual(1);
    // Y los PCs de cada switch están centrados bajo su switch.
    for (let i = 0; i < 4; i++) {
      const swx = moves.find(m => m.name === `Sw${i}`)!.x;
      const pc1x = moves.find(m => m.name === `PC${2 * i + 1}`)!.x;
      const pc2x = moves.find(m => m.name === `PC${2 * i + 2}`)!.x;
      expect(Math.abs((pc1x + pc2x) / 2 - swx)).toBeLessThan(2);
    }
  });

  test("cloud conectada a un switch (no al router) viaja con su switch", () => {
    // Caso común: una nube "Internet/Otras redes" colgando del switch de
    // distribución (no del router). Debe terminar en una banda de cloud y
    // alineada con el switch padre, no con el router.
    const devices = [
      dev("R1", "router"),
      dev("S1", "switch"),
      dev("Internet", "cloud"),
      dev("PC1", "pc"),
    ];
    const links = [
      link("R1", "S1"), link("S1", "Internet"), link("S1", "PC1"),
    ];
    const moves = gridLayoutCanvas(snap(devices, links));
    const cloud = moves.find(m => m.name === "Internet")!;
    expect([LAYOUT.Y_CLOUD, LAYOUT.Y_CLOUD_BOTTOM]).toContain(cloud.y);
  });

  test("topología degenerada: sólo PCs, sin router ni switch — no crashea", () => {
    const devices = [dev("PC1", "pc"), dev("PC2", "pc")];
    const moves = gridLayoutCanvas(snap(devices, []));
    // Todos colocados (sin tirar). Ambos en banda de endpoint.
    expect(moves).toHaveLength(2);
    for (const m of moves) expect(m.y).toBe(LAYOUT.Y_ENDPOINT);
    expect(moves[0]!.x).not.toBe(moves[1]!.x);
  });

  test("topología vacía: cero moves, no crashea", () => {
    const moves = gridLayoutCanvas(snap([], []));
    expect(moves).toHaveLength(0);
  });

  test("endpoint encadenado (analog phone tras ATA) cuelga DEBAJO del ATA", () => {
    // Caso de la práctica RO2-P2: el teléfono analógico (1004) se conecta al
    // Home-VoIP-PT (ATA), no al switch. Debe colocarse en la sub-fila
    // Y_ENDPOINT + 60 con la X del ATA, no en columna huérfana lateral.
    const devices = [
      dev("R1", "router"),
      dev("S1", "switch"),
      dev("PC1", "pc"),
      dev("ATA", "iot"),
      dev("AnalogPhone", "tdm"),
    ];
    const links = [
      link("R1", "S1"), link("S1", "PC1"), link("S1", "ATA"),
      link("ATA", "AnalogPhone"),
    ];
    const moves = gridLayoutCanvas(snap(devices, links));
    const ata = moves.find(m => m.name === "ATA")!;
    const ap = moves.find(m => m.name === "AnalogPhone")!;
    // En sub-fila +60 con la X del ATA.
    expect(ap.y).toBe(LAYOUT.Y_ENDPOINT + 60);
    expect(Math.abs(ap.x - ata.x)).toBeLessThan(2);
    // No debe quedar en columna lateral huérfana (X razonable, < 1000).
    expect(ap.x).toBeLessThan(1000);
  });

  test("RO2-P1: router de tránsito (RInternet) baja a segundo piso entre R2 y R3", () => {
    // Réplica de la práctica RO2-P1 (encaminamiento + GRE + NAT). 4 routers
    // de oficina (R1-R4) unidos por dos switches transit (LAN3 entre R1↔R2,
    // LAN4 entre R3↔R4) y un router exterior RInternet que conecta R2 y R3
    // sólo por seriales y cuelga un servidor web. RInternet debe quedar
    // FUERA de la fila de routers de oficina, en un segundo piso, centrado
    // entre R2 y R3.
    const devices = [
      // Backbone de oficinas
      dev("R1", "router"),
      dev("R2", "router"),
      dev("R3", "router"),
      dev("R4", "router"),
      // Router exterior — el "Internet"
      dev("RInternet", "router"),
      // Switches LAN propias de cada router de oficina
      dev("SW1", "switch"),
      dev("SW2", "switch"),
      dev("SW5", "switch"),
      dev("SW6", "switch"),
      // Switches transit (LAN3 R1↔R2, LAN4 R3↔R4)
      dev("SW3", "switch"),
      dev("SW4", "switch"),
      // Switch de la red exterior
      dev("SWInternet", "switch"),
      // PCs de las LANs de oficina
      dev("PC1", "pc"),
      dev("PC2", "pc"),
      dev("PC5", "pc"),
      dev("PC6", "pc"),
      // Servidor web en la red exterior
      dev("WebServer", "server"),
    ];
    const links = [
      // LANs de R1
      link("R1", "SW1"), link("SW1", "PC1"),
      link("R1", "SW2"), link("SW2", "PC2"),
      // LAN3 transit entre R1 y R2
      link("R1", "SW3"), link("R2", "SW3"),
      // Seriales R2↔RInternet y R3↔RInternet
      link("R2", "RInternet"), link("R3", "RInternet"),
      // LAN4 transit entre R3 y R4
      link("R3", "SW4"), link("R4", "SW4"),
      // LANs de R4
      link("R4", "SW5"), link("SW5", "PC5"),
      link("R4", "SW6"), link("SW6", "PC6"),
      // Red exterior
      link("RInternet", "SWInternet"), link("SWInternet", "WebServer"),
    ];
    const moves = gridLayoutCanvas(snap(devices, links));
    const pos = (n: string) => placedAt(moves, n)!;

    // ---- Backbone de oficina en la fila Y_ROUTER ----
    for (const r of ["R1", "R2", "R3", "R4"]) {
      expect(pos(r).y).toBe(LAYOUT.Y_ROUTER);
    }
    // RInternet baja al segundo piso.
    expect(pos("RInternet").y).toBe(LAYOUT.Y_TRANSIT_ROUTER);

    // ---- Backbone ordenado de izquierda a derecha ----
    expect(pos("R1").x).toBeLessThan(pos("R2").x);
    expect(pos("R2").x).toBeLessThan(pos("R3").x);
    expect(pos("R3").x).toBeLessThan(pos("R4").x);

    // ---- RInternet centrado entre R2 y R3 (tolerancia 2px) ----
    const mid23 = (pos("R2").x + pos("R3").x) / 2;
    expect(Math.abs(pos("RInternet").x - mid23)).toBeLessThan(2);

    // ---- Subárbol de RInternet hereda las bandas de tránsito ----
    expect(pos("SWInternet").y).toBe(LAYOUT.Y_TRANSIT_SWITCH);
    expect(pos("WebServer").y).toBe(LAYOUT.Y_TRANSIT_SERVER);
    // Y todos centrados con RInternet.
    expect(Math.abs(pos("SWInternet").x - pos("RInternet").x)).toBeLessThan(2);
    expect(Math.abs(pos("WebServer").x - pos("RInternet").x)).toBeLessThan(2);

    // ---- LAN3 (SW3) y LAN4 (SW4) son transit y se centran entre sus routers ----
    // Existing logic ya las maneja vía sharedBetween — verifica que sigue OK.
    expect(pos("SW3").y).toBe(LAYOUT.Y_SWITCH);
    expect(pos("SW4").y).toBe(LAYOUT.Y_SWITCH);
    const mid12 = (pos("R1").x + pos("R2").x) / 2;
    const mid34 = (pos("R3").x + pos("R4").x) / 2;
    expect(Math.abs(pos("SW3").x - mid12)).toBeLessThan(2);
    expect(Math.abs(pos("SW4").x - mid34)).toBeLessThan(2);

    // ---- Idempotencia ----
    const moved = devices.map(d => {
      const p = pos(d.name);
      return { ...d, x: p.x, y: p.y };
    });
    const moves2 = gridLayoutCanvas(snap(moved, links));
    expect(moves2).toHaveLength(0);
  });

  test("endpoint encadenado en cadena profunda (PC tras phone tras ATA)", () => {
    // ATA → IPPhone → PC. Las dos generaciones de hijos deben colocarse:
    // IPPhone justo debajo del ATA; PC justo debajo del IPPhone.
    const devices = [
      dev("R1", "router"),
      dev("S1", "switch"),
      dev("ATA", "iot"),
      dev("IPPhone", "ipphone"),
      dev("PC", "pc"),
    ];
    const links = [
      link("R1", "S1"), link("S1", "ATA"),
      link("ATA", "IPPhone"), link("IPPhone", "PC"),
    ];
    const moves = gridLayoutCanvas(snap(devices, links));
    const ata = moves.find(m => m.name === "ATA")!;
    const phone = moves.find(m => m.name === "IPPhone")!;
    const pc = moves.find(m => m.name === "PC")!;
    expect(phone.y).toBeGreaterThan(ata.y);
    expect(pc.y).toBeGreaterThan(phone.y);
    // Cada hijo razonablemente alineado con su padre.
    expect(Math.abs(phone.x - ata.x)).toBeLessThan(LAYOUT.PC_X_SPACING);
    expect(Math.abs(pc.x - phone.x)).toBeLessThan(LAYOUT.PC_X_SPACING);
  });
});
