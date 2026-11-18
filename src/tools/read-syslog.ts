import { z } from "zod";
import { nativeDevice } from "../ipc/integration-common.js";
import { makeGuard, nativeCall } from "./integration-common.js";
import type { ToolModule } from "./types.js";

export const registerReadSyslogTool: ToolModule = ({ bridge, server }) => {
  const guard = makeGuard(bridge);
  server.tool("pt_read_syslog", "Read recent received Syslog entries from a simulated Server-PT.", {
    device: z.string().min(1), limit: z.number().int().min(1).max(100).default(25),
  }, ({ device, limit }) => guard(() => nativeCall(bridge, nativeDevice(device, `
    if(String(d.getModel())!=="Server-PT")return "ERR:not_server_pt";
    var service=d.getProcess("SyslogServer");
    if(!service)return "ERR:syslog_unavailable";
    var entries=service.getAllEntries(),rows=[];
    for(var i=Math.max(0,entries.length-${limit});i<entries.length;i++){
      var e=entries[i];
      rows.push({dateTime:String(e.dateTime||""),source:String(e.hostIpAddress||""),
        priority:Number(e.priority),message:String(e.message||"").slice(0,2000)});
    }
    return JSON.stringify({enabled:service.isEnabled(),port:service.getPortNumber(),total:entries.length,entries:rows});
  `))));
};
