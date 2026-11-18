import { expect, test } from "bun:test";
import type { Bridge } from "../../src/bridge/http-bridge.js";
import { registerReadActivityTool } from "../../src/tools/read-activity.js";
import { registerVerifyFailoverTool, routeNextHops } from "../../src/tools/verify-failover.js";
import { registerVerifyLabTool } from "../../src/tools/verify-lab.js";
import type { ToolContext, ToolModule } from "../../src/tools/types.js";

function handler(register: ToolModule, bridge: Partial<Bridge>) {
  let invoke!: (args: object) => Promise<{ isError?: boolean; content: { text: string }[] }>;
  register({
    bridge: { status: () => ({ connected: true }), ...bridge },
    server: { tool: (_name: string, _description: string, _schema: unknown, action: typeof invoke) => { invoke = action; } },
  } as unknown as ToolContext);
  return invoke;
}

test("activity reads the requested visible instruction without switching pages", async () => {
  const ipc = { appWindow: () => ({ getActiveFile: () => ({
    getInstructionCount: () => 3, getCurrentInstruction: () => "Current",
    getInstruction: (index: number) => `Instruction ${index + 1}`,
    getPercentageComplete: () => 15, getCorrectAssessmentItemsCount: () => 3, getAssessmentItemsCount: () => 20,
  }) }) };
  const run = handler(registerReadActivityTool, {
    sendAndWait: async code => Function("ipc", `return (${code})`)(ipc),
  });
  expect(JSON.parse((await run({ page: 2 })).content[0]!.text)).toEqual({
    pages: 3, page: 2, instructions: "Instruction 2", percentComplete: 15, correctItems: 3, totalItems: 20,
  });
  expect((await run({ page: 4 })).isError).toBe(true);
});

test("lab isolation requires a completed ping and checks continue after errors", async () => {
  const ios = (output: string) => JSON.stringify([{ offset: 0, previousPrompt: "PC>",
    prompt: "PC>", output }]);
  const run = handler(registerVerifyLabTool, {
    sendAndWait: async code => code.includes("192.0.2.10") ? "ERR:device_not_found" :
      ios("Packets: Sent = 4, Received = 0, Lost = 4 (100% loss),\nPC>"),
  });
  const reply = await run({ checks: [
    { kind: "ping", device: "Missing", target: "192.0.2.10", reachable: false },
    { kind: "ping", device: "PC", target: "192.0.2.20", reachable: false },
  ] });
  expect(reply.isError).toBe(true);
  const result = JSON.parse(reply.content[0]!.text);
  expect(result.results.map((check: { passed: boolean }) => check.passed)).toEqual([false, true]);
});

test("failover reads the exact advertised prefix and includes continuation hops", () => {
  expect(routeNextHops(`B    192.0.2.0/24 [20/0] via 10.0.0.1
                         [20/0] via 10.0.0.2
C    192.0.2.128/25 is directly connected, GigabitEthernet0/0
S    192.0.20.0/24 [1/0] via 10.0.0.9`, "192.0.2.0/24")).toEqual(["10.0.0.1", "10.0.0.2"]);
});

test("failover restores and checks an interface even when the post-shutdown probe fails", async () => {
  let up = true, pings = 0;
  const applied: string[] = [];
  const run = handler(registerVerifyFailoverTool, {
    sendAndWait: async code => {
      if (code.includes("physical_link_not_found")) return JSON.stringify({ up, protocol: up });
      if (!code.includes("var commands=")) return "R1#";
      const commands = JSON.parse(/var commands=(\[[^\n]*?\]),replies/.exec(code)![1]!) as string[];
      const command = commands[0]!;
      if (command.startsWith("ping")) {
        if (++pings > 1) return "ERR:probe_failed";
        return JSON.stringify([{ offset: 0, previousPrompt: "PC>", prompt: "PC>",
          output: "Packets: Sent = 4, Received = 4, Lost = 0 (0% loss)" }]);
      }
      for (const cmd of commands) {
        if (cmd === "shutdown") up = false;
        if (cmd === "no shutdown") up = true;
        applied.push(cmd);
      }
      return JSON.stringify(commands.map(() => ({ offset: 0, previousPrompt: "R1#", prompt: "R1#", output: "\nR1#" })));
    },
  });
  const reply = await run({ router: "R1", interface: "GigabitEthernet0/0", source: "PC",
    target: "192.0.2.1", confirm: true, timeout_ms: 5000 });
  expect(reply.isError).toBe(true);
  expect(JSON.parse(reply.content[0]!.text)).toMatchObject({ restored: true, error: "Error: ERR:probe_failed" });
  expect(applied.filter(cmd => cmd.includes("shutdown"))).toEqual(["shutdown", "no shutdown"]);
});
