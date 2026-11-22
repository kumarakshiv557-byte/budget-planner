import { Platform, Pressable, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Button, Card, useCategoryColor, useMoney } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { billsCalendar, billsFor, currentMonth } from '@/lib/budget';
import { downloadCalendar } from '@/lib/calendar-file';
import { useBudget } from '@/lib/store';
import type { Month } from '@/lib/types';

function when(daysLeft: number) {
  if (daysLeft === 0) return 'due today';
  if (daysLeft === 1) return 'due tomorrow';
  if (daysLeft > 1) return `due in ${daysLeft} days`;
  return daysLeft === -1 ? 'was due yesterday' : `was due ${-daysLeft} days ago`;
}

/** Overview card: this month's "Pay myself" bills, with mark-as-paid and calendar reminders. */
export function BillsCard({ month }: { month: Month }) {
  const { state, setBillPaid } = useBudget();
  const theme = useTheme();
  const money = useMoney();
  const colorFor = useCategoryColor();
  const bills = billsFor(state, month);
  if (!bills.length) return null;
  const isNow = month === currentMonth();
  const left = bills.filter((b) => !b.paid);

  const addToCalendar = () => downloadCalendar(billsCalendar(state.items, state.currency), 'bill-reminders.ics');

  return (
    <Card
      title="Bills to pay"
      subtitle={
        left.length
          ? `${left.length} of ${bills.length} still to pay · ${money(left.reduce((s, b) => s + b.item.amount, 0))}`
          : 'All paid for this month ✓'
      }>
      {bills.map((b) => {
        const late = isNow && !b.paid && b.daysLeft < 0;
        const soon = isNow && !b.paid && b.daysLeft >= 0 && b.daysLeft <= 3;
        return (
          <View key={b.item.id} style={{ flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.two, borderTopWidth: 1, borderColor: theme.border }}>
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colorFor(state.categories.find((c) => c.id === b.item.categoryId)) }} />
            <View style={{ flex: 1, opacity: b.paid ? 0.55 : 1 }}>
              <ThemedText type="small" style={b.paid ? { textDecorationLine: 'line-through' } : undefined}>
                {b.item.name} · {b.item.type === 'recurring-variable' ? '~' : ''}
                {money(b.item.amount)}
              </ThemedText>
              <ThemedText
                type="small"
                style={{ color: late ? theme.critical : soon ? theme.text : theme.textSecondary, fontWeight: late || soon ? '600' : '400' }}>
                {b.paid ? 'Paid' : `${b.due.slice(8).replace(/^0/, '')} ${new Date(`${b.due}T00:00:00`).toLocaleString('en-GB', { month: 'short' })}${isNow ? ` · ${when(b.daysLeft)}` : ''}`}
              </ThemedText>
            </View>
            <Pressable
              onPress={() => setBillPaid(b.item.id, month, !b.paid)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: b.paid }}
              accessibilityLabel={`${b.item.name} paid`}
              style={{ paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1, borderColor: b.paid ? theme.good : theme.border }}>
              <ThemedText type="small" style={{ color: b.paid ? theme.good : theme.text }}>
                {b.paid ? '✓ Paid' : 'Mark paid'}
              </ThemedText>
            </Pressable>
          </View>
        );
      })}
      {Platform.OS === 'web' ? (
        <View style={{ marginTop: Spacing.two, gap: Spacing.one }}>
          <Button label="Add reminders to my calendar" kind="secondary" onPress={addToCalendar} />
          <ThemedText type="small" themeColor="textSecondary">
            Downloads a calendar file with a monthly reminder at 9:00 on the day each bill is due. Open it to add the reminders to your phone
            calendar. Do it again after you add or change a bill.
          </ThemedText>
        </View>
      ) : null}
    </Card>
  );
}
