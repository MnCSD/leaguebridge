/** In game: nothing to control, just a calm status. */
import { Text, View } from 'react-native';
import { Card, Eyebrow, FadeIn, Icon, Screen, TopBar } from '@/ui/components';
import { colors, type } from '@/ui/theme';

const LABEL: Record<string, string> = {
  GameStart: 'Loading into the game',
  InProgress: 'Game in progress',
  Reconnect: 'Reconnect available on your PC',
  WaitingForStats: 'Waiting for stats',
  PreEndOfGame: 'Game over',
};

export function InGameScreen({ phase }: { phase: string }) {
  return (
    <Screen glow="gold">
      <TopBar />
      <View style={{ flex: 1, justifyContent: 'center', padding: 24 }}>
        <FadeIn>
          <Card glass style={{ padding: 28, alignItems: 'center', gap: 12 }}>
            <Icon name="play" size={34} color={colors.gold} />
            <Eyebrow>Good luck</Eyebrow>
            <Text style={type.title}>{LABEL[phase] ?? phase}</Text>
            <Text style={[type.small, { textAlign: 'center' }]}>League Remote picks up again after the game.</Text>
          </Card>
        </FadeIn>
      </View>
    </Screen>
  );
}
