import { useState, type ReactNode } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, TextInput, View, type TextInputProps, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { addMonths, formatMoney, monthLabel } from '@/lib/budget';
import { useBudget } from '@/lib/store';
import type { Category, Month } from '@/lib/types';

import { ThemedText } from './themed-text';

export function useIsDark() {
  return useColorScheme() === 'dark';
}

export function useCategoryColor() {
  const dark = useIsDark();
  const theme = useTheme();
  return (c: Category | undefined) => (c ? (dark ? c.colorDark : c.color) : theme.textSecondary);
}

export function useMoney() {
  const { state } = useBudget();
  return (n: number, cents = false) => formatMoney(n, state.currency, cents);
}

export function Screen({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.inner}>
            <View style={styles.header}>
              <ThemedText type="subtitle" style={{ flex: 1 }}>
                {title}
              </ThemedText>
              {right}
            </View>
            {children}
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

export function Card({ title, subtitle, children, style }: { title?: string; subtitle?: string; children: ReactNode; style?: ViewStyle }) {
  const theme = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }, style]}>
      {title ? <ThemedText type="smallBold">{title}</ThemedText> : null}
      {subtitle ? (
        <ThemedText type="small" themeColor="textSecondary" style={{ marginBottom: Spacing.two }}>
          {subtitle}
        </ThemedText>
      ) : null}
      {children}
    </View>
  );
}

export function Button({
  label,
  onPress,
  kind = 'primary',
  disabled,
}: {
  label: string;
  onPress: () => void;
  kind?: 'primary' | 'secondary' | 'danger';
  disabled?: boolean;
}) {
  const theme = useTheme();
  const bg = kind === 'primary' ? theme.accent : kind === 'danger' ? theme.critical : theme.backgroundSelected;
  const fg = kind === 'secondary' ? theme.text : '#ffffff';
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.button, { backgroundColor: bg, opacity: disabled ? 0.4 : pressed ? 0.75 : 1 }]}>
      <ThemedText type="smallBold" style={{ color: fg }}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

/** A row of pill buttons for picking one option. */
export function Chips<T extends string>({
  options,
  value,
  onChange,
  swatch,
}: {
  options: { id: T; label: string }[];
  value: T | null;
  onChange: (v: T) => void;
  swatch?: (id: T) => string;
}) {
  const theme = useTheme();
  return (
    <View style={styles.chips}>
      {options.map((o) => {
        const on = o.id === value;
        return (
          <Pressable
            key={o.id}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(o.id)}
            style={[
              styles.chip,
              { borderColor: on ? theme.text : theme.border, backgroundColor: on ? theme.backgroundSelected : 'transparent' },
            ]}>
            {swatch ? <View style={[styles.swatch, { backgroundColor: swatch(o.id) }]} /> : null}
            <ThemedText type="small" themeColor={on ? 'text' : 'textSecondary'}>
              {o.label}
            </ThemedText>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Field({ label, ...props }: TextInputProps & { label: string }) {
  const theme = useTheme();
  return (
    <View style={{ gap: Spacing.one, flex: 1, minWidth: 140 }}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <TextInput
        placeholderTextColor={theme.textSecondary}
        {...props}
        style={[styles.input, { color: theme.text, borderColor: theme.border, backgroundColor: theme.background }]}
      />
    </View>
  );
}

export function Label({ children }: { children: ReactNode }) {
  return (
    <ThemedText type="small" themeColor="textSecondary" style={{ marginTop: Spacing.two }}>
      {children}
    </ThemedText>
  );
}

export function MonthSwitcher({ month, onChange }: { month: Month; onChange: (m: Month) => void }) {
  const theme = useTheme();
  const arrow = (delta: number, glyph: string, label: string) => (
    <Pressable
      accessibilityLabel={label}
      onPress={() => onChange(addMonths(month, delta))}
      hitSlop={8}
      style={[styles.arrow, { backgroundColor: theme.backgroundElement }]}>
      <ThemedText>{glyph}</ThemedText>
    </Pressable>
  );
  return (
    <View style={styles.monthRow}>
      {arrow(-1, '‹', 'Previous month')}
      <ThemedText type="smallBold" style={{ minWidth: 120, textAlign: 'center' }}>
        {monthLabel(month)}
      </ThemedText>
      {arrow(1, '›', 'Next month')}
    </View>
  );
}

/** Shows children only after the user taps the header. */
export function Disclosure({ label, children, initiallyOpen = false }: { label: string; children: ReactNode; initiallyOpen?: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <View>
      <Pressable onPress={() => setOpen(!open)} accessibilityRole="button" style={{ paddingVertical: Spacing.two }}>
        <ThemedText type="smallBold">
          {open ? '▾' : '▸'} {label}
        </ThemedText>
      </Pressable>
      {open ? children : null}
    </View>
  );
}

export const styles = StyleSheet.create({
  scroll: { paddingBottom: BottomTabInset + Spacing.six, paddingHorizontal: Spacing.three },
  inner: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', gap: Spacing.three, paddingTop: Platform.OS === 'web' ? 88 : Spacing.four },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, flexWrap: 'wrap' },
  card: { borderWidth: 1, borderRadius: 16, padding: Spacing.three, gap: Spacing.one },
  button: { paddingVertical: 10, paddingHorizontal: Spacing.three, borderRadius: 10, alignItems: 'center', alignSelf: 'flex-start' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  swatch: { width: 10, height: 10, borderRadius: 5 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
  monthRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  arrow: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', gap: Spacing.two, flexWrap: 'wrap' },
});
