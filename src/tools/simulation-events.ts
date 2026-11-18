import { z } from "zod";
import { makeGuard, nativeCall } from "./integration-common.js";
import type { ToolModule } from "./types.js";

export const registerSimulationEventsTools: ToolModule = ({ bridge, server }) => {
  const guard = makeGuard(bridge);
  server.tool("pt_simulation_events", "Read recorded frames in the active simulation, including where a packet was dropped. Set details to read frame ports and recorded decisions.", {
    details: z.boolean().default(false),
    limit: z.number().int().min(1).max(100).default(25),
  }, ({ limit, details }) => guard(() => nativeCall(bridge, `(function(){
    var sim=ipc.simulation(),total=sim.getFrameInstanceCount(),rows=[];
    function name(d){return d?String(d.getName()):null;}
    ${details ? `function frameDetails(frame){
      var input=null,outputs=[],decisions=[];
      try{input=name(frame.getInPort());}catch(e){}
      try{for(var j=0;j<Math.min(frame.getOutPortCount(),64);j++){outputs.push(name(frame.getOutPort(j)));}}catch(e){}
      try{for(var k=0;k<Math.min(frame.getFlowChartNodeCount(),32);k++){
        var decision=String(frame.getDecisionAt(k)||"");if(decision)decisions.push(decision.slice(0,300));
      }}catch(e){}
      return {inputPort:input,outputPorts:outputs,decisions:decisions};
    }` : ""}
    for(var i=Math.max(0,total-${limit});i<total;i++){
      var f=sim.getFrameInstanceAt(i);if(!f)continue;
      var event={index:i,time:f.getTime(),source:String(f.getSourceString()),destination:String(f.getDestinationString()),
        type:f.getUserTrafficType(),device:name(f.getDevice()),previousDevice:name(f.getPreviousDevice()),
        dropped:f.isFrameDropped(),accepted:f.isFrameAccepted(),sent:f.isFrameSent()};
      ${details ? "event.details=frameDetails(f);" : ""}
      rows.push(event);
    }
    return JSON.stringify({total:total,currentIndex:sim.getCurrentFrameInstanceIndex(),events:rows});
  })()`)));

  server.tool("pt_select_simulation_scenario", "Request activation of a known Packet Tracer scenario index. The Script Engine does not provide a scenario list or selection readback.", {
    index: z.number().int().min(0).max(999),
  }, ({ index }) => guard(() => nativeCall(bridge, `(function(){
    var p=ipc.appWindow().getUserCreatedPDU();
    if(!p)return "ERR:no_scenario_panel";
    p.activateScenario(${index});
    return JSON.stringify({requestedIndex:${index},verified:false});
  })()`)));
};
