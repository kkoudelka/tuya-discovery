/**
 * The discovery engine: listen on the announcement ports, and ask.
 *
 * Passive listening alone finds only protocol 3.1/3.3 devices, which chatter
 * unprompted. Protocol 3.4/3.5 devices say nothing until they receive a
 * REQ_DEVINFO, so a request is sent repeatedly for the duration of the scan --
 * once per interface to that interface's broadcast address, and once per
 * directed target.
 */
import { createSocket, type Socket } from "node:dgram";

import { listInterfaces, sameSubnet, type LocalInterface } from "./net.js";
import {
  DISCOVERY_PORTS,
  REQUEST_PORT,
  buildDiscoveryRequest,
  decodeAnnouncement,
  type DeviceAnnouncement,
} from "./protocol.js";

export interface DiscoveredDevice {
  ip: string;
  gwId: string;
  productKey?: string;
  version?: string;
  uuid?: string;
  /** Whether it answered a broadcast or a request aimed straight at it. */
  via: "broadcast" | "directed";
  raw: DeviceAnnouncement;
}

export interface DiscoverOptions {
  /** How long to keep listening. Default 8000ms. */
  durationMs?: number;
  /** How often to repeat the request. Default 2000ms. */
  intervalMs?: number;
  /** Interfaces to broadcast from. Defaults to all usable IPv4 interfaces. */
  interfaces?: LocalInterface[];
  /** Addresses to ask directly, for devices broadcast cannot reach. */
  targets?: string[];
  onDevice?: (device: DiscoveredDevice) => void;
  onWarning?: (warning: string) => void;
  signal?: AbortSignal;
}

export interface DiscoverResult {
  devices: DiscoveredDevice[];
  /** Ports that could not be bound, interfaces that could not send, etc. */
  warnings: string[];
}

function bindListener(
  port: number,
  onPacket: (packet: Buffer, from: string) => void,
): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = createSocket({ type: "udp4", reuseAddr: true });
    socket.on("error", reject);
    socket.on("message", (packet, remote) => onPacket(packet, remote.address));
    socket.bind(port, () => {
      socket.removeListener("error", reject);
      socket.on("error", () => {
        /* a late socket error must not take the scan down */
      });
      try {
        socket.setBroadcast(true);
      } catch {
        /* not fatal: we only need to receive on this socket */
      }
      resolve(socket);
    });
  });
}

function bindSender(address: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = createSocket({ type: "udp4", reuseAddr: true });
    socket.on("error", reject);
    socket.bind({ address, port: 0 }, () => {
      socket.removeListener("error", reject);
      socket.on("error", () => {});
      socket.setBroadcast(true);
      resolve(socket);
    });
  });
}

export async function discover(options: DiscoverOptions = {}): Promise<DiscoverResult> {
  const durationMs = options.durationMs ?? 8000;
  const intervalMs = options.intervalMs ?? 2000;
  const interfaces = options.interfaces ?? listInterfaces();
  const targets = options.targets ?? [];

  const warnings: string[] = [];
  const warn = (message: string) => {
    warnings.push(message);
    options.onWarning?.(message);
  };

  const devices = new Map<string, DiscoveredDevice>();
  const directed = new Set(targets);

  const handlePacket = (packet: Buffer, from: string) => {
    const announcement = decodeAnnouncement(packet);
    if (!announcement) return;

    const ip = announcement.ip || from;
    const existing = devices.get(announcement.gwId);
    if (existing) {
      existing.ip = ip;
      return;
    }

    const device: DiscoveredDevice = {
      ip,
      gwId: announcement.gwId,
      productKey: announcement.productKey,
      version: announcement.version,
      uuid: announcement.uuid,
      via: directed.has(from) || directed.has(ip) ? "directed" : "broadcast",
      raw: announcement,
    };
    devices.set(device.gwId, device);
    options.onDevice?.(device);
  };

  const listeners: Socket[] = [];
  for (const port of DISCOVERY_PORTS) {
    try {
      listeners.push(await bindListener(port, handlePacket));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      warn(
        `could not listen on UDP ${port} (${reason}). Another Tuya tool may be running; ` +
          `devices announcing only on that port will be missed.`,
      );
    }
  }

  const senders: { socket: Socket; iface: LocalInterface }[] = [];
  for (const iface of interfaces) {
    try {
      senders.push({ socket: await bindSender(iface.address), iface });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      warn(`could not send from ${iface.name} (${iface.address}): ${reason}`);
    }
  }

  if (listeners.length === 0) {
    warn("no discovery port could be bound; nothing will be received");
  }
  if (senders.length === 0 && interfaces.length > 0) {
    warn("no interface could send; only unsolicited announcements will be seen");
  }

  const sendRound = () => {
    for (const { socket, iface } of senders) {
      const request = buildDiscoveryRequest(iface.address);
      socket.send(request, REQUEST_PORT, iface.broadcast, (error) => {
        if (error) warn(`broadcast from ${iface.address} failed: ${error.message}`);
      });

      // Ask each target from whichever interface shares its subnet, so the
      // device sees a sender address it can actually reply to.
      for (const target of targets) {
        let onSubnet: boolean;
        try {
          onSubnet = sameSubnet(target, iface.address, iface.netmask);
        } catch {
          continue;
        }
        if (!onSubnet && senders.length > 1) continue;
        socket.send(request, REQUEST_PORT, target, (error) => {
          if (error) warn(`request to ${target} failed: ${error.message}`);
        });
      }
    }
  };

  sendRound();
  const ticker = setInterval(sendRound, intervalMs);

  try {
    await new Promise<void>((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", finish);
        resolve();
      };
      const timer = setTimeout(finish, durationMs);
      options.signal?.addEventListener("abort", finish, { once: true });
    });
  } finally {
    clearInterval(ticker);
    for (const socket of listeners) socket.close();
    for (const { socket } of senders) socket.close();
  }

  return {
    devices: [...devices.values()].sort((a, b) =>
      a.ip.localeCompare(b.ip, undefined, { numeric: true }),
    ),
    warnings,
  };
}
