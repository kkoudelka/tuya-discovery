/**
 * Tuya LAN discovery wire format.
 *
 * Devices announce themselves on two UDP ports, and newer ones stay silent
 * until asked:
 *
 *   6666  protocol 3.1  - plaintext JSON, or AES-ECB under the well-known key
 *   6667  protocol 3.3+ - AES-ECB under the well-known key, `55AA` framing
 *   7000  protocol 3.4/3.5 - AES-GCM under the well-known key, `6699` framing.
 *         These devices broadcast nothing on their own. They reply only to a
 *         REQ_DEVINFO request, which may be sent to a broadcast address *or
 *         directly to the device*.
 *
 * The "well-known key" is not a secret: it is md5 of a fixed string shipped in
 * every Tuya firmware, recovered by the tuya-convert project. It authenticates
 * nothing; it only obfuscates the announcement.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/** md5("yGAdlopoPVldABfn") - 16 bytes, so AES-128. */
export const UDP_KEY: Buffer = createHash("md5").update("yGAdlopoPVldABfn").digest();

export const DISCOVERY_PORTS = [6666, 6667, 7000] as const;

/** Port that answers a directed REQ_DEVINFO. */
export const REQUEST_PORT = 7000;

const PREFIX_55AA = 0x000055aa;
const PREFIX_6699 = 0x00006699;
const SUFFIX_6699 = Buffer.from([0x00, 0x00, 0x99, 0x66]);

const HEADER_LEN_55AA = 16; // prefix, seqno, cmd, length
const HEADER_LEN_6699 = 18; // prefix, unknown(u16), seqno, cmd, length
const TAG_LEN = 16;
const IV_LEN = 12;
const SUFFIX_LEN = 4;
const CRC_LEN = 4;
const RETCODE_LEN = 4;

/** REQ_DEVINFO - "tell me who you are". */
const CMD_REQ_DEVINFO = 0x25;

/** A device's announcement, as it puts it. Fields vary by firmware. */
export interface DeviceAnnouncement {
  ip: string;
  gwId: string;
  productKey?: string;
  version?: string;
  uuid?: string;
  active?: number;
  encrypt?: boolean;
  token?: boolean;
  [key: string]: unknown;
}

/**
 * Build a REQ_DEVINFO request.
 *
 * `fromIp` is echoed back to the device as the sender; it should be the address
 * of the interface the packet leaves by, or a device on another segment may
 * answer somewhere useless.
 */
export function buildDiscoveryRequest(fromIp: string): Buffer {
  const payload = Buffer.from(JSON.stringify({ from: "app", ip: fromIp }), "utf8");

  // Length covers iv + ciphertext + tag, but not the trailing suffix.
  const length = payload.length + IV_LEN + TAG_LEN;

  const header = Buffer.alloc(HEADER_LEN_6699);
  header.writeUInt32BE(PREFIX_6699, 0);
  header.writeUInt16BE(0, 4); // unknown, always zero in practice
  header.writeUInt32BE(0, 6); // seqno
  header.writeUInt32BE(CMD_REQ_DEVINFO, 10);
  header.writeUInt32BE(length, 14);

  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-128-gcm", UDP_KEY, iv);
  // Everything after the 4-byte prefix is authenticated but not encrypted.
  cipher.setAAD(header.subarray(4));
  const ciphertext = Buffer.concat([cipher.update(payload), cipher.final()]);

  return Buffer.concat([header, iv, ciphertext, cipher.getAuthTag(), SUFFIX_6699]);
}

/** Strip PKCS#7-style padding, tolerating firmware that pads sloppily. */
function unpad(buf: Buffer): Buffer {
  const pad = buf.at(-1);
  if (pad === undefined || pad < 1 || pad > 16 || pad > buf.length) return buf;
  return buf.subarray(0, buf.length - pad);
}

function decodeEcb(payload: Buffer): string {
  const decipher = createDecipheriv("aes-128-ecb", UDP_KEY, null);
  decipher.setAutoPadding(false);
  const raw = Buffer.concat([decipher.update(payload), decipher.final()]);
  return unpad(raw).toString("utf8");
}

function decode6699(packet: Buffer): string {
  const length = packet.readUInt32BE(14);
  const end = HEADER_LEN_6699 + length + SUFFIX_LEN;
  if (packet.length < end) throw new Error("truncated 6699 packet");

  const framed = packet.subarray(HEADER_LEN_6699, end);
  const tag = framed.subarray(framed.length - TAG_LEN - SUFFIX_LEN, framed.length - SUFFIX_LEN);
  const body = framed.subarray(0, framed.length - TAG_LEN - SUFFIX_LEN);

  const iv = body.subarray(0, IV_LEN);
  const ciphertext = body.subarray(IV_LEN);

  const decipher = createDecipheriv("aes-128-gcm", UDP_KEY, iv);
  decipher.setAAD(packet.subarray(4, HEADER_LEN_6699));
  decipher.setAuthTag(tag);
  const raw = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  // Responses may carry a 4-byte return code ahead of the JSON body.
  const text = raw.subarray(raw[0] === 0x7b ? 0 : RETCODE_LEN).toString("utf8");
  return text.replace(/\0+$/, "");
}

function decode55AA(packet: Buffer): string {
  const length = packet.readUInt32BE(12);
  const end = HEADER_LEN_55AA + length;
  if (packet.length < end) throw new Error("truncated 55AA packet");

  let payload = packet.subarray(HEADER_LEN_55AA + RETCODE_LEN, end - CRC_LEN - SUFFIX_LEN);

  // 3.1 devices send plaintext; everything later is ECB under the shared key.
  if (payload[0] === 0x7b) return payload.toString("utf8");
  return decodeEcb(payload);
}

/**
 * Decode a UDP packet into a device announcement.
 *
 * Returns null for anything that is not a Tuya announcement, including our own
 * outbound requests, which we see because we listen on the port we send from.
 */
export function decodeAnnouncement(packet: Buffer): DeviceAnnouncement | null {
  if (packet.length < HEADER_LEN_55AA) return null;

  let text: string;
  try {
    const prefix = packet.readUInt32BE(0);
    if (prefix === PREFIX_6699) {
      // Our own request uses the same framing; ignore it.
      if (packet.readUInt32BE(10) === CMD_REQ_DEVINFO) return null;
      text = decode6699(packet);
    } else if (prefix === PREFIX_55AA) {
      text = decode55AA(packet);
    } else {
      return null;
    }
  } catch {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object") return null;
    const announcement = parsed as DeviceAnnouncement;
    if (typeof announcement.gwId !== "string") return null;
    return announcement;
  } catch {
    return null;
  }
}
