import { expect, test } from "bun:test";
import { runCliBlock } from "../src/ipc/reliable-cli.js";
import { waitForClisReady } from "../src/ipc/cli-wait.js";
import type { Bridge } from "../src/bridge/http-bridge.js";
function mockCli(commandResponses: Record<string,string[]>){
  let output="Switch>",prompt="Switch>",pages:string[]=[],sent:string[]=[];
  const cl={getOutput:()=>output,getPrompt:()=>prompt,enterCommand:(command:string)=>{
    sent.push(command);
    if(command===""){output+=pages.shift()??"\nSwitch#";return;}
    pages=[...(commandResponses[command]??["\nSwitch#"])];prompt="Switch#";output+=`\nSwitch#${command}\n`+(pages.shift()??"");
  }};
  const ipc={network:()=>({getDevice:()=>({getCommandLine:()=>cl})})};
  const bridge={sendAndWait:async(code:string)=>String(Function("ipc",`return (${code});`)(ipc))} as unknown as Bridge;
  return {bridge,sent};
}
test("pagination continues until final prompt before the next command",async()=>{
  const {bridge,sent}=mockCli({"show running-config":["line1\n--More--","line2\n--More--","line3\nSwitch#"],"show clock":["clock\nSwitch#"]});
  const result=await runCliBlock(bridge,"SW",["show running-config","show clock"],2000);
  expect(result[0]?.output).toContain("line3");expect(result.every(r=>!r.timedOut)).toBe(true);
  expect(sent).toEqual(["show running-config","","","show clock"]);
});
test("CLI parser error stops later configuration commands",async()=>{
  const {bridge,sent}=mockCli({invalid:["% Invalid input detected at '^' marker.\nSwitch#"]});
  const result=await runCliBlock(bridge,"SW",["invalid","configure terminal"],2000);
  expect(result).toHaveLength(1);expect(result[0]?.errors).toHaveLength(1);expect(sent).toEqual(["invalid"]);
});
test("timeout preserves partial output and stops later writes",async()=>{
  const {bridge,sent}=mockCli({ping:["Request timed out."]});
  const result=await runCliBlock(bridge,"SW",["ping","configure terminal"],250);
  expect(result[0]?.timedOut).toBe(true);expect(result[0]?.output).toContain("timed out");expect(sent).toEqual(["ping"]);
});

test("a link-state notification after the prompt does not stall IOS commands", async () => {
  const { bridge, sent } = mockCli({
    "no shutdown": ["\nSwitch#\n%LINK-5-CHANGED: Interface FastEthernet0/1, changed state to up\n"],
    "ephone-dn 1": ["\nSwitch#%LINK-3-UPDOWN: Interface ephone_dsp DN 1.1, changed state to up\n"],
  });
  const replies = await runCliBlock(bridge, "SW", ["no shutdown", "ephone-dn 1", "show clock"], 2000);
  expect(replies.every(reply => !reply.timedOut)).toBe(true);
  expect(sent).toEqual(["no shutdown", "ephone-dn 1", "show clock"]);
});

test("an immediately completed command uses one bridge roundtrip", async () => {
  const { bridge } = mockCli({ "show clock": ["clock\nSwitch#"] });
  const send = bridge.sendAndWait.bind(bridge);
  let calls = 0;
  bridge.sendAndWait = (...args) => { calls++; return send(...args); };
  const [reply] = await runCliBlock(bridge, "SW", ["show clock"], 1000);
  expect(reply?.output).toContain("clock");
  expect(reply?.timedOut).toBe(false);
  expect(calls).toBe(1);
});

test.each(["ping 192.0.2.1", "do ping 192.0.2.1"])("an early prompt does not complete %s", async command => {
  const { bridge } = mockCli({ [command]: ["\nSwitch#"] });
  const send = bridge.sendAndWait.bind(bridge);
  bridge.sendAndWait = (source, options) => source.includes('var offset=') && !source.includes('enterCommand')
    ? Promise.resolve(JSON.stringify({ prompt: "Switch#", output: "Success rate is 100 percent (5/5)\nSwitch#" }))
    : send(source, options);
  const [reply] = await runCliBlock(bridge, "SW", [command], 1000);
  expect(reply?.output).toContain("100 percent (5/5)");
  expect(reply?.timedOut).toBe(false);
});


test("synchronous commands share a bridge call and stop at a rejected line", async () => {
  const { bridge, sent } = mockCli({ invalid: ["% Invalid input detected\nSwitch#"] });
  const send = bridge.sendAndWait.bind(bridge);
  let calls = 0;
  bridge.sendAndWait = (...args) => { calls++; return send(...args); };
  const replies = await runCliBlock(bridge, "SW", ["enable", "configure terminal", "invalid", "end"]);
  expect(calls).toBe(1);
  expect(sent).toEqual(["enable", "configure terminal", "invalid"]);
  expect(replies.at(-1)?.errors).toEqual(["% Invalid input detected"]);
});

test("ready prompts for multiple devices share a bridge call per round", async () => {
  const { bridge } = mockCli({});
  const send = bridge.sendAndWait.bind(bridge);
  const reads: string[] = [];
  bridge.sendAndWait = (code, opts) => { reads.push(code); return send(code, opts); };
  await waitForClisReady(bridge, ["R1", "SW1"]);
  expect(reads).toHaveLength(2);
  expect(reads.every(code => code.includes('"R1"') && code.includes('"SW1"'))).toBe(true);
});


test("preserves fresh CLI output after old console text rolls out of the buffer", async () => {
  let output = "a".repeat(230) + "\nSwitch#";
  const cl = {
    getOutput: () => output,
    getPrompt: () => "Switch#",
    enterCommand: (command: string) => {
      output = (output + command + "\nnew output\nSwitch#").slice(-238);
    },
  };
  const ipc = { network: () => ({ getDevice: () => ({ getCommandLine: () => cl }) }) };
  const bridge = { sendAndWait: async (code: string) => Function("ipc", `return (${code});`)(ipc) } as unknown as Bridge;
  const [reply] = await runCliBlock(bridge, "SW", ["show clock"], 1000);
  expect(reply?.timedOut).toBe(false);
  expect(reply?.output).toBe("show clock\nnew output\nSwitch#");
});


test("quits an existing pager before sending the next command", async () => {
  let output = "old output --More-- ";
  const sent: string[] = [];
  const cl = {
    getOutput: () => output,
    getPrompt: () => "Switch#",
    enterCommand: (command: string) => {
      sent.push(command);
      output = command === "q" ? "old output\nSwitch#" : output + command + "\nready\nSwitch#";
    },
  };
  const ipc = { network: () => ({ getDevice: () => ({ getCommandLine: () => cl }) }) };
  const bridge = { sendAndWait: async (code: string) => Function("ipc", `return (${code});`)(ipc) } as unknown as Bridge;
  const [reply] = await runCliBlock(bridge, "SW", ["show clock"], 1000);
  expect(reply?.output).toBe("show clock\nready\nSwitch#");
  expect(sent).toEqual(["q", "show clock"]);
});
