import type { DiscoveredDevice } from "./discover.js";
import type { LocalInterface } from "./net.js";

function table(headers: string[], rows: string[][]): string {
  const widths = headers.map((header, column) =>
    Math.max(header.length, ...rows.map((row) => (row[column] ?? "").length)),
  );
  const line = (cells: string[]) =>
    cells
      .map((cell, column) => cell.padEnd(widths[column] ?? 0))
      .join("  ")
      .trimEnd();

  return [line(headers), line(widths.map((width) => "-".repeat(width))), ...rows.map(line)].join(
    "\n",
  );
}

export function formatDevices(devices: DiscoveredDevice[]): string {
  if (devices.length === 0) return "No devices found.";
  return table(
    ["IP", "DEVICE ID", "PRODUCT ID", "VER", "VIA"],
    devices.map((device) => [
      device.ip,
      device.gwId,
      device.productKey ?? "-",
      device.version ?? "-",
      device.via,
    ]),
  );
}

export function formatInterfaces(interfaces: LocalInterface[]): string {
  if (interfaces.length === 0) return "No usable IPv4 interfaces.";
  return table(
    ["INTERFACE", "ADDRESS", "NETMASK", "BROADCAST"],
    interfaces.map((iface) => [iface.name, iface.cidr, iface.netmask, iface.broadcast]),
  );
}

/** The bit people actually came for, when there is exactly one device. */
export function formatHighlight(devices: DiscoveredDevice[]): string | null {
  if (devices.length !== 1) return null;
  const device = devices[0]!;
  if (!device.productKey) return null;
  return `product id: ${device.productKey}`;
}
