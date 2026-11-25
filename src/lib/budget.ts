import { DEFAULT_INCOME_TAGS, isRecurring, ownerOf, type BudgetItem, type BudgetState, type Income, type IncomeRule, type ItemType, type Month, type Payment, type Transaction } from './types.ts';

export function monthOf(date: string): Month {
  return date.slice(0, 7);
}

export function currentMonth(now = new Date()): Month {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export function addMonths(month: Month, delta: number): Month {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function monthLabel(month: Month, style: 'short' | 'long' = 'long') {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1, 1));
  return d.toLocaleDateString('en-GB', {
    month: style === 'short' ? 'short' : 'long',
    year: style === 'short' ? undefined : 'numeric',
    timeZone: 'UTC',
  });
}

/** Does this planned item count towards the given month? */
export function itemAppliesTo(item: BudgetItem, month: Month): boolean {
  if (!isRecurring(item.type)) return item.startMonth === month;
  if (month < item.startMonth) return false;
  if (item.endMonth && month > item.endMonth) return false;
  return true;
}

export type CategoryRow = { categoryId: string | null; forecast: number; actual: number };

export type MonthSummary = {
  month: Month;
  forecast: number;
  actual: number;
  byCategory: CategoryRow[];
  byType: { type: ItemType; forecast: number; actual: number }[];
};

export function transactionsIn<T extends { date: string }>(transactions: T[], month: Month): T[] {
  return transactions.filter((t) => monthOf(t.date) === month);
}

/**
 * Income in a month: what came in that month, plus income added by hand as monthly (shown on the same
 * day of each month from its start until its end month). A monthly entry keeps its own id in every month.
 */
export function incomeIn(income: Income[], month: Month): Income[] {
  return income.flatMap((i) => {
    if (!i.monthly) return monthOf(i.date) === month ? [i] : [];
    if (month < monthOf(i.date) || (i.endMonth && month > i.endMonth)) return [];
    const [y, m] = month.split('-').map(Number);
    const day = Math.min(Number(i.date.slice(8, 10)) || 1, new Date(Date.UTC(y, m, 0)).getUTCDate());
    return [{ ...i, date: `${month}-${String(day).padStart(2, '0')}` }];
  });
}

/** The income tags to offer. */
export function incomeTagsOf(state: Pick<BudgetState, 'incomeTags'>): string[] {
  return state.incomeTags?.length ? state.incomeTags : DEFAULT_INCOME_TAGS;
}

/** The remembered income rule for a sender (longest match wins). */
export function matchIncomeRule(description: string, rules: IncomeRule[] = []) {
  const d = ` ${description.toLowerCase().replace(/\s+/g, ' ')} `;
  let best: IncomeRule | null = null;
  for (const r of rules) if (r.match && d.includes(r.match) && (!best || r.match.length > best.match.length)) best = r;
  return best;
}

/** New income lines take the tag (and note) remembered for their sender, unless they already have one. */
export function tagNewIncome<T extends Income>(state: Pick<BudgetState, 'incomeRules'>, list: T[]): T[] {
  return list.map((i) => {
    if (i.tag) return i;
    const r = matchIncomeRule(i.description, state.incomeRules);
    return r ? { ...i, tag: r.tag, ...(r.subTag ? { subTag: r.subTag } : {}), ...(r.note && !i.note ? { note: r.note } : {}) } : i;
  });
}

/**
 * Tag an income line. With `learn`, remember the tag (and note) for its sender, and give it to the sender's other
 * lines that are untagged or had the same tag as this one before; a new tag name joins the tag list.
 */
export function tagIncomeIn(s: BudgetState, id: string, tag: string | undefined, note: string | undefined, learn: boolean, subTag?: string): BudgetState {
  const line = s.income.find((x) => x.id === id);
  if (!line) return s;
  const clean = tag?.trim() || undefined;
  const memo = note?.trim() || undefined;
  const under = (clean && subTag?.trim()) || undefined;
  const match = learn ? ruleFrom(line.description) : '';
  const set = (x: Income): Income => {
    const { tag: _t, note: _n, subTag: _s, ...rest } = x;
    return {
      ...rest,
      ...(clean ? { tag: clean } : {}),
      ...(under ? { subTag: under } : {}),
      ...(memo ? { note: memo } : x.id === id ? {} : x.note ? { note: x.note } : {}),
    };
  };
  const sameSender = (x: Income) => !!match && ` ${x.description.toLowerCase().replace(/\s+/g, ' ')} `.includes(match);
  const income = s.income.map((x) => (x.id === id || (sameSender(x) && (!x.tag || x.tag === line.tag)) ? set(x) : x));
  let incomeRules = s.incomeRules ?? [];
  if (match) {
    incomeRules = incomeRules.filter((r) => r.match !== match);
    if (clean) incomeRules = [...incomeRules, { match, tag: clean, ...(under ? { subTag: under } : {}), ...(memo ? { note: memo } : {}) }];
  }
  const tags = incomeTagsOf(s);
  return {
    ...s,
    income,
    incomeRules,
    ...(clean && !tags.some((t) => t.toLowerCase() === clean.toLowerCase()) ? { incomeTags: [...tags, clean] } : {}),
  };
}

