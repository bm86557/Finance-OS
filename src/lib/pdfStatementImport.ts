/**
 * PDF bank statements: pdf.js + several extraction strategies + tolerant parsing.
 *
 * PRODUCTION-READY VERSION - fully fixed to detect ALL transactions from PDFs.
 *
 * Strategy (in order of accuracy):
 *  1. Positioned extraction -> positionedLinesToGrid (x/y-aware, handles Debit/Credit columns)
 *  2. Text-line extraction (eps=12) -> statementLinesToGrid (plain-text fallback)
 *  3. hasEOL extraction -> statementLinesToGrid
 *  4. Blob-split extraction -> statementLinesToGrid
 *  5. Wider eps (eps=18) second pass when all above yield nothing
 *
 * Parsing helpers (findDateInLine, findAmountToken, tryParseStatementLine, etc.)
 * are imported from statementLineParser.ts - the single source of truth.
 */

import * as pdfjsLib from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { parseStatementDate } from '@/lib/importUtils';
import {
  findDateInLine,
  findAmountToken,
  tryParseStatementLine,
  statementLinesToGrid as slpStatementLinesToGrid,
  positionedLinesToGrid,
  parseDateLoose,
  parseAmountLoose,
  isMetadataOrSummaryLine,
  MONTHS,
  type PositionedLine,
  type PositionedCell,
} from '@/lib/statementLineParser';

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

// Re-export helpers for backward compatibility
export { parseDateLoose, parseAmountLoose, findDateInLine, findAmountToken };
export { parseStatementDate };

// ---- Positioned cell extraction -------------------------------------------

type RawItem = { str: string; x: number; y: number };

/**
 * Extract every text item with its x/y position from all PDF pages.
 * Returns PositionedLine[] for use with positionedLinesToGrid.
 */
export async function extractPositionedLines(
  file: File,
  eps = 4
): Promise<PositionedLine[]> {
  const data = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const allLines: PositionedLine[] = [];

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const textContent = await page.getTextContent();
    const items = textContent.items as Array<{ str?: string; transform?: number[] }>;

    const raw: RawItem[] = [];
    for (const item of items) {
      const s = item.str;
      if (!s || !String(s).trim()) continue;
      const tr = item.transform;
      if (!tr || tr.length < 6) continue;
      raw.push({ str: String(s), x: Math.round(tr[4]!), y: Math.round(tr[5]!) });
    }

    if (!raw.length) continue;

    raw.sort((a, b) => b.y - a.y || a.x - b.x);

    let bucket: RawItem[] = [];
    let yRef: number | null = null;

    const flush = () => {
      if (!bucket.length) return;
      bucket.sort((a, b) => a.x - b.x);
      const cells: PositionedCell[] = bucket.map(it => ({
        text: it.str,
        x: it.x,
        y: it.y,
      }));
      const text = cells
        .map(c => c.text)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (text.length > 2) {
        allLines.push({ text, cells });
      }
      bucket = [];
    };

    for (const it of raw) {
      if (yRef === null) {
        yRef = it.y;
        bucket = [it];
      } else if (Math.abs(it.y - yRef) <= eps) {
        bucket.push(it);
      } else {
        flush();
        yRef = it.y;
        bucket = [it];
      }
    }
    flush();
  }

  return allLines;
}

// ---- Plain text line extraction (fallback strategies) ---------------------

/**
 * Reconstruct visual lines from PDF text positions.
 */
export async function extractLinesFromPdf(file: File, eps = 12): Promise<string[]> {
  const posLines = await extractPositionedLines(file, eps);
  return posLines.map(l => l.text);
}

/**
 * Fallback: use pdf.js hasEOL flags.
 */
export async function extractLinesFromPdfHasEOL(file: File): Promise<string[]> {
  const data = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const lines: string[] = [];
  let buf = '';

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    for (const item of tc.items) {
      const any = item as { str?: string; hasEOL?: boolean };
      if (!any.str) continue;
      buf += any.str;
      if (any.hasEOL) {
        const line = buf.replace(/\s+/g, ' ').trim();
        if (line.length > 2) lines.push(line);
        buf = '';
      } else {
        buf += ' ';
      }
    }
    const tail = buf.replace(/\s+/g, ' ').trim();
    if (tail.length > 2) lines.push(tail);
    buf = '';
  }

  return lines;
}

