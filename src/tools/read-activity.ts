import { z } from "zod";
import { makeGuard, nativeCall } from "./integration-common.js";
import type { ToolModule } from "./types.js";

export const registerReadActivityTool: ToolModule = ({ bridge, server }) => {
  const guard = makeGuard(bridge);
  server.tool("pt_read_activity", "Read visible instructions and progress from an open Packet Tracer activity (.pka).", {
    page: z.number().int().min(1).max(1000).optional(),
  }, ({ page }) => guard(() => nativeCall(bridge, `(function(){
    var f=ipc.appWindow().getActiveFile();
    if(!f||typeof f.getInstructionCount!=="function"||typeof f.getPercentageComplete!=="function")return "ERR:no_readable_activity";
    var pages=f.getInstructionCount(),page=${page ?? "null"};
    if(page!==null&&page>pages)return "ERR:page_out_of_range";
    return JSON.stringify({pages:pages,page:page,instructions:String((page===null?f.getCurrentInstruction():f.getInstruction(page-1))||"").slice(0,32000),
      percentComplete:f.getPercentageComplete(),correctItems:f.getCorrectAssessmentItemsCount(),totalItems:f.getAssessmentItemsCount()});
  })()`)));
};
