// Roster validation, import mapping and safe export (spec §8).
// Minimal data by design: player name + jersey number (+ optional approved position).

export const ROSTER_NAME_MAX = 80;
export const ROSTER_FILE_MAX_BYTES = 256 * 1024;
export const ROSTER_IMPORT_MAX_ROWS = 100;

/** Jersey numbers are strings so "0" and "00" stay distinct. Accepts "#7", " 07 ". */
export function normalizeJersey(raw: unknown): { ok: true; value: string } | { ok: false; message: string } {
  const s = String(raw ?? '').trim().replace(/^#/, '').trim();
  if (s === '') return { ok: false, message: 'Jersey number is required.' };
  if (!/^\d{1,2}$/.test(s)) return { ok: false, message: 'Jersey number must be 1–2 digits (0–99, or 00).' };
  return { ok: true, value: s };
}

// Letters (any script), spaces, hyphens, apostrophes and periods. Rejects digits, symbols and
// leading formula characters, which also keeps exports safe.
const NAME_RE = /^[\p{L}][\p{L}\p{M} .'’-]*$/u;

export function normalizePlayerName(raw: unknown): { ok: true; value: string } | { ok: false; message: string } {
  const s = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (s === '') return { ok: false, message: 'Player name is required.' };
  if (s.length > ROSTER_NAME_MAX) return { ok: false, message: `Player name must be ${ROSTER_NAME_MAX} characters or fewer.` };
  if (!NAME_RE.test(s)) return { ok: false, message: 'Player name may contain letters, spaces, hyphens, apostrophes and periods only.' };
  return { ok: true, value: s };
}

export interface RosterRowInput {
  playerName: unknown;
  jerseyNumber: unknown;
}

export interface RosterRowResult {
  index: number; // 0-based input index
  sourceRow?: number; // 1-based line in an uploaded file (header = 1)
  playerName: string;
  jerseyNumber: string;
  errors: string[];
  warnings: string[];
}

export interface RosterValidation {
  rows: RosterRowResult[];
  errors: string[]; // roster-level problems
  valid: boolean;
}

export interface RosterRules {
  maxSize: number | null;
  allowDuplicateJersey: boolean;
}

export function validateRoster(rows: (RosterRowInput & { sourceRow?: number })[], rules: RosterRules): RosterValidation {
  const out: RosterRowResult[] = rows.map((r, index) => {
    const n = normalizePlayerName(r.playerName);
    const j = normalizeJersey(r.jerseyNumber);
    const errors: string[] = [];
    if (!n.ok) errors.push(n.message);
    if (!j.ok) errors.push(j.message);
    return {
      index,
      sourceRow: r.sourceRow,
      playerName: n.ok ? n.value : String(r.playerName ?? '').trim(),
      jerseyNumber: j.ok ? j.value : String(r.jerseyNumber ?? '').trim(),
      errors,
      warnings: [],
    };
  });

  const byJersey = new Map<string, RosterRowResult[]>();
  const byName = new Map<string, RosterRowResult[]>();
  for (const r of out) {
    if (r.jerseyNumber) {
      const list = byJersey.get(r.jerseyNumber) ?? [];
      list.push(r);
      byJersey.set(r.jerseyNumber, list);
    }
    const key = r.playerName.toLocaleLowerCase();
    if (key) {
      const list = byName.get(key) ?? [];
      list.push(r);
      byName.set(key, list);
    }
  }
  for (const [num, list] of byJersey) {
    if (list.length < 2) continue;
    for (const r of list) {
      const msg = `Jersey #${num} is used more than once.`;
      (rules.allowDuplicateJersey ? r.warnings : r.errors).push(msg);
    }
  }
  for (const list of byName.values()) {
    if (list.length < 2) continue;
    for (const r of list) r.warnings.push('This player name appears more than once.');
  }

  const errors: string[] = [];
  if (rules.maxSize !== null && out.length > rules.maxSize) {
    errors.push(`Roster has ${out.length} players; the limit is ${rules.maxSize}.`);
  }
  return { rows: out, errors, valid: errors.length === 0 && out.every((r) => r.errors.length === 0) };
}

// ---------------------------------------------------------------------------------------
// CSV

/** RFC 4180 CSV parser (quoted fields, escaped quotes, CRLF). No eval, no type coercion. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field === '') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

export interface ColumnMapping {
  playerName?: number;
  firstName?: number;
  lastName?: number;
  jerseyNumber?: number;
}

const norm = (h: string) => h.toLowerCase().replace(/[^a-z#]/g, '');

export function detectColumns(header: string[]): ColumnMapping {
  const m: ColumnMapping = {};
  header.forEach((h, i) => {
    const k = norm(h);
    if (['name', 'player', 'playername', 'fullname'].includes(k)) m.playerName ??= i;
    else if (['first', 'firstname'].includes(k)) m.firstName ??= i;
    else if (['last', 'lastname', 'surname'].includes(k)) m.lastName ??= i;
    else if (['jersey', 'jerseynumber', 'number', '#', 'no', 'num', 'jersey#'].includes(k)) m.jerseyNumber ??= i;
  });
  return m;
}

export interface ImportPreview {
  mapping: ColumnMapping;
  header: string[];
  validation: RosterValidation;
  fileErrors: string[];
}

/** Turn parsed cells into a validated preview. Nothing is persisted here. */
export function previewRosterImport(cells: string[][], rules: RosterRules): ImportPreview {
  const fileErrors: string[] = [];
  const [header = [], ...body] = cells;
  const mapping = detectColumns(header);
  const hasName = mapping.playerName !== undefined || (mapping.firstName !== undefined && mapping.lastName !== undefined);
  if (!hasName) fileErrors.push('Could not find a "Player Name" column (or "First Name" and "Last Name").');
  if (mapping.jerseyNumber === undefined) fileErrors.push('Could not find a "Jersey Number" column.');
  if (body.length === 0) fileErrors.push('The file has no player rows.');
  if (body.length > ROSTER_IMPORT_MAX_ROWS) fileErrors.push(`The file has ${body.length} rows; the import limit is ${ROSTER_IMPORT_MAX_ROWS}.`);
  if (fileErrors.length) {
    return { mapping, header, validation: { rows: [], errors: [], valid: false }, fileErrors };
  }
  const rows = body.slice(0, ROSTER_IMPORT_MAX_ROWS).map((c, i) => ({
    sourceRow: i + 2,
    playerName:
      mapping.playerName !== undefined
        ? c[mapping.playerName]
        : `${c[mapping.firstName!] ?? ''} ${c[mapping.lastName!] ?? ''}`,
    jerseyNumber: c[mapping.jerseyNumber!],
  }));
  return { mapping, header, validation: validateRoster(rows, rules), fileErrors };
}

/** Neutralize spreadsheet formula injection (OWASP CSV injection) and quote per RFC 4180. */
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) || s !== s.trim() ? `"${s.replace(/"/g, '""')}"` : s;
}

export const toCsv = (rows: unknown[][]) => rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

export const ROSTER_TEMPLATE_CSV = toCsv([
  ['Player Name', 'Jersey Number'],
  ['DEMO Player One', '7'],
  ['DEMO Player Two', '00'],
]);
