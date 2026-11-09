// Enhanced Statement Import - Utility Functions

export interface ImportedTransaction {
  id: string;
  date: string;
  amount: number;
  narration: string;
  type: 'debit' | 'credit';
  category?: string;
  confidence?: number;
  isDuplicate?: boolean;
  duplicateMatchId?: string;
  suggestedCategory?: string;
  rawData: Record<string, any>;
  /** Review step: business vs personal spend */
  usage?: 'business' | 'personal';
  /** Review step: chart category to apply on import */
  importCategoryId?: string;
  /** Review step: project assigned to transaction */
  projectId?: string;
  /** Classification source: 'ai' (AI model) or 'rules' (rule engine) */
  classificationSource?: 'ai' | 'rules';
}

export interface ColumnMapping {
  /** `__idx_0`, `__idx_1`, … or legacy header string from row 1 */
  date: string;
  /** Single amount column when `amountMode` is `single` */
  amount: string;
  narration: string;
  balance?: string;
  reference?: string;
  type?: string;
  /** Most bank PDFs/CSVs: separate Debit and Credit columns */
  amountMode?: 'single' | 'debit_credit';
  debit?: string;
  credit?: string;
}

/** Stable key for column index (preferred in UI). */
export function columnKeyFromIndex(index: number): string {
  return `__idx_${index}`;
}

/** Resolve picker value to 0-based column index. */
export function resolveColumnIndex(value: string, headers: string[]): number {
  if (!value || !headers.length) return -1;
  const m = value.trim().match(/^__idx_(\d+)$/);
  if (m) {
    const idx = parseInt(m[1]!, 10);
    return idx >= 0 && idx < headers.length ? idx : -1;
  }
  const i = headers.indexOf(value);
  return i;
}

export interface ImportSession {
  id: string;
  fileName: string;
  accountId: string;
  accountName: string;
  uploadedAt: string;
  status: 'pending' | 'mapping' | 'classifying' | 'reviewing' | 'completed' | 'failed';
  totalRows: number;
  validRows: number;
  duplicates: number;
  errors: number;
  columnMapping?: ColumnMapping;
  transactions: ImportedTransaction[];
}

/** Split file into logical rows; newlines inside `"..."` stay in the row (RFC 4180). */
function splitCsvPhysicalRows(text: string): string[] {
  const rows: string[] = [];
  let row = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === '"') {
      if (inQuotes && text[i + 1] === '"') {
        row += '""';
        i++;
        continue;
      }
      inQuotes = !inQuotes;
      row += c;
    } else if (!inQuotes && (c === '\n' || c === '\r')) {
      if (c === '\r' && text[i + 1] === '\n') i++;
      if (row.trim().length > 0) rows.push(row);
      row = '';
    } else {
      row += c;
    }
  }
  if (row.trim().length > 0) rows.push(row);
  return rows;
}

/** Parse one CSV/TSV row with quoted fields; `delimiter` is ',' or ';' */
function parseDelimitedLine(line: string, delimiter: ',' | ';'): string[] {
  const row: string[] = [];
  let currentField = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        currentField += '"';
        i++;
        continue;
      }
      inQuotes = !inQuotes;
    } else if (char === delimiter && !inQuotes) {
      row.push(currentField.trim());
      currentField = '';
    } else {
      currentField += char;
    }
  }

  row.push(currentField.trim());
  return row;
}

function detectDelimiter(firstNonEmptyLine: string): ',' | ';' {
  let inQuotes = false;
  let commas = 0;
  let semis = 0;
  for (let i = 0; i < firstNonEmptyLine.length; i++) {
    const c = firstNonEmptyLine[i];
    if (c === '"') inQuotes = !inQuotes;
    else if (!inQuotes) {
      if (c === ',') commas++;
      if (c === ';') semis++;
    }
  }
  return semis > commas ? ';' : ',';
}

