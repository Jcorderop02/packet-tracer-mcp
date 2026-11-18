import { z } from "zod";
import { makeGuard, nativeCall } from "./integration-common.js";
import type { ToolModule } from "./types.js";

export const registerPhysicalInventoryTool: ToolModule = ({ bridge, server }) => {
  const guard = makeGuard(bridge);
  server.tool("pt_physical_inventory", "Read physical locations and the devices they contain.", {
    limit: z.number().int().min(1).max(1000).default(200),
  }, ({ limit }) => guard(() => nativeCall(bridge, `(function(){
    var root=ipc.appWindow().getActiveWorkspace().getRootPhysicalObject();
    if(!root)return "ERR:no_physical_workspace";
    var rows=[],truncated=false;
    function walk(o,parent){
      if(rows.length>=${limit}){truncated=true;return;}
      var type=Number(o.getType()),i=rows.length;
      var item={id:i,parent:parent,name:String(o.getName()),type:type};
      if(type===6){var d=o.getDevice();if(d){item.device=String(d.getName());item.model=String(d.getModel());}}
      rows.push(item);
      for(var j=0;j<o.getChildCount()&&!truncated;j++){
        var child=o.getChildAt(j);if(child)walk(child,i);
      }
    }
    walk(root,null);
    return JSON.stringify({locations:rows,truncated:truncated});
  })()`)));
};
