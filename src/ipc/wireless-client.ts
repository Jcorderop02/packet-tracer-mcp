import { jsStr } from "./escape.js";
import { nativeDevice } from "./integration-common.js";

export function readWirelessJs(device: string): string {
  return nativeDevice(device, `var w=d.getProcess("WirelessClientProcess");if(!w)return "ERR:no_wireless_client";var p=null;for(var i=0;i<d.getPortCount();i++){var x=d.getPortAt(i);if(x.isWirelessPort()){p=x;break;}}if(!p)return "ERR:no_wireless_port";var mac=String(w.getCurrentApMac()),aps=[];var net=ipc.network();for(var j=0;j<net.getDeviceCount();j++){var a=net.getDeviceAt(j);try{var s=a.getProcess("WirelessServerProcess"),rp=s.getPort();if(String(rp.getMacAddress()).toLowerCase()===mac.toLowerCase())aps.push(a.getName());}catch(e){}}return JSON.stringify({ssid:String(w.getSsid()),apMac:mac,accessPoints:aps,associated:!!p.getLink()&&aps.length>0,port:p.getName(),ip:String(p.getIpAddress()),mask:String(p.getSubnetMask()),dhcp:p.isDhcpClientOn(),profile:w.getCurrentProfile()});`);
}
export function installWirelessJs(device: string, replace: boolean): string {
  return nativeDevice(device, `if(!/laptop|notebook/i.test(String(d.getModel())))return "ERR:not_notebook";try{if(d.getPort("Wireless0"))return "OK:already_installed";}catch(e){}var root=d.getRootModule(),old=root.getModuleAt(0);if(old&&!${replace})return "ERR:slot_occupied:pass_replace_true";var power=d.getPower();try{d.setPower(false);if(old)root.removeModuleAt(0);root.addModuleAt("Linksys-WPC300N",0);if(!d.getPort("Wireless0"))return "ERR:wireless_module_not_installed";}finally{d.setPower(power);}return "OK:installed";`);
}
export function associateDefaultJs(device: string): string {
  return nativeDevice(device, `var w=d.getProcess("WirelessClientProcess");if(!w||!d.getPort("Wireless0"))return "ERR:no_wireless_adapter";if(!d.getPower())return "ERR:client_powered_off";var profile=w.getCurrentProfile();if(String(profile.ssid)!=="Default")return "ERR:current_profile_not_Default";w.setSsid("Default");w.setNetworkType(7);try{d.setPower(false);}finally{d.setPower(true);}return "OK:association_requested";`);
}
