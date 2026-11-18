import { jsStr } from "./escape.js";

export function nativeDevice(device: string, body: string): string {
  return `(function(){var d=ipc.network().getDevice(${jsStr(device)});if(!d)return "ERR:not_found";try{${body}}catch(e){return "ERROR:"+String(e);}})()`;
}
