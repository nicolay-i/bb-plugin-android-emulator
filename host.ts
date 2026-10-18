import { join } from 'node:path';
import { experimental_defineHostEntry, type ExperimentalHostWorkerLease } from '@get-bb/plugin-sdk/host';
import { hostContract } from './contract.js';
import * as android from './host/android.js';
import { DeviceSession, ViewerEndpoint } from './host/session.js';

/** Close a scrcpy session nobody has watched for this long; the emulator keeps running. */
const IDLE_MS = 120_000;

let session: DeviceSession | null = null;
let endpoint: ViewerEndpoint | null = null;
let lease: ExperimentalHostWorkerLease | null = null;
let idleTimer: ReturnType<typeof setInterval> | null = null;

/** Session, endpoint and lease change one operation at a time; the host worker runs handlers concurrently. */
let queue: Promise<unknown> = Promise.resolve();
function serialized<T>(work: () => Promise<T>): Promise<T> {
  const run = queue.then(work, work);
  queue = run.catch(() => {});
  return run;
}

async function closeAll() {
  const [currentEndpoint, currentSession, currentLease] = [endpoint, session, lease];
  endpoint = null;
  session = null;
  lease = null;
  if (idleTimer) clearInterval(idleTimer);
  idleTimer = null;
  await currentEndpoint?.close();
  await currentSession?.close();
  await currentLease?.dispose();
}

/** Close only while `target` is still active, so a later session keeps its endpoint, lease and timer. */
const closeIfCurrent = (target: DeviceSession) => serialized(async () => { if (session === target) await closeAll(); });

/** One device is active per host; switching devices replaces the scrcpy session. Runs inside `serialized`. */
async function switchTo(serial: string, retain: () => ExperimentalHostWorkerLease): Promise<DeviceSession> {
  if (session?.serial === serial && !session.closed) return session;
  await closeAll();
  // A device that goes away takes its viewer endpoint and worker lease with it; onEnd fires only after start returns.
  const started: DeviceSession = await DeviceSession.start(serial, () => void closeIfCurrent(started));
  session = started;
  lease = retain();
  let idleSince = Date.now();
  idleTimer = setInterval(() => {
    if (started.viewerCount > 0) idleSince = Date.now();
    else if (Date.now() - idleSince > IDLE_MS) void closeIfCurrent(started);
  }, 10_000);
  return started;
}

export default experimental_defineHostEntry({
  contract: hostContract,
  handlers: {
    state: () => android.state(session && !session.closed ? session.serial : null),
    start: ({ avd }, context) => android.start(avd, join(context.experimental_paths.dataDir, 'logs')),
    stop: async ({ serial }) => {
      await serialized(async () => { if (session?.serial === serial) await closeAll(); });
      await android.stop(serial);
      return null;
    },
    open: ({ serial, listen }, context) => serialized(async () => {
      await switchTo(serial, () => context.experimental_retainWorker());
      if (endpoint && !endpoint.sameAs(listen)) { await endpoint.close(); endpoint = null; }
      endpoint ??= await ViewerEndpoint.start(listen, () => session);
      return { port: listen.port, token: endpoint.issueToken() };
    }),
    close: async () => { await serialized(closeAll); return null; },
    key: async ({ serial, key }, context) => {
      const target = await serialized(() => switchTo(serial, () => context.experimental_retainWorker()));
      await target.handle({ t: 'key', key });
      return null;
    },
    paste: async ({ serial, text }, context) => {
      const target = await serialized(() => switchTo(serial, () => context.experimental_retainWorker()));
      await target.paste(text);
      return null;
    },
  },
  dispose: () => serialized(closeAll),
});
