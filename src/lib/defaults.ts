import type { BudgetState, Category, CategoryRule } from './types.ts';

// Categorical colours in fixed order (validated for colour-blind separation).
// Light/dark steps are chosen separately rather than auto-flipped.
export const DEFAULT_CATEGORIES: Category[] = [
  { id: 'essentials', name: 'Essentials', defaultType: 'recurring-variable', color: '#2a78d6', colorDark: '#3987e5' },
  { id: 'frivolous', name: 'Frivolous', defaultType: 'variable-one-time', color: '#eb6834', colorDark: '#d95926' },
  { id: 'subscriptions', name: 'Subscriptions', defaultType: 'recurring-fixed', color: '#1baf7a', colorDark: '#199e70' },
  { id: 'utilities', name: 'Utility bills', defaultType: 'recurring-variable', color: '#eda100', colorDark: '#c98500' },
  { id: 'taxes', name: 'Taxes', defaultType: 'fixed-one-time', color: '#e87ba4', colorDark: '#d55181' },
];

/** Starter keyword rules so imported bank rows land somewhere sensible. */
export const DEFAULT_RULES: CategoryRule[] = [
  ...['netflix', 'spotify', 'youtube', 'prime', 'disney', 'icloud', 'apple.com', 'google one', 'chatgpt', 'gym'].map(
    (match) => ({ match, categoryId: 'subscriptions' }),
  ),
  ...['edp', 'endesa', 'galp', 'electric', 'water', 'gas', 'internet', 'vodafone', 'meo', 'nos ', 'airtel', 'jio'].map(
    (match) => ({ match, categoryId: 'utilities' }),
  ),
  ...['rent', 'continente', 'pingo doce', 'lidl', 'aldi', 'mercadona', 'pharmacy', 'farmacia', 'uber', 'bolt', 'metro', 'cp '].map(
    (match) => ({ match, categoryId: 'essentials' }),
  ),
  ...['tax', 'autoridade tributaria', 'financas', 'income tax', 'gst'].map((match) => ({ match, categoryId: 'taxes' })),
  ...['restaurant', 'bar ', 'cafe', 'amazon', 'zara', 'steam', 'glovo', 'uber eats', 'cinema'].map((match) => ({
    match,
    categoryId: 'frivolous',
  })),
];

export function initialState(): BudgetState {
  return {
    version: 1,
    currency: 'EUR',
    categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })),
    items: [],
    transactions: [],
    rules: DEFAULT_RULES.map((r) => ({ ...r })),
  };
}
