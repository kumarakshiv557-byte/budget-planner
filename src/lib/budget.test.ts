/// <reference types="node" />
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { addMonths, billsCalendar, forPerson, incomeIn, billsFor, breakdown, matchRule, recategorizeIn, resortIn, ruleFrom, sortIn, sortedAlike, subscriptionsTotal, unsortIn, moneyFlow, categorize, typeFor, summarizeMonth, trend, transferRuleFrom, markTransferIn, unmarkTransferIn, recentlySorted } from './budget.ts';
import { DATA_VERSION, initialState, migrate } from './defaults.ts';
import { parseRevolutCsv } from './revolut-csv.ts';
import { applyTransfers, findSyncedTransfers, mergeSynced, mergeSyncedIncome } from './sync.ts';
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
      ['2026-11-02', 'Netflix.com', 12.99, 'frivolous', 'recurring-fixed'],
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
  assert.deepEqual(first.map((t) => [t.externalId, t.categoryId, t.type, t.payment, t.source]), [
    ['eb:a:1', 'frivolous', 'recurring-fixed', 'auto', 'revolut'],
    ['eb:a:2', null, 'variable-one-time', undefined, 'revolut'],
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
  assert.equal(ruleFrom('ANUL.TRF.IMED.   P/ Altura Nova Consulting Unip Ld'), 'altura nova');
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

test('migrate adds the eating-out subcategory to old data', () => {
  const old = initialState() as Partial<ReturnType<typeof initialState>>;
  delete old.subcategories;
  delete old.dataVersion;
  old.rules = [{ match: 'netflix', categoryId: 'subscriptions' }, { match: 'cafe', categoryId: 'frivolous' }];
  old.transactions = [
    { id: 'z', date: '2026-11-17', description: 'Raz*zomato Online Order', amount: 7, categoryId: null, type: 'variable-one-time', source: 'revolut' },
    { id: 'n', date: '2026-11-17', description: 'Something else', amount: 7, categoryId: null, type: 'variable-one-time', source: 'revolut' },
  ];
  const s = migrate(old);
  assert.deepEqual(s.subcategories.map((c) => c.name), ['Eating out / food delivery']);
  assert.ok(!s.categories.some((c) => c.id === 'subscriptions'));
  assert.equal(s.rules.find((r) => r.match === 'cafe')!.subcategoryId, 'eating-out');
  // already-migrated data is left alone
  assert.equal(migrate(s).rules.length, s.rules.length);
});

test('migrate retires the Subscriptions category', () => {
  const old = { ...initialState(), dataVersion: 1 } as ReturnType<typeof initialState>;
  old.categories = [...old.categories, { id: 'subscriptions', name: 'Subscriptions', color: '#1baf7a', colorDark: '#199e70' }];
  old.rules = [...old.rules, { match: 'itunesappst', categoryId: 'essentials' }, { match: 'patreon', categoryId: 'subscriptions' }];
  old.items = [{ id: 'i', name: 'Gym', categoryId: 'subscriptions', type: 'recurring-fixed', amount: 30, startMonth: '2026-01' }];
  old.transactions = [
    { id: 'a', date: '2026-11-16', description: 'Paypal *itunesappst Apple', amount: 10, categoryId: 'frivolous', subcategoryId: 'eating-out', type: 'variable-one-time', source: 'revolut' },
    { id: 'b', date: '2026-11-16', description: 'Spotify P2C1', amount: 11, categoryId: null, type: 'variable-one-time', source: 'revolut' },
    { id: 'c', date: '2026-11-16', description: 'Patreon', amount: 5, categoryId: 'subscriptions', type: 'recurring-fixed', source: 'revolut' },
    { id: 'd', date: '2026-11-16', description: 'Lidl', amount: 13, categoryId: 'essentials', type: 'variable-one-time', source: 'revolut' },
  ];
  const m = migrate(old);
  assert.ok(!m.categories.some((c) => c.id === 'subscriptions'));
  assert.deepEqual([m.items[0].categoryId, m.items[0].payment], ['frivolous', 'auto']);
  assert.equal(m.dataVersion, DATA_VERSION);
});

test('version 3 adds Work and resets every sorting pick and learned rule, once', () => {
  const old = { ...initialState(), dataVersion: 2 } as ReturnType<typeof initialState>;
  old.categories = old.categories.filter((c) => c.id !== 'work');
  old.rules = [...old.rules, { match: 'patreon', categoryId: 'frivolous', type: 'recurring-fixed', payment: 'auto' }];
  old.items = [{ id: 'i', name: 'Rent', categoryId: 'essentials', type: 'recurring-fixed', payment: 'manual', amount: 800, startMonth: '2026-01' }];
  old.transactions = [
    { id: 'a', date: '2026-11-16', description: 'Zomato', amount: 10, categoryId: 'frivolous', subcategoryId: 'eating-out', type: 'recurring-fixed', payment: 'auto', source: 'revolut' },
    { id: 'b', date: '2026-11-16', description: 'Lidl', amount: 13, categoryId: 'essentials', type: 'variable-one-time', source: 'manual' },
  ];
  const m = migrate(old);
  assert.ok(m.categories.some((c) => c.id === 'work' && c.name === 'Work'));
  assert.deepEqual(m.transactions.map((t) => [t.id, t.categoryId, t.subcategoryId, t.type, t.payment]), [
    ['a', null, undefined, 'variable-one-time', undefined],
    ['b', null, undefined, 'variable-one-time', undefined],
  ]);
  assert.ok(!m.rules.some((r) => r.match === 'patreon'));
  assert.equal(m.items[0].payment, 'manual');
  assert.equal(m.dataVersion, DATA_VERSION);
  const sorted = { ...m, transactions: m.transactions.map((t) => ({ ...t, categoryId: 'work' })) };
  assert.equal(migrate(sorted).transactions[0].categoryId, 'work');
});

test('sorting with a type: Subscription sets recurring fixed + auto and is remembered for the merchant', () => {
  const s = initialState();
  s.rules = [];
  const tx = (id: string, description: string) =>
    ({ id, date: '2026-11-10', description, amount: 5, categoryId: null, type: 'variable-one-time', source: 'revolut' }) as const;
  s.transactions = [tx('a', 'Patreon* Membership'), tx('b', 'Patreon* Membership'), tx('c', 'Lidl')];
  const out = sortIn(s, 'a', { categoryId: 'frivolous', type: 'recurring-fixed', payment: 'auto' }, true);
  assert.deepEqual(out.transactions.map((t) => [t.id, t.categoryId, t.type, t.payment]), [
    ['a', 'frivolous', 'recurring-fixed', 'auto'],
    ['b', 'frivolous', 'recurring-fixed', 'auto'],
    ['c', null, 'variable-one-time', undefined],
  ]);
  assert.equal(typeFor('Patreon* Membership', out.rules), 'recurring-fixed');
  assert.equal(matchRule('Patreon* Membership', out.rules)!.payment, 'auto');
  // a one-time type drops any payment tag
  const once = sortIn(out, 'a', { categoryId: 'work', type: 'fixed-one-time', payment: 'auto' }, false);
  assert.equal(once.transactions[0].payment, undefined);
});

test('a note is remembered for the merchant and labels the other payments from there', () => {
  const s = initialState();
  s.rules = [];
  const tx = (id: string, description: string) =>
    ({ id, date: '2026-11-10', description, amount: 5, categoryId: null, type: 'variable-one-time', source: 'revolut' }) as const;
  s.transactions = [tx('a', 'Wework Lisboa'), tx('b', 'Wework Lisboa'), tx('c', 'Lidl')];
  const out = sortIn(s, 'a', { categoryId: 'work', type: 'recurring-fixed', note: '  Desk rent  ' }, true);
  assert.deepEqual(out.transactions.map((t) => t.note), ['Desk rent', 'Desk rent', undefined]);
  assert.equal(matchRule('WEWORK LISBOA 12', out.rules)!.note, 'Desk rent');
  // sorting again without a note keeps the remembered one
  assert.equal(sortIn(out, 'a', { categoryId: 'work', type: 'recurring-fixed' }, true).rules.find((r) => r.match === 'wework')!.note, 'Desk rent');
});

test('bills: Pay-myself items for a month, with due dates and paid state', () => {
  const s = initialState();
  s.items = [
    { id: 'rent', name: 'Rent', categoryId: 'essentials', type: 'recurring-fixed', amount: 900, startMonth: '2026-01', payment: 'manual', dueDay: 1, paidMonths: ['2026-11'] },
    { id: 'phone', name: 'Phone', categoryId: 'utilities', type: 'recurring-fixed', amount: 20, startMonth: '2026-01', payment: 'manual', dueDay: 31 },
    { id: 'spot', name: 'Spotify', categoryId: 'frivolous', type: 'recurring-fixed', amount: 11, startMonth: '2026-01', payment: 'auto' },
  ];
  const b = billsFor(s, '2026-11', new Date(2026, 10, 22));
  assert.deepEqual(b.map((x) => [x.item.id, x.due, x.daysLeft, x.paid]), [
    ['phone', '2026-11-30', 8, false],
    ['rent', '2026-11-01', -21, true],
  ]);
});

test('bills calendar: one monthly event with a day-before alert per Pay-myself bill', () => {
  const ics = billsCalendar(
    [
      { id: 'rent', name: 'Rent', categoryId: 'essentials', type: 'recurring-fixed', amount: 900, startMonth: '2026-01', payment: 'manual', dueDay: 5 },
      { id: 'card', name: 'Card bill', categoryId: 'essentials', type: 'recurring-fixed', amount: 50, startMonth: '2026-01', endMonth: '2027-02', payment: 'manual', dueDay: 31 },
      { id: 'spot', name: 'Spotify', categoryId: 'frivolous', type: 'recurring-fixed', amount: 11, startMonth: '2026-01', payment: 'auto' },
    ],
    'EUR',
    new Date(2026, 10, 22),
  );
  assert.equal(ics.match(/BEGIN:VEVENT/g)!.length, 2);
  assert.match(ics, /DTSTART;VALUE=DATE:20261105\r\nRRULE:FREQ=MONTHLY;BYMONTHDAY=5\r\nSUMMARY:Pay Rent \(€900\\,00\)|SUMMARY:Pay Rent/);
  assert.match(ics, /DTSTART;VALUE=DATE:20261130\r\nRRULE:FREQ=MONTHLY;BYMONTHDAY=-1;UNTIL=20270228/);
  assert.match(ics, /TRIGGER:PT9H/);
  assert.ok(!ics.includes('Spotify'));
});

test('subscriptions stay out of the pie charts but flow into their category and type in the Sankey', () => {
  const s = initialState();
  const tx = (id: string, amount: number, categoryId: string, payment?: 'auto' | 'manual') =>
    ({ id, date: '2026-11-10', description: id, amount, categoryId, type: payment ? 'recurring-fixed' : 'variable-one-time', ...(payment ? { payment } : {}), source: 'revolut' }) as const;
  s.transactions = [tx('spotify', 11, 'frivolous', 'auto'), tx('zara', 40, 'frivolous'), tx('rent', 800, 'essentials', 'manual')];
  s.income = [{ id: 'i', date: '2026-11-01', description: 'Salary', amount: 1000, source: 'revolut' }];
  assert.equal(subscriptionsTotal(s, '2026-11', 'actual'), 11);
  const pie = breakdown(s, '2026-11', 'category', 'actual');
  assert.deepEqual(pie.map((g) => [g.key, g.total]), [['essentials', 800], ['frivolous', 40]]);
  const flow = moneyFlow(s, '2026-11');
  assert.ok(!flow.nodes.some((n) => n.id === 'subscriptions'));
  assert.equal(flow.nodes.find((n) => n.id === 'cat:frivolous')!.value, 51);
  assert.deepEqual(flow.links.filter((l) => l.source === 'cat:frivolous').map((l) => [l.target, l.value]), [['type:recurring-fixed', 11], ['type:variable-one-time', 40]]);
  assert.equal(flow.nodes.find((n) => n.id === 'leftover')!.value, 149);
});

test('fixing a wrongly sorted payment also fixes the ones sorted alike and the remembered pick', () => {
  const s = initialState();
  s.rules = [{ match: 'zomato', categoryId: 'essentials', type: 'recurring-fixed' }];
  const tx = (id: string, description: string, categoryId: string | null, type: 'recurring-fixed' | 'variable-one-time') =>
    ({ id, date: '2026-11-10', description, amount: 5, categoryId, type, source: 'revolut' }) as const;
  s.transactions = [
    tx('a', 'Raz*zomato Online Order', 'essentials', 'recurring-fixed'),
    tx('b', 'Pyu*zomato Limited', 'essentials', 'recurring-fixed'),
    tx('c', 'Zomato', 'frivolous', 'variable-one-time'), // sorted differently by hand: left alone
    tx('d', 'Lidl', 'essentials', 'recurring-fixed'),
  ];
  assert.deepEqual(sortedAlike(s, s.transactions[0]).map((t) => t.id), ['b']);
  const fixed = { ...s.transactions[0], categoryId: 'frivolous', subcategoryId: 'eating-out', type: 'variable-one-time' as const, note: 'Late dinner' };
  const out = resortIn(s, fixed, true);
  assert.deepEqual(out.transactions.map((t) => [t.id, t.categoryId, t.subcategoryId, t.type]), [
    ['a', 'frivolous', 'eating-out', 'variable-one-time'],
    ['b', 'frivolous', 'eating-out', 'variable-one-time'],
    ['c', 'frivolous', undefined, 'variable-one-time'],
    ['d', 'essentials', undefined, 'recurring-fixed'],
  ]);
  assert.deepEqual(matchRule('Zomato order', out.rules), { match: 'zomato', categoryId: 'frivolous', subcategoryId: 'eating-out', type: 'variable-one-time', note: 'Late dinner' });
  // a remark stays on its own payment and is never remembered
  const remarked = resortIn(s, { ...fixed, remark: 'Split with Ana' }, true);
  assert.deepEqual(remarked.transactions.map((t) => t.remark), ['Split with Ana', undefined, undefined, undefined]);
  assert.equal('remark' in (matchRule('Zomato order', remarked.rules) ?? {}), false);
  // only this one
  assert.equal(resortIn(s, fixed, false).transactions[1].categoryId, 'essentials');
  // back to "to sort", forgetting the remembered pick
  const back = unsortIn(s, 'a', true);
  assert.deepEqual(back.transactions.map((t) => t.categoryId), [null, null, 'frivolous', 'essentials']);
  assert.equal(matchRule('Zomato order', back.rules), null);
});

test('household: each person sees their own lines; monthly income repeats until it stops', () => {
  const s = sample();
  s.transactions[1] = { ...s.transactions[1], owner: 'wife' };
  s.items[0] = { ...s.items[0], owner: 'mom' };
  s.income = [
    { id: 'sal', date: '2026-09-28', description: "Mom's salary", amount: 900, source: 'manual', owner: 'mom', monthly: true, endMonth: '2026-11' },
    { id: 'gift', date: '2026-11-03', description: 'Gift', amount: 50, source: 'manual' },
  ];
  assert.deepEqual(forPerson(s, 'wife').transactions.map((t) => t.id), ['t2']);
  assert.deepEqual(forPerson(s, 'me').transactions.map((t) => t.id), ['t1', 't3', 't4']);
  assert.deepEqual(forPerson(s, 'mom').items.map((i) => i.id), ['rent']);
  assert.equal(forPerson(s, 'all'), s);
  assert.deepEqual(incomeIn(s.income, '2026-11').map((i) => [i.id, i.date]), [['sal', '2026-11-28'], ['gift', '2026-11-03']]);
  assert.deepEqual(incomeIn(s.income, '2026-08'), []);
  assert.deepEqual(incomeIn(s.income, '2026-12'), []);
  assert.equal(moneyFlow(forPerson(s, 'mom'), '2026-10').income, 900);
});

test('sync: transfers between your accounts are taken out and never come back; lines keep whose account they came from', () => {
  const s = sample();
  s.transactions.push({ id: 'old', date: '2026-11-10', description: 'To Ana', amount: 500, categoryId: null, type: 'variable-one-time', source: 'revolut', externalId: 'eb:me:x1' });
  const next = { ...s, ...applyTransfers(s, ['eb:me:x1', 'eb:wife:y1']) };
  assert.equal(next.transactions.some((t) => t.id === 'old'), false);
  const rows = [
    { externalId: 'eb:wife:y1', date: '2026-11-11', description: 'From partner', amount: 500, currency: 'EUR', owner: 'wife' },
    { externalId: 'eb:wife:y2', date: '2026-11-12', description: 'Pingo Doce', amount: 30, currency: 'EUR', owner: 'wife' },
  ];
  const added = mergeSynced(next, rows, id);
  assert.deepEqual(added.map((t) => [t.description, t.owner]), [['Pingo Doce', 'wife']]);
  assert.deepEqual(mergeSyncedIncome(next, rows, id).map((t) => t.description), ['Pingo Doce']);
});

test('a payment marked as a transfer is left out, remembered and can be undone', () => {
  assert.equal(transferRuleFrom('TRF.IMED.  P/ Akshiv Kumar-E41057871'), 'p/ akshiv kumar');
  assert.equal(transferRuleFrom('To Savings 123'), 'to savings');
  const tx = (id: string, description: string, extra = {}) =>
    ({ id, date: '2026-11-23', description, amount: 50, categoryId: null, type: 'variable-one-time' as const, source: 'revolut' as const, externalId: `eb:w:${id}`, owner: 'wife', ...extra });
  const s: BudgetState = {
    ...initialState(),
    transactions: [tx('a', 'TRF.IMED.  P/ Akshiv Kumar-E41057871'), tx('b', 'TRF.IMED. P/ Akshiv Kumar-E4999'), tx('c', 'COMPRA VECC VETERINARY')],
  };
  const out = markTransferIn(s, 'a', true);
  assert.deepEqual(out.transactions.map((t) => t.id), ['c']);
  assert.deepEqual(out.transferIds, ['eb:w:a', 'eb:w:b']);
  assert.deepEqual(out.transferRules, ['p/ akshiv kumar']);
  // Future syncs skip it.
  const later = mergeSynced(out, [{ externalId: 'eb:w:z', date: '2026-11-30', description: 'TRF.IMED. P/ AKSHIV KUMAR-E5', amount: 20, currency: 'EUR', owner: 'wife' }], () => 'n');
  assert.equal(later.length, 0);
  const back = unmarkTransferIn(out, s.transactions.slice(0, 2), 'p/ akshiv kumar');
  assert.equal(back.transactions.length, 3);
  assert.deepEqual(back.transferIds, []);
  assert.deepEqual(back.transferRules, []);
  // Without remember, only that one line goes.
  assert.deepEqual(markTransferIn(s, 'a', false).transactions.map((t) => t.id), ['b', 'c']);
});

test('transfer sides that arrived on different syncs are paired', () => {
  const s: BudgetState = {
    ...initialState(),
    transactions: [
      { id: 'a', date: '2026-11-23', description: 'TRF P/ Me', amount: 50, categoryId: null, type: 'variable-one-time', source: 'revolut', externalId: 'eb:santander:1', owner: 'wife' },
      { id: 'b', date: '2026-11-23', description: 'Groceries', amount: 50, categoryId: 'essentials', type: 'variable-one-time', source: 'revolut', externalId: 'eb:santander:2', owner: 'wife' },
    ],
    income: [{ id: 'i', date: '2026-11-24', description: 'Wife', amount: 50, source: 'revolut', externalId: 'eb:revolut:9' }],
  };
  // Only the unsorted line pairs; the sorted one is left alone.
  assert.deepEqual(findSyncedTransfers(s, new Date('2026-11-25')), ['eb:santander:1', 'eb:revolut:9']);
});

test('server copy: push, adopt or keep the newer one', async () => {
  const { decide } = await import('./cloud.ts');
  assert.equal(decide({ version: 0, dirty: true }, 0), 'push'); // first device uploads
  assert.equal(decide({ version: 0, dirty: false }, 4), 'adopt'); // new device takes the server copy
  assert.equal(decide({ version: 0, dirty: true }, 4), 'conflict'); // second device with its own data: server wins, own copy kept
  assert.equal(decide({ version: 4, dirty: true }, 4), 'push');
  assert.equal(decide({ version: 4, dirty: false }, 4), 'none');
  assert.equal(decide({ version: 4, dirty: false }, 6), 'adopt');
});

test('spending lines no longer use one-time fixed', () => {
  const s = migrate({
    dataVersion: 3,
    transactions: [{ id: 't', date: '2026-11-01', description: 'IRS', amount: 300, categoryId: 'taxes', type: 'fixed-one-time', source: 'manual' }],
    rules: [{ match: 'irs', categoryId: 'taxes', type: 'fixed-one-time' }],
    items: [{ id: 'b', name: 'Yearly tax', amount: 300, categoryId: 'taxes', type: 'fixed-one-time' } as BudgetState['items'][number]],
  });
  assert.equal(s.transactions[0].type, 'variable-one-time');
  assert.equal(s.rules[0].type, 'variable-one-time');
  assert.equal(s.items[0].type, 'fixed-one-time'); // budget items keep "planned"
});

test('recently sorted lists hand-sorted and fixed lines newest first', () => {
  const tx = (id: string, date: string, description: string) => ({ id, date, description, amount: 5, categoryId: null, type: 'variable-one-time' as const, source: 'revolut' as const });
  let s: BudgetState = { ...initialState(), rules: [], transactions: [tx('old', '2026-11-20', 'Old cafe'), tx('a', '2026-11-01', 'Lidl'), tx('b', '2026-11-02', 'Lidl'), tx('c', '2026-11-03', 'Bolt')] };
  s = { ...s, transactions: s.transactions.map((t) => (t.id === 'old' ? { ...t, categoryId: 'frivolous' } : t)) };
  s = sortIn(s, 'a', { categoryId: 'essentials', type: 'variable-one-time' }, true, '2026-11-23T10:00:00Z');
  assert.equal(s.transactions.find((t) => t.id === 'b')?.sortedAt, '2026-11-23T10:00:00Z');
  assert.equal(s.transactions.find((t) => t.id === 'c')?.sortedAt, undefined);
  s = resortIn(s, { ...s.transactions.find((t) => t.id === 'b')!, categoryId: 'frivolous' }, false, '2026-11-23T11:00:00Z');
  assert.deepEqual(recentlySorted(s.transactions).map((t) => t.id), ['b', 'a', 'old']);
  s = unsortIn(s, 'b', false);
  assert.equal(s.transactions.find((t) => t.id === 'b')?.sortedAt, undefined);
  assert.deepEqual(recentlySorted(s.transactions).map((t) => t.id), ['a', 'old']);
});

test('bank details are added to lines that lack them, never overwritten', async () => {
  const { detailsFor } = await import('./sync.ts');
  const s: BudgetState = { ...initialState(), transactions: [
    { id: '1', date: '2026-11-01', description: 'A', amount: 1, categoryId: null, type: 'variable-one-time', source: 'revolut', externalId: 'eb:x:1' },
    { id: '2', date: '2026-11-01', description: 'B', amount: 1, categoryId: null, type: 'variable-one-time', source: 'revolut', externalId: 'eb:x:2', details: { kind: 'Old' } },
  ] };
  const rows = [
    { externalId: 'eb:x:1', date: '2026-11-01', description: 'A', amount: 1, currency: 'EUR', details: { kind: 'Card payment' } },
    { externalId: 'eb:x:2', date: '2026-11-01', description: 'B', amount: 1, currency: 'EUR', details: { kind: 'New' } },
  ];
  assert.deepEqual(detailsFor(s, rows), { 'eb:x:1': { kind: 'Card payment' } });
});

test('money flow over several months adds up income and spending', async () => {
  const { monthsBetween, rangeLabel } = await import('./budget.ts');
  assert.deepEqual(monthsBetween('2026-11', '2026-09'), ['2026-09', '2026-10', '2026-11']);
  assert.equal(rangeLabel(['2026-06', '2026-11']), 'Jun – Nov 2026');
  const s: BudgetState = { ...initialState(), items: [], income: [
    { id: 'i1', date: '2026-10-01', description: 'Salary', amount: 1000, source: 'manual' },
    { id: 'i2', date: '2026-11-01', description: 'Salary', amount: 1000, source: 'manual' },
  ], transactions: [
    { id: 't1', date: '2026-10-05', description: 'Lidl', amount: 100, categoryId: 'essentials', type: 'variable-one-time', source: 'manual' },
    { id: 't2', date: '2026-11-05', description: 'Lidl', amount: 50, categoryId: 'essentials', type: 'variable-one-time', source: 'manual' },
    { id: 't3', date: '2026-08-05', description: 'Old', amount: 999, categoryId: 'essentials', type: 'variable-one-time', source: 'manual' },
  ] };
  const f = moneyFlow(s, monthsBetween('2026-10', '2026-11'));
  assert.equal(f.income, 2000);
  assert.equal(f.spent, 150);
  assert.equal(moneyFlow(s, '2026-11').spent, 50);
});

test('income tags are remembered per sender and used for new lines and the money flow', async () => {
  const { tagIncomeIn, tagNewIncome, incomeTagsOf } = await import('./budget.ts');
  const inc = (id: string, date: string, description: string, amount: number) => ({ id, date, description, amount, source: 'revolut' as const });
  let s: BudgetState = { ...initialState(), items: [], transactions: [], income: [
    inc('a', '2026-11-01', 'ACME LDA salario nov', 2000), inc('b', '2026-10-01', 'ACME LDA salario out', 2000), inc('c', '2026-11-03', 'Ana Silva', 30),
  ] };
  s = tagIncomeIn(s, 'a', 'Salary', 'Job', true);
  assert.equal(s.income.find((x) => x.id === 'b')?.tag, 'Salary');
  assert.equal(s.income.find((x) => x.id === 'c')?.tag, undefined);
  const [n] = tagNewIncome(s, [inc('d', '2026-12-01', 'ACME LDA salario dez', 2000) as import('./types.ts').Income]);
  assert.deepEqual([n.tag, n.note], ['Salary', 'Job']);
  s = tagIncomeIn(s, 'c', 'Dinner payback', undefined, true);
  assert.ok(incomeTagsOf(s).includes('Dinner payback'));
  const f = moneyFlow(s, '2026-11');
  assert.deepEqual(f.nodes.filter((x) => x.kind === 'income').map((x) => x.key), ['Salary', 'Dinner payback']);
});

test('a remark given while sorting stays on that payment only', () => {
  const tx = (id: string) => ({ id, date: '2026-11-01', description: 'Lidl Lisboa', amount: 5, categoryId: null, type: 'variable-one-time' as const, source: 'revolut' as const });
  let s: BudgetState = { ...initialState(), rules: [], transactions: [tx('a'), tx('b')] };
  s = sortIn(s, 'a', { categoryId: 'essentials', type: 'variable-one-time', remark: ' for the party ' }, true);
  assert.equal(s.transactions.find((t) => t.id === 'a')?.remark, 'for the party');
  assert.equal(s.transactions.find((t) => t.id === 'b')?.remark, undefined);
  assert.equal(s.transactions.find((t) => t.id === 'b')?.categoryId, 'essentials');
});

test('a line marked as a transfer by mistake can be put back, and its rule forgotten', async () => {
  const { putBackTransferIn, forgetTransferRuleIn } = await import('./budget.ts');
  const tx = (id: string, description: string) => ({ id, date: '2026-11-01', description, amount: 9, categoryId: null, type: 'variable-one-time' as const, source: 'revolut' as const, externalId: `eb:x:${id}` });
  let s: BudgetState = { ...initialState(), transactions: [tx('a', 'Cash at Pepe dos Frangos'), tx('b', 'Lidl')], transferRules: ['p/ poonam kumari'], transferIds: ['eb:x:old'] };
  s = markTransferIn(s, 'a', true);
  assert.equal(s.transferred?.length, 1);
  assert.ok(s.transferRules?.includes('cash at pepe dos frangos'));
  s = putBackTransferIn(s, 'a', true);
  assert.deepEqual(s.transactions.map((t) => t.id).sort(), ['a', 'b']);
  assert.equal(s.transferred?.length, 0);
  assert.deepEqual(s.transferRules, ['p/ poonam kumari']);
  assert.deepEqual(s.transferIds, ['eb:x:old']);
  s = forgetTransferRuleIn(s, 'p/ poonam kumari');
  assert.deepEqual(s.transferRules, []);
  assert.deepEqual(s.transferIds, []);
  assert.equal(s.rereadAll, true);
});

test('transfers are remembered by the person, not by the bank prefix', () => {
  assert.equal(ruleFrom('TRF.IMED. DE AHMED MUJTABA KHAN-E19438152'), 'ahmed mujtaba');
  assert.equal(ruleFrom('TRF.IMED.  P/ Poonam Kumari-E41057871'), 'poonam kumari');
  assert.equal(ruleFrom('9141613 DEP.MOEDAS            CHARNECA DE CAPARICA'), 'dep.moedas');
  assert.equal(ruleFrom('Raz*zomato Online Order'), 'zomato');
  assert.equal(ruleFrom('ANUL.TRF.IMED.   P/ Altura Nova Consulting Unip Ld'), 'altura nova');
});

test('rules learned on the bare transfer prefix are forgotten', async () => {
  const { migrate } = await import('./defaults.ts');
  const s = migrate({
    dataVersion: 4,
    subcategories: [],
    incomeRules: [{ match: 'trf.imed.', tag: 'Side work' }, { match: 'divya', tag: 'Salary' }],
    rules: [{ match: 'trf.imed.', categoryId: 'frivolous' }, { match: 'zomato', categoryId: 'frivolous' }],
  } as never);
  assert.deepEqual(s.incomeRules?.map((r) => r.match), ['divya']);
  assert.ok(!s.rules.some((r) => r.match === 'trf.imed.'));
  assert.ok(s.rules.some((r) => r.match === 'zomato'));
});

test('income sub-tags are remembered with the tag', async () => {
  const { tagIncomeIn, tagNewIncome, incomeSubTagsOf, incomeTagLabel } = await import('./budget.ts');
  const inc = (id: string, description: string) => ({ id, date: '2026-11-20', description, amount: 10, source: 'revolut' }) as import('./types.ts').Income;
  let s = { ...initialState(), income: [inc('1', 'TRF.IMED. DE AHMED MUJTABA KHAN-R1'), inc('2', 'TRF.IMED. DE AHMED MUJTABA KHAN-R2'), inc('3', 'TRF.IMED. DE RAJA ASIM-R3')] };
  s = tagIncomeIn(s, '1', 'MBWay', undefined, true, 'Ahmed');
  assert.deepEqual(s.income.map(incomeTagLabel), ['MBWay › Ahmed', 'MBWay › Ahmed', undefined]);
  assert.deepEqual(s.incomeRules, [{ match: 'ahmed mujtaba', tag: 'MBWay', subTag: 'Ahmed' }]);
  assert.deepEqual(tagNewIncome(s, [inc('4', 'TRF.IMED. DE AHMED MUJTABA KHAN-R4')]).map(incomeTagLabel), ['MBWay › Ahmed']);
  assert.deepEqual(incomeSubTagsOf(s, 'mbway'), ['Ahmed']);
  s = tagIncomeIn(s, '1', 'Family', undefined, false);
  assert.equal(s.income[0].subTag, undefined);
});

test('an expanded income tag splits into its sub-tags in the money flow', () => {
  const inc = (id: string, amount: number, tag: string, subTag?: string) => ({ id, date: '2026-11-20', description: id, amount, source: 'manual', tag, ...(subTag ? { subTag } : {}) }) as import('./types.ts').Income;
  const s = { ...initialState(), income: [inc('a', 100, 'MBWay', 'Ahmed'), inc('b', 50, 'MBWay', 'Raja'), inc('c', 20, 'MBWay'), inc('d', 500, 'Salary')] };
  const flat = moneyFlow(s, '2026-11').nodes.filter((n) => n.kind === 'income').map((n) => [n.key, n.value]);
  assert.deepEqual(flat, [['Salary', 500], ['MBWay', 170]]);
  const split = moneyFlow(s, '2026-11', 5, { expand: 'mbway' });
  assert.deepEqual(split.nodes.filter((n) => n.kind === 'income').map((n) => [n.key, n.sub, n.value]), [['Salary', undefined, 500], ['MBWay', 'Ahmed', 100], ['MBWay', 'Raja', 50], ['MBWay', '', 20]]);
  assert.equal(split.income, 670);
});

test('transfers a sync leaves out are listed once, with why', async () => {
  const { transferLinesFrom } = await import('./sync.ts');
  const row = (externalId: string, description: string, amount: number, owner?: string) => ({ externalId, date: '2026-11-20', description, amount, currency: 'EUR', ...(owner ? { owner } : {}) });
  const s = { ...initialState(), transferRules: ['p/ akshiv kumar'], transactions: [{ id: 'x', date: '2026-11-19', description: 'To Wife', amount: 50, categoryId: null, type: 'variable-one-time', source: 'revolut', externalId: 'eb:5' }] } as BudgetState;
  const res = {
    transactions: [row('eb:1', 'TRF.IMED. P/ Akshiv Kumar-E1', 200, 'wife'), row('eb:2', 'Continente', 30)],
    income: [row('eb:3', 'DIVYA DIVYA', 100)],
    transferLines: { spending: [row('eb:4', 'To Poonam', 75)], income: [row('eb:4b', 'From Akshiv', 75, 'wife')] },
  };
  const log = transferLinesFrom(s, res, ['eb:5']);
  assert.deepEqual(log.map((x) => [x.externalId, x.dir, x.why, x.owner]), [
    ['eb:1', 'out', 'p/ akshiv kumar', 'wife'],
    ['eb:4', 'out', 'pair', undefined],
    ['eb:4b', 'in', 'pair', 'wife'],
    ['eb:5', 'out', 'pair', undefined],
  ]);
  assert.deepEqual(transferLinesFrom({ ...s, transferLog: log }, res, ['eb:5']), []);
});

test('an expanded category splits into its subcategories in the money flow, each still flowing to types', () => {
  const tx = (id: string, amount: number, categoryId: string, type: import('./types.ts').ItemType, subcategoryId?: string) =>
    ({ id, date: '2026-11-20', description: id, amount, categoryId, type, source: 'manual', ...(subcategoryId ? { subcategoryId } : {}) }) as import('./types.ts').Transaction;
  const s = { ...initialState(), transactions: [tx('a', 40, 'frivolous', 'variable-one-time', 'eating-out'), tx('b', 10, 'frivolous', 'recurring-variable', 'eating-out'), tx('c', 30, 'frivolous', 'variable-one-time'), tx('d', 60, 'essentials', 'variable-one-time')] };
  const flat = moneyFlow(s, '2026-11').nodes.filter((n) => n.kind === 'category').map((n) => [n.key, n.value]);
  assert.deepEqual(flat, [['frivolous', 80], ['essentials', 60]]);
  const split = moneyFlow(s, '2026-11', 5, { expandCategory: 'frivolous' });
  assert.deepEqual(split.nodes.filter((n) => n.kind === 'category').map((n) => [n.key, n.sub, n.value]), [['frivolous', 'eating-out', 50], ['frivolous', '', 30], ['essentials', undefined, 60]]);
  assert.deepEqual(split.links.filter((l) => l.source === 'cat:frivolous:eating-out').map((l) => [l.target, l.value]), [['type:variable-one-time', 40], ['type:recurring-variable', 10]]);
  assert.equal(split.spent, 140);
});

test('a tagged income source always gets its own block; only untagged senders go into Other income', () => {
  const inc = (id: string, amount: number, tag?: string) => ({ id, date: '2026-11-10', description: `SENDER ${id}`, amount, source: 'manual', ...(tag ? { tag } : {}) }) as import('./types.ts').Income;
  const s = { ...initialState(), income: [inc('a', 700, 'Coins'), inc('b', 400), inc('c', 385), inc('d', 300), inc('e', 250), inc('f', 200, 'Notes'), inc('g', 190)] };
  const keys = moneyFlow(s, '2026-11').nodes.filter((n) => n.kind === 'income').map((n) => [n.key, n.value]);
  assert.deepEqual(keys, [['Coins', 700], ['SENDER b', 400], ['SENDER c', 385], ['Notes', 200], ['__other', 740]]);
});

test('senders with no rule get the default tag; a third level splits a sub-tag in the money flow', async () => {
  const { tagNewIncome, incomeTagLabel, tagIncomeIn } = await import('./budget.ts');
  const inc = (id: string, amount: number, description: string) => ({ id, date: '2026-11-10', description, amount, source: 'revolut' }) as import('./types.ts').Income;
  let s = {
    ...initialState(),
    incomeRules: [{ match: 'ahmed mujtaba', tag: 'mbway', subTag: 'Staff', subSubTag: 'Ahmed' }, { match: 'dep.notas', tag: 'Notes' }],
    defaultIncomeTag: { tag: 'mbway', subTag: 'Direct clients' },
  } as BudgetState;
  const got = tagNewIncome(s, [inc('a', 100, 'TRF.IMED. DE AHMED MUJTABA KHAN'), inc('b', 400, 'MAHMOOD IQBAL'), inc('c', 50, '9141613 DEP.NOTAS X')]);
  assert.deepEqual(got.map((i) => [incomeTagLabel(i), !!i.defaulted]), [['mbway › Staff › Ahmed', false], ['mbway › Direct clients', true], ['Notes', false]]);
  s = { ...s, income: got };
  // Tagging a defaulted line clears the flag.
  assert.equal(tagIncomeIn(s, 'b', 'Side work', undefined, false).income.find((i) => i.id === 'b')!.defaulted, undefined);
  const tag = moneyFlow(s, '2026-11', 5, { expand: 'mbway' }).nodes.filter((n) => n.kind === 'income').map((n) => [n.sub, n.value]);
  assert.deepEqual(tag, [['Direct clients', 400], ['Staff', 100], [undefined, 50]]);
  const deeper = moneyFlow(s, '2026-11', 5, { expand: 'mbway', expandSub: 'Staff' }).nodes.filter((n) => n.kind === 'income').map((n) => [n.sub, n.subSub, n.value]);
  assert.deepEqual(deeper, [['Direct clients', undefined, 400], ['Staff', 'Ahmed', 100], [undefined, undefined, 50]]);
});

test('a rule with an amount range only sorts payments inside it', () => {
  const rules = [
    { match: 'gym', categoryId: 'essentials', type: 'recurring-fixed' as const },
    { match: 'black out gym', categoryId: 'essentials', type: 'recurring-fixed' as const, payment: 'auto' as const, minAmount: 50 },
    { match: 'black out gym', categoryId: 'frivolous', type: 'variable-one-time' as const, maxAmount: 49.99 },
  ];
  assert.equal(matchRule('Black Out Gym', rules, 100)?.categoryId, 'essentials');
  assert.equal(matchRule('COMPRA 6134 BLACK OUT GYM', rules, 3)?.categoryId, 'frivolous');
  // Without an amount, only rules with no range apply.
  assert.equal(matchRule('Black Out Gym', rules)?.match, 'gym');
});

test('a new category gets the next colour not already used', async () => {
  const { newCategory } = await import('./budget.ts');
  const cats = initialState().categories;
  const a = newCategory(cats, 'x', '  Health ');
  assert.deepEqual([a.name, a.color], ['Health', '#1a9e9e']);
  assert.equal(newCategory([...cats, a], 'y', 'Kids').color, '#4a9d3f');
});

test('a booking the bank sends twice under entry numbers ending 0001 and 0002 is only imported once', () => {
  const row = (externalId: string, amount = 70) => ({ externalId, date: '2026-11-25', description: 'TRF MBWAY P/XXXXX3300', amount, currency: 'EUR', owner: 'wife' });
  const ids = (() => { let n = 0; return () => `n${n++}`; })();
  const s = initialState();
  const first = mergeSynced(s, [row('eb:acc:202611251321276873650002'), row('eb:acc:202611251321276873650001')], ids);
  assert.equal(first.length, 1);
  // Already here under one number: the other one is skipped on a later sync too.
  assert.equal(mergeSynced({ ...s, transactions: first }, [row('eb:acc:202611251321276873650001')], ids).length, 0);
  // A different amount under the same booking (e.g. a fee) is kept.
  assert.equal(mergeSynced({ ...s, transactions: first }, [row('eb:acc:202611251321276873650003', 1.2)], ids).length, 1);
});

test('cash withdrawals never teach a rule; an intrabank transfer keys on the person', () => {
  assert.equal(ruleFrom('9141613 LEV.NUMERARIO'), '');
  assert.equal(ruleFrom('ATM Withdrawal'), '');
  assert.equal(ruleFrom('Cash at Al Bonifacio Lazaro, 15a'), '');
  assert.equal(ruleFrom('TRF CRED INTRABANC P/ Sarbjit Kaur-74722860'), 'sarbjit kaur');
});

test('a subcategory can have a third level: it groups under its subcategory and splits again in the money flow', async () => {
  const { subLabel, subLevels } = await import('./budget.ts');
  const tx = (id: string, amount: number, subcategoryId?: string) =>
    ({ id, date: '2026-11-20', description: id, amount, categoryId: 'pawan', type: 'variable-one-time', source: 'manual', ...(subcategoryId ? { subcategoryId } : {}) }) as import('./types.ts').Transaction;
  const s = {
    ...initialState(),
    categories: [...initialState().categories, { id: 'pawan', name: 'Pawan', color: '#000' }],
    subcategories: [
      { id: 'altura', categoryId: 'pawan', name: 'Altura Nova Consulting' },
      { id: 'sant', categoryId: 'pawan', name: 'Santander', parentId: 'altura' },
      { id: 'mill', categoryId: 'pawan', name: 'Millenium', parentId: 'altura' },
      { id: 'jawed', categoryId: 'pawan', name: 'Jawed mbway' },
    ],
    transactions: [tx('a', 2000, 'sant'), tx('b', 500, 'mill'), tx('c', 100, 'altura'), tx('d', 150, 'jawed')],
  } as BudgetState;
  assert.equal(subLabel(s.subcategories, 'sant'), 'Altura Nova Consulting › Santander');
  assert.deepEqual(subLevels(s.subcategories, 'mill'), { sub: 'altura', leaf: 'mill' });
  const two = moneyFlow(s, '2026-11', 5, { expandCategory: 'pawan' }).nodes.filter((n) => n.kind === 'category').map((n) => [n.sub, n.value]);
  assert.deepEqual(two, [['altura', 2600], ['jawed', 150]]);
  const three = moneyFlow(s, '2026-11', 5, { expandCategory: 'pawan', expandCategorySub: 'altura' });
  assert.deepEqual(three.nodes.filter((n) => n.kind === 'category').map((n) => [n.sub, n.subSub, n.value]), [['altura', 'sant', 2000], ['altura', 'mill', 500], ['altura', '', 100], ['jawed', undefined, 150]]);
  assert.deepEqual(three.links.filter((l) => l.source === 'cat:pawan:altura:sant').map((l) => [l.target, l.value]), [['type:variable-one-time', 2000]]);
});
