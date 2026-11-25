import { Fragment, useState } from 'react';
import { Platform, Pressable, View } from 'react-native';

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
  useCategoryLabel,
  useIsDark,
  useMoney,
  usePersonTag,
  WhoseFilter,
} from '@/components/ui';
import { Spacing, TypeColors } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { billsCalendar, currentMonth, isTransferLine, monthLabel, newId, paymentNote, recentlySorted, sortedAlike, transactionsIn, transferRuleFrom } from '@/lib/budget';
import { downloadCalendar } from '@/lib/calendar-file';
import { parseRevolutCsv } from '@/lib/revolut-csv';
import { pickCsvText } from '@/lib/pick-file';
import { useBudget } from '@/lib/store';
import { ITEM_TYPES, LINE_TYPES, PAYMENTS, isRecurring, type BudgetItem, type ItemType, type Payment, type Transaction, type TxDetails } from '@/lib/types';

type Draft = { id?: string; date: string; description: string; amount: string; categoryId: string | null; subcategoryId?: string; type: ItemType; payment?: Payment; note?: string; remark?: string; owner?: string };

const TYPE_LABEL = Object.fromEntries(ITEM_TYPES.map((t) => [t.id, t.label]));
/** Type choices when sorting, with a one-tap "Subscription" (recurring, fixed, debited automatically) first. */
type TypePick = ItemType;
type Pick = { cat?: string; type?: TypePick; pay?: Payment; due?: string; note?: string; remark?: string; /** Typing a new subcategory (null = closed). */ newSub?: string | null };
const PAY_PICKS: { id: Payment; label: string }[] = [
  { id: 'auto', label: '⚡ Subscription (auto-debited)' },
  { id: 'manual', label: 'Pay myself' },
];
const TYPE_PICKS: { id: TypePick; label: string }[] = LINE_TYPES;
const today = () => new Date().toISOString().slice(0, 10);
/** "Sorted 14:05" today, else "Sorted 21 Nov". */
const sortedWhen = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Sorted';
  const sameDay = d.toDateString() === new Date().toDateString();
  return `Sorted ${sameDay ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString([], { day: 'numeric', month: 'short' })}`;
};

/** The bank's extra facts about a line, folded away behind a small "Details" toggle. */
function BankDetails({ d }: { d?: TxDetails }) {
  const [open, setOpen] = useState(false);
  const rows: [string, string | undefined][] = [
    ['Paid by', d?.kind],
    ['Business', d?.merchantType],
    ['Where', d?.place],
    ['Card used', d?.usedOn],
    ['Original amount', d?.foreign],
    ['Reference', d?.reference],
  ];
  const shown = rows.filter((r): r is [string, string] => !!r[1]);
  if (!shown.length) return null;
  const peek = [d?.kind, d?.merchantType].filter(Boolean).join(' · ');
  return (
    <View style={{ gap: 2 }}>
      <Pressable onPress={() => setOpen(!open)} accessibilityRole="button" accessibilityState={{ expanded: open }} hitSlop={6}>
        <ThemedText type="small" themeColor="textSecondary">
          {open ? '▾' : '▸'} Details{!open && peek ? ` · ${peek}` : ''}
        </ThemedText>
      </Pressable>
      {open
        ? shown.map(([k, v]) => (
            <ThemedText key={k} type="small" style={{ paddingLeft: Spacing.three }}>
              <ThemedText type="small" themeColor="textSecondary">
                {k}:{' '}
              </ThemedText>
              {v}
            </ThemedText>
          ))
        : null}
    </View>
  );
}

