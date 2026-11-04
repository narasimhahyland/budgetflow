import { err, ok, type Result } from '../result';
import { ORG_UNIT_KINDS, validateParentKind, type OrgUnitKind } from './hierarchy';

/** One problem in an uploaded file: 1-based line number (header is line 1), column and message. */
export interface ImportIssue {
  line: number;
  field: string | null;
  message: string;
}

export const IMPORT_MAX_ROWS = 5000;

/**
 * Parses RFC 4180 CSV (quoted fields, escaped quotes, CRLF or LF). Returns header names (trimmed,
 * lower-cased) and rows keyed by header, with the 1-based file line of each row.
 */
export function parseCsv(
  text: string,
): Result<{ headers: string[]; rows: { line: number; values: Record<string, string> }[] }> {
  const records: string[][] = [];
  const lines: number[] = [];
  let field = '';
  let record: string[] = [];
  let inQuotes = false;
  let line = 1;
  let recordLine = 1;
  const src = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') inQuotes = false;
      else {
        if (c === '\n') line++;
        field += c;
      }
      continue;
    }
    if (c === '"') inQuotes = true;
    else if (c === ',') {
      record.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      record.push(field);
      records.push(record);
      lines.push(recordLine);
      record = [];
      field = '';
      line++;
      recordLine = line;
    } else field += c;
  }
  if (inQuotes) return err('IMPORT_INVALID', 'The file has an unclosed quoted value.');
  if (field !== '' || record.length) {
    record.push(field);
    records.push(record);
    lines.push(recordLine);
  }
  const nonEmpty = records
    .map((r, i) => ({ r, line: lines[i] }))
    .filter(({ r }) => r.some((v) => v.trim() !== ''));
  if (nonEmpty.length === 0) return err('IMPORT_INVALID', 'The file is empty.');
  const headers = nonEmpty[0].r.map((h) => h.trim().toLowerCase());
  const body = nonEmpty.slice(1);
  if (body.length > IMPORT_MAX_ROWS) {
    return err('IMPORT_INVALID', `Files are limited to ${IMPORT_MAX_ROWS} rows.`, {
      rows: body.length,
    });
  }
  return ok({
    headers,
    rows: body.map(({ r, line: l }) => ({
      line: l,
      values: Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? '').trim()])),
    })),
  });
}

function missingColumns(headers: string[], required: readonly string[]): string[] {
  return required.filter((c) => !headers.includes(c));
}

// HR headcount -----------------------------------------------------------------------------------

export const EMPLOYMENT_TYPES = ['employee', 'contractor', 'intern'] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];

export const HEADCOUNT_COLUMNS = [
  'location_code',
  'team_code',
  'employment_type',
  'headcount',
  'prorated_headcount',
] as const;

/** Units the importer may reference, by code: kind and the codes of every ancestor (self included). */
export interface KnownUnit {
  id: string;
  code: string;
  kind: OrgUnitKind;
  ancestorCodes: readonly string[];
}

export interface HeadcountLine {
  line: number;
  locationId: string;
  locationCode: string;
  /** The team or department counted, or the location itself when the row names no team. */
  unitId: string;
  unitCode: string;
  employmentType: EmploymentType;
  headcount: number;
  /** Prorated headcount in thousandths (joiners and leavers in the period), for per-head proration. */
  proratedHeadcountMilli: number;
}

/**
 * Validates an HR headcount file: one row per location (optionally team) and employment type.
 * Every problem is reported with its line; nothing is applied when any row is invalid.
 */
