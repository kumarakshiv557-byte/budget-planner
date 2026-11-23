import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { forPerson, markTransferIn, newId, recategorizeIn, resortIn, ruleFrom, sortIn, unmarkTransferIn, unsortIn, type SortPick } from './budget.ts';
import { initialState, migrate } from './defaults.ts';
import { applyTransfers } from './sync.ts';
import type { BudgetItem, BudgetState, Category, Income, Transaction } from './types.ts';

const KEY = 'budget-planner/state/v1';

type Actions = {
  saveItem: (item: Omit<BudgetItem, 'id'> & { id?: string }) => void;
  deleteItem: (id: string) => void;
  /** Mark a "Pay myself" bill as paid (or not) for a month. */
  setBillPaid: (id: string, month: string, paid: boolean) => void;
  /** Save a transaction. If an edit changes its type, remember that type for the same merchant. */
  saveTransaction: (t: Omit<Transaction, 'id'> & { id?: string }) => void;
  /** Correct a sorted payment; with alsoOthers, the same place's payments sorted alike and its remembered pick too. */
  resortTransaction: (t: Transaction, alsoOthers: boolean) => void;
  /** Send a payment back to "to sort" (with alsoOthers: the ones sorted alike too), forgetting the remembered pick. */
  unsortTransaction: (id: string, alsoOthers: boolean) => void;
  deleteTransaction: (id: string) => void;
  addTransactions: (ts: Transaction[]) => void;
  /**
   * Add synced transactions (and income, when the server sent it) and record the sync time. `transfers` are
   * bank rows of money moved between the household's accounts: they are taken out and never imported.
   * `owners` are whose connections were read.
   */
  applySync: (ts: Transaction[], at: string, income?: Income[], transfers?: string[], owners?: string[]) => void;
  saveIncome: (i: Omit<Income, 'id'> & { id?: string }) => void;
  deleteIncome: (id: string) => void;
  addIncome: (list: Income[]) => void;
  /** Recategorise a transaction; with `learn`, remember the merchant and sort its other unsorted transactions too. */
  recategorize: (id: string, categoryId: string, learn: boolean, subcategoryId?: string) => void;
  /** Sort a payment from "to sort": category plus type (and payment tag). */
  sortTransaction: (id: string, pick: SortPick, learn: boolean) => void;
  /** Take a payment out because it only moved money between your own accounts (with `learn`, remember it). */
  markTransfer: (id: string, learn: boolean) => void;
  undoTransfer: (removed: Transaction[], rule?: string) => void;
  addSubcategory: (categoryId: string, name: string) => void;
  renameSubcategory: (id: string, name: string) => void;
  deleteSubcategory: (id: string) => void;
  updateCategory: (id: string, patch: Partial<Pick<Category, 'name'>>) => void;
  setCurrency: (currency: string) => void;
  renamePerson: (id: string, name: string) => void;
  /** Remember which bank (and country) someone connects. */
  setPersonBank: (id: string, bank: string, country: string) => void;
  resetAll: () => void;
};

type Ctx = {
  /** What the screens show: everyone's data, or one person's when "Whose" is set. */
  state: BudgetState;
  /** Everyone's data, for anything that must see it all (syncing, reminders, import checks). */
  allState: BudgetState;
  ready: boolean;
  /** "all" or a Person id. */
  whose: string;
  setWhose: (whose: string) => void;
} & Actions;

const BudgetContext = createContext<Ctx | null>(null);