/** Every month from `from` to `to`, inclusive (in order, whichever is given first). */
export function monthsBetween(from: Month, to: Month): Month[] {
  const [a, b] = from <= to ? [from, to] : [to, from];
  const out: Month[] = [];
  for (let m = a; m <= b && out.length < 240; m = addMonths(m, 1)) out.push(m);
  return out;
}

/** "Nov 2026", or "Jun – Nov 2026" / "Dec 2025 – Nov 2026" for a range. */
export function rangeLabel(months: Month[]) {
  if (months.length <= 1) return monthLabel(months[0] ?? '', 'long');
  const first = months[0];
  const last = months[months.length - 1];
  const short = (m: Month) => monthLabel(m, 'short');
  return first.slice(0, 4) === last.slice(0, 4) ? `${short(first)} – ${short(last)} ${last.slice(0, 4)}` : `${short(first)} ${first.slice(0, 4)} – ${short(last)} ${last.slice(0, 4)}`;
}

/** Income across several months (see incomeIn). */
export function incomeInMonths(income: Income[], months: Month[]): Income[] {
  return months.flatMap((m) => incomeIn(income, m));
}

/** Transactions across several months. */
export function transactionsInMonths<T extends { date: string }>(transactions: T[], months: Month[]): T[] {
  const set = new Set(months);
  return transactions.filter((t) => set.has(monthOf(t.date)));
}

