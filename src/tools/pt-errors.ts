/**
 * Centralised translation between the raw `ERR:*` strings produced by the JS
 * builders in `src/ipc/generator.ts` and structured PtError objects the tools
 * can act on. Keeping the mapping in one place stops drift when new error
 * paths are added — every new ERR sentinel goes here, every consumer benefits.
 */

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { errorResult } from "./helpers.js";

export type PtErrorCode =
  | "DEVICE_NOT_FOUND"
  | "PORT_NOT_FOUND"
  | "ALREADY_EXISTS"
  | "ADD_DEVICE_FAILED"
  | "ADD_MODULE_FAILED"
  | "MODULE_SLOT_OCCUPIED"
  | "BRIDGE_TIMEOUT"
  | "PT_RAISED"
  | "UNEXPECTED_REPLY";

export interface PtError {
  readonly code: PtErrorCode;
  readonly message: string;
  readonly raw?: string;
  readonly hint?: string;
}

export interface PtErrorContext {
  readonly device?: string;
  readonly port?: string;
  readonly slot?: string;
}

const RAW_TO_CODE: Readonly<Record<string, PtErrorCode>> = {
  "ERR:not_found": "DEVICE_NOT_FOUND",
  "ERR:port_not_found": "PORT_NOT_FOUND",
  "ERR:already_exists": "ALREADY_EXISTS",
  "ERR:addDevice_failed": "ADD_DEVICE_FAILED",
  "ERR:addModule_failed": "ADD_MODULE_FAILED",
};

/**
 * Inspect a raw bridge reply. Returns null on success ("OK", a payload, ...)
 * or a fully filled PtError when the reply maps to a known failure mode.
 *
 * Special replies:
 *   - null              → bridge timeout
 *   - starts "ERROR:"   → PT itself raised
 *   - matches RAW_TO_CODE → typed code with caller-specific message
 *
 * Anything else is left for the caller to interpret; tools that expect a
 * specific success token should check it explicitly *before* calling here.
 */
export function parsePtReply(raw: string | null, ctx: PtErrorContext = {}): PtError | null {
  if (raw === null) {
    return {
      code: "BRIDGE_TIMEOUT",
      message: "Timed out waiting for PT to answer.",
      hint: "Is the bridge bootstrap running inside PT? Check pt_bridge_status.",
    };
  }
  if (raw.startsWith("ERROR:")) {
    return { code: "PT_RAISED", message: `PT raised: ${raw}`, raw };
  }
  const code = RAW_TO_CODE[raw];
  if (!code) return null;

  switch (code) {
    case "DEVICE_NOT_FOUND":
      return {
        code,
        message: `Device '${ctx.device ?? "<unknown>"}' not found on the canvas.`,
        raw,
        hint: "Run pt_query_topology to list current devices.",
      };
    case "PORT_NOT_FOUND":
      return {
        code,
        message: `Port '${ctx.port ?? "<unknown>"}' not found on '${ctx.device ?? "<unknown>"}'.`,
        raw,
        hint: "Use pt_get_device_details to enumerate live ports for that device.",
      };
    case "ALREADY_EXISTS":
      return {
        code,
        message: `A device with that name already exists on the canvas.`,
        raw,
        hint: "Pick another name or remove the existing device first.",
      };
    case "ADD_DEVICE_FAILED":
      return {
        code,
        message: "PT refused to place the device. Likely an unknown PT model or rejected coordinates.",
        raw,
        hint: "Run pt_list_devices to confirm the model alias.",
      };
    case "ADD_MODULE_FAILED":
      return {
        code,
        message: `PT rejected the module insert at slot '${ctx.slot ?? "?"}'.`,
        raw,
        hint: "Slot occupied, unknown module, or bad chassis/bay path. Run pt_list_modules.",
      };
    default:
      return { code: "UNEXPECTED_REPLY", message: `Unhandled error sentinel: ${raw}`, raw };
  }
}

/** Convert a PtError into the MCP-shaped tool result. */
export function ptErrorToResult(e: PtError): CallToolResult {
  const lines = [`[${e.code}] ${e.message}`];
  if (e.hint) lines.push(`Hint: ${e.hint}`);
  return errorResult(lines.join("\n"));
}

/**
 * Convenience: check a raw reply and short-circuit a tool with an error result
 * if the reply maps to a known PtError. Returns null on success so the caller
 * can keep handling the success payload.
 */
export function checkPtReply(raw: string | null, ctx: PtErrorContext = {}): CallToolResult | null {
  const err = parsePtReply(raw, ctx);
  return err ? ptErrorToResult(err) : null;
}
