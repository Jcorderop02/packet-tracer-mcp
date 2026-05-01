import { z } from "zod";
import type { Bridge } from "../bridge/http-bridge.js";
import { linkRegistry } from "../canvas/link-registry.js";
import { CABLE_TYPE_ID, type CableKind } from "../ipc/constants.js";
import { createLinkJs } from "../ipc/generator.js";
import { errorResult, requireConnectedBridge, textResult } from "./helpers.js";
import { checkPtReply } from "./pt-errors.js";
import type { ToolModule } from "./types.js";

const cableKinds = Object.keys(CABLE_TYPE_ID) as [CableKind, ...CableKind[]];

const InputSchema = {
  device_a: z.string().min(1),
  port_a:   z.string().min(1).describe("Full port name on device_a, e.g. 'GigabitEthernet0/0'."),
  device_b: z.string().min(1),
  port_b:   z.string().min(1),
  cable:    z.enum(cableKinds).default("straight"),
  confirm_internal_lan: z.boolean().optional().describe(
    "Required forcing flag when both endpoints are routers and cable=\"straight\" or " +
    "\"cross\". Without it the call is REFUSED — the server assumes you may have " +
    "intended a WAN serial link (the most common LLM mistake). Pass true only after " +
    "confirming with the user that this is an internal Ethernet segment between two " +
    "routers (e.g., a small inter-router LAN within the same office), not a WAN " +
    "exterior point-to-point link.",
  ),
};

const DESCRIPTION =
  "Cable two existing devices together. Cable defaults to copper straight-through; " +
  "use 'cross' for switch trunks, 'serial' for WAN P2P (requires HWIC-2T module on " +
  "ISR routers — add it first with pt_add_module), 'fiber', 'console' or 'coaxial' " +
  "as needed. Convention: 'straight' for LAN segments (router↔switch, switch↔PC); " +
  "'serial' for WAN exterior P2P between routers crossing a public/ISP network. " +
  "SAFETY: refuses straight/cross between two routers without `confirm_internal_lan: true` " +
  "to prevent the common mistake of cabling WAN exterior links with Ethernet.";

