/**
 * Numeric IDs that the Packet Tracer 9.0 IPC tree expects when calling
 * `LogicalWorkspace.addDevice(typeId, model, x, y)` and
 * `LogicalWorkspace.createLink(d1, p1, d2, p2, cableTypeId)` from JS.
 *
 * These mirror the ConnectType / DeviceType enums of the Java SDK
 * (`pt-cep-java-framework-9.0.0.0.jar`) and were verified against a live
 * PT 9.0 Script Engine instance.
 */

/**
 * Device type IDs covered by the MCP catalog. Verified against the live PT 9.0
 * `DeviceFactory` enumeration via `scripts/probe-device-catalog.ts`
 * (2026-04-29). The complete enumeration in PT 9 stock has more types
 * (37+) but several map to specialty devices the MCP does not expose yet
 * (firewalls/WLCs/Meraki/IoT sensors). When adding a new category, place
 * it next to its numeric neighbours and verify the ID by listing the model
 * in the probe dump (`docs/probe-runs/device-catalog-*.md`).
 */
export const DEVICE_TYPE_ID = {
  router: 0,
  switch: 1,
  cloud: 2,
  bridge: 3,
  hub: 4,
  repeater: 5,
  accesspoint: 7,
  pc: 8,
  server: 9,
  printer: 10,
  wirelessrouter: 11,
  ipphone: 12,
  // 13/14 = generic PT modems. PT classifies DSL-Modem-PT as `tv` and
  // Cable-Modem-PT as `remote` (probe categories) for legacy reasons; we
  // use those names to keep parity with the probe dump.
  tv: 13,
  remote: 14,
  multilayerswitch: 16,
  laptop: 18,
  tablet: 19,
  pda: 20,
  // 23 = smartphone (probe labels TV-PT under `smartphone`, original PT
  // taxonomy oddity). 24 = iot (Home-VoIP-PT). 25 = tdm (Analog-Phone-PT).
  smartphone: 23,
  iot: 24,
  tdm: 25,
  // 27 = ASA firewalls. 30 = HomeRouter-PT-AC (consumer-grade wireless
  // router separate from `wirelessrouter`/Linksys).
  firewall: 27,
  homerouter: 30,
} as const satisfies Record<string, number>;

export type DeviceCategory = keyof typeof DEVICE_TYPE_ID;

export const CABLE_TYPE_ID = {
  straight: 8100,
  cross: 8101,
  fiber: 8103,
  console: 8108,
  coaxial: 8110,
  serial: 8106,
} as const satisfies Record<string, number>;

export type CableKind = keyof typeof CABLE_TYPE_ID;
