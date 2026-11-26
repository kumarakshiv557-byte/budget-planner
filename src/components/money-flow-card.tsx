import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { Sankey } from '@/components/sankey';
import { ThemedText } from '@/components/themed-text';
import { Card, Chips, MonthSwitcher, useCategoryColor, useCategoryLabel, useIsDark, useMoney, WhoseFilter } from '@/components/ui';
import { Spacing, TypeColors } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { OTHER_INCOME, addMonths, incomeSourceOf, incomeTagLabel, monthLabel, incomeInMonths, monthsBetween, moneyFlow, rangeLabel, transactionsInMonths, type FlowNode } from '@/lib/budget';
import { useBudget } from '@/lib/store';
import { ITEM_TYPES, type ItemType, type Month } from '@/lib/types';

const TYPE_LABEL = Object.fromEntries(ITEM_TYPES.map((t) => [t.id, t.label])) as Record<ItemType, string>;

/** Overview card: where this month's income went, as a Sankey, with the lines behind a tapped block. */
type Span = 'month' | '6m' | '12m' | 'custom';
const SPANS: { id: Span; label: string }[] = [
  { id: 'month', label: 'This month' },
  { id: '6m', label: 'Last 6 months' },
  { id: '12m', label: 'Last year' },
  { id: 'custom', label: 'Custom' },
];

