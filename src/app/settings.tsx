import { useEffect, useState } from 'react';
import { Platform, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, Chips, Field, Screen, styles, useCategoryColor } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useBudget } from '@/lib/store';
import { useBillPush } from '@/lib/use-bill-push';
import { connectLink, syncApi, type SyncConfig } from '@/lib/sync';
import { useRevolutSync } from '@/lib/use-revolut-sync';

const CURRENCIES = ['EUR', 'INR', 'GBP', 'USD'].map((c) => ({ id: c, label: c }));

export default function SettingsScreen() {
  const { state, cloud, renamePerson, updateCategory, setCurrency, resetAll, addCategory, addSubcategory, renameSubcategory, deleteSubcategory } = useBudget();
  const [newSub, setNewSub] = useState<Record<string, string>>({});
  const [newCat, setNewCat] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const colorFor = useCategoryColor();
  const theme = useTheme();
  const [confirmReset, setConfirmReset] = useState(false);

  return (
    <Screen title="Settings">
      <Card
        title="Household"
        subtitle="Whose money each line is. Pick a person at the top of Overview, Budget or Spending to see only theirs. Lines from before this were yours.">
        {state.people.map((p) => (
          <View key={p.id} style={styles.row}>
            <Field label={p.id === 'me' ? 'You' : 'Name'} value={p.name} onChangeText={(name) => renamePerson(p.id, name)} />
          </View>
        ))}
      </Card>

      <Card title="Currency" subtitle="Amounts are shown in this currency. Your Revolut account is EUR.">
        <Chips options={CURRENCIES} value={state.currency} onChange={setCurrency} />
      </Card>

      <Card
        title="Categories"
        subtitle="Add or rename categories, and add subcategories (like Eating out under Frivolous). Whether something is recurring or one-time is set on each line, not here.">
        {state.categories.map((c) => (
          <View key={c.id} style={{ gap: Spacing.two, paddingVertical: Spacing.three, borderTopWidth: 1, borderColor: theme.border }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two }}>
              <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: colorFor(c) }} />
              <Field label="Name" value={c.name} onChangeText={(name) => updateCategory(c.id, { name })} />
            </View>
            {state.subcategories
              .filter((x) => x.categoryId === c.id)
              .map((x) => {
                const used = state.transactions.filter((t) => t.subcategoryId === x.id).length;
                return (
                  <View key={x.id} style={{ flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.two, paddingLeft: Spacing.four }}>
                    <Field label="Subcategory" value={x.name} onChangeText={(name) => renameSubcategory(x.id, name)} />
                    {confirmDelete === x.id ? (
                      <Button
                        label={used ? `Remove (${used} move to ${c.name})` : 'Remove'}
                        kind="danger"
                        onPress={() => {
                          deleteSubcategory(x.id);
                          setConfirmDelete(null);
                        }}
                      />
                    ) : (
                      <Button label="Remove" kind="secondary" onPress={() => setConfirmDelete(x.id)} />
                    )}
                  </View>
                );
              })}
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.two, paddingLeft: Spacing.four }}>
              <Field
                label={`New subcategory in ${c.name}`}
                value={newSub[c.id] ?? ''}
                onChangeText={(v) => setNewSub({ ...newSub, [c.id]: v })}
                placeholder="e.g. Groceries"
              />
              <Button
                label="Add"
                kind="secondary"
                disabled={!(newSub[c.id] ?? '').trim()}
                onPress={() => {
                  addSubcategory(c.id, newSub[c.id] ?? '');
                  setNewSub({ ...newSub, [c.id]: '' });
                }}
              />
            </View>
          </View>
        ))}
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.two, paddingTop: Spacing.three, borderTopWidth: 1, borderColor: theme.border }}>
          <Field label="New category" value={newCat} onChangeText={setNewCat} placeholder="e.g. Health" />
          <Button
            label="Add category"
            disabled={!newCat.trim() || state.categories.some((c) => c.name.trim().toLowerCase() === newCat.trim().toLowerCase())}
            onPress={() => {
              addCategory(newCat);
              setNewCat('');
            }}
          />
        </View>
      </Card>

      <RevolutSyncCard />

      <BillRemindersCard />

      <Card
        title="Data"
        subtitle={
          cloud.kind === 'off'
            ? 'Stored on this device only. Add the sync passphrase above to keep it on your server, shared by every device.'
            : 'Kept on your server (behind the sync passphrase), so every device with the passphrase shows the same budget.'
        }>
        {cloud.kind !== 'off' ? (
          <ThemedText type="small" style={{ color: cloud.kind === 'error' ? theme.critical : theme.textSecondary }}>
            {cloud.kind === 'saving'
              ? 'Saving…'
              : cloud.kind === 'saved'
                ? `✓ Saved on the server${cloud.at ? `, ${new Date(cloud.at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}` : ''}.`
                : cloud.kind === 'replaced'
                  ? '↻ Another device saved newer changes, so this device now shows those. Its own last changes were kept aside as a backup.'
                  : `⚠ Couldn't reach the server: ${cloud.text}. Changes stay on this device and are saved when it's back.`}
          </ThemedText>
        ) : null}
        <View style={styles.row}>
          {confirmReset ? (
            <>
              <Button
                label={cloud.kind === 'off' ? 'Yes, delete everything' : 'Yes, delete everything on every device'}
                kind="danger"
                onPress={() => {
                  resetAll();
                  setConfirmReset(false);
                }}
              />
              <Button label="Cancel" kind="secondary" onPress={() => setConfirmReset(false)} />
            </>
          ) : (
            <Button label="Reset all data" kind="secondary" onPress={() => setConfirmReset(true)} />
          )}
        </View>
      </Card>
    </Screen>
  );
}

