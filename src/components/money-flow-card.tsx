import { useState } from 'react';
import { View } from 'react-native';

import { Sankey } from '@/components/sankey';
import { ThemedText } from '@/components/themed-text';
import { Card, useCategoryColor, useIsDark, useMoney } from '@/components/ui';
import { Spacing, TypeColors } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { OTHER_INCOME, monthLabel, moneyFlow, transactionsIn, type FlowNode } from '@/lib/budget';
import { useBudget } from '@/lib/store';
import { ITEM_TYPES, type ItemType, type Month } from '@/lib/types';

const TYPE_LABEL = Object.fromEntries(ITEM_TYPES.map((t) => [t.id, t.label])) as Record<ItemType, string>;

/** Overview card: where this month's income went, as a Sankey, with the lines behind a tapped block. */
export function MoneyFlowCard({ month }: { month: Month }) {
  const { state } = useBudget();
  const theme = useTheme();
  const dark = useIsDark();
  const money = useMoney();
  const colorFor = useCategoryColor();
  const [selected, setSelected] = useState<string | null>(null);

  const flow = moneyFlow(state, month);
  const catName = (id: string) => state.categories.find((c) => c.id === id)?.name ?? 'Uncategorised';
  const label = (n: FlowNode) =>
    n.kind === 'income'
      ? n.key === OTHER_INCOME
        ? 'Other income'
        : n.key
      : n.kind === 'gap'
        ? 'Not covered by income'
        : n.kind === 'total'
          ? monthLabel(month, 'short')
          : n.kind === 'category'
            ? catName(n.key)
            : n.kind === 'leftover'
              ? 'Left over'
              : TYPE_LABEL[n.key as ItemType];
  const color = (n: FlowNode) =>
    n.kind === 'income' || n.kind === 'leftover'
      ? theme.good
      : n.kind === 'gap'
        ? theme.critical
        : n.kind === 'total'
          ? theme.textSecondary
          : n.kind === 'category'
            ? colorFor(state.categories.find((c) => c.id === n.key))
            : TypeColors[n.key as ItemType][dark ? 1 : 0];

  const node = flow.nodes.find((n) => n.id === selected);
  const topSources = new Set(flow.nodes.filter((n) => n.kind === 'income').map((n) => n.key.toLowerCase()));
  const lines = !node
    ? []
    : node.kind === 'income'
      ? transactionsIn(state.income, month)
          .filter((i) =>
            node.key === OTHER_INCOME
              ? !topSources.has(i.description.trim().toLowerCase())
              : i.description.trim().toLowerCase() === node.key.toLowerCase(),
          )
          .map((i) => ({ id: i.id, label: i.description, sub: i.date, amount: i.amount }))
      : node.kind === 'category' || node.kind === 'type'
        ? transactionsIn(state.transactions, month)
            .filter((t) => (node.kind === 'category' ? (t.categoryId ?? 'none') === node.key : t.type === node.key))
            .map((t) => ({
              id: t.id,
              label: t.description,
              sub: `${t.date} · ${node.kind === 'category' ? TYPE_LABEL[t.type] : t.categoryId ? catName(t.categoryId) : 'Uncategorised'}`,
              amount: t.amount,
            }))
        : [];
  lines.sort((a, b) => b.amount - a.amount);

  const note = !node
    ? null
    : node.kind === 'gap'
      ? `You spent ${money(node.value, true)} more than the income recorded for ${monthLabel(month)}. That came from savings or from income the app hasn't seen yet. Add it on the Spending tab.`
      : node.kind === 'leftover'
        ? `${money(node.value, true)} of ${monthLabel(month)}'s income hasn't been spent.`
        : node.kind === 'total'
          ? `Income ${money(flow.income, true)} · spent ${money(flow.spent, true)}.`
          : null;

  return (
    <Card
      title="Where your income went"
      subtitle={`${monthLabel(month)}: income on the left, then categories, then types. Tap a block to see what's in it.`}>
      {flow.nodes.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          No income or spending recorded for this month yet.
        </ThemedText>
      ) : (
        <>
          {flow.income === 0 ? (
            <ThemedText type="small" themeColor="textSecondary">
              No income recorded this month. Sync Revolut or add it on the Spending tab.
            </ThemedText>
          ) : null}
          <Sankey
            nodes={flow.nodes.map((n) => ({ id: n.id, column: n.column, value: n.value, label: label(n), color: color(n) }))}
            links={flow.links}
            selected={selected}
            onSelect={setSelected}
          />
        </>
      )}
      {node ? (
        <View style={{ marginTop: Spacing.two }}>
          <ThemedText type="smallBold">
            {label(node)} · {money(node.value, true)}
          </ThemedText>
          {note ? (
            <ThemedText type="small" themeColor="textSecondary">
              {note}
            </ThemedText>
          ) : null}
          {lines.map((l) => (
            <View
              key={l.id}
              style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.two, borderTopWidth: 1, borderColor: theme.border }}>
              <View style={{ flex: 1 }}>
                <ThemedText type="small" numberOfLines={2}>
                  {l.label}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {l.sub}
                </ThemedText>
              </View>
              <ThemedText type="smallBold">{money(l.amount, true)}</ThemedText>
            </View>
          ))}
        </View>
      ) : null}
    </Card>
  );
}
