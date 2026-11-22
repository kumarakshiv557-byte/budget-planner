import { DarkTheme, DefaultTheme, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';

import AppTabs from '@/components/app-tabs';
import { BudgetProvider, useBudget } from '@/lib/store';

SplashScreen.preventAutoHideAsync();

function HideSplashWhenReady() {
  const { ready } = useBudget();
  useEffect(() => {
    if (ready) SplashScreen.hideAsync();
  }, [ready]);
  return null;
}

export default function RootLayout() {
  const colorScheme = useColorScheme();
  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <BudgetProvider>
        <HideSplashWhenReady />
        <AppTabs />
      </BudgetProvider>
    </ThemeProvider>
  );
}