export function validateHeadcountRows(
  parsed: { headers: string[]; rows: { line: number; values: Record<string, string> }[] },
  units: ReadonlyMap<string, KnownUnit>,
): Result<{ lines: HeadcountLine[]; issues: ImportIssue[] }> {
  const missing = missingColumns(parsed.headers, ['location_code', 'employment_type', 'headcount']);
  if (missing.length) {
    return err('IMPORT_INVALID', `The file is missing the column(s): ${missing.join(', ')}.`, {
      missing: missing.join(','),
    });
  }
  const issues: ImportIssue[] = [];
  const lines: HeadcountLine[] = [];
  const seen = new Set<string>();
  for (const { line, values } of parsed.rows) {
    const issue = (field: string | null, message: string) => issues.push({ line, field, message });
    const loc = units.get(values['location_code'] ?? '');
    if (!loc || loc.kind !== 'location') {
      issue('location_code', `"${values['location_code'] ?? ''}" is not a location code.`);
      continue;
    }
    const teamCode = values['team_code'] ?? '';
    let unit: KnownUnit = loc;
    if (teamCode) {
      const team = units.get(teamCode);
      if (!team || (team.kind !== 'team' && team.kind !== 'department')) {
        issue('team_code', `"${teamCode}" is not a team or department code.`);
        continue;
      }
      if (!team.ancestorCodes.includes(loc.code)) {
        issue('team_code', `Team ${teamCode} is not part of location ${loc.code}.`);
        continue;
      }
      unit = team;
    }
    const type = values['employment_type'] as EmploymentType;
    if (!EMPLOYMENT_TYPES.includes(type)) {
      issue('employment_type', 'Employment type must be employee, contractor or intern.');
      continue;
    }
    const hc = values['headcount'] ?? '';
    if (!/^\d{1,7}$/.test(hc)) {
      issue('headcount', 'Headcount must be a whole number of zero or more.');
      continue;
    }
    const headcount = Number(hc);
    const proratedRaw = values['prorated_headcount'] ?? '';
    let proratedHeadcountMilli = headcount * 1000;
    if (proratedRaw) {
      const m = /^(\d{1,7})(?:\.(\d{1,3}))?$/.exec(proratedRaw);
      if (!m) {
        issue('prorated_headcount', 'Prorated headcount must be a number with up to 3 decimals.');
        continue;
      }
      proratedHeadcountMilli = Number(m[1]) * 1000 + Number((m[2] ?? '').padEnd(3, '0') || '0');
      if (proratedHeadcountMilli > headcount * 1000) {
        issue('prorated_headcount', 'Prorated headcount cannot exceed headcount.');
        continue;
      }
    }
    const key = `${unit.id}|${type}`;
    if (seen.has(key)) {
      issue(null, `Duplicate row for ${unit.code} (${type}).`);
      continue;
    }
    seen.add(key);
    lines.push({
      line,
      locationId: loc.id,
      locationCode: loc.code,
      unitId: unit.id,
      unitCode: unit.code,
      employmentType: type,
      headcount,
      proratedHeadcountMilli,
    });
  }
  if (lines.length === 0 && issues.length === 0) {
    return err('IMPORT_INVALID', 'The file has a header but no rows.');
  }
  return ok({ lines, issues });
}

// Org hierarchy import ---------------------------------------------------------------------------

export const ORG_IMPORT_COLUMNS = [
  'code',
  'name',
  'kind',
  'parent_code',
  'legal_entity_code',
  'timezone',
] as const;

export interface ExistingUnit {
  id: string;
  code: string;
  name: string;
  kind: OrgUnitKind;
  parentCode: string | null;
}

export type OrgImportOp =
  | {
      op: 'create';
      line: number;
      code: string;
      name: string;
      kind: OrgUnitKind;
      parentCode: string | null;
      legalEntityCode: string | null;
      timezone: string | null;
    }
  | {
      op: 'change';
      line: number;
      unitId: string;
      code: string;
      name: string | null;
      parentCode: string | null;
    }
  | { op: 'unchanged'; line: number; unitId: string; code: string };

/**
 * Validates an org hierarchy file against existing units (by code) and orders the operations so a
 * parent is always created before its children. Existing units can be renamed or moved; kinds never change.
 */
