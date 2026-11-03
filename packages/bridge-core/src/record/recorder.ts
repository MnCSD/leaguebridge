import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs';
import { join } from 'node:path';
import { isSecretUri, redactDeep } from '../util/redact';

/**
 * One line of a recording (JSONL = one JSON object per line).
 * `t` is milliseconds since the recording started, so mock mode (M3) can replay with real timing.
 */
export type RecordingLine =
  | { t: number; kind: 'meta'; version: 1; startedAt: string }
  | { t: number; kind: 'connected' }
  | { t: number; kind: 'disconnected' }
  | { t: number; kind: 'snapshot'; uri: string; status: number; data: unknown }
  | { t: number; kind: 'event'; uri: string; eventType: string; data: unknown };

// "Each line type, minus `t`". The `T extends unknown` trick applies Omit to each union member separately.
type OmitEach<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
type LineInput = OmitEach<RecordingLine, 't'>;

export class Recorder {
  readonly path: string;
  private readonly stream: WriteStream;
  private readonly startedAt = Date.now();
  private secrets: string[] = [];

  constructor(dir: string) {
    mkdirSync(dir, { recursive: true });
    const stamp = new Date(this.startedAt).toISOString().replace(/[:.]/g, '-').slice(0, 19);
    this.path = join(dir, `${stamp}.jsonl`);
    this.stream = createWriteStream(this.path, { flags: 'a' });
    this.write({ kind: 'meta', version: 1, startedAt: new Date(this.startedAt).toISOString() });
  }

  /** Strings that must never reach disk (the current lockfile password). */
  setSecrets(secrets: string[]) {
    this.secrets = secrets;
  }

  write(line: LineInput) {
    if ('uri' in line && isSecretUri(line.uri)) return;
    const full = { t: Date.now() - this.startedAt, ...line };
    this.stream.write(JSON.stringify(redactDeep(full, this.secrets)) + '\n');
  }

  close(): Promise<void> {
    return new Promise((resolve) => this.stream.end(resolve));
  }
}
