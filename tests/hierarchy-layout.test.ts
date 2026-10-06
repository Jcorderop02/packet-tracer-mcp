import { expect, test, describe } from "bun:test";
import { hierarchyLayout } from "../src/canvas/hierarchy-layout.js";
import type { CanvasSnapshot, DeviceObservation } from "../src/canvas/types.js";
describe("hierarchical layout",()=>{
  test("cascade and AP association occupy their actual depths; layout is idempotent",()=>{
    const dev=(name:string,category:DeviceObservation["category"]):DeviceObservation=>({name,category,model:name,className:"",x:0,y:0,powered:true,ports:[]});
    const devices=[dev("WRT","wirelessrouter"),dev("SW1","switch"),dev("SW2","switch"),dev("AP","accesspoint"),dev("Notebook","laptop"),dev("PC","pc")];
    const links=[["WRT","SW1"],["SW1","SW2"],["SW2","AP"],["AP","Notebook"],["SW1","PC"]].map(([a,b])=>({aDevice:a!,aPort:"p",bDevice:b!,bPort:"p"}));
    const s:CanvasSnapshot={capturedAt:"test",devices,links};const positions=hierarchyLayout(s)!;const map=new Map(positions.map(p=>[p.name,p]));
    expect(map.get("SW2")!.y).toBeGreaterThan(map.get("SW1")!.y);expect(map.get("Notebook")!.y).toBeGreaterThan(map.get("AP")!.y);expect(new Set(positions.map(p=>`${p.x},${p.y}`)).size).toBe(positions.length);
    expect(hierarchyLayout({...s,devices:devices.map(d=>({...d,...map.get(d.name)}))})).toEqual([]);
  });
});

test("multiple routers preserve independent cascade depths",()=>{const devices=[['R1','router'],['R2','router'],['S1','switch'],['S2','switch'],['S3','switch'],['S4','switch']].map(([name,category])=>({name:name!,category:category as DeviceObservation['category'],model:name!,className:'',x:0,y:0,powered:true,ports:[]}));const links=[['R1','R2'],['R1','S1'],['S1','S2'],['R2','S3'],['S3','S4']].map(([a,b])=>({aDevice:a!,aPort:'p',bDevice:b!,bPort:'p'}));const moves=hierarchyLayout({capturedAt:'test',devices,links})!;const byName=new Map(moves.map(m=>[m.name,m]));expect(byName.get('R1')!.y).toBe(byName.get('R2')!.y);expect(byName.get('S2')!.y).toBeGreaterThan(byName.get('S1')!.y);expect(byName.get('S4')!.y).toBeGreaterThan(byName.get('S3')!.y);});