export function planOrgImport(
  parsed: { headers: string[]; rows: { line: number; values: Record<string, string> }[] },
  existing: ReadonlyMap<string, ExistingUnit>,
  legalEntityCodes: ReadonlySet<string>,
): Result<{ ops: OrgImportOp[]; issues: ImportIssue[] }> {
  const missing = missingColumns(parsed.headers, ['code', 'name', 'kind', 'parent_code']);
  if (missing.length) {
    return err('IMPORT_INVALID', `The file is missing the column(s): ${missing.join(', ')}.`, {
      missing: missing.join(','),
    });
  }
  const issues: ImportIssue[] = [];
  const fileRows = new Map<string, { line: number; values: Record<string, string> }>();
  for (const row of parsed.rows) {
    const code = row.values['code'] ?? '';
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,49}$/.test(code)) {
      issues.push({
        line: row.line,
        field: 'code',
        message: 'Codes use letters, digits, dot, dash or underscore (up to 50).',
      });
      continue;
    }
    if (fileRows.has(code)) {
      issues.push({ line: row.line, field: 'code', message: `Code ${code} appears twice.` });
      continue;
    }
    fileRows.set(code, row);
  }
  const kindOf = (code: string): OrgUnitKind | null => {
    const inFile = fileRows.get(code)?.values['kind'] as OrgUnitKind | undefined;
    if (inFile && ORG_UNIT_KINDS.includes(inFile)) return inFile;
    return existing.get(code)?.kind ?? null;
  };
  const ops = new Map<string, OrgImportOp>();
  for (const [code, { line, values }] of fileRows) {
    const issue = (field: string | null, message: string) => issues.push({ line, field, message });
    const kind = values['kind'] as OrgUnitKind;
    if (!ORG_UNIT_KINDS.includes(kind)) {
      issue('kind', `Kind must be one of: ${ORG_UNIT_KINDS.join(', ')}.`);
      continue;
    }
    const name = values['name'] ?? '';
    if (!name || name.length > 200) {
      issue('name', 'Name is required (up to 200 characters).');
      continue;
    }
    const parentCode = values['parent_code'] || null;
    if (parentCode && !fileRows.has(parentCode) && !existing.has(parentCode)) {
      issue('parent_code', `Parent ${parentCode} is neither in the file nor an existing unit.`);
      continue;
    }
    const parentKind = parentCode ? kindOf(parentCode) : null;
    const kindCheck = validateParentKind(kind, parentKind);
    if (!kindCheck.ok) {
      issue('parent_code', kindCheck.error.message);
      continue;
    }
    const entity = values['legal_entity_code'] || null;
    if (entity && !legalEntityCodes.has(entity)) {
      issue('legal_entity_code', `Unknown legal entity ${entity}.`);
      continue;
    }
    const current = existing.get(code);
    if (current) {
      if (current.kind !== kind) {
        issue('kind', `Unit ${code} is a ${current.kind}; kinds cannot change through an import.`);
        continue;
      }
      const renamed = current.name !== name;
      const moved = current.parentCode !== parentCode;
      ops.set(
        code,
        renamed || moved
          ? {
              op: 'change',
              line,
              unitId: current.id,
              code,
              name: renamed ? name : null,
              parentCode: moved ? parentCode : null,
            }
          : { op: 'unchanged', line, unitId: current.id, code },
      );
    } else {
      ops.set(code, {
        op: 'create',
        line,
        code,
        name,
        kind,
        parentCode,
        legalEntityCode: entity,
        timezone: values['timezone'] || null,
      });
    }
  }
  // Cycle check across the resulting parent links, then parents-first ordering.
  const parentOf = (code: string): string | null => {
    const op = ops.get(code);
    if (op?.op === 'create') return op.parentCode;
    if (op?.op === 'change' && op.parentCode !== null) return op.parentCode;
    return existing.get(code)?.parentCode ?? null;
  };
  for (const code of ops.keys()) {
    const seen = new Set<string>([code]);
    let p = parentOf(code);
    while (p) {
      if (seen.has(p)) {
        issues.push({
          line: ops.get(code)!.line,
          field: 'parent_code',
          message: `Unit ${code} would end up under itself.`,
        });
        ops.delete(code);
        break;
      }
      seen.add(p);
      p = parentOf(p);
    }
  }
  const ordered: OrgImportOp[] = [];
  const placed = new Set<string>();
  const place = (code: string, depth = 0) => {
    if (placed.has(code) || depth > 1000) return;
    const parent = parentOf(code);
    if (parent && ops.has(parent)) place(parent, depth + 1);
    placed.add(code);
    ordered.push(ops.get(code)!);
  };
  for (const code of ops.keys()) place(code);
  return ok({ ops: ordered, issues });
}