/** The household's data as one person sees it ("all" = everyone). Plans with no owner belong to "me". */
export function forPerson(state: BudgetState, whose: string): BudgetState {
  if (whose === 'all') return state;
  const mine = (x: { owner?: string }) => ownerOf(x) === whose;
  return { ...state, transactions: state.transactions.filter(mine), income: state.income.filter(mine), items: state.items.filter(mine) };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function summarizeMonth(state: BudgetState, month: Month): MonthSummary {
  const byCat = new Map<string | null, CategoryRow>();
  for (const c of state.categories) byCat.set(c.id, { categoryId: c.id, forecast: 0, actual: 0 });
  const row = (id: string | null) => {
    let r = byCat.get(id);
    if (!r) byCat.set(id, (r = { categoryId: id, forecast: 0, actual: 0 }));
    return r;
  };

  const types: ItemType[] = ['recurring-fixed', 'recurring-variable', 'variable-one-time', 'fixed-one-time'];
  const byType = new Map(types.map((t) => [t, { type: t, forecast: 0, actual: 0 }]));

  for (const item of state.items) {
    if (!itemAppliesTo(item, month)) continue;
    row(item.categoryId).forecast += item.amount;
    byType.get(item.type)!.forecast += item.amount;
  }
  for (const t of transactionsIn(state.transactions, month)) {
    row(t.categoryId).actual += t.amount;
    byType.get(t.type)!.actual += t.amount;
  }

  const byCategory = [...byCat.values()]
    .map((r) => ({ ...r, forecast: round2(r.forecast), actual: round2(r.actual) }))
    // keep "uncategorised" only when it has money in it
    .filter((r) => r.categoryId !== null || r.actual !== 0 || r.forecast !== 0);

  return {
    month,
    forecast: round2(byCategory.reduce((s, r) => s + r.forecast, 0)),
    actual: round2(byCategory.reduce((s, r) => s + r.actual, 0)),
    byCategory,
    byType: [...byType.values()].map((r) => ({ ...r, forecast: round2(r.forecast), actual: round2(r.actual) })),
  };
}

/** Summaries for the `count` months ending at `end`, oldest first. */
export function trend(state: BudgetState, end: Month, count = 6): MonthSummary[] {
  return Array.from({ length: count }, (_, i) => summarizeMonth(state, addMonths(end, i - (count - 1))));
}

/**
 * Pick a category for a bank description using the user's rules (longest match wins,
 * so "uber eats" beats "uber").
 */
/** The longest rule whose text appears in the description. */
export function matchRule(description: string, rules: BudgetState['rules']) {
  const d = ` ${description.toLowerCase().replace(/\s+/g, ' ')} `;
  let best: BudgetState['rules'][number] | null = null;
  for (const r of rules) {
    const m = r.match.toLowerCase();
    if (m && d.includes(m) && (!best || m.length > best.match.length)) best = r;
  }
  return best;
}

export function categorize(description: string, rules: BudgetState['rules']): string | null {
  return matchRule(description, rules)?.categoryId ?? null;
}

/** Payment tag for an imported line, if its merchant rule has one. */
export function paymentFor(description: string, rules: BudgetState['rules']) {
  return matchRule(description, rules)?.payment;
}

/** Type for an imported line: what was learned for that merchant, else one-time variable. */
export function typeFor(description: string, rules: BudgetState['rules']): ItemType {
  return matchRule(description, rules)?.type ?? 'variable-one-time';
}

export function formatMoney(amount: number, currency: string, cents = false) {
  try {
    return new Intl.NumberFormat('en-IE', {
      style: 'currency',
      currency,
      minimumFractionDigits: cents ? 2 : 0,
      maximumFractionDigits: cents ? 2 : 0,
    }).format(amount);
  } catch {
    return `${currency} ${cents ? amount.toFixed(2) : Math.round(amount)}`;
  }
}

export function newId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export type BreakdownDim = 'category' | 'type';
export type BreakdownSide = 'actual' | 'forecast';
/** One expense (actual) or budget line (forecast) inside a pie slice. */
export type BreakdownLine = {
  id: string;
  label: string;
  date?: string;
  amount: number;
  categoryId: string | null;
  subcategoryId?: string;
  type: ItemType;
  payment?: 'auto' | 'manual';
  dueDay?: number;
};

/**
 * Lines for one month grouped by category or type, for the pie charts.
 * Keys are the category id ('none' for uncategorised) or the item type. Groups are sorted by total, largest first.
 */
/** Subscriptions (debited automatically) live in their own list, outside the pie charts and the Sankey. */
export const isSubscription = (x: { payment?: Payment }) => x.payment === 'auto';

/** Total of this month's subscriptions: what was charged (actual) or planned in Budget (forecast). */
export function subscriptionsTotal(state: BudgetState, month: Month, side: BreakdownSide) {
  const list = side === 'actual' ? transactionsIn(state.transactions, month) : state.items.filter((i) => itemAppliesTo(i, month));
  return round2(list.filter(isSubscription).reduce((s, x) => s + x.amount, 0));
}

export function breakdown(state: BudgetState, month: Month, dim: BreakdownDim, side: BreakdownSide) {
  const lines: BreakdownLine[] =
    side === 'actual'
      ? transactionsIn(state.transactions, month).filter((t) => !isSubscription(t)).map((t) => ({
          id: t.id,
          label: t.note ? `${t.note} · ${t.description}` : t.description,
          date: t.date,
          amount: t.amount,
          categoryId: t.categoryId,
          subcategoryId: t.subcategoryId,
          payment: t.payment,
          type: t.type,
        }))
      : state.items
          .filter((i) => itemAppliesTo(i, month) && !isSubscription(i))
          .map((i) => ({
            id: i.id,
            label: i.name,
            amount: i.amount,
            categoryId: i.categoryId,
            subcategoryId: i.subcategoryId,
            type: i.type,
            payment: i.payment,
            dueDay: i.dueDay,
          }));
  const groups = new Map<string, { key: string; total: number; lines: BreakdownLine[] }>();
  for (const l of lines) {
    const key = dim === 'category' ? (l.categoryId ?? 'none') : l.type;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { key, total: 0, lines: [] }));
    g.total += l.amount;
    g.lines.push(l);
  }
  return [...groups.values()]
    .map((g) => ({
      ...g,
      total: round2(g.total),
      lines: g.lines.sort((a, b) => b.amount - a.amount || (b.date ?? '').localeCompare(a.date ?? '')),
    }))
    .sort((a, b) => b.total - a.total);
}

/** What an income line is grouped under in the money flow: its tag, else who sent it. */
export function incomeSourceOf(i: Income) {
  return i.tag?.trim() || i.description.trim();
}

/** "MBWay › Ahmed", "MBWay", or undefined for an untagged line. */
export function incomeTagLabel(i: Pick<Income, 'tag' | 'subTag'>) {
  return i.tag ? (i.subTag ? `${i.tag} › ${i.subTag}` : i.tag) : undefined;
}

