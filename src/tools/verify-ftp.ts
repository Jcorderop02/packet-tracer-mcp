import { z } from "zod";
import { isIP } from "node:net";
import { jsStr } from "../ipc/escape.js";
import { nativeDevice } from "../ipc/integration-common.js";
import { withCliLock } from "../ipc/reliable-cli.js";
import { errorResult, requireConnectedBridge, textResult } from "./helpers.js";
import { nativeCall } from "./integration-common.js";
import type { ToolModule } from "./types.js";

export function ftpGreeting(output: string, address: string): string | undefined {
  const lines = output.split(/\r?\n/);
  if (!lines.some(line => line.trim().toLowerCase() === `connected to ${address}`.toLowerCase())) return;
  return lines.find(line => /^\s*220(?:[-\s]|$)/.test(line))?.trim();
}

const desktopPrompt = "C:\\>";

export const registerVerifyFtpTool: ToolModule = ({ bridge, server }) => {
  server.tool("pt_verify_ftp", "Check the FTP welcome banner from a Server-PT using a simulated PC. Closes the session at the login prompt.", {
    client: z.string().min(1), server: z.string().min(1),
    timeout_ms: z.number().int().min(1000).max(15_000).default(8000),
  }, async args => {
    const blocked = requireConnectedBridge(bridge);
    if (blocked) return blocked;
    return withCliLock(bridge, args.client, async () => {
      try {
        const { address, offset } = JSON.parse(await nativeCall(bridge, nativeDevice(args.client, `
          if(String(d.getModel())!=="PC-PT")return "ERR:expected_pc_pt";
          var cl=d.getCommandLine(),target=ipc.network().getDevice(${jsStr(args.server)});
          if(!target||String(target.getModel())!=="Server-PT")return "ERR:expected_server_pt";
          var f=target.getProcess("FtpServer");
          if(!f||!f.isEnabled())return "ERR:ftp_disabled";
          if(String(cl.getPrompt())!==${jsStr(desktopPrompt)})return "ERR:pc_command_prompt_busy";
          var p=target.getPort("FastEthernet0");
          return JSON.stringify({address:String(p.getIpAddress()),offset:String(cl.getOutput()).length});
        `))) as { address: string; offset: number };
        if (isIP(address) !== 4 || address === "0.0.0.0") return errorResult("Server has no IPv4 address.");
        const command = (body: string) => nativeCall(bridge, nativeDevice(args.client, "var cl=d.getCommandLine();" + body));
        let banner: string | undefined, failure: string | undefined;
        let restored = false;
        try {
          await command(`cl.enterCommand(${jsStr(`ftp ${address}`)});return "OK";`);
          const deadline = Date.now() + args.timeout_ms;
          do {
            const output = await command(`return String(cl.getOutput()).slice(${offset});`);
            banner = ftpGreeting(output, address);
            if (banner || /connection (?:refused|timed out)|could not connect/i.test(output)) break;
            await Bun.sleep(250);
          } while (Date.now() < deadline);
          if (!banner) failure = "FTP greeting was not observed.";
        } catch (error) {
          failure = String(error);
        } finally {
          try {
            restored = await command('cl.enterCommand(String.fromCharCode(3));return String(cl.getPrompt());') === desktopPrompt;
          } catch (error) {
            failure = [failure, String(error)].filter(Boolean).join(" ");
          }
        }
        return (banner && restored && !failure ? textResult : errorResult)(JSON.stringify({
          address, banner: banner ?? null, restored,
          ...(!restored ? { error: [failure, "PC prompt restoration could not be verified."].filter(Boolean).join(" ") }
            : failure ? { error: failure } : {}),
        }));
      } catch (error) {
        return errorResult(String(error));
      }
    });
  });
};
