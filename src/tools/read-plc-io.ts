import { z } from "zod";
import { nativeDevice } from "../ipc/integration-common.js";
import { makeGuard, nativeCall } from "./integration-common.js";
import type { ToolModule } from "./types.js";

export const registerReadPlcIoTool: ToolModule = ({ bridge, server }) => {
  const guard = makeGuard(bridge);
  server.tool("pt_read_plc_io", "Read the native digital and analog slots of a simulated PLC-PT, including their currently observed values.", {
    device: z.string().min(1),
  }, ({ device }) => guard(() => nativeCall(bridge, nativeDevice(device, `
    if(String(d.getModel())!=="PLC-PT")return "ERR:expected_plc_pt";
    function slots(count,offset,read){
      var rows=[];
      for(var i=0;i<count;i++){
        var slot=offset+i,p=d.getComponentAtSlot(slot);
        rows.push({slot:slot,name:p?String(p.getSlotName()):null,value:p?Number(p[read]()):null,
          input:p&&typeof p.isInputMode==="function"?p.isInputMode():null,
          output:p&&typeof p.isOutputMode==="function"?p.isOutputMode():null});
      }
      return rows;
    }
    return JSON.stringify({device:String(d.getName()),
      digital:slots(d.getDigitalSlotsCount(),d.getDigitalSlotsOffset(),"digitalRead"),
      analog:slots(d.getAnalogSlotsCount(),d.getAnalogSlotsOffset(),"analogRead")});
  `))));
};
