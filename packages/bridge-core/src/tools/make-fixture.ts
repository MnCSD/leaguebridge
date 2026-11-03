/**
 * `npm run make-fixture -- <recording.jsonl> <out.jsonl>`
 *
 * Turns a real recording into a small, anonymized test fixture that is safe to commit:
 *  - keeps only the endpoints the state reducer reads (plus connected/disconnected markers)
 *  - replaces names, Riot IDs, puuids and summoner/account ids with consistent fakes
 *    (the same real person always becomes the same fake, so "is this me?" checks still work)
 *  - drops chat credentials and lobby invitations
 */
import { createReadStream, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { isTrackedUri } from '../state/reducer';
import { redactDeep } from '../util/redact';

const NAME_KEYS = new Set(['gameName', 'summonerName', 'displayName', 'playerAlias', 'internalName', 'summonerInternalName']);
const TAG_KEYS = new Set(['tagLine', 'gameTag']);
const PUUID_KEYS = new Set(['puuid', 'obfuscatedPuuid']);
const NUMERIC_ID_KEYS = new Set(['summonerId', 'accountId', 'obfuscatedSummonerId']);
// `lol` = the chat presence block (rank, wins, mastery score...): not needed by the reducer.
const DROP_KEYS = new Set(['chatDetails', 'mucJwtDto', 'multiUserChatId', 'multiUserChatPassword', 'invitations', 'lol']);

const names = new Map<string, string>();
const puuids = new Map<string, string>();
const numericIds = new Map<number, number>();

function fakeName(real: string) {
  if (!real) return real;
  if (!names.has(real)) names.set(real, `Player${names.size + 1}`);
  return names.get(real)!;
}
function fakePuuid(real: string) {
  if (!real) return real;
  if (!puuids.has(real)) puuids.set(real, `00000000-0000-4000-8000-${String(puuids.size + 1).padStart(12, '0')}`);
  return puuids.get(real)!;
}
function fakeNumericId(real: number) {
  if (!real) return real;
  if (!numericIds.has(real)) numericIds.set(real, 1000 + numericIds.size + 1);
  return numericIds.get(real)!;
}

function anonymize(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(anonymize);
  if (!v || typeof v !== 'object') return v;
  const out: Record<string, unknown> = {};
  for (const [k, child] of Object.entries(v)) {
    if (DROP_KEYS.has(k)) {
      out[k] = Array.isArray(child) ? [] : null;
    } else if (NAME_KEYS.has(k) && typeof child === 'string') out[k] = fakeName(child);
    else if (TAG_KEYS.has(k) && typeof child === 'string') out[k] = child ? 'TAG' : child;
    else if (PUUID_KEYS.has(k) && typeof child === 'string') out[k] = fakePuuid(child);
    else if (NUMERIC_ID_KEYS.has(k) && typeof child === 'number') out[k] = fakeNumericId(child);
    else out[k] = anonymize(child);
  }
  return out;
}

const [src, dest] = process.argv.slice(2);
if (!src || !dest) {
  console.error('Usage: npm run make-fixture -- <recording.jsonl> <out.jsonl>');
  process.exit(1);
}

// Pass 1: anonymize known fields, and learn every real name/puuid in the file.
const lines: unknown[] = [];
for await (const raw of createInterface({ input: createReadStream(src), crlfDelay: Infinity })) {
  if (!raw) continue;
  const line = JSON.parse(raw) as { kind: string; uri?: string };
  if (line.uri && !isTrackedUri(line.uri)) continue;
  lines.push(anonymize(line));
}

// Pass 2: the same values also hide inside other strings (e.g. chat id "<puuid>@eu2.pvp.net"),
// so replace every remaining occurrence anywhere.
const replacements = [...puuids, ...[...names].filter(([real]) => real.length >= 3)];
const scrub = (v: unknown): unknown => {
  if (typeof v === 'string') {
    let s = v;
    for (const [real, fake] of replacements) s = s.split(real).join(fake);
    return s;
  }
  if (Array.isArray(v)) return v.map(scrub);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, c]) => [k, scrub(c)]));
  return v;
};
const out = lines.map((l) => JSON.stringify(redactDeep(scrub(l))));
writeFileSync(dest, out.join('\n') + '\n');
console.log(`${dest}: ${out.length} lines, ${names.size} names and ${puuids.size} puuids anonymized`);
