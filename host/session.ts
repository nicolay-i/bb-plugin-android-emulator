import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { AdbServerClient } from '@yume-chan/adb';
import { AdbServerNodeTcpConnector } from '@yume-chan/adb-server-node-tcp';
import { AdbScrcpyClient, AdbScrcpyOptions3_3_3 } from '@yume-chan/adb-scrcpy';
import { DefaultServerPath, type AndroidKeyCode, type AndroidKeyEventMeta } from '@yume-chan/scrcpy';
import { ReadableStream, WritableStream } from '@yume-chan/stream-extra';
import { viewerMessage, type Listen, type ViewerMessage } from '../contract.js';
import { AndroidError, startAdbServer } from './android.js';
import { SCRCPY_SERVER_BASE64, SCRCPY_SERVER_SHA256 } from './scrcpy-server.js';

const KEYCODES = { back: 4, home: 3, recent: 187 } as const;
const TOKEN_TTL_MS = 60_000;
/** A viewer that falls this far behind skips to the next keyframe instead of buffering. */
const MAX_BUFFERED = 2_000_000;

type Client = Awaited<ReturnType<typeof AdbScrcpyClient.start>>;
type Controller = NonNullable<Client['controller']>;

/** Video packet framing: [kind 0=config 1=frame][keyframe][pts u64][payload]. */
export function frame(kind: 0 | 1, keyframe: boolean, pts: bigint, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(10 + data.length);
  out[0] = kind; out[1] = keyframe ? 1 : 0;
  new DataView(out.buffer).setBigUint64(2, pts);
  out.set(data, 10);
  return out;
}

function serverJar(): Uint8Array {
  const bytes = Buffer.from(SCRCPY_SERVER_BASE64, 'base64');
  if (createHash('sha256').update(bytes).digest('hex') !== SCRCPY_SERVER_SHA256) throw new Error('Embedded scrcpy-server is corrupted');
  return new Uint8Array(bytes);
}

/** One scrcpy-server on one device, fanned out to any number of authorized viewers. */
export class DeviceSession {
  private viewers = new Set<WebSocket>();
  private lagging = new WeakSet<WebSocket>();
  private config: Uint8Array | null = null;
  private clipboard = '';
  closed = false;

  get viewerCount() { return this.viewers.size; }

  private constructor(readonly serial: string, private client: Client, private onEnd: () => void) {}

  static async start(serial: string, onEnd: () => void): Promise<DeviceSession> {
    await startAdbServer();
    const adbClient = new AdbServerClient(new AdbServerNodeTcpConnector({ host: '127.0.0.1', port: 5037 }));
    const device = (await adbClient.getDevices()).find(item => item.serial === serial && item.state === 'device');
    if (!device) throw new AndroidError('unavailable');
    const adb = await adbClient.createAdb(device);
    const jar = serverJar();
    await AdbScrcpyClient.pushServer(adb, new ReadableStream({ start(controller) { controller.enqueue(jar); controller.close(); } }));
    const client = await AdbScrcpyClient.start(adb, DefaultServerPath, new AdbScrcpyOptions3_3_3({
      audio: false, control: true, maxSize: 1280, maxFps: 30, videoBitRate: 4_000_000, clipboardAutosync: true,
    }));
    const session = new DeviceSession(serial, client, onEnd);
    void session.pump();
    return session;
  }

  private async pump() {
    void this.client.output.pipeTo(new WritableStream({ write() {} })).catch(() => {});
    void this.client.clipboard?.pipeTo(new WritableStream({ write: text => {
      this.clipboard = text;
      this.broadcastText({ t: 'clipboard', text });
    } })).catch(() => {});
    try {
      const { stream } = await this.client.videoStream;
      await stream.pipeTo(new WritableStream({ write: packet => {
        if (packet.type === 'configuration') {
          this.config = frame(0, false, 0n, packet.data);
          for (const ws of this.viewers) ws.send(this.config);
          return;
        }
        const message = frame(1, packet.keyframe === true, packet.pts ?? 0n, packet.data);
        for (const ws of this.viewers) this.sendFrame(ws, message, packet.keyframe === true);
      } }));
    } catch {
      // The device went away or the session was closed.
    } finally {
      void this.close();
    }
  }

  private sendFrame(ws: WebSocket, message: Uint8Array, keyframe: boolean) {
    if (this.lagging.has(ws)) {
      if (!keyframe) return;
      this.lagging.delete(ws);
    } else if (ws.bufferedAmount > MAX_BUFFERED) {
      this.lagging.add(ws);
      void this.controller.resetVideo().catch(() => {});
      return;
    }
    ws.send(message);
  }

  private broadcastText(message: object) {
    const text = JSON.stringify(message);
    for (const ws of this.viewers) ws.send(text);
  }

