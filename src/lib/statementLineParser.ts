/**
 * Bank-statement LINE parsing (no PDF dependency).
 *
 * Turns reconstructed text lines from a bank statement into
 * `['Date', 'Amount', 'Description']` rows so the normal column-mapping
 * flow can be reused. Kept free of pdf.js so it can be unit-tested in Node.
 */

import { parseDate, parseAmount, parseStatementDate } from '@/lib/importUtils';

export const MONTHS = '(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*';

/** Extra date patterns beyond importUtils.parseDate (common on bank PDFs). */
export function parseDateLoose(raw: string): string | null {
  const t = raw.trim();
  const fromCore = parseDate(t);
  if (fromCore) return fromCore;

  let m = t.match(new RegExp(`^(\\d{1,2})[-\\s/](${MONTHS})[-\\s/](\\d{4})$`, 'i'));
  if (m) {
    const mon = monthToNum(m[2]!);
    if (!mon) return null;
    const d = m[1]!.padStart(2, '0');
    return `${m[3]}-${mon}-${d}`;
  }

  m = t.match(new RegExp(`^(${MONTHS})\\s+(\\d{1,2}),?\\s+(\\d{4})$`, 'i'));
  if (m) {
    const mon = monthToNum(m[1]!);
    if (!mon) return null;
    const d = m[2]!.padStart(2, '0');
    return `${m[3]}-${mon}-${d}`;
  }

  return null;
}

function monthToNum(m: string): string | null {
  const map: Record<string, string> = {
    jan: '01',
    feb: '02',
    mar: '03',
    apr: '04',
    may: '05',
    jun: '06',
    jul: '07',
    aug: '08',
    sep: '09',
    oct: '10',
    nov: '11',
    dec: '12',
  };
  const k = m.slice(0, 3).toLowerCase();
  return map[k] ?? null;
}

/**
 * Parse dates like "Apr 15" or "Jan 03" without year.
 * Infers year from current date (assumes recent transaction within past 12 months).
 */
export function parseDateMonthDayOnly(raw: string): string | null {
  const t = raw.trim();
  const m = t.match(new RegExp(`^(${MONTHS})\\s+(\\d{1,2})$`, 'i'));
  if (!m) return null;

  const mon = monthToNum(m[1]!);
  if (!mon) return null;

  const day = m[2]!.padStart(2, '0');

  // Infer year: use current year, or previous year if the month is in the future
  // (bank statements are always historical, never future-dated).
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1; // JS months are 0-indexed
  const transactionMonth = parseInt(mon, 10);

  let year = currentYear;
  if (transactionMonth > currentMonth) year = currentYear - 1;

  return `${year}-${mon}-${day}`;
}

/**
 * Parse dates like "15 Apr" or "03 Jan" without year (day-month order).
 * Infers year from current date (assumes recent transaction within past 12 months).
 */
export function parseDateDayMonthOnly(raw: string): string | null {
  const t = raw.trim();
  const m = t.match(new RegExp(`^(\\d{1,2})\\s+(${MONTHS})$`, 'i'));
  if (!m) return null;

  const mon = monthToNum(m[2]!);
  if (!mon) return null;

  const day = m[1]!.padStart(2, '0');

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  const transactionMonth = parseInt(mon, 10);

  let year = currentYear;
  if (transactionMonth > currentMonth) year = currentYear - 1;

  return `${year}-${mon}-${day}`;
}

