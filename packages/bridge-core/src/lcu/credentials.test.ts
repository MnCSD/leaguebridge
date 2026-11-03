import { describe, expect, it } from 'vitest';
import { parseCommandLine, parseLockfile } from './credentials';

describe('parseLockfile', () => {
  it('parses a valid lockfile', () => {
    expect(parseLockfile('LeagueClient:12345:54321:abcDEF-123_x:https\n')).toEqual({
      port: 54321,
      password: 'abcDEF-123_x',
      pid: 12345,
      source: 'lockfile',
    });
  });

  it('rejects malformed files', () => {
    expect(() => parseLockfile('')).toThrow();
    expect(() => parseLockfile('LeagueClient:1:notaport:pw:https')).toThrow(/port/);
    expect(() => parseLockfile('LeagueClient:1:2:pw:http')).toThrow(/protocol/);
  });

  it('does not put the password in error messages', () => {
    try {
      parseLockfile('LeagueClient:1:2:supersecret:http');
    } catch (err) {
      expect((err as Error).message).not.toContain('supersecret');
    }
  });
});

describe('parseCommandLine', () => {
  it('extracts port and token', () => {
    const cmd = '"C:/Riot Games/League of Legends/LeagueClientUx.exe" "--remoting-auth-token=Tok_3n-x" "--app-port=61234" --foo';
    expect(parseCommandLine(cmd)).toEqual({ port: 61234, password: 'Tok_3n-x', pid: null, source: 'process' });
  });

  it('returns null when flags are missing', () => {
    expect(parseCommandLine('LeagueClientUx.exe --app-port=1')).toBeNull();
  });
});
