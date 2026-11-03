import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import type { RecordingLine } from '../record/recorder';

export interface ReplayOptions {
  file: string;
  /** 1 = real time, 10 = ten times faster. */
  speed?: number;
  /** Long quiet stretches (client idle, in game) are shortened to this. Undefined = keep real gaps. */
  maxGapMs?: number;
  /** Start again from the top when the recording ends. */
  loop?: boolean;
}

export interface ReplayHandlers {
  onConnected(): void;
  onDisconnected(): void;
  /** data null = deleted / 404, same as live. */
  onUpdate(uri: string, data: unknown): void;
  onEvent?(uri: string, eventType: string, data: unknown): void;
  onEnd?(): void;
}

/**
 * Plays a recording back through the same handlers the live connection uses, so everything
 * downstream (state, auto-accept, phone server) can't tell the difference.
 * Lines are streamed, so even the 60+ MB recordings don't need to fit in memory at once.
 */
export class Replayer {
  private stopped = false;
  private wake: (() => void) | null = null;

  constructor(
    private readonly opts: ReplayOptions,
    private readonly handlers: ReplayHandlers,
  ) {}

  async run() {
    do {
      await this.playOnce();
    } while (this.opts.loop && !this.stopped);
    this.handlers.onEnd?.();
  }

  stop() {
    this.stopped = true;
    this.wake?.();
  }

  private async playOnce() {
    const speed = this.opts.speed ?? 1;
    const rl = createInterface({ input: createReadStream(this.opts.file), crlfDelay: Infinity });
    let lastT: number | null = null;
    let connected = false;

    for await (const raw of rl) {
      if (this.stopped) break;
      if (!raw) continue;
      const line = JSON.parse(raw) as RecordingLine;

      if (lastT !== null) {
        let gap = line.t - lastT;
        if (this.opts.maxGapMs !== undefined) gap = Math.min(gap, this.opts.maxGapMs);
        if (gap > 0) await this.sleep(gap / speed);
      }
      lastT = line.t;

      switch (line.kind) {
        case 'connected':
          connected = true;
          this.handlers.onConnected();
          break;
        case 'disconnected':
          connected = false;
          this.handlers.onDisconnected();
          break;
        case 'snapshot':
          this.handlers.onUpdate(line.uri, line.status === 200 ? line.data : null);
          break;
        case 'event':
          this.handlers.onUpdate(line.uri, line.eventType === 'Delete' ? null : line.data);
          this.handlers.onEvent?.(line.uri, line.eventType, line.data);
          break;
      }
    }
    rl.close();
    // A recording stopped with Ctrl+C has no final 'disconnected' line; end cleanly anyway.
    if (connected) this.handlers.onDisconnected();
  }

  private sleep(ms: number) {
    return new Promise<void>((resolve) => {
      const t = setTimeout(resolve, ms);
      this.wake = () => {
        clearTimeout(t);
        resolve();
      };
    });
  }
}
