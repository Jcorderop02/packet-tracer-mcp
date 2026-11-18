import type { Bridge } from "../bridge/http-bridge.js";
import { jsStr } from "./escape.js";
import { nativeDevice } from "./integration-common.js";

export function readWirelessJs(device: string): string {
  return nativeDevice(device, `var w=d.getProcess("WirelessClientProcess");if(!w)return "ERR:no_wireless_client";var p=null;for(var i=0;i<d.getPortCount();i++){var x=d.getPortAt(i);if(x.isWirelessPort()){p=x;break;}}if(!p)return "ERR:no_wireless_port";var mac=String(w.getCurrentApMac()),aps=[];var net=ipc.network();for(var j=0;j<net.getDeviceCount();j++){var a=net.getDeviceAt(j);try{var s=a.getProcess("WirelessServerProcess"),rp=s.getPort();if(String(rp.getMacAddress()).toLowerCase()===mac.toLowerCase())aps.push(a.getName());}catch(e){}}return JSON.stringify({ssid:String(w.getSsid()),apMac:mac,accessPoints:aps,associated:!!p.getLink()&&aps.length>0,port:p.getName(),ip:String(p.getIpAddress()),mask:String(p.getSubnetMask()),dhcp:p.isDhcpClientOn()});`);
}
export function installWirelessJs(device: string, replace: boolean): string {
  return nativeDevice(device,
    `if(!/laptop|notebook/i.test(String(d.getModel())))return "ERR:not_notebook";` +
    `if(d.getPort("Wireless0"))return "OK:already_installed";` +
    `var root=d.getRootModule(),old=root.getModuleAt(0);` +
    `if(old&&!${replace})return "ERR:slot_occupied:pass_replace_true";` +
    `var oldName=old?String(old.getModuleNameAsString()||""):"",power=d.getPower();` +
    `if(old&&!oldName)return "ERR:original_module_unknown";` +
    `try{` +
      `d.setPower(false);` +
      `if(old)root.removeModuleAt(0);` +
      `try{` +
        `root.addModuleAt("Linksys-WPC300N",0);` +
        `if(d.getPort("Wireless0"))return "OK:installed";` +
      `}catch(e){}` +
      `try{` +
        `if(root.getModuleAt(0))root.removeModuleAt(0);` +
        `if(oldName&&!root.addModuleAt(oldName,0))return "ERR:original_module_restore_failed";` +
      `}catch(e){return "ERR:original_module_restore_failed:"+e;}` +
      `return "ERR:wireless_module_not_installed";` +
    `}finally{d.setPower(power);}`
  );
}
export function associateDefaultJs(device: string): string {
  return nativeDevice(device, `var w=d.getProcess("WirelessClientProcess");if(!w||!d.getPort("Wireless0"))return "ERR:no_wireless_adapter";if(!d.getPower())return "ERR:client_powered_off";var profile=w.getCurrentProfile();if(String(profile.ssid)!=="Default")return "ERR:current_profile_not_Default";w.setSsid("Default");w.setNetworkType(7);try{d.setPower(false);}finally{d.setPower(true);}return "OK:association_requested";`);
}

export interface WirelessAssociation {
  readonly associated: boolean;
  readonly accessPoints: readonly string[];
  readonly ip: string;
  readonly dhcp: boolean;
}

export async function readWirelessAssociation(bridge: Bridge, device: string): Promise<WirelessAssociation> {
  return JSON.parse(await wirelessCall(bridge, readWirelessJs(device))) as WirelessAssociation;
}

export async function associateOpenDefault(bridge: Bridge, device: string, ap: string): Promise<WirelessAssociation> {
  const state = JSON.parse(await wirelessCall(bridge, nativeDevice(ap, `
    var w=d.getProcess("WirelessServerProcess");
    if(!w)return "ERR:no_ap_radio";
    return JSON.stringify({ssid:String(w.getSsid()),encryption:Number(w.getEncryptType())});
  `))) as {ssid: string; encryption: number};
  if (state.ssid !== "Default" || state.encryption !== 0) {
    throw new Error("AP must already advertise open Default (encryption=0).");
  }
  const initial = await readWirelessAssociation(bridge, device);
  if (initial.associated && initial.accessPoints.includes(ap)) return initial;

  await wirelessCall(bridge, associateDefaultJs(device));
  const deadline = Date.now() + 30_000;
  do {
    const current = await readWirelessAssociation(bridge, device);
    if (current.associated && current.accessPoints.includes(ap)) return current;
    await Bun.sleep(500);
  } while (Date.now() < deadline);
  throw new Error(`Association not confirmed with ${ap}`);
}

async function wirelessCall(bridge: Bridge, code: string): Promise<string> {
  const reply = await bridge.sendAndWait(code, {timeoutMs: 15_000});
  if (reply === null || /^(?:ERR|ERROR):/.test(reply)) throw new Error(reply ?? "Wireless IPC timed out");
  return reply;
}
