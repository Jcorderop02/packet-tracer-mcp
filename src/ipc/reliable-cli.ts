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
const cliErrorPattern = /%\s*(Invalid|Incomplete|Ambiguous|Error)|invalid command|unknown command|bad command|not recognized/i;
const pageBreak = /--More--\s*$/;
const pingCommand = /^(?:do\s+)?ping(?:\s|$)/i;
const traceCommand = /^(?:do\s+)?(?:traceroute|tracert)(?:\s|$)/i;

export function cliErrors(output: string): string[] {
  return output.split(/\r?\n/).filter(line => cliErrorPattern.test(line));
}

async function call(bridge: Bridge, code: string): Promise<string> {
  const reply = await bridge.sendAndWait(code, { timeoutMs: 5000 });
  if (reply === null || /^(?:ERR|ERROR):/.test(reply)) throw new Error(reply ?? "Bridge timeout; command outcome unknown. Do not blindly retry writes.");
  return reply;
}

interface CliState { output: string; prompt: string; }
interface StartedCommand extends CliState { offset: number; priorTail: string; previousPrompt: string; }

// Runs in both Bun and Packet Tracer's Script Engine.
function reachedPrompt(output: string, prompt: string): boolean {
  if (!/[>#]$/.test(prompt)) return false;
  var lines = output.split(/\r?\n/);
  for (var i = 0; i < lines.length; i++) {
    var text = lines[i]!.trim();
    if (text === prompt || text.indexOf(prompt) === 0 &&
        /^\s*%[A-Z0-9_]+-[0-7]-[A-Z0-9_]+:/.test(text.slice(prompt.length))) return true;
  }
  return false;
}

// Locate the previous buffer suffix when Packet Tracer trims old console output.
function cliDelta(buffer: string, offset: number, priorTail: string): string {
  if (!priorTail || buffer.slice(offset - priorTail.length, offset) === priorTail) return buffer.slice(offset);
  const current = buffer.lastIndexOf(priorTail);
  return current < 0 ? "" : buffer.slice(current + priorTail.length);
}

function startBatchJs(device: string, commands: string[]): string {
  return `(function(){${device}
    var tail=cl.getOutput().slice(-500);
    if(${pageBreak}.test(tail)){
      cl.enterCommand("q");
      tail=cl.getOutput().slice(-500);
      if(${pageBreak}.test(tail))return "ERR:cli_pager_still_active";
    }
    if(/configuration dialog.*\\[yes\\/no\\]:\\s*$/i.test(tail)){cl.enterCommand("no");cl.enterCommand("");}
    var commands=${JSON.stringify(commands)},replies=[];
    var reachedPrompt=${reachedPrompt.toString()},cliDelta=${cliDelta.toString()};
    for(var i=0;i<commands.length;i++){
      var command=commands[i],before=String(cl.getOutput()),offset=before.length,priorTail=before.slice(-120),previousPrompt=String(cl.getPrompt()||"");
      cl.enterCommand(command);
      var output=cliDelta(String(cl.getOutput()),offset,priorTail),prompt=String(cl.getPrompt()||"");
      replies.push({offset:offset,priorTail:priorTail,previousPrompt:previousPrompt,output:output,prompt:prompt});
      if(${pageBreak}.test(output)||${pingCommand}.test(command)||${traceCommand}.test(command)||
         ${cliErrorPattern}.test(output)||!reachedPrompt(output,prompt.trim()))break;
    }
    return JSON.stringify(replies);
  })()`;
}

async function finishCli(
  bridge: Bridge, device: string, command: string, start: StartedCommand, timeoutMs: number,
): Promise<CliReply> {
  const deadline = Date.now() + timeoutMs;
  let last = "", stable = 0, pages = 0;
  let state: CliState = start;
  while (true) {
    const { output } = state;
    const more = pageBreak.test(output);
    if (more) {
      if (++pages > 200) throw new Error("CLI pagination exceeded 200 pages.");
      stable = 0;
    } else {
      stable = output === last ? stable + 1 : 0;
      const prompt = state.prompt.trim();
      const leftConfig = /^end$/i.test(command) && /#$/.test(prompt) &&
        prompt !== start.previousPrompt.trim() && !/\(config/.test(prompt);
      const terminal = /Packets:\s*Sent\s*=.*Lost\s*=\s*\d+|Success rate is \d+\s*percent\s*\(\d+\s*\/\s*\d+\)|Trace (?:complete|terminated)|could not find host|unknown host|unable to resolve|cannot resolve|unrecognized host/i.test(output);
      const errors = cliErrors(output);
      // IOS can echo a prompt while a ping still has packets in flight.
      const pingPending = pingCommand.test(command) && !errors.length;
      if (terminal || reachedPrompt(output, prompt) && !pingPending || leftConfig && stable >= 1) {
        return { command, output, timedOut: false, errors };
      }
    }
    if (Date.now() >= deadline) break;
    last = output;
    if (!more) await Bun.sleep(150);
    if (Date.now() >= deadline) break;
    state = JSON.parse(await call(bridge, `(function(){${device}${more ? 'cl.enterCommand("");' : ""}
      var offset=${start.offset},cliDelta=${cliDelta.toString()};
      return JSON.stringify({output:cliDelta(String(cl.getOutput()),offset,${JSON.stringify(start.priorTail)}),prompt:String(cl.getPrompt()||"")});
    })()`.replace(/\r?\n/g, " ")));
    if (more && state.output === last) await Bun.sleep(150);
  }
  return { command, output: state.output, timedOut: true, errors: cliErrors(state.output) };
}

export function runCliBlock(bridge: Bridge, device: string, commands: string[], timeoutMs = 30000): Promise<CliReply[]> {
  return withCliLock(bridge, device, () => runCliBlockUnlocked(bridge, device, commands, timeoutMs));
}

/** The caller must hold the device CLI lock across the entire operation. */
export async function runCliBlockUnlocked(bridge: Bridge, device: string, commands: string[], timeoutMs = 30000): Promise<CliReply[]> {
  const native = `var d=ipc.network().getDevice(${jsStr(device)});if(!d)return "ERR:not_found";var cl=d.getCommandLine();`;
  const replies: CliReply[] = [];
  while (replies.length < commands.length) {
    const batch = commands.slice(replies.length, replies.length + 8);
    const started = JSON.parse(await call(bridge, startBatchJs(native, batch).replace(/\r?\n/g, " "))) as StartedCommand[];
    if (!started.length || started.length > batch.length) throw new Error("Invalid CLI batch response.");
    for (let i = 0; i < started.length; i++) {
      const reply = await finishCli(bridge, native, batch[i]!, started[i]!, timeoutMs);
      replies.push(reply);
      if (reply.timedOut || reply.errors.length) return replies;
    }
  }
  return replies;
}

/** Apply a CLI script and reject on the first command whose result is uncertain. */
export async function runCliScript(bridge: Bridge, device: string, script: string): Promise<string> {
  const commands = script.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const replies = await runCliBlock(bridge, device, commands);
  const last = replies.at(-1);
  if (last?.timedOut) throw new Error(`CLI on ${device} timed out at '${last.command}': ${last.output.slice(-500)}`);
  if (last?.errors.length) {
    throw new Error(`CLI on ${device} rejected '${last.command}': ${last.errors.join("\n")}`);
  }
  return replies.map(reply => reply.output).join("\n");
}
