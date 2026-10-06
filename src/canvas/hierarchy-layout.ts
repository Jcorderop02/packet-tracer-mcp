import type { CanvasSnapshot } from "./types.js";
/** Multi-source spanning forest for cascaded LANs. Simple transit topologies
 * continue to use the existing layout policy. Cyclic/shared edges may cross. */
export function hierarchyLayout(snapshot: CanvasSnapshot): {name:string;x:number;y:number}[] | null {
  const roots=snapshot.devices.filter(d=>["router","wirelessrouter","homerouter","firewall"].includes(d.category??""));
  if(!roots.length)return null;
  roots.sort((a,b)=>a.x-b.x||a.name.localeCompare(b.name));
  const devices=new Map(snapshot.devices.map(d=>[d.name,d]));
  const adj=new Map(snapshot.devices.map(d=>[d.name,new Set<string>()]));
  for(const l of snapshot.links){if(adj.has(l.aDevice)&&adj.has(l.bDevice)){adj.get(l.aDevice)!.add(l.bDevice);adj.get(l.bDevice)!.add(l.aDevice);}}
  const isSwitch=(name:string)=>["switch","multilayerswitch"].includes(devices.get(name)?.category??"");
  const isAp=(name:string)=>["accesspoint","ap"].includes(devices.get(name)?.category??"");
  const cascade=snapshot.links.some(l=>isSwitch(l.aDevice)&&isSwitch(l.bDevice) || isAp(l.aDevice)&&!isSwitch(l.bDevice)&&!roots.some(r=>r.name===l.bDevice) || isAp(l.bDevice)&&!isSwitch(l.aDevice)&&!roots.some(r=>r.name===l.aDevice));
  if(!cascade)return null;
  const visited=new Set<string>(),children=new Map<string,string[]>(),depths=new Map<string,number>(),forest:string[]=[];
  const grow=(seeds:string[])=>{
    const queue=[...seeds];
    for(const root of seeds){forest.push(root);visited.add(root);depths.set(root,0);}
    for(let q=0;q<queue.length;q++){
      const parent=queue[q]!,kids=[...(adj.get(parent)??[])].sort().filter(n=>!visited.has(n));children.set(parent,kids);
      for(const k of kids){visited.add(k);depths.set(k,depths.get(parent)!+1);queue.push(k);}
    }
  };
  grow(roots.map(r=>r.name));
  for(const name of [...devices.keys()].sort())if(!visited.has(name))grow([name]);
  const widths=new Map<string,number>();
  const width=(name:string):number=>{const kids=children.get(name)??[];const w=kids.length?kids.reduce((sum,k)=>sum+width(k),0)+(kids.length-1)*60:100;widths.set(name,w);return w;};
  for(const root of forest)width(root);
  const placements:{name:string;x:number;y:number}[]=[];
  const place=(name:string,left:number)=>{const w=widths.get(name)!;const x=Math.round(left+w/2),y=100+depths.get(name)!*160;const d=devices.get(name)!;if(d.x!==x||d.y!==y)placements.push({name,x,y});let cursor=left;for(const k of children.get(name)??[]){place(k,cursor);cursor+=widths.get(k)!+60;}};
  let cursor=100;for(const root of forest){place(root,cursor);cursor+=widths.get(root)!+160;}
  return placements;
}
