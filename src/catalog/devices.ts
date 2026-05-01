import type { DeviceCategory } from "../ipc/constants.js";

export interface PortSpec {
  readonly fullName: string;
  /**
   * Hint of the underlying physical layer. Catalog values seen in PT 9
   * stock: classic Ethernet families, Serial WAN, Modem (analog dial-up
   * + telco), Coaxial (cable DOCSIS), and Wireless (radio interfaces
   * exposed as cableable on Linksys/HomeRouter/AP-PT-AC). The hint is
   * informational — `pt_create_link` ultimately picks the cable type
   * via `CABLE_TYPE_ID`, not via this field.
   */
  readonly speed:
    | "GigabitEthernet"
    | "FastEthernet"
    | "Serial"
    | "Ethernet"
    | "Wireless"
    | "Modem"
    | "Coaxial"
    | "Cellular";
}

/**
 * Initial CLI personality of a freshly-placed device. Drives probe/automation
 * behaviour:
 *   - "ios"     → standard Cisco IOS prompt (Router>/Switch>) ready out of
 *                 the box. Default when omitted.
 *   - "rommon"  → device boots into ROM Monitor (e.g. PT8200 transponder).
 *                 IOS commands are unavailable; the CLI subset probe should
 *                 skip these instead of marking them FAIL.
 *   - "pnp"     → IOS XE 17.x device that blocks every command behind a
 *                 mandatory `Enter enable secret:` prompt on first boot
 *                 (IR1101, IR8340, IE-9320). Probes must inject a strong
 *                 password before running the standard battery, otherwise
 *                 every command is silently consumed by the password prompt
 *                 and falsely classified as accepted.
 */
export type DeviceCliMode = "ios" | "rommon" | "pnp";

export interface DeviceModel {
  readonly ptType: string;
  readonly category: DeviceCategory;
  readonly displayName: string;
  readonly ports: readonly PortSpec[];
  readonly cliMode?: DeviceCliMode;
}

const gig = (slot: string): PortSpec => ({ fullName: `GigabitEthernet${slot}`, speed: "GigabitEthernet" });
const fast = (slot: string): PortSpec => ({ fullName: `FastEthernet${slot}`, speed: "FastEthernet" });
const eth = (slot: string): PortSpec => ({ fullName: `Ethernet${slot}`, speed: "Ethernet" });

// 2960-class switch: 24 Fast + 2 Gig uplinks. Verified by
// device-instantiation 2026-04-29_102904 — 2960-24TT, 2950T-24 and
// 3560-24PS share this port layout (24× Fa0/N + 2× Gi0/1..2). 2950-24 uses
// the 24-FE variant below (no Gig uplinks).
const switchPorts2960 = (): PortSpec[] => {
  const out: PortSpec[] = [];
  for (let i = 1; i <= 24; i++) out.push(fast(`0/${i}`));
  out.push(gig("0/1"), gig("0/2"));
  return out;
};
const switchPorts2950 = (): PortSpec[] => {
  const out: PortSpec[] = [];
  for (let i = 1; i <= 24; i++) out.push(fast(`0/${i}`));
  return out;
};
// 3650-class multilayer: 24× Gi1/0/N (downstream) + 4× Gi1/1/N (network module).
// Verified by device-instantiation 2026-04-29_102904 — NO FastEthernet ports
// on this chassis, all Gigabit. Different from 2960/3560 layout.
const switchPorts3650 = (): PortSpec[] => {
  const out: PortSpec[] = [];
  for (let i = 1; i <= 24; i++) out.push(gig(`1/0/${i}`));
  for (let i = 1; i <= 4; i++) out.push(gig(`1/1/${i}`));
  return out;
};
// IE-9320: 28× Gi1/0/N. Verified by instantiation probe.
const switchPortsIE9320 = (): PortSpec[] => {
  const out: PortSpec[] = [];
  for (let i = 1; i <= 28; i++) out.push(gig(`1/0/${i}`));
  return out;
};

