import type { Logger } from 'pino';

export const READY_CHECK_URI = '/lol-matchmaking/v1/ready-check';

/** Shape of /lol-matchmaking/v1/ready-check, as seen in real recordings. */
export interface ReadyCheck {
  state: 'InProgress' | 'EveryoneReady' | string; // other values appear when someone declines
  playerResponse: 'None' | 'Accepted' | 'Declined' | string;
  /** Seconds since the pop appeared. Counts UP, once per second. */
  timer: number;
  declinerIds: number[];
}

export interface AutoAcceptSettings {
  enabled: boolean;
  /** How long a ready check lasts. 12s in the current client. */
  windowSec: number;
  /** Accept this many seconds before the window ends, so there's time to decline from the phone. */
  beforeTimeoutSec: number;
}

export const DEFAULT_AUTO_ACCEPT: AutoAcceptSettings = { enabled: false, windowSec: 12, beforeTimeoutSec: 2 };

/**
 * Accepts queue pops on its own, but late: it waits until `beforeTimeoutSec` before the pop
 * expires, and stands down the moment the player answers (from the client or the phone).
 *
 * It is fed every ready-check update (events plus the snapshot taken on connect). The actual HTTP
 * call is injected as `accept`, which keeps this class easy to test with fake timers.
 */
export class AutoAccepter {
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** True from the moment a pop is seen until it ends. Prevents scheduling twice for one pop. */
  private handlingPop = false;

  constructor(
    private settings: AutoAcceptSettings,
    private readonly accept: () => Promise<void>,
    private readonly log: Logger,
  ) {}

  updateSettings(settings: AutoAcceptSettings) {
    this.settings = settings;
    if (!settings.enabled) this.cancel('auto-accept turned off');
  }

  /** `data` is the ready-check payload, or null when the endpoint was deleted / returned 404. */
  onReadyCheck(data: ReadyCheck | null) {
    const active = data !== null && data.state === 'InProgress';

    if (!active) {
      this.cancel();
      this.handlingPop = false;
      return;
    }

    if (data.playerResponse !== 'None') {
      if (this.timer) this.cancel(`player already ${data.playerResponse.toLowerCase()}`);
      this.handlingPop = true;
      return;
    }

    if (this.handlingPop) return;
    this.handlingPop = true;

    if (!this.settings.enabled) {
      this.log.info('Match found (auto-accept is off)');
      return;
    }

    const fireAtSec = this.settings.windowSec - this.settings.beforeTimeoutSec;
    const waitMs = Math.max(0, (fireAtSec - data.timer) * 1000);
    this.log.info(`Match found! Auto-accepting in ${(waitMs / 1000).toFixed(0)}s unless you respond first`);

    this.timer = setTimeout(() => {
      this.timer = null;
      this.log.info('Auto-accepting match');
      this.accept().catch((err: Error) => this.log.warn({ err: err.message }, 'Auto-accept failed'));
    }, waitMs);
  }

  /** Called on disconnect from the client. */
  reset() {
    this.cancel();
    this.handlingPop = false;
  }

  private cancel(reason?: string) {
    if (!this.timer) return;
    clearTimeout(this.timer);
    this.timer = null;
    if (reason) this.log.info(`Auto-accept cancelled: ${reason}`);
  }
}
