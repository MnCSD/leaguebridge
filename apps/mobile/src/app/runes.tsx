/** Rune page picker (from champ select). */
import { ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RunePageList } from '@/screens/RunePageList';
import { Sheet } from '@/ui/Sheet';

export default function RunesSheet() {
  const insets = useSafeAreaInsets();
  return (
    <Sheet eyebrow="Choose a page" title="Runes">
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 24 }}>
        <RunePageList />
      </ScrollView>
    </Sheet>
  );
}