// CSV Parser — BOM strip, comma or semicolon (Excel EU), quoted fields
export const parseCSVFile = async (file: File): Promise<string[][]> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      try {
        let text = e.target?.result as string;
        text = text.replace(/^\ufeff/, '');
        const physicalRows = splitCsvPhysicalRows(text);
        const firstNonEmpty = physicalRows.find(r => r.trim().length > 0);
        if (!firstNonEmpty) {
          resolve([]);
          return;
        }

        const delimiter = detectDelimiter(firstNonEmpty);
        const data: string[][] = [];

        for (const line of physicalRows) {
          if (!line.trim()) continue;
          const row = parseDelimitedLine(line, delimiter);
          if (row.length > 0 && row.some(c => c.length > 0)) {
            data.push(row);
          }
        }

        resolve(data);
      } catch (error) {
        reject(error);
      }
    };

    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsText(file);
  });
};

// Auto-detect column mapping with smart algorithms (uses `__idx_n` keys)
export const autoDetectColumnMapping = (headers: string[] | undefined): ColumnMapping => {
  const mapping: ColumnMapping = {
    date: '',
    amount: '',
    narration: '',
    amountMode: 'single',
  };

  if (!headers?.length) {
    return mapping;
  }

  const key = (i: number) => columnKeyFromIndex(i);
  const lowerHeaders = headers.map(h => (h ?? '').toLowerCase());

  let debitIdx = -1;
  let creditIdx = -1;
  for (let i = 0; i < lowerHeaders.length; i++) {
    const h = lowerHeaders[i];
    const isDebitCol =
      h === 'debit' ||
      h === 'outgoing' ||
      h === 'withdrawal' ||
      h === 'withdrawals' ||
      /^debit\b/.test(h) ||
      /^outgoing\b/.test(h) ||
      /^withdrawals?\b/.test(h) ||
      (h.includes('debit') && !h.includes('credit')) ||
      (h.includes('withdrawal') && !h.includes('deposit'));
    const isCreditCol =
      h === 'credit' ||
      h === 'incoming' ||
      h === 'deposit' ||
      h === 'deposits' ||
      /^credit\b/.test(h) ||
      /^incoming\b/.test(h) ||
      /^deposits?\b/.test(h) ||
      (h.includes('credit') && !h.includes('debit')) ||
      (h.includes('deposit') && !h.includes('withdrawal'));
    if (isDebitCol && debitIdx < 0) debitIdx = i;
    if (isCreditCol && creditIdx < 0) creditIdx = i;
  }

  if (debitIdx >= 0 && creditIdx >= 0 && debitIdx !== creditIdx) {
    mapping.amountMode = 'debit_credit';
    mapping.debit = key(debitIdx);
    mapping.credit = key(creditIdx);
    mapping.amount = '';
  }

  // Date column — prefer transaction/posting date over "value date" when both exist (e.g. Askari)
  const looksLikeDateCol = (h: string) =>
    h === 'date' ||
    h.includes('transaction date') ||
    h.includes('trans date') ||
    h.includes('posting date') ||
    h.includes('txn date') ||
    h.includes('value date');
  let dateIdx = -1;
  for (let i = 0; i < lowerHeaders.length; i++) {
    const h = lowerHeaders[i];
    if (!looksLikeDateCol(h)) continue;
    if (h.includes('value date')) continue;
    dateIdx = i;
    break;
  }
  if (dateIdx < 0) {
    for (let i = 0; i < lowerHeaders.length; i++) {
      if (looksLikeDateCol(lowerHeaders[i])) {
        dateIdx = i;
        break;
      }
    }
  }
  if (dateIdx >= 0) mapping.date = key(dateIdx);

  // Single amount column (when not debit/credit mode)
  if (mapping.amountMode !== 'debit_credit') {
    const amountPatterns = [
      'amount',
      'withdrawal',
      'deposit',
      'transaction amount',
      'debit/credit',
      'dr/cr',
    ];
    for (let i = 0; i < lowerHeaders.length; i++) {
      const h = lowerHeaders[i];
      if (h.includes('value date') || h.includes('posting date')) continue;
      if (amountPatterns.some(pattern => h.includes(pattern))) {
        mapping.amount = key(i);
        break;
      }
    }
    if (!mapping.amount) {
      for (let i = 0; i < lowerHeaders.length; i++) {
        const h = lowerHeaders[i];
        if (h.includes('value') && !h.includes('date')) {
          mapping.amount = key(i);
          break;
        }
      }
    }
  }

  // Narration/Description column detection
  const narrationPatterns = [
    'description',
    'narration',
    'particulars',
    'transaction detail',
    'transaction details',
    'details',
    'detail',
    'memo',
    'payee',
  ];
  for (let i = 0; i < lowerHeaders.length; i++) {
    if (narrationPatterns.some(pattern => lowerHeaders[i].includes(pattern))) {
      mapping.narration = key(i);
      break;
    }
  }

  // Balance column detection (optional) — prefer closing/available over opening
  for (let i = 0; i < lowerHeaders.length; i++) {
    const h = lowerHeaders[i];
    if (
      h.includes('closing balance') ||
      h.includes('available balance') ||
      h.includes('running balance')
    ) {
      mapping.balance = key(i);
      break;
    }
  }
  if (!mapping.balance) {
    for (let i = 0; i < lowerHeaders.length; i++) {
      const h = lowerHeaders[i];
      if (h.includes('balance') && !h.includes('opening')) {
        mapping.balance = key(i);
        break;
      }
    }
  }

  // Reference column detection (optional)
  const refPatterns = [
    'reference',
    'ref',
    'transaction id',
    'txn id',
    'ref number',
    'instrument',
    'instrument/doc',
    'doc no',
    'cheque',
    'chq',
    'cheq/inst',
    'inst#',
    'inst no',
  ];
  for (let i = 0; i < lowerHeaders.length; i++) {
    if (refPatterns.some(pattern => lowerHeaders[i].includes(pattern))) {
      mapping.reference = key(i);
      break;
    }
  }

  // Type column detection (optional)
  const typePatterns = ['type', 'transaction type', 'dr/cr', 'debit/credit'];
  for (let i = 0; i < lowerHeaders.length; i++) {
    if (typePatterns.some(pattern => lowerHeaders[i].includes(pattern))) {
      mapping.type = key(i);
      break;
    }
  }

  return mapping;
};

