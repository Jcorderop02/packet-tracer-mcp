import { jsStr } from "./escape.js";
import { nativeDevice } from "./integration-common.js";

export function readDhcpJs(device: string, port = "FastEthernet0", includeLeases = false): string {
  return nativeDevice(device, `var mp=d.getProcess("DhcpServerMainProcess");if(!mp)return "ERR:no_dhcp_service";var sp=mp.getDhcpServerProcessByPortName(${jsStr(port)});if(!sp)return "ERR:port_not_found";var pools=[];for(var i=0;i<sp.getPoolCount();i++){var p=sp.getPoolAt(i);var leases=[],leaseError=null;${includeLeases ? `for(var j=0;j<Math.min(1024,p.getMaxUsers());j++){try{var l=p.getLeaseAt(j);if(l&&String(l.ipAddress)!=="0.0.0.0")leases.push({ip:String(l.ipAddress),mac:String(l.macAddress),leaseTime:Number(l.leaseTime),port:String(l.port)});}catch(e){leaseError=String(e);break;}}` : ""}pools.push({name:p.getDhcpPoolName(),network:String(p.getNetworkAddress()),subnetMask:String(p.getSubnetMask()),defaultRouter:String(p.getDefaultRouter()),dnsServer:String(p.getDnsServerIp()),startIp:String(p.getStartIp()),endIp:String(p.getEndIp()),maxUsers:p.getMaxUsers(),leases:leases,leaseError:leaseError});}return JSON.stringify({enabled:sp.isEnable(),pools:pools});`);
}
