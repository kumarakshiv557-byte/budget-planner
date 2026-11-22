/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { addMonths, breakdown, categorize, typeFor, summarizeMonth, trend } from './budget.ts';
import { initialState } from './defaults.ts';
import { parseRevolutCsv } from './revolut-csv.ts';
import type { BudgetState } from './types.ts';

let n = 0;
const id = () => `id${n++}`;

function sample(): BudgetState {
  const s = initialState();
  s.items = [
    { id: 'rent', name: 'Rent', categoryId: 'essentials', type: 'recurring-fixed', amount: 800, startMonth: '2026-09' },
    { id: 'food', name: 'Groceries', categoryId: 'essentials', type: 'recurring-variable', amount: 300, startMonth: '2026-01' },
    { id: 'nf', name: 'Netflix', categoryId: 'subscriptions', type: 'recurring-fixed', amount: 12, startMonth: '2026-01', endMonth: '2026-10' },
    { id: 'tax', name: 'IRS settlement', categoryId: 'taxes', type: 'fixed-one-time', amount: 1500, startMonth: '2026-11' },
  ];
  s.transactions = [
    { id: 't1', date: '2026-11-03', description: 'Rent', amount: 800, categoryId: 'essentials', type: 'recurring-fixed', source: 'manual' },
    { id: 't2', date: '2026-11-10', description: 'Lidl', amount: 340.5, categoryId: 'essentials', type: 'recurring-variable', source: 'manual' },
    { id: 't3', date: '2026-11-12', description: 'Bar', amount: 40, categoryId: null, type: 'variable-one-time', source: 'manual' },
    { id: 't4', date: '2026-10-12', description: 'Netflix', amount: 12, categoryId: 'subscriptions', type: 'recurring-fixed', source: 'manual' },
  ];
  return s;
}

test('addMonths crosses year boundaries', () => {
  assert.equal(addMonths('2026-11', 2), '2027-01');
  assert.equal(addMonths('2026-01', -1), '2025-12');
});

test('forecast counts recurring items within range and one-time items only in their month', () => {
  const s = sample();
  const nov = summarizeMonth(s, '2026-11');
  assert.equal(nov.forecast, 800 + 300 + 1500); // Netflix ended in October
  assert.equal(nov.actual, 1180.5);
  const ess = nov.byCategory.find((r) => r.categoryId === 'essentials')!;
  assert.deepEqual([ess.forecast, ess.actual], [1100, 1140.5]);
  assert.equal(nov.byCategory.find((r) => r.categoryId === null)?.actual, 40);
  assert.equal(nov.byType.find((r) => r.type === 'fixed-one-time')?.forecast, 1500);

  const aug = summarizeMonth(s, '2026-08');
  assert.equal(aug.forecast, 300 + 12); // rent starts in September
  assert.equal(aug.byCategory.some((r) => r.categoryId === null), false);
});

test('trend returns oldest first, ending at the given month', () => {
  const t = trend(sample(), '2026-11', 3);
  assert.deepEqual(t.map((m) => m.month), ['2026-09', '2026-10', '2026-11']);
});

test('categorize prefers the longest matching rule', () => {
  const rules = [
    { match: 'uber', categoryId: 'essentials' },
    { match: 'uber eats', categoryId: 'frivolous' },
  ];
  assert.equal(categorize('UBER EATS Lisboa', rules), 'frivolous');
  assert.equal(categorize('Uber trip', rules), 'essentials');
  assert.equal(categorize('Something else', rules), null);
});

const CSV = `Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance
CARD_PAYMENT,Current,2026-11-01 10:00:00,2026-11-02 09:00:00,Netflix.com,-12.99,0.00,EUR,COMPLETED,100.00
CARD_PAYMENT,Current,2026-11-03 10:00:00,2026-11-03 11:00:00,"Pingo Doce, Lisboa",-45.10,0.00,EUR,COMPLETED,50.00
TOPUP,Current,2026-11-04 10:00:00,2026-11-04 10:00:00,Top-up by *1234,500.00,0.00,EUR,COMPLETED,550.00
TRANSFER,Current,2026-11-05 10:00:00,2026-11-05 10:00:00,Salary,2000.00,0.00,EUR,COMPLETED,2550.00
CARD_PAYMENT,Current,2026-11-06 10:00:00,,Zara,-60.00,0.00,EUR,PENDING,2490.00
ATM,Current,2026-11-07 10:00:00,2026-11-07 10:00:00,Cash at ATM,-100.00,2.00,EUR,COMPLETED,2388.00
CARD_REFUND,Current,2026-11-08 10:00:00,2026-11-08 10:00:00,Pingo Doce,5.10,0.00,EUR,COMPLETED,2393.10`;

