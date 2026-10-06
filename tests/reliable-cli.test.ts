import { expect, test } from "bun:test";
import { runCliBlock } from "../src/ipc/reliable-cli.js";
import type { Bridge } from "../src/bridge/http-bridge.js";
function mockCli(commandResponses: Record<string,string[]>){
  let output="Switch>",prompt="Switch>",pages:string[]=[],sent:string[]=[];
  const cl={getOutput:()=>output,getPrompt:()=>prompt,enterCommand:(command:string)=>{
    sent.push(command);
    if(command===" "){output+=pages.shift()??"\nSwitch#";return;}
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
  expect(sent).toEqual(["show running-config"," "," ","show clock"]);
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
