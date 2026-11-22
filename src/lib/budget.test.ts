/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { addMonths, breakdown, matchRule, recategorizeIn, ruleFrom, moneyFlow, categorize, typeFor, summarizeMonth, trend } from './budget.ts';
import { initialState, migrate } from './defaults.ts';
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

test('Revolut CSV: keeps spending, refunds and income, skips top-ups and pending', () => {
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
  assert.equal(r.skippedOther, 2);
  assert.deepEqual(r.income.map((t) => [t.date, t.description, t.amount]), [['2026-11-05', 'Salary', 2000]]);
  assert.deepEqual(r.currencies, ['EUR']);
});

test('Revolut CSV: re-importing the same file adds nothing', () => {
  const s = initialState();
  const first = parseRevolutCsv(CSV, s, id);
  s.transactions = first.transactions;
  s.income = first.income;
  const again = parseRevolutCsv(CSV, s, id);
  assert.equal(again.transactions.length + again.income.length, 0);
  assert.equal(again.skippedDuplicates, 5);
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

test('money flow: income → month → categories (+ left over) → types', () => {
  const s = initialState();
  s.income = [
    { id: 'i1', date: '2026-11-01', description: 'Employer Lda', amount: 2000, source: 'manual' },
    { id: 'i2', date: '2026-11-15', description: 'Friend', amount: 50, source: 'manual' },
  ];
  s.transactions = [
    { id: 't1', date: '2026-11-02', description: 'Pingo Doce', amount: 100, categoryId: 'essentials', type: 'variable-one-time', source: 'manual' },
    { id: 't2', date: '2026-11-03', description: 'Rent', amount: 900, categoryId: 'essentials', type: 'recurring-fixed', source: 'manual' },
    { id: 't3', date: '2026-11-04', description: 'Netflix', amount: 13, categoryId: 'subscriptions', type: 'recurring-fixed', source: 'manual' },
  ];
  const f = moneyFlow(s, '2026-11');
  assert.equal(f.income, 2050);
  assert.equal(f.spent, 1013);
  assert.deepEqual(f.nodes.map((n) => [n.id, n.value]), [
    ['in:Employer Lda', 2000],
    ['in:Friend', 50],
    ['total', 2050],
    ['cat:essentials', 1000],
    ['cat:subscriptions', 13],
    ['leftover', 1037],
    ['type:recurring-fixed', 913],
    ['type:variable-one-time', 100],
  ]);

  s.income = [];
  const g = moneyFlow(s, '2026-11');
  assert.deepEqual(g.nodes.filter((n) => n.column === 0).map((n) => [n.id, n.value]), [['gap', 1013]]);
  assert.ok(!g.nodes.some((n) => n.id === 'leftover'));
});

test('ruleFrom drops payment-processor prefixes and keeps the distinctive word', () => {
  assert.equal(ruleFrom('Raz*zomato Online Order'), 'zomato');
  assert.equal(ruleFrom('Pyu*zomato Limited'), 'zomato');
  assert.equal(ruleFrom('Paypal *itunesappst Apple'), 'itunesappst');
  assert.equal(ruleFrom('PINGO DOCE LISBOA 123'), 'pingo');
  assert.equal(ruleFrom('Uber trip 22'), 'uber trip');
});

test('recategorize with remember sorts the other unsorted rows from the same merchant', () => {
  const s = initialState();
  const tx = (id: string, description: string, categoryId: string | null = null) =>
    ({ id, date: '2026-11-10', description, amount: 5, categoryId, type: 'variable-one-time', source: 'revolut' }) as const;
  s.rules = [];
  s.transactions = [tx('a', 'Raz*zomato Online Order'), tx('b', 'Pyu*zomato Limited'), tx('c', 'Zomato', 'essentials'), tx('d', 'Lidl')];
  const out = recategorizeIn(s, 'a', 'frivolous', 'eating-out', true);
  assert.deepEqual(
    out.transactions.map((t) => [t.id, t.categoryId, t.subcategoryId]),
    [['a', 'frivolous', 'eating-out'], ['b', 'frivolous', 'eating-out'], ['c', 'essentials', undefined], ['d', null, undefined]],
  );
  assert.deepEqual(out.rules, [{ match: 'zomato', categoryId: 'frivolous', subcategoryId: 'eating-out' }]);
  const once = recategorizeIn(s, 'a', 'frivolous', undefined, false);
  assert.equal(once.transactions.find((t) => t.id === 'b')!.categoryId, null);
});

test('migrate adds the eating-out subcategory to old data and sorts what its rules recognise', () => {
  const old = initialState() as Partial<ReturnType<typeof initialState>>;
  delete old.subcategories;
  delete old.dataVersion;
  old.rules = [{ match: 'netflix', categoryId: 'subscriptions' }, { match: 'cafe', categoryId: 'frivolous' }];
  old.transactions = [
    { id: 'z', date: '2026-11-17', description: 'Raz*zomato Online Order', amount: 7, categoryId: null, type: 'variable-one-time', source: 'revolut' },
    { id: 'n', date: '2026-11-17', description: 'Something else', amount: 7, categoryId: null, type: 'variable-one-time', source: 'revolut' },
  ];
  const s = migrate(old);
  assert.deepEqual(s.subcategories.map((c) => c.name), ['Eating out / food delivery', 'Subscriptions']);
  assert.equal(s.rules.find((r) => r.match === 'cafe')!.subcategoryId, 'eating-out');
  assert.deepEqual(s.transactions.map((t) => [t.categoryId, t.subcategoryId]), [['frivolous', 'eating-out'], [null, undefined]]);
  // already-migrated data is left alone
  assert.equal(migrate(s).rules.length, s.rules.length);
});

test('migrate puts every iTunes, Spotify and YouTube payment in Frivolous › Subscriptions, recurring fixed', () => {
  const s = migrate(initialState());
  const old = { ...s, dataVersion: 1, rules: [...s.rules, { match: 'itunesappst', categoryId: 'frivolous' }] };
  old.transactions = [
    { id: 'a', date: '2026-11-16', description: 'Paypal *itunesappst Apple', amount: 10, categoryId: 'frivolous', subcategoryId: 'eating-out', type: 'variable-one-time', source: 'revolut' },
    { id: 'b', date: '2026-11-16', description: 'Spotify P2C1', amount: 11, categoryId: null, type: 'variable-one-time', source: 'revolut' },
    { id: 'c', date: '2026-11-16', description: 'Google *YouTube Premium', amount: 12, categoryId: 'essentials', type: 'variable-one-time', source: 'revolut' },
    { id: 'd', date: '2026-11-16', description: 'Lidl', amount: 13, categoryId: 'essentials', type: 'variable-one-time', source: 'revolut' },
  ];
  const m = migrate(old);
  assert.deepEqual(m.transactions.map((t) => [t.id, t.categoryId, t.subcategoryId, t.type]), [
    ['a', 'frivolous', 'frivolous-subscriptions', 'recurring-fixed'],
    ['b', 'frivolous', 'frivolous-subscriptions', 'recurring-fixed'],
    ['c', 'frivolous', 'frivolous-subscriptions', 'recurring-fixed'],
    ['d', 'essentials', undefined, 'variable-one-time'],
  ]);
  assert.equal(m.rules.find((r) => r.match === 'itunesappst')!.subcategoryId, 'frivolous-subscriptions');
  assert.equal(matchRule('Paypal *itunesappst Apple', m.rules)!.subcategoryId, 'frivolous-subscriptions');
  assert.equal(m.subcategories.filter((x) => x.id === 'frivolous-subscriptions').length, 1);
  assert.equal(m.dataVersion, 2);
  // runs once: a later manual change sticks
  const edited = { ...m, transactions: m.transactions.map((t) => (t.id === 'c' ? { ...t, categoryId: 'frivolous' } : t)) };
  assert.equal(migrate(edited).transactions.find((t) => t.id === 'c')!.categoryId, 'frivolous');
});
