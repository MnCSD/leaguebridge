/**
 * Push notifications to paired phones, through Expo's push service, for the moments that matter
 * when you're away from the PC: a match was found, and it's your turn to ban or pick.
 *
 * Only phones that turned notifications on (registerPush) get them. What leaves the PC: the
 * phone's Expo push token and a short text ("Match found", "Your turn to pick"), nothing else.
 * https://docs.expo.dev/push-notifications/sending-notifications/
 */
import type { BridgeState } from '@league-remote/protocol';
import type { Logger } from 'pino';
import type { ConfigStore } from './config';

export const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

export interface PushMessage {
  to: string;
  title: string;
  body: string;
  data: { type: 'readyCheck' | 'turn' };
  sound: 'default';
  priority: 'high';
  /** Seconds Expo may keep trying; a stale "match found" is worse than none. */
  ttl: number;
  interruptionLevel: 'time-sensitive';
  channelId: string;
}

export interface PushTicket {
  status: 'ok' | 'error';
  message?: string;
  details?: { error?: string };
}

export type SendPush = (messages: PushMessage[]) => Promise<PushTicket[]>;

/** Expo push tokens look like ExponentPushToken[xxxx] (or ExpoPushToken[xxxx]). */
export const isExpoPushToken = (token: string) => /^Expo(nent)?PushToken\[[\w-]+\]$/.test(token);

/** Android notification channel the phone app creates for these alerts. */
export const PUSH_CHANNEL = 'match';

const sendViaExpo: SendPush = async (messages) => {
  const res = await fetch(EXPO_PUSH_URL, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(messages),
    signal: AbortSignal.timeout(10_000),
  });
  const json = (await res.json().catch(() => null)) as { data?: PushTicket[]; errors?: { message?: string }[] } | null;
  if (!res.ok || !json?.data) throw new Error(json?.errors?.[0]?.message ?? `Expo push service answered HTTP ${res.status}`);
  return json.data;
};

export class PushNotifier {
  /** What was last notified, so each pop / turn is sent once. */
  private lastReadyCheck: number | null = null;
  private lastTurn: string | null = null;

  constructor(
    private readonly opts: { config: ConfigStore; log: Logger; send?: SendPush },
  ) {}

  /** Call on every state change. Sends at most one push per new pop and per new turn. */
  onState(state: BridgeState) {
    const rc = state.readyCheck;
    if (rc?.state === 'InProgress' && rc.response === 'None') {
      if (this.lastReadyCheck !== rc.endsAt) {
        this.lastReadyCheck = rc.endsAt;
        const seconds = Math.round(rc.totalMs / 1000);
        void this.send('readyCheck', 'Match found', `${state.queue?.name ?? 'Your queue'} · accept within ${seconds}s`, seconds);
      }
    } else if (!rc) {
      this.lastReadyCheck = null;
    }

    const cs = state.champSelect;
    const turn = cs?.myAction ? `${cs.gameId}:${cs.myAction.id}` : null;
    if (turn && turn !== this.lastTurn) {
      const verb = cs!.myAction!.type === 'ban' ? 'ban' : 'pick';
      const seconds = cs!.timer.totalMs > 0 ? Math.round(cs!.timer.totalMs / 1000) : null;
      void this.send('turn', `Your turn to ${verb}`, seconds ? `You have ${seconds}s` : 'Open League Remote', seconds ?? 60);
    }
    if (turn || !cs) this.lastTurn = turn;
  }

  private async send(type: PushMessage['data']['type'], title: string, body: string, ttl: number) {
    const devices = this.opts.config.get().devices.filter((d) => d.pushToken);
    if (devices.length === 0) return;
    const messages: PushMessage[] = devices.map((d) => ({
      to: d.pushToken!,
      title,
      body,
      data: { type },
      sound: 'default',
      priority: 'high',
      ttl,
      interruptionLevel: 'time-sensitive',
      channelId: PUSH_CHANNEL,
    }));
    try {
      const tickets = await (this.opts.send ?? sendViaExpo)(messages);
      // A phone that uninstalled the app or turned notifications off: stop sending to it.
      const gone = new Set(tickets.flatMap((t, i) => (t.details?.error === 'DeviceNotRegistered' ? [messages[i]!.to] : [])));
      if (gone.size) {
        this.opts.config.update((c) => {
          for (const d of c.devices) if (d.pushToken && gone.has(d.pushToken)) delete d.pushToken;
        });
      }
      const failed = tickets.filter((t) => t.status === 'error' && t.details?.error !== 'DeviceNotRegistered');
      if (failed.length) this.opts.log.warn({ errors: failed.map((t) => t.details?.error ?? t.message) }, `Push "${title}" failed for ${failed.length} phone(s)`);
      else this.opts.log.info(`Push sent: ${title} (${devices.length} phone${devices.length > 1 ? 's' : ''})`);
    } catch (err) {
      this.opts.log.warn({ err: (err as Error).message }, `Push "${title}" could not be sent`);
    }
  }
}