/** Tolerant amount parser: handles symbols, spaces, parentheses, EU/US decimals. */
export function parseAmountLoose(amountStr: string): number | null {
  if (!amountStr) return null;

  let t = amountStr.replace(/[$€£¥₹]/g, '').replace(/\s/g, '').trim();

  // Reject plain dash/hyphen (placeholder in debit/credit columns)
  if (t === '-' || t === '—' || t === '–') return null;

  // Trailing minus: "1,234.56-" / "89.50-" (some banks put the sign last)
  if (t.startsWith('(') && t.endsWith(')')) {
    t = '-' + t.slice(1, -1);
  } else if (/^[\d.,]+-$/.test(t)) {
    t = '-' + t.slice(0, -1);
  }

  // EU style: 1.234,56 or 12,34 (decimal comma)
  if (/^\d{1,3}(\.\d{3})*,\d{2}$/.test(t) || /^\d+,\d{2}$/.test(t)) {
    t = t.replace(/\./g, '').replace(',', '.');
  } else {
    t = t.replace(/,/g, '');
  }

  const n = parseFloat(t);
  return Number.isFinite(n) && n !== 0 ? n : null; // Reject 0 amounts
}

const SKIP_LINE =
  /^(opening\s+balance|beginning\s+balance|ending\s+balance|closing\s+balance|balance\s+as|page\s+\d|statement\s*period|total\s+(transactions|debit|credit)|continued\s+on|amount\s*\(|date\s*\(|transaction\s*date$|date\s+description\s+|description\s+reference\s+amount|debit\s+credit\s+balance|withdrawals?\s+deposits?\s+balance|statement\s+date|account\s+holder|account\s+number|account\s+type|global\s+bank|^\d{4}$|^imported$)/i;

/** Filter out metadata, account headers, summary blocks, and footers from transaction extraction */
export function isMetadataOrSummaryLine(text: string): boolean {
  const t = text.trim();
  if (t.length < 3) return true;
  if (SKIP_LINE.test(t)) return true;
  
  // Header / Account metadata patterns
  if (/\b(account\s+holder|account\s+number|account\s+type|account\s+details|statement\s+period|statement\s+date|statement\s+summary|billing\s+period|customer\s+service|branch|routing\s+number|swift\s+code|iban)\b/i.test(t)) {
    return true;
  }
  
  // Bank names / tagline
  if (/\b(premier\s+business\s+bank|global\s+bank|trusted\s+financial\s+partner|financial\s+center|downtown\s+financial)\b/i.test(t)) {
    return true;
  }
  
  // Balance summary boxes / totals
  if (/\b(opening\s+balance|beginning\s+balance|closing\s+balance|ending\s+balance|balance\s+b\/f|balance\s+c\/f|balance\s+forward|total\s+credits?|total\s+debits?|total\s+deposits?|total\s+withdrawals?|total\s+transactions?|net\s+change)\b/i.test(t)) {
    return true;
  }
  
  // Footer / Disclaimers / Contact info
  if (/\b(questions\s+about\s+your\s+statement|security\s+notice|member\s+fdic|equal\s+housing\s+lender|official\s+bank\s+document|keep\s+for\s+your\s+records|1-800-|online\s+banking|computer-generated\s+statement)\b/i.test(t)) {
    return true;
  }
  
  // Section headers (with or without surrounding text)
  if (/^(transaction\s+details|transaction\s+history|account\s+statement)$/i.test(t)) {
    return true;
  }
  
  // PDF page headers: "Bank Statement - Month Year" or just "Bank Statement"
  if (/^bank\s+statement/i.test(t)) {
    return true;
  }
  
  // Print timestamp headers: "10/14/26, 8:26 PM" or similar page header timestamps
  if (/^\d{1,2}\/\d{1,2}\/\d{2,4},?\s+\d{1,2}:\d{2}\s*(AM|PM)?$/i.test(t)) {
    return true;
  }
  
  // Combined page header: "10/14/26, 8:26 PM Bank Statement - June 2026"
  if (/\d{1,2}:\d{2}\s*(AM|PM)?\s+bank\s+statement/i.test(t)) {
    return true;
  }
  
  // Column header lines: "DATE DESCRIPTION TYPE AMOUNT" or similar
  if (/^date\s+(description|details|particulars|narration)\s+(type|dr\/cr|debit|credit)\s+(amount|balance)/i.test(t)) {
    return true;
  }
  
  // Page numbers: "1/3", "2/3", "Page 1 of 3", etc.
  if (/^\d+\/\d+$/.test(t) || /^page\s+\d+\s+(of|\/)\s+\d+$/i.test(t)) {
    return true;
  }
  
  // Account services & support sections
  if (/\b(account\s+services|need\s+assistance|dedicated\s+account\s+manager|digital\s+banking|mobile\s+app|wire\s+transfers|statement\s+review|report\s+any\s+discrepancies)\b/i.test(t)) {
    return true;
  }
  
  // File path references from HTML-to-PDF conversion
  if (/^file:\/\/\//i.test(t) || /\.html?$/i.test(t)) {
    return true;
  }

  return false;
}

/** Find the first usable date on a line, whatever the bank's format is. */
export function findDateInLine(line: string): { raw: string; norm: string; index: number } | null {
  const patterns: RegExp[] = [
    // ISO: 2026-04-01 / 2026/04/01 / 2026.04.01
    /\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2}/,
    // Numeric with 2 or 4 digit year: 01/04/2026, 01-04-2026, 01.04.26
    /\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}/,
    // 01-Apr-2026 / 01 Apr 2026
    new RegExp(`\\d{1,2}[-\\s/](${MONTHS})[-\\s/]\\d{4}`, 'i'),
    // Apr 01, 2026 (comma optional)
    new RegExp(`(${MONTHS})\\s+\\d{1,2},?\\s+\\d{4}`, 'i'),
    // Apr 01 26
    new RegExp(`\\d{1,2}[-\\s/](${MONTHS})[-\\s/]\\d{2}`, 'i'),
    new RegExp(`(${MONTHS})\\s+\\d{1,2}\\s+\\d{2}`, 'i'),
    // No year at all: "Apr 01" / "01 Apr" (year inferred from today)
    new RegExp(`(${MONTHS})\\s+\\d{1,2}(?![\\d,])`, 'i'),
    new RegExp(`\\d{1,2}\\s+(${MONTHS})(?![\\d,])`, 'i'),
    // Fri May 02
    /(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+[A-Za-z]{3}\s+\d{1,2}/i,
  ];

  for (const re of patterns) {
    const m = line.match(re);
    if (!m || m.index === undefined) continue;
    const raw = m[0];
    const norm =
      parseStatementDate(raw) ??
      parseDateLoose(raw) ??
      parseDate(raw) ??
      parseDateMonthDayOnly(raw) ??
      parseDateDayMonthOnly(raw);
    if (norm) return { raw, norm, index: m.index };
  }
  return null;
}

/** First real money token on the line (skips balance column, dashes, plain numbers). */
export function findAmountToken(tokens: string[]): { amountStr: string; amountIndex: number } | null {
  // Two-pass approach:
  // Pass 1: Prefer tokens with explicit currency/decimal markers (safest)
  // Pass 2: Accept plain integers >= 100 that are not years or day/month codes
  const integerCandidates: Array<{ amountStr: string; amountIndex: number }> = [];

  for (let i = 0; i < tokens.length; i++) {
    let chunk = tokens[i]!;

    // Skip standalone dashes (placeholder in empty debit/credit cells)
    if (chunk === '-' || chunk === '\u2014' || chunk === '\u2013') continue;

    // Skip standalone 4-digit years (2020, 2021, etc.) - these are NOT amounts
    if (/^\d{4}$/.test(chunk)) {
      const year = parseInt(chunk, 10);
      if (year >= 1900 && year <= 2100) continue;
    }

    // Skip 1-2 digit numbers that are clearly days/months, not amounts
    if (/^\d{1,2}$/.test(chunk)) continue;

    // Handle CR/DR indicators attached to previous token
    if (i < tokens.length - 1 && /^(CR|DR)$/i.test(tokens[i + 1]!)) {
      const base = chunk;
      const combined = `${chunk} ${tokens[i + 1]!}`;
      const a = parseAmountLoose(base);
      if (a !== null) {
        return { amountStr: combined, amountIndex: i };
      }
      i++; // Skip the CR/DR token
      continue;
    }

    // Pass 1 (strict): require currency symbol, decimal point, or thousands comma
    const a = parseAmountLoose(chunk) ?? parseAmount(chunk);
    if (a !== null && /[$\u20ac\u00a3\u00a5\u20b9,\.]/.test(chunk)) {
      return { amountStr: chunk, amountIndex: i };
    }

    // Pass 2 candidate: plain integer >= 100 (save for fallback)
    if (/^\d{3,}$/.test(chunk)) {
      const n = parseInt(chunk, 10);
      // Must be >= 100 and not a year
      if (n >= 100 && !(n >= 1900 && n <= 2100)) {
        integerCandidates.push({ amountStr: chunk, amountIndex: i });
      }
    }

    // Pass 2 candidate: negative integer (e.g. -500)
    if (/^-\d{3,}$/.test(chunk)) {
      integerCandidates.push({ amountStr: chunk, amountIndex: i });
    }
  }

  // Return last integer candidate (amounts are usually at the end of a bank statement line)
  if (integerCandidates.length > 0) {
    return integerCandidates[integerCandidates.length - 1]!;
  }

  return null;
}


/** Parse "… date … description … amount" — amount only after first date (common bank layout). */
function tryParseAfterDateOnly(trimmed: string): { date: string; amount: number; narration: string } | null {
  if (isMetadataOrSummaryLine(trimmed)) return null;

  const dh = findDateInLine(trimmed);
  if (!dh) return null;

  const afterDate = trimmed.slice(dh.index + dh.raw.length).trim();
  const prefix = trimmed.slice(0, dh.index).trim();
  const tokens = afterDate.split(/\s+/);
  if (!tokens.length) return null;

  const amtHit = findAmountToken(tokens);
  if (!amtHit) return null;

  const rawAmtStr = amtHit.amountStr;
  const amt = parseAmountLoose(rawAmtStr.replace(/\s*(CR|DR)\s*$/i, '')) ?? parseAmount(rawAmtStr.replace(/\s*(CR|DR)\s*$/i, ''));
  if (amt === null) return null;

  const narrMiddle = tokens.slice(0, amtHit.amountIndex).join(' ').trim();
  const narration = [prefix, narrMiddle].filter(Boolean).join(' — ').trim() || 'Imported';

  const isDebit = /\b(dr|debit|withdrawal|expense|fee|charge)\b/i.test(rawAmtStr) ||
    /\b(dr|debit|withdrawal|expense|fee|charge)\b/i.test(narration) ||
    /\b(dr|debit|withdrawal)\b/i.test(trimmed);
  const isCredit = /\b(cr|credit|deposit|refund|income)\b/i.test(rawAmtStr) ||
    /\b(cr|credit|deposit|refund|income)\b/i.test(narration) ||
    /\b(cr|credit|deposit)\b/i.test(trimmed);

  let signedAmt = amt;
  if (isDebit && !isCredit && amt > 0) {
    signedAmt = -amt;
  } else if (isCredit && !isDebit && amt < 0) {
    signedAmt = Math.abs(amt);
  }

  return { date: dh.norm, amount: signedAmt, narration };
}

/** Parse one reconstructed statement line into a transaction row. */
export function tryParseStatementLine(line: string): { date: string; amount: number; narration: string } | null {
  const trimmed = line.replace(/\s+/g, ' ').trim();
  if (trimmed.length < 6) return null;

  if (isMetadataOrSummaryLine(trimmed)) return null;

  const dateHit = findDateInLine(trimmed);
  if (!dateHit) return null;

  const before = trimmed.slice(0, dateHit.index).trim();
  const afterDate = trimmed.slice(dateHit.index + dateHit.raw.length).trim();
  const normDate = dateHit.norm;

  const rest = `${before} ${afterDate}`.replace(/\s+/g, ' ').trim();
  const tokens = rest.split(/\s+/);
  if (!tokens.length) return tryParseAfterDateOnly(trimmed);

  const amtHit = findAmountToken(tokens);
  if (!amtHit) return tryParseAfterDateOnly(trimmed);

  const rawAmtStr = amtHit.amountStr;
  const amt = parseAmountLoose(rawAmtStr.replace(/\s*(CR|DR)\s*$/i, '')) ?? parseAmount(rawAmtStr.replace(/\s*(CR|DR)\s*$/i, ''));
  if (amt === null) return tryParseAfterDateOnly(trimmed);

  const narration = tokens.slice(0, amtHit.amountIndex).join(' ').trim() || 'Imported';
  
  // Skip entries with bogus descriptions
  if (narration === 'Imported' || /^\d{4}$/.test(narration) || narration.length < 3 || isMetadataOrSummaryLine(narration)) {
    return null;
  }

  const isDebit = /\b(dr|debit|withdrawal|expense|fee|charge)\b/i.test(rawAmtStr) ||
    /\b(dr|debit|withdrawal|expense|fee|charge)\b/i.test(narration) ||
    /\b(dr|debit|withdrawal)\b/i.test(trimmed);
  const isCredit = /\b(cr|credit|deposit|refund|income)\b/i.test(rawAmtStr) ||
    /\b(cr|credit|deposit|refund|income)\b/i.test(narration) ||
    /\b(cr|credit|deposit)\b/i.test(trimmed);

  let signedAmt = amt;
  if (isDebit && !isCredit && amt > 0) {
    signedAmt = -amt;
  } else if (isCredit && !isDebit && amt < 0) {
    signedAmt = Math.abs(amt);
  }

  return { date: normDate, amount: signedAmt, narration };
}

/** True when a token is a bare day-of-month (PDF date cells often split). */
function isDayOnly(token: string): boolean {
  return /^(0?[1-9]|[12][0-9]|3[01])$/.test(token);
}

/**
 * Rebuild rows from raw lines, gluing day-only fragments onto their row
 * (some PDFs emit "Apr" and "02" as separate text runs).
 */
function mergeSplitDateLines(lines: string[]): string[] {
  const mergedLines: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!.trim();
    const nextLine = lines[i + 1]?.trim() || '';

    if (isDayOnly(line) && nextLine.length > 0) {
      mergedLines.push(`${line} ${nextLine}`);
      i += 2; // Skip both lines
    } else if (line.length > 0 && isDayOnly(nextLine)) {
      mergedLines.push(`${line} ${nextLine}`);
      i += 2;
    } else {
      if (line.length > 0) mergedLines.push(line);
      i++;
    }
  }
  return mergedLines;
}

