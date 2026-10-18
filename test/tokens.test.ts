import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ViewerTokens } from '../host/tokens.ts';

test('ViewerTokens: a token works once', () => {
  const tokens = new ViewerTokens(60_000);
  const token = tokens.issue();
  assert.equal(tokens.consume(token), true);
  assert.equal(tokens.consume(token), false);
});

test('ViewerTokens: expired token is rejected and burned', () => {
  const tokens = new ViewerTokens(60_000);
  const token = tokens.issue(0);
  assert.equal(tokens.consume(token, 60_001), false);
  assert.equal(tokens.consume(token, 0), false);
});

test('ViewerTokens: same UTF-16 length but different byte length is rejected without throwing', () => {
  const tokens = new ViewerTokens(60_000);
  const token = tokens.issue();
  assert.equal(tokens.consume('é'.repeat(token.length)), false);
  assert.equal(tokens.consume(token), true);
});
