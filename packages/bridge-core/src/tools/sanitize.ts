/**
 * `npm run sanitize -- <file.jsonl> [...]`
 * Re-applies the current redaction rules to existing recordings, in place.
 * Use it whenever the rules in util/redact.ts get stricter.
 */
import { createReadStream, createWriteStream } from 'node:fs';
import { rename } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { isSecretUri, redactDeep } from '../util/redact';

async function sanitize(file: string) {
  const tmp = file + '.tmp';
  const out = createWriteStream(tmp);
  const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  let kept = 0;
  let dropped = 0;
  for await (const line of rl) {
    if (!line) continue;
    const obj = JSON.parse(line) as { uri?: string };
    if (obj.uri && isSecretUri(obj.uri)) {
      dropped++;
      continue;
    }
    out.write(JSON.stringify(redactDeep(obj)) + '\n');
    kept++;
  }
  await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())));
  await rename(tmp, file);
  console.log(`${file}: ${kept} lines kept, ${dropped} dropped`);
}

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('Usage: npm run sanitize -- <recording.jsonl> [...]');
  process.exit(1);
}
for (const f of files) await sanitize(f);
