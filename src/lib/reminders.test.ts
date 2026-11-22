import assert from 'node:assert/strict';
import { test } from 'node:test';

import { localNow, remindersFor, type PushBill } from '../../supabase/functions/bill-reminders/reminders.ts';

const rent: PushBill = { id: 'rent', name: 'Rent', amount: 800, currency: 'EUR', dueDay: 5, startMonth: '2026-01' };

test('reminds only the day before', () => {
  assert.deepEqual(remindersFor([rent], '2026-11-04').map((r) => r.key), ['rent:2026-11-05:tomorrow']);
  assert.equal(remindersFor([rent], '2026-11-04')[0].title, 'Rent is due tomorrow');
  assert.deepEqual(remindersFor([rent], '2026-11-05'), []);
  assert.deepEqual(remindersFor([rent], '2026-11-06'), []);
});

test('skips paid months and months outside the dates', () => {
  assert.deepEqual(remindersFor([{ ...rent, paidMonths: ['2026-11'] }], '2026-11-04'), []);
  assert.deepEqual(remindersFor([{ ...rent, startMonth: '2026-12' }], '2026-11-04'), []);
  assert.deepEqual(remindersFor([{ ...rent, endMonth: '2026-10' }], '2026-11-04'), []);
});

test('a day past the month end falls on the last day, across month boundaries', () => {
  assert.deepEqual(remindersFor([{ ...rent, dueDay: 31 }], '2026-11-29').map((r) => r.key), ['rent:2026-11-30:tomorrow']);
  assert.deepEqual(remindersFor([{ ...rent, dueDay: 1 }], '2026-11-30').map((r) => r.key), ['rent:2026-12-01:tomorrow']);
});

test('variable bills say "about"', () => {
  assert.match(remindersFor([{ ...rent, variable: true }], '2026-11-04')[0].body, /about/);
});

test('localNow reads the date and hour in a time zone', () => {
  const now = new Date('2026-11-22T20:30:00Z');
  assert.deepEqual(localNow(now, 'Asia/Karachi'), { date: '2026-11-23', hour: 1 });
  assert.deepEqual(localNow(now, 'Europe/Lisbon'), { date: '2026-11-22', hour: 20 });
});
