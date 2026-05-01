/**
 * Layout policy for the live PT canvas — v2 (subtree-width tree layout).
 *
 * Una sola fuente de verdad para coordenadas X/Y, así:
 *   1. Las recetas no inventan números mágicos cada una.
 *   2. `pt_add_device` puede auto-colocar cuando el caller deja x/y en blanco.
 *   3. `pt_auto_layout` re-cuadra un canvas existente en bloque.
 *
 * # Por qué v2
 *
 * El v1 reproducía mecánicamente la rejilla del prototipo Python: clouds
 * todos en la fila superior, switches centrados en la columna del router,
 * endpoints centrados en la columna del switch. Eso colapsa cuando un
 * router tiene varios switches (caen en la misma columna) y cuando hay
 * más de tres clouds (el banner superior se llena y el resto pisa los
 * routers). El v2 es topology-aware: cada router reserva el ancho que
 * realmente necesita su sub-árbol y los hijos se reparten dentro de ese
 * presupuesto.
 *
 * # Algoritmo
 *
 *   1. Adyacencia desde `snapshot.links`.
 *   2. Backbone — recorrido BFS de routers siguiendo enlaces router↔router,
 *      arrancando del router más a la izquierda en X actual. Mantiene el
 *      orden visual que el usuario ya tenía.
 *   3. Para cada router, clasificar vecinos no-router en:
 *        - switches (cada uno con su propio sub-árbol de endpoints)
 *        - access points (banda inmediatamente sobre el router)
 *        - clouds (mitad arriba, mitad abajo, alternando)
 *        - endpoints directos (cuando un PC se enchufa al router sin switch)
 *        - servers
 *   4. Calcular subtreeWidth(router) = unidades de PC_X_SPACING que necesita
 *      su subárbol = max(1, endpoints_directos, switches × ancho_switch,
 *      clouds_below). Cada switch a su vez aporta ancho proporcional a sus
 *      endpoints.
 *   5. Colocar routers horizontalmente repartiendo presupuesto de ancho —
 *      el centro de cada router queda en `cursor + width/2`, el siguiente
 *      empieza en `cursor + width + GAP`.
 *   6. Colocar hijos dentro del slot del router:
 *        - APs sobre el router, centrados.
 *        - Switches debajo del router, distribuidos según sus propios anchos.
 *        - Endpoints de cada switch, centrados bajo el switch (segunda fila
 *          si saturan el ancho disponible).
 *        - Endpoints directos al router, en la fila de endpoints.
 *        - Clouds: las primeras arriba (Y_CLOUD), el resto abajo
 *          (Y_CLOUD_BOTTOM) — replica el patrón de la imagen de referencia
 *          donde cada router tiene LANs por encima y por debajo.
 *        - Servers: derecha del switch padre, o columna lateral si no hay.
 *   7. Nodos compartidos por dos routers (ej. una nube Internet entre R2 y
 *      R3): se centran entre los routers que los comparten.
 *   8. Huérfanos (sin ruta a ningún router): mantienen su categoría pero
 *      van a una columna libre a la derecha.
 *
 * Idempotente: posiciones redondeadas a entero, ordenación estable por
 * nombre dentro de cada grupo, así correr `pt_auto_layout` dos veces sobre
 * el mismo canvas no produce el segundo set de moves.
 *
 * Bandas Y por categoría:
 *   cloud_top    y =  20  (clouds "altas")
 *   router       y = 100
 *   ap / wlc     y = 175
 *   switch       y = 250
 *   endpoint     y = 400  (pc / laptop / phone / printer / iot / ...)
 *   server       y = 480
 *   cloud_bottom y = 560  (clouds "bajas" — segunda mitad, segunda fila)
 *
 * # Routers de tránsito (segundo piso)
 *
 * Un router cuya única función topológica es PUENTEAR a otros routers
 * (RInternet entre R2 y R3 en RO2-P1, ISP entre dos sedes, etc.) no debería
 * ocupar slot en la fila de routers — visualmente queda fuera de la
 * jerarquía de oficinas y obliga a cables que cruzan la pantalla.
 *
 * Se detectan con `isTransitRouter` (ver función) y van a un segundo piso
 * con sus propias bandas Y desplazadas. Su X se calcula como promedio de
 * centros de los routers backbone con los que conectan, así caen
 * literalmente "entre" sus vecinos.
 *
 *   transit_router    y = 400
 *   transit_switch    y = 530
 *   transit_endpoint  y = 680
 *   transit_server    y = 760
 *
 * El subárbol del router de tránsito (su switch privado + WebServer típico)
 * usa esas bandas en lugar de las del backbone.
 */

