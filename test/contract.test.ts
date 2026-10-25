import assert from 'node:assert/strict';
import { test } from 'node:test';
import { viewerAddress } from '../contract.ts';

const addresses = [{ address: '192.168.1.5', kind: 'lan' as const }, { address: '100.79.148.99', kind: 'vpn' as const }];

test('viewerAddress takes the configured address this host owns', () => {
  assert.equal(viewerAddress(addresses, '100.116.45.50, 100.79.148.99'), '100.79.148.99');
});

test('viewerAddress falls back to the only address and refuses to guess among several', () => {
  assert.equal(viewerAddress([addresses[0]], '100.116.45.50'), '192.168.1.5');
  assert.throws(() => viewerAddress(addresses, ''), /chooseAddress/);
  assert.throws(() => viewerAddress(addresses, '192.168.1.5,100.79.148.99'), /chooseAddress/);
});
