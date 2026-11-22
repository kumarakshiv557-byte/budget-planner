import { matchRule } from './budget.ts';
import type { BudgetState, Category, CategoryRule, Subcategory } from './types.ts';

// Categorical colours in fixed order (validated for colour-blind separation).
// Light/dark steps are chosen separately rather than auto-flipped.
export const DEFAULT_CATEGORIES: Category[] = [
  { id: 'essentials', name: 'Essentials', color: '#2a78d6', colorDark: '#3987e5' },
  { id: 'frivolous', name: 'Frivolous', color: '#eb6834', colorDark: '#d95926' },
  { id: 'subscriptions', name: 'Subscriptions', color: '#1baf7a', colorDark: '#199e70' },
  { id: 'utilities', name: 'Utility bills', color: '#eda100', colorDark: '#c98500' },
  { id: 'taxes', name: 'Taxes', color: '#e87ba4', colorDark: '#d55181' },
];

export const DEFAULT_SUBCATEGORIES: Subcategory[] = [{ id: 'eating-out', categoryId: 'frivolous', name: 'Eating out / food delivery' }];

/** Food delivery and restaurants, sorted into Frivolous → Eating out / food delivery. */
export const EATING_OUT_RULES: CategoryRule[] = [
  'zomato', 'swiggy', 'uber eats', 'glovo', 'deliveroo', 'bolt food', 'just eat', 'restaurant', 'cafe', 'mcdonald',
  'burger king', 'kfc', 'domino', 'pizza hut', 'starbucks', 'telepizza',
].map((match) => ({ match, categoryId: 'frivolous', subcategoryId: 'eating-out' }));

/** Starter keyword rules so imported bank rows land somewhere sensible. */
export const DEFAULT_RULES: CategoryRule[] = [
  ...['netflix', 'spotify', 'youtube', 'prime', 'disney', 'icloud', 'apple.com', 'google one', 'chatgpt', 'gym'].map(
    (match) => ({ match, categoryId: 'subscriptions', type: 'recurring-fixed' as const }),
  ),
  ...['edp', 'endesa', 'galp', 'electric', 'water', 'gas', 'internet', 'vodafone', 'meo', 'nos ', 'airtel', 'jio'].map(
    (match) => ({ match, categoryId: 'utilities', type: 'recurring-variable' as const }),
  ),
  { match: 'rent', categoryId: 'essentials', type: 'recurring-fixed' },
  ...['continente', 'pingo doce', 'lidl', 'aldi', 'mercadona', 'pharmacy', 'farmacia', 'uber', 'bolt', 'metro', 'cp '].map(
    (match) => ({ match, categoryId: 'essentials' }),
  ),
  ...['tax', 'autoridade tributaria', 'financas', 'income tax', 'gst'].map((match) => ({ match, categoryId: 'taxes' })),
  ...['bar ', 'amazon', 'zara', 'steam', 'cinema'].map((match) => ({ match, categoryId: 'frivolous' })),
  ...EATING_OUT_RULES,
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
    rules: DEFAULT_RULES.map((r) => ({ ...r })),
  };
}

/**
 * Bring saved data up to date. Saved data from before subcategories existed gets the starter
 * "Eating out / food delivery" subcategory and its merchant rules, and anything still unsorted
 * that those rules now recognise is sorted.
 */
export function migrate(saved: Partial<BudgetState>): BudgetState {
  const s: BudgetState = { ...initialState(), ...saved };
  if (saved.subcategories) return s;
  const hasFrivolous = s.categories.some((c) => c.id === 'frivolous');
  if (!hasFrivolous) return { ...s, subcategories: [] };
  const eat = new Map(EATING_OUT_RULES.map((r) => [r.match, r]));
  const rules = s.rules.map((r) => (eat.has(r.match) && r.categoryId === 'frivolous' && !r.subcategoryId ? { ...r, subcategoryId: 'eating-out' } : r));
  for (const r of EATING_OUT_RULES) if (!rules.some((x) => x.match === r.match)) rules.push({ ...r });
  return { ...s, subcategories: DEFAULT_SUBCATEGORIES.map((c) => ({ ...c })), rules, transactions: sortUnsorted(s.transactions, rules) };
}

/** Give uncategorised transactions the category (and subcategory) of the longest matching rule. */
export function sortUnsorted<T extends { description: string; categoryId: string | null; subcategoryId?: string }>(list: T[], rules: CategoryRule[]): T[] {
  return list.map((t) => {
    if (t.categoryId) return t;
    const r = matchRule(t.description, rules);
    return r ? { ...t, categoryId: r.categoryId, ...(r.subcategoryId ? { subcategoryId: r.subcategoryId } : {}) } : t;
  });
}
