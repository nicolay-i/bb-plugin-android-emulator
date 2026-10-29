import assert from 'node:assert/strict';
import { test } from 'node:test';
import { viewerAddress } from '../contract.ts';
import { hostError } from '../errors.ts';

const addresses = [{ address: '192.168.1.5', kind: 'lan' as const }, { address: '100.79.148.99', kind: 'vpn' as const }];

test('viewerAddress takes the configured address this host owns', () => {
  assert.equal(viewerAddress(addresses, ['100.116.45.50', '100.79.148.99']), '100.79.148.99');
});

test('viewerAddress falls back to the only address and refuses to guess among several', () => {
  assert.equal(viewerAddress([addresses[0]], ['100.116.45.50']), '192.168.1.5');
  assert.throws(() => viewerAddress(addresses, []), /^Error: chooseAddress: 192.168.1.5, 100.79.148.99$/);
  assert.throws(() => viewerAddress(addresses, ['192.168.1.5', '100.79.148.99']), /chooseAddress/);
});

test('hostError takes the first key and its detail', () => {
  assert.deepEqual(hostError('bb android-emulator failed: startFailed: x86 emulation unavailable'),
    { key: 'startFailed', detail: 'x86 emulation unavailable' });
  assert.deepEqual(hostError('noSdk'), { key: 'noSdk' });
  assert.deepEqual(hostError('boom'), { key: 'commandFailed' });
  assert.deepEqual(hostError('hostOffline: llm'), { key: 'hostOffline', detail: 'llm' });
});
