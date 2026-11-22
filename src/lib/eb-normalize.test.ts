/// <reference types="node" />
import assert from 'node:assert/strict';
import { createVerify, generateKeyPairSync } from 'node:crypto';
import { test } from 'node:test';

import { base64url, normalizeTransactions, pemToPkcs8 } from '../../supabase/functions/_shared/eb-normalize.ts';

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