// Parse date string with multiple format support
export const parseDate = (dateStr: string): string | null => {
  if (!dateStr) return null;
  
  // Try various date formats
  const formats = [
    /(\d{4})-(\d{2})-(\d{2})/, // YYYY-MM-DD
    /(\d{2})\/(\d{2})\/(\d{4})/, // DD/MM/YYYY
    /(\d{2})-(\d{2})-(\d{4})/, // DD-MM-YYYY
    /(\d{2})\/(\d{2})\/(\d{2})/, // DD/MM/YY
  ];
  
  for (const format of formats) {
    const match = dateStr.match(format);
    if (match) {
      if (format === formats[0]) {
        // Already in YYYY-MM-DD format
        return dateStr;
      } else if (format === formats[1] || format === formats[2]) {
        // DD/MM/YYYY or DD-MM-YYYY
        const [, day, month, year] = match;
        return `${year}-${month}-${day}`;
      } else if (format === formats[3]) {
        // DD/MM/YY
        const [, day, month, year] = match;
        const fullYear = parseInt(year) > 50 ? `19${year}` : `20${year}`;
        return `${fullYear}-${month}-${day}`;
      }
    }
  }

  const t = dateStr.trim();
  // Bank Alfalah / header exports: 20260331
  const yyyymmdd = t.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (yyyymmdd) {
    return `${yyyymmdd[1]}-${yyyymmdd[2]}-${yyyymmdd[3]}`;
  }
  // 2024/05/15
  const ymdSlash = t.match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
  if (ymdSlash) {
    return `${ymdSlash[1]}-${ymdSlash[2]}-${ymdSlash[3]}`;
  }
  // D-M-YYYY or DD-MM-YYYY with single-digit day/month
  const dmyDash = t.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (dmyDash) {
    const day = dmyDash[1]!.padStart(2, '0');
    const month = dmyDash[2]!.padStart(2, '0');
    const y = dmyDash[3]!;
    const mi = parseInt(month, 10);
    const di = parseInt(day, 10);
    if (mi >= 1 && mi <= 12 && di >= 1 && di <= 31) {
      return `${y}-${month}-${day}`;
    }
  }
  // D/M/YYYY or DD/MM/YYYY (Bank AL Habib, etc.; strict \d{2} already handled above)
  const dmySlashFlex = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmySlashFlex) {
    const day = dmySlashFlex[1]!.padStart(2, '0');
    const month = dmySlashFlex[2]!.padStart(2, '0');
    const y = dmySlashFlex[3]!;
    const mi = parseInt(month, 10);
    const di = parseInt(day, 10);
    if (mi >= 1 && mi <= 12 && di >= 1 && di <= 31) {
      return `${y}-${month}-${day}`;
    }
  }

  return null;
};

