import { jsStr } from "./escape.js";
import { nativeDevice } from "./integration-common.js";

export function readEndpointJs(device: string): string {
  return nativeDevice(device, `var ports=[];for(var i=0;i<d.getPortCount();i++){var p=d.getPortAt(i);ports.push({name:p.getName(),ip:String(p.getIpAddress()),mask:String(p.getSubnetMask()),dhcp:p.isDhcpClientOn(),linked:!!p.getLink()});}return JSON.stringify({device:d.getName(),ports:ports});`);
}
