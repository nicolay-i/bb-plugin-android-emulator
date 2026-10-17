import assert from 'node:assert/strict';
import { test } from 'node:test';
import { keyMessage, textMessage } from '../viewer/keys.ts';
import { h264Codec, parsePacket } from '../viewer/video.ts';

const key = (key: string, mods: Partial<Record<'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'isComposing', boolean>> = {}) =>
  keyMessage({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, isComposing: false, ...mods });

test('printable ASCII is injected as text, other characters through the clipboard', () => {
  assert.deepEqual(key('a'), { t: 'text', text: 'a' });
  assert.deepEqual(key(' '), { t: 'text', text: ' ' });
  assert.deepEqual(key('ж'), { t: 'paste', text: 'ж' });
  assert.deepEqual(key('😀'), { t: 'paste', text: '😀' });
});

test('special keys map to Android keycodes with meta state', () => {
  assert.deepEqual(key('Enter'), { t: 'code', code: 66, meta: 0 });
  assert.deepEqual(key('Backspace'), { t: 'code', code: 67, meta: 0 });
  assert.deepEqual(key('ArrowLeft', { shiftKey: true }), { t: 'code', code: 21, meta: 1 });
  assert.deepEqual(key('Delete', { ctrlKey: true }), { t: 'code', code: 112, meta: 0x1000 });
});

test('Ctrl shortcuts reach Android except Ctrl+V, which the browser paste event handles', () => {
  assert.deepEqual(key('a', { ctrlKey: true }), { t: 'code', code: 29, meta: 0x1000 });
  assert.deepEqual(key('C', { ctrlKey: true, shiftKey: true }), { t: 'code', code: 31, meta: 0x1000 });
  assert.deepEqual(key('z', { ctrlKey: true }), { t: 'code', code: 54, meta: 0x1000 });
  assert.equal(key('v', { ctrlKey: true }), null);
  assert.equal(key('r', { ctrlKey: true }), null);
});

test('keys left to the browser', () => {
  assert.equal(key('Shift'), null);
  assert.equal(key('F5'), null);
  assert.equal(key('a', { metaKey: true }), null);
  assert.equal(key('a', { isComposing: true }), null);
});

test('pasted text uses text injection only for short ASCII', () => {
  assert.equal(textMessage(''), null);
  assert.deepEqual(textMessage('hello'), { t: 'text', text: 'hello' });
  assert.deepEqual(textMessage('Привет'), { t: 'paste', text: 'Привет' });
  assert.deepEqual(textMessage('x'.repeat(301)), { t: 'paste', text: 'x'.repeat(301) });
  assert.equal((textMessage('я'.repeat(70000)) as { text: string }).text.length, 65536);
});

test('parsePacket reads the 10-byte header', () => {
  const bytes = new Uint8Array([1, 1, 0, 0, 0, 0, 0, 0, 0x01, 0x02, 9, 8, 7]);
  const packet = parsePacket(bytes.buffer);
  assert.equal(packet.kind, 1);
  assert.equal(packet.keyframe, true);
  assert.equal(packet.pts, 0x0102);
  assert.deepEqual([...packet.data], [9, 8, 7]);
  assert.throws(() => parsePacket(new Uint8Array(9).buffer));
  assert.throws(() => parsePacket(new Uint8Array([2, 0, 0, 0, 0, 0, 0, 0, 0, 0]).buffer));
});

test('h264Codec builds the codec string from the SPS', () => {
  const config = new Uint8Array([0, 0, 0, 1, 0x67, 0x42, 0xc0, 0x29, 0x8d, 0, 0, 0, 1, 0x68, 0xce]);
  assert.equal(h264Codec(config), 'avc1.42c029');
  assert.throws(() => h264Codec(new Uint8Array([0, 0, 0, 1, 0x68, 0xce, 0x3c, 0x80])));
});
