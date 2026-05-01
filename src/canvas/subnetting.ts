/**
 * Self-contained IPv4 helpers. We avoid bringing in `node:net` or any npm
 * package for a couple of reasons:
 *   - Bun's interop with `node:net.BlockList` is incomplete in some builds.
 *   - The math here is trivial and shipping our own keeps the surface tiny.
 *
 * Everything operates on either a CIDR string ("10.0.0.0/30") or its
 * decomposed components (network, prefix, mask). No IPv6.
 */

export interface Ipv4Subnet {
  /** Network address as dotted quad, e.g. "10.0.0.0". */
  readonly network: string;
  /** CIDR prefix length, 0–32. */
  readonly prefix: number;
}

const ipv4Re = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

export function ipToInt(ip: string): number {
  const m = ipv4Re.exec(ip);
  if (!m) throw new Error(`invalid IPv4 address: ${ip}`);
  let out = 0;
  for (let i = 1; i <= 4; i++) {
    const n = Number(m[i]);
    if (!Number.isInteger(n) || n < 0 || n > 255) {
      throw new Error(`invalid IPv4 address: ${ip}`);
    }
    out = (out * 256) + n;
  }
  // Coerce to unsigned 32-bit
  return out >>> 0;
}

export function intToIp(n: number): string {
  const u = n >>> 0;
  return [
    (u >>> 24) & 0xff,
    (u >>> 16) & 0xff,
    (u >>> 8) & 0xff,
    u & 0xff,
  ].join(".");
}

export function prefixToMask(prefix: number): string {
  if (prefix < 0 || prefix > 32) throw new Error(`invalid prefix: ${prefix}`);
  if (prefix === 0) return "0.0.0.0";
  // (-1 << (32 - prefix)) wrapped to 32-bit unsigned
  const mask = (0xffffffff << (32 - prefix)) >>> 0;
  return intToIp(mask);
}

export function prefixToWildcard(prefix: number): string {
  if (prefix < 0 || prefix > 32) throw new Error(`invalid prefix: ${prefix}`);
  if (prefix === 32) return "0.0.0.0";
  // JS shifts mask their RHS with `& 31`, so `<<32` is a no-op. Special-case /0.
  if (prefix === 0) return "255.255.255.255";
  const wildcard = ((~(0xffffffff << (32 - prefix))) >>> 0);
  return intToIp(wildcard);
}

export function parseCidr(cidr: string): Ipv4Subnet {
  const [base, p] = cidr.split("/");
  if (!base || p === undefined) throw new Error(`invalid CIDR: ${cidr}`);
  const prefix = Number(p);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
    throw new Error(`invalid CIDR prefix: ${cidr}`);
  }
  const ipInt = ipToInt(base);
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const networkInt = (ipInt & mask) >>> 0;
  return { network: intToIp(networkInt), prefix };
}

export interface Ipv4Interface {
  /** Host address (e.g. ".1" inside the subnet). */
  readonly host: string;
  readonly subnet: Ipv4Subnet;
}

export function parseInterface(cidr: string): Ipv4Interface {
  const [base, p] = cidr.split("/");
  if (!base || p === undefined) throw new Error(`invalid interface CIDR: ${cidr}`);
  const prefix = Number(p);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
    throw new Error(`invalid interface prefix: ${cidr}`);
  }
  ipToInt(base); // throws on bad host
  return { host: base, subnet: parseCidr(cidr) };
}

/**
 * Iterate /N subnets out of a parent network in stable order.
 * Both `parent` and the produced children are inclusive networks.
 */
export function* iterSubnets(parentCidr: string, newPrefix: number): Generator<Ipv4Subnet> {
  const parent = parseCidr(parentCidr);
  if (newPrefix < parent.prefix || newPrefix > 32) {
    throw new Error(`new prefix ${newPrefix} not finer than parent ${parent.prefix}`);
  }
  const start = ipToInt(parent.network);
  const blockSize = newPrefix === 32 ? 1 : 2 ** (32 - newPrefix);
  const totalChildren = parent.prefix === 32 ? 1 : 2 ** (newPrefix - parent.prefix);
  for (let i = 0; i < totalChildren; i++) {
    yield { network: intToIp(start + i * blockSize), prefix: newPrefix };
  }
}

export function subnetHosts(subnet: Ipv4Subnet): string[] {
  // /31 and /32 don't have usable hosts under the classical definition;
  // we treat /31 as point-to-point (RFC 3021) so both addresses are usable.
  const start = ipToInt(subnet.network);
  const size = 2 ** (32 - subnet.prefix);
  if (subnet.prefix === 32) return [intToIp(start)];
  if (subnet.prefix === 31) return [intToIp(start), intToIp(start + 1)];
  const out: string[] = [];
  for (let i = 1; i < size - 1; i++) {
    out.push(intToIp(start + i));
  }
  return out;
}

export function subnetMask(subnet: Ipv4Subnet): string {
  return prefixToMask(subnet.prefix);
}

export function sameSubnet(a: Ipv4Subnet, b: Ipv4Subnet): boolean {
  return a.network === b.network && a.prefix === b.prefix;
}

/** Cursor that hands out fresh subnets one at a time. */
export class SubnetIterator {
  private readonly gen: Generator<Ipv4Subnet>;

  constructor(parentCidr: string, newPrefix: number) {
    this.gen = iterSubnets(parentCidr, newPrefix);
  }

  next(): Ipv4Subnet {
    const r = this.gen.next();
    if (r.done) throw new Error("subnet pool exhausted");
    return r.value;
  }
}
