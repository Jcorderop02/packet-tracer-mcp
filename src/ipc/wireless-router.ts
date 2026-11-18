import { jsStr } from "./escape.js";
import { nativeDevice } from "./integration-common.js";

export const WAN_MODES = { dhcp: 0, pppoe: 1, static: 2 } as const;
export function readWrtJs(device: string): string {
  return nativeDevice(device, `if(typeof d.getInternetConnectionType!=="function")return "ERR:not_wireless_router";var wan=d.getPort("Internet"),lan=d.getPort("Vlan1");var dh=d.getProcess("DhcpServerProcess");return JSON.stringify({mode:Number(d.getInternetConnectionType()),gateway:String(d.getDefaultGateway()),wan:{ip:String(wan.getIpAddress()),mask:String(wan.getSubnetMask()),dhcp:wan.isDhcpClientOn()},lan:{ip:String(lan.getIpAddress()),mask:String(lan.getSubnetMask())},dhcpEnabled:dh.isEnable()});`);
}
export function configureWrtJs(args: {device: string; wanMode?: keyof typeof WAN_MODES; wanIp?: string; wanMask?: string; gateway?: string; dns?: string; lanIp?: string; lanMask?: string; dhcpEnabled?: boolean}): string {
  const c: string[] = ['if(typeof d.getInternetConnectionType!=="function")return "ERR:not_wireless_router";var wan=d.getPort("Internet"),lan=d.getPort("Vlan1");'];
  if (args.wanMode !== undefined) c.push(`d.setInternetConnectionType(${WAN_MODES[args.wanMode]});wan.setDhcpClientFlag(${args.wanMode === "dhcp"});`);
  if (args.wanIp && args.wanMask) c.push(`wan.setIpSubnetMask(${jsStr(args.wanIp)},${jsStr(args.wanMask)});`);
  if (args.gateway !== undefined) c.push(`d.setDefaultGateway(${jsStr(args.gateway)});`);
  if (args.dns !== undefined) c.push(`wan.setDnsServerIp(${jsStr(args.dns)});`);
  if (args.lanIp && args.lanMask) c.push(`lan.setIpSubnetMask(${jsStr(args.lanIp)},${jsStr(args.lanMask)});`);
  if (args.dhcpEnabled !== undefined) c.push(`d.getProcess("DhcpServerProcess").setEnable(${args.dhcpEnabled});`);
  return nativeDevice(args.device, c.join("") + 'return "OK";');
}