const MONTH_ABBR_TO_NUM: Record<string, string> = {
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

/** Bank statements often use e.g. "Fri May 02" without a year (year from statement period). */
export function parseStatementDate(dateStr: string): string | null {
  const trimmed = dateStr.trim();
  if (!trimmed) return null;

  /** Easypaisa and others: date on first line, time ("12:47 AM") on second line */
  const firstLine =
    trimmed.split(/\r?\n/).find(l => l.trim().length > 0) ?? trimmed;
  const raw = firstLine.replace(/\s+/g, ' ');

  const core = parseDate(raw);
  if (core) return core;

  /** Askari header / CSV: "03-MAR-2026" */
  const dashDMY = raw.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/i);
  if (dashDMY) {
    const monStr = dashDMY[2]!.slice(0, 3).toLowerCase();
    const mon = MONTH_ABBR_TO_NUM[monStr];
    if (mon) {
      return `${dashDMY[3]}-${mon}-${dashDMY[1]!.padStart(2, '0')}`;
    }
  }

  /**
   * Easypaisa: "Apr 1, 2026", "Apr 2, 2026" (optional time after, same line)
   * SadaPay: "4 Mar, 2026 07:18 AM" handled by dMonY below
   */
  const mmmDY = raw.match(/^([A-Za-z]{3})\s+(\d{1,2}),\s+(\d{4})/i);
  if (mmmDY) {
    const monStr = mmmDY[1]!.slice(0, 3).toLowerCase();
    const mon = MONTH_ABBR_TO_NUM[monStr];
    if (mon) {
      const day = mmmDY[2]!.padStart(2, '0');
      return `${mmmDY[3]}-${mon}-${day}`;
    }
  }

  /** Payoneer / SadaPay: "01 Apr, 2026", "4 Mar, 2026 07:18 AM" */
  const dMonY = raw.match(/^(\d{1,2})\s+([A-Za-z]{3}),?\s+(\d{4})/i);
  if (dMonY) {
    const monStr = dMonY[2]!.slice(0, 3).toLowerCase();
    const mon = MONTH_ABBR_TO_NUM[monStr];
    if (mon) {
      const day = dMonY[1]!.padStart(2, '0');
      return `${dMonY[3]}-${mon}-${day}`;
    }
  }

  const m = raw.match(/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+([A-Za-z]{3})\s+(\d{1,2})$/i);
  if (!m) return null;

  const monStr = m[1]!.slice(0, 3).toLowerCase();
  const mon = MONTH_ABBR_TO_NUM[monStr];
  if (!mon) return null;
  const day = m[2]!.padStart(2, '0');

  let year = new Date().getFullYear();
  let iso = `${year}-${mon}-${day}`;
  const t = new Date(iso + 'T12:00:00').getTime();
  if (t > Date.now() + 86400000 * 120) year -= 1;
  iso = `${year}-${mon}-${day}`;
  return iso;
}

// Parse amount with various formats
export const parseAmount = (amountStr: string): number | null => {
  if (!amountStr) return null;
  
  // Remove currency symbols, common ISO codes (PKR, USD, EUR, etc.), prefixes (Rs, Rs.), and formatting
  let cleanStr = amountStr
    .replace(/^(?:PKR|USD|EUR|GBP|AED|SAR|CAD|AUD|INR|JPY|CNY|Rs\.?)\s*/i, '')
    .replace(/\s*(?:PKR|USD|EUR|GBP|AED|SAR|CAD|AUD|INR|JPY|CNY|Rs\.?)$/i, '')
    .replace(/[$€£¥₹]/g, '')
    .replace(/,/g, '')
    .replace(/\s/g, '')
    .trim();
  
  // Handle parentheses for negative numbers: (500) -> -500
  if (cleanStr.startsWith('(') && cleanStr.endsWith(')')) {
    cleanStr = '-' + cleanStr.slice(1, -1);
  }
  
  // Extract signed numeric part if trailing characters remain
  const match = cleanStr.match(/^-?\d+(?:\.\d+)?/);
  if (!match) return null;
  
  const amount = parseFloat(match[0]);
  return isNaN(amount) ? null : amount;
};

