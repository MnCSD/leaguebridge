export const REDACTED = '[REDACTED]';

/**
 * Keys whose STRING values are hidden. Numbers/booleans pass through: real recordings have lots of
 * harmless fields like `currentTokenBalance: 40` or `PasswordEnabled: true`.
 */
const SECRET_KEY = /token|password|secret|authorization|cookie|jwt/i;

/** A JWT (`eyJ...<dot>...<dot>...`) is a signed credential wherever it appears, whatever the key. */
const JWT_VALUE = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;

/**
 * Endpoints that only carry auth material (Riot account tokens, entitlements, ...).
 * Events from these are dropped from recordings entirely.
 */
const SECRET_URI_PREFIXES = [
  '/entitlements',
  '/lol-rso-auth',
  '/rso-auth',
  '/riotclient/auth',
  '/lol-login',
  '/lol-league-session',
  '/player-account',
  '/lol-summoner/v1/current-summoner/jwt',
];

export function isSecretUri(uri: string): boolean {
  return SECRET_URI_PREFIXES.some((p) => uri.startsWith(p));
}

/**
 * Returns a deep copy of `value` with:
 *  - every value under a secret-looking key replaced by [REDACTED]
 *  - every occurrence of the given secret strings (e.g. the lockfile password) replaced inside strings
 */
export function redactDeep(value: unknown, secrets: readonly string[] = []): unknown {
  const live = secrets.filter((s) => s.length >= 4);

  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') {
      let out = v.replace(JWT_VALUE, REDACTED);
      for (const s of live) out = out.split(s).join(REDACTED);
      return out;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, child] of Object.entries(v)) {
        out[k] = SECRET_KEY.test(k) && typeof child === 'string' && child !== '' ? REDACTED : walk(child);
      }
      return out;
    }
    return v;
  };

  return walk(value);
}
