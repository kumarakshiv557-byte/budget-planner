import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import {
  Button,
  CategoryPicker,
  Card,
  Chips,
  Field,
  Label,
  MonthSwitcher,
  PersonChips,
  Screen,
  styles,
  useCategoryColor,
  useMoney,
  usePersonTag,
  WhoseFilter,
} from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { currentMonth, itemAppliesTo, monthLabel, paymentNote } from '@/lib/budget';
import { useBudget } from '@/lib/store';
import { ITEM_TYPES, PAYMENTS, isRecurring, type BudgetItem, type ItemType, type Payment } from '@/lib/types';

type Draft = {
  id?: string;
  name: string;
  categoryId: string;
  subcategoryId?: string;
  type: ItemType | null;
  payment?: Payment;
  dueDay: string;
  amount: string;
  startMonth: string;
  endMonth: string;
  paidMonths?: string[];
  owner?: string;
};
type Filter = 'all' | Payment;
const FILTERS: { id: Filter; label: string }[] = [{ id: 'all', label: 'All' }, ...PAYMENTS.map((p) => ({ id: p.id as Filter, label: p.label }))];


const TYPE_LABEL = Object.fromEntries(ITEM_TYPES.map((t) => [t.id, t.label]));

export default function BudgetScreen() {
  const { state, whose, saveItem, deleteItem } = useBudget();
  const personTag = usePersonTag();
  const money = useMoney();
  const colorFor = useCategoryColor();
  const theme = useTheme();
  const [month, setMonth] = useState(currentMonth());
  const [draft, setDraft] = useState<Draft | null>(null);

  const blank = (categoryId = state.categories[0]?.id ?? ''): Draft => ({
    name: '',
    categoryId,
    type: null,
    dueDay: '',
    amount: '',
    startMonth: month,
    endMonth: '',
    owner: whose === 'all' ? 'me' : whose,
  });

  const edit = (i: BudgetItem) =>
    setDraft({ ...i, amount: String(i.amount), endMonth: i.endMonth ?? '', dueDay: i.dueDay ? String(i.dueDay) : '' });
  const [filter, setFilter] = useState<Filter>('all');
  const dueDay = Number(draft?.dueDay);
  const dueValid = !draft?.dueDay || (Number.isInteger(dueDay) && dueDay >= 1 && dueDay <= 31);

  const amount = Number((draft?.amount ?? '').replace(',', '.'));
  const valid =
    !!draft &&
    draft.type !== null &&
    draft.name.trim() !== '' &&
    Number.isFinite(amount) &&
    amount > 0 &&
    /^\d{4}-\d{2}$/.test(draft.startMonth) &&
    (draft.endMonth === '' || /^\d{4}-\d{2}$/.test(draft.endMonth)) &&
    // Recurring lines must say how they're paid; "Pay myself" needs its due day for reminders.
    (!isRecurring(draft.type) || !!draft.payment) &&
    (draft.payment !== 'manual' || !isRecurring(draft.type) || draft.dueDay !== '') &&
    dueValid;

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
      ...(isRecurring(draft.type) && draft.payment
        ? { payment: draft.payment, ...(draft.payment === 'manual' && draft.dueDay ? { dueDay } : {}) }
        : {}),
      paidMonths: draft.paidMonths,
      ...(draft.owner && draft.owner !== 'me' ? { owner: draft.owner } : {}),
    });
    setDraft(null);
  };

  const shown = state.items.filter((i) => filter === 'all' || i.payment === filter);
  const inMonth = shown.filter((i) => itemAppliesTo(i, month));
  const later = shown.filter((i) => !itemAppliesTo(i, month));

  return (
    <Screen title="Budget" right={<MonthSwitcher month={month} onChange={setMonth} />}>
      <WhoseFilter />
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
          <Label>Whose money</Label>
          <PersonChips value={draft.owner ?? 'me'} onChange={(owner) => setDraft({ ...draft, owner })} />
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
          {isRecurring(draft.type) ? (
            <>
              <Label>How is it paid?</Label>
              <Chips options={PAYMENTS} value={draft.payment ?? null} onChange={(payment) => setDraft({ ...draft, payment })} />
              <ThemedText type="small" themeColor="textSecondary">
                {draft.payment ? PAYMENTS.find((p) => p.id === draft.payment)?.hint : 'Pick one: subscriptions get their own list; bills you pay yourself get reminders.'}
              </ThemedText>
              {draft.payment === 'manual' ? (
                <View style={styles.row}>
                  <Field
                    label="Due on day of the month (1-31)"
                    value={draft.dueDay}
                    onChangeText={(v) => setDraft({ ...draft, dueDay: v.replace(/[^0-9]/g, '') })}
                    keyboardType="number-pad"
                    placeholder="e.g. 5"
                  />
                </View>
              ) : null}
            </>
          ) : null}
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

      <Chips options={FILTERS} value={filter} onChange={setFilter} />

      {state.categories.map((c) => {
        const items = inMonth.filter((i) => i.categoryId === c.id);
        if (filter !== 'all' && !items.length) return null;
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
                      {i.payment ? ` · ${paymentNote(i)}` : ''}
                      {i.endMonth ? ` · until ${monthLabel(i.endMonth, 'short')}` : ''}
                      {personTag(i)}
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
