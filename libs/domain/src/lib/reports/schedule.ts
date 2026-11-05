/**
 * Cadence of a scheduled report delivery (screen 091). Times are wall-clock in the schedule's
 * timezone, so a run keeps its local time across daylight-saving changes.
 */
export const SCHEDULE_FREQUENCIES = [
  'daily_weekdays',
  'weekly',
  'monthly',
  'monthly_after_close',
] as const;
export type ScheduleFrequency = (typeof SCHEDULE_FREQUENCIES)[number];

export interface ScheduleCadence {
  frequency: ScheduleFrequency;
  /** 0 = Sunday. Weekly schedules only. */
  weekday: number | null;
  /** 1-28. Monthly schedules only; packs that wait for the close default to the 5th. */
  dayOfMonth: number | null;
  /** HH:MM in `timezone`. */
  sendTime: string;
  timezone: string;
}

const DEFAULT_MONTH_DAY = 5;

function zoneOffsetMs(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instant));
  const at = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  return (
    Date.UTC(at('year'), at('month') - 1, at('day'), at('hour'), at('minute'), at('second')) -
    Math.floor(instant / 1000) * 1000
  );
}

/** The UTC instant of a local wall-clock time in `timeZone`. */
export function zonedWallClockToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  let instant = wall - zoneOffsetMs(wall, timeZone);
  instant = wall - zoneOffsetMs(instant, timeZone);
  return new Date(instant);
}

/** Calendar date and weekday of an instant in `timeZone`. */
function localParts(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  }).formatToParts(instant);
  const at = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return {
    year: Number(at('year')),
    month: Number(at('month')),
    day: Number(at('day')),
    weekday: weekdays.indexOf(at('weekday')),
  };
}

function matches(cadence: ScheduleCadence, parts: { day: number; weekday: number }): boolean {
  switch (cadence.frequency) {
    case 'daily_weekdays':
      return parts.weekday >= 1 && parts.weekday <= 5;
    case 'weekly':
      return parts.weekday === (cadence.weekday ?? 1);
    case 'monthly':
    case 'monthly_after_close':
      return parts.day === (cadence.dayOfMonth ?? DEFAULT_MONTH_DAY);
  }
}

/**
 * The next delivery strictly after `from`. Walks forward a day at a time in the schedule's own
 * timezone, so no run is skipped or duplicated by a daylight-saving change.
 */
export function nextRunAt(cadence: ScheduleCadence, from: Date): Date | null {
  const [hour, minute] = cadence.sendTime.split(':').map(Number);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  for (let i = 0; i <= 400; i++) {
    const probe = new Date(from.getTime() + i * 24 * 60 * 60 * 1000);
    const parts = localParts(probe, cadence.timezone);
    if (!matches(cadence, parts)) continue;
    const at = zonedWallClockToUtc(
      parts.year,
      parts.month,
      parts.day,
      hour,
      minute,
      cadence.timezone,
    );
    if (at.getTime() > from.getTime()) return at;
  }
  return null;
}

export interface CadenceProblem {
  field: 'weekday' | 'dayOfMonth' | 'sendTime' | 'timezone';
  message: string;
}

export function validateCadence(cadence: ScheduleCadence): CadenceProblem | null {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(cadence.sendTime))
    return { field: 'sendTime', message: 'Send time must be HH:MM in 24-hour form.' };
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: cadence.timezone });
  } catch {
    return { field: 'timezone', message: 'Unknown timezone.' };
  }
  if (
    cadence.frequency === 'weekly' &&
    cadence.weekday !== null &&
    (cadence.weekday < 0 || cadence.weekday > 6)
  )
    return { field: 'weekday', message: 'Weekday must be 0 (Sunday) to 6 (Saturday).' };
  if (
    (cadence.frequency === 'monthly' || cadence.frequency === 'monthly_after_close') &&
    cadence.dayOfMonth !== null &&
    (cadence.dayOfMonth < 1 || cadence.dayOfMonth > 28)
  )
    return { field: 'dayOfMonth', message: 'Day of month must be 1 to 28.' };
  return null;
}
