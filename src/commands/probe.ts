import { defineCommand } from "citty";

import { discover } from "../discover.js";
import { listInterfaces } from "../net.js";
import { formatDevices, formatHighlight } from "../report.js";

export const probe = defineCommand({
  meta: {
    name: "probe",
    description: "Ask a known address directly, for devices broadcast cannot reach",
  },
  args: {
    address: {
      type: "positional",
      description: "Device IP address",
      required: true,
    },
    timeout: {
      type: "string",
      description: "How long to wait for a reply, in seconds",
      default: "6",
      alias: "t",
    },
    json: { type: "boolean", description: "Print JSON instead of a table", default: false },
  },
  async run({ args }) {
    const seconds = Number(args.timeout);
    if (!Number.isFinite(seconds) || seconds <= 0) {
      throw new Error(`--timeout must be a positive number of seconds, got "${args.timeout}"`);
    }

    const { devices, warnings } = await discover({
      durationMs: seconds * 1000,
      interfaces: listInterfaces(),
      targets: [args.address],
    });

    const answered = devices.filter(
      (device) => device.ip === args.address || device.via === "directed",
    );
    const found = answered.length > 0 ? answered : devices;

    if (args.json) {
      console.log(JSON.stringify({ devices: found, warnings }, null, 2));
    } else {
      for (const warning of warnings) console.error(`warning: ${warning}`);
      if (found.length === 0) {
        console.log(`No reply from ${args.address}.`);
        console.log(
          "\nThe device may be on another segment, or may not speak protocol 3.4/3.5.\n" +
            "Check it is reachable first, e.g. a TCP connection to port 6668.",
        );
      } else {
        console.log(formatDevices(found));
        const highlight = formatHighlight(found);
        if (highlight) console.log(`\n${highlight}`);
      }
    }

    if (found.length === 0) process.exitCode = 1;
  },
});