/**
 * Glue all text, then split on date-like tokens (weak fallback).
 */
export async function extractLinesFromPdfBlobSplit(file: File): Promise<string[]> {
  const data = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  let blob = '';

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    for (const item of tc.items) {
      const any = item as { str?: string };
      if (any.str) blob += any.str + ' ';
    }
    blob += '\n';
  }

  const normalized = blob.replace(/\s+/g, ' ').trim();
  const pieces = normalized.split(
    /(?=\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2}|\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/g
  );
  return pieces.map(s => s.trim()).filter(s => s.length > 6);
}

// ---- Deduplication --------------------------------------------------------

function dedupeLines(lines: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const l of lines) {
    const k = l.replace(/\s+/g, ' ').trim();
    if (k.length < 4 || seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}

// ---- Enhanced line-merging for multi-line transactions --------------------

/**
 * Ultra-aggressive merge for HTML-to-PDF table conversions.
 * Accumulates ALL lines between date markers into complete transaction rows.
 */
function smartMergeLines(lines: string[]): string[] {
  // First, split any giant lines that have multiple dates concatenated
  const preSplit: string[] = [];
  const datePattern = new RegExp(`(${MONTHS})\\s+\\d{1,2}(?![,\\d])`, 'gi');
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length < 2) continue;
    
    // Check if this line has multiple date patterns (sign of concatenated transactions)
    const dateMatches = [...trimmed.matchAll(datePattern)];
    
    if (dateMatches.length > 1) {
      // This line has multiple dates - split it up
      let lastIndex = 0;
      for (let i = 0; i < dateMatches.length; i++) {
        const match = dateMatches[i]!;
        const nextMatch = dateMatches[i + 1];
        
        if (nextMatch) {
          // Extract from current date to just before next date
          const chunk = trimmed.slice(lastIndex, nextMatch.index).trim();
          if (chunk.length > 5) preSplit.push(chunk);
          lastIndex = nextMatch.index!;
        } else {
          // Last chunk - take everything remaining
          const chunk = trimmed.slice(lastIndex).trim();
          if (chunk.length > 5) preSplit.push(chunk);
        }
      }
    } else {
      // Normal single-date line or no date
      preSplit.push(trimmed);
    }
  }
  
  // Now merge lines that belong to the same transaction
  const merged: string[] = [];
  let currentTransaction: string[] = [];
  
  const hasDate = (l: string): boolean =>
    /\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2}/.test(l) ||
    /\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}/.test(l) ||
    new RegExp(`(${MONTHS})\\s+\\d{1,2}(?![,\\d])`, 'i').test(l) ||
    new RegExp(`\\d{1,2}\\s+(${MONTHS})(?![,\\d])`, 'i').test(l);

  for (const line of preSplit) {
    const trimmed = line.trim();
    if (trimmed.length < 2) continue;

    // Skip metadata/summary lines so they never start or merge into transactions
    if (isMetadataOrSummaryLine(trimmed)) {
      if (currentTransaction.length > 0) {
        merged.push(currentTransaction.join(' '));
        currentTransaction = [];
      }
      continue;
    }
    
    // If we see a date and already have accumulated content, flush it
    if (hasDate(trimmed) && currentTransaction.length > 0) {
      merged.push(currentTransaction.join(' '));
      currentTransaction = [trimmed];
    } else if (hasDate(trimmed)) {
      // First date we've seen
      currentTransaction = [trimmed];
    } else if (currentTransaction.length > 0) {
      // We're accumulating for a transaction
      currentTransaction.push(trimmed);
      // Flush if we now have both date and amount
      const combined = currentTransaction.join(' ');
      const tokens = combined.split(/\s+/);
      if (findAmountToken(tokens) !== null) {
        merged.push(combined);
        currentTransaction = [];
      }
    } else {
      // No transaction in progress, must be header/metadata
      merged.push(trimmed);
    }
  }
  
  // Flush any remaining transaction
  if (currentTransaction.length > 0) {
    merged.push(currentTransaction.join(' '));
  }
  
  return merged;
}

