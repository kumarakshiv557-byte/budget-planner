import { useState, type ReactNode } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, TextInput, View, type TextInputProps, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { addMonths, childSubsOf, formatMoney, monthLabel, subLabel, subLevels, topSubsOf } from '@/lib/budget';
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

/** A tap-to-toggle line with ☑ / ☐. */
export function Checkbox({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <Pressable onPress={() => onChange(!value)} accessibilityRole="checkbox" accessibilityState={{ checked: value }} style={{ paddingVertical: Spacing.one }}>
      <ThemedText type="small">
        {value ? '☑' : '☐'} {label}
      </ThemedText>
    </Pressable>
  );
}

/** Pick whose money a line is: Me, Wife, Mom… */
export function PersonChips({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const { allState } = useBudget();
  return <Chips options={allState.people.map((p) => ({ id: p.id, label: p.name }))} value={value} onChange={onChange} />;
}

/** The household filter at the top of a screen: everyone together, or one person's money. */
export function WhoseFilter() {
  const { allState, whose, setWhose } = useBudget();
  return (
    <Chips
      options={[{ id: 'all', label: 'Everyone' }, ...allState.people.map((p) => ({ id: p.id, label: p.name }))]}
      value={whose}
      onChange={setWhose}
    />
  );
}

/** " · Wife" for a line that isn't yours, else "". */
export function usePersonTag() {
  const { allState } = useBudget();
  return (x: { owner?: string }) => (x.owner && x.owner !== 'me' ? ` · ${allState.people.find((p) => p.id === x.owner)?.name ?? x.owner}` : '');
}

/** "Frivolous › Eating out / food delivery", or just the category name. */
export function useCategoryLabel() {
  const { state } = useBudget();
  return (categoryId: string | null, subcategoryId?: string) => {
    const c = state.categories.find((x) => x.id === categoryId)?.name ?? 'Uncategorised';
    const sub = subLabel(state.subcategories, subcategoryId);
    return sub ? `${c} › ${sub}` : c;
  };
}

/** Category chips, then (if the chosen category has any) its subcategories. */
export function CategoryPicker({
  categoryId,
  subcategoryId,
  onChange,
}: {
  categoryId: string | null;
  subcategoryId?: string;
  onChange: (categoryId: string, subcategoryId?: string) => void;
}) {
  const { state } = useBudget();
  const colorFor = useCategoryColor();
  const subs = topSubsOf(state.subcategories, categoryId);
  const { sub: top } = subLevels(state.subcategories, subcategoryId);
  const children = childSubsOf(state.subcategories, top);
  return (
    <View style={{ gap: Spacing.two }}>
      <Chips
        options={state.categories.map((c) => ({ id: c.id, label: c.name }))}
        value={categoryId}
        swatch={(id) => colorFor(state.categories.find((c) => c.id === id))}
        onChange={(id) => onChange(id, undefined)}
      />
      {categoryId && subs.length ? (
        <>
          <Label>Subcategory</Label>
          <Chips
            options={[{ id: '', label: 'None' }, ...subs.map((x) => ({ id: x.id, label: x.name }))]}
            value={top}
            onChange={(id) => onChange(categoryId, id || undefined)}
          />
        </>
      ) : null}
      {categoryId && children.length ? (
        <>
          <Label>Under {subs.find((x) => x.id === top)?.name}</Label>
          <Chips
            options={[{ id: top, label: 'None' }, ...children.map((x) => ({ id: x.id, label: x.name }))]}
            value={subcategoryId ?? top}
            onChange={(id) => onChange(categoryId, id)}
          />
        </>
      ) : null}
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
