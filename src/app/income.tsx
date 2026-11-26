import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, Checkbox, Chips, Field, Label, MonthSwitcher, PersonChips, Screen, styles, useMoney, usePersonTag, WhoseFilter } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { currentMonth, incomeIn, incomeSubSubTagsOf, incomeSubTagsOf, incomeTagLabel, incomeTagsOf, monthLabel, transferRuleOf } from '@/lib/budget';
import { useBudget } from '@/lib/store';
import { ownerOf } from '@/lib/types';

const OWN_TAG = '__own';

type IncomeDraft = { id?: string; date: string; description: string; amount: string; owner?: string; monthly?: boolean; endMonth?: string; tag?: string; note?: string; newTag?: string; subTag?: string; subSubTag?: string };

const today = () => new Date().toISOString().slice(0, 10);

/** One line left out as a transfer, for the list on this tab. */
type Moved = { key: string; date: string; description: string; amount: number; owner?: string; dir: 'in' | 'out'; why?: string; lineId?: string };

export default function IncomeScreen() {
  const { state, allState, whose, saveIncome, deleteIncome, tagIncome, putBackTransfer, forgetTransferRule } = useBudget();
  const money = useMoney();
  const personTag = usePersonTag();
  const theme = useTheme();
  const [month, setMonth] = useState(currentMonth());
  const [learn, setLearn] = useState(true);
  const [incomeDraft, setIncomeDraft] = useState<IncomeDraft | null>(null);
  const [ownTag, setOwnTag] = useState<{ id: string; text: string; sub?: string } | null>(null);

  const incomeList = incomeIn(state.income, month).sort((a, b) => b.date.localeCompare(a.date));
  // Lines tagged only by the default for unknown senders stay here, so they can still be given their own tag.
  const untagged = incomeList.filter((t) => !t.tag || t.defaulted);
  const tagOptions = incomeTagsOf(state).map((t) => ({ id: t, label: t }));
  const draftTag = (incomeDraft?.newTag?.trim() || incomeDraft?.tag)?.trim() || undefined;
  const draftSubTags = incomeSubTagsOf(state, draftTag);
  const draftSub = (draftTag && incomeDraft?.subTag?.trim()) || undefined;
  const draftSubSubTags = incomeSubSubTagsOf(state, draftTag, draftSub);
  const incomeEditing = incomeDraft?.id ? state.income.find((x) => x.id === incomeDraft.id) : undefined;
  const incomeAmount = Number((incomeDraft?.amount ?? '').replace(',', '.'));
  const incomeValid =
    !!incomeDraft && incomeDraft.description.trim() !== '' && Number.isFinite(incomeAmount) && incomeAmount > 0 && /^\d{4}-\d{2}-\d{2}$/.test(incomeDraft.date);
  const saveIncomeDraft = () => {
    if (!incomeDraft || !incomeValid) return;
    const before = incomeDraft.id ? state.income.find((x) => x.id === incomeDraft.id) : undefined;
    const tag = (incomeDraft.newTag?.trim() || incomeDraft.tag)?.trim() || undefined;
    const note = incomeDraft.note?.trim() || undefined;
    const subTag = (tag && incomeDraft.subTag?.trim()) || undefined;
    const subSubTag = (subTag && incomeDraft.subSubTag?.trim()) || undefined;
    saveIncome({
      ...(!before && tag ? { tag } : {}),
      ...(!before && subTag ? { subTag } : {}),
      ...(!before && subSubTag ? { subSubTag } : {}),
      ...(before?.subSubTag ? { subSubTag: before.subSubTag } : {}),
      ...(before?.defaulted ? { defaulted: true } : {}),
      ...(before?.subTag ? { subTag: before.subTag } : {}),
      ...(!before && note ? { note } : {}),
      ...(before?.tag ? { tag: before.tag } : {}),
      ...(before?.note ? { note: before.note } : {}),
      id: incomeDraft.id,
      date: incomeDraft.date,
      description: incomeDraft.description.trim(),
      amount: incomeAmount,
      source: before?.source ?? 'manual',
      externalId: before?.externalId,
      ...(incomeDraft.owner && incomeDraft.owner !== 'me' ? { owner: incomeDraft.owner } : {}),
      ...(incomeDraft.monthly && (before?.source ?? 'manual') === 'manual' ? { monthly: true, ...(incomeDraft.endMonth ? { endMonth: incomeDraft.endMonth } : {}) } : {}),
    });
    // Changing the tag or note of an existing line goes through tagging, so it can be remembered for the sender.
    if (before && (tag !== before.tag || note !== before.note || subTag !== before.subTag || subSubTag !== before.subSubTag || before.defaulted))
      tagIncome(before.id, tag, note, learn, subTag, subSubTag);
    setIncomeDraft(null);
  };

  // Everything left out as a transfer this month: lines you marked yourself (can be put back one by one) and lines
  // the sync left out, because they match a remembered transfer or their other side is in another of your accounts.
  const mine = (x: { owner?: string }) => whose === 'all' || ownerOf(x) === whose;
  const inMonth = (d: string) => d.slice(0, 7) === month;
  const marked = (allState.transferred ?? []).filter((x) => inMonth(x.line.date) && mine(x.line));
  const markedExt = new Set(marked.map((x) => x.line.externalId).filter(Boolean));
  const moved: Moved[] = [
    ...marked.map(({ line, rule }) => ({ key: `m:${line.id}`, date: line.date, description: line.description, amount: line.amount, owner: line.owner, dir: 'out' as const, why: rule, lineId: line.id })),
    ...(allState.transferLog ?? [])
      .filter((x) => inMonth(x.date) && mine(x) && !(x.dir === 'out' && markedExt.has(x.externalId)))
      .map((x) => ({ key: `${x.dir}:${x.externalId}`, date: x.date, description: x.description, amount: x.amount, owner: x.owner, dir: x.dir, why: x.why })),
  ].sort((a, b) => b.date.localeCompare(a.date));
  const movedIn = moved.filter((x) => x.dir === 'in').reduce((s, x) => s + x.amount, 0);
  const movedOut = moved.filter((x) => x.dir === 'out').reduce((s, x) => s + x.amount, 0);
  const reason = (x: Moved) =>
    x.why === 'pair' ? 'other side found in another of your accounts' : x.why ? `matches “${x.why}”` : 'marked by you';
  const rules = allState.transferRules ?? [];
  const linesFor = (rule: string) =>
    (allState.transferLog ?? []).filter((x) => transferRuleOf(x.description, [rule]) === rule).length +
    (allState.transferred ?? []).filter((x) => x.rule === rule).length;

  return (
    <Screen title="Income" right={<MonthSwitcher month={month} onChange={setMonth} />}>
      <WhoseFilter />
      <Card title="Income" subtitle={`Money in during ${monthLabel(month)}: ${money(incomeList.reduce((s, t) => s + t.amount, 0))}. Synced from Revolut, imported, or added here.`}>
        {untagged.length ? (
          <View style={{ gap: Spacing.one }}>
            <ThemedText type="smallBold">{untagged.length} to tag</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Pick what each one is. With “remember” on, money from the same sender is tagged the same way, now and in future.
              {allState.defaultIncomeTag?.tag ? ` Senders you haven't tagged go under ${incomeTagLabel(allState.defaultIncomeTag)} until you do.` : ''}
            </ThemedText>
            <Pressable onPress={() => setLearn(!learn)} accessibilityRole="checkbox" accessibilityState={{ checked: learn }}>
              <ThemedText type="small">{learn ? '☑' : '☐'} Remember my choices</ThemedText>
            </Pressable>
            {untagged.map((t) => (
              <View key={t.id} style={{ gap: Spacing.one, paddingVertical: Spacing.two, borderTopWidth: 1, borderColor: theme.border }}>
                <View style={{ flexDirection: 'row' }}>
                  <ThemedText type="small" style={{ flex: 1 }}>
                    {t.description} · {t.date.slice(8)} {monthLabel(month, 'short')}
                    {personTag(t)}
                    {t.defaulted ? ` · for now ${incomeTagLabel(t)}` : ''}
                  </ThemedText>
                  <ThemedText type="smallBold" style={{ color: theme.good }}>
                    +{money(t.amount, true)}
                  </ThemedText>
                </View>
                <Chips
                  options={[...tagOptions, { id: OWN_TAG, label: '+ Own tag' }]}
                  value={ownTag?.id === t.id ? OWN_TAG : null}
                  onChange={(tag) => (tag === OWN_TAG ? setOwnTag(ownTag?.id === t.id ? null : { id: t.id, text: '' }) : tagIncome(t.id, tag, undefined, learn))}
                />
                {ownTag?.id === t.id ? (
                  <View style={[styles.row, { alignItems: 'flex-end' }]}>
                    <Field
                      label="Your tag"
                      value={ownTag.text}
                      autoFocus
                      onChangeText={(text) => setOwnTag({ ...ownTag, text })}
                      placeholder="e.g. MBWay"
                    />
                    <Field label="Sub-tag (optional)" value={ownTag.sub ?? ''} onChangeText={(sub) => setOwnTag({ ...ownTag, sub })} placeholder="e.g. Ahmed" />
                    <Button
                      label="Save"
                      disabled={!ownTag.text.trim()}
                      onPress={() => {
                        tagIncome(t.id, ownTag.text, undefined, learn, ownTag.sub);
                        setOwnTag(null);
                      }}
                    />
                  </View>
                ) : null}
              </View>
            ))}
          </View>
        ) : null}
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
            <Label>Whose income</Label>
            <PersonChips value={incomeDraft.owner ?? 'me'} onChange={(owner) => setIncomeDraft({ ...incomeDraft, owner })} />
            <Label>Tag</Label>
            <Chips options={tagOptions} value={incomeDraft.tag ?? null} onChange={(tag) => setIncomeDraft({ ...incomeDraft, tag: incomeDraft.tag === tag ? undefined : tag, newTag: '' })} />
            <View style={styles.row}>
              <Field label="Or a new tag" value={incomeDraft.newTag ?? ''} onChangeText={(newTag) => setIncomeDraft({ ...incomeDraft, newTag })} placeholder="e.g. Rent from flat" />
              <Field label="What's it for? (optional)" value={incomeDraft.note ?? ''} onChangeText={(note) => setIncomeDraft({ ...incomeDraft, note })} placeholder="e.g. Ana paying back dinner" />
            </View>
            {draftTag ? (
              <>
                <Label>Sub-tag under “{draftTag}” (optional)</Label>
                {draftSubTags.length ? (
                  <Chips
                    options={draftSubTags.map((x) => ({ id: x, label: x }))}
                    value={draftSubTags.find((x) => x === incomeDraft.subTag?.trim()) ?? null}
                    onChange={(x) => setIncomeDraft({ ...incomeDraft, subTag: incomeDraft.subTag?.trim() === x ? '' : x })}
                  />
                ) : null}
                <Field label="Sub-tag" value={incomeDraft.subTag ?? ''} onChangeText={(subTag) => setIncomeDraft({ ...incomeDraft, subTag })} placeholder="e.g. Staff" />
              </>
            ) : null}
            {draftTag && draftSub ? (
              <>
                <Label>Under “{draftTag} › {draftSub}” (optional)</Label>
                {draftSubSubTags.length ? (
                  <Chips
                    options={draftSubSubTags.map((x) => ({ id: x, label: x }))}
                    value={draftSubSubTags.find((x) => x === incomeDraft.subSubTag?.trim()) ?? null}
                    onChange={(x) => setIncomeDraft({ ...incomeDraft, subSubTag: incomeDraft.subSubTag?.trim() === x ? '' : x })}
                  />
                ) : null}
                <Field label="Name" value={incomeDraft.subSubTag ?? ''} onChangeText={(subSubTag) => setIncomeDraft({ ...incomeDraft, subSubTag })} placeholder="e.g. Ahmed" />
              </>
            ) : null}
            {incomeDraft.id && incomeEditing?.source !== 'manual' ? (
              <Checkbox label="Remember the tag for money from this sender" value={learn} onChange={setLearn} />
            ) : null}
            {incomeEditing?.source && incomeEditing.source !== 'manual' ? null : (
              <Checkbox
                label="Comes in every month (e.g. a salary paid outside the bank)"
                value={!!incomeDraft.monthly}
                onChange={(monthly) => setIncomeDraft({ ...incomeDraft, monthly })}
              />
            )}
            {incomeDraft.monthly && incomeDraft.endMonth ? (
              <ThemedText type="small" themeColor="textSecondary">
                Last month: {monthLabel(incomeDraft.endMonth)}.
              </ThemedText>
            ) : null}
            <View style={styles.row}>
              <Button label="Save" onPress={saveIncomeDraft} disabled={!incomeValid} />
              <Button label="Cancel" kind="secondary" onPress={() => setIncomeDraft(null)} />
              {incomeDraft.id && incomeDraft.monthly && incomeEditing?.monthly ? (
                <Button
                  label={incomeDraft.endMonth === month ? 'Keep it going' : `Stop after ${monthLabel(month, 'short')}`}
                  kind="secondary"
                  onPress={() => setIncomeDraft({ ...incomeDraft, endMonth: incomeDraft.endMonth === month ? undefined : month })}
                />
              ) : null}
              {incomeDraft.id ? (
                <Button
                  label={incomeEditing?.monthly ? 'Delete (every month)' : 'Delete'}
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
            onPress={() =>
              setIncomeDraft({ date: month === currentMonth() ? today() : `${month}-01`, description: '', amount: '', owner: whose === 'all' ? 'me' : whose })
            }
          />
        )}
        {incomeList.map((t) => (
          <Pressable
            key={t.id}
            onPress={() => {
              // A monthly entry is edited as a whole, from its first month.
              const saved = state.income.find((x) => x.id === t.id) ?? t;
              setIncomeDraft({ id: t.id, date: saved.date, description: t.description, amount: String(t.amount), owner: t.owner, monthly: t.monthly, endMonth: t.endMonth, tag: saved.tag, subTag: saved.subTag, subSubTag: saved.subSubTag, note: saved.note });
            }}
            style={{ flexDirection: 'row', gap: Spacing.two, alignItems: 'center', paddingVertical: 6, borderTopWidth: 1, borderColor: theme.border }}>
            <View style={{ flex: 1 }}>
              {t.note ? <ThemedText type="smallBold">{t.note}</ThemedText> : null}
              <ThemedText type="small" themeColor={t.note ? 'textSecondary' : undefined}>
                {t.description}
              </ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {t.date} · {incomeTagLabel(t) ?? 'Untagged'}
                {t.monthly ? ' · every month' : t.source === 'csv' ? ' · imported' : t.source === 'revolut' ? ' · synced' : ''}
                {personTag(t)}
              </ThemedText>
            </View>
            <ThemedText type="small" style={{ color: theme.good }}>
              +{money(t.amount, true)}
            </ThemedText>
          </Pressable>
        ))}
      </Card>


      <Card
        title="↔ Transfers between your accounts"
        subtitle={`Money moved between your own accounts isn't income or spending, so it's left out. These are the lines left out in ${monthLabel(month)}, and why.`}>
        {moved.length ? (
          <ThemedText type="small" themeColor="textSecondary">
            In {money(movedIn, true)} · out {money(movedOut, true)}
          </ThemedText>
        ) : (
          <ThemedText type="small" themeColor="textSecondary">
            {allState.rereadAll
              ? 'Lines left out before this list existed show up here after the next sync (Settings › Sync now).'
              : `Nothing left out in ${monthLabel(month)}.`}
          </ThemedText>
        )}
        {moved.map((x) => (
          <View key={x.key} style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.two, borderTopWidth: 1, borderColor: theme.border }}>
            <View style={{ flex: 1 }}>
              <ThemedText type="small">{x.description}</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                {x.dir === 'in' ? '↙ Money in' : '↗ Money out'} · {x.date}
                {personTag(x)} · {reason(x)}
              </ThemedText>
              {x.lineId ? (
                <Pressable accessibilityRole="button" onPress={() => putBackTransfer(x.lineId!, true)} style={{ marginTop: Spacing.one }}>
                  <ThemedText type="small" style={{ color: theme.accent, textDecorationLine: 'underline' }}>
                    Put back in spending
                  </ThemedText>
                </Pressable>
              ) : null}
            </View>
            <ThemedText type="smallBold" style={{ color: x.dir === 'in' ? theme.good : theme.text }}>
              {x.dir === 'in' ? '+' : '−'}
              {money(x.amount, true)}
            </ThemedText>
          </View>
        ))}
        {rules.length ? (
          <View style={{ gap: Spacing.one, marginTop: Spacing.three }}>
            <ThemedText type="smallBold">Remembered as transfers</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              Bank lines matching these are always left out. Put one back if that was a mistake: the next sync brings its lines in again.
            </ThemedText>
            {rules.map((rule) => (
              <View key={rule} style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.two, borderTopWidth: 1, borderColor: theme.border }}>
                <View style={{ flex: 1 }}>
                  <ThemedText type="small">Anything matching “{rule}”</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {linesFor(rule)} line{linesFor(rule) === 1 ? '' : 's'} left out so far
                  </ThemedText>
                </View>
                <Button label="Put back" kind="secondary" onPress={() => forgetTransferRule(rule)} />
              </View>
            ))}
          </View>
        ) : null}
      </Card>
    </Screen>
  );
}
