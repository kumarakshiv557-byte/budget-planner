import type { SyncConfig } from './sync.ts';
import type { BudgetState } from './types.ts';

/** What this device knows about the copy on the server. */
export type CloudMeta = {
  /** The server version this device's data is based on (0: never loaded or saved). */
  version: number;
  /** True when this device has changes the server doesn't have yet. */
  dirty: boolean;
};

export type CloudStatus =
  | { kind: 'off' }
  | { kind: 'saving' }
  | { kind: 'saved'; at: string }
  | { kind: 'error'; text: string }
  /** Another device saved first; this device took the newer copy (its own copy is kept as a backup). */
  | { kind: 'replaced'; at: string };

/**
 * After reading the server's version, what this device should do:
 * - push: the server has nothing yet, or has exactly what this device started from and this device changed something;
 * - adopt: someone else saved a newer copy and this device changed nothing;
 * - conflict: both changed; the newer server copy wins and this device's copy is kept aside;
 * - none: already the same.
 */
export function decide(meta: CloudMeta, serverVersion: number): 'push' | 'adopt' | 'conflict' | 'none' {
  if (serverVersion === 0) return 'push';
  if (serverVersion === meta.version) return meta.dirty ? 'push' : 'none';
  return meta.dirty ? 'conflict' : 'adopt';
}

const base = (cfg: SyncConfig) => cfg.url.replace(/\/+$/, '');
const headers = (cfg: SyncConfig) => ({ 'Content-Type': 'application/json', 'x-sync-secret': cfg.secret });

export type ServerCopy = { data: BudgetState | null; version: number; updatedAt: string | null };

export const cloudApi = {
  async get(cfg: SyncConfig): Promise<ServerCopy> {
    const res = await fetch(`${base(cfg)}/state`, { headers: headers(cfg), cache: 'no-store' });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error ?? `Server returned ${res.status}`);
    return body as ServerCopy;
  },
  /** Save on top of baseVersion. Returns the new version, or the newer server copy if someone saved first. */
  async put(cfg: SyncConfig, data: BudgetState, baseVersion: number): Promise<{ ok: true; version: number; updatedAt: string } | { ok: false; current: ServerCopy }> {
    const res = await fetch(`${base(cfg)}/state`, { method: 'PUT', headers: headers(cfg), body: JSON.stringify({ data, baseVersion }) });
    const body = await res.json().catch(() => ({}));
    if (res.status === 409 && body.current) return { ok: false, current: body.current as ServerCopy };
    if (!res.ok) throw new Error(body.error ?? `Server returned ${res.status}`);
    return { ok: true, version: body.version, updatedAt: body.updatedAt };
  },
};
