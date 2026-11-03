import { describe, expect, it } from 'vitest';
import { isPrivateAddress } from './network';
import { MAX_PAIRING_ATTEMPTS, PAIRING_CODE_TTL_MS, PairingCodes, hashToken, newDeviceToken, tokenMatches } from './pairing';

describe('PairingCodes', () => {
  it('issues 6-digit codes that work exactly once', () => {
    const p = new PairingCodes();
    const { code } = p.issue();
    expect(code).toMatch(/^\d{6}$/);
    expect(p.redeem(code)).toBe('ok');
    expect(p.redeem(code)).toBe('none');
  });

  it('expires after 5 minutes', () => {
    let now = 0;
    const p = new PairingCodes(() => now);
    const { code } = p.issue();
    now = PAIRING_CODE_TTL_MS - 1;
    expect(p.current()).not.toBeNull();
    now = PAIRING_CODE_TTL_MS;
    expect(p.current()).toBeNull();
    expect(p.redeem(code)).toBe('expired');
  });

  it(`throws the code away after ${MAX_PAIRING_ATTEMPTS} wrong guesses`, () => {
    const p = new PairingCodes();
    const { code } = p.issue();
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 1; i < MAX_PAIRING_ATTEMPTS; i++) expect(p.redeem(wrong)).toBe('wrong');
    expect(p.redeem(wrong)).toBe('locked');
    expect(p.redeem(code)).toBe('locked'); // even the right code is dead now
    const fresh = p.issue().code;
    expect(p.redeem(fresh)).toBe('ok');
  });

  it('a new code replaces the old one', () => {
    const p = new PairingCodes();
    const first = p.issue().code;
    let second = p.issue().code;
    while (second === first) second = p.issue().code;
    expect(p.redeem(first)).toBe('wrong');
  });
});

describe('device tokens', () => {
  it('are long, random, and only verifiable against their hash', () => {
    const t = newDeviceToken();
    expect(t.length).toBeGreaterThanOrEqual(40);
    expect(newDeviceToken()).not.toBe(t);
    const h = hashToken(t);
    expect(h).not.toContain(t);
    expect(tokenMatches(t, h)).toBe(true);
    expect(tokenMatches(t + 'x', h)).toBe(false);
  });
});

describe('isPrivateAddress', () => {
  it.each([
    '192.168.1.20', '10.0.0.5', '172.16.0.1', '172.31.255.255', '127.0.0.1', '169.254.3.4',
    '::1', '::ffff:192.168.1.20', 'fd12:3456::1', 'fe80::1',
  ])('allows %s', (ip) => expect(isPrivateAddress(ip)).toBe(true));

  it.each(['8.8.8.8', '172.32.0.1', '100.64.0.1', '::ffff:8.8.8.8', '2001:4860::8888', '', undefined])(
    'rejects %s',
    (ip) => expect(isPrivateAddress(ip)).toBe(false),
  );
});
