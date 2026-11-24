/**
 * Authoritative Recurring Transactions & Pattern Detection Engine
 * ===============================================================
 * Aligned with FINANCE_OS_MASTER_BACKEND_HANDOFF_v1.2.md:
 *   §1, §4, §5, §6, §7, §8, §9, §10, §11, §19, §33
 *
 * Pure deterministic domain logic (zero mocks, 100% unit-testable):
 *   1. Calendar-safe UTC period keys & end-of-month clamped date advancement
 *   2. Year-aware expected occurrence calculation
 *   3. Multi-currency base-normalized recurring KPI totals (never sums USD + PKR raw)
 *   4. Automatic monthly / weekly / quarterly / yearly recurring pattern detection
 *      from posted, non-transfer, world-scoped transactions with explainable evidence
 *   5. Statement-import reconciliation against active recurring schedules (anti-double-count)
 */

import { convertCurrency } from '../lib/fxConverter.js';
import {
  isLoanRepaymentTxn,
  isTransferTxn,
  NON_POSTED_STATUSES,
  type WorldFilter,
} from './financialTruthService.js';

export type RecurringFrequency = 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'yearly';

export interface DetectedRecurringCandidate {
  candidateKey: string;
  suggestedTitle: string;
  merchantKey: string;
  direction: 'credit' | 'debit';
  frequency: 'weekly' | 'monthly' | 'quarterly' | 'yearly';
  suggestedAmount: number;
  currency: string;
  baseAmount: number;
  baseCurrency: string;
  amountType: 'fixed' | 'variable';
  amountRange: { min: number; max: number };
  occurrenceCount: number;
  matchedDates: string[];
  matchedTransactionIds: string[];
  anchorDayOfMonth: number | null;
  medianIntervalDays: number;
  lastSeenDate: string;
  suggestedNextOccurrence: string;
  bankAccountId: string;
  categoryId: string | null;
  departmentId: string | null;
  projectId: string | null;
  worldScope: 'business' | 'personal';
  confidence: 'high' | 'medium';
  confidenceScore: number;
  explanation: string;
}

export interface RecurringTotalsResult {
  active: number;
  monthlyIncome: number;
  monthlyExpense: number;
  netMonthly: number;
  dueSoon: number;
  overdue: number;
  pendingApproval: number;
  currency: string;
  byCurrency: Record<string, { income: number; expense: number; net: number }>;
}

export interface RecurringImportMatch {
  transactionId: string;
  transactionDate: string;
  transactionAmount: number;
  scheduleId: string;
  scheduleDescription: string;
  periodKey: string;
  scheduledDate: string;
  nextOccurrenceAfterMatch: string;
  confidence: number;
}

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})/;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function normalizeIsoDate(input: unknown): string | null {
  if (!input) return null;
  if (input instanceof Date) {
    if (isNaN(input.getTime())) return null;
    return `${input.getUTCFullYear()}-${String(input.getUTCMonth() + 1).padStart(2, '0')}-${String(input.getUTCDate()).padStart(2, '0')}`;
  }
  const s = String(input).trim();
  const m = ISO_DATE_RE.exec(s);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    const dt = new Date(Date.UTC(y, mo - 1, d));
    if (dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d) {
      return `${m[1]}-${m[2]}-${m[3]}`;
    }
    return null;
  }
  const dt = new Date(s);
  if (isNaN(dt.getTime())) return null;
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

function parseUtcParts(iso: string): { year: number; month0: number; day: number; ms: number } {
  const [y, m, d] = iso.split('-').map(Number);
  return { year: y, month0: m - 1, day: d, ms: Date.UTC(y, m - 1, d) };
}

