/* Ren tidslogik för påminnelserna — inget I/O, så att den går att testa. */

/** Hur länge efter vald tid en missad påminnelse fortfarande skickas (t.ex. efter omstart). */
export const CATCH_UP_MINUTES = 180;

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isValidTime(value: unknown): value is string {
  return typeof value === "string" && TIME.test(value);
}

export function isValidTimeZone(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

const formatters = new Map<string, Intl.DateTimeFormat>();

/** Lokalt datum (YYYY-MM-DD) och minut på dygnet i en viss tidszon. */
export function localNow(timeZone: string, now = new Date()) {
  let format = formatters.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-CA", {
      timeZone, hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit",
    });
    formatters.set(timeZone, format);
  }
  const parts = Object.fromEntries(format.formatToParts(now).map((p) => [p.type, p.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minute: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

export function minuteOfDay(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

export interface ReminderState {
  time: string;
  timeZone: string;
  lastSentOn: string | null;
  practicedOn: string | null;
}

/**
 * Ska påminnelsen gå ut nu? Bara en gång per dag, inte om man redan har övat
 * i dag, och inte långt efter vald tid (då är dagen i praktiken förbi).
 */
export function isDue(reminder: ReminderState, now = new Date()): boolean {
  const { date, minute } = localNow(reminder.timeZone, now);
  if (reminder.lastSentOn === date || reminder.practicedOn === date) return false;
  const late = minute - minuteOfDay(reminder.time);
  return late >= 0 && late < CATCH_UP_MINUTES;
}
