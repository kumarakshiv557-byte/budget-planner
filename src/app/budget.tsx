import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, CategoryPicker, Card, Chips, Field, Label, MonthSwitcher, Screen, styles, useCategoryColor, useMoney } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { currentMonth, itemAppliesTo, monthLabel } from '@/lib/budget';
import { useBudget } from '@/lib/store';
import { ITEM_TYPES, isRecurring, type BudgetItem, type ItemType } from '@/lib/types';

type Draft = { id?: string; name: string; categoryId: string; subcategoryId?: string; type: ItemType | null; amount: string; startMonth: string; endMonth: string };

const TYPE_LABEL = Object.fromEntries(ITEM_TYPES.map((t) => [t.id, t.label]));

export default function BudgetScreen() {
  const { state, saveItem, deleteItem } = useBudget();
  const money = useMoney();
  const colorFor = useCategoryColor();
  const theme = useTheme();
  const [month, setMonth] = useState(currentMonth());
  const [draft, setDraft] = useState<Draft | null>(null);

  const blank = (categoryId = state.categories[0]?.id ?? ''): Draft => ({
    name: '',
    categoryId,
    type: null,
    amount: '',
    startMonth: month,
    endMonth: '',
  });

  const edit = (i: BudgetItem) =>
    setDraft({ ...i, amount: String(i.amount), endMonth: i.endMonth ?? '' });

  const amount = Number((draft?.amount ?? '').replace(',', '.'));
  const valid =
    !!draft &&
    draft.type !== null &&
    draft.name.trim() !== '' &&
    Number.isFinite(amount) &&
    amount > 0 &&
    /^\d{4}-\d{2}$/.test(draft.startMonth) &&
    (draft.endMonth === '' || /^\d{4}-\d{2}$/.test(draft.endMonth));

  const save = () => {
    if (!draft || !valid || !draft.type) return;
    saveItem({
      id: draft.id,
      name: draft.name.trim(),
      categoryId: draft.categoryId,
      subcategoryId: draft.subcategoryId,
      type: draft.type,
      amount,
      startMonth: draft.startMonth,
      endMonth: isRecurring(draft.type) && draft.endMonth ? draft.endMonth : undefined,
    });
    setDraft(null);
  };

  const inMonth = state.items.filter((i) => itemAppliesTo(i, month));
  const later = state.items.filter((i) => !itemAppliesTo(i, month));

  return (
    <Screen title="Budget" right={<MonthSwitcher month={month} onChange={setMonth} />}>
      <ThemedText type="small" themeColor="textSecondary">
        Your forecast: what you expect to spend. Recurring items repeat every month from their start month; one-time items count
        only in their month.
      </ThemedText>

      {draft ? (
        <Card title={draft.id ? 'Edit item' : 'New item'}>
          <View style={styles.row}>
            <Field label="Name" value={draft.name} onChangeText={(name) => setDraft({ ...draft, name })} placeholder="e.g. Rent" />
            <Field
              label={isRecurring(draft.type) ? `Amount per month (${state.currency})` : `Amount (${state.currency})`}
              value={draft.amount}
              onChangeText={(a) => setDraft({ ...draft, amount: a })}
              keyboardType="decimal-pad"
              placeholder="0"
            />
          </View>
          <Label>Category</Label>
          <CategoryPicker
            categoryId={draft.categoryId}
            subcategoryId={draft.subcategoryId}
            onChange={(categoryId, subcategoryId) => setDraft({ ...draft, categoryId, subcategoryId })}
          />
          <Label>Type</Label>
          <Chips options={ITEM_TYPES} value={draft.type} onChange={(type) => setDraft({ ...draft, type })} />
          <ThemedText type="small" themeColor="textSecondary">
            {draft.type ? ITEM_TYPES.find((t) => t.id === draft.type)?.hint : 'Pick how this line behaves over time.'}
          </ThemedText>
          <View style={[styles.row, { marginTop: Spacing.two }]}>
            <Field
              label={isRecurring(draft.type) ? 'Starts (YYYY-MM)' : 'Month (YYYY-MM)'}
              value={draft.startMonth}
              onChangeText={(startMonth) => setDraft({ ...draft, startMonth })}
              placeholder="2026-11"
            />
            {isRecurring(draft.type) ? (
              <Field
                label="Ends (optional)"
                value={draft.endMonth}
                onChangeText={(endMonth) => setDraft({ ...draft, endMonth })}
                placeholder="never"
              />
            ) : null}
          </View>
          <View style={[styles.row, { marginTop: Spacing.three }]}>
            <Button label="Save" onPress={save} disabled={!valid} />
            <Button label="Cancel" kind="secondary" onPress={() => setDraft(null)} />
            {draft.id ? (
              <Button
                label="Delete"
                kind="danger"
                onPress={() => {
                  deleteItem(draft.id!);
                  setDraft(null);
                }}
              />
            ) : null}
          </View>
        </Card>
      ) : (
        <Button label="Add budget item" onPress={() => setDraft(blank())} />
      )}

      {state.categories.map((c) => {
        const items = inMonth.filter((i) => i.categoryId === c.id);
        const total = items.reduce((s, i) => s + i.amount, 0);
        return (
          <Card key={c.id}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two }}>
              <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colorFor(c) }} />
              <ThemedText type="smallBold" style={{ flex: 1 }}>
                {c.name}
              </ThemedText>
              <ThemedText type="smallBold">{money(total)}</ThemedText>
            </View>
            {items.length === 0 ? (
              <ThemedText type="small" themeColor="textSecondary">
                Nothing planned in {monthLabel(month)}.
              </ThemedText>
            ) : (
              items.map((i) => (
                <Pressable
                  key={i.id}
                  onPress={() => edit(i)}
                  style={{ flexDirection: 'row', paddingVertical: 6, borderTopWidth: 1, borderColor: theme.border }}>
                  <View style={{ flex: 1 }}>
                    <ThemedText type="small">{i.name}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      {i.subcategoryId ? `${state.subcategories.find((x) => x.id === i.subcategoryId)?.name ?? ''} · ` : ''}
                      {TYPE_LABEL[i.type]}
                      {i.endMonth ? ` · until ${monthLabel(i.endMonth, 'short')}` : ''}
                    </ThemedText>
                  </View>
                  <ThemedText type="small">{money(i.amount)}</ThemedText>
                </Pressable>
              ))
            )}
            <Pressable onPress={() => setDraft(blank(c.id))} style={{ paddingTop: 6 }}>
              <ThemedText type="small" style={{ color: theme.accent }}>
                + Add to {c.name}
              </ThemedText>
            </Pressable>
          </Card>
        );
      })}

      {later.length ? (
        <Card title="Not in this month" subtitle="One-time items in other months, and recurring items outside their dates.">
          {later.map((i) => (
            <Pressable key={i.id} onPress={() => edit(i)} style={{ flexDirection: 'row', paddingVertical: 6 }}>
              <ThemedText type="small" style={{ flex: 1 }}>
                {i.name} · {monthLabel(i.startMonth, 'short')} {i.startMonth.slice(0, 4)}
              </ThemedText>
              <ThemedText type="small">{money(i.amount)}</ThemedText>
            </Pressable>
          ))}
        </Card>
      ) : null}
    </Screen>
  );
}
