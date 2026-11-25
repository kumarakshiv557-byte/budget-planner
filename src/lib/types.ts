import type { TxDetails } from '../../supabase/functions/revolut-sync/eb-normalize.ts';

export type { TxDetails };
/** How an item behaves over time. */
export type ItemType =
  | 'recurring-fixed'
  | 'recurring-variable'
  | 'variable-one-time'
  | 'fixed-one-time';

export const ITEM_TYPES: { id: ItemType; label: string; hint: string }[] = [
  { id: 'recurring-fixed', label: 'Recurring, fixed', hint: 'Same amount every month (rent, Netflix)' },
  { id: 'recurring-variable', label: 'Recurring, variable', hint: 'Every month, amount changes (electricity, groceries)' },
  { id: 'variable-one-time', label: 'One-time', hint: 'Happens once, amount known only then (eating out, a repair)' },
  { id: 'fixed-one-time', label: 'One-time, planned', hint: 'Happens once, amount known ahead (yearly tax, a booked flight)' },
];

/**
 * Types for spending lines. Once money has left the bank its amount is known, so "planned" adds nothing there:
 * a spending line is recurring (fixed or variable) or simply one-time. "Planned" stays for budget items.
 */
export const LINE_TYPES = ITEM_TYPES.filter((t) => t.id !== 'fixed-one-time');

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

/** Someone in the household whose money is tracked: "me" is you; the others are named in Settings. */
export type Person = { id: string; name: string; /** Their bank, as Enable Banking names it, and its country. */ bank?: string; country?: string };

/** Lines with no owner belong to "me". */
export const ownerOf = (x: { owner?: string }) => x.owner ?? 'me';

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
  /** Whose money it is (a Person id). Missing means "me". */
  owner?: string;
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
  /** A one-off remark on this payment only. Never remembered or copied to other payments. */
  remark?: string;
  /** Whose account it came from or who paid (a Person id). Missing means "me". */
  owner?: string;
  source: TransactionSource;
  /** Bank/CSV reference used to skip duplicates on re-import. */
  externalId?: string;
  /** When you last sorted or fixed it by hand (ISO time), for "Recently sorted". */
  sortedAt?: string;
  /** Extra facts from the bank: card or transfer, merchant type, place, reference, original currency. */
  details?: TxDetails;
};

/** Money that came in (salary, transfers from others). Amount is positive. */
export type Income = {
  id: string;
  date: string; // YYYY-MM-DD
  description: string;
  amount: number;
  source: TransactionSource;
  externalId?: string;
  /** Who received it (a Person id). Missing means "me". */
  owner?: string;
  /** Added by hand and comes in every month from this date's month, e.g. a salary paid outside the bank. */
  monthly?: boolean;
  /** For monthly income: the last month it comes in. */
  endMonth?: Month;
  /** What kind of income it is ("Salary", "Refund", …). Remembered per sender. */
  tag?: string;
  /** Your own note on what it was for. Remembered per sender with the tag. */
  note?: string;
  /** A finer label under the tag (tag "MBWay", sub-tag "Ahmed"). Remembered per sender with the tag. */
  subTag?: string;
};

/** A bank line left out because it only moved money between your own accounts. */
export type TransferLine = {
  externalId: string;
  date: string;
  description: string;
  amount: number;
  owner?: string;
  /** Money out of, or into, the account. */
  dir: 'in' | 'out';
  /** The remembered text it matched, or "pair" when its other side was found in another of your accounts. */
  why: string;
};

/** "Money in from anyone matching this text gets this tag (and note)." */
export type IncomeRule = { match: string; tag: string; subTag?: string; note?: string };

/** Starter income tags; you can add your own. */
export const DEFAULT_INCOME_TAGS = ['Salary', 'Side work', 'Refund', 'Family', 'Gift', 'Interest', 'Other'];

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
  /** The household: "me" plus anyone else whose money is tracked. */
  people: Person[];
  /** Bank rows found to be money moved between two of the household's connected accounts. Never imported. */
  transferIds?: string[];
  /** Your income tags (missing means DEFAULT_INCOME_TAGS). */
  incomeTags?: string[];
  /** Remembered income tags per sender. */
  incomeRules?: IncomeRule[];
  /** Text of payments you marked as moving money between your own accounts ("p/ akshiv kumar"); such lines are never imported. */
  transferRules?: string[];
  /** Lines you took out as transfers, kept so they can be put back from the Income tab (newest last). */
  transferred?: { line: Transaction; rule?: string; at: string }[];
  /** The next sync re-reads the full ~90 days (to bring back lines that were left out). */
  rereadAll?: boolean;
  /** Bank lines the sync left out as transfers between your own accounts, so the Income tab can show them (newest last). */
  transferLog?: TransferLine[];
  /** Owners whose bank connection has been synced at least once (a new one gets its full history). */
  syncedOwners?: string[];
  /** True once Revolut income has been fetched for the full ~90-day window. */
  incomeBackfilled?: boolean;
  /** Older bank lines were given their bank details (one full re-read). */
  detailsBackfilled?: boolean;
  /** When Revolut sync last succeeded (ISO time). */
  lastSyncedAt?: string;
  /** Which one-off data upgrades (see `migrate`) have run. */
  dataVersion?: number;
};