import type { DeviceCategory } from "../ipc/constants.js";
import type { CanvasSnapshot, DeviceObservation } from "./types.js";

export const LAYOUT = {
  X_START: 100,
  X_SPACING: 250,
  PC_X_SPACING: 80,
  Y_CLOUD: 20,
  Y_ROUTER: 100,
  Y_AP: 175,
  Y_SWITCH: 250,
  Y_ENDPOINT: 400,
  Y_SERVER: 480,
  Y_CLOUD_BOTTOM: 560,
  // Segundo piso para routers de tránsito y su subárbol (ver doc del módulo).
  Y_TRANSIT_ROUTER: 400,
  Y_TRANSIT_AP: 475,
  Y_TRANSIT_SWITCH: 530,
  Y_TRANSIT_ENDPOINT: 680,
  Y_TRANSIT_SERVER: 760,
  Y_TRANSIT_CLOUD_TOP: 320,
  Y_TRANSIT_CLOUD_BOTTOM: 840,
  ROUTER_GAP: 80,
  SWITCH_X_SPACING: 130,
  CLOUD_X_SPACING: 110,
  SERVER_X_SPACING: 110,
  AP_X_SPACING: 110,
} as const;

/** Bandas Y según el tier (backbone vs tránsito). El cuerpo del algoritmo
 *  consulta `bandsFor(routerName)` para elegir la fila correcta de cada
 *  hijo en función del tier de su router padre. */
interface YBands {
  readonly ap: number;
  readonly switch: number;
  readonly endpoint: number;
  readonly server: number;
  readonly cloudTop: number;
  readonly cloudBottom: number;
}
const BACKBONE_BANDS: YBands = {
  ap: LAYOUT.Y_AP,
  switch: LAYOUT.Y_SWITCH,
  endpoint: LAYOUT.Y_ENDPOINT,
  server: LAYOUT.Y_SERVER,
  cloudTop: LAYOUT.Y_CLOUD,
  cloudBottom: LAYOUT.Y_CLOUD_BOTTOM,
};
const TRANSIT_BANDS: YBands = {
  ap: LAYOUT.Y_TRANSIT_AP,
  switch: LAYOUT.Y_TRANSIT_SWITCH,
  endpoint: LAYOUT.Y_TRANSIT_ENDPOINT,
  server: LAYOUT.Y_TRANSIT_SERVER,
  cloudTop: LAYOUT.Y_TRANSIT_CLOUD_TOP,
  cloudBottom: LAYOUT.Y_TRANSIT_CLOUD_BOTTOM,
};

const ENDPOINT_CATEGORIES = new Set<DeviceCategory>([
  "pc", "laptop", "ipphone", "smartphone", "tablet", "pda",
  "tv", "printer", "iot", "tdm", "remote",
]);

/** Y band for a given catalog category. Endpoints share Y_ENDPOINT. */
export function categoryRow(category: DeviceCategory): number {
  if (category === "cloud") return LAYOUT.Y_CLOUD;
  if (category === "router" || category === "wirelessrouter" || category === "homerouter" || category === "firewall") {
    return LAYOUT.Y_ROUTER;
  }
  if (category === "accesspoint") return LAYOUT.Y_AP;
  if (category === "switch" || category === "multilayerswitch" || category === "bridge" || category === "hub" || category === "repeater") {
    return LAYOUT.Y_SWITCH;
  }
  if (category === "server") return LAYOUT.Y_SERVER;
  if (ENDPOINT_CATEGORIES.has(category)) return LAYOUT.Y_ENDPOINT;
  return LAYOUT.Y_ENDPOINT;
}

export interface PlacementSlot {
  readonly x: number;
  readonly y: number;
}

/**
 * Pick a free slot for a brand-new device of `category` given the current live
 * canvas. Strategy:
 *   1. Look at every device of the same category already placed.
 *   2. Drop the candidate column at `max(existingX) + X_SPACING` in that row,
 *      or at X_START if the row is empty.
 *
 * That matches the visual result of `pt_cook_topology` recipes (rows that
 * grow rightwards) and is enough to keep manual `pt_add_device` calls tidy.
 */
