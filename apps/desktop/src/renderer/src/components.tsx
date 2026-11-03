/**
 * The pieces of the PC Bridge window. Clean, modern styling: rounded cards, hairline borders,
 * accents used sparingly. React escapes all text, so device names from phones can't inject markup.
 */
import type { ReactNode } from 'react';
import type { SettingKey, Tone, UiSnapshot, UiStatus } from '../../shared';
import appIcon from '../../../resources/icon-small.svg';
import { api, useNow } from './hooks';

const toneText: Record<Tone, string> = { on: 'text-teal', gold: 'text-gold', off: 'text-faint' };
const toneBg: Record<Tone, string> = { on: 'bg-teal', gold: 'bg-gold', off: 'bg-faint' };

const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

// --- icons (inline stroke SVGs) --------------------------------------------------------------

function Icon({ d, size = 16, className = '' }: { d: string[]; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      {d.map((p) => (
        <path key={p} d={p} />
      ))}
    </svg>
  );
}
const ICONS = {
  check: ['M20 6 9 17l-5-5'],
  power: ['M12 3v9', 'M6.3 6.3a8 8 0 1 0 11.4 0'],
  tray: ['M4 14h4l1.5 2.5h5L16 14h4', 'M4 14l2-8h12l2 8v5H4z'],
  bell: ['M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z', 'M10 20.5a2 2 0 0 0 4 0'],
  shield: ['M12 3 4.5 6v5.5c0 4.6 3.2 8 7.5 9.5 4.3-1.5 7.5-4.9 7.5-9.5V6z'],
  phone: ['M8 2.5h8a1.5 1.5 0 0 1 1.5 1.5v16a1.5 1.5 0 0 1-1.5 1.5H8A1.5 1.5 0 0 1 6.5 20V4A1.5 1.5 0 0 1 8 2.5z', 'M11 18h2'],
  monitor: ['M3.5 4.5h17v11h-17z', 'M9 20h6', 'M12 15.5V20'],
  wifi: ['M2.5 9a14 14 0 0 1 19 0', 'M5.5 12.5a9.5 9.5 0 0 1 13 0', 'M8.7 15.8a5 5 0 0 1 6.6 0', 'M12 19h.01'],
  chevrons: ['M8 9l4-4 4 4', 'M8 15l4 4 4-4'],
  log: ['M6 3h9l3 3v15H6z', 'M9 11h6', 'M9 15h6'],
  refresh: ['M20 11a8 8 0 0 0-14.7-4', 'M4 4v4h4', 'M4 13a8 8 0 0 0 14.7 4', 'M20 20v-4h-4'],
};

// --- title bar ---------------------------------------------------------------------------------

function Logo() {
  // Same artwork as the app/tray icon (the small-size version reads best at 22 px).
  return <img src={appIcon} alt="" width={22} height={22} className="block" />;
}

export function TitleBar() {
  return (
    // The whole bar drags the window (frameless window); the buttons opt out.
    <header className="relative z-10 flex h-11 shrink-0 items-center justify-between pl-4 [-webkit-app-region:drag]">
      <div className="flex items-center gap-2.5">
        <Logo />
        <span className="font-display text-[13px] font-bold tracking-[0.12em] text-cream">League Remote</span>
        <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[11px] font-medium text-muted">Bridge</span>
      </div>
      <div className="flex gap-1 pr-2 [-webkit-app-region:no-drag]">
        <button
          aria-label="Minimize to tray"
          title="Minimize to tray"
          onClick={() => void api.minimizeToTray()}
          className="grid size-8 place-items-center rounded-lg text-muted transition-colors hover:bg-white/[0.07] hover:text-cream"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <path d="M2 6h8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
        <button
          aria-label="Close"
          title="Close"
          onClick={() => void api.close()}
          className="grid size-8 place-items-center rounded-lg text-muted transition-colors hover:bg-danger/90 hover:text-white"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </header>
  );
}

// --- status hero -------------------------------------------------------------------------------

