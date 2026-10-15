import { describe, expect, it } from 'vitest';
import { csvCell, normalizeJersey, normalizePlayerName, parseCsv, previewRosterImport, toCsv, validateRoster } from '../src/roster';

describe('normalizeJersey', () => {
  it('keeps 0 and 00 distinct and strips #', () => {
    expect(normalizeJersey('00')).toEqual({ ok: true, value: '00' });
    expect(normalizeJersey('0')).toEqual({ ok: true, value: '0' });
    expect(normalizeJersey(' #7 ')).toEqual({ ok: true, value: '7' });
  });
  it('rejects non-numeric and long values', () => {
    expect(normalizeJersey('7a').ok).toBe(false);
    expect(normalizeJersey('100').ok).toBe(false);
    expect(normalizeJersey('').ok).toBe(false);
  });
});

describe('normalizePlayerName', () => {
  it('accepts real-world names and collapses whitespace', () => {
    expect(normalizePlayerName("  José  O'Neil-Smith Jr. ")).toEqual({ ok: true, value: "José O'Neil-Smith Jr." });
  });
  it('rejects formula payloads and symbols', () => {
    expect(normalizePlayerName('=HYPERLINK("http://x")').ok).toBe(false);
    expect(normalizePlayerName('<script>').ok).toBe(false);
  });
});

describe('validateRoster', () => {
  it('flags duplicate jerseys as errors unless allowed', () => {
    const rows = [{ playerName: 'Alex Demo', jerseyNumber: '7' }, { playerName: 'Blake Demo', jerseyNumber: '7' }];
    expect(validateRoster(rows, { maxSize: null, allowDuplicateJersey: false }).valid).toBe(false);
    const allowed = validateRoster(rows, { maxSize: null, allowDuplicateJersey: true });
    expect(allowed.valid).toBe(true);
    expect(allowed.rows[0]!.warnings).toHaveLength(1);
  });
  it('enforces max size', () => {
    const rows = [{ playerName: 'A Demo', jerseyNumber: '1' }, { playerName: 'B Demo', jerseyNumber: '2' }];
    const v = validateRoster(rows, { maxSize: 1, allowDuplicateJersey: false });
    expect(v.valid).toBe(false);
    expect(v.errors[0]).toMatch(/limit is 1/);
  });
});

describe('parseCsv', () => {
  it('handles quotes, escaped quotes, CRLF and BOM', () => {
    expect(parseCsv('﻿Name,No\r\n"Smith, Jr.",7\r\n"Say ""Hi""",00\r\n\r\n')).toEqual([
      ['Name', 'No'], ['Smith, Jr.', '7'], ['Say "Hi"', '00'],
    ]);
  });
});

describe('previewRosterImport', () => {
  it('maps headers and reports row-level errors without committing', () => {
    const cells = parseCsv('Player Name,Jersey #\nAlex Demo,7\nBlake Demo,7\n,12\nCasey Demo,abc\n');
    const p = previewRosterImport(cells, { maxSize: 20, allowDuplicateJersey: false });
    expect(p.fileErrors).toEqual([]);
    expect(p.validation.valid).toBe(false);
    expect(p.validation.rows.map((r) => [r.sourceRow, r.errors.length])).toEqual([[2, 1], [3, 1], [4, 1], [5, 1]]);
  });
  it('supports first/last name columns', () => {
    const p = previewRosterImport(parseCsv('First Name,Last Name,Number\nAlex,Demo,3\n'), { maxSize: null, allowDuplicateJersey: false });
    expect(p.validation.rows[0]!.playerName).toBe('Alex Demo');
    expect(p.validation.valid).toBe(true);
  });
  it('reports missing columns', () => {
    const p = previewRosterImport(parseCsv('Foo,Bar\n1,2\n'), { maxSize: null, allowDuplicateJersey: false });
    expect(p.fileErrors).toHaveLength(2);
  });
});

describe('csv export safety', () => {
  it('neutralizes formula injection', () => {
    expect(csvCell('=cmd|calc')).toBe("'=cmd|calc");
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(toCsv([['a,b', 'c"d']])).toBe('"a,b","c""d"\r\n');
  });
});
