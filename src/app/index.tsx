import { useState } from 'react';
import { View } from 'react-native';

import { PairedBars, ShareBar, StatTile, TrendChart } from '@/components/charts';
import { ThemedText } from '@/components/themed-text';
import { Card, MonthSwitcher, Screen, styles, useCategoryColor, useMoney } from '@/components/ui';
import { currentMonth, monthLabel, summarizeMonth, trend } from '@/lib/budget';
import { useBudget } from '@/lib/store';
import { ITEM_TYPES } from '@/lib/types';

const TYPE_LABEL = Object.fromEntries(ITEM_TYPES.map((t) => [t.id, t.label]));

export default function OverviewScreen() {
  const { state } = useBudget();
  const money = useMoney();
  const colorFor = useCategoryColor();
  const [month, setMonth] = useState(currentMonth());

  const summary = summarizeMonth(state, month);
  const months = trend(state, month, 6);
  const catName = (id: string | null) => state.categories.find((c) => c.id === id)?.name ?? 'Uncategorised';
  const remaining = summary.forecast - summary.actual;
  const empty = !state.items.length && !state.transactions.length;

  return (
    <Screen title="Overview" right={<MonthSwitcher month={month} onChange={setMonth} />}>
      {empty ? (
        <Card title="Start here">
          <ThemedText type="small" themeColor="textSecondary">
            Add what you expect to spend on the Budget tab, then add or import what you actually spent on the Spending tab. The
            charts here compare the two.
          </ThemedText>
        </Card>
      ) : null}

      <View style={styles.row}>
        <StatTile label="Forecast" value={money(summary.forecast)} note={monthLabel(month)} />
        <StatTile label="Actual" value={money(summary.actual)} />
        <StatTile
          label={remaining >= 0 ? 'Left to spend' : 'Over forecast'}
          value={money(Math.abs(remaining))}
          tone={remaining >= 0 ? 'good' : 'critical'}
          note={summary.forecast ? `${Math.round((summary.actual / summary.forecast) * 100)}% of forecast used` : undefined}
        />
      </View>

      <Card title="Forecast vs actual by category" subtitle="Tap a category for what's left.">
        <PairedBars
          rows={summary.byCategory.map((r) => ({
            key: r.categoryId ?? 'none',
            label: catName(r.categoryId),
            forecast: r.forecast,
            actual: r.actual,
            swatch: colorFor(state.categories.find((c) => c.id === r.categoryId)),
          }))}
        />
      </Card>

      <Card title="Where the money went" subtitle={`Actual spending in ${monthLabel(month)}, by category.`}>
        <ShareBar
          emptyText="No spending recorded for this month yet."
          slices={summary.byCategory.map((r) => ({
            key: r.categoryId ?? 'none',
            label: catName(r.categoryId),
            value: r.actual,
            color: colorFor(state.categories.find((c) => c.id === r.categoryId)),
          }))}
        />
      </Card>

      <Card title="Last 6 months" subtitle="Total forecast vs actual. Tap a month to see its numbers.">
        <TrendChart
          points={months.map((m) => ({
            key: m.month,
            label: monthLabel(m.month, 'short'),
            forecast: m.forecast,
            actual: m.actual,
          }))}
        />
      </Card>

      <Card title="Forecast vs actual by type" subtitle="Fixed costs are predictable; variable and one-time costs are where budgets slip.">
        <PairedBars
          rows={summary.byType.map((r) => ({ key: r.type, label: TYPE_LABEL[r.type], forecast: r.forecast, actual: r.actual }))}
        />
      </Card>
    </Screen>
  );
}
