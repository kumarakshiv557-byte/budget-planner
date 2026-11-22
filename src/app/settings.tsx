import { useState } from 'react';
import { View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, Chips, Field, Screen, styles, useCategoryColor } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useBudget } from '@/lib/store';
import { ITEM_TYPES } from '@/lib/types';

const CURRENCIES = ['EUR', 'INR', 'GBP', 'USD'].map((c) => ({ id: c, label: c }));

export default function SettingsScreen() {
  const { state, updateCategory, setCurrency, resetAll } = useBudget();
  const colorFor = useCategoryColor();
  const theme = useTheme();
  const [confirmReset, setConfirmReset] = useState(false);

  return (
    <Screen title="Settings">
      <Card title="Currency" subtitle="Amounts are shown in this currency. Your Revolut account is EUR.">
        <Chips options={CURRENCIES} value={state.currency} onChange={setCurrency} />
      </Card>

      <Card title="Categories" subtitle="Rename a category or change the type new items in it get by default.">
        {state.categories.map((c) => (
          <View key={c.id} style={{ gap: Spacing.two, paddingVertical: Spacing.three, borderTopWidth: 1, borderColor: theme.border }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two }}>
              <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: colorFor(c) }} />
              <Field label="Name" value={c.name} onChangeText={(name) => updateCategory(c.id, { name })} />
            </View>
            <Chips options={ITEM_TYPES} value={c.defaultType} onChange={(defaultType) => updateCategory(c.id, { defaultType })} />
          </View>
        ))}
      </Card>

      <Card title="Revolut sync" subtitle="Coming next">
        <ThemedText type="small" themeColor="textSecondary">
          Automatic sync with your Portuguese Revolut account will use Enable Banking, an EU open-banking provider. Until then,
          import a CSV statement on the Spending tab.
        </ThemedText>
      </Card>

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
