import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';

import AppTabs from '@/components/app-tabs';
import { BudgetProvider, useBudget } from '@/lib/store';
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

export default function RootLayout() {
  const colorScheme = useColorScheme();
  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <BudgetProvider>
        <HideSplashWhenReady />
        <AutoSync />
        <AppTabs />
      </BudgetProvider>
    </ThemeProvider>
  );
}
