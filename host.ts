import { join } from 'node:path';
import { experimental_defineHostEntry, type ExperimentalHostWorkerLease } from '@get-bb/plugin-sdk/host';
import { hostContract } from './contract.js';
import * as android from './host/android.js';
import { DeviceSession, ViewerEndpoint } from './host/session.js';

/** Close a scrcpy session nobody has watched for this long; the emulator keeps running. */
const IDLE_MS = 120_000;

let session: DeviceSession | null = null;
let starting: Promise<DeviceSession> | null = null;
let endpoint: ViewerEndpoint | null = null;
let lease: ExperimentalHostWorkerLease | null = null;
let idleSince = 0;
let idleTimer: ReturnType<typeof setInterval> | null = null;

async function release() {
  const current = lease;
  lease = null;
  if (idleTimer) clearInterval(idleTimer);
  idleTimer = null;
  await current?.dispose();
}

async function closeAll() {
  const [currentEndpoint, currentSession] = [endpoint, session];
  endpoint = null;
  session = null;
  await currentEndpoint?.close();
  await currentSession?.close();
  await release();
}

/** One device is active per host; switching devices replaces the scrcpy session. */
async function ensureSession(serial: string, retain: () => ExperimentalHostWorkerLease): Promise<DeviceSession> {
  if (session?.serial === serial && !session.closed) return session;
  if (starting) await starting.catch(() => {});
  if (session?.serial === serial && !session.closed) return session;
  await session?.close();
  // A device that goes away takes its viewer endpoint and worker lease with it.
  starting = DeviceSession.start(serial, () => { if (session === next) void closeAll(); });
  let next: DeviceSession;
  try { next = await starting; } finally { starting = null; }
  session = next;
  lease ??= retain();
  idleSince = Date.now();
  idleTimer ??= setInterval(() => {
    if (!session) return;
    if (session.viewerCount > 0) idleSince = Date.now();
    else if (Date.now() - idleSince > IDLE_MS) void closeAll();
  }, 10_000);
  return next;
}

export default experimental_defineHostEntry({
  contract: hostContract,
  handlers: {
    state: () => android.state(session && !session.closed ? session.serial : null),
    start: ({ avd }, context) => android.start(avd, join(context.experimental_paths.dataDir, 'logs')),
    stop: async ({ serial }) => {
      if (session?.serial === serial) await closeAll();
      await android.stop(serial);
      return null;
    },
    open: async ({ serial, listen }, context) => {
      await ensureSession(serial, () => context.experimental_retainWorker());
      if (endpoint && !endpoint.sameAs(listen)) { await endpoint.close(); endpoint = null; }
      endpoint ??= await ViewerEndpoint.start(listen, () => session);
      return { port: listen.port, token: endpoint.issueToken() };
    },
    close: async () => { await closeAll(); return null; },
    key: async ({ serial, key }, context) => {
      await (await ensureSession(serial, () => context.experimental_retainWorker())).handle({ t: 'key', key });
      return null;
    },
    paste: async ({ serial, text }, context) => {
      await (await ensureSession(serial, () => context.experimental_retainWorker())).paste(text);
      return null;
    },
  },
  dispose: closeAll,
});
