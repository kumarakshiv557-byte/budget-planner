import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, Platform } from 'react-native';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { deleteCategoryIn, forPerson, forgetTransferRuleIn, newCategory, markTransferIn, putBackTransferIn, tagIncomeIn, tagNewIncome, newId, recategorizeIn, resortIn, ruleFrom, sortIn, unmarkTransferIn, unsortIn, type SortPick } from './budget.ts';
import { cloudApi, decide, type CloudMeta, type CloudStatus } from './cloud.ts';
import { initialState, migrate } from './defaults.ts';
import { applyTransfers, SYNC_CONFIG_KEY, type SyncConfig } from './sync.ts';
import type { BudgetItem, BudgetState, Category, Income, Transaction, TransferLine } from './types.ts';

const KEY = 'budget-planner/state/v1';
/** This device's CloudMeta (which server version its data is based on, and whether it has unsaved changes). */
const META_KEY = `${KEY}/cloud`;
/** This device's own copy, kept when another device's newer copy replaced it. */
const BACKUP_KEY = `${KEY}/replaced-copy`;

async function readConfig(): Promise<SyncConfig | null> {
  const raw = await AsyncStorage.getItem(SYNC_CONFIG_KEY).catch(() => null);
  const c = raw ? (JSON.parse(raw) as Partial<SyncConfig>) : {};
  const url = c.url ?? process.env.EXPO_PUBLIC_SYNC_URL ?? 'https://lyfztzgubetxreowrylh.supabase.co/functions/v1/revolut-sync';
  return url.startsWith('https://') && (c.secret ?? '').length >= 12 ? { url, secret: c.secret! } : null;
}

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
  applySync: (ts: Transaction[], at: string, income?: Income[], transfers?: string[], owners?: string[], details?: Record<string, NonNullable<Transaction['details']>>, reread?: boolean, log?: TransferLine[]) => void;
  saveIncome: (i: Omit<Income, 'id'> & { id?: string }) => void;
  deleteIncome: (id: string) => void;
  addIncome: (list: Income[]) => void;
  /** Tag an income line; with `learn`, remember it for the sender and tag their other lines too. */
  tagIncome: (id: string, tag: string | undefined, note: string | undefined, learn: boolean, subTag?: string, subSubTag?: string) => void;
  /** Recategorise a transaction; with `learn`, remember the merchant and sort its other unsorted transactions too. */
  recategorize: (id: string, categoryId: string, learn: boolean, subcategoryId?: string) => void;
  /** Sort a payment from "to sort": category plus type (and payment tag). */
  sortTransaction: (id: string, pick: SortPick, learn: boolean) => void;
  /** Take a payment out because it only moved money between your own accounts (with `learn`, remember it). */
  markTransfer: (id: string, learn: boolean) => void;
  undoTransfer: (removed: Transaction[], rule?: string) => void;
  /** Put back a line taken out as a transfer (and, if asked, stop treating payments like it as transfers). */
  putBackTransfer: (lineId: string, forgetRule: boolean) => void;
  /** Stop treating payments matching this text as transfers; the next sync brings back what was left out. */
  forgetTransferRule: (rule: string) => void;
  /** Adds a category (with the next free colour) and returns its id. */
  addCategory: (name: string) => string;
  /** Adds a subcategory (under another one with `parentId`) and returns its id. */
  addSubcategory: (categoryId: string, name: string, parentId?: string) => string;
  renameSubcategory: (id: string, name: string) => void;
  deleteSubcategory: (id: string) => void;
  /** Removes a category; its lines go back to "to sort". Kept if budget items use it. */
  deleteCategory: (id: string) => void;
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
  /** Saving to the server: off until the sync passphrase is set. */
  cloud: CloudStatus;
  /** Check the server for a newer copy now (and save this device's changes). */
  pullCloud: () => void;
} & Actions;

const BudgetContext = createContext<Ctx | null>(null);

