import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { Pressable, useColorScheme } from 'react-native';

import { ThemedText } from '@/components/themed-text';

import AppTabs from '@/components/app-tabs';
import { BudgetProvider, useBudget } from '@/lib/store';
import { useAppUpdate } from '@/lib/use-app-update';
import { useBillPush } from '@/lib/use-bill-push';
import { useRevolutSync } from '@/lib/use-revolut-sync';

SplashScreen.preventAutoHideAsync();

function HideSplashWhenReady() {
  const { ready } = useBudget();
  useEffect(() => {
    if (ready) SplashScreen.hideAsync();
  }, [ready]);
  return null;
}

/** Runs the quiet background sync when the app opens, and keeps bill reminders up to date. */
function AutoSync() {
  useRevolutSync();
  useBillPush();
  return null;
}

/** A bar at the bottom when a newer version of the app is online. */
function UpdateBar() {
  const { ready, reload } = useAppUpdate();
  if (!ready) return null;
  return (
    <Pressable
      onPress={reload}
      style={{ position: 'absolute', left: 16, right: 16, bottom: 24, padding: 14, borderRadius: 12, backgroundColor: '#2a78d6', alignItems: 'center' }}>
      <ThemedText type="smallBold" style={{ color: '#fff' }}>
        A new version is ready. Tap to update.
      </ThemedText>
    </Pressable>
  );
}

export default function RootLayout() {
  const colorScheme = useColorScheme();
  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <BudgetProvider>
        <HideSplashWhenReady />
        <AutoSync />
        <AppTabs />
        <UpdateBar />
      </BudgetProvider>
    </ThemeProvider>
  );
}