// Detect transaction type (debit/credit)
export const detectTransactionType = (
  amount: number,
  typeColumn?: string,
  amountColumn?: string,
  narration?: string
): 'debit' | 'credit' => {
  // If type column exists, use it
  if (typeColumn) {
    const lower = typeColumn.toLowerCase().trim();
    if (lower === 'credit' || lower === 'cr' || lower.includes('credit') || lower.includes('deposit') || lower.includes('incoming')) {
      return 'credit';
    }
    if (lower === 'debit' || lower === 'dr' || lower.includes('debit') || lower.includes('withdrawal') || lower.includes('outgoing') || lower.includes('expense')) {
      return 'debit';
    }
  }

  // If amount is negative, it's definitively a debit (expense)
  if (amount < 0) {
    return 'debit';
  }

  // Check narration/description for explicit debit/credit keywords
  if (narration) {
    const lower = narration.toLowerCase();
    const hasDebit = /\b(debit|dr|withdrawal|expense|payroll|fee|fees|charges?|bill|vendor payment|purchase|rent)\b/i.test(lower);
    const hasCredit = /\b(credit|cr|deposit|refund|interest earned|client payment|sales? receipt|incoming)\b/i.test(lower);

    if (hasDebit && !hasCredit) {
      return 'debit';
    }
    if (hasCredit && !hasDebit) {
      return 'credit';
    }
    if (/\bdebit\b/i.test(lower)) {
      return 'debit';
    }
    if (/\bcredit\b/i.test(lower)) {
      return 'credit';
    }
  }

  // Check if column name indicates type
  if (amountColumn) {
    const lower = amountColumn.toLowerCase();
    if (lower.includes('credit') || lower.includes('deposit') || lower.includes('incoming')) {
      return 'credit';
    }
    if (lower.includes('debit') || lower.includes('withdrawal') || lower.includes('outgoing') || lower.includes('expense')) {
      return 'debit';
    }
  }

  // Default to debit for positive amounts if conservative or check magnitude
  return amount > 0 ? 'credit' : 'debit';
};

// Duplicate detection using fuzzy matching (null-safe on existing ledger rows)
export const findDuplicates = (
  newTransactions: ImportedTransaction[],
  existingTransactions: any[] | null | undefined
): string[] => {
  const duplicateIds: string[] = [];
  const ledger = Array.isArray(existingTransactions) ? existingTransactions : [];

  for (const newTxn of newTransactions) {
    for (const existingTxn of ledger) {
      if (!existingTxn) continue;

      const exDate = existingTxn.date;
      const exAmt = existingTxn.amount;
      const exNarration =
        existingTxn.narration ?? existingTxn.description ?? '';

      if (exDate == null || exDate === '' || exAmt === undefined || exAmt === null) {
        continue;
      }

      const existingTime = new Date(exDate as string).getTime();
      if (Number.isNaN(existingTime)) continue;

      // Check if dates are within 2 days
      const dateDiff = Math.abs(new Date(newTxn.date).getTime() - existingTime);
      const daysDiff = dateDiff / (1000 * 60 * 60 * 24);

      // Check if amounts match (within 0.01)
      const amountMatch =
        Math.abs(Math.abs(newTxn.amount) - Math.abs(Number(exAmt))) < 0.01;

      // Check if narrations are similar (simple substring check)
      const narration1 = String(newTxn.narration ?? '').toLowerCase().slice(0, 50);
      const narration2 = String(exNarration).toLowerCase().slice(0, 50);
      const narrationSimilar =
        narration1.length > 0 &&
        narration2.length > 0 &&
        (narration1.includes(narration2) || narration2.includes(narration1));

      if (daysDiff <= 2 && amountMatch && narrationSimilar) {
        duplicateIds.push(newTxn.id);
        newTxn.isDuplicate = true;
        newTxn.duplicateMatchId = existingTxn.id;
        break;
      }
    }
  }

  return duplicateIds;
};

