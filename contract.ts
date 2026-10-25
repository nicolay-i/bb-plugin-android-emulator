import { defineRpcContract } from '@get-bb/plugin-sdk';
import { z } from 'zod';

export const serial = z.string().regex(/^[\w.:-]{1,64}$/);
export const avdName = z.string().regex(/^[\w.-]{1,200}$/);
export const keyName = z.enum(['back', 'home', 'recent']);
export const transport = z.enum(['bb', 'network']);
const pasteText = z.string().min(1).max(65536);
const origin = z.url().refine(value => new URL(value).origin === value, 'Expected an origin');

const check = z.object({ id: z.enum(['sdk', 'adb', 'emulator', 'accel', 'avds']), ok: z.boolean(), detail: z.string() }).strict();
const device = z.object({ serial, state: z.string(), avd: z.string().nullable() }).strict();
export const hostState = z.object({
  platform: z.string(),
  sdkRoot: z.string().nullable(),
  checks: z.array(check),
  avds: z.array(z.string()),
  devices: z.array(device),
  addresses: z.array(z.object({ address: z.string(), kind: z.enum(['lan', 'vpn']) }).strict()),
  active: serial.nullable(),
}).strict();
export type HostState = z.infer<typeof hostState>;

/**
 * The LAN/VPN address the viewer listens on: the one configured address (comma-separated list, one per host)
 * that belongs to this host, or the host's only address when none of the configured ones does.
 */
export function viewerAddress(addresses: HostState['addresses'], configured: string): string {
  const candidates = addresses.map(item => item.address);
  const listed = configured.split(/[\s,]+/).filter(address => candidates.includes(address));
  if (listed.length === 1) return listed[0];
  if (listed.length === 0 && candidates.length === 1) return candidates[0];
  throw new Error(`chooseAddress: ${candidates.join(', ')}`);
}

/** Where the viewer endpoint on the Android host listens and which page may use it. */
export const listen = z.object({
  bind: z.union([z.literal('loopback'), z.ipv4()]),
  port: z.number().int().min(1024).max(65535),
  origin,
}).strict();
export type Listen = z.infer<typeof listen>;

export const hostContract = defineRpcContract({
  state: { input: z.null(), output: hostState },
  start: { input: z.object({ avd: avdName }).strict(), output: z.object({ log: z.string() }).strict() },
  stop: { input: z.object({ serial }).strict(), output: z.null() },
  /** Start or reuse the scrcpy session and viewer endpoint; returns a one-time viewer token. */
  open: { input: z.object({ serial, listen }).strict(), output: z.object({ port: z.number(), token: z.string() }).strict() },
  close: { input: z.null(), output: z.null() },
  key: { input: z.object({ serial, key: keyName }).strict(), output: z.null() },
  paste: { input: z.object({ serial, text: pasteText }).strict(), output: z.null() },
});

const hostId = z.string().min(1).max(100);
export const rpcContract = defineRpcContract({
  config: { input: z.null(), output: z.object({ language: z.string(), transport, hostId: hostId.nullable() }).strict() },
  hosts: { input: z.null(), output: z.array(z.object({ id: hostId, name: z.string(), online: z.boolean() }).strict()) },
  select: { input: z.object({ hostId }).strict(), output: z.null() },
  state: { input: z.object({ hostId }).strict(), output: hostState },
  start: { input: z.object({ hostId, avd: avdName }).strict(), output: z.object({ log: z.string() }).strict() },
  stop: { input: z.object({ hostId, serial }).strict(), output: z.null() },
  /** Returns the WebSocket URL the browser connects to directly. */
  open: { input: z.object({ hostId, serial, origin }).strict(), output: z.object({ url: z.string() }).strict() },
  close: { input: z.object({ hostId }).strict(), output: z.null() },
});

/** Viewer → host WebSocket messages. Coordinates are in video pixels. */
export const viewerMessage = z.discriminatedUnion('t', [
  z.object({ t: z.literal('touch'), action: z.union([z.literal(0), z.literal(1), z.literal(2)]), x: z.number().int(), y: z.number().int(), w: z.number().int().positive(), h: z.number().int().positive() }).strict(),
  z.object({ t: z.literal('scroll'), x: z.number().int(), y: z.number().int(), w: z.number().int().positive(), h: z.number().int().positive(), dx: z.number().min(-16).max(16), dy: z.number().min(-16).max(16) }).strict(),
  z.object({ t: z.literal('key'), key: keyName }).strict(),
  z.object({ t: z.literal('code'), code: z.number().int().min(0).max(400), meta: z.number().int().min(0).max(0x7fffffff) }).strict(),
  z.object({ t: z.literal('text'), text: z.string().min(1).max(300) }).strict(),
  z.object({ t: z.literal('paste'), text: pasteText }).strict(),
  z.object({ t: z.literal('rotate') }).strict(),
]);
export type ViewerMessage = z.infer<typeof viewerMessage>;
