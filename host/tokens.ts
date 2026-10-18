import { randomBytes, timingSafeEqual } from 'node:crypto';

/** One-time viewer tokens that expire after `ttlMs`. */
export class ViewerTokens {
  private tokens = new Map<string, number>();
  private ttlMs: number;

  constructor(ttlMs: number) { this.ttlMs = ttlMs; }

  issue(now = Date.now()): string {
    for (const [token, expires] of this.tokens) if (expires < now) this.tokens.delete(token);
    const token = randomBytes(24).toString('base64url');
    this.tokens.set(token, now + this.ttlMs);
    return token;
  }

  /** Burns a matching token; true only if it had not expired. */
  consume(candidate: string, now = Date.now()): boolean {
    for (const [token, expires] of this.tokens) if (sameToken(token, candidate)) {
      this.tokens.delete(token);
      return expires >= now;
    }
    return false;
  }
}

/** Constant-time comparison over UTF-8 bytes: arbitrary query strings must not reach timingSafeEqual with a length mismatch. */
function sameToken(a: string, b: string): boolean {
  const [x, y] = [Buffer.from(a), Buffer.from(b)];
  return x.length === y.length && timingSafeEqual(x, y);
}
