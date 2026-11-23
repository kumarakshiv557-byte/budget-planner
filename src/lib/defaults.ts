import { matchRule } from './budget.ts';
import type { BudgetItem, BudgetState, Category, CategoryRule, Person, Subcategory, Transaction } from './types.ts';

// Categorical colours in fixed order (validated for colour-blind separation).
// Light/dark steps are chosen separately rather than auto-flipped.
export const DEFAULT_CATEGORIES: Category[] = [
  { id: 'essentials', name: 'Essentials', color: '#2a78d6', colorDark: '#3987e5' },
  { id: 'frivolous', name: 'Frivolous', color: '#eb6834', colorDark: '#d95926' },
  { id: 'utilities', name: 'Utility bills', color: '#eda100', colorDark: '#c98500' },
  { id: 'taxes', name: 'Taxes', color: '#e87ba4', colorDark: '#d55181' },
  { id: 'work', name: 'Work', color: '#8b5fd1', colorDark: '#9b74e0' },
];

export const DEFAULT_SUBCATEGORIES: Subcategory[] = [{ id: 'eating-out', categoryId: 'frivolous', name: 'Eating out / food delivery' }];

/**
 * "Subscription" is how something is paid, not what it is: these merchants are Frivolous,
 * recurring fixed, debited automatically.
 */
export const SUBSCRIPTION_MERCHANTS = ['itunes', 'spotify', 'youtube', 'netflix', 'prime video', 'disney', 'icloud', 'apple.com', 'google one', 'chatgpt'];
const SUBSCRIPTION_RULE = { categoryId: 'frivolous', type: 'recurring-fixed' as const, payment: 'auto' as const };

/** Food delivery and restaurants, sorted into Frivolous → Eating out / food delivery. */
export const EATING_OUT_RULES: CategoryRule[] = [
  'zomato', 'swiggy', 'uber eats', 'glovo', 'deliveroo', 'bolt food', 'just eat', 'restaurant', 'cafe', 'mcdonald',
  'burger king', 'kfc', 'domino', 'pizza hut', 'starbucks', 'telepizza',
].map((match) => ({ match, categoryId: 'frivolous', subcategoryId: 'eating-out' }));

/** Starter keyword rules so imported bank rows land somewhere sensible. */
export const DEFAULT_RULES: CategoryRule[] = [
  ...SUBSCRIPTION_MERCHANTS.map((match) => ({ match, ...SUBSCRIPTION_RULE })),
  { match: 'gym', categoryId: 'essentials', type: 'recurring-fixed', payment: 'auto' },
  ...['edp', 'endesa', 'galp', 'electric', 'water', 'gas', 'internet', 'vodafone', 'meo', 'nos ', 'airtel', 'jio'].map(
    (match) => ({ match, categoryId: 'utilities', type: 'recurring-variable' as const }),
  ),
  { match: 'rent', categoryId: 'essentials', type: 'recurring-fixed', payment: 'manual' },
  ...['continente', 'pingo doce', 'lidl', 'aldi', 'mercadona', 'pharmacy', 'farmacia', 'uber', 'bolt', 'metro', 'cp '].map(
    (match) => ({ match, categoryId: 'essentials' }),
  ),
  ...['tax', 'autoridade tributaria', 'financas', 'income tax', 'gst'].map((match) => ({ match, categoryId: 'taxes' })),
  ...['bar ', 'amazon', 'zara', 'steam', 'cinema'].map((match) => ({ match, categoryId: 'frivolous' })),
  ...EATING_OUT_RULES,
];

export const DEFAULT_PEOPLE: Person[] = [
  { id: 'me', name: 'Me' },
  { id: 'wife', name: 'Wife' },
  { id: 'mom', name: 'Mom' },
];

export function initialState(): BudgetState {
  return {
    version: 1,
    currency: 'EUR',
    categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })),
    subcategories: DEFAULT_SUBCATEGORIES.map((c) => ({ ...c })),
    items: [],
    transactions: [],
    income: [],
    people: DEFAULT_PEOPLE.map((p) => ({ ...p })),
    rules: DEFAULT_RULES.map((r) => ({ ...r })),
    dataVersion: DATA_VERSION,
  };
}

/**
 * Bring saved data up to date. Saved data from before subcategories existed gets the starter
 * "Eating out / food delivery" subcategory and its merchant rules, and anything still unsorted
 * that those rules now recognise is sorted.
 */
export function migrate(saved: Partial<BudgetState>): BudgetState {
  let s: BudgetState = { ...initialState(), dataVersion: undefined, ...saved };
  if (!saved.subcategories) s = addEatingOut(s);
  if ((s.dataVersion ?? 1) < 2) s = dropSubscriptionsCategory(s);
  if ((s.dataVersion ?? 1) < 3) s = resetSorting(addWork(s));
  return { ...s, dataVersion: DATA_VERSION };
}