function formatUtcParts(year: number, month0: number, day: number): string {
  const dt = new Date(Date.UTC(year, month0, day));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

export function addDaysIso(iso: string, days: number): string {
  const { year, month0, day } = parseUtcParts(iso);
  return formatUtcParts(year, month0, day + days);
}

export function diffDaysIso(fromIso: string, toIso: string): number {
  return Math.round((parseUtcParts(toIso).ms - parseUtcParts(fromIso).ms) / 86_400_000);
}

/**
 * Advances an ISO date (YYYY-MM-DD) by one cadence step with end-of-month clamping.
 * Example: 2026-01-31 + monthly -> 2026-02-28 (never overflows to Mar 3).
 */
export function computeNextOccurrenceIso(currentIso: string, frequency?: string): string {
  const clean = normalizeIsoDate(currentIso);
  if (!clean) return currentIso;
  const { year, month0, day } = parseUtcParts(clean);
  const f = String(frequency || 'monthly').toLowerCase().trim();

  if (f === 'daily') return formatUtcParts(year, month0, day + 1);
  if (f === 'weekly') return formatUtcParts(year, month0, day + 7);
  if (f === 'biweekly' || f === 'bi-weekly') return formatUtcParts(year, month0, day + 14);

  const monthsToAdd = f === 'quarterly' ? 3 : f === 'yearly' || f === 'annual' ? 12 : 1;
  const targetFirst = new Date(Date.UTC(year, month0 + monthsToAdd, 1));
  const lastDay = new Date(Date.UTC(targetFirst.getUTCFullYear(), targetFirst.getUTCMonth() + 1, 0)).getUTCDate();
  return formatUtcParts(targetFirst.getUTCFullYear(), targetFirst.getUTCMonth(), Math.min(day, lastDay));
}

/**
 * Canonical unique period key for `(template_id, scheduled_period_key)` (§7 L323, §33 #7).
 */
export function computeScheduledPeriodKey(isoDate: string, frequency?: string): string {
  const clean = normalizeIsoDate(isoDate) || isoDate.slice(0, 10);
  const { year, month0, day } = parseUtcParts(clean);
  const f = String(frequency || 'monthly').toLowerCase().trim();

  if (f === 'daily') return clean;
  if (f === 'weekly' || f === 'biweekly' || f === 'bi-weekly') {
    // ISO-8601 week key YYYY-Www
    const target = new Date(Date.UTC(year, month0, day));
    const dayNum = target.getUTCDay() || 7;
    target.setUTCDate(target.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil(((target.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
    return `${target.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
  }
  if (f === 'quarterly') {
    const q = Math.floor(month0 / 3) + 1;
    return `${year}-Q${q}`;
  }
  if (f === 'yearly' || f === 'annual') {
    return String(year);
  }
  return `${year}-${String(month0 + 1).padStart(2, '0')}`;
}

/**
 * Accurate year-aware expected occurrence count between start and end dates.
 * Fixes SQL `EXTRACT(month FROM AGE(...))` which dropped years on >12 month spans.
 */
export function computeExpectedOccurrencesCount(
  frequency: string,
  startIso?: string | null,
  endIso?: string | null,
): number | null {
  const s = normalizeIsoDate(startIso);
  const e = normalizeIsoDate(endIso);
  if (!s || !e) return null;
  if (e < s) return 0;

  const f = String(frequency || 'monthly').toLowerCase().trim();
  const days = diffDaysIso(s, e);
  if (f === 'daily') return Math.max(0, days);
  if (f === 'weekly') return Math.max(0, Math.floor(days / 7));
  if (f === 'biweekly' || f === 'bi-weekly') return Math.max(0, Math.floor(days / 14));

  const sp = parseUtcParts(s);
  const ep = parseUtcParts(e);
  let totalMonths = (ep.year - sp.year) * 12 + (ep.month0 - sp.month0);
  if (ep.day < sp.day) totalMonths -= 1;
  totalMonths = Math.max(0, totalMonths);

  if (f === 'quarterly') return Math.floor(totalMonths / 3);
  if (f === 'yearly' || f === 'annual') return Math.floor(totalMonths / 12);
  return totalMonths;
}

/**
 * Strict date validation for creating/updating recurring templates (§9, §33 #5).
 */
export function validateRecurringScheduleDates(params: {
  startDate?: string;
  nextOccurrence?: string;
  endDate?: string | null;
}): string | null {
  const s = normalizeIsoDate(params.startDate);
  const n = normalizeIsoDate(params.nextOccurrence);
  if (!s || !n) return 'Use valid start and next occurrence dates (YYYY-MM-DD).';
  if (n < s) return 'Next occurrence must be on or after the start date.';
  if (params.endDate != null && String(params.endDate).trim() !== '') {
    const e = normalizeIsoDate(params.endDate);
    if (!e) return 'End date must be a valid date (YYYY-MM-DD).';
    if (e < s) return 'End date must be on or after the start date.';
    if (n > e) return 'Next occurrence cannot be after the end date.';
  }
  return null;
}

/**
 * Converts a single recurring schedule's amount to its monthly equivalent in native units.
 */
export function toMonthlyEquivalent(amount: number, frequency?: string): number {
  const abs = Math.abs(Number(amount || 0));
  const f = String(frequency || 'monthly').toLowerCase().trim();
  switch (f) {
    case 'daily':
      return abs * 30.4375;
    case 'weekly':
      return (abs * 52.1775) / 12;
    case 'biweekly':
    case 'bi-weekly':
      return (abs * 26.08875) / 12;
    case 'quarterly':
      return abs / 3;
    case 'yearly':
    case 'annual':
      return abs / 12;
    case 'monthly':
    default:
      return abs;
  }
}

/**
 * Multi-currency normalized KPI totals for Recurring Transactions (§6, §8, §33 #6).
 * Strictly converts every schedule into `orgCurrency` before summing, and excludes expired schedules.
 */
export function computeMultiCurrencyRecurringTotals(params: {
  schedules: Record<string, any>[];
  orgCurrency: string;
  asOfDate?: Date | string;
  pendingApprovalCount?: number;
}): RecurringTotalsResult {
  const baseCurr = String(params.orgCurrency || 'USD').toUpperCase().trim();
  const todayIso =
    typeof params.asOfDate === 'string'
      ? (normalizeIsoDate(params.asOfDate) || normalizeIsoDate(new Date())!)
      : normalizeIsoDate(params.asOfDate || new Date())!;
  const dueSoonIso = addDaysIso(todayIso, 7);

  let active = 0;
  let monthlyIncome = 0;
  let monthlyExpense = 0;
  let dueSoon = 0;
  let overdue = 0;
  const byCurrency: Record<string, { income: number; expense: number; net: number }> = {};

  for (const s of params.schedules || []) {
    if (s.is_active === false || s.isActive === false) continue;

    const nextIso = normalizeIsoDate(s.next_occurrence || s.nextOccurrence || s.start_date || s.startDate);
    const endIso = normalizeIsoDate(s.end_date || s.endDate);
    const genCount = Number(s.generated_occurrence_count ?? s.generatedOccurrenceCount ?? 0);
    const expectedRaw = s.total_occurrences_expected ?? s.totalOccurrencesExpected;
    const expectedCount = expectedRaw != null && expectedRaw !== '' ? Number(expectedRaw) : null;

    // Exclude already-expired or completed schedules from active KPI totals
    if (endIso && nextIso && nextIso > endIso) continue;
    if (expectedCount != null && Number.isFinite(expectedCount) && genCount >= expectedCount) continue;

    active++;
    const rawAmt = Math.abs(Number(s.amount || 0));
    const nativeCurr = String(s.currency || baseCurr).toUpperCase().trim();
    const freq = String(s.frequency || 'monthly').toLowerCase().trim();
    const monthlyNative = toMonthlyEquivalent(rawAmt, freq);
    const monthlyBase = convertCurrency(monthlyNative, nativeCurr, baseCurr);
    const isCredit = s.type === 'credit';

    if (!byCurrency[nativeCurr]) {
      byCurrency[nativeCurr] = { income: 0, expense: 0, net: 0 };
    }

    if (isCredit) {
      monthlyIncome += monthlyBase;
      byCurrency[nativeCurr].income = round2(byCurrency[nativeCurr].income + monthlyNative);
    } else {
      monthlyExpense += monthlyBase;
      byCurrency[nativeCurr].expense = round2(byCurrency[nativeCurr].expense + monthlyNative);
    }
    byCurrency[nativeCurr].net = round2(byCurrency[nativeCurr].income - byCurrency[nativeCurr].expense);

    if (nextIso) {
      if (nextIso < todayIso) overdue++;
      if (nextIso <= dueSoonIso) dueSoon++;
    }
  }

  return {
    active,
    monthlyIncome: round2(monthlyIncome),
    monthlyExpense: round2(monthlyExpense),
    netMonthly: round2(monthlyIncome - monthlyExpense),
    dueSoon,
    overdue,
    pendingApproval: params.pendingApprovalCount ?? 0,
    currency: baseCurr,
    byCurrency,
  };
}

// ── Narration Normalization for Merchant / Vendor Clustering (§11) ──────────

const BOILERPLATE_WORDS = new Set([
  'payment', 'pmt', 'paid', 'pay', 'purchase', 'pos', 'ach', 'wire', 'debit', 'credit',
  'card', 'visa', 'mastercard', 'amex', 'online', 'autopay', 'auto', 'recurring',
  'monthly', 'weekly', 'annual', 'yearly', 'invoice', 'inv', 'bill', 'ref', 'txn',
  'transaction', 'id', 'no', 'num', 'number', 'for', 'from', 'to', 'the', 'of', 'inc',
  'llc', 'ltd', 'corp', 'co', 'expense', 'income', 'fee', 'charge', 'transfer',
  'jan', 'january', 'feb', 'february', 'mar', 'march', 'apr', 'april', 'may',
  'jun', 'june', 'jul', 'july', 'aug', 'august', 'sep', 'sept', 'september',
  'oct', 'october', 'nov', 'november', 'dec', 'december',
]);

/**
 * Strips dates, invoice/reference IDs, currency codes, and bank boilerplate from
 * raw narrations to cluster repeat occurrences of the same vendor/counterparty (§11).
 */
export function normalizeMerchantSignature(rawText: string): { key: string; displayLabel: string; tokens: string[] } {
  const raw = String(rawText || '').trim();
  if (!raw) return { key: '', displayLabel: '', tokens: [] };

  // Take primary line before multiline metadata blocks (e.g. "office supplies\n\nPayee: ...")
  const firstLine = raw.split(/\r?\n/)[0].trim();

  // Strip common structured prefixes ("Recurring: ...", "Expense · ...", "Income · ...")
  const strippedPrefix = firstLine
    .replace(/^recurring:\s*/i, '')
    .replace(/\|\s*pay date:.*$/i, '')
    .replace(/^(expense|income)\s*[·:\-]\s*/i, '')
    .replace(/\b(txn|ref|inv|invoice|order|auth|chk|check)[\s#:\-]*[a-z0-9-]{2,}\b/gi, ' ')
    .replace(/\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b/g, ' ')
    .replace(/\b\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\b/g, ' ')
    .replace(/\b(20\d{2}|19\d{2})\b/g, ' ')
    .replace(/[*#]+\d{2,}/g, ' ')
    .replace(/\b\d{3,}\b/g, ' ');

  const cleanedWords = strippedPrefix
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !BOILERPLATE_WORDS.has(w));

  const uniqueTokens = Array.from(new Set(cleanedWords));
  const key = uniqueTokens.slice(0, 5).sort().join('_');

  const displayLabel = strippedPrefix
    .replace(/[—–\-|·]+$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 80) || firstLine.slice(0, 80);

  return { key, displayLabel, tokens: uniqueTokens };
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function tokenOverlapScore(tokensA: string[], tokensB: string[]): number {
  if (tokensA.length === 0 || tokensB.length === 0) return 0;
  const setB = new Set(tokensB);
  let hits = 0;
  for (const t of tokensA) {
    if (setB.has(t)) hits++;
  }
  return hits / Math.max(1, Math.min(tokensA.length, tokensB.length));
}

/**
 * Automatic Monthly (and Weekly / Quarterly / Yearly) Recurring Pattern Detector.
 *
 * Implements Handoff v1.2 §§1, 5, 8, 9, 11, 33:
 *  - Deterministic, explainable cadence + native-currency amount band analysis
 *  - Excludes non-posted rows, internal transfers, loan repayments, and other-world rows
 *  - Deduplicates against active recurring schedules and active loans
 *  - Produces human-confirmable candidates (never silently auto-posts)
 */
export function detectRecurringPatterns(params: {
  transactions: Record<string, any>[];
  existingRecurring?: Record<string, any>[];
  existingLoans?: Record<string, any>[];
  catMap?: Map<string, string>;
  bankWorldMap?: Map<string, 'business' | 'personal'>;
  worldFilter?: WorldFilter;
  orgCurrency: string;
  asOfDate?: Date | string;
}): DetectedRecurringCandidate[] {
  const {
    transactions,
    existingRecurring = [],
    existingLoans = [],
    catMap = new Map<string, string>(),
    bankWorldMap = new Map<string, 'business' | 'personal'>(),
    worldFilter = 'business',
    orgCurrency,
    asOfDate = new Date(),
  } = params;

  const baseCurr = String(orgCurrency || 'USD').toUpperCase().trim();
  const todayIso =
    typeof asOfDate === 'string'
      ? (normalizeIsoDate(asOfDate) || normalizeIsoDate(new Date())!)
      : normalizeIsoDate(asOfDate)!;

  // Index existing active schedules & loans for deduplication (§33 #1, #7)
  const existingScheduleSignatures = (existingRecurring || [])
    .filter((r) => r.is_active !== false && r.isActive !== false)
    .map((r) => ({
      dir: r.type === 'credit' ? 'credit' : 'debit',
      sig: normalizeMerchantSignature(r.description || ''),
      amount: Math.abs(Number(r.amount || 0)),
      currency: String(r.currency || baseCurr).toUpperCase().trim(),
    }));

  const existingLoanSignatures = (existingLoans || [])
    .filter((l) => String(l.status || 'active').toLowerCase() !== 'paid')
    .map((l) => ({
      dir: l.type === 'to_receive' ? 'credit' : 'debit',
      sig: normalizeMerchantSignature(`${l.description || ''} ${l.party || ''}`),
    }));

  // 1. Filter to eligible posted, external, world-scoped transactions
  interface ClusterRow {
    id: string;
    isoDate: string;
    amount: number;
    currency: string;
    direction: 'credit' | 'debit';
    bankAccountId: string;
    categoryId: string | null;
    departmentId: string | null;
    projectId: string | null;
    worldScope: 'business' | 'personal';
    displayLabel: string;
    merchantKey: string;
    tokens: string[];
  }

  const groups = new Map<string, ClusterRow[]>();

  for (const row of transactions || []) {
    const status = String(row.status || 'classified').toLowerCase().trim();
    if (NON_POSTED_STATUSES.has(status)) continue;

    const tags: string[] = Array.isArray(row.tags) ? row.tags.map(String) : [];
    // Skip transactions already generated by a recurring schedule
    if (tags.includes('recurring') || String(row.source || '').toLowerCase() === 'recurring' || String(row.id || '').startsWith('txn-rec-')) {
      continue;
    }

    const txnMeta = {
      isTransfer: Boolean(row.is_transfer || row.isTransfer),
      transferGroupId: row.transfer_group_id || row.transferGroupId,
      tags,
      categoryId: row.category_id || row.categoryId,
      description: String(row.description || ''),
      narration: String(row.narration || ''),
    };
    if (isTransferTxn(txnMeta, catMap)) continue;
    if (row.type !== 'credit' && isLoanRepaymentTxn(txnMeta, catMap)) continue;

    const isoDate = normalizeIsoDate(row.date);
    if (!isoDate || isoDate > todayIso) continue;

    const amt = Math.abs(Number(row.original_amount ?? row.amount ?? 0));
    if (!Number.isFinite(amt) || amt <= 0) continue;

    const bankId = String(row.bank_account_id || row.bankAccountId || '');
    const bankWorld = bankId ? bankWorldMap.get(bankId) : undefined;
    const worldScope: 'business' | 'personal' =
      row.world_scope === 'personal' || tags.includes('personal') || bankWorld === 'personal'
        ? 'personal'
        : 'business';
    if (worldFilter !== 'all' && worldScope !== worldFilter) continue;

    const direction: 'credit' | 'debit' = row.type === 'credit' ? 'credit' : 'debit';
    const nativeCurr = String(row.original_currency || row.currency || baseCurr).toUpperCase().trim();
    const rawText = String(row.description || row.narration || '').trim();
    const sig = normalizeMerchantSignature(rawText);
    if (!sig.key) continue;

    const groupKey = `${sig.key}|${direction}|${nativeCurr}|${worldScope}`;
    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey)!.push({
      id: String(row.id),
      isoDate,
      amount: round2(amt),
      currency: nativeCurr,
      direction,
      bankAccountId: bankId,
      categoryId: row.category_id ? String(row.category_id) : null,
      departmentId: row.department_id ? String(row.department_id) : null,
      projectId: row.project_id ? String(row.project_id) : null,
      worldScope,
      displayLabel: sig.displayLabel,
      merchantKey: sig.key,
      tokens: sig.tokens,
    });
  }

  // 2. Analyze cadence & amount stability per cluster
  const candidates: DetectedRecurringCandidate[] = [];

  for (const [groupKey, rows] of groups.entries()) {
    if (rows.length < 2) continue;

    // Sort oldest -> newest, collapse multiple identical-date entries into one date slot
    const sorted = [...rows].sort((a, b) => a.isoDate.localeCompare(b.isoDate));
    const distinctByDate: ClusterRow[] = [];
    for (const r of sorted) {
      if (distinctByDate.length === 0 || distinctByDate[distinctByDate.length - 1].isoDate !== r.isoDate) {
        distinctByDate.push(r);
      }
    }
    if (distinctByDate.length < 2) continue;

    // Compute inter-occurrence day intervals
    const intervals: number[] = [];
    for (let i = 1; i < distinctByDate.length; i++) {
      intervals.push(diffDaysIso(distinctByDate[i - 1].isoDate, distinctByDate[i].isoDate));
    }

    const medInterval = round2(median(intervals));
    const distinctMonths = new Set(distinctByDate.map((r) => r.isoDate.slice(0, 7)));
    const daysOfMonth = distinctByDate.map((r) => parseUtcParts(r.isoDate).day);
    const medDay = Math.round(median(daysOfMonth));
    const isMonthEndCluster = daysOfMonth.every((d) => d >= 28);
    const maxDayDrift = isMonthEndCluster
      ? Math.max(...daysOfMonth) - Math.min(...daysOfMonth)
      : Math.max(...daysOfMonth.map((d) => Math.abs(d - medDay)));

    let detectedFreq: 'weekly' | 'monthly' | 'quarterly' | 'yearly' | null = null;
    if (distinctMonths.size >= 2 && medInterval >= 26 && medInterval <= 35 && maxDayDrift <= 5) {
      detectedFreq = 'monthly';
    } else if (distinctByDate.length >= 3 && medInterval >= 6 && medInterval <= 8) {
      detectedFreq = 'weekly';
    } else if (distinctMonths.size >= 2 && medInterval >= 84 && medInterval <= 97 && maxDayDrift <= 6) {
      detectedFreq = 'quarterly';
    } else if (distinctMonths.size >= 2 && medInterval >= 355 && medInterval <= 375 && maxDayDrift <= 6) {
      detectedFreq = 'yearly';
    }

    if (!detectedFreq) continue;

    // Ignore stale clusters that haven't occurred in > 2.5x their expected period
    const latest = distinctByDate[distinctByDate.length - 1];
    const maxStalenessDays =
      detectedFreq === 'weekly' ? 21 : detectedFreq === 'monthly' ? 75 : detectedFreq === 'quarterly' ? 220 : 450;
    if (diffDaysIso(latest.isoDate, todayIso) > maxStalenessDays) continue;

    // Check deduplication against active schedules & active loans
    const alreadyScheduled = existingScheduleSignatures.some(
      (es) =>
        es.dir === latest.direction &&
        es.currency === latest.currency &&
        (es.sig.key === latest.merchantKey || tokenOverlapScore(es.sig.tokens, latest.tokens) >= 0.75),
    );
    if (alreadyScheduled) continue;

    const alreadyLoan = existingLoanSignatures.some(
      (el) =>
        el.dir === latest.direction &&
        (el.sig.key === latest.merchantKey || tokenOverlapScore(el.sig.tokens, latest.tokens) >= 0.8),
    );
    if (alreadyLoan) continue;

    // Native-currency amount stability
    const amounts = distinctByDate.map((r) => r.amount);
    const medAmt = round2(median(amounts));
    const minAmt = round2(Math.min(...amounts));
    const maxAmt = round2(Math.max(...amounts));
    const relSpread = medAmt > 0 ? (maxAmt - minAmt) / medAmt : 1;
    const amountType: 'fixed' | 'variable' = relSpread <= 0.03 ? 'fixed' : 'variable';

    // Require >= 3 occurrences for variable amounts so random 2-month coincidence doesn't spam suggestions
    if (amountType === 'variable' && distinctByDate.length < 3) continue;

    // Calibrated evidence score
    let score = 55;
    if (distinctByDate.length >= 3) score += 20;
    if (distinctByDate.length >= 5) score += 10;
    if (amountType === 'fixed') score += 12;
    if (maxDayDrift <= 2) score += 5;
    score = Math.min(98, score);

    const confidence: 'high' | 'medium' = score >= 80 && distinctByDate.length >= 3 ? 'high' : 'medium';

    // Project suggested next occurrence forward from latest seen date
    let nextOcc = computeNextOccurrenceIso(latest.isoDate, detectedFreq);
    let safety = 0;
    while (nextOcc < todayIso && safety < 12) {
      nextOcc = computeNextOccurrenceIso(nextOcc, detectedFreq);
      safety++;
    }

    const baseAmount = round2(convertCurrency(medAmt, latest.currency, baseCurr));
    const anchorDay = detectedFreq === 'weekly' ? null : medDay;
    const freqLabel = detectedFreq.charAt(0).toUpperCase() + detectedFreq.slice(1);
    const amountDesc =
      amountType === 'fixed'
        ? `consistent ${latest.currency} ${medAmt.toLocaleString()}`
        : `variable ${latest.currency} ${minAmt.toLocaleString()}–${maxAmt.toLocaleString()} (median ${medAmt.toLocaleString()})`;
    const anchorDesc =
      anchorDay != null ? (isMonthEndCluster ? ' near month-end' : ` around day ${anchorDay}`) : '';

    candidates.push({
      candidateKey: `cand-${groupKey}`,
      suggestedTitle: latest.displayLabel,
      merchantKey: latest.merchantKey,
      direction: latest.direction,
      frequency: detectedFreq,
      suggestedAmount: medAmt,
      currency: latest.currency,
      baseAmount,
      baseCurrency: baseCurr,
      amountType,
      amountRange: { min: minAmt, max: maxAmt },
      occurrenceCount: distinctByDate.length,
      matchedDates: distinctByDate.map((r) => r.isoDate),
      matchedTransactionIds: distinctByDate.map((r) => r.id),
      anchorDayOfMonth: anchorDay,
      medianIntervalDays: medInterval,
      lastSeenDate: latest.isoDate,
      suggestedNextOccurrence: nextOcc,
      bankAccountId: latest.bankAccountId,
      categoryId: latest.categoryId,
      departmentId: latest.departmentId,
      projectId: latest.projectId,
      worldScope: latest.worldScope,
      confidence,
      confidenceScore: score,
      explanation: `${freqLabel} pattern across ${distinctByDate.length} posted ${latest.direction}s (${amountDesc})${anchorDesc}.`,
    });
  }

  return candidates.sort((a, b) => b.confidenceScore - a.confidenceScore || b.baseAmount - a.baseAmount);
}

/**
 * Matches newly imported bank statement transactions against active recurring schedules
 * so an imported payment settles that period's recurring occurrence instead of double-counting (§10, §33 #1, #7).
 */
export function matchTransactionsToRecurringSchedules(params: {
  importedTransactions: Record<string, any>[];
  activeSchedules: Record<string, any>[];
  dateToleranceDays?: number;
  amountTolerancePct?: number;
}): RecurringImportMatch[] {
  const {
    importedTransactions,
    activeSchedules,
    dateToleranceDays = 5,
    amountTolerancePct = 0.03,
  } = params;

  const matches: RecurringImportMatch[] = [];
  const consumedScheduleIds = new Set<string>();

  for (const txn of importedTransactions || []) {
    const txnDate = normalizeIsoDate(txn.date);
    if (!txnDate) continue;
    const txnAmt = Math.abs(Number(txn.amount || 0));
    if (txnAmt <= 0) continue;

    const txnDir = txn.type === 'credit' ? 'credit' : 'debit';
    const txnCurr = String(txn.currency || 'USD').toUpperCase().trim();
    const txnSig = normalizeMerchantSignature(txn.description || txn.narration || '');
    if (!txnSig.key) continue;

    for (const sched of activeSchedules || []) {
      const schedId = String(sched.id);
      if (consumedScheduleIds.has(schedId)) continue;
      if (sched.is_active === false || sched.isActive === false) continue;

      const schedDir = sched.type === 'credit' ? 'credit' : 'debit';
      if (schedDir !== txnDir) continue;

      const schedCurr = String(sched.currency || 'USD').toUpperCase().trim();
      if (schedCurr !== txnCurr) continue;

      const schedDate = normalizeIsoDate(sched.next_occurrence || sched.nextOccurrence);
      if (!schedDate) continue;

      const dayDiff = Math.abs(diffDaysIso(schedDate, txnDate));
      if (dayDiff > dateToleranceDays) continue;

      const schedAmt = Math.abs(Number(sched.amount || 0));
      if (schedAmt <= 0) continue;
      const amtDiffPct = Math.abs(txnAmt - schedAmt) / schedAmt;
      if (amtDiffPct > amountTolerancePct) continue;

      const schedSig = normalizeMerchantSignature(sched.description || '');
      const overlap = tokenOverlapScore(schedSig.tokens, txnSig.tokens);
      const exactKey = Boolean(schedSig.key && schedSig.key === txnSig.key);
      if (!exactKey && overlap < 0.6) continue;

      const freq = String(sched.frequency || 'monthly');
      consumedScheduleIds.add(schedId);
      matches.push({
        transactionId: String(txn.id),
        transactionDate: txnDate,
        transactionAmount: round2(txnAmt),
        scheduleId: schedId,
        scheduleDescription: String(sched.description || ''),
        periodKey: computeScheduledPeriodKey(schedDate, freq),
        scheduledDate: schedDate,
        nextOccurrenceAfterMatch: computeNextOccurrenceIso(schedDate, freq),
        confidence: exactKey ? 95 : Math.round(70 + overlap * 25),
      });
      break;
    }
  }

  return matches;
}