const daysUntil = (iso: string) => Math.ceil((new Date(iso).getTime() - Date.now()) / 86400_000);

function RevolutSyncCard() {
  const theme = useTheme();
  const { config, setConfig, configured, status, busy, message, refreshStatus, connect, syncNow, lastSyncedAt } = useRevolutSync();
  const { allState, setPersonBank, pullCloud } = useBudget();
  // Once the passphrase is in, start keeping the budget on the server.
  useEffect(() => {
    if (configured) pullCloud();
  }, [configured, pullCloud]);
  // Everyone's bank, you first.
  const people = [...allState.people].sort((a, b) => (a.id === 'me' ? -1 : b.id === 'me' ? 1 : 0));
  const [copied, setCopied] = useState<string | null>(null);
  // Saved with the household data, so the same bank is used on every screen and after a restart.
  // Until a bank is typed here, show the one they're already connected with.
  const connectionOf = (id: string) => status?.connections?.find((c) => c.owner === id);
  const bankOf = (id: string) => {
    const p = allState.people.find((x) => x.id === id);
    // A connected bank is what the account itself reports, so it wins over anything picked before.
    return { bank: connectionOf(id)?.bank ?? p?.bank ?? '', country: p?.country ?? 'PT' };
  };
  const fmt = (iso: string) => new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

  return (
    <Card
      title="Bank sync"
      subtitle="Pulls spending and income automatically through Enable Banking (EU open banking). Money moved between two connected accounts is left out, so it isn't counted twice.">
      <View style={[styles.row, { marginTop: Spacing.two }]}>
        <Field
          label="Sync server URL"
          value={config.url}
          onChangeText={(url) => setConfig({ ...config, url: url.trim() })}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="https://….supabase.co/functions/v1/revolut-sync"
        />
        <Field
          label="Sync passphrase"
          value={config.secret}
          onChangeText={(secret) => setConfig({ ...config, secret })}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          placeholder="the SYNC_SECRET you set in Supabase"
        />
      </View>
      <View style={[styles.row, { marginTop: Spacing.three }]}>
        <Button label={busy === 'status' ? 'Checking…' : 'Check connection'} kind="secondary" onPress={refreshStatus} disabled={!configured || !!busy} />
        <Button label={busy === 'sync' ? 'Syncing…' : 'Sync now'} kind="secondary" onPress={syncNow} disabled={!configured || !!busy} />
      </View>
      {people.map((p) => {
        const c = connectionOf(p.id);
        const b = bankOf(p.id);
        const link = connectLink(config, p.id, b.bank, b.country);
        return (
          <View key={p.id} style={{ gap: Spacing.two, paddingTop: Spacing.three, marginTop: Spacing.two, borderTopWidth: 1, borderColor: theme.border }}>
            <ThemedText type="smallBold">{p.id === 'me' ? 'Your bank' : `${p.name}'s bank`}</ThemedText>
            {c ? (
              <>
                <ThemedText type="small">
                  ✓ Connected{c.accounts.length ? ` (${c.accounts.map((a) => a.currency ?? a.name).join(', ')})` : ''}. Access lasts {daysUntil(c.validUntil)} more days.
                </ThemedText>
                <ReadOnly label="Bank" value={c.bankName ?? c.bank} />
                {c.bic ? <ReadOnly label="SWIFT/BIC" value={c.bic} /> : null}
              </>
            ) : (
              <>
                <ThemedText type="small" themeColor="textSecondary">
                  {p.id === 'me'
                    ? 'Not connected. Choose your bank, then connect here and approve it in your banking app.'
                    : `Not connected. ${p.name} approves it on their own phone: choose their bank, then send them the link or connect here while they sign in.`}
                </ThemedText>
                <BankPicker
                  config={config}
                  enabled={configured}
                  bank={b.bank}
                  country={b.country}
                  onChange={(bank, country) => {
                    setPersonBank(p.id, bank, country);
                    setCopied(null);
                  }}
                />
              </>
            )}
            <View style={styles.row}>
              {Platform.OS === 'web' && p.id !== 'me' ? (
                <Button
                  label={copied === p.id ? 'Link copied ✓' : `Copy ${c ? 'reconnect' : b.bank || 'bank'} link for ${p.name}`}
                  kind="secondary"
                  disabled={!configured || !b.bank}
                  onPress={() =>
                    navigator.clipboard
                      ?.writeText(link)
                      .then(() => setCopied(p.id))
                      .catch(() => {})
                  }
                />
              ) : null}
              <Button
                label={busy === 'connect' ? 'Opening…' : c ? 'Reconnect here' : 'Connect here'}
                kind="secondary"
                onPress={() => connect({ owner: p.id, bank: b.bank, country: b.country })}
                disabled={!configured || !!busy || !b.bank}
              />
            </View>
          </View>
        );
      })}
      {lastSyncedAt ? (
        <ThemedText type="small" themeColor="textSecondary">
          Last synced {fmt(lastSyncedAt)}. The app syncs by itself when opened if it has been 6 hours.
        </ThemedText>
      ) : null}
      {message ? (
        <ThemedText type="small" style={{ color: message.error ? theme.critical : theme.textSecondary }}>
          {message.error ? '⚠ ' : '✓ '}
          {message.text}
        </ThemedText>
      ) : null}
    </Card>
  );
}

