import AsyncStorage from '@react-native-async-storage/async-storage';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

import { newId } from './budget.ts';
import { useBudget } from './store.tsx';
import { mergeSynced, mergeSyncedIncome, nextDateFrom, syncApi, type SyncConfig, type SyncStatus } from './sync.ts';

export const SYNC_CONFIG_KEY = 'budget-planner/sync-config/v1';
const KEY = SYNC_CONFIG_KEY;
/** Default backend: this project's Supabase function. Can be changed in Settings. */
export const DEFAULT_SYNC_URL =
  process.env.EXPO_PUBLIC_SYNC_URL ?? 'https://lyfztzgubetxreowrylh.supabase.co/functions/v1/revolut-sync';

type Status = SyncStatus;

/** Everything the Settings screen needs for Revolut sync, plus a quiet auto-sync on app start. */
export function useRevolutSync() {
  const { allState: state, ready, applySync } = useBudget();
  const [config, setConfigState] = useState<SyncConfig>({ url: DEFAULT_SYNC_URL, secret: '' });
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState<null | 'connect' | 'sync' | 'status'>(null);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((raw) => raw && setConfigState((c) => ({ ...c, ...JSON.parse(raw) })))
      .catch(() => {});
  }, []);

  const setConfig = useCallback((c: SyncConfig) => {
    setConfigState(c);
    AsyncStorage.setItem(KEY, JSON.stringify(c)).catch(() => {});
  }, []);

  const configured = config.url.startsWith('https://') && config.secret.length >= 12;

  const run = useCallback(
    async <T>(kind: 'connect' | 'sync' | 'status', fn: () => Promise<T>) => {
      setBusy(kind);
      setMessage(null);
      try {
        return await fn();
      } catch (e) {
        setMessage({ text: e instanceof Error ? e.message : String(e), error: true });
        return undefined;
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  const refreshStatus = useCallback(() => run('status', async () => setStatus(await syncApi.status(config))), [run, config]);

  const connect = useCallback((who: { owner?: string; bank?: string; country?: string } = {}) => {
    // Browsers only allow a new tab opened directly from the click, so on web open it now and point it at
    // the bank page once the server replies.
    const tab = Platform.OS === 'web' ? window.open('about:blank', '_blank') : null;
    return run('connect', async () => {
      try {
        const { url } = await syncApi.connect(config, who);
        if (tab) tab.location.href = url;
        else if (Platform.OS === 'web') window.location.href = url;
        else await WebBrowser.openBrowserAsync(url);
        setMessage({ text: 'After approving at the bank, come back and press "Check connection".' });
      } catch (e) {
        tab?.close();
        throw e;
      }
    });
  }, [run, config]);

  const syncNow = useCallback(
    () =>
      run('sync', async () => {
        const s = stateRef.current;
        // The first sync after income support arrived re-reads the full window so past income shows up too.
        // Someone whose bank was connected since the last sync gets their full ~90 days.
        const synced = s.syncedOwners ?? (s.lastSyncedAt ? ['me'] : []);
        const fullFor = s.people.map((p) => p.id).filter((id) => !synced.includes(id));
        const res = await syncApi.sync(config, s.incomeBackfilled ? nextDateFrom(s.lastSyncedAt) : undefined, fullFor);
        const added = mergeSynced(s, res.transactions, newId);
        const income = res.income ? mergeSyncedIncome(s, res.income, newId) : undefined;
        const transfers = res.transfers ?? [];
        const known = new Set([...s.transactions, ...s.income].map((t) => t.externalId).filter(Boolean));
        const removed = transfers.filter((id) => known.has(id)).length;
        applySync(added, new Date().toISOString(), income, transfers, res.owners ?? ['me']);
        setStatus((st) => ({ ...(st ?? { connected: true }), connected: true, validUntil: res.validUntil }));
        const parts = [];
        if (added.length) parts.push(`${added.length} new transactions`);
        if (income?.length) parts.push(`${income.length} income payments`);
        const pairs = new Set(transfers).size / 2;
        const moved = pairs
          ? ` Left out ${pairs} transfer${pairs === 1 ? '' : 's'} between your own accounts${removed ? ` (and took out ${removed} line${removed === 1 ? '' : 's'} added before)` : ''}.`
          : '';
        setMessage({ text: (parts.length ? `Added ${parts.join(' and ')} from the bank.` : 'Up to date. Nothing new.') + moved });
      }),
    [run, config, applySync],
  );

  // Auto-sync once per app start if it has been more than 6 hours.
  const autoRan = useRef(false);
  useEffect(() => {
    if (!ready || !configured || autoRan.current) return;
    autoRan.current = true;
    const last = state.lastSyncedAt ? new Date(state.lastSyncedAt).getTime() : 0;
    if (last && Date.now() - last > 6 * 3600_000) syncNow();
  }, [ready, configured, state.lastSyncedAt, syncNow]);

  return { config, setConfig, configured, status, busy, message, refreshStatus, connect, syncNow, lastSyncedAt: state.lastSyncedAt };
}