// Catalog organised in three tiers. Models with verified port counts come
// from `scripts/probe-modules-by-pattern.ts` (2026-04-29) where portsPre on a
// fresh device matched the documented Cisco baseline. Models without a probe
// run use the published Cisco datasheet port count and are marked accordingly.
const MODELS: DeviceModel[] = [
  // Routers — ISR G1 (FE-class). Module bay paths: HWIC at "0/1", NM at "1".
  { ptType: "1841",        category: "router", displayName: "Cisco 1841",        ports: [fast("0/0"), fast("0/1")] },
  { ptType: "2620XM",      category: "router", displayName: "Cisco 2620XM",      ports: [fast("0/0")] },
  { ptType: "2621XM",      category: "router", displayName: "Cisco 2621XM",      ports: [fast("0/0"), fast("0/1")] },
  { ptType: "2811",        category: "router", displayName: "Cisco 2811",        ports: [fast("0/0"), fast("0/1")] },

  // Routers — ISR G2 (GE-class). HWIC bays at "0/N" on chassis sub-module.
  { ptType: "1941",        category: "router", displayName: "Cisco 1941",        ports: [gig("0/0"), gig("0/1")] },
  { ptType: "2901",        category: "router", displayName: "Cisco 2901",        ports: [gig("0/0"), gig("0/1")] },
  { ptType: "2911",        category: "router", displayName: "Cisco 2911",        ports: [gig("0/0"), gig("0/1"), gig("0/2")] },

  // Routers — ISR4xxx and PT8200 (NIM-class). Slot 0/0 is BUILTIN, NIM bays
  // start at 0/1. Port counts verified by device-instantiation 2026-04-29:
  // ISR4321=2, ISR4331=3, PT8200=4 physical (each + Vlan1 SVI filtered).
  { ptType: "ISR4321",     category: "router", displayName: "Cisco ISR 4321",    ports: [gig("0/0/0"), gig("0/0/1")] },
  { ptType: "ISR4331",     category: "router", displayName: "Cisco ISR 4331",    ports: [gig("0/0/0"), gig("0/0/1"), gig("0/0/2")] },
  // PT8200 boots into rommon (ROM Monitor), not IOS. CLI subset probe must
  // skip it — IOS commands like `enable`, `configure terminal` are not
  // recognised in rommon. cli-subset-2026-04-29_104353.md FAIL evidence.
  { ptType: "PT8200",      category: "router", displayName: "Cisco PT8200",      ports: [gig("0/0/0"), gig("0/0/1"), gig("0/0/2"), gig("0/0/3")], cliMode: "rommon" },

  // Routers — branch / industrial / fixed-chassis. Port specs promoted from
  // probe-pending using device-instantiation 2026-04-29_102904 (virtuals
  // `Vlan1`, `Cellular0/1`, `wlan-ap0`, `Wlan-GigabitEthernet0`,
  // `VirtualPortGroup0`, `Dot11Radio*` filtered out).
  { ptType: "819HG-4G-IOX", category: "router", displayName: "Cisco 819HG-4G-IOX (4G LTE)", ports: [
    gig("0"), fast("0"), fast("1"), fast("2"), fast("3"),
    { fullName: "Serial0", speed: "Serial" }, eth("1"),
  ] },
  { ptType: "819HGW",       category: "router", displayName: "Cisco 819HGW (wireless)", ports: [
    gig("0"), fast("0"), fast("1"), fast("2"), fast("3"),
    { fullName: "Serial0", speed: "Serial" },
  ] },
  { ptType: "829",          category: "router", displayName: "Cisco 829", ports: [
    gig("0"), gig("1"), gig("2"), gig("3"), gig("4"), gig("5"),
  ] },
  { ptType: "CGR1240",      category: "router", displayName: "Cisco CGR1240 (Connected Grid)", ports: [
    gig("0/1"), fast("2/3"), fast("2/4"), fast("2/5"), fast("2/6"),
    gig("2/1"), gig("2/2"),
  ] },
  // IR1101 / IR8340 ship IOS XE 17.x and force a strong-password enable
  // secret on first boot ("% No defaulting allowed / Enter enable secret:").
  // Without bootstrapping the password, every command is silently consumed
  // by the password prompt — see cli-subset-2026-04-29_104353.md.
  { ptType: "IR1101",       category: "router", displayName: "Cisco IR1101 (Industrial)", cliMode: "pnp", ports: [
    gig("0/0/0"), fast("0/0/1"), fast("0/0/2"), fast("0/0/3"), fast("0/0/4"),
  ] },
  { ptType: "IR8340",       category: "router", displayName: "Cisco IR8340 (Industrial)", cliMode: "pnp", ports: [
    gig("0/0/0"), gig("0/0/1"),
    gig("0/1/0"), gig("0/1/1"), gig("0/1/2"), gig("0/1/3"),
    gig("0/1/4"), gig("0/1/5"), gig("0/1/6"), gig("0/1/7"),
    gig("0/1/8"), gig("0/1/9"), gig("0/1/10"), gig("0/1/11"),
  ] },

  // Routers — generic PT (slot type 3 directly in root, paths "0".."9").
  // Router-PT-Empty has 0 ports baseline; Router-PT ships with 6 pre-installed
  // PT-ROUTER-NM modules (slots 0..5) per the catalog probe.
  { ptType: "Router-PT-Empty", category: "router", displayName: "Generic PT Router (empty)", ports: [] },
  { ptType: "Router-PT", category: "router", displayName: "Generic PT Router (6 NMs pre-installed)", ports: [
    fast("0/0"), fast("1/0"),
    { fullName: "Serial2/0", speed: "Serial" }, { fullName: "Serial3/0", speed: "Serial" },
    fast("4/0"), fast("5/0"),
  ] },

  // Switches — 2950 (FE-only), 2960 (FE+Gig uplinks), 3560/3650 (multilayer).
  { ptType: "2950-24",     category: "switch", displayName: "Cisco 2950-24",     ports: switchPorts2950() },
  { ptType: "2950T-24",    category: "switch", displayName: "Cisco 2950T-24",    ports: switchPorts2960() },
  { ptType: "2960-24TT",   category: "switch", displayName: "Cisco 2960-24TT",   ports: switchPorts2960() },
  { ptType: "3560-24PS",   category: "multilayerswitch", displayName: "Cisco 3560-24PS", ports: switchPorts2960() },
  { ptType: "3650-24PS",   category: "multilayerswitch", displayName: "Cisco 3650-24PS", ports: switchPorts3650() },

  // Industrial Ethernet multilayer switches. Port counts verified by
  // device-instantiation 2026-04-29_102904 (Vlan1 SVI filtered out).
  // IE-2000 = 8 FE + 2 GE; IE-3400 = 10 GE; IE-9320 = 28 GE.
  { ptType: "IE-2000",  category: "multilayerswitch", displayName: "Cisco IE-2000 (Industrial L2)", ports: [
    fast("1/1"), fast("1/2"), fast("1/3"), fast("1/4"),
    fast("1/5"), fast("1/6"), fast("1/7"), fast("1/8"),
    gig("1/1"), gig("1/2"),
  ] },
  { ptType: "IE-3400",  category: "multilayerswitch", displayName: "Cisco IE-3400 (Industrial L3)", ports: [
    gig("1/1"), gig("1/2"), gig("1/3"), gig("1/4"), gig("1/5"),
    gig("1/6"), gig("1/7"), gig("1/8"), gig("1/9"), gig("1/10"),
  ] },
  // IE-9320 (IOS XE 17.x) — same enable secret bootstrap as IR1101/IR8340.
  { ptType: "IE-9320",  category: "multilayerswitch", displayName: "Cisco IE-9320 (Industrial Catalyst)", cliMode: "pnp", ports: switchPortsIE9320() },

  // Switches — generic PT. Switch-PT-Empty has 0 physical ports baseline (just
  // Vlan1); Switch-PT ships with 6 pre-installed PT-SWITCH-NM modules
  // (4× PT-SWITCH-NM-1CFE + 2× PT-SWITCH-NM-1FFE per the catalog probe).
  { ptType: "Switch-PT-Empty", category: "switch", displayName: "Generic PT Switch (empty)", ports: [] },
  // Switch-PT exposes 6× FastEthernet ports as `Fa0/1, 1/1, 2/1, ..., 5/1`
  // (one per NM slot). Verified by device-instantiation 2026-04-29 (the
  // earlier `Fa0/0..5/0` guess was wrong).
  { ptType: "Switch-PT", category: "switch", displayName: "Generic PT Switch (6 NMs pre-installed)", ports: [
    fast("0/1"), fast("1/1"), fast("2/1"), fast("3/1"), fast("4/1"), fast("5/1"),
  ] },

  // Firewalls — Cisco ASA series. CLI uses `asa#` prompt + nameif/security-level
  // syntax (different from IOS); cli-subset probe still needs an ASA-specific
  // battery before promoting CLI to verified-pt9. Port specs verified by
  // device-instantiation 2026-04-29 (Vlan1/Vlan2 SVIs filtered out for 5505).
  { ptType: "5505",     category: "firewall", displayName: "Cisco ASA 5505 (8× Eth0/N, ASA-CLI)", ports: [
    eth("0/0"), eth("0/1"), eth("0/2"), eth("0/3"),
    eth("0/4"), eth("0/5"), eth("0/6"), eth("0/7"),
  ] },
  { ptType: "5506-X",   category: "firewall", displayName: "Cisco ASA 5506-X (8× GE + Mgmt, ASA-CLI)", ports: [
    gig("1/1"), gig("1/2"), gig("1/3"), gig("1/4"),
    gig("1/5"), gig("1/6"), gig("1/7"), gig("1/8"),
    { fullName: "Management1/1", speed: "GigabitEthernet" },
  ] },
  { ptType: "ISA-3000", category: "firewall", displayName: "Cisco ISA-3000 (4× GE + Mgmt, ASA-CLI)", ports: [
    { fullName: "Management1/1", speed: "GigabitEthernet" },
    gig("1/1"), gig("1/2"), gig("1/3"), gig("1/4"),
  ] },

  // Endpoints + special-purpose.
  // Endpoints. PC-PT/Laptop-PT also expose `Bluetooth` (filtered as virtual).
  { ptType: "PC-PT",       category: "pc",     displayName: "PC",                ports: [fast("0")] },
  { ptType: "Server-PT",   category: "server", displayName: "Server",            ports: [fast("0")] },
  { ptType: "Laptop-PT",   category: "laptop", displayName: "Laptop",            ports: [fast("0")] },

  // Cloud-PT ships pre-populated with WAN multiplexer ports for serial,
  // analog modem, ethernet (DOCSIS bridge) and coaxial. Verified by
  // device-instantiation 2026-04-29 — 8 ports total.
  { ptType: "Cloud-PT",    category: "cloud",  displayName: "Cloud (WAN multiplexer)", ports: [
    { fullName: "Serial0", speed: "Serial" }, { fullName: "Serial1", speed: "Serial" },
    { fullName: "Serial2", speed: "Serial" }, { fullName: "Serial3", speed: "Serial" },
    { fullName: "Modem4", speed: "Modem" },   { fullName: "Modem5", speed: "Modem" },
    { fullName: "Ethernet6", speed: "Ethernet" },
    { fullName: "Coaxial7", speed: "Coaxial" },
  ] },
  { ptType: "Cloud-PT-Empty", category: "cloud", displayName: "Cloud (empty, 10 free slots)", ports: [] },

  // Access points — all four variants expose Port 0 (wired uplink) + Port 1
  // (radio, cableable for SSID hand-off in PT). Verified by device-
  // instantiation 2026-04-29 (count=2 for each AP variant).
  { ptType: "AccessPoint-PT",    category: "accesspoint", displayName: "Access Point",        ports: [
    { fullName: "Port 0", speed: "FastEthernet" }, { fullName: "Port 1", speed: "Wireless" },
  ] },
  { ptType: "AccessPoint-PT-A",  category: "accesspoint", displayName: "Access Point (802.11a)",  ports: [
    { fullName: "Port 0", speed: "FastEthernet" }, { fullName: "Port 1", speed: "Wireless" },
  ] },
  { ptType: "AccessPoint-PT-AC", category: "accesspoint", displayName: "Access Point (802.11ac)", ports: [
    { fullName: "Port 0", speed: "GigabitEthernet" }, { fullName: "Port 1", speed: "Wireless" },
  ] },
  { ptType: "AccessPoint-PT-N",  category: "accesspoint", displayName: "Access Point (802.11n)",  ports: [
    { fullName: "Port 0", speed: "FastEthernet" }, { fullName: "Port 1", speed: "Wireless" },
  ] },

  // L1 / legacy networking. Hub/Bridge/Repeater are L1-L2 relays; cabling-wise
  // any port works the same. Linksys-WRT300N is the only consumer wireless
  // router (Internet WAN + 4× LAN + radio).
  { ptType: "Hub-PT",          category: "hub",       displayName: "Generic Hub (6 ports pre-installed)",      ports: [
    fast("0"), fast("1"), fast("2"), fast("3"), fast("4"), fast("5"),
  ] },
  // Bridge/Repeater use `Ethernet*` (no Fast prefix). Verified 2026-04-29.
  { ptType: "Bridge-PT",       category: "bridge",    displayName: "Generic Bridge (2 ports pre-installed)",   ports: [
    eth("0/1"), eth("1/1"),
  ] },
  { ptType: "Repeater-PT",     category: "repeater",  displayName: "Generic Repeater (2 ports pre-installed)", ports: [
    eth("0"), eth("1"),
  ] },
  // Linksys-WRT300N: WAN port `Internet`, 4 LAN, 1 radio `Wireless`. The PPPoE
  // virtual stack (`Virtual-Access1`, `Dialer1`) and `Vlan1` are filtered.
  { ptType: "Linksys-WRT300N", category: "wirelessrouter", displayName: "Linksys WRT300N (4 LAN + 1 Internet + radio)", ports: [
    { fullName: "Internet", speed: "FastEthernet" },
    { fullName: "Ethernet 1", speed: "FastEthernet" },
    { fullName: "Ethernet 2", speed: "FastEthernet" },
    { fullName: "Ethernet 3", speed: "FastEthernet" },
    { fullName: "Ethernet 4", speed: "FastEthernet" },
    { fullName: "Wireless", speed: "Wireless" },
  ] },

  // Endpoints — peripherals + mobile. Verified by device-instantiation
  // 2026-04-29_104537 (Bluetooth filtered as virtual on tablet/phone; 3G/4G
  // Cell1 IS physical/cableable so it stays in the catalog).
  { ptType: "Printer-PT",     category: "printer",   displayName: "Printer",                  ports: [fast("0")] },
  { ptType: "TabletPC-PT",    category: "tablet",    displayName: "Tablet PC (wireless+3G)",  ports: [
    { fullName: "Wireless0",  speed: "Wireless" },
    { fullName: "3G/4G Cell1", speed: "Cellular" },
  ] },
  { ptType: "SMARTPHONE-PT",  category: "pda",       displayName: "Smartphone (wireless+3G)", ports: [
    { fullName: "Wireless0",  speed: "Wireless" },
    { fullName: "3G/4G Cell1", speed: "Cellular" },
  ] },
  { ptType: "TV-PT",          category: "smartphone", displayName: "Smart TV", ports: [{ fullName: "Port 0", speed: "FastEthernet" }] },
  // Home-VoIP-PT exposes `Ethernet` (LAN uplink) + `Phone` (RJ-11 voice).
  { ptType: "Home-VoIP-PT",   category: "iot",       displayName: "Home VoIP gateway",        ports: [
    { fullName: "Ethernet", speed: "Ethernet" }, { fullName: "Phone", speed: "Modem" },
  ] },
  { ptType: "Analog-Phone-PT", category: "tdm",      displayName: "Analog Phone (RJ-11)",     ports: [{ fullName: "Port 0", speed: "Modem" }] },
  { ptType: "Cable-Modem-PT", category: "remote",    displayName: "Cable Modem",              ports: [
    { fullName: "Port 0", speed: "Coaxial" }, { fullName: "Port 1", speed: "FastEthernet" },
  ] },
  { ptType: "DSL-Modem-PT",   category: "tv",        displayName: "DSL Modem",                ports: [
    { fullName: "Port 0", speed: "Modem" }, { fullName: "Port 1", speed: "FastEthernet" },
  ] },
  // HomeRouter-PT-AC: 1 Internet WAN + 4 LAN GE + 6 wireless radios + 1
  // bridge radio. Vlan1, Virtual-Access1, Dialer1 filtered as virtual.
  { ptType: "HomeRouter-PT-AC", category: "homerouter", displayName: "Home Router (802.11ac, 4 LAN + 6 radios)", ports: [
    { fullName: "Internet", speed: "GigabitEthernet" },
    { fullName: "GigabitEthernet 1", speed: "GigabitEthernet" },
    { fullName: "GigabitEthernet 2", speed: "GigabitEthernet" },
    { fullName: "GigabitEthernet 3", speed: "GigabitEthernet" },
    { fullName: "GigabitEthernet 4", speed: "GigabitEthernet" },
    { fullName: "Wireless 1", speed: "Wireless" }, { fullName: "Wireless 2", speed: "Wireless" },
    { fullName: "Wireless 3", speed: "Wireless" }, { fullName: "Wireless 4", speed: "Wireless" },
    { fullName: "Wireless 5", speed: "Wireless" }, { fullName: "Wireless 6", speed: "Wireless" },
    { fullName: "Wireless0/0", speed: "Wireless" },
  ] },

  // 7960: typical IP phone passthrough. `Switch` is the LAN uplink to the
  // wiring closet, `PC` is the desktop port. `Vlan1` SVI filtered.
  { ptType: "7960",        category: "ipphone", displayName: "Cisco IP Phone 7960", ports: [
    { fullName: "Switch", speed: "FastEthernet" }, { fullName: "PC", speed: "FastEthernet" },
  ] },
];