/** Thin progress ring: spins while counting up, runs down for countdowns. */
function StatusRing({ status, now }: { status: UiStatus; now: number }) {
  const R = 30;
  const C = 2 * Math.PI * R;
  const t = status.timer;
  let fraction = status.tone === 'off' ? 0 : 1;
  let spinning = false;
  let center: ReactNode = <span className={`size-2.5 rounded-full ${toneBg[status.tone]} ${status.tone !== 'off' ? 'live-dot' : ''}`} />;

  if (t?.kind === 'countdown') {
    const left = t.at - now;
    fraction = t.totalMs ? Math.min(1, Math.max(0, left / t.totalMs)) : 1;
    center = <span className="text-[17px] font-semibold tabular-nums">{clock(left)}</span>;
  } else if (t?.kind === 'elapsed') {
    fraction = 0.25;
    spinning = true;
    center = <span className="text-[16px] font-semibold tabular-nums">{clock(now - t.at)}</span>;
  }

  return (
    <div className="relative grid size-[72px] shrink-0 place-items-center">
      <svg width="72" height="72" viewBox="0 0 72 72" className="absolute inset-0" aria-hidden="true">
        <circle cx="36" cy="36" r={R} fill="none" stroke="rgb(255 255 255 / 0.07)" strokeWidth="4" />
        <g className={spinning ? 'origin-center animate-spin-slow' : ''} style={{ transformBox: 'fill-box' }} opacity={fraction > 0.005 ? 1 : 0}>
          <circle
            cx="36"
            cy="36"
            r={R}
            fill="none"
            stroke="currentColor"
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray={`${C * fraction} ${C}`}
            transform="rotate(-90 36 36)"
            className={`${toneText[status.tone]} transition-[stroke-dasharray] duration-500`}
          />
        </g>
      </svg>
      <div className="relative">{center}</div>
    </div>
  );
}

function Pill({ icon, label, value, tone }: { icon: string[]; label: string; value: string; tone: Tone }) {
  return (
    <div className="flex h-[52px] min-w-[190px] items-center gap-3 rounded-[10px] bg-white/[0.035] px-3.5">
      <span className={`grid size-8 place-items-center rounded-lg ${tone === 'off' ? 'bg-white/[0.05] text-faint' : 'bg-teal/10 text-teal'}`}>
        <Icon d={icon} size={16} />
      </span>
      <div className="min-w-0">
        <div className="text-[11.5px] text-muted">{label}</div>
        <div title={value} className={`flex items-center gap-1.5 truncate text-[13.5px] font-semibold ${tone === 'off' ? 'text-muted' : 'text-cream'}`}>
          {tone === 'on' && <span className="live-dot size-1.5 shrink-0 rounded-full bg-teal" />}
          <span className="truncate">{value}</span>
        </div>
      </div>
    </div>
  );
}

export function StatusHero({ snap }: { snap: UiSnapshot }) {
  const now = useNow(250);
  const { status, phones } = snap;
  const phoneValue = phones.length === 0 ? 'Not connected' : phones.length === 1 ? phones[0]! : `${phones[0]} +${phones.length - 1}`;
  return (
    <section className={`card flex h-[100px] shrink-0 animate-rise items-center gap-5 px-5 ${status.urgent ? 'ring-1 ring-teal/40' : ''}`}>
      <StatusRing status={status} now={now} />
      <div className="min-w-0 flex-1">
        <div className="text-[12px] text-muted">Status</div>
        <div className="mt-0.5 text-[24px] leading-tight font-semibold tracking-[-0.01em] text-cream">{status.label}</div>
        <div className="mt-0.5 truncate text-[13px] text-muted">{status.detail}</div>
      </div>
      <div className="flex gap-2.5">
        <Pill icon={ICONS.monitor} label="League client" value={snap.leagueClient ? 'Detected' : 'Not running'} tone={snap.leagueClient ? 'on' : 'off'} />
        <Pill icon={ICONS.phone} label="Phone" value={phoneValue} tone={phones.length ? 'on' : 'off'} />
      </div>
    </section>
  );
}

// --- pairing card ------------------------------------------------------------------------------

function CodeSlots({ code }: { code: string | null }) {
  const digits = (code ?? '      ').split('');
  return (
    <div className="flex items-center justify-center gap-1.5">
      {digits.map((d, i) => (
        <span
          key={i}
          className={`grid h-10 w-[31px] place-items-center rounded-lg text-[20px] font-semibold tabular-nums ${i === 3 ? 'ml-2.5' : ''} ${
            code ? 'bg-white/[0.06] text-cream' : 'bg-white/[0.03] text-faint'
          }`}
        >
          {code ? d : '–'}
        </span>
      ))}
    </div>
  );
}

