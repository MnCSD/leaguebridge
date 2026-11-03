/** First run: scan the QR on the PC (or type the code) to pair. */
import { DEFAULT_PORT, PairingInfo } from '@league-remote/protocol';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { Redirect } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useBridge } from '@/bridge/BridgeProvider';
import { Button, Card, Eyebrow, FadeIn, Icon, Screen } from '@/ui/components';
import { Logo } from '@/ui/Logo';
import { colors, fonts, radius, type } from '@/ui/theme';

export default function PairScreen() {
  const { bridge, pairWith } = useBridge();
  const [manual, setManual] = useState(false);
  const [host, setHost] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scanned = useRef(false);

  if (bridge) return <Redirect href="/" />;

  const connect = async (target: { host: string; port: number }, pairingCode: string) => {
    setBusy(true);
    setError(null);
    try {
      await pairWith(target, pairingCode);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (err) {
      setError((err as Error).message);
      scanned.current = false;
    } finally {
      setBusy(false);
    }
  };

  const onScan = (data: string) => {
    if (scanned.current || busy) return;
    let info: PairingInfo | null = null;
    try {
      const parsed = PairingInfo.safeParse(JSON.parse(data));
      info = parsed.success ? parsed.data : null;
    } catch {}
    if (!info) return setError("That isn't a League Remote code.");
    scanned.current = true;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    void connect({ host: info.host, port: info.port }, info.code);
  };

  const [hostPart, portPart] = host.trim().split(':');
  const canSubmit = !!hostPart && /^\d{6}$/.test(code);

  return (
    <Screen>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          <FadeIn style={{ paddingHorizontal: 24, gap: 10, paddingTop: 28 }}>
            <View style={{ marginLeft: -6, marginBottom: 8 }}>
              <Logo size={84} />
            </View>
            <Text style={type.hero}>Connect to{'\n'}your PC</Text>
            <Text style={[type.small, { fontSize: 16, lineHeight: 22 }]}>
              Open League Remote on your computer and scan the code it shows. Both need to be on the same Wi‑Fi.
            </Text>
          </FadeIn>

          <FadeIn delay={80} style={{ paddingHorizontal: 24, paddingTop: 28 }}>
            {manual ? (
              <Card style={{ padding: 20, gap: 16 }}>
                <Field label="PC address" hint="Shown under the QR on your PC, e.g. 192.168.1.24">
                  <TextInput
                    value={host}
                    onChangeText={setHost}
                    placeholder="192.168.1.24"
                    placeholderTextColor={colors.faint}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'default'}
                    style={s.input}
                  />
                </Field>
                <Field label="6-digit code">
                  <TextInput
                    value={code}
                    onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, 6))}
                    placeholder="000000"
                    placeholderTextColor={colors.faint}
                    keyboardType="number-pad"
                    style={[s.input, s.code]}
                    maxLength={6}
                  />
                </Field>
                <Button
                  label="Connect"
                  big
                  busy={busy}
                  disabled={!canSubmit}
                  onPress={() => void connect({ host: hostPart!, port: Number(portPart) || DEFAULT_PORT }, code)}
                />
              </Card>
            ) : (
              <Scanner onScan={onScan} busy={busy} />
            )}
          </FadeIn>

          {error ? (
            <FadeIn key={error} style={[s.error]}>
              <Icon name="info" size={18} color={colors.danger} />
              <Text style={{ flex: 1, fontFamily: fonts.medium, color: colors.white, fontSize: 14 }}>{error}</Text>
            </FadeIn>
          ) : null}

          <Pressable onPress={() => setManual(!manual)} style={s.switchMode} accessibilityRole="button">
            <Icon name={manual ? 'scan' : 'monitor'} size={18} color={colors.tealLight} />
            <Text style={{ fontFamily: fonts.semi, fontSize: 15, color: colors.tealLight }}>{manual ? 'Scan the QR code instead' : 'Enter the code manually'}</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 8 }}>
      <Eyebrow>{label}</Eyebrow>
      {children}
      {hint ? <Text style={type.small}>{hint}</Text> : null}
    </View>
  );
}

function Scanner({ onScan, busy }: { onScan(data: string): void; busy: boolean }) {
  const [permission, requestPermission] = useCameraPermissions();
  const line = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(line, { toValue: 1, duration: 1600, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(line, { toValue: 0, duration: 1600, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [line]);

  const SIZE = 300;
  return (
    <View style={{ alignItems: 'center', gap: 14 }}>
      <View style={[s.viewfinder, { width: SIZE, height: SIZE }]}>
        {permission?.granted ? (
          <CameraView style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={busy ? undefined : (r) => onScan(r.data)} />
        ) : (
          <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24 }]}>
            <Icon name="scan" size={40} color={colors.muted} />
            <Text style={[type.small, { textAlign: 'center' }]}>{permission && !permission.canAskAgain ? 'Camera access is off. Turn it on in Settings, or enter the code manually.' : 'Allow the camera to scan the code on your PC.'}</Text>
            {permission?.canAskAgain !== false ? <Button label="Allow camera" onPress={() => void requestPermission()} /> : null}
          </View>
        )}
        {(['tl', 'tr', 'bl', 'br'] as const).map((c) => (
          <View key={c} style={[s.corner, s[c]]} />
        ))}
        {permission?.granted ? (
          <Animated.View style={[s.scanLine, { transform: [{ translateY: line.interpolate({ inputRange: [0, 1], outputRange: [36, SIZE - 36] }) }] }]} />
        ) : null}
      </View>
      <Text style={type.small}>{busy ? 'Connecting…' : 'Point at the QR code on your PC'}</Text>
    </View>
  );
}

const CORNER = { position: 'absolute' as const, width: 34, height: 34, borderColor: colors.teal };
const s = StyleSheet.create({
  input: {
    height: 52,
    paddingHorizontal: 16,
    borderRadius: radius.sm,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: colors.lineStrong,
    color: colors.white,
    fontFamily: fonts.medium,
    fontSize: 17,
  },
  code: { fontFamily: fonts.semi, fontSize: 28, letterSpacing: 10, textAlign: 'center', height: 64 },
  viewfinder: { borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  corner: CORNER,
  tl: { top: 14, left: 14, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 14 },
  tr: { top: 14, right: 14, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 14 },
  bl: { bottom: 14, left: 14, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: 14 },
  br: { bottom: 14, right: 14, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: 14 },
  scanLine: { position: 'absolute', left: 30, right: 30, height: 2, borderRadius: 1, backgroundColor: colors.tealLight, shadowColor: colors.teal, shadowOpacity: 1, shadowRadius: 8 },
  error: {
    marginHorizontal: 24,
    marginTop: 18,
    padding: 14,
    flexDirection: 'row',
    gap: 10,
    alignItems: 'center',
    borderRadius: radius.md,
    backgroundColor: 'rgba(240,86,108,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(240,86,108,0.35)',
  },
  switchMode: { flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', paddingVertical: 22 },
});
