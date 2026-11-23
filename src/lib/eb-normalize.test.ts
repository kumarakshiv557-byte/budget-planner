/// <reference types="node" />
import assert from 'node:assert/strict';
import { createVerify, generateKeyPairSync } from 'node:crypto';
import { test } from 'node:test';

import { base64url, findTransfers, normalizeRows, normalizeTransactions, pemToPkcs8 } from '../../supabase/functions/revolut-sync/eb-normalize.ts';

test('Enable Banking rows: keeps booked debits, skips credits, pending and own transfers', () => {
  const rows = [
    { entry_reference: 'a1', transaction_amount: { amount: '12.99', currency: 'EUR' }, credit_debit_indicator: 'DBIT', status: 'BOOK', booking_date: '2026-11-02', creditor: { name: 'Netflix.com' } },
    { entry_reference: 'a2', transaction_amount: { amount: '2000', currency: 'EUR' }, credit_debit_indicator: 'CRDT', status: 'BOOK', booking_date: '2026-11-01', debtor: { name: 'Employer' } },
    { entry_reference: 'a3', transaction_amount: { amount: '5', currency: 'EUR' }, credit_debit_indicator: 'DBIT', status: 'PDNG', booking_date: '2026-11-03' },
    { entry_reference: 'a4', transaction_amount: { amount: '100', currency: 'EUR' }, credit_debit_indicator: 'DBIT', status: 'BOOK', booking_date: '2026-11-04', creditor_account: { iban: 'LT12 3456' } },
    { transaction_amount: { amount: '-45.10', currency: 'EUR' }, transaction_date: '2026-11-05T10:00:00Z', remittance_information: ['Pingo Doce', 'Lisboa'] },
  ];
  const out = normalizeTransactions('acc1', rows, ['LT123456']);
  assert.deepEqual(
    out.map((t) => [t.externalId, t.date, t.description, t.amount]),
    [
      ['eb:acc1:a1', '2026-11-02', 'Netflix.com', 12.99],
      ['eb:acc1:2026-11-05|Pingo Doce Lisboa|-45.1', '2026-11-05', 'Pingo Doce Lisboa', 45.1],
    ],
  );
});

test('Enable Banking rows: money in becomes income, except from your own accounts', () => {
  const rows = [
    { entry_reference: 'c1', transaction_amount: { amount: '2000', currency: 'EUR' }, credit_debit_indicator: 'CRDT', status: 'BOOK', booking_date: '2026-11-01', debtor: { name: 'Employer Lda' } },
    { entry_reference: 'c2', transaction_amount: { amount: '300', currency: 'EUR' }, credit_debit_indicator: 'CRDT', status: 'BOOK', booking_date: '2026-11-02', debtor_account: { iban: 'LT12 3456' } },
    { entry_reference: 'c3', transaction_amount: { amount: '50', currency: 'EUR' }, credit_debit_indicator: 'CRDT', status: 'PDNG', booking_date: '2026-11-03' },
    { entry_reference: 'd1', transaction_amount: { amount: '9.99', currency: 'EUR' }, credit_debit_indicator: 'DBIT', status: 'BOOK', booking_date: '2026-11-04', creditor: { name: 'Spotify' } },
  ];
  const { spending, income } = normalizeRows('acc1', rows, ['LT123456']);
  assert.deepEqual(income.map((t) => [t.externalId, t.description, t.amount]), [['eb:acc1:c1', 'Employer Lda', 2000]]);
  assert.deepEqual(spending.map((t) => t.externalId), ['eb:acc1:d1']);
});

test('transfers between two connected accounts are paired up, once each', () => {
  const row = (id: string, date: string, amount: number) => ({ externalId: `eb:${id}`, date, description: 'x', amount, currency: 'EUR' });
  const spending = [row('mine:s1', '2026-11-10', 500), row('mine:s2', '2026-11-12', 40), row('mine:s3', '2026-11-20', 500)];
  const income = [
    row('wife:i1', '2026-11-11', 500), // from me, a day later
    row('mine:i2', '2026-11-12', 40), // same account: not a transfer
    row('wife:i3', '2026-11-30', 500), // 10 days later: too far apart
    row('wife:i4', '2026-11-20', 500), // the second 500
  ];
  assert.deepEqual(findTransfers(spending, income), ['eb:mine:s1', 'eb:wife:i1', 'eb:mine:s3', 'eb:wife:i4']);
});

for (const format of ['pkcs8', 'pkcs1'] as const) {
  test(`private key in ${format} PEM signs a JWT that verifies`, async () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pem = privateKey.export({ type: format, format: 'pem' }).toString();
    const key = await crypto.subtle.importKey('pkcs8', pemToPkcs8(pem), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
    const data = `${base64url('{"alg":"RS256"}')}.${base64url('{"iss":"enablebanking.com"}')}`;
    const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(data)));
    const v = createVerify('RSA-SHA256');
    v.update(data);
    assert.ok(v.verify(publicKey, Buffer.from(sig)));
  });
}

test('keeps the bank details of a card payment', () => {
  const { spending } = normalizeRows('acc', [
    {
      entry_reference: 'r1',
      transaction_amount: { amount: '12.50', currency: 'EUR' },
      credit_debit_indicator: 'DBIT',
      booking_date: '2026-11-22',
      transaction_date: '2026-11-21',
      creditor: { name: 'Costa Coffee', postal_address: { town_name: 'Lisboa', country: 'PT' } },
      merchant_category_code: '5814',
      remittance_information: ['Costa Coffee Lisboa card 1234'],
      exchange_rate: { instructed_amount: { amount: '10.80', currency: 'GBP' } },
    },
    { entry_reference: 'r2', transaction_amount: { amount: '5', currency: 'EUR' }, credit_debit_indicator: 'DBIT', booking_date: '2026-11-22', remittance_information: ['Bolt'] },
  ]);
  assert.deepEqual(spending[0].details, {
    merchantType: 'Fast food',
    kind: 'Card payment',
    place: 'Lisboa, PT',
    reference: 'Costa Coffee Lisboa card 1234',
    foreign: 'GBP 10.80',
    usedOn: '2026-11-21',
  });
  assert.equal(spending[1].details, undefined);
});