export function BudgetProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<BudgetState>(initialState);
  const [ready, setReady] = useState(false);
  const loaded = useRef(false);

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((raw) => {
        if (!raw) return;
        const saved = JSON.parse(raw);
        // Keep a copy of the data from before the one-time sorting reset, just in case.
        if ((saved.dataVersion ?? 1) < 3) AsyncStorage.setItem(`${KEY}/before-sort-reset`, raw).catch(() => {});
        setState(migrate(saved));
      })
      .catch(() => {})
      .finally(() => {
        loaded.current = true;
        setReady(true);
      });
  }, []);

  useEffect(() => {
    if (loaded.current) AsyncStorage.setItem(KEY, JSON.stringify(state)).catch(() => {});
  }, [state]);

  const update = useCallback((fn: (s: BudgetState) => BudgetState) => setState((s) => fn(s)), []);

  const actions = useMemo<Actions>(
    () => ({
      saveItem: (item) =>
        update((s) => {
          const full = { ...item, id: item.id ?? newId() } as BudgetItem;
          const exists = s.items.some((i) => i.id === full.id);
          return { ...s, items: exists ? s.items.map((i) => (i.id === full.id ? full : i)) : [...s.items, full] };
        }),
      setBillPaid: (id, month, paid) =>
        update((s) => ({
          ...s,
          items: s.items.map((i) => {
            if (i.id !== id) return i;
            const rest = (i.paidMonths ?? []).filter((m) => m !== month);
            return { ...i, paidMonths: paid ? [...rest, month] : rest };
          }),
        })),
      deleteItem: (id) => update((s) => ({ ...s, items: s.items.filter((i) => i.id !== id) })),
      saveTransaction: (t) =>
        update((s) => {
          const full = { ...t, id: t.id ?? newId() } as Transaction;
          const before = s.transactions.find((x) => x.id === full.id);
          const exists = !!before;
          let rules = s.rules;
          const match = ruleFrom(full.description);
          const changed = before && (before.type !== full.type || before.payment !== full.payment || (before.note ?? '') !== (full.note ?? ''));
          if (changed && full.source !== 'manual' && match && full.categoryId) {
            const learned = { type: full.type, payment: full.payment, note: full.note };
            const i = rules.findIndex((r) => r.match === match);
            rules = i >= 0
              ? rules.map((r, j) => (j === i ? { ...r, ...learned } : r))
              : [...rules, { match, categoryId: full.categoryId, ...learned }];
          }
          // A new note also labels the other payments from the same place that have none yet.
          const noteOthers = !!full.note && (before?.note ?? '') !== full.note && !!match;
          const same = (x: Transaction) => noteOthers && !x.note && ` ${x.description.toLowerCase()} `.includes(match);
          const others = s.transactions.map((x) => (x.id !== full.id && same(x) ? { ...x, note: full.note } : x));
          return {
            ...s,
            rules,
            transactions: exists ? others.map((x) => (x.id === full.id ? full : x)) : [...others, full],
          };
        }),
      resortTransaction: (t, alsoOthers) => update((s) => resortIn(s, t, alsoOthers)),
      unsortTransaction: (id, alsoOthers) => update((s) => unsortIn(s, id, alsoOthers)),
      deleteTransaction: (id) => update((s) => ({ ...s, transactions: s.transactions.filter((t) => t.id !== id) })),
      addTransactions: (ts) => update((s) => ({ ...s, transactions: [...s.transactions, ...ts] })),
      applySync: (ts, at, income, transfers = [], owners) =>
        update((s) => {
          const next = {
            ...s,
            lastSyncedAt: at,
            transactions: [...s.transactions, ...ts],
            ...(income ? { income: [...s.income, ...income], incomeBackfilled: true } : {}),
            ...(owners ? { syncedOwners: [...new Set([...(s.syncedOwners ?? []), ...owners])] } : {}),
          };
          return transfers.length ? { ...next, ...applyTransfers(next, transfers) } : next;
        }),
      saveIncome: (i) =>
        update((s) => {
          const full = { ...i, id: i.id ?? newId() } as Income;
          const exists = s.income.some((x) => x.id === full.id);
          return { ...s, income: exists ? s.income.map((x) => (x.id === full.id ? full : x)) : [...s.income, full] };
        }),
      deleteIncome: (id) => update((s) => ({ ...s, income: s.income.filter((x) => x.id !== id) })),
      addIncome: (list) => update((s) => ({ ...s, income: [...s.income, ...list] })),
      recategorize: (id, categoryId, learn, subcategoryId) => update((s) => recategorizeIn(s, id, categoryId, subcategoryId, learn)),
      sortTransaction: (id, pick, learn) => update((s) => sortIn(s, id, pick, learn)),
      markTransfer: (id, learn) => update((s) => markTransferIn(s, id, learn)),
      undoTransfer: (removed, rule) => update((s) => unmarkTransferIn(s, removed, rule)),
      addSubcategory: (categoryId, name) =>
        update((s) => ({ ...s, subcategories: [...s.subcategories, { id: newId(), categoryId, name: name.trim() }] })),
      renameSubcategory: (id, name) =>
        update((s) => ({ ...s, subcategories: s.subcategories.map((c) => (c.id === id ? { ...c, name } : c)) })),
      deleteSubcategory: (id) =>
        update((s) => {
          const drop = <T extends { subcategoryId?: string }>(x: T): T => {
            if (x.subcategoryId !== id) return x;
            const { subcategoryId: _gone, ...rest } = x;
            return rest as T;
          };
          return {
            ...s,
            subcategories: s.subcategories.filter((c) => c.id !== id),
            transactions: s.transactions.map(drop),
            items: s.items.map(drop),
            rules: s.rules.map(drop),
          };
        }),
      updateCategory: (id, patch) =>
        update((s) => ({ ...s, categories: s.categories.map((c) => (c.id === id ? { ...c, ...patch } : c)) })),
      setCurrency: (currency) => update((s) => ({ ...s, currency })),
      renamePerson: (id, name) => update((s) => ({ ...s, people: s.people.map((p) => (p.id === id ? { ...p, name } : p)) })),
      setPersonBank: (id, bank, country) => update((s) => ({ ...s, people: s.people.map((p) => (p.id === id ? { ...p, bank, country } : p)) })),
      resetAll: () => update(() => initialState()),
    }),
    [update],
  );

  const [whose, setWhose] = useState('all');
  const shown = useMemo(() => forPerson(state, whose), [state, whose]);
  const value = useMemo(() => ({ state: shown, allState: state, ready, whose, setWhose, ...actions }), [shown, state, ready, whose, actions]);
  return <BudgetContext.Provider value={value}>{children}</BudgetContext.Provider>;
}

export function useBudget() {
  const ctx = useContext(BudgetContext);
  if (!ctx) throw new Error('useBudget must be used inside BudgetProvider');
  return ctx;
}