export const DATA_VERSION = 3;

function addWork(s: BudgetState): BudgetState {
  if (s.categories.some((c) => c.id === 'work')) return s;
  return { ...s, categories: [...s.categories, { ...DEFAULT_CATEGORIES.find((c) => c.id === 'work')! }] };
}

/**
 * Start sorting over (asked for on 2026-11-22): every transaction goes back to "to sort" with no
 * category, subcategory, type or payment tag, and learned merchant rules are dropped (the starter
 * rules stay, for future imports). Budget lines, income and subcategories are kept.
 */
export function resetSorting(s: BudgetState): BudgetState {
  return {
    ...s,
    rules: DEFAULT_RULES.map((r) => ({ ...r })),
    transactions: s.transactions.map((t) => {
      const { subcategoryId: _s, payment: _p, ...rest } = t;
      return { ...rest, categoryId: null, type: 'variable-one-time' as const };
    }),
  };
}

/**
 * Subscriptions stop being a category: anything filed there moves to Frivolous and is tagged
 * "Subscription" (paid automatically). The well-known subscription merchants become Frivolous,
 * recurring fixed, auto-paid wherever they were sorted before.
 */
function dropSubscriptionsCategory(s: BudgetState): BudgetState {
  if (!s.categories.some((c) => c.id === 'frivolous')) return s;
  const hit = (text: string) => SUBSCRIPTION_MERCHANTS.some((m) => text.toLowerCase().includes(m));
  const wasSub = (x: { categoryId: string | null }) => x.categoryId === 'subscriptions';
  const moveTx = (t: Transaction): Transaction => {
    if (hit(t.description)) return withoutSub({ ...t, ...SUBSCRIPTION_RULE });
    if (wasSub(t)) return withoutSub({ ...t, categoryId: 'frivolous', payment: 'auto' });
    return t;
  };
  const moveItem = (i: BudgetItem): BudgetItem => {
    if (hit(i.name)) return withoutSub({ ...i, ...SUBSCRIPTION_RULE });
    if (wasSub(i)) return withoutSub({ ...i, categoryId: 'frivolous', ...(i.type === 'recurring-fixed' ? { payment: 'auto' as const } : {}) });
    return i;
  };
  const rules = s.rules.map((r) =>
    hit(r.match) ? { match: r.match, ...SUBSCRIPTION_RULE } : wasSub(r) ? withoutSub({ ...r, categoryId: 'frivolous', payment: 'auto' as const }) : r,
  );
  for (const m of SUBSCRIPTION_MERCHANTS) if (!rules.some((r) => r.match === m)) rules.push({ match: m, ...SUBSCRIPTION_RULE });
  return {
    ...s,
    categories: s.categories.filter((c) => c.id !== 'subscriptions'),
    subcategories: s.subcategories.filter((x) => x.categoryId !== 'subscriptions'),
    rules,
    transactions: s.transactions.map(moveTx),
    items: s.items.map(moveItem),
  };
}

function withoutSub<T extends { subcategoryId?: string }>(x: T): T {
  const { subcategoryId: _gone, ...rest } = x;
  return rest as T;
}

function addEatingOut(s: BudgetState): BudgetState {
  const hasFrivolous = s.categories.some((c) => c.id === 'frivolous');
  if (!hasFrivolous) return { ...s, subcategories: [] };
  const eat = new Map(EATING_OUT_RULES.map((r) => [r.match, r]));
  const rules = s.rules.map((r) => (eat.has(r.match) && r.categoryId === 'frivolous' && !r.subcategoryId ? { ...r, subcategoryId: 'eating-out' } : r));
  for (const r of EATING_OUT_RULES) if (!rules.some((x) => x.match === r.match)) rules.push({ ...r });
  return { ...s, subcategories: DEFAULT_SUBCATEGORIES.filter((c) => c.id === 'eating-out').map((c) => ({ ...c })), rules, transactions: sortUnsorted(s.transactions, rules) };
}

/** Give uncategorised transactions the category (and subcategory) of the longest matching rule. */
export function sortUnsorted<T extends { description: string; categoryId: string | null; subcategoryId?: string }>(list: T[], rules: CategoryRule[]): T[] {
  return list.map((t) => {
    if (t.categoryId) return t;
    const r = matchRule(t.description, rules);
    return r ? { ...t, categoryId: r.categoryId, ...(r.subcategoryId ? { subcategoryId: r.subcategoryId } : {}) } : t;
  });
}
