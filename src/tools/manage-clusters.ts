import { z } from "zod";
import { listClustersJs, removeClusterJs, unClusterJs } from "../ipc/generator.js";
import { errorResult, requireConnectedBridge, textResult } from "./helpers.js";
import type { ToolModule } from "./types.js";

/**
 * Cluster management is read-and-prune only. PT 9's `LogicalWorkspace.addCluster()`
 * operates on the *currently selected* canvas items and there is no IPC to
 * drive selection programmatically — so a "create cluster with these
 * devices" operation isn't reachable from outside. We expose:
 *
 *   - `list`:   the full cluster tree (root + descendants).
 *   - `remove`: delete a cluster by id; `keepContents=true` flattens the
 *               children back into the parent, false also removes them.
 *   - `uncluster`: dissolve a cluster but keep its members on the canvas.
 */
const InputSchema = {
  action: z.enum(["list", "remove", "uncluster"]).describe("Operation to perform."),
  cluster_id: z.string().optional().describe("Cluster ID for remove/uncluster (from `list`)."),
  keep_contents: z.boolean().default(true).describe("On `remove`: keep child devices on the canvas (true) or delete them (false)."),
};

interface ClusterRow {
  readonly id: string;
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly parentId: string;
}

function parseClusters(raw: string): ClusterRow[] {
  const lines = raw.split("\n").slice(1);
  const out: ClusterRow[] = [];
  for (const line of lines) {
    if (!line) continue;
    const [id, name, x, y, parentId] = line.split("|");
    out.push({
      id: id ?? "",
      name: name ?? "",
      x: Number.parseFloat(x ?? "0"),
      y: Number.parseFloat(y ?? "0"),
      parentId: parentId ?? "",
    });
  }
  return out;
}

export const registerManageClustersTool: ToolModule = ({ bridge, server }) => {
  server.tool(
    "pt_manage_clusters",
    "Inspect and prune logical clusters on the canvas. `list` returns the cluster tree; `remove` deletes a cluster by id; `uncluster` dissolves it while keeping its members. Note: programmatic cluster *creation* is not reachable from PT 9's IPC (requires UI selection).",
    InputSchema,
    async ({ action, cluster_id, keep_contents }) => {
      const blocked = requireConnectedBridge(bridge);
      if (blocked) return blocked;

      if (action === "list") {
        const reply = await bridge.sendAndWait(listClustersJs(), { timeoutMs: 8_000 });
        if (reply === null) return errorResult("Timed out waiting for PT to answer.");
        if (reply.startsWith("ERR:")) return errorResult(`PT raised: ${reply}`);
        const rows = parseClusters(reply);
        if (rows.length === 0) return textResult("No clusters present.");
        const lines = [`Clusters: ${rows.length}`];
        for (const r of rows) {
          const parent = r.parentId ? ` parent=${r.parentId}` : " [root]";
          lines.push(`  ${r.id}\t${r.name || "(unnamed)"} @(${r.x},${r.y})${parent}`);
        }
        return textResult(lines.join("\n"));
      }

      if (!cluster_id) return errorResult(`'${action}' requires cluster_id.`);

      if (action === "remove") {
        const reply = await bridge.sendAndWait(removeClusterJs(cluster_id, keep_contents), { timeoutMs: 8_000 });
        if (reply === null) return errorResult("Timed out waiting for PT to answer.");
        if (reply.startsWith("ERR:")) return errorResult(`PT raised: ${reply}`);
        return textResult(`Cluster '${cluster_id}' removed (keep_contents=${keep_contents}).`);
      }

      // uncluster
      const reply = await bridge.sendAndWait(unClusterJs(cluster_id), { timeoutMs: 8_000 });
      if (reply === null) return errorResult("Timed out waiting for PT to answer.");
      if (reply.startsWith("ERR:")) return errorResult(`PT raised: ${reply}`);
      return textResult(`Cluster '${cluster_id}' dissolved; members remain on canvas.`);
    },
  );
};
