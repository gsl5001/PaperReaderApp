import { Link, Tabs } from 'expo-router';
import { Pressable, StyleSheet, type ColorValue } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';

// Bottom tabs: Today | Plans | Library | Marks, with Settings in the header.
// The icons are plain text symbols: no icon font is bundled.

function SettingsLink() {
  return (
    <Link href="/settings" asChild>
      <Pressable hitSlop={12} style={styles.headerRight}>
        <ThemedText type="smallBold">Settings</ThemedText>
      </Pressable>
    </Link>
  );
}

const icon = (symbol: string) =>
  function TabIcon({ color }: { color: ColorValue }) {
    return <ThemedText style={[styles.icon, { color }]}>{symbol}</ThemedText>;
  };

export default function TabLayout() {
  return (
    <Tabs screenOptions={{ headerRight: SettingsLink }}>
      <Tabs.Screen name="index" options={{ title: 'Today', tabBarIcon: icon('◷') }} />
      <Tabs.Screen name="plans" options={{ title: 'Plans', tabBarIcon: icon('☰') }} />
      <Tabs.Screen name="library" options={{ title: 'Library', tabBarIcon: icon('▤') }} />
      <Tabs.Screen name="marks" options={{ title: 'Marks', tabBarIcon: icon('✎') }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  headerRight: { marginRight: Spacing.three },
  icon: { fontSize: 20, lineHeight: 24 },
});
