import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

/** The hashed entry bundle a page loads, e.g. "entry-7be2b0d4….js". It changes with every release. */
const ENTRY = /entry-[0-9a-f]+\.js/;
const TRIED = 'budget-planner/update-tried';

function appRoot() {
  const manifest = document.querySelector<HTMLLinkElement>('link[rel="manifest"]')?.href;
  return new URL('./', manifest ?? `${location.origin}/`).href;
}

/**
 * Web only. Checks whether a newer version of the app is online, when it opens and whenever it comes back
 * to the front. The check refreshes the browser's cached copy of the page, so a reload gets the new version.
 * On opening it reloads straight away; later it only says so, so nothing being typed is lost.
 */
export function useAppUpdate() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const running = [...document.scripts].map((s) => s.src.match(ENTRY)?.[0]).find(Boolean);
    if (!running) return; // dev server
    const opened = Date.now();
    const check = async () => {
      try {
        const html = await (await fetch(appRoot(), { cache: 'reload' })).text();
        const online = html.match(ENTRY)?.[0];
        if (!online || online === running) return;
        // Reload by itself only once per new version, so a slow-to-update server can't cause a reload loop.
        let tried = false;
        try {
          tried = sessionStorage.getItem(TRIED) === online;
          sessionStorage.setItem(TRIED, online);
        } catch {}
        if (Date.now() - opened < 15_000 && !tried) location.reload();
        else setReady(true);
      } catch {
        // Offline: try again next time.
      }
    };
    check();
    const onShow = () => document.visibilityState === 'visible' && check();
    document.addEventListener('visibilitychange', onShow);
    return () => document.removeEventListener('visibilitychange', onShow);
  }, []);
  return { ready, reload: () => location.reload() };
}