  private get controller(): Controller {
    if (!this.client.controller) throw new Error('scrcpy control is disabled');
    return this.client.controller;
  }

  attach(ws: WebSocket) {
    this.viewers.add(ws);
    if (this.config) ws.send(this.config);
    if (this.clipboard) ws.send(JSON.stringify({ t: 'clipboard', text: this.clipboard }));
    void this.controller.resetVideo().catch(() => {});
    ws.on('close', () => this.viewers.delete(ws));
    ws.on('message', (raw, binary) => {
      const parsed = !binary && raw.toString().length <= 300_000 ? viewerMessage.safeParse(safeJson(raw.toString())) : null;
      if (!parsed?.success) { ws.close(1008, 'invalid message'); return; }
      this.handle(parsed.data).catch(() => ws.send(JSON.stringify({ t: 'error', code: 'commandFailed' })));
    });
  }

  async handle(message: ViewerMessage) {
    const c = this.controller;
    switch (message.t) {
      case 'touch':
        return c.injectTouch({ action: message.action, pointerId: -2n, pointerX: message.x, pointerY: message.y,
          videoWidth: message.w, videoHeight: message.h, pressure: message.action === 1 ? 0 : 1, actionButton: 0, buttons: 0 });
      case 'scroll':
        return c.injectScroll({ pointerX: message.x, pointerY: message.y, videoWidth: message.w, videoHeight: message.h,
          scrollX: message.dx, scrollY: message.dy, buttons: 0 });
      case 'key': return this.key(KEYCODES[message.key], 0);
      case 'code': return this.key(message.code, message.meta);
      case 'text': return c.injectText(message.text);
      case 'paste': return this.paste(message.text);
      case 'rotate': return c.rotateDevice();
    }
  }

  /** keyCode and metaState are validated by the viewer message schema. */
  async key(keyCode: number, metaState: number) {
    for (const action of [0, 1] as const) await this.controller.injectKeyCode({ action, keyCode: keyCode as AndroidKeyCode, repeat: 0, metaState: metaState as AndroidKeyEventMeta });
  }

  /** Clipboard paste types any Unicode text, unlike scrcpy's ASCII-only text injection. */
  paste(text: string) {
    return this.controller.setClipboard({ sequence: 0n, paste: true, content: text });
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    for (const ws of this.viewers) ws.close(4000, 'device session ended');
    this.viewers.clear();
    await this.client.close().catch(() => {});
    this.onEnd();
  }
}

function safeJson(text: string): unknown {
  try { return JSON.parse(text); } catch { return null; }
}

const sameToken = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** HTTP server that only upgrades `/ws?token=…` from the allowed origin; everything else is 404/403. */
export class ViewerEndpoint {
  private tokens = new Map<string, number>();
  private constructor(readonly listen: Listen, private server: Server, private wss: WebSocketServer) {}

  static async start(listen: Listen, session: () => DeviceSession | null): Promise<ViewerEndpoint> {
    const server = createServer((req, res) => {
      req.resume();
      res.writeHead(404, { 'content-type': 'text/plain', connection: 'close' }).end('not found');
    });
    const wss = new WebSocketServer({ noServer: true, maxPayload: 300_000 });
    const endpoint = new ViewerEndpoint(listen, server, wss);
    server.on('upgrade', (req, socket, head) => {
      const url = new URL(req.url ?? '/', 'http://viewer');
      const current = session();
      if (url.pathname !== '/ws' || req.headers.origin !== listen.origin || !endpoint.consume(url.searchParams.get('token') ?? '') || !current) {
        socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
        return;
      }
      wss.handleUpgrade(req, socket, head, ws => current.attach(ws));
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', error => reject((error as NodeJS.ErrnoException).code === 'EADDRINUSE' ? new AndroidError('portBusy') : error));
      server.listen(listen.port, listen.bind === 'loopback' ? '127.0.0.1' : listen.bind, () => resolve());
    });
    return endpoint;
  }

  issueToken(): string {
    const now = Date.now();
    for (const [token, expires] of this.tokens) if (expires < now) this.tokens.delete(token);
    const token = randomBytes(24).toString('base64url');
    this.tokens.set(token, now + TOKEN_TTL_MS);
    return token;
  }

  private consume(candidate: string): boolean {
    for (const [token, expires] of this.tokens) if (sameToken(token, candidate)) {
      this.tokens.delete(token);
      return expires >= Date.now();
    }
    return false;
  }

  sameAs(listen: Listen) {
    return this.listen.bind === listen.bind && this.listen.port === listen.port && this.listen.origin === listen.origin;
  }

  async close() {
    for (const ws of this.wss.clients) ws.close(4001, 'viewer endpoint closed');
    const closed = new Promise<void>(resolve => this.server.close(() => resolve()));
    this.server.closeAllConnections();
    await closed;
  }
}