export function BudgetProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<BudgetState>(initialState);
  const [ready, setReady] = useState(false);
  const loaded = useRef(false);
  /** A state that came from storage or the server rather than from a change made here; it isn't sent back. */
  const notMine = useRef<BudgetState | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((raw) => {
        if (!raw) return;
        const saved = JSON.parse(raw);
        // Keep a copy of the data from before the one-time sorting reset, just in case.
        if ((saved.dataVersion ?? 1) < 3) AsyncStorage.setItem(`${KEY}/before-sort-reset`, raw).catch(() => {});
        const restored = migrate(saved);
        notMine.current = restored;
        setState(restored);
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

  // ---- Keeping the budget on the server (shared by every device) ----
  const [cloud, setCloud] = useState<CloudStatus>({ kind: 'off' });
  const meta = useRef<CloudMeta>({ version: 0, dirty: false });
  const latest = useRef(state);
  useEffect(() => {
    latest.current = state;
  }, [state]);
  const busy = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveMeta = (m: CloudMeta) => {
    meta.current = m;
    AsyncStorage.setItem(META_KEY, JSON.stringify(m)).catch(() => {});
  };

  const syncCloud = useCallback(async () => {
    if (busy.current || !loaded.current) return;
    const cfg = await readConfig();
    if (!cfg) return setCloud({ kind: 'off' });
    busy.current = true;
    try {
      const server = await cloudApi.get(cfg);
      let action = decide(meta.current, server.version);
      for (let tries = 0; tries < 3; tries++) {
        if (action === 'adopt' || action === 'conflict') {
          if (action === 'conflict') await AsyncStorage.setItem(BACKUP_KEY, JSON.stringify(latest.current)).catch(() => {});
          const copy = migrate(server.data ?? {});
          notMine.current = copy;
          setState(copy);
          saveMeta({ version: server.version, dirty: false });
          setCloud(action === 'conflict' ? { kind: 'replaced', at: server.updatedAt ?? '' } : { kind: 'saved', at: server.updatedAt ?? '' });
          return;
        }
        if (action === 'none') return setCloud({ kind: 'saved', at: server.updatedAt ?? '' });
        setCloud({ kind: 'saving' });
        const res = await cloudApi.put(cfg, latest.current, server.version);
        if (res.ok) {
          saveMeta({ version: res.version, dirty: false });
          return setCloud({ kind: 'saved', at: res.updatedAt });
        }
        Object.assign(server, res.current);
        action = decide(meta.current, server.version);
      }
    } catch (e) {
      setCloud({ kind: 'error', text: e instanceof Error ? e.message : String(e) });
    } finally {
      busy.current = false;
    }
  }, []);

  // Start: read this device's meta, then check the server.
  useEffect(() => {
    if (!ready) return;
    AsyncStorage.getItem(META_KEY)
      .then((raw) => {
        // A device that never talked to the server counts its data as unsaved, unless it is empty.
        meta.current = raw ? JSON.parse(raw) : { version: 0, dirty: latest.current.transactions.length + latest.current.items.length + latest.current.income.length > 0 };
      })
      .catch(() => {})
      .finally(() => syncCloud());
  }, [ready, syncCloud]);

  // Every change made here is saved to the server shortly after.
  useEffect(() => {
    if (!loaded.current) return;
    if (state === notMine.current) return;
    saveMeta({ ...meta.current, dirty: true });
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => syncCloud(), 1500);
  }, [state, syncCloud]);

  // Coming back to the app: pick up what another device saved.
  useEffect(() => {
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      const onShow = () => document.visibilityState === 'visible' && syncCloud();
      document.addEventListener('visibilitychange', onShow);
      return () => document.removeEventListener('visibilitychange', onShow);
    }
    const sub = AppState.addEventListener('change', (st) => st === 'active' && syncCloud());
    return () => sub.remove();
  }, [syncCloud]);

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
      applySync: (ts, at, income, transfers = [], owners, details, reread, log) =>
        update((s) => {
          const withDetails = details
            ? s.transactions.map((t) => (t.externalId && details[t.externalId] && !t.details ? { ...t, details: details[t.externalId] } : t))
            : s.transactions;
          const next = {
            ...s,
            lastSyncedAt: at,
            ...(details ? { detailsBackfilled: true } : {}),
            ...(reread ? { rereadAll: false } : {}),
            transactions: [...withDetails, ...ts],
            ...(income ? { income: [...s.income, ...tagNewIncome(s, income)], incomeBackfilled: true } : {}),
            ...(owners ? { syncedOwners: [...new Set([...(s.syncedOwners ?? []), ...owners])] } : {}),
            ...(log?.length ? { transferLog: [...(s.transferLog ?? []), ...log].slice(-1500) } : {}),
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
      addIncome: (list) => update((s) => ({ ...s, income: [...s.income, ...tagNewIncome(s, list)] })),
      tagIncome: (id, tag, note, learn, subTag, subSubTag) => update((s) => tagIncomeIn(s, id, tag, note, learn, subTag, subSubTag)),
      recategorize: (id, categoryId, learn, subcategoryId) => update((s) => recategorizeIn(s, id, categoryId, subcategoryId, learn)),
      sortTransaction: (id, pick, learn) => update((s) => sortIn(s, id, pick, learn)),
      markTransfer: (id, learn) => update((s) => markTransferIn(s, id, learn)),
      undoTransfer: (removed, rule) => update((s) => unmarkTransferIn(s, removed, rule)),
      putBackTransfer: (lineId, forgetRule) => update((s) => putBackTransferIn(s, lineId, forgetRule)),
      forgetTransferRule: (rule) => update((s) => forgetTransferRuleIn(s, rule)),
      addCategory: (name) => {
        const id = newId();
        update((s) => ({ ...s, categories: [...s.categories, newCategory(s.categories, id, name)] }));
        return id;
      },
      addSubcategory: (categoryId, name, parentId) => {
        const id = newId();
        update((s) => ({ ...s, subcategories: [...s.subcategories, { id, categoryId, name: name.trim(), ...(parentId ? { parentId } : {}) }] }));
        return id;
      },
      renameSubcategory: (id, name) =>
        update((s) => ({ ...s, subcategories: s.subcategories.map((c) => (c.id === id ? { ...c, name } : c)) })),
      deleteSubcategory: (id) =>
        update((s) => {
          // A third-level entry's lines move up to its subcategory; a subcategory takes the entries under it along.
          const parent = s.subcategories.find((c) => c.id === id)?.parentId;
          const gone = new Set([id, ...s.subcategories.filter((c) => c.parentId === id).map((c) => c.id)]);
          const drop = <T extends { subcategoryId?: string }>(x: T): T => {
            if (!x.subcategoryId || !gone.has(x.subcategoryId)) return x;
            const { subcategoryId: _gone, ...rest } = x;
            return (parent ? { ...rest, subcategoryId: parent } : rest) as T;
          };
          return {
            ...s,
            subcategories: s.subcategories.filter((c) => !gone.has(c.id)),
            transactions: s.transactions.map(drop),
            items: s.items.map(drop),
            rules: s.rules.map(drop),
          };
        }),
      deleteCategory: (id) => update((s) => deleteCategoryIn(s, id)),
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
  const pullCloud = useCallback(() => void syncCloud(), [syncCloud]);
  const value = useMemo(
    () => ({ state: shown, allState: state, ready, whose, setWhose, cloud, pullCloud, ...actions }),
    [shown, state, ready, whose, cloud, pullCloud, actions],
  );
  return <BudgetContext.Provider value={value}>{children}</BudgetContext.Provider>;
}

export function useBudget() {
  const ctx = useContext(BudgetContext);
  if (!ctx) throw new Error('useBudget must be used inside BudgetProvider');
  return ctx;
}
