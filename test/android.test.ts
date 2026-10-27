import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { parseAccelCheck, parseDevices, sdkRoot, startFailure, viewerAddresses } from '../host/android.ts';

test('parseAccelCheck: usable WHPX among emulator noise', () => {
  const output = [
    'INFO    | Android emulator version 34.2.15.0',
    'accel:',
    '0',
    'WHPX(10.0.26200) is installed and usable.',
    'accel',
  ].join('\r\n');
  assert.deepEqual(parseAccelCheck(output), { ok: true, detail: 'WHPX(10.0.26200) is installed and usable.' });
});

test('parseAccelCheck: usable WHPX drops the glued Hyper-V advice', () => {
  const output = "accel:\r\n0\r\nPlease disable Hyper-V before using the Android Emulator.  Start a command prompt as Administrator, run 'bcdedit /set hypervisorlaunchtype off', reboot.WHPX (10.0.26200) is installed and usable.\r\naccel\r\n";
  assert.deepEqual(parseAccelCheck(output), { ok: true, detail: 'WHPX (10.0.26200) is installed and usable.' });
});

test('parseAccelCheck: KVM missing', () => {
  const output = 'accel:\n9\n/dev/kvm is not found: VT disabled in BIOS or KVM kernel module not loaded\naccel\n';
  assert.deepEqual(parseAccelCheck(output), { ok: false, detail: '/dev/kvm is not found: VT disabled in BIOS or KVM kernel module not loaded' });
});

test('parseAccelCheck: unexpected output fails with a bounded detail', () => {
  assert.deepEqual(parseAccelCheck(''), { ok: false, detail: 'no output' });
  const result = parseAccelCheck('x'.repeat(1000));
  assert.equal(result.ok, false);
  assert.equal(result.detail.length, 300);
});

test('parseDevices skips the header and malformed serials', () => {
  const output = 'List of devices attached\r\nemulator-5554\tdevice\r\n192.168.1.30:5555\toffline\r\n* daemon started\r\nbad/serial\tdevice\r\n\r\n';
  assert.deepEqual(parseDevices(output), [
    { serial: 'emulator-5554', state: 'device' },
    { serial: '192.168.1.30:5555', state: 'offline' },
  ]);
});

test('viewerAddresses keeps RFC 1918 as LAN and 100.64/10 as VPN', () => {
  const entry = (address: string, internal = false, family: 'IPv4' | 'IPv6' = 'IPv4') =>
    ({ address, internal, family, netmask: '', mac: '', cidr: null }) as never;
  assert.deepEqual(viewerAddresses({
    lo: [entry('127.0.0.1', true)],
    eth: [entry('192.168.1.20'), entry('fe80::1', false, 'IPv6')],
    corp: [entry('10.1.2.3'), entry('172.16.0.1'), entry('172.32.0.1')],
    ts: [entry('100.64.0.10'), entry('100.128.0.1')],
    wan: [entry('8.8.8.8')],
  }), [
    { address: '192.168.1.20', kind: 'lan' },
    { address: '10.1.2.3', kind: 'lan' },
    { address: '172.16.0.1', kind: 'lan' },
    { address: '100.64.0.10', kind: 'vpn' },
  ]);
});

test('sdkRoot prefers ANDROID_HOME, then ANDROID_SDK_ROOT, then the platform default', () => {
  const base = mkdtempSync(join(tmpdir(), 'bbae-sdk-'));
  const home = join(base, 'home'), root = join(base, 'root'), local = join(base, 'local');
  for (const path of [home, root, join(local, 'Android', 'Sdk'), join(base, 'Android', 'Sdk')]) mkdirSync(path, { recursive: true });
  assert.equal(sdkRoot({ ANDROID_HOME: home, ANDROID_SDK_ROOT: root }, 'linux', base), home);
  assert.equal(sdkRoot({ ANDROID_HOME: join(base, 'missing'), ANDROID_SDK_ROOT: root }, 'linux', base), root);
  assert.equal(sdkRoot({ LOCALAPPDATA: local }, 'win32', base), join(local, 'Android', 'Sdk'));
  assert.equal(sdkRoot({}, 'linux', base), join(base, 'Android', 'Sdk'));
  assert.equal(sdkRoot({}, 'darwin', base), null);
});

test('startFailure prefers ERROR/FATAL lines, else the last lines', () => {
  assert.equal(startFailure('INFO    | boot\nERROR   | x86_64 emulation currently requires hardware acceleration!\nFATAL   | KVM is not usable\n'),
    'x86_64 emulation currently requires hardware acceleration! KVM is not usable');
  assert.equal(startFailure('INFO    | boot\nfirst\nsecond\nthird\nWARNING | late\n'), 'third late');
  assert.equal(startFailure('INFO    | boot\nWARNING | last diagnostic\n'), 'boot last diagnostic');
  assert.equal(startFailure(''), '');
});
