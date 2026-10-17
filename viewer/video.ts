/** Parsed host video packet; see `frame` in host/session.ts. */
export interface Packet { kind: 0 | 1; keyframe: boolean; pts: number; data: Uint8Array }

export function parsePacket(buffer: ArrayBuffer): Packet {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 10 || bytes[0] > 1) throw new Error('Invalid video packet');
  return { kind: bytes[0] as 0 | 1, keyframe: bytes[1] === 1, pts: Number(new DataView(buffer).getBigUint64(2)), data: bytes.subarray(10) };
}

/** WebCodecs codec string from the H.264 SPS (NAL type 7) in an Annex B configuration packet. */
export function h264Codec(config: Uint8Array): string {
  for (let i = 0; i + 6 < config.length; i++) {
    if (config[i] === 0 && config[i + 1] === 0 && config[i + 2] === 1 && (config[i + 3] & 31) === 7)
      return 'avc1.' + [config[i + 4], config[i + 5], config[i + 6]].map(byte => byte.toString(16).padStart(2, '0')).join('');
  }
  throw new Error('No H.264 SPS in configuration');
}

/** Decodes host packets onto a canvas; waits for a keyframe after every (re)configuration. */
export class VideoPlayer {
  private decoder: VideoDecoder | null = null;
  private config: Uint8Array | null = null;
  private waitingForKey = true;
  frames = 0;
  private canvas: HTMLCanvasElement;
  private onError: (error: Error) => void;
  private onFirstFrame: () => void;

  constructor(canvas: HTMLCanvasElement, onError: (error: Error) => void, onFirstFrame: () => void) {
    this.canvas = canvas;
    this.onError = onError;
    this.onFirstFrame = onFirstFrame;
  }

  push(packet: Packet) {
    if (packet.kind === 0) return this.configure(packet.data);
    if (!this.decoder || this.decoder.state !== 'configured' || !this.config) return;
    if (this.waitingForKey && !packet.keyframe) return;
    this.waitingForKey = false;
    // scrcpy sends SPS/PPS separately; WebCodecs needs them in front of each keyframe.
    const data = packet.keyframe ? concat(this.config, packet.data) : packet.data;
    this.decoder.decode(new EncodedVideoChunk({ type: packet.keyframe ? 'key' : 'delta', timestamp: packet.pts, data }));
  }

  private configure(config: Uint8Array) {
    this.close();
    this.config = config.slice();
    this.waitingForKey = true;
    const context = this.canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D is unavailable');
    this.decoder = new VideoDecoder({
      output: frame => {
        if (this.canvas.width !== frame.displayWidth || this.canvas.height !== frame.displayHeight) {
          this.canvas.width = frame.displayWidth;
          this.canvas.height = frame.displayHeight;
        }
        context.drawImage(frame, 0, 0);
        frame.close();
        if (this.frames++ === 0) this.onFirstFrame();
      },
      error: error => this.onError(error),
    });
    this.decoder.configure({ codec: h264Codec(this.config), optimizeForLatency: true });
  }

  close() {
    if (this.decoder && this.decoder.state !== 'closed') this.decoder.close();
    this.decoder = null;
  }
}

function concat(a: Uint8Array, b: Uint8Array) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}
