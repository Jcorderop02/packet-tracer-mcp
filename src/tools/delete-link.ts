import { z } from "zod";
import { linkRegistry } from "../canvas/link-registry.js";
import { deleteLinkJs } from "../ipc/generator.js";
import { errorResult, requireConnectedBridge, textResult } from "./helpers.js";
import { checkPtReply } from "./pt-errors.js";
import type { ToolModule } from "./types.js";

/**
 * `LogicalWorkspace.deleteLink(deviceName, portName)` removes the link
 * attached to a single port. Either side of the link can be passed; PT will
 * locate the cable from one endpoint.
 */
const InputSchema = {
  device: z.string().min(1).describe("Either endpoint device of the link."),
  port: z.string().min(1).describe("Port on `device` whose link should be cut."),
};

export const registerDeleteLinkTool: ToolModule = ({ bridge, server }) => {
  server.tool(
    "pt_delete_link",
    "Remove the cable attached to one specific device port. Use this when you need to re-cable without deleting either device.",
    InputSchema,
    async ({ device, port }) => {
      const blocked = requireConnectedBridge(bridge);
      if (blocked) return blocked;

      const result = await bridge.sendAndWait(deleteLinkJs(device, port), { timeoutMs: 10_000 });
      const err = checkPtReply(result, { device, port });
      if (err) return err;
      if (result === "true" || result === "OK" || result === "undefined") {
        // Drop the matching entry from the local registry. We only know
        // one endpoint, so iterate and remove any link that touches
        // (device, port). Ver canvas/link-registry.ts para el contexto.
        for (const link of linkRegistry.all()) {
          const matchesA = link.aDevice === device && link.aPort === port;
          const matchesB = link.bDevice === device && link.bPort === port;
          if (matchesA || matchesB) {
            linkRegistry.unregister(link.aDevice, link.aPort, link.bDevice, link.bPort);
          }
        }
        return textResult(`Removed link on ${device}:${port}.`);
      }
      if (result === "false") {
        return errorResult(`PT could not find a link on ${device}:${port}.`);
      }
      return textResult(`Removed link on ${device}:${port} (PT returned: ${result}).`);
    },
  );
};
