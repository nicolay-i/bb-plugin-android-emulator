import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync, closeSync, readFileSync } from 'node:fs';
import { homedir, networkInterfaces } from 'node:os';
import { join } from 'node:path';
import type { HostState } from '../contract.js';

/** Errors whose message is an i18n key the panel can translate. */
export class AndroidError extends Error {}

const exe = (name: string) => (process.platform === 'win32' ? `${name}.exe` : name);

/** The standard SDK locations used by Android Studio and the command-line tools. */
export function sdkRoot(env = process.env, platform = process.platform, home = homedir()): string | null {
  const candidates = [env.ANDROID_HOME, env.ANDROID_SDK_ROOT,
    platform === 'win32' ? env.LOCALAPPDATA && join(env.LOCALAPPDATA, 'Android', 'Sdk')
      : platform === 'darwin' ? join(home, 'Library', 'Android', 'sdk') : join(home, 'Android', 'Sdk')];
  return candidates.find((path): path is string => Boolean(path && existsSync(path))) ?? null;
}

interface Tools { root: string; adb: string; emulator: string }
function tools(): Tools {
  const root = sdkRoot();
  if (!root) throw new AndroidError('noSdk');
  return { root, adb: join(root, 'platform-tools', exe('adb')), emulator: join(root, 'emulator', exe('emulator')) };
}

interface Run { code: number; stdout: string; stderr: string }
function run(file: string, args: string[], timeout = 15000): Promise<Run> {
  return new Promise(resolve => {
    execFile(file, args, { timeout, windowsHide: true, maxBuffer: 1 << 20 }, (error, stdout, stderr) => {
      const code = error ? (typeof error.code === 'number' ? error.code : -1) : 0;
      resolve({ code, stdout: String(stdout), stderr: String(stderr || (error && !stdout ? error.message : '')) });
    });
  });
}

const withoutEmulatorNoise = (text: string) => text.split(/\r?\n/).filter(line => line.trim() && !/^(INFO|WARNING)\s*\|/.test(line));

/** `emulator -accel-check` prints `accel:`, a status code (0 = usable), a message and `accel`. */
export function parseAccelCheck(output: string): { ok: boolean; detail: string } {
  const lines = withoutEmulatorNoise(output).map(line => line.trim());
  const start = lines.indexOf('accel:');
  const end = lines.lastIndexOf('accel');
  if (start < 0 || end <= start + 1) return { ok: false, detail: lines.join(' ').slice(0, 300) || 'no output' };
  const ok = lines[start + 1] === '0';
  const detail = lines.slice(start + 2, end).join(' ');
  // The emulator glues advisory sentences to the status without a space ("…reboot.WHPX … is usable.");
  // a usable accelerator reports only its final sentence.
  return { ok, detail: (ok ? detail.split(/(?<=\.)(?=[A-Z])/).at(-1)! : detail).slice(0, 300) };
}

/** Why the emulator quit at start: its ERROR/FATAL lines, else the last lines it printed, without level prefixes. */
export function startFailure(log: string): string {
  const lines = log.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const errors = lines.filter(line => /^(ERROR|FATAL|PANIC)\s*\|/.test(line));
  const picked = errors.length ? errors.slice(0, 2) : lines.slice(-2);
  return picked.map(line => line.replace(/^[A-Z]+\s*\|\s*/, '')).join(' ').slice(0, 300);
}

/** `adb devices` lines: `<serial>\t<state>`. */
export function parseDevices(output: string): { serial: string; state: string }[] {
  return output.split(/\r?\n/).slice(1).map(line => line.trim().split(/\s+/))
    .filter(parts => parts.length >= 2 && /^[\w.:-]{1,64}$/.test(parts[0]))
    .map(([serial, state]) => ({ serial, state }));
}

const isPrivate = (a: number, b: number) => a === 10 || (a === 172 && b >= 16 && b < 32) || (a === 192 && b === 168);
const isCgnat = (a: number, b: number) => a === 100 && b >= 64 && b < 128;

/** IPv4 addresses a LAN or VPN viewer can reach: RFC 1918 and the 100.64/10 range used by Tailscale. */
export function viewerAddresses(interfaces = networkInterfaces()): HostState['addresses'] {
  const result: HostState['addresses'] = [];
  for (const entries of Object.values(interfaces)) for (const entry of entries ?? []) {
    if (entry.family !== 'IPv4' || entry.internal) continue;
    const [a, b] = entry.address.split('.').map(Number);
    if (isPrivate(a, b)) result.push({ address: entry.address, kind: 'lan' });
    else if (isCgnat(a, b)) result.push({ address: entry.address, kind: 'vpn' });
  }
  return result;
}