export function PairingCard({ snap }: { snap: UiSnapshot }) {
  const now = useNow(1000);
  const { code, qrDataUrl, note, host, hosts, port, expiresAt } = snap.pairing;
  const adapter = hosts.find((h) => h.address === host)?.adapter ?? '';
  const canSwitch = hosts.length > 1;
  const left = expiresAt ? expiresAt - now : 0;
  const fraction = Math.min(1, Math.max(0, left / (5 * 60_000)));

  return (
    <section className="card flex w-[292px] shrink-0 animate-rise flex-col items-center px-5 pt-4 pb-4 [animation-delay:60ms]">
      <div className="w-full">
        <div className="text-[14px] font-semibold">Pair a phone</div>
        <div className="text-[12px] text-muted">Scan with the app, or type the code</div>
      </div>

      <div className="mt-3.5 grid size-[148px] place-items-center">
        {code && qrDataUrl ? (
          <div className="rounded-xl bg-cream p-2 shadow-[0_12px_30px_-14px_rgb(0_0_0/0.9)]">
            <img src={qrDataUrl} alt="Pairing QR code" className="block size-[132px] rounded-[4px] [image-rendering:pixelated]" />
          </div>
        ) : (
          <div className="flex size-[148px] flex-col items-center justify-center gap-3 rounded-xl bg-white/[0.03] text-center">
            <span className={`grid size-9 place-items-center rounded-full ${snap.serverError ? 'bg-danger/10 text-danger' : 'bg-teal/10 text-teal'}`}>
              <Icon d={snap.serverError ? ICONS.wifi : ICONS.check} size={18} />
            </span>
            <div className="px-3 text-[13px] text-muted">{note ?? 'No pairing code'}</div>
            {!snap.serverError && (
              <button
                onClick={() => void api.newPairingCode()}
                className="flex h-8 items-center gap-1.5 rounded-lg bg-cream px-3 text-[12.5px] font-semibold text-navy transition hover:bg-white"
              >
                <Icon d={ICONS.refresh} size={14} /> New code
              </button>
            )}
          </div>
        )}
      </div>

      <div className="mt-4">
        <CodeSlots code={code} />
      </div>

      <div className="mt-3 flex h-4 w-[214px] items-center gap-2.5">
        {code ? (
          <>
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/[0.07]">
              <div className="h-full rounded-full bg-teal transition-[width] duration-1000 ease-linear" style={{ width: `${fraction * 100}%` }} />
            </div>
            <span className="text-[11.5px] text-muted tabular-nums">{clock(left)}</span>
          </>
        ) : (
          <span className="w-full text-center text-[11.5px] text-faint">{snap.serverError ? '' : 'Codes work once and expire after 5 min'}</span>
        )}
      </div>

      {snap.serverError ? (
        <div className="mt-auto text-center text-[12px] leading-snug text-danger">{snap.serverError}</div>
      ) : (
        <button
          onClick={() => canSwitch && void api.nextHost()}
          title={canSwitch ? `Phone on another network? Click to use another address (${hosts.length} available)` : adapter}
          className={`mt-auto flex h-8 w-full items-center gap-2 rounded-lg bg-white/[0.035] px-3 text-[12px] text-muted transition ${canSwitch ? 'hover:bg-white/[0.07] hover:text-cream' : 'cursor-default'}`}
        >
          <Icon d={ICONS.wifi} size={14} className="text-teal" />
          <span className="font-medium text-cream/90 tabular-nums">
            {host}:{port}
          </span>
          <span className="min-w-0 flex-1 truncate text-right">{adapter}</span>
          {canSwitch && <Icon d={ICONS.chevrons} size={13} />}
        </button>
      )}
    </section>
  );
}

// --- settings ----------------------------------------------------------------------------------

const SETTINGS: [SettingKey, string, string, string[]][] = [
  ['autoAccept', 'Auto-accept without phone', 'Accept queue pops even when no phone is connected', ICONS.check],
  ['startWithWindows', 'Start with Windows', 'Launch the bridge when you log in', ICONS.power],
  ['minimizeToTray', 'Minimize to tray', 'Closing the window keeps the bridge running', ICONS.tray],
  ['notifications', 'Desktop notifications', 'Show a toast when the phone connects', ICONS.bell],
  ['localNetworkOnly', 'Local network only', 'Refuse connections from outside your Wi-Fi', ICONS.shield],
];