test('Revolut CSV: keeps spending and refunds, skips top-ups, income and pending', () => {
  const s = initialState();
  const r = parseRevolutCsv(CSV, s, id);
  assert.deepEqual(
    r.transactions.map((t) => [t.date, t.description, t.amount, t.categoryId, t.type]),
    [
      ['2026-11-02', 'Netflix.com', 12.99, 'subscriptions', 'recurring-fixed'],
      ['2026-11-03', 'Pingo Doce, Lisboa', 45.1, 'essentials', 'variable-one-time'],
      ['2026-11-07', 'Cash at ATM', 102, null, 'variable-one-time'],
      ['2026-11-08', 'Pingo Doce', -5.1, 'essentials', 'variable-one-time'],
    ],
  );
  assert.equal(r.skippedOther, 3);
  assert.deepEqual(r.currencies, ['EUR']);
});

test('Revolut CSV: re-importing the same file adds nothing', () => {
  const s = initialState();
  s.transactions = parseRevolutCsv(CSV, s, id).transactions;
  const again = parseRevolutCsv(CSV, s, id);
  assert.equal(again.transactions.length, 0);
  assert.equal(again.skippedDuplicates, 4);
});

test('Revolut CSV: rejects files without the expected columns', () => {
  assert.throws(() => parseRevolutCsv('foo,bar\n1,2', initialState(), id), /Revolut statement/);
});

test('synced rows: categorised, typed and de-duplicated', async () => {
  const { mergeSynced, nextDateFrom } = await import('./sync.ts');
  const s = initialState();
  const rows = [
    { externalId: 'eb:a:1', date: '2026-11-02', description: 'Netflix.com', amount: 12.99, currency: 'EUR' },
    { externalId: 'eb:a:2', date: '2026-11-03', description: 'Some shop', amount: 20, currency: 'EUR' },
    { externalId: 'eb:a:1', date: '2026-11-02', description: 'Netflix.com', amount: 12.99, currency: 'EUR' },
  ];
  const first = mergeSynced(s, rows, id);
  assert.deepEqual(first.map((t) => [t.externalId, t.categoryId, t.type, t.source]), [
    ['eb:a:1', 'subscriptions', 'recurring-fixed', 'revolut'],
    ['eb:a:2', null, 'variable-one-time', 'revolut'],
  ]);
  s.transactions = first;
  assert.equal(mergeSynced(s, rows, id).length, 0);
  assert.equal(nextDateFrom(undefined), undefined);
  assert.equal(nextDateFrom('2026-11-20T10:00:00Z', new Date('2026-11-22T00:00:00Z')), '2026-11-15');
  assert.equal(nextDateFrom('2026-01-01T00:00:00Z', new Date('2026-11-22T00:00:00Z')), '2026-08-25');
});

test('type comes from the merchant rule, not the category', () => {
  const rules = [
    { match: 'netflix', categoryId: 'subscriptions', type: 'recurring-fixed' as const },
    { match: 'amazon', categoryId: 'subscriptions' },
  ];
  assert.equal(typeFor('NETFLIX.COM', rules), 'recurring-fixed');
  assert.equal(typeFor('Amazon Marketplace', rules), 'variable-one-time');
  assert.equal(typeFor('Unknown shop', rules), 'variable-one-time');
});

test('breakdown groups a month by category or type, biggest first', () => {
  const s = initialState();
  s.items = [
    { id: 'i1', name: 'Rent', categoryId: 'essentials', type: 'recurring-fixed', amount: 900, startMonth: '2026-01' },
    { id: 'i2', name: 'Netflix', categoryId: 'subscriptions', type: 'recurring-fixed', amount: 13, startMonth: '2026-01' },
    { id: 'i3', name: 'Old tax', categoryId: 'taxes', type: 'fixed-one-time', amount: 500, startMonth: '2026-03' },
  ];
  s.transactions = [
    { id: 't1', date: '2026-11-02', description: 'Pingo Doce', amount: 40, categoryId: 'essentials', type: 'variable-one-time', source: 'manual' },
    { id: 't2', date: '2026-11-03', description: 'Lidl', amount: 60, categoryId: 'essentials', type: 'variable-one-time', source: 'manual' },
    { id: 't3', date: '2026-11-04', description: 'ATM', amount: 20, categoryId: null, type: 'variable-one-time', source: 'manual' },
    { id: 't4', date: '2026-10-04', description: 'October', amount: 99, categoryId: null, type: 'variable-one-time', source: 'manual' },
  ];
  const cats = breakdown(s, '2026-11', 'category', 'actual');
  assert.deepEqual(cats.map((g) => [g.key, g.total, g.lines.map((l) => l.id)]), [
    ['essentials', 100, ['t2', 't1']],
    ['none', 20, ['t3']],
  ]);
  const types = breakdown(s, '2026-11', 'type', 'forecast');
  assert.deepEqual(types.map((g) => [g.key, g.total]), [['recurring-fixed', 913]]);
});