export async function adbPath(): Promise<string> {
  const { adb } = tools();
  if (!existsSync(adb)) throw new AndroidError('noAdb');
  return adb;
}

export async function startAdbServer(): Promise<void> {
  const result = await run(await adbPath(), ['start-server'], 20000);
  if (result.code !== 0) throw new AndroidError(`adbFailed: ${(result.stderr || result.stdout).trim().slice(0, 300)}`);
}

async function avdOf(adb: string, serial: string): Promise<string | null> {
  if (!serial.startsWith('emulator-')) return null;
  const { code, stdout } = await run(adb, ['-s', serial, 'emu', 'avd', 'name'], 5000);
  return code === 0 ? stdout.split(/\r?\n/)[0].trim() || null : null;
}

export async function devices(): Promise<HostState['devices']> {
  const adb = await adbPath();
  await startAdbServer();
  const result = await run(adb, ['devices']);
  if (result.code !== 0) throw new AndroidError('listFailed');
  return Promise.all(parseDevices(result.stdout).map(async device => ({ ...device, avd: await avdOf(adb, device.serial) })));
}

export async function state(active: string | null): Promise<HostState> {
  const root = sdkRoot();
  const base = { platform: process.platform, sdkRoot: root, addresses: viewerAddresses(), active };
  if (!root) return { ...base, checks: [{ id: 'sdk', ok: false, detail: 'ANDROID_HOME' }], avds: [], devices: [] };
  const { adb, emulator } = tools();
  const checks: HostState['checks'] = [{ id: 'sdk', ok: true, detail: root }];
  const hasAdb = existsSync(adb), hasEmulator = existsSync(emulator);
  checks.push({ id: 'adb', ok: hasAdb, detail: adb });
  checks.push({ id: 'emulator', ok: hasEmulator, detail: emulator });
  let avds: string[] = [];
  if (hasEmulator) {
    const [accel, list] = await Promise.all([run(emulator, ['-accel-check'], 20000), run(emulator, ['-list-avds'])]);
    checks.push({ id: 'accel', ...parseAccelCheck(accel.stdout + '\n' + accel.stderr) });
    avds = withoutEmulatorNoise(list.stdout).map(line => line.trim()).filter(name => /^[\w.-]{1,200}$/.test(name));
    checks.push({ id: 'avds', ok: avds.length > 0, detail: String(avds.length) });
  }
  return { ...base, checks, avds, devices: hasAdb ? await devices() : [] };
}

export async function start(avd: string, logDir: string): Promise<{ log: string }> {
  const { emulator } = tools();
  const current = await state(null);
  if (!current.avds.includes(avd)) throw new AndroidError('unknownAvd');
  if (current.devices.some(device => device.avd === avd)) throw new AndroidError('alreadyRunning');
  mkdirSync(logDir, { recursive: true });
  const log = join(logDir, `emulator-${avd}.log`);
  const fd = openSync(log, 'w');
  // The panel is the only screen, so the emulator runs without its own window.
  const child = spawn(emulator, ['-avd', avd, '-no-window', '-no-audio', '-no-boot-anim'],
    { detached: true, stdio: ['ignore', fd, fd], windowsHide: true });
  closeSync(fd);
  // null while the emulator keeps running; otherwise why it stopped.
  const failure = await new Promise<string | null>(resolve => {
    const timer = setTimeout(() => resolve(null), 3000);
    child.once('exit', () => { clearTimeout(timer); resolve(startFailure(readFileSync(log, 'utf8'))); });
    child.once('error', error => { clearTimeout(timer); resolve(error.message); });
  });
  if (failure !== null) throw new AndroidError(failure ? `startFailed: ${failure}` : 'startFailed');
  child.unref();
  return { log };
}

export async function stop(serial: string): Promise<void> {
  if (!serial.startsWith('emulator-')) throw new AndroidError('notEmulator');
  const result = await run(await adbPath(), ['-s', serial, 'emu', 'kill'], 10000);
  if (result.code !== 0) throw new AndroidError('commandFailed');
}
