import { z } from "zod";
import { inspectPortsJs } from "../ipc/generator.js";
import { errorResult, requireConnectedBridge, textResult } from "./helpers.js";
import type { ToolModule } from "./types.js";

interface PortRow {
  readonly port: string;
  readonly link: boolean;
  readonly portUp: number; // -1 / 0 / 1
  readonly protoUp: number;
  readonly mac: string;
  readonly ip: string;
  readonly mask: string;
  readonly wireless: boolean;
}

function parsePorts(raw: string): PortRow[] {
  const lines = raw.split("\n").slice(1);
  const out: PortRow[] = [];
  for (const line of lines) {
    if (!line) continue;
    const [port, lk, pu, prc, mac, ip, mask, wl] = line.split("|");
    out.push({
      port: port ?? "",
      link: lk === "1",
      portUp: Number.parseInt(pu ?? "-1", 10),
      protoUp: Number.parseInt(prc ?? "-1", 10),
      mac: mac ?? "",
      ip: ip ?? "",
      mask: mask ?? "",
      wireless: wl === "1",
    });
  }
  return out;
}

function trinary(value: number): string {
  if (value === 1) return "up";
  if (value === 0) return "down";
  return "n/a";
}

const InputSchema = {
  device: z.string().min(1).describe("Device name on the live canvas."),
  onlyLinked: z.boolean().default(false).describe("Filter to ports that have a link attached."),
};

export const registerInspectPortsTool: ToolModule = ({ bridge, server }) => {
  server.tool(
    "pt_inspect_ports",
    "Live per-port status: link presence, isPortUp, isProtocolUp, MAC, IP/mask, wireless flag — read directly from the Port objects.",
    InputSchema,
    async ({ device, onlyLinked }) => {
      const blocked = requireConnectedBridge(bridge);
      if (blocked) return blocked;

      const reply = await bridge.sendAndWait(inspectPortsJs(device), { timeoutMs: 10_000 });
      if (reply === null) return errorResult("Timed out waiting for PT to answer.");
      if (reply === "ERR:not_found") return errorResult(`Device '${device}' not found.`);
      if (reply.startsWith("ERR:")) return errorResult(`PT raised: ${reply}`);

      const all = parsePorts(reply);
      const ports = onlyLinked ? all.filter(p => p.link) : all;
      const lines = [`Ports on '${device}': ${ports.length}/${all.length}`];
      for (const p of ports) {
        const ipPart = p.ip ? ` ${p.ip}/${p.mask}` : "";
        const wl = p.wireless ? " [wireless]" : "";
        const link = p.link ? "linked" : "free";
        lines.push(
          `  ${p.port}${ipPart}\tlink=${link} port=${trinary(p.portUp)} proto=${trinary(p.protoUp)} mac=${p.mac || "?"}${wl}`,
        );
      }
      return textResult(lines.join("\n"));
    },
  );
};
