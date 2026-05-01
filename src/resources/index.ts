/**
 * MCP Resources exposed by packet-tracer-mcp.
 *
 * The handshake `instructions` field travels in every `initialize` call but
 * fills the LLM's context on every turn — so we keep it short and put the
 * long-form playbook in resources. Clients that fetch resources eagerly
 * (Claude Desktop, Cursor) will surface them automatically; clients that
 * don't will still see them when the LLM calls `resources/read` after
 * being pointed at them by SERVER_INSTRUCTIONS.
 *
 * Static text — read from disk on first request, cached in-memory. We could
 * embed the strings at build time but that would mean a rebuild every time
 * AGENTS.md changes; runtime read keeps the docs editable.
 */

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

// Resolve once at module load: ../../ from src/resources/index.ts is the
// project root, where AGENTS.md sits. Works for both `bun src/index.ts`
// (file URL points into the source tree) and a published npm package
// (because we ship AGENTS.md alongside src/ — see package.json `files`).
const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(HERE, "..", "..");
const AGENTS_PATH = resolve(PROJECT_ROOT, "AGENTS.md");

const cache = new Map<string, string>();

async function readCached(path: string, fallback: string): Promise<string> {
  if (cache.has(path)) return cache.get(path)!;
  try {
    const text = await readFile(path, "utf-8");
    cache.set(path, text);
    return text;
  } catch {
    return fallback;
  }
}

const WIRING_CONVENTIONS = `# Cabling conventions for packet-tracer-mcp

| Link kind                                       | Cable     | Interfaces                          |
| ----------------------------------------------- | --------- | ----------------------------------- |
| Router ↔ Switch (office LAN)                    | straight  | GigabitEthernet ↔ Gigabit/Fast      |
| Switch ↔ PC / Server                            | straight  | Fast/GigabitEthernet                |
| Router ↔ Router via shared LAN switch           | straight  | GigabitEthernet (both via switch)   |
| **Router ↔ Router via WAN exterior P2P**        | **serial**| **Serial0/1/0** (needs HWIC-2T)     |
| Switch ↔ Switch trunk                           | cross     | GigabitEthernet                     |

## Decision rule

If the brief mentions any of these, it's a SERIAL WAN link:
  - "public addressing /30"
  - "ISP", "Internet provider", "WAN"
  - "punto a punto público" / "linea WAN"
  - red lines between routers crossing an Internet cloud in the diagram

Otherwise it's a Gigabit LAN link.

## ISR routers and serial ports

ISR1941 / 2901 / 2911 / ISR4321 / ISR4331 ship with NO serial ports.
Before pt_create_link with cable="serial", call pt_add_module with
HWIC-2T on each router. Otherwise the link will fail or PT will pick
an Ethernet port silently.

## Direct router↔router straight Gigabit

\`pt_create_link\` will REFUSE this combination unless you pass
\`confirm_internal_lan: true\`. The flag is a forcing function: by
declaring "yes, I know they're both routers and I want straight
Gigabit", you confirm this is an internal LAN segment, not a WAN
link. If it's WAN, switch to serial instead.
`;

const TOPOLOGY_PATTERNS = `# Topology patterns: user LANs vs transit LANs

A frequent academic-brief pattern looks like this:

  LAN1, LAN2  → office A user LANs (switch + PCs colgando)
  LAN3        → transit segment between R1 and R2 (same office)
                ONLY a switch between the routers, NO PCs
  LAN4        → transit segment between R3 and R4 (same office)
                ONLY a switch, NO PCs
  LAN5, LAN6  → office B user LANs (switch + PCs colgando)

The phrase "all LANs with the same addressing capacity" refers to the
prefix length (e.g., all /23), NOT to having user endpoints. Don't add
PCs to a LAN unless the brief or the diagram explicitly shows them.

## How to tell user from transit

| Signal in brief / diagram                      | Likely role |
| ---------------------------------------------- | ----------- |
| LAN appears between two routers same office    | transit     |
| LAN appears under one router only              | user        |
| Diagram shows PCs / hosts hanging from switch  | user        |
| Diagram shows nothing but the switch           | transit     |
| Brief lists hosts (PC1, PC2…) for that LAN     | user        |

When ambiguous: ask the user.

## Recommended workflow

1. pt_clear_canvas              (start clean if needed)
2. pt_plan_review               (declare your plan, get warnings BEFORE
                                  touching the canvas, present to user)
3. pt_add_device × N            (no x/y — let the grid place)
4. pt_add_module HWIC-2T × M    (where serial is needed)
5. pt_create_link × K           (per cabling conventions)
6. pt_auto_layout               (re-grid topology-aware)
7. pt_run_cli_bulk              (IP / hostname / interfaces)
8. pt_apply_advanced_routing    (EIGRP/OSPF/BGP)
9. pt_save_pkt                  (persist)
`;

