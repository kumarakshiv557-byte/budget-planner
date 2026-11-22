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

export function isRecurring(type: ItemType | null) {
  return type === 'recurring-fixed' || type === 'recurring-variable';
}

export type Category = {
  id: string;
  name: string;
  /** Fixed categorical colour, assigned by order and never re-used. */
  color: string;
  colorDark: string;
};

/**
 * How a fixed bill is paid. "auto" = a subscription debited from your account automatically;
 * "manual" = a bill you have to pay yourself (and may want reminding about).
 */
export type Payment = 'auto' | 'manual';

export const PAYMENTS: { id: Payment; label: string; hint: string }[] = [
  { id: 'auto', label: 'Subscription', hint: 'Debited from your account automatically' },
  { id: 'manual', label: 'Pay myself', hint: 'You pay it by hand. Add a due day for reminders.' },
];

/** A finer bucket inside a category, e.g. Frivolous → "Eating out / food delivery". */
export type Subcategory = { id: string; categoryId: string; name: string };

/** A month as "YYYY-MM". */
export type Month = string;

/** A planned amount: the forecast side. */
export type BudgetItem = {
  id: string;
  name: string;
  categoryId: string;
  subcategoryId?: string;
  type: ItemType;
  /** Positive amount in the account currency. For recurring items this is per month. */
  amount: number;
  /** First month it applies. One-time items apply only in this month. */
  startMonth: Month;
  /** Optional last month for recurring items (inclusive). */
  endMonth?: Month;
  /** For recurring, fixed items: debited automatically, or paid by hand. */
  payment?: Payment;
  /** For "Pay myself" items: day of the month the bill is due (1-31). */
  dueDay?: number;
  /** Months in which a "Pay myself" bill was marked as paid. */
  paidMonths?: Month[];
};

export type TransactionSource = 'manual' | 'csv' | 'revolut';

/** Money that actually moved: the actual side. Spending is a positive amount. */
export type Transaction = {
  id: string;
  date: string; // YYYY-MM-DD
  description: string;
  amount: number;
  categoryId: string | null;
  subcategoryId?: string;
  type: ItemType;
  payment?: Payment;
  /** Your own note on what it was for, e.g. "Mum's birthday gift". Remembered per merchant. */
  note?: string;
  source: TransactionSource;
  /** Bank/CSV reference used to skip duplicates on re-import. */
  externalId?: string;
};

/** Money that came in (salary, transfers from others). Amount is positive. */
export type Income = {
  id: string;
  date: string; // YYYY-MM-DD
  description: string;
  amount: number;
  source: TransactionSource;
  externalId?: string;
};

/**
 * "Anything matching this text goes to this category" (and, if set, gets this type).
 * Learned when the user recategorises or retypes a transaction. Types belong to each line, not to a category.
 */
export type CategoryRule = { match: string; categoryId: string; subcategoryId?: string; type?: ItemType; payment?: Payment; note?: string };

export type BudgetState = {
  version: 1;
  currency: string;
  categories: Category[];
  subcategories: Subcategory[];
  items: BudgetItem[];
  transactions: Transaction[];
  rules: CategoryRule[];
  income: Income[];
  /** True once Revolut income has been fetched for the full ~90-day window. */
  incomeBackfilled?: boolean;
  /** When Revolut sync last succeeded (ISO time). */
  lastSyncedAt?: string;
  /** Which one-off data upgrades (see `migrate`) have run. */
  dataVersion?: number;
};
