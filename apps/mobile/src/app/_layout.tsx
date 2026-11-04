import { Barlow_400Regular, Barlow_500Medium, Barlow_600SemiBold, Barlow_700Bold } from '@expo-google-fonts/barlow';
import { Sora_600SemiBold } from '@expo-google-fonts/sora';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { BridgeProvider } from '@/bridge/BridgeProvider';
import { colors } from '@/ui/theme';

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const [loaded] = useFonts({ Sora_600SemiBold, Barlow_400Regular, Barlow_500Medium, Barlow_600SemiBold, Barlow_700Bold });
  useEffect(() => {
    if (loaded) SplashScreen.hideAsync().catch(() => {});
  }, [loaded]);
  if (!loaded) return null;

  return (
    <SafeAreaProvider>
      <BridgeProvider>
        <StatusBar style="light" />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg }, animation: 'fade' }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="pair" />
          <Stack.Screen name="spells" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="skins" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="runes" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="rune-editor" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
        </Stack>
      </BridgeProvider>
    </SafeAreaProvider>
  );
}