const VOICE_CME_CONVENTION = `# Voice / CME convention for packet-tracer-mcp

End-to-end recipe for an IP-Phone (Cisco 7960) registering against a CME
router with VLAN segmentation and DHCP-assigned addressing. PT 9 has
several non-obvious gotchas — this resource documents the verified path.

## 1. License the router for CME

CME (telephony-service) is gated behind the **uck9** technology package.
Stock 2900-series routers boot with **ipbasek9**, where the CLI parser
does NOT expose \`telephony-service\`, \`ephone-dn\`, or \`ephone\`.
Activate uck9 first and reload:

\`\`\`
license boot module c2900 technology-package uck9
write memory
reload
\`\`\`

After the reload, \`telephony-service\` becomes a configurable mode.
Without this step, every \`pt_apply_voip\` call against a fresh router
silently no-ops because the parser rejects the entry-point command.

## 2. Voice + data VLAN trunk to the access switch

Use \`pt_apply_switching\` to create both VLANs and a trunk uplink. Then
use \`pt_configure_subinterface\` (this server) to create one router
subinterface per VLAN with **encapsulation dot1Q** and the gateway IP:

  - Parent: GigabitEthernet0/0 (or whichever uplink lands on the switch)
  - Subinterface .DATA  → VLAN 10, gateway 192.168.10.1/24
  - Subinterface .VOICE → VLAN 20, gateway 192.168.20.1/24

The parent interface MUST be brought up (\`no shutdown\`) — PT 9 routers
ship with all GE interfaces administratively down, and subinterfaces
inherit the parent's L1 state.

## 3. Voice VLAN on the switch access port

For each access port that connects to an IP Phone, set the voice VLAN
and trust the phone's CDP/QoS markings. Use \`pt_apply_voip\` with
\`voiceVlans\` (NOT a separate tool — \`pt_apply_voip\` already covers it):

\`\`\`json
{ "voiceVlans": [{
    "switch": "SW1",
    "port": "FastEthernet0/1",
    "voiceVlanId": 20,
    "dataVlanId": 10,
    "trustCiscoPhone": true
}]}
\`\`\`

This emits \`switchport voice vlan 20\`, \`switchport access vlan 10\`,
and \`mls qos trust device cisco-phone\` on the access port.

## 4. DHCP option-150 must come from the ROUTER, not Server-PT

PT 9 Server-PT exposes \`network/subnet/gateway/dns/domain-name\` setters
but NOT \`option 150\` (the TFTP server pointer that Cisco IP Phones
need). The setter does not exist in the JS API. There are two options:

- **Recommended**: put the DHCP server on the CME router itself, where
  IOS lets us emit \`option 150 ip <ip>\` inside the pool. Use
  \`pt_apply_services\` with \`dhcpPools[].tftpServer\`.
- **Alternative**: keep DHCP on Server-PT and configure option-150
  manually through the GUI (the GUI exposes a "TFTP" field that the
  JS API does not). Out of scope for autonomous deploys.

Without option-150, the phone boots, gets an IP, but never finds its
SEPxxxx.cnf.xml on the CME and never registers.

## 5. Telephony-service + ephone-dn + ephone

Once steps 1-4 are in place, \`pt_apply_voip\` provisions the CME body:

\`\`\`json
{
  "cme": [{ "device": "CME1", "maxEphones": 4, "maxDn": 4,
            "sourceIp": "192.168.20.1", "autoAssign": { "first": 1, "last": 4 } }],
  "ephoneDns": [
    { "device": "CME1", "dnTag": 1, "number": "1001" },
    { "device": "CME1", "dnTag": 2, "number": "1002" }
  ],
  "ephones": [
    { "device": "CME1", "ephoneNumber": 1, "mac": "0000.0000.0001",
      "buttons": [1] }
  ]
}
\`\`\`

The MAC must match the phone's actual MAC (visible via
\`pt_query_topology\` after the phone is added with model \`7960\`).

## 6. Wire the IP Phone

7960 phones expose three port names but only **\`Port 0\`** is wirable
through \`pt_create_link\`. Use:

\`\`\`json
{ "aDevice": "SW1", "aPort": "FastEthernet0/1",
  "bDevice": "Phone1", "bPort": "Port 0", "cable": "straight" }
\`\`\`

The other port names (\`Switch\`, \`PC\`) accept getPort() lookups but
createLink fails on them — a PT 9 quirk. The phone's PC pass-through
port can carry a daisy-chained workstation; that link goes through
\`Port 0\` of the PC, not the phone.

## 7. Verify

After all steps:

  - \`pt_run_cli\` on CME1: \`show ephone\` should list each phone with
    state \`IN_USE\` (or \`REGISTERING\` if the boot is in flight).
  - \`pt_run_cli\` on the IP Phone (yes, phones have a tiny CLI in PT):
    \`show tftp\` should resolve to the CME router's interface IP.
  - The phone's display in the GUI should show its assigned extension.

If the phone shows "Configuring CM list" indefinitely: option-150 is
missing or pointing at an unreachable IP. If the phone shows the
extension but calls do not connect: check \`ephone-dn\` numbers don't
collide and that \`auto assign\` covered the ephone tag.
`;