export function nextSlotForCategory(
  snapshot: CanvasSnapshot,
  category: DeviceCategory,
): PlacementSlot {
  const y = categoryRow(category);
  const sameRow = snapshot.devices.filter(d => Math.abs(d.y - y) < 30);
  if (sameRow.length === 0) {
    return { x: LAYOUT.X_START, y };
  }
  const maxX = sameRow.reduce((m, d) => (d.x > m ? d.x : m), -Infinity);
  return { x: maxX + LAYOUT.X_SPACING, y };
}

// ---------------------------------------------------------------------------
// gridLayoutCanvas — implementación completa abajo
// ---------------------------------------------------------------------------

const ROUTERY = (cat?: DeviceCategory) =>
  cat === "router" || cat === "wirelessrouter" || cat === "homerouter" || cat === "firewall";
const SWITCHY = (cat?: DeviceCategory) =>
  cat === "switch" || cat === "multilayerswitch" || cat === "bridge" || cat === "hub" || cat === "repeater";
const ENDPOINTY = (cat?: DeviceCategory) =>
  cat != null && ENDPOINT_CATEGORIES.has(cat);

/** Mínimo ancho lógico (en unidades de PC_X_SPACING) que requiere un switch.
 *  Con N endpoints en una fila (PC_X_SPACING = 80px) hacen falta N unidades
 *  + 0.4 de margen para que el switch siguiente no pise el último endpoint.
 *  A partir de 7 endpoints partimos en dos filas (Y_ENDPOINT y +60), así que
 *  el ancho cae a ceil(N/2). */
function switchWidthUnits(endpointCount: number): number {
  if (endpointCount <= 1) return 1.4;
  if (endpointCount <= 6) return endpointCount + 0.4;
  return Math.ceil(endpointCount / 2) + 0.4;
}

/** Mínimo ancho lógico que requiere un router según sus hijos. */
function routerWidthUnits(args: {
  switchWidths: number[];
  directEndpoints: number;
  clouds: number;
  servers: number;
  aps: number;
}): number {
  const { switchWidths, directEndpoints, clouds, servers, aps } = args;
  const sw = switchWidths.reduce((a, b) => a + b, 0)
    + Math.max(0, switchWidths.length - 1) * 0.2;
  const direct = directEndpoints * 0.9;
  const top = Math.max(aps * 1.0, Math.ceil(clouds / 2) * 1.2);
  const bottom = Math.max(servers * 1.0, Math.floor(clouds / 2) * 1.2);
  return Math.max(2.0, sw, direct, top, bottom);
}

/** Distribuye N items simétricamente alrededor de cx con paso `spacing`. */
function spreadAround(cx: number, count: number, spacing: number): number[] {
  if (count === 0) return [];
  if (count === 1) return [cx];
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    out.push(cx + (i - (count - 1) / 2) * spacing);
  }
  return out;
}

/**
 * Compute a topology-aware grid layout for an entire canvas. See module-level
 * doc for the algorithm.
 *
 * Returns one entry per device whose coordinates differ from the snapshot;
 * unchanged devices are omitted so `pt_auto_layout` issues a minimal set of
 * `moveDevice` calls.
 */
