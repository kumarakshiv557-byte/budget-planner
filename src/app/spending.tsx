import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, CategoryPicker, Card, Chips, Field, Label, MonthSwitcher, Screen, styles, useCategoryColor, useCategoryLabel, useIsDark, useMoney } from '@/components/ui';
import { Spacing, TypeColors } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { currentMonth, monthLabel, newId, paymentNote, transactionsIn } from '@/lib/budget';
import { parseRevolutCsv } from '@/lib/revolut-csv';
import { pickCsvText } from '@/lib/pick-file';
import { useBudget } from '@/lib/store';
import { ITEM_TYPES, PAYMENTS, isRecurring, type ItemType, type Payment, type Transaction } from '@/lib/types';

type Draft = { id?: string; date: string; description: string; amount: string; categoryId: string | null; subcategoryId?: string; type: ItemType; payment?: Payment };

type IncomeDraft = { id?: string; date: string; description: string; amount: string };

const TYPE_LABEL = Object.fromEntries(ITEM_TYPES.map((t) => [t.id, t.label]));
/** Type choices when sorting, with a one-tap "Subscription" (recurring, fixed, debited automatically) first. */
type TypePick = ItemType | 'subscription';
const TYPE_PICKS: { id: TypePick; label: string }[] = [{ id: 'subscription', label: '⚡ Subscription' }, ...ITEM_TYPES];
const today = () => new Date().toISOString().slice(0, 10);

