import { isRecurring, type BudgetItem, type BudgetState, type ItemType, type Month, type Transaction } from './types.ts';

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

export function transactionsIn(transactions: Transaction[], month: Month) {
  return transactions.filter((t) => monthOf(t.date) === month);
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
  const d = ` ${description.toLowerCase()} `;
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

/** Type for an imported line: what was learned for that merchant, else one-time variable. */
export function typeFor(description: string, rules: BudgetState['rules']): ItemType {
  return matchRule(description, rules)?.type ?? 'variable-one-time';
}

export function formatMoney(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat('en-IE', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${currency} ${Math.round(amount)}`;
  }
}

export function newId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