/** Convert reconstructed statement lines into a `Date/Amount/Description` grid. */
export function statementLinesToGrid(lines: string[]): string[][] {
  const header = ['Date', 'Amount', 'Description'];
  const rows: string[][] = [header];

  const mergedLines = mergeSplitDateLines(lines);
  const seen = new Set<string>();
  const fuzzyKeys = new Set<string>();

  for (const line of mergedLines) {
    if (line.length < 5) continue;
    const parsed = tryParseStatementLine(line);
    if (!parsed) continue;

    const key = rowKey([parsed.date, String(parsed.amount), parsed.narration]);
    if (seen.has(key)) continue; // same row reached via several extraction strategies
    seen.add(key);
    
    // Fuzzy dedup: catches page-break duplicates from multi-page PDFs
    const absAmt = Math.abs(parsed.amount).toFixed(2);
    const normNarration = parsed.narration.toLowerCase()
      .replace(/\b(credit|debit|cr|dr)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
    const fKey = `${parsed.date}|${absAmt}|${normNarration}`;
    if (fuzzyKeys.has(fKey)) continue;
    fuzzyKeys.add(fKey);
    
    rows.push([parsed.date, String(parsed.amount), parsed.narration]);
  }

  return rows.length > 1 ? rows : [];
}

// ── column-aware parsing (uses real PDF cell positions) ──────────────────

export type PositionedCell = { text: string; x: number; y: number };
export type PositionedLine = { text: string; cells: PositionedCell[] };

const isDebitWord = (t: string) => /^(debit|debits|withdrawals?|outgoing|dr)$/i.test(t.trim());
const isCreditWord = (t: string) => /^(credit|credits|deposits?|incoming|cr)$/i.test(t.trim());
const isBalanceWord = (t: string) => /^(balance|running\s+balance|closing\s+balance|available\s+balance)$/i.test(t.trim());
const isBalanceMarker = (t: string) =>
  /opening\s+balance|beginning\s+balance|closing\s+balance|balance\s+b\/f|balance\s+c\/f|balance\s+brought\s+forward|balance\s+carried\s+forward|balance\s+forward/i.test(
    t
  );
const isDateHeaderWord = (t: string) =>
  /^(date|transaction\s+date|trans\s+date|txn\s+date|posting\s+date|value\s+date|details)$/i.test(t.trim());

/** Amount cell we can safely treat as money (not a dash placeholder or plain integer). */
function amountOfCell(text: string): number | null {
  const t = text.trim();
  if (!t || t === '-' || t === '—' || t === '–') return null;
  
  // Skip standalone years (2020-2100)
  if (/^\d{4}$/.test(t)) {
    const year = parseInt(t, 10);
    if (year >= 1900 && year <= 2100) return null;
  }
  
  // Skip day-of-month numbers (01-31)
  if (/^(0?[1-9]|[12][0-9]|3[01])$/.test(t)) return null;
  
  const a = parseAmountLoose(t) ?? parseAmount(t);
  if (a === null) return null;
  
  // Must have currency symbol, comma, or decimal point to be considered a money amount
  // This rejects plain integers like "2026" or "02"
  if (!/[$€£¥₹,\.]/.test(t)) return null;
  
  return a;
}

/** Detect the header row and the x position of each money column. */
function detectColumns(lines: PositionedLine[]) {
  let debitX: number | null = null;
  let creditX: number | null = null;
  let balanceX: number | null = null;
  let dateHeaderX: number | null = null;

  for (const line of lines) {
    for (const cell of line.cells) {
      const t = cell.text.trim();
      if (!t) continue;
      if (debitX === null && isDebitWord(t)) debitX = cell.x;
      else if (creditX === null && isCreditWord(t)) creditX = cell.x;
      else if (balanceX === null && isBalanceWord(t)) balanceX = cell.x;
      else if (dateHeaderX === null && isDateHeaderWord(t)) dateHeaderX = cell.x;
    }
    if (debitX !== null || creditX !== null) break;
  }

  return { debitX, creditX, balanceX, dateHeaderX };
}

function rowKey(row: string[]): string {
  return row.map(c => String(c ?? '').trim().toLowerCase()).join('|');
}

/**
 * Fuzzy dedup key: date + absolute amount only.
 * Catches page-break duplicates where the same transaction appears twice
 * with slightly different narration text from different PDF pages.
 */
function fuzzyRowKey(row: string[]): string {
  const date = (row[0] ?? '').trim().toLowerCase();
  // For 5-column rows (Date, Narration, Debit, Credit, Balance), amount is in col 2 or 3
  // For 3-column rows (Date, Amount, Description), amount is in col 1
  let amount = '';
  if (row.length === 5) {
    // Debit/Credit columns
    const debit = (row[2] ?? '').trim();
    const credit = (row[3] ?? '').trim();
    amount = debit || credit || '';
  } else {
    amount = (row[1] ?? '').trim();
  }
  // Normalize: take absolute value
  const num = parseFloat(amount.replace(/[^\d.\-]/g, ''));
  const absAmount = Number.isFinite(num) ? Math.abs(num).toFixed(2) : amount;
  
  // Strip CREDIT/DEBIT/type words from narration for comparison
  const narrationIdx = row.length === 5 ? 1 : 2;
  const narration = (row[narrationIdx] ?? '').trim().toLowerCase()
    .replace(/\b(credit|debit|cr|dr)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  
  return `${date}|${absAmount}|${narration}`;
}

/**
 * Column-aware grid builder.
 *
 * Uses the real x position of every cell, so separate Debit / Credit columns
 * keep their direction (the #1 correctness bug with sign-less bank PDFs) and
 * Balance columns never get mistaken for the transaction amount.
 */
export function positionedLinesToGrid(lines: PositionedLine[]): string[][] {
  const { debitX, creditX, balanceX } = detectColumns(lines);
  const hasDcColumns = debitX !== null && creditX !== null;

  const header = hasDcColumns
    ? ['Date', 'Narration', 'Debit', 'Credit', 'Balance']
    : ['Date', 'Amount', 'Description'];
  const rows: string[][] = [header];
  const seen = new Set<string>();
  const fuzzyKeys = new Set<string>();

  // Balance tracking lets us recover the sign when only a single Amount column exists.
  let prevBalance: number | null = null;

  // An "Opening Balance" / "Balance b/f" line seeds the running balance so the
  // very first transaction can still be given the right direction.
  for (const line of lines) {
    const text = line.text.replace(/\s+/g, ' ');
    const marker = line.cells.find(c => isBalanceMarker(c.text) && /opening|b\/f|forward/i.test(c.text));
    if (!marker && !/opening\s+balance|beginning\s+balance|balance\s+b\/f|balance\s+brought\s+forward|balance\s+forward/i.test(text)) {
      continue;
    }
    const amounts = line.cells
      .map(c => ({ v: amountOfCell(c.text), x: c.x, y: c.y }))
      .filter((a): a is { v: number; x: number; y: number } => a.v !== null);
    if (!amounts.length) continue;
    const pick = marker
      ? amounts.reduce((best, a) => (Math.abs(a.y - marker.y) < Math.abs(best.y - marker.y) ? a : best))
      : balanceX !== null
        ? amounts.reduce((best, a) => (Math.abs(a.x - balanceX) < Math.abs(best.x - balanceX) ? a : best))
        : amounts[amounts.length - 1]!;
    prevBalance = pick.v;
    break;
  }

  for (const line of lines) {
    if (!line.cells.length) continue;
    const text = line.text.replace(/\s+/g, ' ').trim();
    if (text.length < 6) continue;
    if (isMetadataOrSummaryLine(text)) continue;

    const dateHit = findDateInLine(text);
    if (!dateHit) continue;

    // Narration = cells between the date cell and the first amount cell,
    // ignoring anything belonging to an adjacent merged line (e.g. a running
    // balance row that landed within the same text bucket).
    const dateCellIndex = line.cells.findIndex(c => {
      const t = c.text.trim();
      return t.length > 0 && (t === dateHit.raw || dateHit.raw.includes(t) || t.includes(dateHit.raw));
    });
    const dateCell = dateCellIndex >= 0 ? line.cells[dateCellIndex]! : null;

    // Only take amounts from the transaction's own visual row, so a neighbouring
    // "Opening Balance 15,247.83" that got bucketed with it is never used.
    const rowY = dateCell ? dateCell.y : line.cells[0]!.y;
    // Use larger tolerance since we now extract with eps up to 24
    const sameRow = (c: PositionedCell) => Math.abs(c.y - rowY) <= 24;

    const amountCells: Array<{ value: number; x: number; index: number }> = [];
    line.cells.forEach((cell, index) => {
      if (!sameRow(cell)) return;
      const v = amountOfCell(cell.text);
      if (v !== null) amountCells.push({ value: v, x: cell.x, index });
    });
    
    if (!amountCells.length) {
      continue;
    }

    const narrFrom = dateCellIndex >= 0 ? dateCellIndex + 1 : 0;
    const narration =
      line.cells
        .slice(narrFrom, Math.max(narrFrom, amountCells[0]!.index))
        .filter(c => !isBalanceMarker(c.text))
        .map(c => c.text.trim())
        .filter(Boolean)
        .join(' ')
        .trim() || 'Imported';

    // The left-most amount on a row is the transaction amount (narration comes
    // first); the right-most is the running balance when a balance column exists.
    let txn = amountCells[0]!;
    let balance: number | null = null;
    if (balanceX !== null && amountCells.length > 1) {
      let balBest = amountCells[amountCells.length - 1]!;
      let balDist = Math.abs(balBest.x - balanceX);
      for (const ac of amountCells) {
        const d = Math.abs(ac.x - balanceX);
        if (d < balDist) {
          balDist = d;
          balBest = ac;
        }
      }
      if (balBest !== txn) {
        balance = balBest.value;
        txn = amountCells.find(ac => ac !== balBest) ?? txn;
      }
    }

    // Running balance is the authoritative direction signal when available:
    // balance falls for debits, rises for credits.
    let direction: 'debit' | 'credit' | null = null;
    if (balance !== null && prevBalance !== null) {
      const delta = balance - prevBalance;
      if (Math.abs(delta + txn.value) < 0.02) direction = 'debit'; // balance fell
      else if (Math.abs(delta - txn.value) < 0.02) direction = 'credit'; // balance rose
    }

    // Fall back to column geometry when the balance chain is broken.
    if (!direction && debitX !== null && creditX !== null) {
      direction = Math.abs(txn.x - debitX) <= Math.abs(txn.x - creditX) ? 'debit' : 'credit';
    }

    // Fall back to text inspection on the line cells and narration
    if (!direction) {
      const rowText = line.cells.map(c => c.text).join(' ');
      const isDebit = /\b(debit|dr|withdrawal|expense|fee|charge)\b/i.test(rowText) || /\b(debit|dr)\b/i.test(narration);
      const isCredit = /\b(credit|cr|deposit|refund|income)\b/i.test(rowText) || /\b(credit|cr)\b/i.test(narration);
      if (isDebit && !isCredit) {
        direction = 'debit';
      } else if (isCredit && !isDebit) {
        direction = 'credit';
      }
    }

    if (balanceX !== null && balance !== null) prevBalance = balance;

    // Single Amount column: keep whatever sign the bank printed; when the bank
    // printed none, apply the direction we worked out above.
    let signedAmount = txn.value;
    if (txn.value > 0 && direction === 'debit') signedAmount = -txn.value;
    else if (txn.value < 0 && direction === 'credit') signedAmount = Math.abs(txn.value);

    const row = hasDcColumns
      ? [
          dateHit.norm,
          narration,
          direction === 'debit' ? String(Math.abs(txn.value)) : '',
          direction === 'credit' ? String(Math.abs(txn.value)) : '',
          balance === null ? '' : String(balance),
        ]
      : [dateHit.norm, String(signedAmount), narration];

    // Never drop a row we cannot classify — default to debit (conservative).
    if (hasDcColumns && !row[2] && !row[3]) {
      row[2] = String(Math.abs(txn.value));
    }
    
    // Skip rows with bogus narrations
    const narrationCol = hasDcColumns ? row[1] : row[2];
    if (narrationCol === 'Imported' || 
        /^\d{4}$/.test(narrationCol || '') || 
        (narrationCol || '').length < 3 ||
        isMetadataOrSummaryLine(narrationCol || '')) {
      continue;
    }

    const key = rowKey(row);
    if (seen.has(key)) continue;
    seen.add(key);
    
    // Fuzzy dedup: catches page-break duplicates from multi-page PDFs
    // where the same transaction appears on both pages with slight text differences
    const fKey = fuzzyRowKey(row);
    if (fuzzyKeys.has(fKey)) continue;
    fuzzyKeys.add(fKey);
    
    rows.push(row);
  }

  return rows.length > 1 ? rows : [];
}