export default function SpendingScreen() {
  const { state, saveTransaction, deleteTransaction, addTransactions, sortTransaction, addIncome, saveIncome, deleteIncome } = useBudget();
  const [incomeDraft, setIncomeDraft] = useState<IncomeDraft | null>(null);
  const money = useMoney();
  const colorFor = useCategoryColor();
  const catLabel = useCategoryLabel();
  const theme = useTheme();
  const dark = useIsDark();
  const [month, setMonth] = useState(currentMonth());
  const [draft, setDraft] = useState<Draft | null>(null);
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const [learn, setLearn] = useState(true);
  // Half-finished picks in "to sort": a row is sorted once it has both a category and a type.
  const [picks, setPicks] = useState<Record<string, { cat?: string; type?: TypePick }>>({});

  const incomeList = transactionsIn(state.income, month).sort((a, b) => b.date.localeCompare(a.date));
  const incomeAmount = Number((incomeDraft?.amount ?? '').replace(',', '.'));
  const incomeValid =
    !!incomeDraft && incomeDraft.description.trim() !== '' && Number.isFinite(incomeAmount) && incomeAmount > 0 && /^\d{4}-\d{2}-\d{2}$/.test(incomeDraft.date);
  const saveIncomeDraft = () => {
    if (!incomeDraft || !incomeValid) return;
    const before = incomeDraft.id ? state.income.find((x) => x.id === incomeDraft.id) : undefined;
    saveIncome({
      id: incomeDraft.id,
      date: incomeDraft.date,
      description: incomeDraft.description.trim(),
      amount: incomeAmount,
      source: before?.source ?? 'manual',
      externalId: before?.externalId,
    });
    setIncomeDraft(null);
  };
  const list = transactionsIn(state.transactions, month).sort((a, b) => b.date.localeCompare(a.date));
  const uncategorised = list.filter((t) => !t.categoryId);
  const amount = Number((draft?.amount ?? '').replace(',', '.'));
  const valid = !!draft && draft.description.trim() !== '' && Number.isFinite(amount) && amount !== 0 && /^\d{4}-\d{2}-\d{2}$/.test(draft.date);

  const importCsv = async () => {
    setNotice(null);
    try {
      const text = await pickCsvText();
      if (text == null) return;
      const r = parseRevolutCsv(text, state, newId);
      addTransactions(r.transactions);
      addIncome(r.income);
      const other = r.currencies.filter((c) => c !== state.currency);
      const parts = [`Imported ${r.transactions.length} transactions${r.income.length ? ` and ${r.income.length} income payments` : ''}.`];
      if (r.skippedDuplicates) parts.push(`${r.skippedDuplicates} were already here.`);
      if (r.skippedOther) parts.push(`${r.skippedOther} rows skipped (top-ups, exchanges, pending).`);
      if (other.length) parts.push(`Note: the file has ${other.join(', ')} amounts, which are added as-is to your ${state.currency} totals.`);
      setNotice({ text: parts.join(' ') });
      const newest = r.transactions.map((t) => t.date).sort().pop();
      if (newest) setMonth(newest.slice(0, 7));
    } catch (e) {
      setNotice({ text: e instanceof Error ? e.message : 'Could not read that file.', error: true });
    }
  };

  const save = () => {
    if (!draft || !valid) return;
    saveTransaction({
      id: draft.id,
      date: draft.date,
      description: draft.description.trim(),
      amount,
      categoryId: draft.categoryId,
      subcategoryId: draft.categoryId ? draft.subcategoryId : undefined,
      type: draft.type,
      payment: isRecurring(draft.type) ? draft.payment : undefined,
      source: draft.id ? (state.transactions.find((t) => t.id === draft.id)?.source ?? 'manual') : 'manual',
      externalId: draft.id ? state.transactions.find((t) => t.id === draft.id)?.externalId : undefined,
    });
    setDraft(null);
  };

  const edit = (t: Transaction) => setDraft({ ...t, amount: String(t.amount) });
  // For quick sorting: every category, each followed by its subcategories ("s:" ids).
  const sortOptions = state.categories.flatMap((c) => [
    { id: `c:${c.id}`, label: c.name },
    ...state.subcategories.filter((x) => x.categoryId === c.id).map((x) => ({ id: `s:${x.id}`, label: `${c.name} › ${x.name}` })),
  ]);
  const typeSwatch = (id: TypePick) => TypeColors[id === 'subscription' ? 'recurring-fixed' : id][dark ? 1 : 0];
  const sortSwatch = (id: string) => {
    const catId = id.startsWith('s:') ? state.subcategories.find((x) => x.id === id.slice(2))?.categoryId : id.slice(2);
    return colorFor(state.categories.find((c) => c.id === catId));
  };
  const pickFor = (tId: string, change: { cat?: string; type?: TypePick }) => {
    const next = { ...picks[tId], ...change };
    if (!next.cat || !next.type) {
      setPicks({ ...picks, [tId]: next });
      return;
    }
    const { [tId]: _done, ...rest } = picks;
    setPicks(rest);
    const sc = next.cat.startsWith('s:') ? state.subcategories.find((x) => x.id === next.cat!.slice(2)) : undefined;
    const categoryId = sc ? sc.categoryId : next.cat.slice(2);
    const typeAndTag = next.type === 'subscription' ? { type: 'recurring-fixed' as const, payment: 'auto' as const } : { type: next.type };
    sortTransaction(tId, { categoryId, subcategoryId: sc?.id, ...typeAndTag }, learn);
  };

  return (
    <Screen title="Spending" right={<MonthSwitcher month={month} onChange={setMonth} />}>
      <ThemedText type="small" themeColor="textSecondary">
        Your actuals. Add spending by hand, or import a statement from the Revolut app (Accounts → Statement → Excel/CSV).
      </ThemedText>

      <View style={styles.row}>
        <Button
          label="Add spending"
          onPress={() =>
            setDraft({ date: month === currentMonth() ? today() : `${month}-01`, description: '', amount: '', categoryId: null, type: 'variable-one-time' })
          }
        />
        <Button label="Import Revolut CSV" kind="secondary" onPress={importCsv} />
      </View>
      {notice ? (
        <ThemedText type="small" style={{ color: notice.error ? theme.critical : theme.textSecondary }}>
          {notice.error ? '⚠ ' : '✓ '}
          {notice.text}
        </ThemedText>
      ) : null}

      {draft ? (
        <Card title={draft.id ? 'Edit spending' : 'New spending'}>
          <View style={styles.row}>
            <Field label="What" value={draft.description} onChangeText={(description) => setDraft({ ...draft, description })} placeholder="e.g. Groceries" />
            <Field
              label={`Amount (${state.currency})`}
              value={draft.amount}
              onChangeText={(a) => setDraft({ ...draft, amount: a })}
              keyboardType="decimal-pad"
              placeholder="0"
            />
            <Field label="Date (YYYY-MM-DD)" value={draft.date} onChangeText={(date) => setDraft({ ...draft, date })} />
          </View>
          <Label>Category</Label>
          <CategoryPicker
            categoryId={draft.categoryId}
            subcategoryId={draft.subcategoryId}
            onChange={(categoryId, subcategoryId) => setDraft({ ...draft, categoryId, subcategoryId })}
          />
          <Label>Type</Label>
          <Chips options={ITEM_TYPES} value={draft.type} onChange={(type) => setDraft({ ...draft, type })} />
          {isRecurring(draft.type) ? (
            <>
              <Label>How is it paid?</Label>
              <Chips options={PAYMENTS} value={draft.payment ?? null} onChange={(payment) => setDraft({ ...draft, payment })} />
            </>
          ) : null}
          <View style={[styles.row, { marginTop: Spacing.three }]}>
            <Button label="Save" onPress={save} disabled={!valid} />
            <Button label="Cancel" kind="secondary" onPress={() => setDraft(null)} />
            {draft.id ? (
              <Button
                label="Delete"
                kind="danger"
                onPress={() => {
                  deleteTransaction(draft.id!);
                  setDraft(null);
                }}
              />
            ) : null}
          </View>
        </Card>
      ) : null}

      {uncategorised.length ? (
        <Card
          title={`${uncategorised.length} to sort`}
          subtitle="Pick a category and a type for each. ⚡ Subscription means recurring, fixed and debited automatically. With 'remember' on, other payments from the same place are sorted too, now and in future.">
          <Pressable onPress={() => setLearn(!learn)} accessibilityRole="checkbox" accessibilityState={{ checked: learn }}>
            <ThemedText type="small">{learn ? '☑' : '☐'} Remember my choices</ThemedText>
          </Pressable>
          {uncategorised.map((t) => (
            <View key={t.id} style={{ gap: Spacing.one, paddingVertical: Spacing.two, borderTopWidth: 1, borderColor: theme.border }}>
              <View style={{ flexDirection: 'row' }}>
                <ThemedText type="small" style={{ flex: 1 }}>
                  {t.description} · {t.date.slice(8)} {monthLabel(month, 'short')}
                </ThemedText>
                <ThemedText type="smallBold">{money(t.amount)}</ThemedText>
              </View>
              <ThemedText type="small" themeColor="textSecondary">
                Category
              </ThemedText>
              <Chips options={sortOptions} value={picks[t.id]?.cat ?? null} swatch={sortSwatch} onChange={(cat) => pickFor(t.id, { cat })} />
              <ThemedText type="small" themeColor="textSecondary">
                Type
              </ThemedText>
              <Chips options={TYPE_PICKS} value={picks[t.id]?.type ?? null} swatch={typeSwatch} onChange={(type) => pickFor(t.id, { type })} />
            </View>
          ))}
        </Card>
      ) : null}

      <Card title="Income" subtitle={`Money in during ${monthLabel(month)}: ${money(incomeList.reduce((s, t) => s + t.amount, 0))}. Synced from Revolut, imported, or added here.`}>
        {incomeDraft ? (
          <View style={{ gap: Spacing.two, paddingVertical: Spacing.two }}>
            <View style={styles.row}>
              <Field label="From" value={incomeDraft.description} onChangeText={(description) => setIncomeDraft({ ...incomeDraft, description })} placeholder="e.g. Salary" />
              <Field
                label={`Amount (${state.currency})`}
                value={incomeDraft.amount}
                onChangeText={(a) => setIncomeDraft({ ...incomeDraft, amount: a })}
                keyboardType="decimal-pad"
                placeholder="0"
              />
              <Field label="Date (YYYY-MM-DD)" value={incomeDraft.date} onChangeText={(date) => setIncomeDraft({ ...incomeDraft, date })} />
            </View>
            <View style={styles.row}>
              <Button label="Save" onPress={saveIncomeDraft} disabled={!incomeValid} />
              <Button label="Cancel" kind="secondary" onPress={() => setIncomeDraft(null)} />
              {incomeDraft.id ? (
                <Button
                  label="Delete"
                  kind="danger"
                  onPress={() => {
                    deleteIncome(incomeDraft.id!);
                    setIncomeDraft(null);
                  }}
                />
              ) : null}
            </View>
          </View>
        ) : (
          <Button
            label="Add income"
            kind="secondary"
            onPress={() => setIncomeDraft({ date: month === currentMonth() ? today() : `${month}-01`, description: '', amount: '' })}
          />
        )}
        {incomeList.map((t) => (
          <Pressable
            key={t.id}
            onPress={() => setIncomeDraft({ id: t.id, date: t.date, description: t.description, amount: String(t.amount) })}
            style={{ flexDirection: 'row', gap: Spacing.two, alignItems: 'center', paddingVertical: 6, borderTopWidth: 1, borderColor: theme.border }}>
            <View style={{ flex: 1 }}>
              <ThemedText type="small">{t.description}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {t.date}
                {t.source === 'csv' ? ' · imported' : t.source === 'revolut' ? ' · synced' : ''}
              </ThemedText>
            </View>
            <ThemedText type="small" style={{ color: theme.good }}>
              +{money(t.amount, true)}
            </ThemedText>
          </Pressable>
        ))}
      </Card>

      <Card title={`${list.length} transactions`} subtitle={`Total ${money(list.reduce((s, t) => s + t.amount, 0))}`}>
        {list.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">
            Nothing recorded in {monthLabel(month)}.
          </ThemedText>
        ) : (
          list.map((t) => {
            const c = state.categories.find((x) => x.id === t.categoryId);
            return (
              <Pressable
                key={t.id}
                onPress={() => edit(t)}
                style={{ flexDirection: 'row', gap: Spacing.two, alignItems: 'center', paddingVertical: 6, borderTopWidth: 1, borderColor: theme.border }}>
                <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colorFor(c) }} />
                <View style={{ flex: 1 }}>
                  <ThemedText type="small">{t.description}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {t.date} · {catLabel(t.categoryId, t.subcategoryId)} · {TYPE_LABEL[t.type]}
                    {t.payment ? ` · ${paymentNote(t)}` : ''}
                    {t.source === 'csv' ? ' · imported' : t.source === 'revolut' ? ' · synced' : ''}
                  </ThemedText>
                </View>
                <ThemedText type="small">{money(t.amount)}</ThemedText>
              </Pressable>
            );
          })
        )}
      </Card>
    </Screen>
  );
}