export function MoneyFlowCard({ month }: { month: Month }) {
  const { state } = useBudget();
  const theme = useTheme();
  const dark = useIsDark();
  const money = useMoney();
  const colorFor = useCategoryColor();
  const [selected, setSelected] = useState<string | null>(null);
  // Inside a tapped category: the subcategory being looked at ('' = no subcategory), or null for all.
  const [subPick, setSubPick] = useState<string | null>(null);
  // The income tag split into its sub-tags on the chart (tapping a tag splits it; tapping elsewhere joins it back).
  const [expanded, setExpanded] = useState<string | null>(null);
  // The category split into its subcategories on the chart, the same way.
  const [expandedCat, setExpandedCat] = useState<string | null>(null);
  // Inside a picked income sub-tag that has names under it (MBWay › Staff › Ahmed): the name picked, or null for all.
  const [subSubPick, setSubSubPick] = useState<string | null>(null);
  const pickSub = (sub: string | null) => {
    setSubPick(sub);
    setSubSubPick(null);
  };
  const select = (id: string | null) => {
    const n = id ? flow.nodes.find((x) => x.id === id) : undefined;
    if (!id && subSubPick !== null) return setSubSubPick(null);
    if (!id && (expanded || expandedCat) && subPick !== null) return pickSub(null);
    if (n?.kind === 'income' && n.subSub !== undefined) {
      setSubSubPick(subSubPick === n.subSub ? null : n.subSub);
      return;
    }
    if ((n?.kind === 'income' || n?.kind === 'category') && n.sub !== undefined) {
      setSelected(n.kind === 'income' ? `in:${n.key}` : `cat:${n.key}`);
      pickSub(subPick === n.sub ? null : n.sub);
      return;
    }
    setSelected(id);
    pickSub(null);
    setExpanded(n?.kind === 'income' && n.key !== OTHER_INCOME ? n.key : null);
    setExpandedCat(n?.kind === 'category' && n.key !== 'none' ? n.key : null);
  };

  // Timeframe, ending at the month shown at the top of Overview (or any range with Custom).
  const [span, setSpan] = useState<Span>('month');
  const [from, setFrom] = useState<Month>(() => addMonths(month, -2));
  const [to, setTo] = useState<Month>(month);
  const months =
    span === 'month' ? [month] : span === '6m' ? monthsBetween(addMonths(month, -5), month) : span === '12m' ? monthsBetween(addMonths(month, -11), month) : monthsBetween(from, to);
  const period = rangeLabel(months);
  const flow = moneyFlow(state, months, 5, { expand: expanded ?? undefined, expandSub: expanded && subPick ? subPick : undefined, expandCategory: expandedCat ?? undefined });
  const catName = (id: string) => state.categories.find((c) => c.id === id)?.name ?? 'Uncategorised';
  const catLabel = useCategoryLabel();
  const subName = (id?: string) => (id ? state.subcategories.find((x) => x.id === id)?.name : undefined);
  const label = (n: FlowNode) =>
    n.kind === 'income'
      ? n.key === OTHER_INCOME
        ? 'Other income'
        : n.subSub !== undefined
          ? n.subSub || `Other ${(n.sub ?? '').toLowerCase()}`
          : n.sub !== undefined
            ? `${n.key} › ${n.sub || 'no sub-tag'}`
            : n.key
      : n.kind === 'gap'
        ? 'Not covered by income'
        : n.kind === 'total'
          ? months.length > 1 ? `${monthLabel(months[0], 'short')} – ${monthLabel(months[months.length - 1], 'short')}` : monthLabel(month, 'short')
          : n.kind === 'category'
            ? n.sub !== undefined
              ? subName(n.sub) ?? `Other ${catName(n.key).toLowerCase()}`
              : catName(n.key)
            : n.kind === 'leftover'
              ? 'Left over'
              : n.kind === 'subscriptions'
                ? 'Subscriptions'
              : TYPE_LABEL[n.key as ItemType];
  const color = (n: FlowNode) =>
    n.kind === 'income' || n.kind === 'leftover'
      ? theme.good
      : n.kind === 'gap'
        ? theme.critical
        : n.kind === 'total' || n.kind === 'subscriptions'
          ? theme.textSecondary
          : n.kind === 'category'
            ? colorFor(state.categories.find((c) => c.id === n.key))
            : TypeColors[n.key as ItemType][dark ? 1 : 0];

  const pieces = flow.nodes.filter((n) => n.kind === 'income' && n.sub !== undefined);
  const catPieces = flow.nodes.filter((n) => n.kind === 'category' && n.sub !== undefined);
  const node =
    flow.nodes.find((n) => n.id === selected) ??
    (expanded && selected === `in:${expanded}` && pieces.length
      ? ({ id: selected, kind: 'income', key: expanded, column: 0, value: pieces.reduce((s, n) => s + n.value, 0) } satisfies FlowNode)
      : expandedCat && selected === `cat:${expandedCat}` && catPieces.length
        ? ({ id: selected, kind: 'category', key: expandedCat, column: 2, value: Math.round(catPieces.reduce((s, n) => s + n.value, 0) * 100) / 100 } satisfies FlowNode)
        : undefined);
  const topSources = new Set(flow.nodes.filter((n) => n.kind === 'income').map((n) => n.key.toLowerCase()));
  const lines = !node
    ? []
    : node.kind === 'income'
      ? incomeInMonths(state.income, months)
          .filter((i) =>
            node.key === OTHER_INCOME
              ? !topSources.has(incomeSourceOf(i).toLowerCase())
              : incomeSourceOf(i).toLowerCase() === node.key.toLowerCase(),
          )
          .filter((i) => subPick === null || (i.subTag ?? '') === subPick)
          .filter((i) => subSubPick === null || (i.subSubTag ?? '') === subSubPick)
          .map((i) => ({ id: `${i.id}:${i.date}`, note: i.note, label: i.description, sub: i.tag ? `${i.date} · ${incomeTagLabel(i)}` : i.date, amount: i.amount }))
      : node.kind === 'category' || node.kind === 'type'
        ? transactionsInMonths(state.transactions, months)
            .filter((t) => (node.kind === 'category' ? (t.categoryId ?? 'none') === node.key : t.type === node.key))
            .filter((t) => node.kind !== 'category' || subPick === null || (t.subcategoryId ?? '') === subPick)
            .map((t) => ({
              id: t.id,
              note: t.note,
              label: t.description,
              sub: `${t.date} · ${node.kind === 'category' ? `${subName(t.subcategoryId) ? `${subName(t.subcategoryId)} · ` : ''}${TYPE_LABEL[t.type]}` : catLabel(t.categoryId, t.subcategoryId)}`,
              amount: t.amount,
            }))
        : [];
  lines.sort((a, b) => b.amount - a.amount);

  // Subcategory totals for a tapped category (only when it has any subcategorised spending).
  const subs =
    node?.kind === 'category'
      ? (() => {
          const m = new Map<string, { key: string; name: string; total: number; count: number }>();
          for (const t of transactionsInMonths(state.transactions, months)) {
            if ((t.categoryId ?? 'none') !== node.key) continue;
            const key = t.subcategoryId ?? '';
            const g = m.get(key) ?? { key, name: subName(t.subcategoryId) ?? 'No subcategory', total: 0, count: 0 };
            g.total += t.amount;
            g.count++;
            m.set(key, g);
          }
          const list = [...m.values()].sort((a, b) => b.total - a.total);
          return list.some((g) => g.key) ? list : [];
        })()
      : node?.kind === 'income' && node.key !== OTHER_INCOME
        ? (() => {
            const m = new Map<string, { key: string; name: string; total: number; count: number }>();
            for (const i of incomeInMonths(state.income, months)) {
              if (incomeSourceOf(i).toLowerCase() !== node.key.toLowerCase()) continue;
              const key = i.subTag ?? '';
              const g = m.get(key) ?? { key, name: i.subTag || 'No sub-tag', total: 0, count: 0 };
              g.total += i.amount;
              g.count++;
              m.set(key, g);
            }
            const list = [...m.values()].sort((a, b) => b.total - a.total);
            return list.some((g) => g.key) ? list : [];
          })()
        : [];

  // Names under the picked income sub-tag (Staff › Ahmed, …), when it has any.
  const subSubs =
    node?.kind === 'income' && subPick
      ? (() => {
          const m = new Map<string, { key: string; name: string; total: number; count: number }>();
          for (const i of incomeInMonths(state.income, months)) {
            if (incomeSourceOf(i).toLowerCase() !== node.key.toLowerCase() || (i.subTag ?? '') !== subPick) continue;
            const key = i.subSubTag ?? '';
            const g = m.get(key) ?? { key, name: i.subSubTag || `Other ${subPick.toLowerCase()}`, total: 0, count: 0 };
            g.total += i.amount;
            g.count++;
            m.set(key, g);
          }
          const list = [...m.values()].sort((a, b) => b.total - a.total);
          return list.some((g) => g.key) ? list : [];
        })()
      : [];

  const note = !node
    ? null
    : node.kind === 'gap'
      ? `You spent ${money(node.value, true)} more than the income recorded for ${period}. That came from savings or from income the app hasn't seen yet. Add it on the Income tab.`
      : node.kind === 'subscriptions'
        ? `Subscriptions are debited automatically, so they're kept as one block here and listed on their own in the Subscriptions card.`
        : node.kind === 'leftover'
        ? `${money(node.value, true)} of the income in ${period} hasn't been spent.`
        : node.kind === 'total'
          ? `Income ${money(flow.income, true)} · spent ${money(flow.spent, true)}.`
          : null;

  return (
    <Card
      title="Where your income went"
      subtitle={`${period}: income on the left, then categories, then types. Pick whose accounts to show. Tap a block to see what's in it; tapping an income tag splits it into its sub-tags, and tapping a category splits it into its subcategories.`}>
      <WhoseFilter />
      <Chips options={SPANS} value={span} onChange={(v) => { setSpan(v); select(null); }} />
      {span === 'custom' ? (
        <View style={{ gap: Spacing.one }}>
          {([['From', from, setFrom], ['To', to, setTo]] as const).map(([name, value, set]) => (
            <View key={name} style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two }}>
              <ThemedText type="small" themeColor="textSecondary" style={{ width: 44 }}>
                {name}
              </ThemedText>
              <MonthSwitcher
                month={value}
                onChange={(m) => {
                  set(m);
                  select(null);
                }}
              />
            </View>
          ))}
        </View>
      ) : null}
      {flow.nodes.length === 0 ? (
        <ThemedText type="small" themeColor="textSecondary">
          No income or spending recorded for {period} yet.
        </ThemedText>
      ) : (
        <>
          {flow.income === 0 ? (
            <ThemedText type="small" themeColor="textSecondary">
              No income recorded for {period}. Sync Revolut or add it on the Income tab.
            </ThemedText>
          ) : null}
          <Sankey
            nodes={flow.nodes.map((n) => ({ id: n.id, column: n.column, value: n.value, label: label(n), color: color(n) }))}
            links={flow.links}
            selected={
              pieces.length && node?.kind === 'income' && node.key === expanded
                ? subSubPick !== null
                  ? `in:${expanded}:${subPick}:${subSubPick}`
                  : subPick !== null
                    ? pieces.filter((n) => n.sub === subPick).map((n) => n.id)
                    : pieces.map((n) => n.id)
                : catPieces.length && node?.kind === 'category' && node.key === expandedCat
                  ? subPick !== null ? `cat:${expandedCat}:${subPick}` : catPieces.map((n) => n.id)
                  : selected
            }
            onSelect={select}
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
          {subs.length ? (
            <View style={{ marginTop: Spacing.two }}>
              <ThemedText type="small" themeColor="textSecondary">
                {node.kind === 'income' ? 'Sub-tags. Tap one to see just its payments.' : 'Subcategories. Tap one to see just its payments.'}
              </ThemedText>
              {subs.map((g) => {
                const on = subPick === g.key;
                return (
                  <Pressable
                    key={g.key || 'none'}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    onPress={() => pickSub(on ? null : g.key)}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: Spacing.two,
                      paddingVertical: Spacing.two,
                      paddingHorizontal: Spacing.two,
                      marginTop: Spacing.one,
                      borderRadius: 8,
                      borderWidth: 1,
                      borderColor: on ? theme.text : theme.border,
                      backgroundColor: on ? theme.backgroundSelected : 'transparent',
                    }}>
                    <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color(node!), opacity: g.key ? 1 : 0.45 }} />
                    <ThemedText type="small" style={{ flex: 1 }}>
                      {g.name} · {g.count}
                    </ThemedText>
                    <ThemedText type="smallBold">{money(g.total, true)}</ThemedText>
                  </Pressable>
                );
              })}
              {subPick !== null ? (
                <ThemedText type="smallBold" style={{ marginTop: Spacing.two }}>
                  {subs.find((g) => g.key === subPick)?.name}
                  {subSubPick !== null ? ` › ${subSubs.find((g) => g.key === subSubPick)?.name}` : ''} · {money(lines.reduce((a, l) => a + l.amount, 0), true)}
                </ThemedText>
              ) : null}
              {subSubs.map((g) => {
                const on = subSubPick === g.key;
                return (
                  <Pressable
                    key={`ss:${g.key || 'none'}`}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    onPress={() => setSubSubPick(on ? null : g.key)}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: Spacing.two,
                      paddingVertical: Spacing.two,
                      paddingHorizontal: Spacing.two,
                      marginTop: Spacing.one,
                      marginLeft: Spacing.four,
                      borderRadius: 8,
                      borderWidth: 1,
                      borderColor: on ? theme.text : theme.border,
                      backgroundColor: on ? theme.backgroundSelected : 'transparent',
                    }}>
                    <ThemedText type="small" style={{ flex: 1 }}>
                      {g.name} · {g.count}
                    </ThemedText>
                    <ThemedText type="smallBold">{money(g.total, true)}</ThemedText>
                  </Pressable>
                );
              })}
            </View>
          ) : null}
          {lines.map((l) => (
            <View
              key={l.id}
              style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.two, borderTopWidth: 1, borderColor: theme.border }}>
              <View style={{ flex: 1 }}>
                {l.note ? <ThemedText type="smallBold">{l.note}</ThemedText> : null}
                <ThemedText type="small" numberOfLines={2} themeColor={l.note ? 'textSecondary' : undefined}>
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
