/**
 * One CSV cell for a file a person opens in a spreadsheet. A text cell starting with `=`, `+`, `-`,
 * `@`, a tab or a carriage return is prefixed with an apostrophe so the spreadsheet shows it as text
 * instead of running it as a formula (CSV formula injection). Plain numbers, negative ones included,
 * stay numbers. Quotes, commas and line breaks are quoted as usual.
 */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  const safe = /^-?\d+(\.\d+)?$/.test(s) || !/^[=+\-@\t\r]/.test(s) ? s : `'${s}`;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
