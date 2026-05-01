/**
 * IPv6 intents — independent dual-stack layer that lives alongside the IPv4
 * `addressing` recipe. Recipes opt in by populating `Blueprint.ipv6` and the
 * applier emits IOS CLI under `enable / configure terminal`:
 *
 *   ipv6 unicast-routing
 *   interface X / ipv6 enable / ipv6 address 2001:db8:N::1/64
 *   ipv6 router ospf <pid> / router-id A.B.C.D
 *   interface X / ipv6 ospf <pid> area <area>
 *   ipv6 route <prefix> <next-hop>
 *
 * Endpoint hosts (PC-PT/Laptop-PT/Server-PT) get IPv6 via their native
 * Command Prompt with `ipv6config <addr>/<prefix> <gw>` — verified in
 * scripts/probe-ipv6.ts. PT 9 routers ship with the IPv6 stack disabled by
 * default, so the global `ipv6 unicast-routing` switch is mandatory before
 * any per-interface address takes effect.
 *
 * Routing protocols supported: "none", "static" and "ospf" (OSPFv3 in the
 * classic `ipv6 router ospf` form). EIGRPv6 / RIPng / BGP-IPv6 are out of
 * scope for the recipe layer; the `extraCli` blueprint hatch covers them
 * if needed.
 */

export type Ipv6RoutingProtocol = "none" | "static" | "ospf";

export interface Ipv6InterfaceIntent {
  readonly device: string;
  readonly port: string;
  /** IPv6 address in CIDR form, e.g. "2001:db8:1::1/64". */
  readonly address: string;
  /** Optional. When true, also emits `ipv6 enable` (link-local). Defaults true. */
  readonly enableLinkLocal?: boolean;
  /** Optional OSPFv3 process id; emits `ipv6 ospf <pid> area <area>` on the interface. */
  readonly ospfPid?: number;
  /** OSPFv3 area for this interface. Defaults to 0. */
  readonly ospfArea?: number;
}

export interface Ipv6OspfIntent {
  readonly device: string;
  readonly pid: number;
  /** Optional `router-id` (32-bit dotted-quad). */
  readonly routerId?: string;
}

export interface Ipv6StaticRouteIntent {
  readonly device: string;
  /** Destination prefix, e.g. "2001:db8:2::/64" or "::/0". */
  readonly prefix: string;
  /** Next-hop IPv6 address. */
  readonly nextHop: string;
  /** Optional administrative distance (1..255). */
  readonly distance?: number;
}

export interface Ipv6EndpointIntent {
  readonly device: string;
  /** IPv6 address in CIDR form, e.g. "2001:db8:1::2/64". */
  readonly address: string;
  /** Default IPv6 gateway. */
  readonly gateway: string;
}

export interface Ipv6Intent {
  /** When true, emits `ipv6 unicast-routing` on every router that owns at
   *  least one interface or OSPF intent. Defaults to true. */
  readonly unicastRouting?: boolean;
  readonly interfaces?: readonly Ipv6InterfaceIntent[];
  readonly ospf?: readonly Ipv6OspfIntent[];
  readonly staticRoutes?: readonly Ipv6StaticRouteIntent[];
  readonly endpoints?: readonly Ipv6EndpointIntent[];
}
