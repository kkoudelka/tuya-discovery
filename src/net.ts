/**
 * Interface enumeration.
 *
 * Discovery requests go to a *subnet* broadcast address, which never leaves the
 * link it is sent on. A host with several interfaces therefore has to send one
 * request per interface, from that interface's own address.
 *
 * Getting this wrong is the usual reason a scan silently finds nothing: send
 * everything to 255.255.255.255 from the primary address and the packet follows
 * the default route, so devices on every other segment are never asked. Node
 * reports a netmask for each address, so the broadcast address is computed here
 * rather than taken from the OS, which keeps the behaviour identical across
 * platforms.
 */
import { networkInterfaces } from "node:os";

export interface LocalInterface {
  /** OS-level interface name, e.g. "Wi-Fi" or "eth0". */
  name: string;
  /** This interface's IPv4 address. */
  address: string;
  netmask: string;
  /** Directed broadcast address for this interface's subnet. */
  broadcast: string;
  /** e.g. "192.168.1.145/25" */
  cidr: string;
}

function toInt(ip: string): number {
  const parts = ip.split(".");
  if (parts.length !== 4) throw new Error(`not an IPv4 address: ${ip}`);
  return (
    parts.reduce((acc, part) => {
      const octet = Number(part);
      if (!Number.isInteger(octet) || octet < 0 || octet > 255) {
        throw new Error(`not an IPv4 address: ${ip}`);
      }
      return (acc << 8) | octet;
    }, 0) >>> 0
  );
}

function toIp(value: number): string {
  return [24, 16, 8, 0].map((shift) => (value >>> shift) & 0xff).join(".");
}

function prefixLength(netmask: string): number {
  let bits = 0;
  let mask = toInt(netmask);
  while (mask & 0x80000000) {
    bits += 1;
    mask = (mask << 1) >>> 0;
  }
  return bits;
}

/** Directed broadcast for an address/netmask pair: host bits all set. */
export function broadcastAddress(address: string, netmask: string): string {
  const mask = toInt(netmask);
  return toIp(((toInt(address) & mask) | (~mask >>> 0)) >>> 0);
}

/** Whether `address` sits inside the subnet implied by `address2`/`netmask`. */
export function sameSubnet(a: string, b: string, netmask: string): boolean {
  const mask = toInt(netmask);
  return (toInt(a) & mask) >>> 0 === (toInt(b) & mask) >>> 0;
}

/**
 * Every usable IPv4 interface, excluding loopback and point-to-point links that
 * have no meaningful broadcast address.
 */
export function listInterfaces(): LocalInterface[] {
  const found: LocalInterface[] = [];

  for (const [name, addresses] of Object.entries(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family !== "IPv4" || address.internal) continue;
      // A /32 has no other host to broadcast to.
      if (address.netmask === "255.255.255.255") continue;

      try {
        found.push({
          name,
          address: address.address,
          netmask: address.netmask,
          broadcast: broadcastAddress(address.address, address.netmask),
          cidr: address.cidr ?? `${address.address}/${prefixLength(address.netmask)}`,
        });
      } catch {
        // Skip anything we cannot parse rather than failing the whole scan.
      }
    }
  }

  return found;
}

/** Resolve `--interface` values against real interfaces, by name or address. */
export function selectInterfaces(all: LocalInterface[], wanted: string[]): LocalInterface[] {
  if (wanted.length === 0) return all;

  const selected: LocalInterface[] = [];
  for (const want of wanted) {
    const matches = all.filter((iface) => iface.name === want || iface.address === want);
    if (matches.length === 0) {
      throw new Error(
        `no interface matches "${want}". Available: ${all.map((i) => `${i.name} (${i.address})`).join(", ")}`,
      );
    }
    selected.push(...matches);
  }
  return selected;
}
