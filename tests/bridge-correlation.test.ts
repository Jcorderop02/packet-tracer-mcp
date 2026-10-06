import { expect, test, describe } from "bun:test";
import { Bridge } from "../src/bridge/http-bridge.js";
function wire(bridge:Bridge):{handle:(r:Request)=>Promise<Response>} {return bridge as unknown as {handle:(r:Request)=>Promise<Response>};}
async function dequeue(bridge:Bridge):Promise<string>{return (await wire(bridge).handle(new Request(`http://localhost:${bridge.port}/next`))).text();}
function evaluateWire(code:string):string {let result="";Function("__mcpEval",code)((inner:string)=>{result=String(eval(inner));});return result;}
async function deliver(bridge:Bridge,value:string){const hex=Array.from(value,c=>c.charCodeAt(0).toString(16).padStart(2,"0")).join("");await wire(bridge).handle(new Request(`http://localhost:${bridge.port}/result`,{method:"POST",body:hex}));}
describe("correlated transport",()=>{
  test("out-of-order replies resolve their own requests",async()=>{const b=new Bridge();const a=b.sendAndWait('"first"'),c=b.sendAndWait('"second"');const x=await dequeue(b),y=await dequeue(b);await deliver(b,evaluateWire(y));await deliver(b,evaluateWire(x));expect(await a).toBe("first");expect(await c).toBe("second");b.stop();});
  test("late timed-out reply cannot satisfy a new request",async()=>{const b=new Bridge();const a=b.sendAndWait('"old"',{timeoutMs:5});const old=await dequeue(b);expect(await a).toBeNull();const fresh=b.sendAndWait('"new"');const next=await dequeue(b);await deliver(b,evaluateWire(old));expect(b.status().hasPendingResult).toBe(true);await deliver(b,evaluateWire(next));expect(await fresh).toBe("new");b.stop();});
  test("expired queued writes are removed before execution",async()=>{const b=new Bridge();expect(await b.sendAndWait('"never run"',{timeoutMs:5})).toBeNull();expect(await dequeue(b)).toBe("");b.stop();});
  test("quotes, newlines, Unicode, emoji and control characters survive legacy hex",async()=>{const b=new Bridge();const text="'\"\\\n\r\t\0 á 漢字 🚀";const promise=b.sendAndWait(JSON.stringify(text),{label:"unsafe */ label"});await deliver(b,evaluateWire(await dequeue(b)));expect(await promise).toBe(text);b.stop();});
  test("native errors preserve request correlation",async()=>{const b=new Bridge();const p=b.sendAndWait('(function(){throw new Error("bad");})()');await deliver(b,evaluateWire(await dequeue(b)));expect(await p).toContain("ERROR:");b.stop();});
  test("status requests alone do not pretend PT is connected",async()=>{const b=new Bridge();await wire(b).handle(new Request("http://localhost/status"));expect(b.status().connected).toBe(false);});
  test("stop settles all pending requests",async()=>{const b=new Bridge();const p=b.sendAndWait('"pending"');b.stop();expect(await p).toBeNull();expect(b.status().queueLength).toBe(0);});
});
