import AsyncStorage from '@react-native-async-storage/async-storage';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

import { newId } from './budget.ts';
import { useBudget } from './store.tsx';
import { mergeSynced, nextDateFrom, syncApi, type SyncConfig } from './sync.ts';

const KEY = 'budget-planner/sync-config/v1';
/** Default backend: this project's Supabase function. Can be changed in Settings. */
export const DEFAULT_SYNC_URL =
  process.env.EXPO_PUBLIC_SYNC_URL ?? 'https://lyfztzgubetxreowrylh.supabase.co/functions/v1/revolut-sync';

type Status = { connected: boolean; validUntil?: string; accounts?: { name?: string; currency?: string }[] };

/** Everything the Settings screen needs for Revolut sync, plus a quiet auto-sync on app start. */
export function useRevolutSync() {
  const { state, ready, applySync } = useBudget();
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

  const connect = useCallback(() => {
    // Browsers only allow a new tab opened directly from the click, so on web open it now and point it at
    // the bank page once the server replies.
    const tab = Platform.OS === 'web' ? window.open('about:blank', '_blank') : null;
    return run('connect', async () => {
      try {
        const { url } = await syncApi.connect(config);
        if (tab) tab.location.href = url;
        else if (Platform.OS === 'web') window.location.href = url;
        else await WebBrowser.openBrowserAsync(url);
        setMessage({ text: 'After approving in Revolut, come back and press "Check connection".' });
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
        const res = await syncApi.sync(config, nextDateFrom(s.lastSyncedAt));
        const added = mergeSynced(s, res.transactions, newId);
        applySync(added, new Date().toISOString());
        setStatus((st) => ({ ...(st ?? { connected: true }), connected: true, validUntil: res.validUntil }));
        setMessage({ text: added.length ? `Added ${added.length} new transactions from Revolut.` : 'Up to date. No new transactions.' });
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