/** A value shown like a field but not editable (it comes from the bank). */
function ReadOnly({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return (
    <View style={{ gap: Spacing.one, flex: 1, minWidth: 140 }}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <View style={{ borderWidth: 1, borderColor: theme.border, borderRadius: 12, paddingVertical: Spacing.two, paddingHorizontal: Spacing.three, opacity: 0.85 }}>
        <ThemedText>{value}</ThemedText>
      </View>
    </View>
  );
}

/**
 * Pick a bank for someone who isn't connected yet, from the banks Enable Banking supports in that country,
 * so the name always matches what the bank's sign-in needs.
 */
function BankPicker(props: { config: SyncConfig; enabled: boolean; bank: string; country: string; onChange: (bank: string, country: string) => void }) {
  const { config, enabled, bank, country, onChange } = props;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [list, setList] = useState<{ country: string; names: string[] } | null>(null);
  const [error, setError] = useState('');
  const wanted = /^[A-Z]{2}$/.test(country) ? country : '';
  const loaded = list?.country === wanted ? list.names : null;
  useEffect(() => {
    if (!open || !enabled || !wanted || list?.country === wanted) return;
    let live = true;
    syncApi
      .banks(config, wanted)
      .then((r) => live && setList({ country: wanted, names: r.banks.map((x) => x.name) }))
      .catch((e) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [open, enabled, wanted, config, list]);
  const q = query.trim().toLowerCase();
  const shown = (loaded ?? []).filter((n) => !q || n.toLowerCase().includes(q)).slice(0, 12);
  return (
    <View style={{ gap: Spacing.two }}>
      <View style={styles.row}>
        <ReadOnly label="Bank" value={bank || 'Not chosen yet'} />
        <Field
          label="Country (2 letters)"
          value={country}
          onChangeText={(c) => onChange(bank, c.slice(0, 2).toUpperCase())}
          autoCapitalize="characters"
          placeholder="PT"
        />
      </View>
      {open ? (
        <View style={{ gap: Spacing.two }}>
          <Field label="Find a bank" value={query} onChangeText={setQuery} placeholder="e.g. Caixa, Millennium, Santander" autoCorrect={false} />
          {loaded ? (
            shown.length ? (
              <Chips
                options={shown.map((n) => ({ id: n, label: n }))}
                value={bank}
                onChange={(n) => {
                  onChange(n, country);
                  setOpen(false);
                  setQuery('');
                }}
              />
            ) : (
              <ThemedText type="small" themeColor="textSecondary">
                No bank matches “{query}”.
              </ThemedText>
            )
          ) : (
            <ThemedText type="small" themeColor="textSecondary">
              {error ? `⚠ ${error}` : wanted ? 'Loading banks…' : 'Type a 2-letter country first.'}
            </ThemedText>
          )}
        </View>
      ) : (
        <View style={styles.row}>
          <Button label="Choose bank" kind="secondary" onPress={() => setOpen(true)} disabled={!enabled} />
        </View>
      )}
    </View>
  );
}

function BillRemindersCard() {
  const theme = useTheme();
  const { status, busy, message, turnOn, sendTest, turnOff } = useBillPush();
  const text = {
    unsupported: "This browser can't show notifications. Open the app in Chrome, Edge, Firefox or Safari.",
    'needs-install': 'On iPhone, first add the app to your home screen (Share → Add to Home Screen), open it from there, then turn reminders on.',
    blocked: 'Notifications are blocked for this site. Allow them in your browser or phone settings, then come back.',
    off: 'Off on this device.',
    on: '✓ On for this device.',
  }[status];
  return (
    <Card title="Bill reminders" subtitle="A notification at 9:00 the day before each Pay myself bill is due, so you can have the money ready. Bills you've marked paid are skipped.">
      <ThemedText type="small" themeColor="textSecondary">
        {text}
      </ThemedText>
      <View style={[styles.row, { marginTop: Spacing.two }]}>
        {status === 'off' ? <Button label={busy ? 'Turning on…' : 'Turn on reminders'} onPress={turnOn} disabled={busy} /> : null}
        {status === 'on' ? (
          <>
            <Button label={busy ? 'Sending…' : 'Send a test'} kind="secondary" onPress={sendTest} disabled={busy} />
            <Button label="Turn off" kind="secondary" onPress={turnOff} disabled={busy} />
          </>
        ) : null}
      </View>
      {message ? (
        <ThemedText type="small" style={{ color: message.error ? theme.critical : theme.textSecondary }}>
          {message.error ? '⚠ ' : ''}
          {message.text}
        </ThemedText>
      ) : null}
    </Card>
  );
}
