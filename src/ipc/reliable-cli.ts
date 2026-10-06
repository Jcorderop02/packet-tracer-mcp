import type { Bridge } from "../bridge/http-bridge.js";
import { jsStr } from "./escape.js";

export interface CliReply { command: string; output: string; timedOut: boolean; errors: string[]; }
const locks = new WeakMap<Bridge, Map<string, Promise<unknown>>>();
export async function withCliLock<T>(bridge: Bridge, device: string, action: () => Promise<T>): Promise<T> {
  let devices = locks.get(bridge);
  if (!devices) locks.set(bridge, devices = new Map());
  const previous = devices.get(device) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(action);
  devices.set(device, next);
  try { return await next; } finally { if (devices.get(device) === next) devices.delete(device); }
}
export function cliErrors(output: string): string[] {
  return output.split(/\r?\n/).filter(line => /%\s*(Invalid|Incomplete|Ambiguous|Error)|invalid command|unknown command|bad command|not recognized/i.test(line));
}
async function call(bridge: Bridge, code: string): Promise<string> {
  const reply = await bridge.sendAndWait(code, { timeoutMs: 5000 });
  if (reply === null || /^(?:ERR|ERROR):/.test(reply)) throw new Error(reply ?? "Bridge timeout; command outcome unknown. Do not blindly retry writes.");
  return reply;
}
/** Caller holds the per-device lock for the entire command block. */
export async function executeCli(bridge: Bridge, device: string, command: string, timeoutMs = 30000): Promise<CliReply> {
  const d = `var d=ipc.network().getDevice(${jsStr(device)});if(!d)return "ERR:not_found";var cl=d.getCommandLine();`;
  const start = JSON.parse(await call(bridge, `(function(){${d}var tail=cl.getOutput().slice(-500);if(/configuration dialog.*\\[yes\\/no\\]:\\s*$/i.test(tail)){cl.enterCommand("no");cl.enterCommand("");}var offset=cl.getOutput().length;cl.enterCommand(${jsStr(command)});return JSON.stringify({offset:offset});})()`)) as {offset: number};
  const deadline = Date.now() + timeoutMs;
  let output = "", last = "", stable = 0, pages = 0;
  while (Date.now() < deadline) {
    const state = JSON.parse(await call(bridge, `(function(){${d}var out=String(cl.getOutput());return JSON.stringify({output:out.substring(${start.offset}),prompt:String(cl.getPrompt()||"")});})()`)) as { output: string; prompt: string };
    output = state.output;
    if (/--More--\s*$/.test(output)) {
      if (++pages > 200) throw new Error("CLI pagination exceeded 200 pages.");
      await call(bridge, `(function(){${d}cl.enterCommand(" ");return "OK";})()`);
      stable = 0;
    } else {
      stable = output === last ? stable + 1 : 0;
      const promptReturned = /(?:[>#]|C:\\>)\s*$/.test(output) && state.prompt.trim().length > 0;
      const terminal = /Packets:\s*Sent\s*=.*Lost\s*=|Success rate is|Trace complete\.|could not find host/i.test(output);
      if (terminal || promptReturned && stable >= 1) return { command, output, timedOut: false, errors: cliErrors(output) };
    }
    last = output;
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  return { command, output, timedOut: true, errors: cliErrors(output) };
}
export async function runCliBlock(bridge: Bridge, device: string, commands: string[], timeoutMs = 30000): Promise<CliReply[]> {
  return withCliLock(bridge, device, async () => {
    const replies: CliReply[] = [];
    for (const command of commands) {
      const reply = await executeCli(bridge, device, command, timeoutMs);
      replies.push(reply);
      if (reply.timedOut || reply.errors.length) break; // Avoid feeding subsequent writes to a busy CLI.
    }
    return replies;
  });
}