export const DEVICE_CATALOG: ReadonlyMap<string, DeviceModel> = new Map(
  MODELS.map(m => [m.ptType, m])
);

const ALIASES: Record<string, string> = {
  "router":  "2911",
  "r":       "2911",
  "switch":  "2960-24TT",
  "sw":      "2960-24TT",
  "2950":    "2950-24",
  "2960":    "2960-24TT",
  "3560":    "3560-24PS",
  "3650":    "3650-24PS",
  "isr4321": "ISR4321",
  "isr4331": "ISR4331",
  "4321":    "ISR4321",
  "4331":    "ISR4331",
  "pt8200":  "PT8200",
  "8200":    "PT8200",
  "router-pt": "Router-PT-Empty",
  "switch-pt": "Switch-PT-Empty",
  "router-pt-full": "Router-PT",
  "switch-pt-full": "Switch-PT",
  // Industrial / branch routers (Wave 3)
  "ie2000":  "IE-2000",
  "ie3400":  "IE-3400",
  "ie9320":  "IE-9320",
  "ir1101":  "IR1101",
  "ir8340":  "IR8340",
  "cgr1240": "CGR1240",
  "819hg":   "819HG-4G-IOX",
  "819hgw":  "819HGW",
  // Firewalls
  "asa":     "5506-X",
  "asa5505": "5505",
  "asa5506": "5506-X",
  "isa3000": "ISA-3000",
  // Endpoints + L1
  "pc":      "PC-PT",
  "server":  "Server-PT",
  "laptop":  "Laptop-PT",
  "cloud":   "Cloud-PT",
  "cloud-empty": "Cloud-PT-Empty",
  "ap":      "AccessPoint-PT",
  "ap-a":    "AccessPoint-PT-A",
  "ap-ac":   "AccessPoint-PT-AC",
  "ap-n":    "AccessPoint-PT-N",
  "hub":     "Hub-PT",
  "bridge":  "Bridge-PT",
  "repeater": "Repeater-PT",
  "linksys": "Linksys-WRT300N",
  "wrt300n": "Linksys-WRT300N",
  "homerouter": "HomeRouter-PT-AC",
  "printer": "Printer-PT",
  "tablet":  "TabletPC-PT",
  "smartphone": "SMARTPHONE-PT",
  "phone-analog": "Analog-Phone-PT",
  "tv":      "TV-PT",
  "voip":    "Home-VoIP-PT",
  "cable-modem": "Cable-Modem-PT",
  "dsl-modem":   "DSL-Modem-PT",
  "phone":   "7960",
  "ipphone": "7960",
  "ip-phone": "7960",
};

export function resolveModel(name: string): DeviceModel | undefined {
  const direct = DEVICE_CATALOG.get(name);
  if (direct) return direct;
  const aliased = ALIASES[name.toLowerCase()];
  return aliased ? DEVICE_CATALOG.get(aliased) : undefined;
}

export function listModels(): DeviceModel[] {
  return [...DEVICE_CATALOG.values()];
}

export function listAliases(): Record<string, string> {
  return { ...ALIASES };
}
