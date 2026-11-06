// client/src/lib/ist.ts
// Explicit Indian Standard Time (IST, UTC+05:30) helper library.
// Prevents timezone drift between TZ=UTC (e.g. Vercel/serverless) and TZ=Asia/Kolkata.

const IST_TIMEZONE = 'Asia/Kolkata';

/**
 * Returns formatted YYYY-MM-DD string in IST for a given Date, string, or timestamp.
 * Defaults to current time if no argument provided.
 */
export function istDateString(date: Date | string | number = new Date()): string {
  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) {
    return '';
  }
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: IST_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/**
 * Returns today's date in IST as 'YYYY-MM-DD'.
 */
export function istToday(): string {
  return istDateString(new Date());
}

/**
 * Returns the 4-digit calendar year in IST (e.g. 2026).
 */
export function istYear(date: Date | string | number = new Date()): number {
  const dStr = istDateString(date);
  if (!dStr) {
    return new Date().getFullYear();
  }
  return parseInt(dStr.slice(0, 4), 10);
}

/**
 * Constructs an absolute JS Date object representing the given date string ('YYYY-MM-DD')
 * and optional time string ('HH:mm' or 'HH:mm:ss') interpreted strictly in IST (+05:30).
 */
export function istDateTime(dateStr: string, timeStr: string = '00:00:00'): Date {
  const cleanDate = (dateStr || '').trim().slice(0, 10);
  let cleanTime = (timeStr || '00:00:00').trim();
  if (cleanTime.length === 5) {
    cleanTime = `${cleanTime}:00`;
  }
  // Construct ISO string with explicit +05:30 offset
  return new Date(`${cleanDate}T${cleanTime}+05:30`);
}

/**
 * Widened session date query window.
 * Strictly uses explicit IST (+05:30) and UTC boundaries without relying on host-local time.
 */
export function getWidenedDateWindow(dateInput: Date | string | number): { minDate: Date; maxDate: Date } {
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
  const istStr = istDateString(d);

  const istStart = istDateTime(istStr, '00:00:00').getTime();
  const istEnd = istDateTime(istStr, '23:59:59.999').getTime();

  const utcStart = new Date(d).setUTCHours(0, 0, 0, 0);
  const utcEnd = new Date(d).setUTCHours(23, 59, 59, 999);

  return {
    minDate: new Date(Math.min(istStart, utcStart)),
    maxDate: new Date(Math.max(istEnd, utcEnd)),
  };
}

/**
 * Returns month start and end timestamps in IST for a 'YYYY-MM' input,
 * widened to include UTC day boundaries for stored document matching.
 */
export function getIstMonthRange(monthStr: string): { startDate: Date; endDate: Date } {
  const [year, m] = monthStr.split('-').map(Number);
  const pad = (n: number) => String(n).padStart(2, '0');
  const daysInMonth = new Date(Date.UTC(year, m, 0)).getUTCDate();

  const istStart = istDateTime(`${year}-${pad(m)}-01`, '00:00:00').getTime();
  const istEnd = istDateTime(`${year}-${pad(m)}-${pad(daysInMonth)}`, '23:59:59.999').getTime();

  const utcStart = new Date(Date.UTC(year, m - 1, 1, 0, 0, 0)).getTime();
  const utcEnd = new Date(Date.UTC(year, m, 0, 23, 59, 59, 999)).getTime();

  return {
    startDate: new Date(Math.min(istStart, utcStart)),
    endDate: new Date(Math.max(istEnd, utcEnd)),
  };
}

