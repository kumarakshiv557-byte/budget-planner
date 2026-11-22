import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {
  light: {
    text: '#0b0b0b',
    background: '#ffffff',
    backgroundElement: '#f4f4f2',
    backgroundSelected: '#e4e4e0',
    textSecondary: '#52514e',
    surface: '#fcfcfb',
    border: '#e4e4e0',
    grid: '#ececea',
    accent: '#2a78d6',
    forecast: '#86b6ef', // lighter step of the same blue ramp
    actual: '#2a78d6',
    critical: '#d03b3b',
    good: '#0ca30c',
  },
  dark: {
    text: '#f0efec',
    background: '#111110',
    backgroundElement: '#1a1a19',
    backgroundSelected: '#2a2a28',
    textSecondary: '#c3c2b7',
    surface: '#1a1a19',
    border: '#2e2e2c',
    grid: '#2a2a28',
    accent: '#3987e5',
    forecast: '#1c5cab',
    actual: '#5598e7',
    critical: '#e66767',
    good: '#0ca30c',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: { sans: 'system-ui', serif: 'ui-serif', rounded: 'ui-rounded', mono: 'ui-monospace' },
  default: { sans: 'normal', serif: 'serif', rounded: 'normal', mono: 'monospace' },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
