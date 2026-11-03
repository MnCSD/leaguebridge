import { describe, expect, it } from 'vitest';
import { isSecretUri, redactDeep, REDACTED } from './redact';

describe('redactDeep', () => {
  it('hides values under secret-looking keys', () => {
    expect(redactDeep({ accessToken: 'x', nested: { password: 'y', ok: 1 } })).toEqual({
      accessToken: REDACTED,
      nested: { password: REDACTED, ok: 1 },
    });
  });

  it('hides JWTs under any key, and jwt-named keys', () => {
    const jwt = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ4In0.c2lnbmF0dXJl';
    const out = redactDeep({ chatDetails: { mucJwtDto: { jwt } }, note: `bearer ${jwt}` });
    expect(JSON.stringify(out)).not.toContain('eyJ');
  });

  it('keeps numeric and boolean fields with token-ish names', () => {
    const input = { currentTokenBalance: 40, PasswordEnabled: true, challengeTokensSelected: [1, 2] };
    expect(redactDeep(input)).toEqual(input);
  });

  it('removes known secret strings anywhere', () => {
    const out = redactDeep({ a: ['url?pw=hunter22'], b: 'hunter22' }, ['hunter22']);
    expect(JSON.stringify(out)).not.toContain('hunter22');
  });

  it('leaves normal data alone and does not mutate input', () => {
    const input = { championId: 103, cells: [{ cellId: 1 }] };
    expect(redactDeep(input)).toEqual(input);
    expect(redactDeep(input)).not.toBe(input);
  });
});

describe('isSecretUri', () => {
  it('flags auth endpoints only', () => {
    expect(isSecretUri('/entitlements/v1/token')).toBe(true);
    expect(isSecretUri('/lol-champ-select/v1/session')).toBe(false);
  });
});