export function gridLayoutCanvas(snapshot: CanvasSnapshot): readonly { name: string; x: number; y: number }[] {
  // ---------------- Adyacencia ----------------
  const neighbors = new Map<string, Set<string>>();
  for (const link of snapshot.links) {
    if (!neighbors.has(link.aDevice)) neighbors.set(link.aDevice, new Set());
    if (!neighbors.has(link.bDevice)) neighbors.set(link.bDevice, new Set());
    neighbors.get(link.aDevice)!.add(link.bDevice);
    neighbors.get(link.bDevice)!.add(link.aDevice);
  }
  const byName = new Map(snapshot.devices.map(d => [d.name, d]));
  const neighborsOf = (name: string): DeviceObservation[] =>
    [...(neighbors.get(name) ?? [])]
      .map(n => byName.get(n))
      .filter((x): x is DeviceObservation => !!x);

  const placements = new Map<string, { x: number; y: number }>();

  // ---------------- Orden del backbone ----------------
  // Preservamos el orden visual del usuario: ordenar por X actual, desempatar
  // por nombre. Esto cubre los dos casos comunes —
  //   (a) topología cocinada con coordenadas: el orden X ya es el correcto;
  //   (b) topología sin colocar (X iguales): el desempate por nombre suele
  //       coincidir con el orden del chain (R1-R2-R3-...).
  // Una BFS sobre el grafo router-router desordenaría (b) cuando arranca
  // desde un router del medio, así que la dejamos fuera.
  const routers = snapshot.devices.filter(d => ROUTERY(d.category));
  const routerSet = new Set(routers.map(r => r.name));
  const routerOrder = [...routers].sort((a, b) =>
    a.x !== b.x ? a.x - b.x : a.name.localeCompare(b.name));

  // ---------------- Clasificación de hijos por router ----------------
  // Cada dispositivo no-router se asigna al "router más cercano" (vecino router
  // directo si existe; si no, vecino-de-vecino vía un switch). Los nodos que
  // tocan a 2+ routers se marcan como "shared" y van entre medias.
  type RouterChildren = {
    switches: DeviceObservation[];        // switches conectados directamente
    aps: DeviceObservation[];             // access points
    clouds: DeviceObservation[];          // clouds "propias" (sólo este router)
    directEndpoints: DeviceObservation[]; // endpoints sin switch en medio
    servers: DeviceObservation[];         // servers conectados al router (no via switch)
  };
  const children = new Map<string, RouterChildren>();
  for (const r of routers) {
    children.set(r.name, {
      switches: [], aps: [], clouds: [], directEndpoints: [], servers: [],
    });
  }

  // shared[node] = lista de routers que lo comparten (cuando ≥ 2)
  const sharedBetween = new Map<string, string[]>();
  // switchEndpoints[switchName] = endpoints conectados al switch
  const switchEndpoints = new Map<string, DeviceObservation[]>();
  // switchServers[switchName] = servers detrás del switch
  const switchServers = new Map<string, DeviceObservation[]>();
  // switchOwner[switchName] = router al que pertenece (si pertenece a uno solo)
  const switchOwner = new Map<string, string>();
  // assigned: devices ya asignados a la jerarquía de algún router
  const assigned = new Set<string>(routers.map(r => r.name));
  // dangling[parent] = endpoints encadenados que cuelgan de otro endpoint
  // ya asignado (caso típico: teléfono analógico colgando de un Home-VoIP-PT,
  // o un PC enchufado al puerto pasante de un IP Phone). Se colocan en una
  // sub-fila justo debajo del padre, no añaden ancho al subárbol del switch.
  const danglingByParent = new Map<string, DeviceObservation[]>();

  // 1ª pasada: switches (deciden su router padre). Iterativa porque los
  // switches pueden estar en cascada por trunk (un access switch sólo se
  // conecta al distribution switch, que es el que llega al router). Ronda
  // 1 resuelve los conectados directamente al router; rondas siguientes
  // propagan el dueño aguas abajo del trunk.
  const allSwitches = snapshot.devices.filter(d => SWITCHY(d.category));
  const pendingSwitches = new Set(allSwitches.map(s => s.name));
  let switchProgress = true;
  while (switchProgress && pendingSwitches.size > 0) {
    switchProgress = false;
    for (const swName of [...pendingSwitches]) {
      const sw = byName.get(swName)!;
      const adj = neighborsOf(swName);
      const adjRouters = adj.filter(n => routerSet.has(n.name));
      if (adjRouters.length >= 2) {
        sharedBetween.set(swName, adjRouters.map(r => r.name));
        pendingSwitches.delete(swName);
        switchProgress = true;
        continue;
      }
      if (adjRouters.length === 1) {
        const owner = adjRouters[0]!;
        switchOwner.set(swName, owner.name);
        children.get(owner.name)!.switches.push(sw);
        assigned.add(swName);
        pendingSwitches.delete(swName);
        switchProgress = true;
        continue;
      }
      // Sin router directo: ¿llega vía un switch ya resuelto?
      const adjResolved = adj
        .filter(n => SWITCHY(n.category) && switchOwner.has(n.name));
      if (adjResolved.length > 0) {
        const ownerRouter = switchOwner.get(adjResolved[0]!.name)!;
        switchOwner.set(swName, ownerRouter);
        children.get(ownerRouter)!.switches.push(sw);
        assigned.add(swName);
        pendingSwitches.delete(swName);
        switchProgress = true;
      }
    }
  }

  // 2ª pasada: endpoints/servers/clouds/aps.
  for (const d of snapshot.devices) {
    if (assigned.has(d.name)) continue;
    if (ROUTERY(d.category) || SWITCHY(d.category)) continue;
    const adj = neighborsOf(d.name);
    const adjRouters = adj.filter(n => routerSet.has(n.name));
    const adjSwitches = adj.filter(n => SWITCHY(n.category) && switchOwner.has(n.name));

    // Compartido entre 2+ routers (caso "Internet entre R2 y R3").
    if (adjRouters.length >= 2) {
      sharedBetween.set(d.name, adjRouters.map(r => r.name));
      assigned.add(d.name);
      continue;
    }

    // Detrás de un switch que ya tiene dueño.
    if (adjSwitches.length > 0) {
      const sw = adjSwitches[0]!;
      if (d.category === "server") {
        if (!switchServers.has(sw.name)) switchServers.set(sw.name, []);
        switchServers.get(sw.name)!.push(d);
      } else if (ENDPOINTY(d.category)) {
        if (!switchEndpoints.has(sw.name)) switchEndpoints.set(sw.name, []);
        switchEndpoints.get(sw.name)!.push(d);
      } else if (d.category === "accesspoint") {
        // AP detrás de un switch: lo adjuntamos al router del switch como AP.
        const ownerRouter = switchOwner.get(sw.name);
        if (ownerRouter) children.get(ownerRouter)!.aps.push(d);
      } else if (d.category === "cloud") {
        const ownerRouter = switchOwner.get(sw.name);
        if (ownerRouter) children.get(ownerRouter)!.clouds.push(d);
      }
      assigned.add(d.name);
      continue;
    }

    // Conectado directamente a un único router.
    if (adjRouters.length === 1) {
      const owner = adjRouters[0]!.name;
      const bucket = children.get(owner)!;
      if (d.category === "accesspoint") bucket.aps.push(d);
      else if (d.category === "cloud") bucket.clouds.push(d);
      else if (d.category === "server") bucket.servers.push(d);
      else if (ENDPOINTY(d.category)) bucket.directEndpoints.push(d);
      assigned.add(d.name);
      continue;
    }
    // Si no, queda como huérfano.
  }

  // 3ª pasada (iterativa): endpoints encadenados — cuelgan de otro endpoint
  // que ya está asignado a un switch o router. Se quedan como "dangling" del
  // padre y se colocan debajo en la sub-fila Y_ENDPOINT + 60 al final.
  let danglingProgress = true;
  while (danglingProgress) {
    danglingProgress = false;
    for (const d of snapshot.devices) {
      if (assigned.has(d.name)) continue;
      if (ROUTERY(d.category) || SWITCHY(d.category)) continue;
      const adj = neighborsOf(d.name);
      // Buscamos un vecino que sea un endpoint ya asignado (no router/switch).
      const parent = adj.find(n =>
        assigned.has(n.name) && !ROUTERY(n.category) && !SWITCHY(n.category));
      if (!parent) continue;
      if (!danglingByParent.has(parent.name)) danglingByParent.set(parent.name, []);
      danglingByParent.get(parent.name)!.push(d);
      assigned.add(d.name);
      danglingProgress = true;
    }
  }

  // ---------------- Detección de routers de tránsito ----------------
  // Un router se considera "tránsito" cuando su única función topológica es
  // puentear OTROS routers que no se ven entre sí directamente, y su propio
  // subárbol no contiene LAN de usuarios (PCs/teléfonos/APs/clouds), sólo a
  // lo sumo un switch con servidores. Caso canónico: RInternet entre R2 y R3
  // en una WAN con NAT/GRE; el router ISP entre dos sedes.
  //
  // Visualmente baja a un segundo piso (Y_TRANSIT_*) para que no rompa la
  // fila ordenada de routers de oficina. Se descarta para topologías malladas
  // (sus vecinos están conectados entre sí, condición 2 falla) y para
  // topologías con PCs/APs colgando del propio router de tránsito (la "LAN
  // del transito" lo descalifica — sería una sede más).
  const transitRouters = new Set<string>();
  const isTransit = (r: DeviceObservation): boolean => {
    const adj = neighbors.get(r.name);
    if (!adj) return false;
    const adjRouters = [...adj].filter(n => routerSet.has(n));
    if (adjRouters.length < 2) return false;
    // Ningún par de vecinos directos del router se ve entre sí. Si hay aunque
    // sea un par directamente cableado, es una malla, no un puente.
    for (let i = 0; i < adjRouters.length; i++) {
      for (let j = i + 1; j < adjRouters.length; j++) {
        if (neighbors.get(adjRouters[i]!)?.has(adjRouters[j]!)) return false;
      }
    }
    const c = children.get(r.name)!;
    // No tiene LAN de usuarios (PCs, teléfonos, etc.) directos.
    if (c.directEndpoints.length > 0) return false;
    if (c.aps.length > 0) return false;
    if (c.clouds.length > 0) return false;
    // Tampoco la tiene a través de un switch propio.
    for (const sw of c.switches) {
      const eps = switchEndpoints.get(sw.name) ?? [];
      if (eps.length > 0) return false;
    }
    // Y tiene al menos un hijo (si no, es un relay puro y vive bien en el
    // backbone alineado con sus vecinos sin necesidad de bajar).
    const total = c.switches.length + c.servers.length + c.directEndpoints.length
      + c.aps.length + c.clouds.length;
    if (total === 0) return false;
    return true;
  };
  for (const r of routers) {
    if (isTransit(r)) transitRouters.add(r.name);
  }
  const bandsFor = (routerName: string): YBands =>
    transitRouters.has(routerName) ? TRANSIT_BANDS : BACKBONE_BANDS;

  // ---------------- Anchos de subárbol ----------------
  const switchWidthFor = (sw: DeviceObservation): number => {
    const eps = switchEndpoints.get(sw.name)?.length ?? 0;
    const srv = switchServers.get(sw.name)?.length ?? 0;
    return switchWidthUnits(Math.max(eps, srv));
  };
  const routerWidth = new Map<string, number>();
  for (const r of routerOrder) {
    const c = children.get(r.name)!;
    routerWidth.set(r.name, routerWidthUnits({
      switchWidths: c.switches.map(switchWidthFor),
      directEndpoints: c.directEndpoints.length,
      clouds: c.clouds.length,
      servers: c.servers.length,
      aps: c.aps.length,
    }));
  }

  // ---------------- Posicionar routers ----------------
  // El centro de cada router backbone cae a `cursor + width*PC_X_SPACING/2`.
  // Los routers de tránsito NO consumen slot horizontal; se colocan en una
  // segunda pasada al promedio de los centros de sus vecinos backbone.
  const routerCenter = new Map<string, number>();
  let cursor = LAYOUT.X_START;
  for (const r of routerOrder) {
    if (transitRouters.has(r.name)) continue;
    const w = routerWidth.get(r.name)! * LAYOUT.PC_X_SPACING;
    const cx = cursor + w / 2;
    placements.set(r.name, { x: cx, y: LAYOUT.Y_ROUTER });
    routerCenter.set(r.name, cx);
    cursor = cursor + w + LAYOUT.ROUTER_GAP;
  }
  // Tránsitos: x = promedio de centros backbone vecinos, y = Y_TRANSIT_ROUTER.
  // Si dos tránsitos comparten el mismo par backbone (raro pero posible: dos
  // ISPs paralelos), se desplazan +/- CLOUD_X_SPACING para no pisarse.
  const transitOrder = routerOrder.filter(r => transitRouters.has(r.name));
  const transitGroups = new Map<string, DeviceObservation[]>();
  for (const r of transitOrder) {
    const adj = [...(neighbors.get(r.name) ?? [])];
    const adjBackbone = adj
      .filter(n => routerSet.has(n) && !transitRouters.has(n))
      .sort();
    const key = adjBackbone.join("|");
    if (!transitGroups.has(key)) transitGroups.set(key, []);
    transitGroups.get(key)!.push(r);
  }
  for (const [key, members] of transitGroups) {
    const adjCenters = key.split("|")
      .map(n => routerCenter.get(n))
      .filter((v): v is number => v != null);
    let cx: number;
    if (adjCenters.length > 0) {
      cx = adjCenters.reduce((a, b) => a + b, 0) / adjCenters.length;
    } else {
      // Caso degenerado: tránsito sin vecino backbone resoluble. Cae a la
      // derecha del cursor — sigue ordenado y sin colisiones.
      cx = cursor + LAYOUT.X_SPACING;
      cursor += LAYOUT.X_SPACING;
    }
    members.sort((a, b) => a.name.localeCompare(b.name));
    const xs = spreadAround(cx, members.length, LAYOUT.CLOUD_X_SPACING);
    members.forEach((r, i) => {
      placements.set(r.name, { x: xs[i]!, y: LAYOUT.Y_TRANSIT_ROUTER });
      routerCenter.set(r.name, xs[i]!);
    });
  }

  // ---------------- Posicionar nodos compartidos (entre routers) ----------------
  // Centrados en el promedio de centros de los routers que los comparten.
  // Y depende de la categoría (cloud → CLOUD_BOTTOM, server → SERVER, switch → SWITCH).
  const sharedY = (cat?: DeviceCategory): number => {
    if (cat === "cloud") return LAYOUT.Y_CLOUD_BOTTOM;
    if (cat === "server") return LAYOUT.Y_SERVER;
    if (SWITCHY(cat)) return LAYOUT.Y_SWITCH;
    if (cat === "accesspoint") return LAYOUT.Y_AP;
    if (ENDPOINTY(cat)) return LAYOUT.Y_ENDPOINT;
    return LAYOUT.Y_CLOUD_BOTTOM;
  };
  // Agrupar shared por par-de-routers para evitar pisado horizontal.
  const sharedGroups = new Map<string, string[]>(); // key = "r1|r2" sorted
  for (const [node, rs] of sharedBetween) {
    const key = [...rs].sort().join("|");
    if (!sharedGroups.has(key)) sharedGroups.set(key, []);
    sharedGroups.get(key)!.push(node);
  }
  for (const [key, nodes] of sharedGroups) {
    const rs = key.split("|");
    const cxs = rs.map(n => routerCenter.get(n)).filter((v): v is number => v != null);
    if (cxs.length === 0) continue;
    const cx = cxs.reduce((a, b) => a + b, 0) / cxs.length;
    // Si hay varios nodos compartidos por el mismo par, repartir simétricamente.
    nodes.sort((a, b) => a.localeCompare(b));
    nodes.forEach((n, i) => {
      const dev = byName.get(n);
      if (!dev) return;
      const xs = spreadAround(cx, nodes.length, LAYOUT.CLOUD_X_SPACING);
      placements.set(n, { x: xs[i]!, y: sharedY(dev.category) });
    });
  }

  // ---------------- Posicionar hijos por router ----------------
  // Cada router consulta `bandsFor(name)` — backbone o tránsito — para que
  // sus hijos hereden la fila Y correspondiente al tier del padre.
  for (const r of routerOrder) {
    const c = children.get(r.name)!;
    const rcx = routerCenter.get(r.name)!;
    const bands = bandsFor(r.name);

    // ---- APs sobre el router ----
    {
      const aps = [...c.aps].sort((a, b) => a.name.localeCompare(b.name));
      const xs = spreadAround(rcx, aps.length, LAYOUT.AP_X_SPACING);
      aps.forEach((d, i) => placements.set(d.name, { x: xs[i]!, y: bands.ap }));
    }

    // ---- Clouds: mitad arriba, mitad abajo ----
    {
      const cls = [...c.clouds].sort((a, b) => a.name.localeCompare(b.name));
      const halfTop = Math.ceil(cls.length / 2);
      const top = cls.slice(0, halfTop);
      const bottom = cls.slice(halfTop);
      const topXs = spreadAround(rcx, top.length, LAYOUT.CLOUD_X_SPACING);
      const botXs = spreadAround(rcx, bottom.length, LAYOUT.CLOUD_X_SPACING);
      top.forEach((d, i) => placements.set(d.name, { x: topXs[i]!, y: bands.cloudTop }));
      bottom.forEach((d, i) => placements.set(d.name, { x: botXs[i]!, y: bands.cloudBottom }));
    }

    // ---- Switches debajo del router, repartidos por sus propios anchos ----
    const switchCenter = new Map<string, number>();
    {
      const sws = [...c.switches].sort((a, b) => a.name.localeCompare(b.name));
      if (sws.length > 0) {
        const widths = sws.map(switchWidthFor);
        const total = widths.reduce((a, b) => a + b, 0)
          + Math.max(0, sws.length - 1) * 0.2;
        let xCursor = rcx - (total * LAYOUT.PC_X_SPACING) / 2;
        sws.forEach((sw, i) => {
          const wPx = widths[i]! * LAYOUT.PC_X_SPACING;
          const cx = xCursor + wPx / 2;
          placements.set(sw.name, { x: cx, y: bands.switch });
          switchCenter.set(sw.name, cx);
          xCursor = xCursor + wPx + 0.2 * LAYOUT.PC_X_SPACING;
        });
      }
    }

    // ---- Endpoints de cada switch, centrados bajo el switch ----
    for (const sw of c.switches) {
      const eps = [...(switchEndpoints.get(sw.name) ?? [])]
        .sort((a, b) => a.name.localeCompare(b.name));
      const cx = switchCenter.get(sw.name)!;
      // Si hay > 6 endpoints, partir en dos filas (segunda fila + 60px).
      if (eps.length <= 6) {
        const xs = spreadAround(cx, eps.length, LAYOUT.PC_X_SPACING);
        eps.forEach((d, i) => placements.set(d.name, { x: xs[i]!, y: bands.endpoint }));
      } else {
        const half = Math.ceil(eps.length / 2);
        const row1 = eps.slice(0, half);
        const row2 = eps.slice(half);
        const xs1 = spreadAround(cx, row1.length, LAYOUT.PC_X_SPACING);
        const xs2 = spreadAround(cx, row2.length, LAYOUT.PC_X_SPACING);
        row1.forEach((d, i) => placements.set(d.name, { x: xs1[i]!, y: bands.endpoint }));
        row2.forEach((d, i) => placements.set(d.name, { x: xs2[i]!, y: bands.endpoint + 60 }));
      }
      // Servers detrás del switch: fila bands.server, centrados.
      const srv = [...(switchServers.get(sw.name) ?? [])]
        .sort((a, b) => a.name.localeCompare(b.name));
      const sxs = spreadAround(cx, srv.length, LAYOUT.SERVER_X_SPACING);
      srv.forEach((d, i) => placements.set(d.name, { x: sxs[i]!, y: bands.server }));
    }

    // ---- Endpoints directos al router (sin switch en medio) ----
    {
      const ep = [...c.directEndpoints].sort((a, b) => a.name.localeCompare(b.name));
      const xs = spreadAround(rcx, ep.length, LAYOUT.PC_X_SPACING);
      ep.forEach((d, i) => placements.set(d.name, { x: xs[i]!, y: bands.endpoint }));
    }

    // ---- Servers directos al router ----
    {
      const sv = [...c.servers].sort((a, b) => a.name.localeCompare(b.name));
      const xs = spreadAround(rcx, sv.length, LAYOUT.SERVER_X_SPACING);
      sv.forEach((d, i) => placements.set(d.name, { x: xs[i]!, y: bands.server }));
    }
  }

  // ---------------- Endpoints encadenados (dangling) ----------------
  // Recorrido iterativo: cada dangling se coloca debajo de su padre. Si el
  // padre es a su vez un dangling, primero hay que ubicarlo a él. La lista
  // queue garantiza que el padre siempre se haya colocado antes que el hijo
  // (porque sólo entran al ciclo cuando su padre está en `placements`).
  {
    const pending = new Map(danglingByParent);
    let prog = true;
    while (prog && pending.size > 0) {
      prog = false;
      for (const [parentName, kids] of [...pending]) {
        const parentSlot = placements.get(parentName);
        if (!parentSlot) continue; // padre todavía no ubicado, esperar otra ronda
        const sorted = [...kids].sort((a, b) => a.name.localeCompare(b.name));
        const xs = spreadAround(parentSlot.x, sorted.length, LAYOUT.PC_X_SPACING * 0.9);
        sorted.forEach((d, i) => {
          // Justo debajo del padre. Si el padre ya está en la sub-fila +60,
          // esto cae en +120 (un análogo conectado a un análogo, raro pero OK).
          const childY = parentSlot.y === LAYOUT.Y_ENDPOINT
            ? LAYOUT.Y_ENDPOINT + 60
            : parentSlot.y + 60;
          placements.set(d.name, { x: xs[i]!, y: childY });
        });
        pending.delete(parentName);
        prog = true;
      }
    }
  }

  // ---------------- Huérfanos (sin ruta a router) ----------------
  // Mantienen banda Y por categoría, columna libre a la derecha del último
  // router. Ordenados por nombre para idempotencia.
  const orphans = snapshot.devices
    .filter(d => !placements.has(d.name))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (orphans.length > 0) {
    const baseX = cursor; // cursor quedó tras el último router
    const colCounts = new Map<number, number>(); // y → #col actual
    for (const d of orphans) {
      const y = d.category ? categoryRow(d.category) : LAYOUT.Y_ENDPOINT;
      const col = colCounts.get(y) ?? 0;
      colCounts.set(y, col + 1);
      placements.set(d.name, {
        x: baseX + col * LAYOUT.X_SPACING,
        y,
      });
    }
  }

  // ---------------- Construir lista de moves ----------------
  const moves: { name: string; x: number; y: number }[] = [];
  for (const d of snapshot.devices) {
    const slot = placements.get(d.name);
    if (!slot) continue;
    const rx = Math.round(slot.x);
    const ry = Math.round(slot.y);
    if (Math.abs(rx - d.x) < 1 && Math.abs(ry - d.y) < 1) continue;
    moves.push({ name: d.name, x: rx, y: ry });
  }
  return moves;
}
