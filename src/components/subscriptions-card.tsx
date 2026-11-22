import { useState } from 'react';
import { View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Card, Chips, useCategoryColor, useCategoryLabel, useMoney } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { isSubscription, itemAppliesTo, monthLabel, transactionsIn } from '@/lib/budget';
import { useBudget } from '@/lib/store';
import type { Month } from '@/lib/types';

type Row = { id: string; title: string; detail?: string; categoryId: string | null; subcategoryId?: string; when: string; amount: number; planned?: boolean };

/**
 * Overview card: everything debited automatically, kept out of the pie charts and the Sankey.
 * Shows what was charged this month, plus subscriptions planned in Budget that haven't been charged yet.
 */
export function SubscriptionsCard({ month }: { month: Month }) {
  const { state } = useBudget();
  const theme = useTheme();
  const money = useMoney();
  const colorFor = useCategoryColor();
  const catLabel = useCategoryLabel();
  const [filter, setFilter] = useState<string>('all');

  const charged: Row[] = transactionsIn(state.transactions, month)
    .filter(isSubscription)
    .map((t) => ({
      id: t.id,
      title: t.note || t.description,
      detail: t.note ? t.description : undefined,
      categoryId: t.categoryId,
      subcategoryId: t.subcategoryId,
      when: `${t.date.slice(8).replace(/^0/, '')} ${monthLabel(month, 'short')}`,
      amount: t.amount,
    }));
  const chargedText = charged.map((r) => `${r.title} ${r.detail ?? ''}`.toLowerCase());
  const planned: Row[] = state.items
    .filter((i) => isSubscription(i) && itemAppliesTo(i, month))
    .filter((i) => !chargedText.some((t) => t.includes(i.name.trim().toLowerCase())))
    .map((i) => ({
      id: i.id,
      title: i.name,
      categoryId: i.categoryId,
      subcategoryId: i.subcategoryId,
      when: 'Planned, not charged yet',
      amount: i.amount,
      planned: true,
    }));
  const all = [...charged.sort((a, b) => b.amount - a.amount), ...planned];
  if (!all.length) return null;

  const cats = state.categories.filter((c) => all.some((r) => r.categoryId === c.id));
  const options = [{ id: 'all', label: 'All' }, ...cats.map((c) => ({ id: c.id, label: c.name }))];
  const shown = all.filter((r) => filter === 'all' || r.categoryId === filter);
  const paid = shown.filter((r) => !r.planned).reduce((s, r) => s + r.amount, 0);
  const coming = shown.filter((r) => r.planned).reduce((s, r) => s + r.amount, 0);

  return (
    <Card
      title="Subscriptions"
      subtitle={`Debited automatically. Kept out of the charts so they show what you choose to spend. ${monthLabel(month)}: ${money(paid, true)} charged${coming ? `, ${money(coming, true)} still to come` : ''}.`}>
      {cats.length > 1 ? (
        <Chips
          options={options}
          value={filter}
          onChange={setFilter}
          swatch={(id) => (id === 'all' ? theme.textSecondary : colorFor(state.categories.find((c) => c.id === id)))}
        />
      ) : null}
      {shown.map((r) => (
        <View
          key={r.id}
          style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.two, borderTopWidth: 1, borderColor: theme.border }}>
          <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colorFor(state.categories.find((c) => c.id === r.categoryId)) }} />
          <View style={{ flex: 1, opacity: r.planned ? 0.6 : 1 }}>
            <ThemedText type={r.detail ? 'smallBold' : 'small'}>{r.title}</ThemedText>
            {r.detail ? (
              <ThemedText type="small" themeColor="textSecondary">
                {r.detail}
              </ThemedText>
            ) : null}
            <ThemedText type="small" themeColor="textSecondary">
              {catLabel(r.categoryId, r.subcategoryId)} · {r.when}
            </ThemedText>
          </View>
          <ThemedText type="small" style={{ opacity: r.planned ? 0.6 : 1 }}>
            {money(r.amount, true)}
          </ThemedText>
        </View>
      ))}
    </Card>
  );
}