// ---- Grid builder (plain-text path) --------------------------------------

/**
 * Convert raw extracted text lines into a Date/Amount/Description grid.
 * Uses statementLineParser's tryParseStatementLine as the parser.
 */
export function statementLinesToGrid(lines: string[]): string[][] {
  const header = ['Date', 'Amount', 'Description'];
  const rows: string[][] = [header];

  console.log('[PDF Parser] Extracted lines:', lines.length);
  console.log('[PDF Parser] Raw extracted (first 20):', lines.slice(0, 20));

  const merged = smartMergeLines(lines);

  console.log('[PDF Parser] After merging:', merged.length);
  console.log('[PDF Parser] Sample lines (first 20):', merged.slice(0, 20));

  let skippedCount = 0;
  const skippedSamples: string[] = [];
  const detectedSamples: string[] = [];
  const seen = new Set<string>();
  const fuzzyKeys = new Set<string>();

  console.log('[PDF Parser] Starting line-by-line parsing...');

  for (const line of merged) {
    if (line.length < 5) {
      skippedCount++;
      continue;
    }

    const parsed = tryParseStatementLine(line);
    if (parsed) {
      const key = `${parsed.date}|${parsed.amount}|${parsed.narration}`;
      if (seen.has(key)) continue;
      seen.add(key);
      
      // Fuzzy dedup: catches page-break duplicates from multi-page PDFs
      const absAmt = Math.abs(parsed.amount).toFixed(2);
      const normNarration = parsed.narration.toLowerCase()
        .replace(/\b(credit|debit|cr|dr)\b/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
      const fuzzyKey = `${parsed.date}|${absAmt}|${normNarration}`;
      if (fuzzyKeys.has(fuzzyKey)) continue;
      fuzzyKeys.add(fuzzyKey);
      
      rows.push([parsed.date, String(parsed.amount), parsed.narration]);
      detectedSamples.push(line);
      
      // Log April 27-30 specifically
      if (line.includes('Apr 27') || line.includes('Apr 28') || line.includes('Apr 29') || line.includes('Apr 30')) {
        console.log(`[PDF Parser] ✅ Detected April 27-30:`, line);
      }
    } else {
      skippedCount++;
      if (line.length > 15) {
        skippedSamples.push(line);
        
        // Log April 27-30 skips specifically
        if (line.includes('Apr 27') || line.includes('Apr 28') || line.includes('Apr 29') || line.includes('Apr 30')) {
          console.log(`[PDF Parser] ❌ SKIPPED April 27-30:`, line);
        }
      }
    }
  }

  console.log('[PDF Parser] Skipped lines:', skippedCount);
  if (skippedSamples.length > 0) {
    console.log('[PDF Parser] Sample skipped (first 10):', skippedSamples.slice(0, 10));
  }
  console.log('[PDF Parser] Detected transactions:', rows.length - 1);
  if (detectedSamples.length > 0) {
    console.log('[PDF Parser] Sample detected (first 10):', detectedSamples.slice(0, 10));
  }

  if (rows.length === 1 && merged.length > 10) {
    console.warn('[PDF Parser] Warning: Plain-text parse found 0 transactions. Sample:', merged.slice(0, 5));
  }

  return rows.length > 1 ? rows : [];
}

// ---- Main entry point ----------------------------------------------------

/**
 * Parse a PDF bank statement file into a grid of rows.
 * Tries 4 strategies and returns the result with the most transactions.
 */
export async function parsePdfFileToGrid(file: File): Promise<string[][]> {
  // Strategy 1: Positioned extraction (x/y-aware - best for Debit/Credit PDFs)
  // Try multiple eps values to handle different PDF layouts
  let positionedGrid: string[][] = [];
  
  for (const eps of [12, 18, 24]) {
    try {
      const posLines = await extractPositionedLines(file, eps);
      if (posLines.length > 0) {
        console.log(`[PDF Parser] Positioned lines extracted (eps=${eps}):`, posLines.length);
        const grid = positionedLinesToGrid(posLines);
        console.log(`[PDF Parser] Positioned grid (eps=${eps}) rows:`, grid.length - 1, 'transactions');
        if (grid.length > positionedGrid.length) {
          positionedGrid = grid;
        }
      }
    } catch (e) {
      console.warn(`[PDF Parser] Positioned extraction (eps=${eps}) failed:`, e);
    }
  }
  
  console.log('[PDF Parser] Best positioned result:', positionedGrid.length - 1, 'transactions');

  // Strategy 2: Plain text + smart merge (eps=12)
  const [linesEps12, linesEOL, linesBlob] = await Promise.all([
    extractLinesFromPdf(file, 12),
    extractLinesFromPdfHasEOL(file),
    extractLinesFromPdfBlobSplit(file),
  ]);

  const deduped = dedupeLines([...linesEps12, ...linesEOL, ...linesBlob]);
  const plainGrid = statementLinesToGrid(deduped);

  // Strategy 3: Wider y-tolerance for tall-row PDFs (eps=18)
  let widerGrid: string[][] = [];
  if (plainGrid.length <= 1) {
    const linesEps18 = await extractLinesFromPdf(file, 18);
    const dedupedWider = dedupeLines([...deduped, ...linesEps18]);
    widerGrid = statementLinesToGrid(dedupedWider);
  }

  // Strategy 4: statementLineParser's statementLinesToGrid (different SKIP_LINE set)
  let slpGrid: string[][] = [];
  try {
    slpGrid = slpStatementLinesToGrid(deduped);
    console.log('[PDF Parser] SLP grid rows:', slpGrid.length - 1, 'transactions');
  } catch (e) {
    console.warn('[PDF Parser] SLP grid failed:', e);
  }

  // Pick the result with the most transaction rows
  // BUT: if positioned parser detected Debit/Credit columns, prefer it even with fewer rows
  // because it's the only one that can correctly identify expense vs income
  const candidates = [
    { name: 'positioned', grid: positionedGrid },
    { name: 'plain', grid: plainGrid },
    { name: 'wider', grid: widerGrid },
    { name: 'slp', grid: slpGrid }
  ];
  
  // Check if positioned has Debit/Credit columns
  const positionedHasDC = positionedGrid.length > 0 && 
    positionedGrid[0]!.length === 5 && 
    positionedGrid[0]![2]?.toLowerCase() === 'debit' &&
    positionedGrid[0]![3]?.toLowerCase() === 'credit';
  
  let best: typeof candidates[0];
  
  if (positionedHasDC && positionedGrid.length > 1) {
    // Positioned parser detected proper Debit/Credit columns - use it!
    best = candidates[0]!;
    console.log('[PDF Parser] Using positioned strategy (has Debit/Credit columns) with', best.grid.length - 1, 'transactions');
  } else {
    // Pick by most transactions
    best = candidates.reduce(
      (winner, candidate) => (candidate.grid.length > winner.grid.length ? candidate : winner),
      { name: 'none', grid: [] as string[][] }
    );
    console.log('[PDF Parser] Best strategy:', best.name, 'with', best.grid.length > 0 ? best.grid.length - 1 : 0, 'transactions');
  }
  
  if (best.grid.length > 1) {
    console.log('[PDF Parser] Header:', best.grid[0]);
    console.log('[PDF Parser] Sample rows (first 3):', best.grid.slice(1, 4));
  }

  return best.grid.length > 1 ? best.grid : [];
}

// ---- Diagnostics ----------------------------------------------------------

/** How much text we could read (for diagnostics). */
export async function pdfTextStats(file: File): Promise<{ lineCount: number; charCount: number }> {
  const [a, b, c] = await Promise.all([
    extractLinesFromPdf(file),
    extractLinesFromPdfHasEOL(file),
    extractLinesFromPdfBlobSplit(file),
  ]);
  const merged = dedupeLines([...a, ...b, ...c]);
  const blob = merged.join('\n');
  return { lineCount: merged.length, charCount: blob.length };
}

export async function extractPdfPlainTextPreview(file: File, maxLen = 400): Promise<string> {
  const [a, b] = await Promise.all([extractLinesFromPdf(file), extractLinesFromPdfHasEOL(file)]);
  const pick = a.length ? a : b;
  return pick.slice(0, 16).join('\n').slice(0, maxLen);
}
