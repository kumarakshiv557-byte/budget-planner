import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { newId } from './budget.ts';
import { initialState } from './defaults.ts';
import type { BudgetItem, BudgetState, Category, CategoryRule, Transaction } from './types.ts';

const KEY = 'budget-planner/state/v1';

type Actions = {
  saveItem: (item: Omit<BudgetItem, 'id'> & { id?: string }) => void;
  deleteItem: (id: string) => void;
  /** Save a transaction. If an edit changes its type, remember that type for the same merchant. */
  saveTransaction: (t: Omit<Transaction, 'id'> & { id?: string }) => void;
  deleteTransaction: (id: string) => void;
  addTransactions: (ts: Transaction[]) => void;
  /** Add synced transactions and record the sync time. */
  applySync: (ts: Transaction[], at: string) => void;
  /** Recategorise a transaction and remember the choice for future imports. */
  recategorize: (id: string, categoryId: string, learn: boolean) => void;
  updateCategory: (id: string, patch: Partial<Pick<Category, 'name'>>) => void;
  setCurrency: (currency: string) => void;
  resetAll: () => void;
};

type Ctx = { state: BudgetState; ready: boolean } & Actions;

const BudgetContext = createContext<Ctx | null>(null);

/** The words of a bank description that make a reusable rule ("PINGO DOCE LISBOA 123" → "pingo doce lisboa"). */
function ruleFrom(description: string) {
  return description
    .toLowerCase()
    .replace(/[0-9*#]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .slice(0, 3)
    .join(' ');
}

export function BudgetProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<BudgetState>(initialState);
  const [ready, setReady] = useState(false);
  const loaded = useRef(false);

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((raw) => {
        if (raw) setState({ ...initialState(), ...JSON.parse(raw) });
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
      deleteItem: (id) => update((s) => ({ ...s, items: s.items.filter((i) => i.id !== id) })),
      saveTransaction: (t) =>
        update((s) => {
          const full = { ...t, id: t.id ?? newId() } as Transaction;
          const before = s.transactions.find((x) => x.id === full.id);
          const exists = !!before;
          let rules = s.rules;
          const match = ruleFrom(full.description);
          if (before && before.type !== full.type && full.source !== 'manual' && match && full.categoryId) {
            const i = rules.findIndex((r) => r.match === match);
            rules = i >= 0
              ? rules.map((r, j) => (j === i ? { ...r, type: full.type } : r))
              : [...rules, { match, categoryId: full.categoryId, type: full.type }];
          }
          return {
            ...s,
            rules,
            transactions: exists ? s.transactions.map((x) => (x.id === full.id ? full : x)) : [...s.transactions, full],
          };
        }),
      deleteTransaction: (id) => update((s) => ({ ...s, transactions: s.transactions.filter((t) => t.id !== id) })),
      addTransactions: (ts) => update((s) => ({ ...s, transactions: [...s.transactions, ...ts] })),
      applySync: (ts, at) => update((s) => ({ ...s, lastSyncedAt: at, transactions: [...s.transactions, ...ts] })),
      recategorize: (id, categoryId, learn) =>
        update((s) => {
          const t = s.transactions.find((x) => x.id === id);
          if (!t) return s;
          const rules: CategoryRule[] = [...s.rules];
          const match = ruleFrom(t.description);
          if (learn && match) {
            const i = rules.findIndex((r) => r.match === match);
            if (i >= 0) rules[i] = { ...rules[i], categoryId };
            else rules.push({ match, categoryId });
          }
          return {
            ...s,
            rules,
            transactions: s.transactions.map((x) => (x.id === id ? { ...x, categoryId } : x)),
          };
        }),
      updateCategory: (id, patch) =>
        update((s) => ({ ...s, categories: s.categories.map((c) => (c.id === id ? { ...c, ...patch } : c)) })),
      setCurrency: (currency) => update((s) => ({ ...s, currency })),
      resetAll: () => update(() => initialState()),
    }),
    [update],
  );

  const value = useMemo(() => ({ state, ready, ...actions }), [state, ready, actions]);
  return <BudgetContext.Provider value={value}>{children}</BudgetContext.Provider>;
}

export function useBudget() {
  const ctx = useContext(BudgetContext);
  if (!ctx) throw new Error('useBudget must be used inside BudgetProvider');
  return ctx;
}
