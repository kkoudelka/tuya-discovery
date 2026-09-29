import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  cancel,
  confirm,
  intro,
  isCancel,
  log,
  multiselect,
  note,
  outro,
  select,
  spinner,
  text,
} from "@clack/prompts";

import { discover, type DiscoveredDevice } from "./discover.js";
import { listInterfaces } from "./net.js";
import { formatDevices, formatHighlight } from "./report.js";

function bail(): never {
  cancel("Cancelled.");
  process.exit(130);
}

function unwrap<T>(value: T | symbol): T {
  if (isCancel(value)) bail();
  return value as T;
}

export async function runWizard(): Promise<void> {
  intro("tuya-discovery");

  const interfaces = listInterfaces();
  if (interfaces.length === 0) {
    log.error("No usable IPv4 interfaces found.");
    outro("Nothing to scan.");
    process.exitCode = 1;
    return;
  }

  const mode = unwrap(
    await select({
      message: "How should devices be found?",
      options: [
        {
          value: "broadcast",
          label: "Broadcast",
          hint: "ask every device on the selected interfaces",
        },
        {
          value: "directed",
          label: "Ask one address",
          hint: "for a device broadcast cannot reach",
        },
      ],
    }),
  );

  let targets: string[] = [];
  let chosen = interfaces;

  if (mode === "directed") {
    const address = unwrap(
      await text({
        message: "Device address",
        placeholder: "192.168.1.141",
        validate: (value) =>
          /^(\d{1,3}\.){3}\d{1,3}$/.test(value.trim()) ? undefined : "Enter an IPv4 address.",
      }),
    );
    targets = [address.trim()];
  } else if (interfaces.length > 1) {
    chosen = unwrap(
      await multiselect({
        message: "Which interfaces?",
        options: interfaces.map((iface) => ({
          value: iface,
          label: `${iface.name} (${iface.cidr})`,
          hint: `broadcast ${iface.broadcast}`,
        })),
        initialValues: interfaces,
        required: true,
      }),
    );
  }

  const seconds = Number(
    unwrap(
      await select({
        message: "How long to listen?",
        options: [
          { value: "6", label: "6 seconds" },
          { value: "12", label: "12 seconds", hint: "recommended" },
          { value: "30", label: "30 seconds", hint: "slow or busy networks" },
        ],
        initialValue: "12",
      }),
    ),
  );

  const progress = spinner();
  progress.start("Listening...");

  const found: DiscoveredDevice[] = [];
  const { devices, warnings } = await discover({
    durationMs: seconds * 1000,
    interfaces: chosen,
    targets,
    onDevice: (device) => {
      found.push(device);
      progress.message(`Found ${found.length} device${found.length === 1 ? "" : "s"}...`);
    },
  });

  progress.stop(`Found ${devices.length} device${devices.length === 1 ? "" : "s"}.`);

  for (const warning of warnings) log.warn(warning);

  if (devices.length === 0) {
    note(
      mode === "directed"
        ? "Check the device is reachable first, e.g. a TCP connection to port 6668.\nOnly protocol 3.4/3.5 devices answer a directed request."
        : "Devices on another subnet cannot be reached by broadcast.\nTry 'Ask one address' with the device's IP.",
      "Nothing answered",
    );
    outro("No devices found.");
    process.exitCode = 1;
    return;
  }

  note(formatDevices(devices), "Devices");
  const highlight = formatHighlight(devices);
  if (highlight) log.success(highlight);

  const save = unwrap(await confirm({ message: "Save results to a file?", initialValue: false }));
  if (save) {
    const path = unwrap(
      await text({
        message: "Where?",
        placeholder: "devices.json",
        defaultValue: "devices.json",
      }),
    );
    const target = resolve(process.cwd(), path.trim() || "devices.json");
    await writeFile(target, `${JSON.stringify(devices, null, 2)}\n`, "utf8");
    log.success(`Wrote ${target}`);
  }

  outro("Done.");
}
