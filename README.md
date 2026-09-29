# tuya-discovery

Find Tuya devices on your LAN and read their device id and product id.

Tuya devices announce themselves over UDP, but the useful ones often don't.
Protocol 3.4 and 3.5 devices stay silent until they are asked, and the request
has to reach them — which is where most scans quietly fail.

## Usage

```sh
yarn build

# interactive
node dist/cli.mjs

# broadcast on every interface
node dist/cli.mjs scan --timeout 10

# ask one device directly
node dist/cli.mjs probe 192.168.1.141

# show where a scan would send, and to which broadcast address
node dist/cli.mjs interfaces
```

Add `--json` to any command for machine-readable output. `scan` and `probe`
exit non-zero when nothing answers.

## Why scans find nothing

Two failure modes account for almost all of it.

**The request goes out the wrong interface.** A discovery request is sent to a
_subnet_ broadcast address, which never leaves the link it is sent on. A host
with several interfaces must send one request per interface, from that
interface's own address. Tools that send everything to `255.255.255.255` from
the primary address reach only the default route's segment. `interfaces` shows
exactly what this tool will do:

```
INTERFACE  ADDRESS           NETMASK          BROADCAST
Ethernet   192.168.1.16/25   255.255.255.128  192.168.1.127
WiFi       192.168.1.145/27  255.255.255.224  192.168.1.159
```

**The broadcast address is computed from the wrong prefix.** On a `/27`, the
broadcast is `.159`, not `.255`. Assume `/24` on a subnetted network and the
packet goes to an address nobody is listening on. This tool derives the
broadcast from each interface's actual netmask.

If a device sits on a segment your host has no interface on, broadcast cannot
reach it at all — no tool can fix that from the wrong side of a router. Use
`probe <ip>`, which sends the request straight to the device. That works across
subnets, as long as the device is routable.

## Is the device reachable at all?

Before blaming discovery, check the device answers on its control port:

```sh
node -e "require('net').createConnection(6668,'192.168.1.141').on('connect',()=>console.log('reachable')).on('error',e=>console.log(e.code))"
```

If that fails, the problem is the network, not the scan. If it succeeds but
`probe` finds nothing, the device likely predates protocol 3.4 and only
announces on 6666/6667 — leave `scan` running on its segment instead.

## Library

```ts
import { discover, listInterfaces } from "tuya-discovery";

const { devices, warnings } = await discover({
  durationMs: 10_000,
  interfaces: listInterfaces(),
  targets: ["192.168.1.141"],
  onDevice: (device) => console.log(device.ip, device.productKey),
});
```

## Notes

- The key used to decrypt announcements is a fixed value present in every Tuya
  firmware. It protects nothing and is not a credential; it only obfuscates the
  announcement payload.
- Declarations are emitted by `tsc`, not by tsup. tsup's `dts` step uses
  `rollup-plugin-dts`, which reaches into TypeScript's internal JS API and
  breaks on the native TypeScript 7 compiler.
- TypeScript 7 needs Yarn >= 4.17.1. Earlier versions apply a builtin compat
  patch that targets `lib/_tsc.js`, a file the native compiler does not ship
  (yarnpkg/berry#7191).
