// Pure helpers for bill reminders, shared by the Edge Function and the app's tests. No Deno or Node APIs.

/** A "Pay myself" bill as the app sends it. */
export type PushBill = {
  id: string;
  name: string;
  amount: number;
  currency: string;
  /** Day of the month it is due (1-31); capped to the month's length. */
  dueDay: number;
  variable?: boolean;
  startMonth: string; // YYYY-MM
  endMonth?: string;
  paidMonths?: string[];
};

export type Reminder = { billId: string; key: string; title: string; body: string };

/** The date and hour in a time zone, e.g. { date: '2026-11-22', hour: 9 }. */
export function localNow(now: Date, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

function addDays(date: string, n: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function dueDateIn(bill: PushBill, month: string) {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${month}-${String(Math.min(Math.max(1, bill.dueDay), last)).padStart(2, '0')}`;
}

function money(amount: number, currency: string) {
  try {
    return new Intl.NumberFormat('en-IE', { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

/**
 * Reminders to send on `today` (local date): one per bill that is due tomorrow and not yet marked paid,
 * so there is a day to arrange the money. (The calendar file covers the due day itself.)
 * Months outside the bill's start/end are skipped. Each reminder has a `key` so it is never sent twice.
 */
export function remindersFor(bills: PushBill[], today: string): Reminder[] {
  const out: Reminder[] = [];
  const day = addDays(today, 1);
  const month = day.slice(0, 7);
  for (const bill of bills) {
    if (month < bill.startMonth || (bill.endMonth && month > bill.endMonth)) continue;
    if (dueDateIn(bill, month) !== day || bill.paidMonths?.includes(month)) continue;
    const amount = `${bill.variable ? 'about ' : ''}${money(bill.amount, bill.currency)}`;
    out.push({
      billId: bill.id,
      key: `${bill.id}:${day}:tomorrow`,
      title: `${bill.name} is due tomorrow`,
      body: `${amount}. Make sure the money is there.`,
    });
  }
  return out;
}
