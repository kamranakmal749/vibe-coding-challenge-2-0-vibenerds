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
 * Keeps Express's widened min/max search window while guaranteeing IST boundary coverage.
 */
export function getWidenedDateWindow(dateInput: Date | string | number): { minDate: Date; maxDate: Date } {
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
  const istStr = istDateString(d);

  const istStart = istDateTime(istStr, '00:00:00').getTime();
  const istEnd = istDateTime(istStr, '23:59:59.999').getTime();

  const utcStart = new Date(d).setUTCHours(0, 0, 0, 0);
  const utcEnd = new Date(d).setUTCHours(23, 59, 59, 999);

  const localStart = new Date(d).setHours(0, 0, 0, 0);
  const localEnd = new Date(d).setHours(23, 59, 59, 999);

  const minTime = Math.min(istStart, utcStart, localStart);
  const maxTime = Math.max(istEnd, utcEnd, localEnd);

  return {
    minDate: new Date(minTime),
    maxDate: new Date(maxTime),
  };
}
