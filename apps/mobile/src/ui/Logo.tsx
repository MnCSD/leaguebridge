/**
 * The League Remote app icon, same artwork as apps/desktop/resources/icon.svg (large) and
 * icon-small.svg (bolder strokes, used below 40 px).
 */
import Svg, { Defs, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg';

export function Logo({ size = 28 }: { size?: number }) {
  return size < 40 ? <SmallLogo size={size} /> : <LargeLogo size={size} />;
}

function SmallLogo({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64">
      <Defs>
        <LinearGradient id="lsBg" x1="0.1" y1="0" x2="0.9" y2="1">
          <Stop offset="0" stopColor="#22395C" />
          <Stop offset="1" stopColor="#08101C" />
        </LinearGradient>
        <LinearGradient id="lsGold" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#F2DDA8" />
          <Stop offset="1" stopColor="#B8975A" />
        </LinearGradient>
      </Defs>
      <Rect x="2" y="2" width="60" height="60" rx="15" fill="url(#lsBg)" />
      <Rect x="2.75" y="2.75" width="58.5" height="58.5" rx="14.25" fill="none" stroke="#FFFFFF" strokeOpacity="0.14" strokeWidth="1.5" />
      <Rect x="15" y="12" width="24" height="40" rx="6" fill="#0D1A2C" stroke="url(#lsGold)" strokeWidth="4" />
      <Path d="M27 24 33 32 27 40 21 32z" fill="#0AC8B9" />
      <Path d="M45 24a11 11 0 0 1 0 16" fill="none" stroke="#0AC8B9" strokeWidth="4" strokeLinecap="round" />
    </Svg>
  );
}

function LargeLogo({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 512 512">
      <Defs>
        <LinearGradient id="llBg" x1="0.1" y1="0" x2="0.9" y2="1">
          <Stop offset="0" stopColor="#1D3150" />
          <Stop offset="0.55" stopColor="#0E1A2D" />
          <Stop offset="1" stopColor="#060B14" />
        </LinearGradient>
        <RadialGradient id="llGlow" cx="0.32" cy="0.18" r="0.75">
          <Stop offset="0" stopColor="#0AC8B9" stopOpacity="0.32" />
          <Stop offset="1" stopColor="#0AC8B9" stopOpacity="0" />
        </RadialGradient>
        <RadialGradient id="llScreenGlow" cx="226" cy="248" r="90" gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor="#0AC8B9" stopOpacity="0.5" />
          <Stop offset="1" stopColor="#0AC8B9" stopOpacity="0" />
        </RadialGradient>
        <LinearGradient id="llGold" x1="0" y1="0" x2="0.4" y2="1">
          <Stop offset="0" stopColor="#F6E4B6" />
          <Stop offset="0.5" stopColor="#C8AA6E" />
          <Stop offset="1" stopColor="#8E6C35" />
        </LinearGradient>
        <LinearGradient id="llTeal" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#7AF0E6" />
          <Stop offset="1" stopColor="#0AC8B9" />
        </LinearGradient>
        <LinearGradient id="llScreen" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#13243A" />
          <Stop offset="1" stopColor="#0A1424" />
        </LinearGradient>
      </Defs>

      {/* App tile */}
      <Rect x="24" y="24" width="464" height="464" rx="112" fill="url(#llBg)" />
      <Rect x="24" y="24" width="464" height="464" rx="112" fill="url(#llGlow)" />
      <Rect x="25.5" y="25.5" width="461" height="461" rx="110.5" fill="none" stroke="#FFFFFF" strokeOpacity="0.10" strokeWidth="3" />
      <Path d="M136 26h240a110 110 0 0 1 110 110" fill="none" stroke="#FFFFFF" strokeOpacity="0.08" strokeWidth="3" />

      {/* Phone (a radial glow stands in for the desktop's blur filter) */}
      <Rect x="138" y="118" width="176" height="290" rx="40" fill="url(#llScreen)" stroke="url(#llGold)" strokeWidth="20" />
      <Rect x="136" y="158" width="180" height="180" fill="url(#llScreenGlow)" />
      <Rect x="202" y="372" width="48" height="11" rx="5.5" fill="#C8AA6E" opacity="0.85" />

      {/* Diamond on the screen */}
      <Path d="M226 190 284 248 226 306 168 248z" fill="none" stroke="url(#llGold)" strokeWidth="8" strokeLinejoin="round" opacity="0.9" />
      <Path d="M226 216 258 248 226 280 194 248z" fill="url(#llTeal)" />

      {/* Signal waves */}
      <Path d="M352 196a74 74 0 0 1 0 104" fill="none" stroke="url(#llTeal)" strokeWidth="20" strokeLinecap="round" />
      <Path d="M392 156a132 132 0 0 1 0 184" fill="none" stroke="url(#llTeal)" strokeWidth="20" strokeLinecap="round" opacity="0.6" />
    </Svg>
  );
}
