import { z } from "zod";
import type { Bridge } from "../bridge/http-bridge.js";
import { errorResult, requireConnectedBridge, textResult } from "./helpers.js";
export const ipv4 = z.string().refine(s => /^(?:\d{1,3}\.){3}\d{1,3}$/.test(s) && s.split(".").every(n => Number(n) <= 255), "Invalid IPv4 address");
export async function nativeCall(bridge: Bridge, code: string): Promise<string> {
  const reply = await bridge.sendAndWait(code, {timeoutMs:15000});
  if (reply === null || /^(ERR|ERROR):/.test(reply)) throw new Error(reply ?? "Bridge timeout; write outcome unknown.");
  return reply;
}
export function makeGuard(bridge: Bridge) {
  return async (action: () => Promise<string>) => {
    const blocked = requireConnectedBridge(bridge);
    if (blocked) return blocked;
    try { return textResult(await action()); } catch(e) { return errorResult(String(e)); }
  };
}

export function decodeNativeReply(raw: string): unknown {
  if (/^(ERR|ERROR):/.test(raw)) throw new Error(raw);
  if (/^OK(?::|$)/.test(raw)) return { status: "ok", detail: raw };
  return JSON.parse(raw) as unknown;
}
