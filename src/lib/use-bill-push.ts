import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';
import { Platform } from 'react-native';

import { pushBills } from './budget.ts';
import { useBudget } from './store.tsx';
import { DEFAULT_SYNC_URL, SYNC_CONFIG_KEY } from './use-revolut-sync.ts';

/** Remembers that this browser is signed up, and what was last sent, so changes can be re-sent. */
const KEY = 'budget-planner/bill-push/v1';
type Saved = { endpoint: string; sent: string };

export type PushState = 'unsupported' | 'needs-install' | 'off' | 'on' | 'blocked';

/** The bill-reminders function sits next to revolut-sync and uses the same passphrase. */
async function server() {
  const raw = await AsyncStorage.getItem(SYNC_CONFIG_KEY).catch(() => null);
  const cfg = { url: DEFAULT_SYNC_URL, secret: '', ...(raw ? JSON.parse(raw) : {}) } as { url: string; secret: string };
  return { base: cfg.url.replace(/\/+$/, '').replace(/revolut-sync$/, 'bill-reminders'), secret: cfg.secret };
}

async function call<T>(route: string, body?: unknown): Promise<T> {
  const { base, secret } = await server();
  if (secret.length < 12) throw new Error('Add your sync passphrase under Revolut sync first. Reminders use the same one.');
  const res = await fetch(`${base}/${route}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', 'x-sync-secret': secret },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error ?? `Reminder server returned ${res.status}`);
  return out as T;
}

function supported() {
  return Platform.OS === 'web' && typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

/** iPhones only allow web notifications once the app is added to the home screen. */
function needsInstall() {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return false;
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone;
  return ios && !standalone;
}

/** What can be told without storage: unsupported, needs installing, blocked, or (maybe) off. */
function localStatus(): PushState {
  if (!supported()) return needsInstall() ? 'needs-install' : 'unsupported';
  return Notification.permission === 'denied' ? 'blocked' : 'off';
}

function keyBytes(b64: string) {
  const s = atob((b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

async function registration() {
  // The service worker sits next to the app (…/budget-planner/sw.js on GitHub Pages).
  const manifest = document.querySelector<HTMLLinkElement>('link[rel="manifest"]')?.href;
  const url = new URL('sw.js', manifest ?? `${location.origin}/`);
  return navigator.serviceWorker.register(url.href, { scope: new URL('./', url).pathname });
}

/** Push reminders for "Pay myself" bills, the day before each is due. Web only. */
export function useBillPush() {
  const { state, ready } = useBudget();
  const [status, setStatus] = useState<PushState>(localStatus);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const bills = JSON.stringify(pushBills(state.items, state.currency));

  const refresh = useCallback(() => {
    const local = localStatus();
    if (local !== 'off') return setStatus(local);
    AsyncStorage.getItem(KEY)
      .then((saved) => setStatus(saved ? 'on' : 'off'))
      .catch(() => setStatus('off'));
  }, []);
  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((saved) => setStatus((s) => (s === 'off' && saved ? 'on' : s)))
      .catch(() => {});
  }, []);

  const send = useCallback(
    async (subscription: PushSubscriptionJSON) => {
      await call('subscribe', { subscription, bills: JSON.parse(bills), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });
      await AsyncStorage.setItem(KEY, JSON.stringify({ endpoint: subscription.endpoint ?? '', sent: bills } satisfies Saved));
    },
    [bills],
  );

  const run = useCallback(async (fn: () => Promise<string | void>) => {
    setBusy(true);
    setMessage(null);
    try {
      const text = await fn();
      if (text) setMessage({ text });
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : String(e), error: true });
    } finally {
      setBusy(false);
      refresh();
    }
  }, [refresh]);

  const turnOn = useCallback(
    () =>
      run(async () => {
        if (!supported()) throw new Error('This browser cannot show notifications.');
        if ((await Notification.requestPermission()) !== 'granted') throw new Error('Notifications were not allowed. You can allow them in the browser or phone settings.');
        const reg = await registration();
        await navigator.serviceWorker.ready;
        const { publicKey } = await call<{ publicKey: string }>('key');
        const sub =
          (await reg.pushManager.getSubscription()) ??
          (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }));
        await send(sub.toJSON());
        return "Reminders are on. You'll get one at 9:00 the day before each bill is due.";
      }),
    [run, send],
  );

  const sendTest = useCallback(
    () =>
      run(async () => {
        const saved = JSON.parse((await AsyncStorage.getItem(KEY)) ?? 'null') as Saved | null;
        if (!saved) throw new Error('Turn reminders on first.');
        await call('test', { endpoint: saved.endpoint });
        return 'Test sent. It should pop up in a few seconds.';
      }),
    [run],
  );

  const turnOff = useCallback(
    () =>
      run(async () => {
        const saved = JSON.parse((await AsyncStorage.getItem(KEY)) ?? 'null') as Saved | null;
        if (saved) await call('unsubscribe', { endpoint: saved.endpoint }).catch(() => {});
        const reg = await navigator.serviceWorker.getRegistration();
        await (await reg?.pushManager.getSubscription())?.unsubscribe();
        await AsyncStorage.removeItem(KEY);
        return 'Reminders are off on this device.';
      }),
    [run],
  );

  // Keep the server's copy of your bills up to date (new bill, new due day, marked paid).
  useEffect(() => {
    if (!ready || !supported()) return;
    const t = setTimeout(async () => {
      try {
        const saved = JSON.parse((await AsyncStorage.getItem(KEY)) ?? 'null') as Saved | null;
        if (!saved || saved.sent === bills || Notification.permission !== 'granted') return;
        const reg = await navigator.serviceWorker.getRegistration();
        const sub = await reg?.pushManager.getSubscription();
        if (sub) await send(sub.toJSON());
      } catch {
        // Quiet: tried again on the next change or app start.
      }
    }, 2000);
    return () => clearTimeout(t);
  }, [ready, bills, send]);

  return { status, busy, message, turnOn, sendTest, turnOff };
}
