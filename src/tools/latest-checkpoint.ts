import { z } from "zod";
import { readFileSync } from "node:fs";
import { join, isAbsolute } from "node:path";
import { createHash } from "node:crypto";
import type { ToolModule } from "./types.js";
import { errorResult, textResult } from "./helpers.js";


export const InputSchema = {directory:z.string().min(1)};
export function buildJs(directory: string): string { return join(directory, "latest-checkpoint.json"); }
export { decodeNativeReply as decodeReply } from "./integration-common.js";
export const registerLatestCheckpointTool: ToolModule = ({bridge,server}) => {
server.tool("pt_latest_checkpoint", "Read and verify the last confirmed checkpoint, without modifying Packet Tracer.", InputSchema, async a=>{
    try{if(!isAbsolute(a.directory))throw new Error("Directory must be absolute.");const saved=JSON.parse(readFileSync(join(a.directory,"latest-checkpoint.json"),"utf8"));const bytes=readFileSync(saved.path);if(bytes.length!==saved.bytes||createHash("sha256").update(bytes).digest("hex")!==saved.sha256)throw new Error("Checkpoint checksum/size mismatch.");return textResult(JSON.stringify(saved));}catch(e){return errorResult(String(e));}
  });
};
