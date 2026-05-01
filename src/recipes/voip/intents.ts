/**
 * VoIP intents — CME on a Cisco router + IP Phones registered through
 * telephony-service and ephone configuration, plus voice VLAN trunking on the
 * access switch.
 *
 * The applier maps these to IOS CLI under `enable / configure terminal`:
 *   telephony-service / max-ephones / max-dn / ip source-address ...
 *   ephone-dn N / number 100X
 *   ephone N / mac-address ... / type 7960 / button 1:N
 *   interface X / switchport voice vlan VV / switchport access vlan DV /
 *     mls qos trust device cisco-phone
 *
 * The native PT 9 IPC surface (CCMEProcess/CTelephonyService/CEphone) is
 * documented in docs/pt-api/classes but it lacks setters for MAC, button and
 * source-address, so CLI is the only complete path for now.
 */

export interface VoipCmeIntent {
  /** Router that hosts CME (telephony-service). */
  readonly device: string;
  readonly maxEphones: number;
  readonly maxDn: number;
  /** Loopback or interface IP that phones register against (TFTP source). */
  readonly sourceIp: string;
  /** TCP port for SCCP. Defaults to 2000 if omitted. */
  readonly sourcePort?: number;
  /** Optional auto-assign DN range, e.g. {first:1, last:50}. */
  readonly autoAssign?: { readonly first: number; readonly last: number };
  /** Optional banner shown on phones at registration. */
  readonly systemMessage?: string;
}

export interface EphoneDnIntent {
  readonly device: string;
  /** ephone-dn tag (1..N, must fit within VoipCmeIntent.maxDn). */
  readonly dnTag: number;
  /** Extension number, e.g. "1001". */
  readonly number: string;
  /** Optional caller-id name. */
  readonly name?: string;
}

export interface EphoneIntent {
  readonly device: string;
  /** ephone tag (1..N, must fit within VoipCmeIntent.maxEphones). */
  readonly ephoneNumber: number;
  /** MAC address of the phone, dotted Cisco form (e.g. "0001.4321.ABCD"). */
  readonly mac: string;
  /** Phone model, e.g. "7960". Defaults to 7960 if omitted. */
  readonly type?: string;
  /** Button mapping. Plain ints map 1:1 to dnTags ("button 1:1 2:2"); explicit
   *  pairs override that. */
  readonly buttons: readonly (number | { readonly button: number; readonly dnTag: number })[];
}

export interface VoiceVlanIntent {
  readonly switch: string;
  /** Switchport that the IP Phone (and optionally a daisy-chained PC) connects to. */
  readonly port: string;
  readonly voiceVlanId: number;
  /** Optional data VLAN for the PC behind the phone. */
  readonly dataVlanId?: number;
  /** When true, emits `mls qos trust device cisco-phone`. Defaults to true. */
  readonly trustCiscoPhone?: boolean;
}

export interface VoipIntent {
  readonly cme?: readonly VoipCmeIntent[];
  readonly ephoneDns?: readonly EphoneDnIntent[];
  readonly ephones?: readonly EphoneIntent[];
  readonly voiceVlans?: readonly VoiceVlanIntent[];
}
