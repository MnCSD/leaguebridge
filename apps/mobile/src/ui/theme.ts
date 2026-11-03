/**
 * The desktop app's look, carried to the phone: deep navy, soft raised surfaces with hairline
 * borders, one teal accent (gold for highlights), Barlow for text and Sora for the wordmark.
 */
export const colors = {
  bg: '#070D17',
  surface: '#0D1623',
  raised: '#131D2C',
  line: 'rgba(255,255,255,0.07)',
  lineStrong: 'rgba(255,255,255,0.13)',
  gold: '#C8AA6E',
  goldDark: '#785A28',
  teal: '#0AC8B9',
  tealLight: '#5FE3D8',
  tealGlow: 'rgba(10,200,185,0.35)',
  text: '#F0E6D2',
  white: '#F4F6FA',
  muted: '#8F98A8',
  faint: '#5B6678',
  danger: '#F0566C',
} as const;

export const fonts = {
  brand: 'Sora_600SemiBold',
  body: 'Barlow_400Regular',
  medium: 'Barlow_500Medium',
  semi: 'Barlow_600SemiBold',
  bold: 'Barlow_700Bold',
} as const;

export const radius = { sm: 10, md: 16, lg: 22, pill: 999 } as const;

export const type = {
  /** Wordmark next to the logo, like the desktop title bar. */
  brand: { fontFamily: fonts.brand, fontSize: 17, letterSpacing: -0.3, color: colors.white },
  /** Big screen titles. */
  hero: { fontFamily: fonts.bold, fontSize: 34, letterSpacing: -0.6, color: colors.white },
  title: { fontFamily: fonts.semi, fontSize: 22, letterSpacing: -0.2, color: colors.white },
  eyebrow: { fontFamily: fonts.semi, fontSize: 12, letterSpacing: 1.6, color: colors.muted, textTransform: 'uppercase' },
  body: { fontFamily: fonts.medium, fontSize: 16, color: colors.text },
  small: { fontFamily: fonts.body, fontSize: 14, color: colors.muted },
  number: { fontFamily: fonts.semi, color: colors.white, fontVariant: ['tabular-nums'] },
} as const;

export const formatClock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
