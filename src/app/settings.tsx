import { useState } from 'react';
import { View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, Chips, Field, Screen, styles, useCategoryColor } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useBudget } from '@/lib/store';
import { useBillPush } from '@/lib/use-bill-push';
import { useRevolutSync } from '@/lib/use-revolut-sync';

const CURRENCIES = ['EUR', 'INR', 'GBP', 'USD'].map((c) => ({ id: c, label: c }));

export default function SettingsScreen() {
  const { state, updateCategory, setCurrency, resetAll, addSubcategory, renameSubcategory, deleteSubcategory } = useBudget();
  const [newSub, setNewSub] = useState<Record<string, string>>({});
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const colorFor = useCategoryColor();
  const theme = useTheme();
  const [confirmReset, setConfirmReset] = useState(false);

  return (
    <Screen title="Settings">
      <Card title="Currency" subtitle="Amounts are shown in this currency. Your Revolut account is EUR.">
        <Chips options={CURRENCIES} value={state.currency} onChange={setCurrency} />
      </Card>

      <Card
        title="Categories"
        subtitle="Rename categories and add subcategories (like Eating out under Frivolous). Whether something is recurring or one-time is set on each line, not here.">
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
      </Card>

      <RevolutSyncCard />

      <BillRemindersCard />

      <Card title="Data" subtitle="Everything is stored on this device only.">
        <View style={styles.row}>
          {confirmReset ? (
            <>
              <Button
                label="Yes, delete everything"
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

function RevolutSyncCard() {
  const theme = useTheme();
  const { config, setConfig, configured, status, busy, message, refreshStatus, connect, syncNow, lastSyncedAt } = useRevolutSync();
  const fmt = (iso: string) => new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
  const daysLeft = status?.validUntil ? Math.ceil((new Date(status.validUntil).getTime() - Date.now()) / 86400_000) : null;

  return (
    <Card title="Revolut sync" subtitle="Pulls your Revolut spending automatically through Enable Banking (EU open banking).">
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
        <Button label={busy === 'connect' ? 'Opening…' : 'Connect Revolut'} onPress={connect} disabled={!configured || !!busy} />
        <Button label={busy === 'status' ? 'Checking…' : 'Check connection'} kind="secondary" onPress={refreshStatus} disabled={!configured || !!busy} />
        <Button label={busy === 'sync' ? 'Syncing…' : 'Sync now'} kind="secondary" onPress={syncNow} disabled={!configured || !!busy} />
      </View>
      {status ? (
        <ThemedText type="small" style={{ marginTop: Spacing.two, color: status.connected ? theme.text : theme.critical }}>
          {status.connected
            ? `✓ Connected${status.accounts?.length ? ` (${status.accounts.map((a) => a.currency ?? a.name).join(', ')})` : ''}. ` +
              (daysLeft != null ? `Revolut access lasts ${daysLeft} more day${daysLeft === 1 ? '' : 's'}, then press Connect again.` : '')
            : '⚠ Not connected. Press "Connect Revolut".'}
        </ThemedText>
      ) : null}
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
