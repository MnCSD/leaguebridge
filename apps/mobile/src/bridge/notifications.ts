/**
 * Push notifications: "Match found" and "Your turn to ban/pick", sent by the bridge through Expo's
 * push service while the app is in the background or the phone is locked.
 *
 * The phone gets an Expo push token and hands it to the bridge (registerPush). That needs the
 * app's Expo project id (app.json extra.eas.projectId, written by `npx eas-cli init`).
 * Works in Expo Go on iPhone; Android needs a development build (Expo Go dropped remote push).
 */
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/** Same channel id the bridge sends to (PUSH_CHANNEL in bridge-core/server/push.ts). */
const CHANNEL = 'match';
const PREF_KEY = 'league-remote.push.v1';

// In the foreground the app already shows the match / turn screen: no banner on top of it.
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: false, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
});

export async function loadPushPreference(): Promise<boolean> {
  try {
    return (Platform.OS === 'web' ? localStorage.getItem(PREF_KEY) : await SecureStore.getItemAsync(PREF_KEY)) === '1';
  } catch {
    return false;
  }
}

export async function savePushPreference(on: boolean) {
  try {
    if (Platform.OS === 'web') localStorage.setItem(PREF_KEY, on ? '1' : '0');
    else await SecureStore.setItemAsync(PREF_KEY, on ? '1' : '0');
  } catch {}
}

export class PushSetupError extends Error {}

/** Asks for permission and returns this phone's Expo push token. Throws PushSetupError with a reason. */
export async function getPushToken(askPermission: boolean): Promise<string> {
  if (Platform.OS === 'web') throw new PushSetupError('Notifications only work on a phone.');
  if (!Device.isDevice) throw new PushSetupError('Notifications need a real phone, not a simulator.');

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(CHANNEL, {
      name: 'Match found & your turn',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 150, 250, 150, 400],
      lightColor: '#0AC8B9',
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    });
  }

  let { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted' && askPermission) ({ status } = await Notifications.requestPermissionsAsync());
  if (status !== 'granted') throw new PushSetupError('Notifications are turned off for League Remote in your phone settings.');

  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) throw new PushSetupError('Notifications need a one-time setup on the PC: run "npx eas-cli init" in apps/mobile.');

  try {
    return (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  } catch (err) {
    throw new PushSetupError(`Couldn't get a push token: ${(err as Error).message}`);
  }
}
