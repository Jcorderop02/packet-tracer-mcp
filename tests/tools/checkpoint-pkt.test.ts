import { expect, test, describe } from "bun:test";
import type { Bridge } from "../../src/bridge/http-bridge.js";
import { nextCheckpointPath, confirmedSave } from "../../src/tools/checkpoint-pkt.js";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
describe("checkpoint numbering",()=>{
  test("numbering skips existing checkpoints and never overwrites",()=>{const dir=mkdtempSync(join(tmpdir(),"pt-checkpoint-"));try{writeFileSync(join(dir,"lab-0001.pkt"),"one");writeFileSync(join(dir,"lab-0007.pkt"),"seven");expect(nextCheckpointPath(dir,"lab")).toBe(join(dir,"lab-0008.pkt"));}finally{rmSync(dir,{recursive:true});}});
  test("unconfirmed saves cannot create success records",async()=>{const dir=mkdtempSync(join(tmpdir(),"pt-save-"));try{const fake={sendAndWait:async()=>"ERR:save_failed"} as unknown as Bridge;await expect(confirmedSave(fake,join(dir,"lab.pkt"))).rejects.toThrow("save_failed");}finally{rmSync(dir,{recursive:true});}});
});