/** Sub-tags already used under a tag, most used first. */
export function incomeSubTagsOf(s: Pick<BudgetState, 'income' | 'incomeRules'>, tag: string | undefined): string[] {
  if (!tag) return [];
  const t = tag.trim().toLowerCase();
  const count = new Map<string, number>();
  for (const x of [...s.income, ...(s.incomeRules ?? [])])
    if (x.subTag && x.tag?.trim().toLowerCase() === t) count.set(x.subTag, (count.get(x.subTag) ?? 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k]) => k);
}

/** Key of the income node that groups the smaller sources. */
export const OTHER_INCOME = '__other';

export type FlowNodeKind = 'income' | 'gap' | 'total' | 'category' | 'subscriptions' | 'leftover' | 'type';
/** `sub` is set on the pieces of an income tag split into its sub-tags ('' for lines with no sub-tag). */
export type FlowNode = { id: string; kind: FlowNodeKind; key: string; sub?: string; column: 0 | 1 | 2 | 3; value: number };
export type FlowLink = { source: string; target: string; value: number };

/**
 * Money flow for one month, for the Sankey chart:
 * income sources → the month → categories (+ left over) → types.
 * If spending is more than income, a "gap" source covers the difference (savings or untracked money).
 * Refunds can make a category negative; those are left out of the flow.
 */
