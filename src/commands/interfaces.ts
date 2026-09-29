import { defineCommand } from "citty";

import { listInterfaces } from "../net.js";
import { formatInterfaces } from "../report.js";

export const interfaces = defineCommand({
  meta: {
    name: "interfaces",
    description: "Show the interfaces a scan would broadcast from, and where",
  },
  args: {
    json: { type: "boolean", description: "Print JSON instead of a table", default: false },
  },
  run({ args }) {
    const found = listInterfaces();
    if (args.json) {
      console.log(JSON.stringify(found, null, 2));
      return;
    }
    console.log(formatInterfaces(found));
  },
});
