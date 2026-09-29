import { defineCommand } from "citty";

import { discover } from "../discover.js";
import { listInterfaces, selectInterfaces } from "../net.js";
import { formatDevices, formatHighlight } from "../report.js";

export const scan = defineCommand({
  meta: {
    name: "scan",
    description: "Broadcast a discovery request on every interface and listen for replies",
  },
  args: {
    timeout: {
      type: "string",
      description: "How long to listen, in seconds",
      default: "8",
      alias: "t",
    },
    interface: {
      type: "string",
      description: "Restrict to an interface, by name or address (repeatable)",
      alias: "i",
    },
    json: { type: "boolean", description: "Print JSON instead of a table", default: false },
  },
  async run({ args }) {
    const seconds = Number(args.timeout);
    if (!Number.isFinite(seconds) || seconds <= 0) {
      throw new Error(`--timeout must be a positive number of seconds, got "${args.timeout}"`);
    }

    const wanted = ([] as string[]).concat(args.interface ?? []);
    const interfaces = selectInterfaces(listInterfaces(), wanted);

    const { devices, warnings } = await discover({
      durationMs: seconds * 1000,
      interfaces,
    });

    if (args.json) {
      console.log(JSON.stringify({ devices, warnings }, null, 2));
    } else {
      for (const warning of warnings) console.error(`warning: ${warning}`);
      console.log(formatDevices(devices));
      const highlight = formatHighlight(devices);
      if (highlight) console.log(`\n${highlight}`);
    }

    if (devices.length === 0) process.exitCode = 1;
  },
});