export function SettingsPanel({ snap }: { snap: UiSnapshot }) {
  return (
    <section className="card shrink-0 animate-rise px-4 pt-3 pb-1 [animation-delay:120ms]">
      <div className="mb-1 text-[14px] font-semibold">Settings</div>
      {SETTINGS.map(([key, label, hint, icon], i) => {
        const on = snap.settings[key];
        return (
          <div key={key} className={`flex items-center gap-3 py-[5px] ${i < SETTINGS.length - 1 ? 'border-b border-line' : ''}`}>
            <span className={`grid size-7 shrink-0 place-items-center rounded-lg transition-colors ${on ? 'bg-teal/10 text-teal' : 'bg-white/[0.05] text-faint'}`}>
              <Icon d={icon} size={14} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[13.5px] font-medium">{label}</div>
              <div className="truncate text-[11.5px] text-muted">{hint}</div>
            </div>
            <button aria-label={label} aria-pressed={on} onClick={() => void api.setSetting(key, !on)} className="toggle">
              <span className="knob" />
            </button>
          </div>
        );
      })}
    </section>
  );
}

// --- devices -----------------------------------------------------------------------------------

function pairedWhen(iso: string) {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return 'Paired today';
  if (days === 1) return 'Paired yesterday';
  return `Paired ${new Date(iso).toLocaleDateString()}`;
}

export function DevicesPanel({ snap }: { snap: UiSnapshot }) {
  return (
    <section className="card flex min-h-0 flex-1 animate-rise flex-col px-4 pt-3 pb-3 [animation-delay:180ms]">
      <div className="mb-2 flex items-center gap-2">
        <div className="text-[14px] font-semibold">Paired devices</div>
        <span className="rounded-full bg-white/[0.06] px-1.5 text-[11px] font-medium text-muted tabular-nums">{snap.devices.length}</span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto pr-1">
        {snap.devices.length === 0 && (
          <div className="flex flex-1 items-center gap-3 text-[12.5px] text-muted">
            <span className="grid size-8 place-items-center rounded-lg bg-white/[0.04] text-faint">
              <Icon d={ICONS.phone} size={16} />
            </span>
            No phones yet. Scan the QR code with the League Remote app.
          </div>
        )}
        {snap.devices.map((d) => (
          <div key={d.id} className="group flex shrink-0 items-center gap-3 rounded-[10px] bg-white/[0.035] px-3 py-2 transition-colors hover:bg-white/[0.055]">
            <span className={`grid size-8 place-items-center rounded-lg ${d.connected ? 'bg-teal/10 text-teal' : 'bg-white/[0.05] text-muted'}`}>
              <Icon d={ICONS.phone} size={15} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13.5px] font-medium">{d.name}</div>
              <div className={`flex items-center gap-1.5 text-[11.5px] ${d.connected ? 'text-teal' : 'text-muted'}`}>
                {d.connected && <span className="live-dot size-1.5 rounded-full bg-teal" />}
                {d.connected ? 'Connected' : pairedWhen(d.pairedAt)}
              </div>
            </div>
            <button
              onClick={() => {
                if (confirm(`Remove "${d.name}"? It will need to pair again.`)) void api.removeDevice(d.id);
              }}
              className="h-7 rounded-lg px-2.5 text-[12px] font-medium text-muted transition hover:bg-danger/10 hover:text-danger"
            >
              Remove
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

// --- footer ------------------------------------------------------------------------------------

export function Footer({ snap }: { snap: UiSnapshot }) {
  const local = snap.settings.localNetworkOnly;
  return (
    <footer className="relative z-10 flex h-9 shrink-0 items-center justify-between px-5 text-[11.5px] text-faint">
      <div className="flex items-center gap-2">
        <span className="tabular-nums">v{snap.version}</span>
        <span>·</span>
        <span className={local ? '' : 'text-gold'}>{local ? 'Local network only' : 'Accepting all networks'}</span>
      </div>
      <button onClick={() => void api.openLog()} className="flex items-center gap-1.5 text-muted transition-colors hover:text-cream">
        <Icon d={ICONS.log} size={13} /> Open log
      </button>
    </footer>
  );
}