export const registerCreateLinkTool: ToolModule = ({ bridge, server }) => {
  server.tool(
    "pt_create_link",
    DESCRIPTION,
    InputSchema,
    async ({ device_a, port_a, device_b, port_b, cable, confirm_internal_lan }) => {
      const blocked = requireConnectedBridge(bridge);
      if (blocked) return blocked;

      // Pre-flight: console cable misuse. cable="console" is the rollover
      // RS-232↔RJ45 management cable; it carries CLI traffic only and must
      // go to a Console port (router/switch) from a PC's RS-232 port.
      // Used as a data link it silently fails (no IP traffic).
      if (cable === "console" && !portsLookLikeConsole(port_a, port_b)) {
        return errorResult(
          `Refusing cable="console" between '${port_a}' and '${port_b}'.\n\n` +
            `The console cable (rollover RS-232↔RJ45) is for OUT-OF-BAND management ` +
            `only — connect a PC's "RS-232" port to a router/switch "Console" port. ` +
            `For data links use cable="straight" (LAN), "cross" (switch trunk), ` +
            `"serial" (WAN P2P), "fiber" or "coaxial" as appropriate.`,
        );
      }

      // Pre-flight safety check: if this is an Ethernet link between two
      // routers, require explicit confirmation. Read both class names in a
      // single IPC roundtrip — cheaper than a full snapshot.
      const ethernet = cable === "straight" || cable === "cross";
      const portsAreEthernet =
        isEthernetPort(port_a) && isEthernetPort(port_b);
      if (ethernet && portsAreEthernet && !confirm_internal_lan) {
        const classes = await fetchDeviceClasses(bridge, device_a, device_b);
        if (classes && isRouterClass(classes.a) && isRouterClass(classes.b)) {
          return errorResult(
            `Refusing to cable two routers (${device_a}, ${device_b}) with straight/cross Ethernet.\n` +
            `\n` +
            `This is the most common LLM mistake on academic labs: WAN exterior P2P\n` +
            `links between routers are usually SERIAL, not Gigabit. Two paths:\n` +
            `\n` +
            `  (a) WAN exterior link (typical: /30 public addressing, ISP between R2-R3):\n` +
            `      1. pt_add_module device=${device_a} module=HWIC-2T slot=1\n` +
            `      2. pt_add_module device=${device_b} module=HWIC-2T slot=1\n` +
            `      3. pt_create_link with port_a=Serial0/1/0, port_b=Serial0/1/0, cable="serial"\n` +
            `\n` +
            `  (b) Internal LAN segment between two routers in the same office:\n` +
            `      Confirm with the user, then re-call this tool with confirm_internal_lan=true.\n` +
            `\n` +
            `When unsure, ask the user. See the resource pt://convention/wiring for details.`,
          );
        }
      }

      const js = createLinkJs({
        deviceA: device_a,
        portA: port_a,
        deviceB: device_b,
        portB: port_b,
        cable,
      });
      const result = await bridge.sendAndWait(js, { timeoutMs: 10_000 });
      const err = checkPtReply(result, { device: device_a });
      if (err) return err;
      if (result === "true" || result === "OK") {
        // PT 9 expone un objeto Link opaco — todos sus accesores
        // (getDeviceA/B, getPortA/B, getEndpointA/B, getOtherEnd, getId,
        // toString) fallan con TypeError o devuelven null. Sin esto el
        // snapshot no puede reconstruir las parejas de cable y derivados
        // (auto_layout, explainer) tratan a todo como huérfano. Ver
        // src/canvas/link-registry.ts para el contexto completo.
        linkRegistry.register(device_a, port_a, device_b, port_b);
        let msg = `Linked ${device_a}:${port_a} <-> ${device_b}:${port_b} (${cable}).`;
        if (cable === "serial") {
          msg +=
            `\n\nReminder: in Packet Tracer one end of every serial link is DCE ` +
            `(provides clocking) and the other DTE. The DCE side MUST run ` +
            `'clock rate 64000' (or another valid rate) on its serial interface ` +
            `or the line stays 'down/down'. Use 'show controllers <iface>' to see ` +
            `which side is DCE; default in PT is the first cabled end.`;
        }
        return textResult(msg);
      }
      return errorResult(`PT returned an unexpected value: ${result}`);
    },
  );
};

export function portsLookLikeConsole(a: string, b: string): boolean {
  // PT exposes the management console port on routers/switches as "Console"
  // and the corresponding PC serial port as "RS-232". Either combination is
  // acceptable for cable="console".
  const lc = (s: string) => s.toLowerCase();
  const isConsoleLike = (s: string) =>
    lc(s).includes("console") || lc(s).includes("rs-232") || lc(s).includes("rs232");
  return isConsoleLike(a) && isConsoleLike(b);
}

function isEthernetPort(name: string): boolean {
  const lc = name.toLowerCase();
  return lc.startsWith("gigabitethernet")
    || lc.startsWith("fastethernet")
    || lc.startsWith("tengigabitethernet")
    || lc.startsWith("ethernet");
}

function isRouterClass(className: string): boolean {
  const lc = className.toLowerCase();
  return lc.includes("router") || lc.includes("firewall");
}

async function fetchDeviceClasses(
  bridge: Bridge,
  a: string,
  b: string,
): Promise<{ a: string; b: string } | null> {
  const js =
    `(function(){var net=ipc.network();` +
    `var a=net.getDevice(${JSON.stringify(a)});` +
    `var b=net.getDevice(${JSON.stringify(b)});` +
    `if(!a||!b)return "?|?";return a.getClassName()+"|"+b.getClassName();})()`;
  const reply = await bridge.sendAndWait(js, {
    timeoutMs: 3_000,
    label: `Verificando clases de ${a} y ${b}`,
  });
  if (!reply || reply.startsWith("ERR")) return null;
  const [classA, classB] = reply.split("|");
  if (!classA || !classB || classA === "?" || classB === "?") return null;
  return { a: classA, b: classB };
}
