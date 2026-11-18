import { expect, test, describe } from "bun:test";
import { bulkCliJs } from "../src/ipc/generator.js";
function run(code:string,ipc:unknown):unknown { return Function("ipc",`return (${code});`)(ipc); }
test("bulk prologue does not send no to an ordinary prompt",()=>{const commands:string[]=[];const cl={getOutput:()=>"Switch>",enterCommand:(s:string)=>commands.push(s)};run(bulkCliJs("sw","enable"),{network:()=>({getDevice:()=>({getCommandLine:()=>cl})})});expect(commands).toEqual(["enable"]);});
test("bulk prologue dismisses only an actual pending wizard",()=>{let output="Would you like to enter the initial configuration dialog? [yes/no]:";const commands:string[]=[];const cl={getOutput:()=>output,enterCommand:(s:string)=>{commands.push(s);output="Router>";}};run(bulkCliJs("router","enable"),{network:()=>({getDevice:()=>({getCommandLine:()=>cl})})});expect(commands).toEqual(["no","","enable"]);});
