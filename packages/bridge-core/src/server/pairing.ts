import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

export const PAIRING_CODE_TTL_MS = 5 * 60_000;
/** Wrong guesses allowed per code before it's thrown away (a 6-digit code has 1,000,000 values). */
export const MAX_PAIRING_ATTEMPTS = 5;

/** 32 random bytes as URL-safe text: unguessable, so a fast hash is enough to store it. */
export function newDeviceToken() {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

/** Compares in constant time, so response timing can't leak how much of a hash matched. */
export function tokenMatches(token: string, storedHash: string) {
  const a = Buffer.from(hashToken(token), 'hex');
  const b = Buffer.from(storedHash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

export type PairingCheck = 'ok' | 'wrong' | 'expired' | 'none' | 'locked';

/**
 * The 6-digit pairing code. Single use, expires after 5 minutes, and is discarded after
 * MAX_PAIRING_ATTEMPTS wrong guesses. Only one code is valid at a time.
 */
export class PairingCodes {
  private code: string | null = null;
  private expiresAt = 0;
  private wrongGuesses = 0;
  private ended: 'used' | 'locked' | null = null;

  constructor(private readonly now: () => number = Date.now) {}

  /** Creates a fresh code (invalidating any previous one). */
  issue(): { code: string; expiresAt: number } {
    this.code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    this.expiresAt = this.now() + PAIRING_CODE_TTL_MS;
    this.wrongGuesses = 0;
    this.ended = null;
    return { code: this.code, expiresAt: this.expiresAt };
  }

  /** Why there is (or isn't) a usable code, for the UI. */
  status(): 'active' | 'used' | 'locked' | 'expired' | 'none' {
    if (this.code && this.now() < this.expiresAt) return 'active';
    if (this.ended) return this.ended;
    return this.expiresAt > 0 ? 'expired' : 'none';
  }

  current(): { code: string; expiresAt: number } | null {
    if (!this.code || this.now() >= this.expiresAt) return null;
    return { code: this.code, expiresAt: this.expiresAt };
  }

  /** Checks a guess. A correct guess consumes the code. */
  redeem(guess: string): PairingCheck {
    if (!this.code) return this.wrongGuesses >= MAX_PAIRING_ATTEMPTS ? 'locked' : 'none';
    if (this.now() >= this.expiresAt) {
      this.code = null;
      return 'expired';
    }
    const ok = guess.length === this.code.length && timingSafeEqual(Buffer.from(guess), Buffer.from(this.code));
    if (ok) {
      this.code = null;
      this.ended = 'used';
      return 'ok';
    }
    this.wrongGuesses++;
    if (this.wrongGuesses >= MAX_PAIRING_ATTEMPTS) {
      this.code = null;
      this.ended = 'locked';
      return 'locked';
    }
    return 'wrong';
  }
}
