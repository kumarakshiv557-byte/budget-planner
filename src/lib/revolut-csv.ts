import { matchRule } from './budget.ts';
import type { BudgetState, Income, Transaction } from './types.ts';

/** Split one CSV line, honouring double-quoted fields. */
export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

export type ImportResult = {
  transactions: Transaction[];
  income: Income[];
  skippedDuplicates: number;
  skippedOther: number;
  currencies: string[];
};

// Types that move money between your own pots or currencies rather than spending it.
const IGNORED_TYPES = new Set(['TOPUP', 'EXCHANGE', 'TRANSFER_BETWEEN_POCKETS', 'INTEREST']);

/**
 * Parse a statement exported from the Revolut app (Statement → Excel/CSV).
 * Header: Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance
 * Spending (negative amounts) becomes a positive transaction; card refunds reduce spending.
 * Incoming money such as salary becomes income. Top-ups and moves between your own pockets are skipped.
 */
export function parseRevolutCsv(text: string, state: BudgetState, idFor: () => string): ImportResult {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) throw new Error('The file is empty.');
  const header = parseCsvLine(lines[0]).map((h) => h.toLowerCase());
  const col = (name: string) => header.indexOf(name);
  const iType = col('type');
  const iDate = col('completed date') >= 0 ? col('completed date') : col('started date');
  const iDesc = col('description');
  const iAmount = col('amount');
  const iFee = col('fee');
  const iCurrency = col('currency');
  const iState = col('state');
  if (iDate < 0 || iDesc < 0 || iAmount < 0) {
    throw new Error("This doesn't look like a Revolut statement. Expected Date, Description and Amount columns.");
  }

  const existing = new Set([...state.transactions, ...(state.income ?? [])].map((t) => t.externalId).filter(Boolean));
  const income: Income[] = [];
  const currencies = new Set<string>();
  const transactions: Transaction[] = [];
  let skippedDuplicates = 0;
  let skippedOther = 0;

  for (const line of lines.slice(1)) {
    const f = parseCsvLine(line);
    const type = iType >= 0 ? f[iType]?.toUpperCase() : '';
    const status = iState >= 0 ? f[iState]?.toUpperCase() : 'COMPLETED';
    const date = (f[iDate] || '').slice(0, 10);
    const amount = Number(f[iAmount]);
    const fee = iFee >= 0 ? Number(f[iFee]) || 0 : 0;
    const description = f[iDesc] || '';

    const isRefund = type === 'CARD_REFUND' || type === 'REFUND';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(amount) || status !== 'COMPLETED' || IGNORED_TYPES.has(type)) {
      skippedOther++;
      continue;
    }
    if (amount > 0 && !isRefund) {
      const externalId = `rvl:${f[iDate]}|${description}|${amount}|${fee}`;
      if (existing.has(externalId)) {
        skippedDuplicates++;
        continue;
      }
      existing.add(externalId);
      income.push({ id: idFor(), date, description, amount: Math.round((amount - fee) * 100) / 100, source: 'csv', externalId });
      continue;
    }
    if (amount === 0) {
      skippedOther++;
      continue;
    }

    const externalId = `rvl:${f[iDate]}|${description}|${amount}|${fee}`;
    if (existing.has(externalId)) {
      skippedDuplicates++;
      continue;
    }
    existing.add(externalId);
    if (iCurrency >= 0 && f[iCurrency]) currencies.add(f[iCurrency]);

    const spent = Math.round((-amount + fee) * 100) / 100;
    const rule = matchRule(description, state.rules, spent);
    const categoryId = rule?.categoryId ?? null;
    transactions.push({
      id: idFor(),
      date,
      description,
      // spending is stored positive; a refund is negative spending
      amount: spent,
      categoryId,
      ...(rule?.subcategoryId ? { subcategoryId: rule.subcategoryId } : {}),
      type: rule?.type ?? 'variable-one-time',
      ...(rule?.payment ? { payment: rule.payment } : {}),
      ...(rule?.note ? { note: rule.note } : {}),
      source: 'csv',
      externalId,
    });
  }
  return { transactions, income, skippedDuplicates, skippedOther, currencies: [...currencies] };
}
