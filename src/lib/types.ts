/** How an item behaves over time. */
export type ItemType =
  | 'recurring-fixed'
  | 'recurring-variable'
  | 'variable-one-time'
  | 'fixed-one-time';

export const ITEM_TYPES: { id: ItemType; label: string; hint: string }[] = [
  { id: 'recurring-fixed', label: 'Recurring, fixed', hint: 'Same amount every month (rent, Netflix)' },
  { id: 'recurring-variable', label: 'Recurring, variable', hint: 'Every month, amount changes (electricity, groceries)' },
  { id: 'variable-one-time', label: 'One-time, variable', hint: 'Unplanned, any amount (eating out, shopping)' },
  { id: 'fixed-one-time', label: 'One-time, fixed', hint: 'Known lump sum on a date (advance tax)' },
];

export function isRecurring(type: ItemType) {
  return type === 'recurring-fixed' || type === 'recurring-variable';
}

export type Category = {
  id: string;
  name: string;
  /** Default type for new items in this category. The user can change it. */
  defaultType: ItemType;
  /** Fixed categorical colour, assigned by order and never re-used. */
  color: string;
  colorDark: string;
};

/** A month as "YYYY-MM". */
export type Month = string;

/** A planned amount: the forecast side. */
export type BudgetItem = {
  id: string;
  name: string;
  categoryId: string;
  type: ItemType;
  /** Positive amount in the account currency. For recurring items this is per month. */
  amount: number;
  /** First month it applies. One-time items apply only in this month. */
  startMonth: Month;
  /** Optional last month for recurring items (inclusive). */
  endMonth?: Month;
};

export type TransactionSource = 'manual' | 'csv' | 'revolut';

/** Money that actually moved: the actual side. Spending is a positive amount. */
export type Transaction = {
  id: string;
  date: string; // YYYY-MM-DD
  description: string;
  amount: number;
  categoryId: string | null;
  type: ItemType;
  source: TransactionSource;
  /** Bank/CSV reference used to skip duplicates on re-import. */
  externalId?: string;
};

/** "Anything matching this text goes to this category." Learned when the user recategorises. */
export type CategoryRule = { match: string; categoryId: string };

export type BudgetState = {
  version: 1;
  currency: string;
  categories: Category[];
  items: BudgetItem[];
  transactions: Transaction[];
  rules: CategoryRule[];
  /** When Revolut sync last succeeded (ISO time). */
  lastSyncedAt?: string;
};