export default function SpendingScreen() {
  const { state, allState, whose, saveTransaction, resortTransaction, unsortTransaction, deleteTransaction, addTransactions, sortTransaction, markTransfer, undoTransfer, addSubcategory, saveItem, addIncome, } = useBudget();
  // When fixing a sorted payment: also fix the others from the same place sorted the same way.
  const [fixOthers, setFixOthers] = useState(true);
  // A bill just added from "to sort", offered for the calendar.
  const [newBill, setNewBill] = useState<BudgetItem | null>(null);
  const money = useMoney();
  const personTag = usePersonTag();
  const colorFor = useCategoryColor();
  const catLabel = useCategoryLabel();
  const theme = useTheme();
  const dark = useIsDark();
  const [month, setMonth] = useState(currentMonth());
  const [draft, setDraft] = useState<Draft | null>(null);
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const [learn, setLearn] = useState(true);
  // Half-finished picks in "to sort": a row is sorted once it has both a category and a type.
  const [picks, setPicks] = useState<Record<string, Pick>>({});
  // The last payment(s) taken out as a transfer, so it can be undone.
  const [moved, setMoved] = useState<{ removed: Transaction[]; rule?: string } | null>(null);
  // "Recently sorted": how many lines it shows (0 = closed), and which list the edit form opened in.
  const [recentCount, setRecentCount] = useState(0);
  const [editIn, setEditIn] = useState<'recent' | 'month'>('month');
  const takeOutAsTransfer = (t: Transaction) => {
    const rule = learn ? transferRuleFrom(t.description) : undefined;
    const removed = allState.transactions.filter((x) => x.id === t.id || (rule && !x.categoryId && isTransferLine(x.description, [rule])));
    markTransfer(t.id, learn);
    const { [t.id]: _gone, ...rest } = picks;
    setPicks(rest);
    setMoved({ removed, rule: rule && !(allState.transferRules ?? []).includes(rule) ? rule : undefined });
  };

  const list = transactionsIn(state.transactions, month).sort((a, b) => b.date.localeCompare(a.date));
  const uncategorised = list.filter((t) => !t.categoryId);
  const amount = Number((draft?.amount ?? '').replace(',', '.'));
  const valid =
    !!draft &&
    draft.description.trim() !== '' &&
    Number.isFinite(amount) &&
    amount !== 0 &&
    /^\d{4}-\d{2}-\d{2}$/.test(draft.date) &&
    (!isRecurring(draft.type) || !!draft.payment);

  const importCsv = async () => {
    setNotice(null);
    try {
      const text = await pickCsvText();
      if (text == null) return;
      const r = parseRevolutCsv(text, allState, newId);
      // A statement imported while looking at one person's money is theirs.
      const tag = <T extends object>(x: T): T => (whose !== 'all' && whose !== 'me' ? { ...x, owner: whose } : x);
      addTransactions(r.transactions.map(tag));
      addIncome(r.income.map(tag));
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

  const editing = draft?.id ? state.transactions.find((t) => t.id === draft.id) : undefined;
  const alike = editing && editing.source !== 'manual' ? sortedAlike(allState, editing) : [];
  const save = () => {
    if (!draft || !valid) return;
    if (editing && editing.categoryId && editing.source !== 'manual') {
      const { subcategoryId: _s, payment: _p, note: _n, remark: _r, owner: _o, ...base } = editing;
      resortTransaction(
        {
          ...base,
          date: draft.date,
          description: draft.description.trim(),
          amount,
          categoryId: draft.categoryId,
          ...(draft.categoryId && draft.subcategoryId ? { subcategoryId: draft.subcategoryId } : {}),
          type: draft.type,
          ...(isRecurring(draft.type) && draft.payment ? { payment: draft.payment } : {}),
          ...(draft.note?.trim() ? { note: draft.note.trim() } : {}),
          ...(draft.remark?.trim() ? { remark: draft.remark.trim() } : {}),
          ...(draft.owner && draft.owner !== 'me' ? { owner: draft.owner } : {}),
        },
        fixOthers,
      );
      setDraft(null);
      return;
    }
    saveTransaction({
      id: draft.id,
      date: draft.date,
      description: draft.description.trim(),
      amount,
      categoryId: draft.categoryId,
      subcategoryId: draft.categoryId ? draft.subcategoryId : undefined,
      type: draft.type,
      payment: isRecurring(draft.type) ? draft.payment : undefined,
      note: draft.note?.trim() || undefined,
      remark: draft.remark?.trim() || undefined,
      owner: draft.owner && draft.owner !== 'me' ? draft.owner : undefined,
      sortedAt: draft.categoryId ? new Date().toISOString() : undefined,
      source: draft.id ? (state.transactions.find((t) => t.id === draft.id)?.source ?? 'manual') : 'manual',
      externalId: draft.id ? state.transactions.find((t) => t.id === draft.id)?.externalId : undefined,
    });
    setDraft(null);
  };

  const edit = (t: Transaction, where: 'recent' | 'month' = 'month') => {
    setEditIn(where);
    setDraft({ ...t, amount: String(t.amount) });
  };
  const recent = recentCount ? recentlySorted(state.transactions) : [];
  // For quick sorting: every category, each followed by its subcategories ("s:" ids).
  // Quick sorting shows categories only; a picked category's subcategories appear under it.
  const sortOptions = state.categories.map((c) => ({ id: `c:${c.id}`, label: c.name }));
  const catOfPick = (id?: string) =>
    !id ? undefined : id.startsWith('s:') ? state.subcategories.find((x) => x.id === id.slice(2))?.categoryId : id.slice(2);
  const subOptions = (catId?: string) => {
    const subs = state.subcategories.filter((x) => x.categoryId === catId);
    return subs.length ? [{ id: `c:${catId}`, label: 'No subcategory' }, ...subs.map((x) => ({ id: `s:${x.id}`, label: x.name }))] : [];
  };
  const typeSwatch = (id: TypePick) => TypeColors[id][dark ? 1 : 0];
  const sortSwatch = (id: string) => {
    const catId = id.startsWith('s:') ? state.subcategories.find((x) => x.id === id.slice(2))?.categoryId : id.slice(2);
    return colorFor(state.categories.find((c) => c.id === catId));
  };
  /**
   * A row is sorted once it has a category and a type. A recurring type also needs "how is it paid?";
   * "Pay myself" then asks for the due day and is saved with its own button, adding a bill for reminders.
   */
  const pickFor = (t: Transaction, change: Partial<Pick>, commit = false) => {
    const next = { ...picks[t.id], ...change };
    if (change.type && change.type !== picks[t.id]?.type) next.pay = undefined;
    const recurring = next.type === 'recurring-fixed' || next.type === 'recurring-variable';
    const ready = !!next.cat && !!next.type && (!recurring || next.pay === 'auto' || (next.pay === 'manual' && commit));
    if (!ready) {
      setPicks({ ...picks, [t.id]: next });
      return;
    }
    const { [t.id]: _done, ...rest } = picks;
    setPicks(rest);
    const sc = next.cat!.startsWith('s:') ? state.subcategories.find((x) => x.id === next.cat!.slice(2)) : undefined;
    const categoryId = sc ? sc.categoryId : next.cat!.slice(2);
    const type = next.type!;
    const payment = recurring ? next.pay : undefined;
    sortTransaction(t.id, { categoryId, subcategoryId: sc?.id, type, payment, note: next.note, remark: next.remark }, learn);
    if (payment === 'manual') {
      const name = (next.note?.trim() || t.description).slice(0, 60);
      const exists = state.items.some((i) => i.payment === 'manual' && i.name.trim().toLowerCase() === name.toLowerCase());
      if (!exists) {
        const bill: BudgetItem = {
          id: newId(),
          name,
          categoryId,
          ...(sc ? { subcategoryId: sc.id } : {}),
          type,
          amount: t.amount,
          startMonth: t.date.slice(0, 7),
          payment: 'manual',
          dueDay: dueOf(t, next),
          paidMonths: [t.date.slice(0, 7)],
        };
        saveItem(bill);
        setNewBill(bill);
      }
    }
  };
  const dueOf = (t: Transaction, p?: Pick) => {
    const d = Number(p?.due ?? t.date.slice(8));
    return Number.isInteger(d) && d >= 1 && d <= 31 ? d : Number(t.date.slice(8));
  };

  const lineRow = (t: Transaction, where: 'recent' | 'month', when?: string) => {
            const c = state.categories.find((x) => x.id === t.categoryId);
            return (
              <Fragment key={t.id}>
              <Pressable
                onPress={() => (draft?.id === t.id && editIn === where ? setDraft(null) : edit(t, where))}
                style={{ flexDirection: 'row', gap: Spacing.two, alignItems: 'center', paddingVertical: 6, borderTopWidth: 1, borderColor: theme.border }}>
                <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colorFor(c) }} />
                <View style={{ flex: 1 }}>
                  {t.note ? <ThemedText type="smallBold">{t.note}</ThemedText> : null}
                  <ThemedText type="small" themeColor={t.note ? 'textSecondary' : undefined}>
                    {t.description}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {when ?? t.date} · {t.categoryId ? `${catLabel(t.categoryId, t.subcategoryId)} · ${TYPE_LABEL[t.type]}` : 'Unsorted'}
                    {t.payment ? ` · ${paymentNote(t)}` : ''}
                    {t.source === 'csv' ? ' · imported' : t.source === 'revolut' ? ' · synced' : ''}
                    {personTag(t)}
                  </ThemedText>
                  {t.remark ? (
                    <ThemedText type="small" style={{ fontStyle: 'italic' }}>
                      💬 {t.remark}
                    </ThemedText>
                  ) : null}
                </View>
                <ThemedText type="small">{money(t.amount, true)}</ThemedText>
              </Pressable>
              {draft?.id === t.id && editIn === where ? <View style={{ paddingBottom: Spacing.two }}>{draftForm}</View> : null}
              </Fragment>
            );
  };

  // Editing opens right under the tapped line; a new entry opens at the top.
  const draftForm = draft ? (
      <Card title={draft.id ? 'Edit spending' : 'New spending'}>
        <BankDetails d={editing?.details} />
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
        <View style={styles.row}>
          <Field
            label="What's it for? (optional, remembered for this place)"
            value={draft.note ?? ''}
            onChangeText={(note) => setDraft({ ...draft, note })}
            placeholder="e.g. Office lunch with the team"
          />
        </View>
        <View style={styles.row}>
          <Field
            label="Remark (just this payment, not remembered)"
            value={draft.remark ?? ''}
            onChangeText={(remark) => setDraft({ ...draft, remark })}
            placeholder="e.g. Split with Ana, she owes me half"
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
        <Chips options={LINE_TYPES} value={draft.type} onChange={(type) => setDraft({ ...draft, type })} />
        {isRecurring(draft.type) ? (
          <>
            <Label>How is it paid?</Label>
            <Chips options={PAYMENTS} value={draft.payment ?? null} onChange={(payment) => setDraft({ ...draft, payment })} />
          </>
        ) : null}
        {alike.length ? (
          <Pressable
            onPress={() => setFixOthers(!fixOthers)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: fixOthers }}
            style={{ marginTop: Spacing.two }}>
            <ThemedText type="small">
              {fixOthers ? '☑' : '☐'} Also fix the {alike.length} other payment{alike.length === 1 ? '' : 's'} from here sorted the same way, and
              remember this for next time
            </ThemedText>
          </Pressable>
        ) : null}
        <View style={[styles.row, { marginTop: Spacing.three }]}>
          <Button label="Save" onPress={save} disabled={!valid} />
          <Button label="Cancel" kind="secondary" onPress={() => setDraft(null)} />
          {editing?.categoryId && editing.source !== 'manual' ? (
            <Button
              label="Send back to sort"
              kind="secondary"
              onPress={() => {
                unsortTransaction(editing.id, fixOthers);
                setDraft(null);
              }}
            />
          ) : null}
          {editing && editing.source !== 'manual' ? (
            <Button
              label="↔ Transfer"
              kind="secondary"
              onPress={() => {
                takeOutAsTransfer(editing);
                setDraft(null);
              }}
            />
          ) : null}
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
  ) : null;

  return (
    <Screen title="Spending" right={<MonthSwitcher month={month} onChange={setMonth} />}>
      <WhoseFilter />
      <ThemedText type="small" themeColor="textSecondary">
        Your actuals. Add spending by hand, or import a statement from the Revolut app (Accounts → Statement → Excel/CSV).
      </ThemedText>

      <View style={styles.row}>
        <Button
          label="Add spending"
          onPress={() =>
            setDraft({ date: month === currentMonth() ? today() : `${month}-01`, description: '', amount: '', categoryId: null, type: 'variable-one-time', owner: whose === 'all' ? 'me' : whose })
          }
        />
        <Button label="Import Revolut CSV" kind="secondary" onPress={importCsv} />
        <Button
          label={recentCount ? 'Hide recently sorted' : '✎ Fix recently sorted'}
          kind="secondary"
          onPress={() => {
            if (recentCount && editIn === 'recent') setDraft(null);
            setRecentCount(recentCount ? 0 : 15);
          }}
        />
      </View>
      {notice ? (
        <ThemedText type="small" style={{ color: notice.error ? theme.critical : theme.textSecondary }}>
          {notice.error ? '⚠ ' : '✓ '}
          {notice.text}
        </ThemedText>
      ) : null}

      {draft && !draft.id ? draftForm : null}

      {newBill ? (
        <Card title={`Added "${newBill.name}" to your bills`} subtitle={`Due on day ${newBill.dueDay} each month. It shows in Bills to pay on Overview.`}>
          <View style={styles.row}>
            {Platform.OS === 'web' ? (
              <Button
                label="📅 Add to my calendar"
                onPress={() => {
                  downloadCalendar(billsCalendar([newBill], state.currency), `${newBill.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.ics`);
                  setNewBill(null);
                }}
              />
            ) : null}
            <Button label="Done" kind="secondary" onPress={() => setNewBill(null)} />
          </View>
        </Card>
      ) : null}

      {moved ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two, flexWrap: 'wrap' }}>
          <ThemedText type="small" themeColor="textSecondary" style={{ flex: 1, minWidth: 200 }}>
            ↔ Left out {moved.removed.length === 1 ? `"${moved.removed[0].description}"` : `${moved.removed.length} payments`} as money moved between your own accounts
            {moved.rule ? '. Future ones like it will be left out too.' : '.'}
          </ThemedText>
          <Button
            label="Undo"
            kind="secondary"
            onPress={() => {
              undoTransfer(moved.removed, moved.rule);
              setMoved(null);
            }}
          />
        </View>
      ) : null}

      {recentCount ? (
        <Card
          title="Recently sorted"
          subtitle="Newest first, across all months. Tap a line to change its category, type or how it's paid, mark it as a transfer, or send it back to sort.">
          {recent.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary">
              Nothing sorted yet.
            </ThemedText>
          ) : (
            recent.slice(0, recentCount).map((t) => lineRow(t, 'recent', t.sortedAt ? `${sortedWhen(t.sortedAt)} · paid ${t.date}` : t.date))
          )}
          {recent.length > recentCount ? <Button label="Show more" kind="secondary" onPress={() => setRecentCount(recentCount + 15)} /> : null}
        </Card>
      ) : null}

      {uncategorised.length ? (
        <Card
          title={`${uncategorised.length} to sort`}
          subtitle="Pick a category and a type for each. Recurring ones also ask how they're paid: Subscription (auto-debited) or Pay myself. With 'remember' on, other payments from the same place are sorted too, now and in future. Money moved between your own accounts isn't spending: tap Transfer to leave it out.">
          <Pressable onPress={() => setLearn(!learn)} accessibilityRole="checkbox" accessibilityState={{ checked: learn }}>
            <ThemedText type="small">{learn ? '☑' : '☐'} Remember my choices</ThemedText>
          </Pressable>
          {uncategorised.map((t) => (
            <View key={t.id} style={{ gap: Spacing.one, paddingVertical: Spacing.two, borderTopWidth: 1, borderColor: theme.border }}>
              <View style={{ flexDirection: 'row' }}>
                <ThemedText type="small" style={{ flex: 1 }}>
                  {t.description} · {t.date.slice(8)} {monthLabel(month, 'short')}
                </ThemedText>
                <ThemedText type="smallBold">{money(t.amount, true)}</ThemedText>
              </View>
              <BankDetails d={t.details} />
              <Field
                label="What's it for? (optional)"
                value={picks[t.id]?.note ?? ''}
                onChangeText={(note) => setPicks({ ...picks, [t.id]: { ...picks[t.id], note } })}
                placeholder="e.g. Netflix for the family"
              />
              <Field
                label="Remark (just this payment, not remembered)"
                value={picks[t.id]?.remark ?? ''}
                onChangeText={(remark) => setPicks({ ...picks, [t.id]: { ...picks[t.id], remark } })}
                placeholder="e.g. Split with Ana, she owes me half"
              />
              <Pressable
                onPress={() => takeOutAsTransfer(t)}
                accessibilityRole="button"
                style={{ alignSelf: 'flex-start', paddingVertical: Spacing.one, paddingHorizontal: Spacing.three, borderRadius: 999, borderWidth: 1, borderColor: theme.border }}>
                <ThemedText type="small">↔ Transfer between our accounts</ThemedText>
              </Pressable>
              <ThemedText type="small" themeColor="textSecondary">
                Category
              </ThemedText>
              <Chips
                options={sortOptions}
                value={catOfPick(picks[t.id]?.cat) ? `c:${catOfPick(picks[t.id]?.cat)}` : null}
                swatch={sortSwatch}
                onChange={(cat) => pickFor(t, { cat })}
              />
              {catOfPick(picks[t.id]?.cat) ? (
                <View style={{ paddingLeft: Spacing.three, gap: Spacing.one }}>
                  <ThemedText type="small" themeColor="textSecondary">
                    Subcategory (optional)
                  </ThemedText>
                  <Chips
                    options={[...subOptions(catOfPick(picks[t.id]?.cat)), { id: 'new', label: '+ New subcategory' }]}
                    value={picks[t.id]?.newSub != null ? 'new' : (picks[t.id]?.cat ?? null)}
                    onChange={(cat) =>
                      cat === 'new' ? setPicks({ ...picks, [t.id]: { ...picks[t.id], newSub: '' } }) : pickFor(t, { cat, newSub: null })
                    }
                  />
                  {picks[t.id]?.newSub != null ? (
                    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.two }}>
                      <Field
                        label={`New subcategory in ${state.categories.find((c) => c.id === catOfPick(picks[t.id]?.cat))?.name ?? 'this category'}`}
                        value={picks[t.id]?.newSub ?? ''}
                        onChangeText={(newSub) => setPicks({ ...picks, [t.id]: { ...picks[t.id], newSub } })}
                        placeholder="e.g. Groceries"
                      />
                      <Button
                        label="Add"
                        disabled={!picks[t.id]?.newSub?.trim()}
                        onPress={() => {
                          const catId = catOfPick(picks[t.id]?.cat)!;
                          const id = addSubcategory(catId, picks[t.id]!.newSub!);
                          // Picked, but not sorted yet: the type is still to choose.
                          setPicks({ ...picks, [t.id]: { ...picks[t.id], cat: `s:${id}`, newSub: null } });
                        }}
                      />
                    </View>
                  ) : null}
                </View>
              ) : null}
              <ThemedText type="small" themeColor="textSecondary">
                Type
              </ThemedText>
              <Chips options={TYPE_PICKS} value={picks[t.id]?.type ?? null} swatch={typeSwatch} onChange={(type) => pickFor(t, { type })} />
              {picks[t.id]?.type === 'recurring-fixed' || picks[t.id]?.type === 'recurring-variable' ? (
                <>
                  <ThemedText type="small" themeColor="textSecondary">
                    How is it paid?
                  </ThemedText>
                  <Chips options={PAY_PICKS} value={picks[t.id]?.pay ?? null} onChange={(pay) => pickFor(t, { pay })} />
                </>
              ) : null}
              {picks[t.id]?.pay === 'manual' ? (
                <View style={{ gap: Spacing.two }}>
                  <View style={styles.row}>
                    <Field
                      label="Due on day of the month (1-31)"
                      value={picks[t.id]?.due ?? String(Number(t.date.slice(8)))}
                      onChangeText={(v) => setPicks({ ...picks, [t.id]: { ...picks[t.id], due: v.replace(/[^0-9]/g, '').slice(0, 2) } })}
                      keyboardType="number-pad"
                    />
                  </View>
                  <ThemedText type="small" themeColor="textSecondary">
                    Saving adds it to Bills to pay (this month marked paid), with a calendar reminder on the day and an app reminder the day before.
                  </ThemedText>
                  <Button label="Save and add the bill" onPress={() => pickFor(t, {}, true)} disabled={!picks[t.id]?.cat} />
                </View>
              ) : null}
            </View>
          ))}
        </Card>
      ) : null}

      <Card title={`${list.length} transactions`} subtitle={`Total ${money(list.reduce((s, t) => s + t.amount, 0))}`}>
        {list.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">
            Nothing recorded in {monthLabel(month)}.
          </ThemedText>
        ) : (
list.map((t) => lineRow(t, 'month'))
        )}
      </Card>
    </Screen>
  );
}
