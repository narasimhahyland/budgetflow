import { formatDate } from '@angular/common';
import { Pipe, type PipeTransform } from '@angular/core';

/** UTC offset of an IANA timezone at an instant, in the `+0530` form Angular's formatDate accepts. */
export function utcOffset(timezone: string, at: Date): string {
  const name =
    new Intl.DateTimeFormat('en-US', { timeZone: timezone, timeZoneName: 'longOffset' })
      .formatToParts(at)
      .find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
  return m ? `${m[1]}${m[2]}${m[3]}` : '+0000';
}

/** Short zone label for display next to times, e.g. `GMT+5:30` or `EST`. */
export function zoneLabel(timezone: string, at: Date): string {
  return (
    new Intl.DateTimeFormat('en-US', { timeZone: timezone, timeZoneName: 'short' })
      .formatToParts(at)
      .find((p) => p.type === 'timeZoneName')?.value ?? timezone
  );
}

/**
 * A UTC timestamp shown in the user's timezone with the Angular date formatter, plus the zone label:
 * `{{ createdAt | bfDateTime: timezone }}` gives `2 Nov 2026, 15:30 GMT+5:30`.
 */
@Pipe({ name: 'bfDateTime' })
export class DateTimePipe implements PipeTransform {
  transform(
    value: string | Date | null | undefined,
    timezone: string,
    format = 'd MMM y, HH:mm',
  ): string {
    if (value === null || value === undefined || value === '') return '';
    const at = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(at.getTime())) return '';
    return `${formatDate(at, format, 'en-US', utcOffset(timezone, at))} ${zoneLabel(timezone, at)}`;
  }
}

/** The calendar date of a UTC timestamp in the user's timezone, without a zone label: `2 Nov 2026`. */
@Pipe({ name: 'bfDate' })
export class DateOnlyPipe implements PipeTransform {
  transform(value: string | Date | null | undefined, timezone: string, format = 'd MMM y'): string {
    if (value === null || value === undefined || value === '') return '';
    const at = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(at.getTime())) return '';
    return formatDate(at, format, 'en-US', utcOffset(timezone, at));
  }
}
