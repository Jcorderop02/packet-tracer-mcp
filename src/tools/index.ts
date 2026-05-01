import type { ToolModule } from "./types.js";
import { registerBridgeStatusTool } from "./bridge-status.js";
import { registerListDevicesTool } from "./list-devices.js";
import { registerListModulesTool } from "./list-modules.js";
import { registerListRecipesTool } from "./list-recipes.js";
import { registerListSnapshotsTool } from "./list-snapshots.js";
import { registerQueryTopologyTool } from "./query-topology.js";
import { registerGetDeviceDetailsTool } from "./get-device-details.js";
import { registerInspectCanvasTool } from "./inspect-canvas.js";
import { registerExplainCanvasTool } from "./explain-canvas.js";
import { registerForecastTool } from "./forecast.js";
import { registerGenerateConfigsTool } from "./generate-configs.js";
import { registerAddDeviceTool } from "./add-device.js";
import { registerAutoLayoutTool } from "./auto-layout.js";
import { registerAddModuleTool } from "./add-module.js";
import { registerCreateLinkTool } from "./create-link.js";
import { registerDeleteDeviceTool } from "./delete-device.js";
import { registerDeleteLinkTool } from "./delete-link.js";
import { registerMoveDeviceTool } from "./move-device.js";
import { registerRenameDeviceTool } from "./rename-device.js";
import { registerSetPcTool } from "./set-pc.js";
import { registerCookTopologyTool } from "./cook-topology.js";
import { registerMendCanvasTool } from "./mend-canvas.js";
import { registerApplySwitchingTool } from "./apply-switching.js";
import { registerApplyServicesTool } from "./apply-services.js";
import { registerApplyWirelessTool } from "./apply-wireless.js";
import { registerApplyVoipTool } from "./apply-voip.js";
import { registerApplyIpv6Tool } from "./apply-ipv6.js";
import { registerApplyAdvancedRoutingTool } from "./apply-advanced-routing.js";
import { registerSaveSnapshotTool } from "./save-snapshot.js";
import { registerLoadSnapshotTool } from "./load-snapshot.js";
import { registerDiffSnapshotsTool } from "./diff-snapshots.js";
import { registerRunCliTool } from "./run-cli.js";
import { registerRunCliBulkTool } from "./run-cli-bulk.js";
import { registerPingTool } from "./ping.js";
import { registerTracerouteTool } from "./traceroute.js";
import { registerShowRunningTool } from "./show-running.js";
import { registerSimulationModeTool } from "./simulation-mode.js";
import { registerSimulationPlayTool } from "./simulation-play.js";
import { registerSendPduTool } from "./send-pdu.js";
import { registerClearCanvasTool } from "./clear-canvas.js";
import { registerScreenshotTool } from "./screenshot.js";
import { registerSavePktTool } from "./save-pkt.js";
import { registerOpenPktTool } from "./open-pkt.js";
import { registerSavePktToBytesTool } from "./save-pkt-to-bytes.js";
import { registerOpenPktFromBytesTool } from "./open-pkt-from-bytes.js";
import { registerSendRawTool } from "./send-raw.js";
import { registerSetDevicePowerTool } from "./set-device-power.js";
import { registerReadVlansTool } from "./read-vlans.js";
import { registerInspectPortsTool } from "./inspect-ports.js";
import { registerReadAclTool } from "./read-acl.js";
import { registerShowBgpRoutesTool } from "./show-bgp-routes.js";
import { registerManageClustersTool } from "./manage-clusters.js";
import { registerAddCanvasAnnotationTool } from "./add-canvas-annotation.js";
import { registerReadProjectMetadataTool } from "./read-project-metadata.js";
import { registerConfigureServerDhcpTool } from "./configure-server-dhcp.js";
import { registerConfigureSubinterfaceTool } from "./configure-subinterface.js";
import { registerPlanReviewTool } from "./plan-review.js";

export type { ToolContext, ToolModule } from "./types.js";

export const ALL_TOOLS: readonly ToolModule[] = [
  // Pre-flight planning (must come before any write operation on ≥3-router topologies)
  registerPlanReviewTool,
  // Health + catalog
  registerBridgeStatusTool,
  registerListDevicesTool,
  registerListModulesTool,
  registerListRecipesTool,
  registerListSnapshotsTool,
  // Read-only inspection of the live workspace
  registerQueryTopologyTool,
  registerGetDeviceDetailsTool,
  registerInspectCanvasTool,
  registerExplainCanvasTool,
  registerForecastTool,
  registerGenerateConfigsTool,
  // Per-element authoring (low-level primitives)
  registerAddDeviceTool,
  registerAddModuleTool,
  registerCreateLinkTool,
  registerDeleteDeviceTool,
  registerDeleteLinkTool,
  registerMoveDeviceTool,
  registerAutoLayoutTool,
  registerRenameDeviceTool,
  registerSetPcTool,
  registerSetDevicePowerTool,
  registerAddCanvasAnnotationTool,
  registerManageClustersTool,
  // Read-only diagnostics on live devices
  registerInspectPortsTool,
  registerReadVlansTool,
  registerReadAclTool,
  registerShowBgpRoutesTool,
  registerReadProjectMetadataTool,
  // Recipe-level authoring (high-level orchestration over canvas)
  registerCookTopologyTool,
  registerMendCanvasTool,
  registerApplySwitchingTool,
  registerApplyServicesTool,
  registerConfigureServerDhcpTool,
  registerConfigureSubinterfaceTool,
  registerApplyWirelessTool,
  registerApplyVoipTool,
  registerApplyIpv6Tool,
  registerApplyAdvancedRoutingTool,
  // Persistence (snapshots, not plans)
  registerSaveSnapshotTool,
  registerLoadSnapshotTool,
  registerDiffSnapshotsTool,
  // CLI access
  registerRunCliTool,
  registerRunCliBulkTool,
  // Simulation / ops (Phase 8)
  registerPingTool,
  registerTracerouteTool,
  registerShowRunningTool,
  registerSimulationModeTool,
  registerSimulationPlayTool,
  registerSendPduTool,
  registerScreenshotTool,
  registerClearCanvasTool,
  // .pkt persistence (Phase 9)
  registerSavePktTool,
  registerOpenPktTool,
  registerSavePktToBytesTool,
  registerOpenPktFromBytesTool,
  // Escape hatch
  registerSendRawTool,
];
