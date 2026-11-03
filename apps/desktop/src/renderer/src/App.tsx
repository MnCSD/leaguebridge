import { DevicesPanel, Footer, PairingCard, SettingsPanel, StatusHero, TitleBar } from './components';
import { useSnapshot } from './hooks';

/**
 * The PC Bridge window (880x580):
 *   title bar
 *   status hero (ring + current state + League/phone chips)
 *   pairing card | settings + paired devices
 *   footer
 */
export function App() {
  const snap = useSnapshot();

  return (
    // Fills the window rather than a fixed size, so Windows frame differences never cut anything off.
    <div className="relative flex h-screen w-screen flex-col overflow-hidden border border-white/[0.08]">
      <div className="backdrop" />
      <TitleBar />
      {snap && (
        <>
          <main className="relative z-10 flex min-h-0 flex-1 flex-col gap-3 px-4 pt-1 pb-0">
            <StatusHero snap={snap} />
            <div className="flex min-h-0 flex-1 gap-3">
              <PairingCard snap={snap} />
              <div className="flex min-w-0 flex-1 flex-col gap-3">
                <SettingsPanel snap={snap} />
                <DevicesPanel snap={snap} />
              </div>
            </div>
          </main>
          <Footer snap={snap} />
        </>
      )}
    </div>
  );
}
