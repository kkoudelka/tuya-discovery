#!/usr/bin/env node
import { defineCommand, runMain } from "citty";

import { interfaces } from "./commands/interfaces.js";
import { probe } from "./commands/probe.js";
import { scan } from "./commands/scan.js";
import { runWizard } from "./wizard.js";

const main = defineCommand({
  meta: {
    name: "tuya-discovery",
    version: "0.1.0",
    description: "Find Tuya devices on the LAN and read their device and product ids",
  },
  subCommands: { scan, probe, interfaces },
  async run({ args }) {
    // citty falls through to here when no subcommand matched.
    if (args._.length === 0) {
      await runWizard();
    }
  },
});

runMain(main);