// Process raw CSV data into transactions
export const processCSVData = (
  data: string[][],
  mapping: ColumnMapping,
  headers: string[]
): ImportedTransaction[] => {
  const transactions: ImportedTransaction[] = [];

  const dateIndex = resolveColumnIndex(mapping.date, headers);
  const narrationIndex = resolveColumnIndex(mapping.narration, headers);
  const typeIndex = mapping.type ? resolveColumnIndex(mapping.type, headers) : -1;
  const refIndex = mapping.reference ? resolveColumnIndex(mapping.reference, headers) : -1;

  const amountMode = mapping.amountMode === 'debit_credit' ? 'debit_credit' : 'single';
  let amountIndex = -1;
  let debitIndex = -1;
  let creditIndex = -1;

  if (amountMode === 'debit_credit' && mapping.debit && mapping.credit) {
    debitIndex = resolveColumnIndex(mapping.debit, headers);
    creditIndex = resolveColumnIndex(mapping.credit, headers);
  } else {
    amountIndex = resolveColumnIndex(mapping.amount, headers);
  }

  const cell = (row: string[], idx: number) => (idx >= 0 && idx < row.length ? row[idx] ?? '' : '');

  // Skip header row
  for (let i = 1; i < data.length; i++) {
    const row = data[i];

    if (row.length === 0 || row.every(c => !String(c ?? '').trim())) {
      continue;
    }

    const rawData: Record<string, any> = {};
    headers.forEach((header, idx) => {
      rawData[header] = row[idx] ?? '';
    });

    const dateStr = cell(row, dateIndex);
    const narration = cell(row, narrationIndex);
    const typeStr = typeIndex >= 0 ? cell(row, typeIndex) : '';
    const reference = refIndex >= 0 ? cell(row, refIndex) : '';

    const date = parseStatementDate(dateStr) ?? parseDate(dateStr);

    let amount: number | null = null;
    let txnType: 'debit' | 'credit' = 'debit';

    if (amountMode === 'debit_credit' && debitIndex >= 0 && creditIndex >= 0) {
      const debitStr = cell(row, debitIndex).trim();
      const creditStr = cell(row, creditIndex).trim();
      const dAmt = debitStr ? parseAmount(debitStr) : null;
      const cAmt = creditStr ? parseAmount(creditStr) : null;

      if (dAmt !== null && dAmt !== 0 && Math.abs(dAmt) > 0.0001) {
        amount = Math.abs(dAmt);
        txnType = 'debit';
      } else if (cAmt !== null && cAmt !== 0 && Math.abs(cAmt) > 0.0001) {
        amount = Math.abs(cAmt);
        txnType = 'credit';
      } else {
        continue;
      }
    } else {
      const amountStr = cell(row, amountIndex);
      const parsed = parseAmount(amountStr);
      if (parsed === null) continue;
      amount = Math.abs(parsed);
      txnType = detectTransactionType(parsed, typeStr, mapping.amount, narration);
    }

    if (!date || amount === null) {
      continue;
    }

    const narr = [narration.trim(), reference.trim()].filter(Boolean).join(' — ') || 'Imported';

    transactions.push({
      id: `import-${Date.now()}-${i}`,
      date,
      amount,
      narration: narr,
      type: txnType,
      isDuplicate: false,
      rawData,
    });
  }

  return transactions;
};

// Calculate import statistics
export const calculateImportStats = (transactions: ImportedTransaction[]) => {
  const nonDup = transactions.filter(t => !t.isDuplicate);
  const classified = nonDup.filter(
    t => (t.confidence ?? 0) >= 60
  ).length;
  
  // Track classification sources
  const classifiedByAI = nonDup.filter(
    t => (t.confidence ?? 0) >= 60 && t.classificationSource === 'ai'
  ).length;
  const classifiedByRules = nonDup.filter(
    t => (t.confidence ?? 0) >= 60 && t.classificationSource === 'rules'
  ).length;
  
  return {
    total: transactions.length,
    duplicates: transactions.filter(t => t.isDuplicate).length,
    valid: nonDup.length,
    /** Rows with confident suggested classification (same as "auto-classified" in UI) */
    classified,
    classifiedByAI,
    classifiedByRules,
    totalAmount: nonDup.reduce(
      (sum, t) => sum + (t.type === 'credit' ? Math.abs(t.amount) : -Math.abs(t.amount)),
      0
    ),
    credits: transactions.filter(t => t.type === 'credit' && !t.isDuplicate).length,
    debits: transactions.filter(t => t.type === 'debit' && !t.isDuplicate).length,
  };
};