export function registerResources(server: McpServer): void {
  server.registerResource(
    "agents-guide",
    "pt://docs/agents",
    {
      title: "Agent guide for packet-tracer-mcp",
      description:
        "Operational playbook for LLMs using this server. READ THIS FIRST when a new conversation starts: cabling conventions, user vs transit LANs, recommended workflow, silent-failure patterns, escape hatches, debugging checklist.",
      mimeType: "text/markdown",
    },
    async (uri) => ({
      contents: [{
        uri: uri.href,
        mimeType: "text/markdown",
        text: await readCached(AGENTS_PATH, "AGENTS.md not bundled with this distribution."),
      }],
    }),
  );

  server.registerResource(
    "wiring-conventions",
    "pt://convention/wiring",
    {
      title: "Cabling conventions",
      description:
        "When to use straight Gigabit (LAN), serial (WAN exterior P2P), and cross (switch trunk). Includes the HWIC-2T requirement for ISR routers.",
      mimeType: "text/markdown",
    },
    async (uri) => ({
      contents: [{
        uri: uri.href,
        mimeType: "text/markdown",
        text: WIRING_CONVENTIONS,
      }],
    }),
  );

  server.registerResource(
    "topology-patterns",
    "pt://convention/topology-patterns",
    {
      title: "User LANs vs transit LANs",
      description:
        "How to interpret an academic brief / diagram: which LANs carry user endpoints, which are routing transit segments, and the recommended end-to-end build workflow.",
      mimeType: "text/markdown",
    },
    async (uri) => ({
      contents: [{
        uri: uri.href,
        mimeType: "text/markdown",
        text: TOPOLOGY_PATTERNS,
      }],
    }),
  );

  server.registerResource(
    "voice-cme-convention",
    "pt://convention/voice-cme",
    {
      title: "Voice / CME end-to-end convention",
      description:
        "Recipe for an IP-Phone (7960) registering against a CME router with VLAN segmentation: license uck9 + reload, dot1Q subinterfaces, voice VLAN trust, DHCP option-150 from the router (Server-PT cannot do it), telephony-service block, and wiring through 'Port 0'.",
      mimeType: "text/markdown",
    },
    async (uri) => ({
      contents: [{
        uri: uri.href,
        mimeType: "text/markdown",
        text: VOICE_CME_CONVENTION,
      }],
    }),
  );
}
