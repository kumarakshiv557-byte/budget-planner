import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Donut } from '@/components/charts';
import { ThemedText } from '@/components/themed-text';
import { Card, Chips, styles as ui, useCategoryColor, useIsDark, useMoney } from '@/components/ui';
import { MaxContentWidth, Spacing, TypeColors } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { breakdown, monthLabel, type BreakdownDim, type BreakdownSide } from '@/lib/budget';
import { useBudget } from '@/lib/store';
import { ITEM_TYPES, type ItemType, type Month } from '@/lib/types';

const TYPE_LABEL = Object.fromEntries(ITEM_TYPES.map((t) => [t.id, t.label])) as Record<ItemType, string>;
const SIDES = [
  { id: 'actual' as const, label: 'Actual' },
  { id: 'forecast' as const, label: 'Forecast' },
];

/**
 * Full-screen pie chart of one month, split by category or by type.
 * Tapping a slice lists every expense (actual) or budget line (forecast) in it.
 */
export function BreakdownSheet({
  dim,
  month,
  initialKey,
  onClose,
}: {
  dim: BreakdownDim | null;
  month: Month;
  initialKey?: string | null;
  onClose: () => void;
}) {
  const { state } = useBudget();
  const theme = useTheme();
  const dark = useIsDark();
  const money = useMoney();
  const colorFor = useCategoryColor();
  const [side, setSide] = useState<BreakdownSide>('actual');
  // The parent remounts this sheet (via `key`) for each new open, so these start fresh each time.
  const [selected, setSelected] = useState<string | null>(initialKey ?? null);

  const groups = dim ? breakdown(state, month, dim, side) : [];
  const catName = (id: string | null) => state.categories.find((c) => c.id === id)?.name ?? 'Uncategorised';
  const labelOf = (key: string) => (dim === 'type' ? TYPE_LABEL[key as ItemType] : catName(key === 'none' ? null : key));
  const colorOf = (key: string) =>
    dim === 'type'
      ? TypeColors[key as ItemType][dark ? 1 : 0]
      : colorFor(state.categories.find((c) => c.id === key));
  const group = groups.find((g) => g.key === selected);

  return (
    <Modal visible={dim !== null} animationType="slide" onRequestClose={onClose} presentationStyle="fullScreen">
      <View style={{ flex: 1, backgroundColor: theme.background }}>
        <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
          <ScrollView contentContainerStyle={{ padding: Spacing.three, paddingBottom: Spacing.six }}>
            <View style={s.inner}>
              <View style={ui.header}>
                <View style={{ flex: 1 }}>
                  <ThemedText type="subtitle">{dim === 'type' ? 'By type' : 'By category'}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {monthLabel(month)}
                  </ThemedText>
                </View>
                <Pressable
                  onPress={onClose}
                  accessibilityRole="button"
                  accessibilityLabel="Close"
                  style={[s.close, { backgroundColor: theme.backgroundSelected }]}>
                  <ThemedText type="smallBold">✕</ThemedText>
                </Pressable>
              </View>

              <Chips
                options={SIDES}
                value={side}
                onChange={(v) => {
                  setSide(v);
                  setSelected(null);
                }}
              />

              <Card subtitle={side === 'actual' ? 'What you actually spent. Tap a slice to see its expenses.' : 'What you planned. Tap a slice to see its budget lines.'}>
                <Donut
                  slices={groups.map((g) => ({ key: g.key, label: labelOf(g.key), value: g.total, color: colorOf(g.key) }))}
                  selected={selected}
                  onSelect={setSelected}
                  emptyText={side === 'actual' ? 'No spending recorded for this month yet.' : 'No budget lines for this month yet.'}
                />
              </Card>

              {group ? (
                <Card
                  title={`${labelOf(group.key)} · ${group.lines.length} ${side === 'actual' ? (group.lines.length === 1 ? 'expense' : 'expenses') : group.lines.length === 1 ? 'budget line' : 'budget lines'}`}
                  subtitle={`Total ${money(group.total, true)}`}>
                  {group.lines.map((l) => (
                    <View key={l.id} style={[s.line, { borderColor: theme.border }]}>
                      <View style={{ flex: 1, gap: 2 }}>
                        <ThemedText type="small" numberOfLines={2}>
                          {l.label}
                        </ThemedText>
                        <ThemedText type="small" themeColor="textSecondary">
                          {[l.date, dim === 'type' ? catName(l.categoryId) : TYPE_LABEL[l.type]].filter(Boolean).join(' · ')}
                        </ThemedText>
                      </View>
                      <ThemedText type="smallBold">{money(l.amount, true)}</ThemedText>
                    </View>
                  ))}
                </Card>
              ) : null}
            </View>
          </ScrollView>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  inner: { width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center', gap: Spacing.three },
  close: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  line: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.two, borderTopWidth: 1 },
});