export function moneyFlow(state: BudgetState, period: Month | Month[], maxSources = 5, opts: { expand?: string } = {}) {
  const months = Array.isArray(period) ? period : [period];
  const month = months[months.length - 1];
  const nodes: FlowNode[] = [];
  const links: FlowLink[] = [];

  const bySource = new Map<string, { label: string; value: number }>();
  for (const i of incomeInMonths(state.income ?? [], months)) {
    const name = incomeSourceOf(i);
    const k = name.toLowerCase();
    const g = bySource.get(k) ?? { label: name, value: 0 };
    g.value += i.amount;
    bySource.set(k, g);
  }
  let sources = [...bySource.values()].filter((s) => s.value > 0).sort((a, b) => b.value - a.value);
  if (sources.length > maxSources) {
    const rest = sources.slice(maxSources - 1).reduce((s, x) => s + x.value, 0);
    sources = [...sources.slice(0, maxSources - 1), { label: OTHER_INCOME, value: rest }];
  }

  const cat = new Map<string, number>();
  const catType = new Map<string, Map<ItemType, number>>();
  // Subscriptions are one block of their own, not split into categories and types.
  const subs = Math.max(0, round2(months.reduce((s, m) => s + subscriptionsTotal(state, m, 'actual'), 0)));
  for (const t of transactionsInMonths(state.transactions, months)) {
    if (isSubscription(t)) continue;
    const c = t.categoryId ?? 'none';
    cat.set(c, (cat.get(c) ?? 0) + t.amount);
    const m = catType.get(c) ?? new Map<ItemType, number>();
    m.set(t.type, (m.get(t.type) ?? 0) + t.amount);
    catType.set(c, m);
  }
  const cats = [...cat.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);

  const income = round2(sources.reduce((s, x) => s + x.value, 0));
  const spent = round2(cats.reduce((s, [, v]) => s + v, 0) + subs);
  const total = Math.max(income, spent);
  if (total <= 0) return { nodes, links, income, spent };

  // An expanded income tag shows as one block per sub-tag, biggest first.
  const pieces = (label: string) => {
    if (!opts.expand || label === OTHER_INCOME || label.toLowerCase() !== opts.expand.toLowerCase()) return null;
    const m = new Map<string, number>();
    for (const i of incomeInMonths(state.income ?? [], months))
      if (incomeSourceOf(i).toLowerCase() === label.toLowerCase()) m.set(i.subTag ?? '', (m.get(i.subTag ?? '') ?? 0) + i.amount);
    const list = [...m.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
    return list.some(([k]) => k) ? list : null;
  };
  for (const s of sources) {
    const split = pieces(s.label);
    if (split) {
      for (const [sub, v] of split) {
        const id = `in:${s.label}:${sub}`;
        nodes.push({ id, kind: 'income', key: s.label, sub, column: 0, value: round2(v) });
        links.push({ source: id, target: 'total', value: round2(v) });
      }
      continue;
    }
    nodes.push({ id: `in:${s.label}`, kind: 'income', key: s.label, column: 0, value: round2(s.value) });
    links.push({ source: `in:${s.label}`, target: 'total', value: round2(s.value) });
  }
  if (spent > income) {
    nodes.push({ id: 'gap', kind: 'gap', key: 'gap', column: 0, value: round2(spent - income) });
    links.push({ source: 'gap', target: 'total', value: round2(spent - income) });
  }
  nodes.push({ id: 'total', kind: 'total', key: month, column: 1, value: round2(total) });

  const typeTotals = new Map<ItemType, number>();
  for (const [c, v] of cats) {
    nodes.push({ id: `cat:${c}`, kind: 'category', key: c, column: 2, value: round2(v) });
    links.push({ source: 'total', target: `cat:${c}`, value: round2(v) });
    // Within a category, refunds of one type are netted against the others so the split still adds up.
    const parts = [...(catType.get(c) ?? new Map()).entries()].filter(([, x]) => x > 0);
    const sum = parts.reduce((s, [, x]) => s + x, 0);
    for (const [type, x] of parts) {
      const share = round2((x / sum) * v);
      links.push({ source: `cat:${c}`, target: `type:${type}`, value: share });
      typeTotals.set(type, (typeTotals.get(type) ?? 0) + share);
    }
  }
  if (subs > 0) {
    nodes.push({ id: 'subscriptions', kind: 'subscriptions', key: 'subscriptions', column: 2, value: subs });
    links.push({ source: 'total', target: 'subscriptions', value: subs });
  }
  if (income > spent) {
    nodes.push({ id: 'leftover', kind: 'leftover', key: 'leftover', column: 2, value: round2(income - spent) });
    links.push({ source: 'total', target: 'leftover', value: round2(income - spent) });
  }
  for (const [type, v] of [...typeTotals.entries()].sort((a, b) => b[1] - a[1])) {
    nodes.push({ id: `type:${type}`, kind: 'type', key: type, column: 3, value: round2(v) });
  }
  return { nodes, links, income, spent };
}

/**
 * The reusable part of a bank description, used when the app learns a rule.
 * Payment-processor prefixes are dropped ("Raz*zomato Online Order" and "Pyu*zomato Limited" both
 * give "zomato"); then the first word is kept if it is distinctive (5+ letters), otherwise the first two.
 */
export function ruleFrom(description: string) {
  const lower = description.toLowerCase();
  const afterPrefix = lower.includes('*') ? lower.slice(lower.lastIndexOf('*') + 1) : lower;
  const words = afterPrefix
    .replace(/[0-9#]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  if (!words.length) return '';
  // A bank transfer ("TRF.IMED. DE AHMED MUJTABA KHAN-E1943…") is remembered by the person's name, not by
  // "trf.imed.", which every instant transfer shares.
  let i = 0;
  while (i < words.length && TRANSFER_WORDS.has(words[i])) i++;
  if (i > 0 && i < words.length) return words.slice(i, i + 2).join(' ').replace(/-[a-z]?$/, '');
  return words[0].length >= 5 ? words[0] : words.slice(0, 2).join(' ');
}

/** True for words banks put before the other person's name on a transfer. */
export const isTransferWord = (w: string) => TRANSFER_WORDS.has(w);

/** Words banks put before the other person's name on a transfer (Portuguese and English). */
const TRANSFER_WORDS = new Set(['trf.imed.', 'trf.imed', 'anul.trf.imed.', 'anul.trf.imed', 'trf.', 'trf', 'transf.', 'transf', 'transferencia', 'transferência', 'imediata', 'sepa', 'de', 'do', 'da', 'p/', 'from', 'to', 'transfer']);

/**
 * Put a transaction in a category (and optionally a subcategory). With `learn`, remember the merchant
 * as a rule and sort every other still-unsorted transaction from the same merchant the same way.
 */
/** What you pick for a payment in "to sort". */
export type SortPick = { categoryId: string; subcategoryId?: string; type?: ItemType; payment?: Payment; note?: string; /** One-off remark for this payment only; never remembered. */ remark?: string };

/**
 * Sort one transaction. With `learn`, the merchant's rule remembers the pick (category, and type and
 * payment tag when given) and every other unsorted payment from the same place is sorted the same way.
 */
export function sortIn(s: BudgetState, id: string, pick: SortPick, learn: boolean, now = new Date().toISOString()): BudgetState {
  const t = s.transactions.find((x) => x.id === id);
  if (!t) return s;
  const { categoryId, subcategoryId, type, payment } = pick;
  const note = pick.note?.trim() || undefined;
  const remark = pick.remark?.trim() || undefined;
  const match = learn ? ruleFrom(t.description) : '';
  let rules = s.rules;
  if (match) {
    const rule = {
      match,
      categoryId,
      ...(subcategoryId ? { subcategoryId } : {}),
      ...(type ? { type } : {}),
      ...(payment ? { payment } : {}),
      ...(note ? { note } : {}),
    };
    const i = rules.findIndex((r) => r.match === match);
    const keep = (r: (typeof rules)[number]) => ({
      ...(!type && r.type ? { type: r.type } : {}),
      ...(!type && r.payment ? { payment: r.payment } : {}),
      ...(!note && r.note ? { note: r.note } : {}),
    });
    rules = i >= 0 ? rules.map((r, j) => (j === i ? { ...rule, ...keep(r) } : r)) : [...rules, rule];
  }
  const set = (x: Transaction): Transaction => {
    const { subcategoryId: _old, ...rest } = x;
    const out: Transaction = { ...rest, categoryId, ...(subcategoryId ? { subcategoryId } : {}), sortedAt: now };
    if (type) {
      out.type = type;
      if (isRecurring(type) && payment) out.payment = payment;
      else delete out.payment;
    }
    if (note) out.note = note;
    if (remark && x.id === id) out.remark = remark;
    return out;
  };
  return {
    ...s,
    rules,
    transactions: s.transactions.map((x) =>
      x.id === id || (match && !x.categoryId && ` ${x.description.toLowerCase()} `.includes(match)) ? set(x) : x,
    ),
  };
}

/** Category-only sorting (kept for callers that only pick a category). */
export function recategorizeIn(s: BudgetState, id: string, categoryId: string, subcategoryId: string | undefined, learn: boolean): BudgetState {
  return sortIn(s, id, { categoryId, subcategoryId }, learn);
}

export type Bill = { item: BudgetItem; due: string; daysLeft: number; paid: boolean };

/**
 * "Pay myself" bills for a month, soonest first, with their due date (the due day, capped to the
 * month's length) and whether they were marked paid. Items without a due day are due on the 1st.
 */
export function billsFor(state: BudgetState, month: Month, today = new Date()): Bill[] {
  const [y, m] = month.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const todayUtc = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return state.items
    .filter((i) => i.payment === 'manual' && itemAppliesTo(i, month))
    .map((item) => {
      const day = Math.min(Math.max(1, item.dueDay ?? 1), daysInMonth);
      const due = `${month}-${String(day).padStart(2, '0')}`;
      const daysLeft = Math.round((Date.UTC(y, m - 1, day) - todayUtc) / 86400_000);
      return { item, due, daysLeft, paid: !!item.paidMonths?.includes(month) };
    })
    .sort((a, b) => Number(a.paid) - Number(b.paid) || a.due.localeCompare(b.due));
}

/**
 * A calendar file with one monthly all-day event per "Pay myself" bill, each with an alert at
 * 9:00 on the due day. Days after the 28th repeat on the month's last day so short months aren't skipped.
 */
export function billsCalendar(items: BudgetItem[], currency: string, today = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${today.getUTCFullYear()}${pad(today.getUTCMonth() + 1)}${pad(today.getUTCDate())}T000000Z`;
  const esc = (t: string) => t.replace(/[\;,]/g, (c) => `\\${c}`).replace(/\n/g, '\\n');
  const events = items
    .filter((i) => i.payment === 'manual' && isRecurring(i.type))
    .map((i) => {
      const day = Math.min(Math.max(1, i.dueDay ?? 1), 31);
      const thisMonth = `${today.getFullYear()}-${pad(today.getMonth() + 1)}`;
      const start = i.startMonth > thisMonth ? i.startMonth : thisMonth;
      const [y, m] = start.split('-').map(Number);
      const first = Math.min(day, new Date(Date.UTC(y, m, 0)).getUTCDate());
      const rule = `FREQ=MONTHLY;BYMONTHDAY=${day > 28 ? -1 : day}${
        i.endMonth ? `;UNTIL=${i.endMonth.replace('-', '')}${pad(new Date(Date.UTC(Number(i.endMonth.slice(0, 4)), Number(i.endMonth.slice(5)), 0)).getUTCDate())}` : ''
      }`;
      return [
        'BEGIN:VEVENT',
        `UID:bill-${i.id}@budget-planner`,
        `DTSTAMP:${stamp}`,
        `DTSTART;VALUE=DATE:${y}${pad(m)}${pad(first)}`,
        `RRULE:${rule}`,
        `SUMMARY:${esc(`Pay ${i.name} (${i.type === 'recurring-variable' ? 'about ' : ''}${formatMoney(i.amount, currency, true)})`)}`,
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        `DESCRIPTION:${esc(`${i.name} is due today`)}`,
        // 9:00 on the due day itself (the app's push reminder comes the day before).
        'TRIGGER:PT9H',
        'END:VALARM',
        'END:VEVENT',
      ].join('\r\n');
    });
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Budget Planner//Bills//EN', 'CALSCALE:GREGORIAN', ...events, 'END:VCALENDAR', ''].join('\r\n');
}

/** "Subscription", "Pay myself · due on the 5th", or nothing. */
export function paymentNote(i: { payment?: 'auto' | 'manual'; dueDay?: number }) {
  if (i.payment === 'auto') return 'Subscription';
  if (i.payment === 'manual') return i.dueDay ? `Pay myself · due on day ${i.dueDay}` : 'Pay myself';
  return '';
}

/** "Pay myself" bills in the shape the reminder server needs. Bills without a due day count as due on the 1st, like the Bills card. */
export function pushBills(items: BudgetItem[], currency: string) {
  return items
    .filter((i) => i.payment === 'manual' && isRecurring(i.type))
    .map((i) => ({
      id: i.id,
      name: i.name,
      amount: i.amount,
      currency,
      dueDay: i.dueDay ?? 1,
      variable: i.type === 'recurring-variable',
      startMonth: i.startMonth,
      ...(i.endMonth ? { endMonth: i.endMonth } : {}),
      paidMonths: (i.paidMonths ?? []).slice(-6),
    }));
}

const sortKey = (t: Transaction) => [t.categoryId ?? '', t.subcategoryId ?? '', t.type, t.payment ?? ''].join('|');

/**
 * Other payments from the same place that were sorted exactly like `t` (same category, subcategory,
 * type and payment tag): the ones a wrong "remember" pick will have sorted the same way.
 */
export function sortedAlike(s: BudgetState, t: Transaction): Transaction[] {
  const match = ruleFrom(t.description);
  if (!match || !t.categoryId) return [];
  return s.transactions.filter(
    (x) => x.id !== t.id && x.categoryId && sortKey(x) === sortKey(t) && ` ${x.description.toLowerCase()} `.includes(match),
  );
}

/**
 * Correct a sorted payment and, with `alsoOthers`, every payment from the same place that was sorted
 * the same way, and the remembered choice for that place, so future payments land right too.
 */
export function resortIn(s: BudgetState, given: Transaction, alsoOthers: boolean, now = new Date().toISOString()): BudgetState {
  const { sortedAt: _was, ...plain } = given;
  const fixed: Transaction = given.categoryId ? { ...plain, sortedAt: now } : plain;
  const before = s.transactions.find((x) => x.id === fixed.id);
  if (!before || !alsoOthers) return { ...s, transactions: s.transactions.map((x) => (x.id === fixed.id ? fixed : x)) };
  const alike = new Set(sortedAlike(s, before).map((x) => x.id));
  const match = ruleFrom(fixed.description);
  const apply = (x: Transaction): Transaction => {
    const { subcategoryId: _s, payment: _p, sortedAt: _t, ...rest } = x;
    return {
      ...rest,
      ...(fixed.sortedAt ? { sortedAt: fixed.sortedAt } : {}),
      categoryId: fixed.categoryId,
      ...(fixed.subcategoryId ? { subcategoryId: fixed.subcategoryId } : {}),
      type: fixed.type,
      ...(fixed.payment ? { payment: fixed.payment } : {}),
      ...(fixed.note && (!x.note || x.note === before.note) ? { note: fixed.note } : {}),
    };
  };
  let rules = s.rules;
  if (match) {
    if (!fixed.categoryId) rules = rules.filter((r) => r.match !== match);
    else {
      const rule = {
        match,
        categoryId: fixed.categoryId,
        ...(fixed.subcategoryId ? { subcategoryId: fixed.subcategoryId } : {}),
        type: fixed.type,
        ...(fixed.payment ? { payment: fixed.payment } : {}),
        ...(fixed.note ? { note: fixed.note } : {}),
      };
      rules = rules.some((r) => r.match === match) ? rules.map((r) => (r.match === match ? rule : r)) : [...rules, rule];
    }
  }
  return {
    ...s,
    rules,
    transactions: s.transactions.map((x) => (x.id === fixed.id ? fixed : alike.has(x.id) ? apply(x) : x)),
  };
}

/**
 * Sorted lines, most recently sorted or fixed first (lines sorted before this was tracked fall back to
 * their date), so a wrong pick can be found and fixed quickly.
 */
export function recentlySorted(transactions: Transaction[]): Transaction[] {
  const key = (t: Transaction) => t.sortedAt ?? t.date;
  return transactions.filter((t) => t.categoryId).sort((a, b) => key(b).localeCompare(key(a)));
}

/** Send a payment (and, with `alsoOthers`, those sorted alike from the same place) back to "to sort", forgetting the remembered pick. */
export function unsortIn(s: BudgetState, id: string, alsoOthers: boolean): BudgetState {
  const t = s.transactions.find((x) => x.id === id);
  if (!t) return s;
  const { subcategoryId: _s, payment: _p, ...rest } = t;
  return resortIn(s, { ...rest, categoryId: null, type: 'variable-one-time' }, alsoOthers);
}

/**
 * What to remember about a payment marked as a transfer between your own accounts: the person it went to,
 * where the bank names one ("TRF.IMED.  P/ Akshiv Kumar-E41057871" gives "p/ akshiv kumar"), else the
 * description without its numbers.
 */
export function transferRuleFrom(description: string) {
  const d = description.toLowerCase().replace(/\s+/g, ' ').trim();
  const to = /(?:^| )p\/ ?([^\d\-–,;]+)/.exec(d)?.[1]?.trim();
  if (to) return `p/ ${to}`;
  return d.replace(/[0-9#]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** True when a bank description matches a payment you marked as a transfer. */
export function isTransferLine(description: string, rules: string[] = []) {
  const d = ` ${description.toLowerCase().replace(/\s+/g, ' ')} `;
  return rules.some((r) => r !== '' && d.includes(r));
}

/**
 * Take a payment out of spending because it only moved money between your own accounts. With `learn`, remember
 * it, so other unsorted payments like it go too and future ones are never imported.
 */
export function markTransferIn(s: BudgetState, id: string, learn: boolean): BudgetState {
  const t = s.transactions.find((x) => x.id === id);
  if (!t) return s;
  const rule = learn ? transferRuleFrom(t.description) : '';
  const rules = s.transferRules ?? [];
  const gone = s.transactions.filter((x) => x.id === id || (rule && !x.categoryId && isTransferLine(x.description, [rule])));
  const ids = new Set(gone.map((x) => x.id));
  const ext = gone.map((x) => x.externalId).filter((x): x is string => !!x);
  const at = new Date().toISOString();
  return {
    ...s,
    transactions: s.transactions.filter((x) => !ids.has(x.id)),
    transferred: [...(s.transferred ?? []), ...gone.map((line) => ({ line, ...(rule ? { rule } : {}), at }))].slice(-300),
    transferIds: [...new Set([...(s.transferIds ?? []), ...ext])].slice(-2000),
    ...(rule ? { transferRules: rules.includes(rule) ? rules : [...rules, rule] } : {}),
  };
}

/** Undo markTransferIn: put the payments back and forget the rule it learned. */
export function unmarkTransferIn(s: BudgetState, removed: Transaction[], rule?: string): BudgetState {
  const ext = new Set(removed.map((x) => x.externalId).filter(Boolean));
  const have = new Set(s.transactions.map((x) => x.id));
  return {
    ...s,
    transactions: [...s.transactions, ...removed.filter((x) => !have.has(x.id))],
    transferIds: (s.transferIds ?? []).filter((x) => !ext.has(x)),
    transferred: (s.transferred ?? []).filter((x) => !have.has(x.line.id) && !removed.some((r) => r.id === x.line.id)),
    ...(rule ? { transferRules: (s.transferRules ?? []).filter((r) => r !== rule) } : {}),
  };
}

/** Put back one line taken out as a transfer; with `forgetRule`, future payments like it are imported again too. */
export function putBackTransferIn(s: BudgetState, lineId: string, forgetRule: boolean): BudgetState {
  const entry = (s.transferred ?? []).find((x) => x.line.id === lineId);
  if (!entry) return s;
  return unmarkTransferIn(s, [entry.line], forgetRule ? entry.rule : undefined);
}

/**
 * Forget a remembered transfer rule whose lines weren't kept (marked before "Recently sorted" kept them). Bank lines
 * left out that aren't kept here are let back in, and the next sync re-reads ~90 days so they come back.
 */
export function forgetTransferRuleIn(s: BudgetState, rule: string): BudgetState {
  const kept = new Set((s.transferred ?? []).map((x) => x.line.externalId).filter(Boolean));
  return {
    ...s,
    transferRules: (s.transferRules ?? []).filter((r) => r !== rule),
    transferIds: (s.transferIds ?? []).filter((x) => kept.has(x)),
    rereadAll: true,
  };
}
