/**
 * useOrgServices — Phase 2 Bridge Hook
 * ========================================
 * Wraps every service with the current organization (and user) context so
 * components never have to pass `organizationId` / `userId` manually.
 *
 * REPLACES: useDataService.ts (synchronous, reads directly from mockDatabase arrays)
 * UPGRADE:  All methods are async, routed through the real service layer
 *           (transactionService, accountService, …) which read/write via
 *           dataStore.ts — the single swap point for a future REST / Supabase backend.
 *
 * ─── Namespace overview ───────────────────────────────────────────────────
 *   const svc = useOrgServices();
 *
 *   svc.transactions.getAll({ search: 'Stripe', page: 1 })
 *   svc.transactions.create({ … })
 *   svc.transactions.bulkCategorize(['txn-1', 'txn-2'], 'cat-expenses')
 *
 *   svc.accounts.getAll()
 *   svc.accounts.getBankAccounts()
 *   svc.accounts.getBalanceSheet()
 *
 *   svc.reports.getDashboardSummary()
 *   svc.reports.getCashFlow(6)
 *   svc.reports.getForecast(3)
 *
 *   svc.classification.classify('STRIPE PAYMENT', 500, 'credit')
 *   svc.classification.learnFromCorrection(txnId, correctCategoryId)
 *
 *   svc.notifications.getAll()
 *   svc.notifications.markAllAsRead()
 *
 *   svc.imports.previewFile(file)
 *   svc.imports.executeImport(uploadId, bankAccountId, mapping, { autoClassify: true })
 *
 *   svc.org.getMembers()
 *   svc.org.addMember(userId, 'editor')
 *
 *   // Meta helpers
 *   svc.orgId        // current org ID string
 *   svc.userId       // current user ID string
 *   svc.isReady      // false when no org is selected (prevents premature calls)
 *
 * ─── Usage with useService / useMutation hooks ────────────────────────────
 *   const svc = useOrgServices();
 *
 *   // Auto-fetch on mount:
 *   const { data, loading, error, refetch } = useService(
 *     () => svc.transactions.getAll({ page: 1 }),
 *     [svc.orgId]
 *   );
 *
 *   // Mutations:
 *   const createTxn = useMutation((data) => svc.transactions.create(data));
 *   await createTxn.execute({ description: 'New Invoice', amount: 5000, … });
 *
 * ─── Migration path ───────────────────────────────────────────────────────
 *   When wiring to a real backend, ONLY the service files change.
 *   This hook, its callers, and all UI components stay identical.
 */

import { useMemo } from 'react';
import { useAuth } from '@/contexts/AuthContext';

// Services
import { transactionService }    from '@/services/transactionService';
import { accountService }        from '@/services/accountService';
import { categoryService }       from '@/services/categoryService';
import { departmentService }     from '@/services/departmentService';
import { projectService }        from '@/services/projectService';
import { assetService }          from '@/services/assetService';
import { inventoryService }      from '@/services/inventoryService';
import { budgetService }         from '@/services/budgetService';
import { reportService }         from '@/services/reportService';
import { classificationService } from '@/services/classificationService';
import { notificationService }   from '@/services/notificationService';
import { importService }         from '@/services/importService';
import { organizationService }   from '@/services/organizationService';
import { recurringTransactionService } from '@/services/recurringTransactionService';
import { loanService } from '@/services/loanService';
import { costingService } from '@/services/costingService';
import { createSimulatorService } from '@/services/simulatorService';
import { profitIntelligenceService } from '@/services/profitIntelligenceService';
import { overheadAllocationService } from '@/services/overheadAllocationService';

// Types — re-exported so callers can import everything from one place
import type {
  TransactionFilters,
  PaginationParams,
  ServiceResponse,
  PaginatedResult,
  DashboardSummary,
  CashFlowSummary,
  ProfitLossReport,
  BalanceSheetReport,
  DepartmentProfitability,
  ProjectProfitability,
  BulkOperationResult,
  ImportPreview,
  ImportResult,
  ImportHistoryRecord,
  DateRange,
} from '@/services/types';

import type { ImportedTransaction } from '@/lib/importUtils';
import type {
  Account,
  BankAccount,
  Transaction,
  Category,
  Department,
  Project,
  Asset,
  DepreciationSchedule,
  InventoryItem,
  InventoryTransaction,
  OverheadAllocation,
  Budget,
  Loan,
  Notification,
  Organization,
  OrganizationMember,
  UserRole,
  RecurringTransaction,
  CommissionStructure,
  ExchangeRate,
} from '@/services/types';

import type { 
  WhatIfScenario,
  SimulatorBaseline,
  ProjectionPoint,
  ScenarioImpact,
} from '@/services/simulatorService';


import type { ClassificationRule, ClassificationResult } from '@/lib/classificationEngine';

// ─── Public type of the returned object (for components that want to type it) ──

export interface OrgServices {
  /** Current org ID — changes when user switches orgs */
  orgId: string;
  /** Current user ID */
  userId: string;
  /**
   * false when no organization is currently selected.
   * Gate service calls behind this flag to avoid no-op requests.
   */
  isReady: boolean;

  // ── Namespaced service bundles ───────────────────────────────────────────

  transactions: TransactionServices;
  accounts:     AccountServices;
  categories:   CategoryServices;
  departments:  DepartmentServices;
  projects:     ProjectServices;
  assets:       AssetServices;
  inventory:    InventoryServices;
  budgets:      BudgetServices;
  loans:        LoanServices;
  reports:      ReportServices;
  classification: ClassificationServices;
  notifications:  NotificationServices;
  imports:        ImportServices;
  org:            OrgAdminServices;
  recurring:      RecurringServices;
  costing:        CostingServices;
  simulator:      SimulatorServices;
  profitIntelligence: ProfitIntelligenceServices;
  overheadAllocations: OverheadAllocationServices;
}

// ── Namespace type declarations ──────────────────────────────────────────────

export interface TransactionServices {
  /** Paginated list with filtering */
  getAll(filters?: TransactionFilters): ReturnType<typeof transactionService.getAll>;
  getById(id: string): ReturnType<typeof transactionService.getById>;
  create(data: Omit<Transaction, 'id' | 'organizationId' | 'createdAt'>, options?: { idempotencyKey?: string }): ReturnType<typeof transactionService.create>;
  createTransfer(params: Parameters<typeof transactionService.createTransfer>[1]): ReturnType<typeof transactionService.createTransfer>;
  postToLedger(id: string): ReturnType<typeof transactionService.postToLedger>;
  reverse(id: string, reason?: string): ReturnType<typeof transactionService.reverseTransaction>;
  bulkCreate(transactions: Array<Omit<Transaction, 'id' | 'organizationId' | 'createdAt'>>): ReturnType<typeof transactionService.bulkCreate>;
  update(id: string, updates: Partial<Transaction>): ReturnType<typeof transactionService.update>;
  delete(id: string): ReturnType<typeof transactionService.delete>;
  bulkCategorize(ids: string[], categoryId: string, classifiedBy?: string): ReturnType<typeof transactionService.bulkCategorize>;
  bulkDelete(ids: string[]): ReturnType<typeof transactionService.bulkDelete>;
  getStats(dateFrom?: string, dateTo?: string): ReturnType<typeof transactionService.getStats>;
}

export interface AccountServices {
  /** Chart of accounts */
  getAll(): ReturnType<typeof accountService.getAll>;
  getById(id: string): ReturnType<typeof accountService.getById>;
  create(data: Omit<Account, 'id' | 'organizationId' | 'createdAt'>): ReturnType<typeof accountService.create>;
  update(id: string, updates: Partial<Account>): ReturnType<typeof accountService.update>;
  delete(id: string): ReturnType<typeof accountService.delete>;
  getAccountTree(): ReturnType<typeof accountService.getAccountTree>;
  /** Bank accounts linked to this org */
  getBankAccounts(): ReturnType<typeof accountService.getBankAccounts>;
  createBankAccount(data: Omit<BankAccount, 'id' | 'organizationId'>): ReturnType<typeof accountService.createBankAccount>;
  updateBankAccount(id: string, updates: Partial<BankAccount>): ReturnType<typeof accountService.updateBankAccount>;
  deleteBankAccount(id: string): ReturnType<typeof accountService.deleteBankAccount>;
  getBalanceSheet(asOfDate?: string): ReturnType<typeof accountService.getBalanceSheet>;
}

export interface CategoryServices {
  getAll(): ReturnType<typeof categoryService.getAll>;
  getById(id: string): ReturnType<typeof categoryService.getById>;
  create(data: Omit<Category, 'id' | 'organizationId'>): ReturnType<typeof categoryService.create>;
  update(id: string, updates: Partial<Category>): ReturnType<typeof categoryService.update>;
  delete(id: string): ReturnType<typeof categoryService.delete>;
  addPattern(categoryId: string, pattern: string): ReturnType<typeof categoryService.addPattern>;
  removePattern(categoryId: string, pattern: string): ReturnType<typeof categoryService.removePattern>;
  getUsageStats(): ReturnType<typeof categoryService.getUsageStats>;
}

export interface DepartmentServices {
  getAll(): ReturnType<typeof departmentService.getAll>;
  getById(id: string): ReturnType<typeof departmentService.getById>;
  create(data: Omit<Department, 'id' | 'organizationId'>): ReturnType<typeof departmentService.create>;
  update(id: string, updates: Partial<Department>): ReturnType<typeof departmentService.update>;
  delete(id: string): ReturnType<typeof departmentService.delete>;
  /** Department-level P&L with overhead allocation */
  getProfitability(params?: { from?: string; to?: string; period?: '1M' | '3M' | '1Y' }): ReturnType<typeof departmentService.getProfitability>;
}

export interface RecurringServices {
  getAll(): ReturnType<typeof recurringTransactionService.getAll>;
  create(data: Omit<RecurringTransaction, 'id' | 'organizationId'>): ReturnType<typeof recurringTransactionService.create>;
  update(id: string, updates: Partial<RecurringTransaction>): ReturnType<typeof recurringTransactionService.update>;
  delete(id: string): ReturnType<typeof recurringTransactionService.delete>;
  toggle(id: string): ReturnType<typeof recurringTransactionService.toggle>;
  generate(asOfDate?: string): ReturnType<typeof recurringTransactionService.generate>;
  generateSingle(recurringId: string): ReturnType<typeof recurringTransactionService.generateSingle>;
  getTotals(): ReturnType<typeof recurringTransactionService.getTotals>;
}

export interface ProjectServices {
  getAll(): ReturnType<typeof projectService.getAll>;
  getById(id: string): ReturnType<typeof projectService.getById>;
  create(data: Omit<Project, 'id' | 'organizationId'>): ReturnType<typeof projectService.create>;
  update(id: string, updates: Partial<Project>): ReturnType<typeof projectService.update>;
  delete(id: string): ReturnType<typeof projectService.delete>;
  /** Quoted vs actual cost, margin %, budget variance */
  getProfitability(params?: { from?: string; to?: string; period?: '1M' | '3M' | '12M' }): ReturnType<typeof projectService.getProfitability>;
  getProjectDetails(projectId: string, params?: { from?: string; to?: string }): ReturnType<typeof projectService.getProjectDetails>;
  approveTimesheetEntry(projectId: string, entryId: string): ReturnType<typeof projectService.approveTimesheetEntry>;
  reviseTimesheetEntry(projectId: string, entryId: string, newHours: number, reason?: string): ReturnType<typeof projectService.reviseTimesheetEntry>;
  rejectTimesheetEntry(projectId: string, entryId: string, reason?: string): ReturnType<typeof projectService.rejectTimesheetEntry>;
  getProjectTransactions(projectId: string): ReturnType<typeof projectService.getProjectTransactions>;
}

export interface AssetServices {
  getAll(): ReturnType<typeof assetService.getAll>;
  getById(id: string): ReturnType<typeof assetService.getById>;
  create(data: Omit<Asset, 'id' | 'organizationId'>): ReturnType<typeof assetService.create>;
  update(id: string, updates: Partial<Asset>): ReturnType<typeof assetService.update>;
  delete(id: string): ReturnType<typeof assetService.delete>;
  dispose(id: string, disposalDate: string, disposalAmount: number): ReturnType<typeof assetService.dispose>;
  listDepreciationSchedules(): ReturnType<typeof assetService.listDepreciationSchedules>;
  getDepreciationSchedule(assetId: string): ReturnType<typeof assetService.getDepreciationSchedule>;
  postDepreciation(assetId: string, period: string): ReturnType<typeof assetService.postDepreciation>;
  getSummary(): ReturnType<typeof assetService.getSummary>;
  getAnalytics(): ReturnType<typeof assetService.getAnalytics>;
}

export interface InventoryServices {
  getAll(): ReturnType<typeof inventoryService.getAll>;
  getById(id: string): ReturnType<typeof inventoryService.getById>;
  create(data: Omit<InventoryItem, 'id' | 'organizationId'>): ReturnType<typeof inventoryService.create>;
  update(id: string, updates: Partial<InventoryItem>): ReturnType<typeof inventoryService.update>;
  recordTransaction(data: Omit<InventoryTransaction, 'id' | 'organizationId'>): ReturnType<typeof inventoryService.recordTransaction>;
  getTransactions(inventoryItemId: string): ReturnType<typeof inventoryService.getTransactions>;
  getAllTransactions(): ReturnType<typeof inventoryService.getAllTransactions>;
  getLowStockAlerts(): ReturnType<typeof inventoryService.getLowStockAlerts>;
  getValuation(): ReturnType<typeof inventoryService.getValuation>;
  getTurnover(months?: number): ReturnType<typeof inventoryService.getTurnover>;
  getReorderSuggestions(): ReturnType<typeof inventoryService.getReorderSuggestions>;
}

export interface BudgetServices {
  getAll(): ReturnType<typeof budgetService.getAll>;
  getById(id: string): ReturnType<typeof budgetService.getById>;
  create(data: Omit<Budget, 'id' | 'organizationId'>): ReturnType<typeof budgetService.create>;
  update(id: string, updates: Partial<Budget>): ReturnType<typeof budgetService.update>;
  delete(id: string): ReturnType<typeof budgetService.delete>;
  getVarianceAnalysis(): ReturnType<typeof budgetService.getVarianceAnalysis>;
  /** Budgets at ≥ 80% utilization */
  getAlerts(): ReturnType<typeof budgetService.getAlerts>;
  getSummary(): ReturnType<typeof budgetService.getSummary>;
  createFromTemplate(
    templateName: string,
    totalAmount: number,
    categories: { category: string; percentage: number }[],
    options?: {
      period?: 'monthly' | 'quarterly' | 'yearly';
      startDate?: string;
      endDate?: string;
      currency?: string;
    },
  ): ReturnType<typeof budgetService.createFromTemplate>;
  rollForward(id: string): ReturnType<typeof budgetService.rollForward>;
}

export interface LoanServices {
  getAll(): ReturnType<typeof loanService.getAll>;
  getById(id: string): ReturnType<typeof loanService.getById>;
  create(data: Omit<Loan, 'id' | 'organizationId'>): ReturnType<typeof loanService.create>;
  update(id: string, updates: Partial<Loan>): ReturnType<typeof loanService.update>;
  delete(id: string): ReturnType<typeof loanService.delete>;
  recordPayment(
    loanId: string,
    paymentData: {
      amount: number;
      paymentMonth?: string;
      paidOn?: string;
      method?: string;
      bankAccountId?: string;
      reference?: string;
      notes?: string;
    }
  ): ReturnType<typeof loanService.recordPayment>;
  getPayments(loanId: string): ReturnType<typeof loanService.getPayments>;
  getAllPayments(): ReturnType<typeof loanService.getAllPayments>;
}

export interface ReportServices {
  /** Top-level KPI summary for the dashboard */
  getDashboardSummary(options?: { world?: 'business' | 'personal' | 'all' }): ReturnType<typeof reportService.getDashboardSummary>;
  getProfitLoss(fromOrRange?: string | DateRange, to?: string): ReturnType<typeof reportService.getProfitLoss>;
  getBalanceSheet(asOfDate?: string): ReturnType<typeof reportService.getBalanceSheet>;
  getCashFlow(months?: number, dateRange?: DateRange): ReturnType<typeof reportService.getCashFlow>;
  getExpenseBreakdown(): ReturnType<typeof reportService.getExpenseBreakdown>;
  getRevenueBreakdown(): ReturnType<typeof reportService.getRevenueBreakdown>;
  /** AI-powered cash flow forecast */
  getForecast(monthsAhead?: number): ReturnType<typeof reportService.getForecast>;
  getDepartmentProfitability(dateRange?: DateRange): ReturnType<typeof reportService.getDepartmentProfitability>;
}

export interface ClassificationServices {
  /** AI-classify a single transaction narration */
  classify(narration: string, amount: number, type: 'debit' | 'credit', world?: 'business' | 'personal', transactionId?: string): ReturnType<typeof classificationService.classify>;
  batchClassify(
    transactions: Array<{ narration: string; amount: number; type: 'debit' | 'credit'; id?: string }>,
    useAI?: boolean
  ): ReturnType<typeof classificationService.batchClassify>;
  /** Update model from user correction */
  learnFromCorrection(transactionId: string, correctCategoryId: string, departmentId?: string): ReturnType<typeof classificationService.learnFromCorrection>;
  recordHumanOverride(payload: {
    transactionId: string;
    correctCategoryId: string;
    departmentId?: string;
    projectId?: string;
    scope: 'row' | 'batch' | 'future';
    rationale?: string;
    world?: 'business' | 'personal';
  }): ReturnType<typeof classificationService.recordHumanOverride>;
  getRules(): ReturnType<typeof classificationService.getRules>;
  addRule(rule: any): ReturnType<typeof classificationService.addRule>;
  updateRule(ruleId: string, updates: any): ReturnType<typeof classificationService.updateRule>;
  deleteRule(ruleId: string): ReturnType<typeof classificationService.deleteRule>;
  revertRuleVersion(ruleId: string, targetVersion: number, reason?: string): ReturnType<typeof classificationService.revertRuleVersion>;
  setRuleStatus(ruleId: string, status: 'active' | 'disabled' | 'archived'): ReturnType<typeof classificationService.setRuleStatus>;
  simulateRuleCollision(candidateRule: any): ReturnType<typeof classificationService.simulateRuleCollision>;
  getBulkReviewGroups(): ReturnType<typeof classificationService.getBulkReviewGroups>;
  approveBulkReviewGroup(transactionIds: string[], categoryId: string): ReturnType<typeof classificationService.approveBulkReviewGroup>;
  getDriftMetrics(): ReturnType<typeof classificationService.getDriftMetrics>;
  getTransactionEvidence(transactionId: string): ReturnType<typeof classificationService.getTransactionEvidence>;
  getStats(): ReturnType<typeof classificationService.getStats>;
}

export interface NotificationServices {
  /** Fetch all notifications for the current user in this org */
  getAll(): ReturnType<typeof notificationService.getAll>;
  getUnreadCount(): ReturnType<typeof notificationService.getUnreadCount>;
  markAsRead(notificationId: string): ReturnType<typeof notificationService.markAsRead>;
  markAllAsRead(): ReturnType<typeof notificationService.markAllAsRead>;
  /**
   * Create a notification scoped to the current user + org.
   * `userId` and `organizationId` are automatically injected.
   */
  create(
    notification: Omit<Notification, 'id' | 'createdAt' | 'userId' | 'organizationId'>
  ): ReturnType<typeof notificationService.create>;
  delete(notificationId: string): ReturnType<typeof notificationService.delete>;
}

export interface ImportServices {
  /** Parse & preview a bank statement file (no data written yet) */
  previewFile(file: File): ReturnType<typeof importService.previewFile>;
  executeImport(
    uploadId: string,
    bankAccountId: string,
    columnMapping: Record<string, string>,
    options?: { skipDuplicates?: boolean; autoClassify?: boolean; currency?: string }
  ): ReturnType<typeof importService.executeImport>;
  /** Client-parsed CSV rows → ledger (SETTLE-001) */
  commitParsedImport(
    bankAccountId: string,
    currency: string,
    fileName: string,
    rows: ImportedTransaction[],
    options?: {
      skipDuplicates?: boolean;
      autoClassify?: boolean;
      fileSize?: number;
      fileContent?: string;
    }
  ): ReturnType<typeof importService.commitParsedImport>;
  getHistory(): ReturnType<typeof importService.getHistory>;
  deleteHistory(id: string): ReturnType<typeof importService.deleteHistory>;
}

export interface OrgAdminServices {
  /** Current org details */
  get(): ReturnType<typeof organizationService.getById>;
  update(updates: Partial<Organization>): ReturnType<typeof organizationService.update>;
  delete(): ReturnType<typeof organizationService.delete>;
  /** Members of this organization (with embedded user records) */
  getMembers(): ReturnType<typeof organizationService.getMembers>;
  addMember(userId: string, role: UserRole): ReturnType<typeof organizationService.addMember>;
  updateMemberRole(userId: string, newRole: UserRole): ReturnType<typeof organizationService.updateMemberRole>;
  removeMember(userId: string): ReturnType<typeof organizationService.removeMember>;
}

export interface CostingServices {
  getOverheadAllocations(): ReturnType<typeof costingService.getOverheadAllocations>;
  createOverheadAllocation(data: Omit<OverheadAllocation, 'id' | 'organizationId'>): ReturnType<typeof costingService.createOverheadAllocation>;
  updateOverheadAllocation(id: string, updates: Partial<OverheadAllocation>): ReturnType<typeof costingService.updateOverheadAllocation>;
  deleteOverheadAllocation(id: string): ReturnType<typeof costingService.deleteOverheadAllocation>;
  setAllocationMethod(method: OverheadAllocation['allocationBase']): ReturnType<typeof costingService.setAllocationMethod>;
  getCommissionStructures(): ReturnType<typeof costingService.getCommissionStructures>;
  createCommissionStructure(data: Omit<CommissionStructure, 'id' | 'organizationId'>): ReturnType<typeof costingService.createCommissionStructure>;
  updateCommissionStructure(id: string, updates: Partial<CommissionStructure>): ReturnType<typeof costingService.updateCommissionStructure>;
  deleteCommissionStructure(id: string): ReturnType<typeof costingService.deleteCommissionStructure>;
  getExchangeRates(): ReturnType<typeof costingService.getExchangeRates>;
  convertCurrency(amount: number, from: string, to: string): ReturnType<typeof costingService.convertCurrency>;
}

export interface SimulatorServices {
  /** Get baseline metrics from real org data */
  getBaseline(): Promise<ServiceResponse<SimulatorBaseline>>;
  /** Get 12-month projection based on historical growth */
  getProjection(months?: number): Promise<ServiceResponse<ProjectionPoint[]>>;
  /** Get all saved scenarios */
  getAllScenarios(): Promise<ServiceResponse<WhatIfScenario[]>>;
  /** Get a single scenario by ID */
  getScenario(scenarioId: string): Promise<ServiceResponse<WhatIfScenario | null>>;
  /** Create a new scenario */
  createScenario(scenario: Omit<WhatIfScenario, 'id' | 'organizationId' | 'createdAt' | 'updatedAt' | 'createdBy'>): Promise<ServiceResponse<WhatIfScenario>>;
  /** Update an existing scenario */
  updateScenario(scenarioId: string, updates: Partial<Omit<WhatIfScenario, 'id' | 'organizationId' | 'createdAt' | 'updatedAt' | 'createdBy'>>): Promise<ServiceResponse<WhatIfScenario>>;
  /** Delete a scenario */
  deleteScenario(scenarioId: string): Promise<ServiceResponse<void>>;
  /** Calculate impact of a scenario (client-side) */
  calculateImpact(baseline: SimulatorBaseline, scenario: Partial<WhatIfScenario>): ScenarioImpact;
}

export interface ProfitIntelligenceServices {
  getSummary(params?: { from?: string; to?: string; period?: '1M' | '3M' | '1Y' }): ReturnType<typeof profitIntelligenceService.getSummary>;
  getClientProfitability(params?: { from?: string; to?: string; period?: '1M' | '3M' | '1Y' }): ReturnType<typeof profitIntelligenceService.getClientProfitability>;
  getOverheadSummary(): ReturnType<typeof profitIntelligenceService.getOverheadSummary>;
  getBusinessVsPersonal(params?: { from?: string; to?: string; period?: '1M' | '3M' | '1Y' }): ReturnType<typeof profitIntelligenceService.getBusinessVsPersonal>;
}

export interface OverheadAllocationServices {
  getAll(): ReturnType<typeof overheadAllocationService.getAll>;
  getById(id: string): ReturnType<typeof overheadAllocationService.getById>;
  create(data: Omit<OverheadAllocation, 'id' | 'organizationId'>): ReturnType<typeof overheadAllocationService.create>;
  update(id: string, updates: Partial<OverheadAllocation>): ReturnType<typeof overheadAllocationService.update>;
  delete(id: string): ReturnType<typeof overheadAllocationService.delete>;
}

// ─── The hook ────────────────────────────────────────────────────────────────

/**
 * Returns a stable, org-scoped bundle of every service method.
 *
 * The returned object is re-created only when `orgId` or `userId` changes
 * (i.e. on login, logout, or org switch), so it is safe to pass as a prop
 * or include in useEffect/useService dependency arrays.
 */
export function useOrgServices(): OrgServices {
  const { currentOrganization, user } = useAuth();

  const orgId  = currentOrganization?.id  ?? '';
  const userId = user?.id                 ?? '';

  return useMemo<OrgServices>(() => ({
    orgId,
    userId,
    isReady: !!orgId,

    // ── Transactions ────────────────────────────────────────────────────────
    transactions: {
      getAll:           (filters?)           => transactionService.getAll(orgId, filters),
      getById:          (id)                 => transactionService.getById(id, orgId || undefined),
      create:           (data, options?)     => transactionService.create(orgId, data, options),
      createTransfer:   (params)             => transactionService.createTransfer(orgId, params),
      postToLedger:     (id)                 => transactionService.postToLedger(id, orgId),
      reverse:          (id, reason?)        => transactionService.reverseTransaction(id, orgId, reason),
      bulkCreate:       (transactions)       => transactionService.bulkCreate(orgId, transactions),
      update:           (id, updates)        => transactionService.update(id, updates, orgId || undefined),
      delete:           (id)                 => transactionService.delete(id, orgId || undefined),
      bulkCategorize:   (ids, catId, by)     => transactionService.bulkCategorize(orgId, ids, catId, by),
      bulkDelete:       (ids)                => transactionService.bulkDelete(orgId, ids),
      getStats:         (from?, to?)         => transactionService.getStats(orgId, from, to),
    },

    // ── Chart of Accounts + Bank Accounts ───────────────────────────────────
    accounts: {
      getAll:             ()              => accountService.getAll(orgId),
      getById:            (id)            => accountService.getById(id, orgId || undefined),
      create:             (data)          => accountService.create(orgId, data),
      update:             (id, updates)   => accountService.update(id, updates, orgId || undefined),
      delete:             (id)            => accountService.delete(id, orgId || undefined),
      getAccountTree:     ()              => accountService.getAccountTree(orgId),
      getBankAccounts:    ()              => accountService.getBankAccounts(orgId),
      createBankAccount:  (data)          => accountService.createBankAccount(orgId, data),
      updateBankAccount:  (id, updates)   => accountService.updateBankAccount(id, updates, orgId || undefined),
      deleteBankAccount:  (id)            => accountService.deleteBankAccount(id, orgId || undefined),
      getBalanceSheet:    (asOf?)         => accountService.getBalanceSheet(orgId, asOf),
    },

    // ── Categories ──────────────────────────────────────────────────────────
    categories: {
      getAll:         ()                      => categoryService.getAll(orgId),
      getById:        (id)                    => categoryService.getById(id, orgId || undefined),
      create:         (data)                  => categoryService.create(orgId, data),
      update:         (id, updates)           => categoryService.update(id, updates, orgId || undefined),
      delete:         (id)                    => categoryService.delete(id, orgId || undefined),
      addPattern:     (catId, pattern)        => categoryService.addPattern(catId, pattern, orgId || undefined),
      removePattern:  (catId, pattern)        => categoryService.removePattern(catId, pattern, orgId || undefined),
      getUsageStats:  ()                      => categoryService.getUsageStats(orgId),
    },

    // ── Departments ─────────────────────────────────────────────────────────
    departments: {
      getAll:           ()              => departmentService.getAll(orgId),
      getById:          (id)            => departmentService.getById(id, orgId || undefined),
      create:           (data)          => departmentService.create(orgId, data),
      update:           (id, updates)   => departmentService.update(id, updates, orgId || undefined),
      delete:           (id)            => departmentService.delete(id, orgId || undefined),
      getProfitability: (params?: any)  => departmentService.getProfitability(orgId, params),
    },

    // ── Projects ────────────────────────────────────────────────────────────
    projects: {
      getAll:                 ()              => projectService.getAll(orgId),
      getById:                (id)            => projectService.getById(id, orgId || undefined),
      create:                 (data)          => projectService.create(orgId, data),
      update:                 (id, updates)   => projectService.update(id, updates, orgId || undefined),
      delete:                 (id)            => projectService.delete(id, orgId || undefined),
      getProfitability:       (params?: any)  => projectService.getProfitability(orgId, params),
      getProjectDetails:      (projId: string, params?: any) => projectService.getProjectDetails(projId, orgId, params),
      approveTimesheetEntry:  (projId: string, entryId: string) => projectService.approveTimesheetEntry(orgId, projId, entryId),
      reviseTimesheetEntry:   (projId: string, entryId: string, newHours: number, reason?: string) => projectService.reviseTimesheetEntry(orgId, projId, entryId, newHours, reason),
      rejectTimesheetEntry:   (projId: string, entryId: string, reason?: string) => projectService.rejectTimesheetEntry(orgId, projId, entryId, reason),
      getProjectTransactions: (projId)        => projectService.getProjectTransactions(projId, orgId || undefined),
    },

    // ── Fixed Assets + Depreciation ─────────────────────────────────────────
    assets: {
      getAll:                   ()                               => assetService.getAll(orgId),
      getById:                  (id)                             => assetService.getById(id, orgId || undefined),
      create:                   (data)                           => assetService.create(orgId, data),
      update:                   (id, updates)                    => assetService.update(id, updates, orgId || undefined),
      delete:                   (id)                             => assetService.delete(id, orgId || undefined),
      dispose:                  (id, date, amount)               => assetService.dispose(id, date, amount, orgId || undefined),
      listDepreciationSchedules: ()                              => assetService.listDepreciationSchedules(orgId),
      getDepreciationSchedule:  (assetId)                        => assetService.getDepreciationSchedule(assetId, orgId || undefined),
      postDepreciation:         (assetId, period)                => assetService.postDepreciation(assetId, period, orgId || undefined),
      getSummary:               ()                               => assetService.getSummary(orgId),
      getAnalytics:             ()                               => assetService.getAnalytics(orgId),
    },

    // ── Inventory ───────────────────────────────────────────────────────────
    inventory: {
      getAll:               ()              => inventoryService.getAll(orgId),
      getById:              (id)            => inventoryService.getById(id, orgId || undefined),
      create:               (data)          => inventoryService.create(orgId, data),
      update:               (id, updates)   => inventoryService.update(id, updates, orgId || undefined),
      recordTransaction:    (data)          => inventoryService.recordTransaction(orgId, data),
      getTransactions:      (itemId)        => inventoryService.getTransactions(itemId, orgId || undefined),
      getAllTransactions:   ()              => inventoryService.getAllTransactions(orgId),
      getLowStockAlerts:    ()              => inventoryService.getLowStockAlerts(orgId),
      getValuation:         ()              => inventoryService.getValuation(orgId),
      getTurnover:          (months?)       => inventoryService.getTurnover(orgId, months),
      getReorderSuggestions: ()             => inventoryService.getReorderSuggestions(orgId),
    },

    // ── Budgets ─────────────────────────────────────────────────────────────
    budgets: {
      getAll:               ()              => budgetService.getAll(orgId),
      getById:              (id)            => budgetService.getById(id, orgId || undefined),
      create:               (data)          => budgetService.create(orgId, data),
      update:               (id, updates)   => budgetService.update(id, updates, orgId || undefined),
      delete:               (id)            => budgetService.delete(id, orgId || undefined),
      getVarianceAnalysis:  ()              => budgetService.getVarianceAnalysis(orgId),
      getAlerts:            ()              => budgetService.getAlerts(orgId),
      getSummary:           ()              => budgetService.getSummary(orgId),
      createFromTemplate:   (name, amt, cats, opt) => budgetService.createFromTemplate(orgId, name, amt, cats, opt),
      rollForward:          (id)            => budgetService.rollForward(id, orgId),
    },

    loans: {
      getAll:         ()                           => loanService.getAll(orgId),
      getById:        (id)                         => loanService.getById(id, orgId),
      create:         (data)                      => loanService.create(orgId, data),
      update:         (id, updates)               => loanService.update(id, updates, orgId),
      delete:         (id)                        => loanService.delete(id, orgId),
      recordPayment:  (loanId, paymentData)       => loanService.recordPayment(loanId, paymentData, orgId),
      getPayments:    (loanId)                     => loanService.getPayments(loanId, orgId),
      getAllPayments: ()                           => loanService.getAllPayments(orgId),
    },

    // ── Financial Reports ───────────────────────────────────────────────────
    reports: {
      getDashboardSummary:        (options?)                                  => reportService.getDashboardSummary(orgId, options),
      getProfitLoss:              (fromOrRange?: string | DateRange, to?: string) => {
        if (typeof fromOrRange === 'object' && fromOrRange !== null) {
          return reportService.getProfitLoss(orgId, fromOrRange);
        }
        return reportService.getProfitLoss(
          orgId,
          fromOrRange || to ? { from: fromOrRange, to } : undefined
        );
      },
      getBalanceSheet:            (asOfDate?: string)                     => reportService.getBalanceSheet(orgId, asOfDate),
      getCashFlow:                (months?: number, dateRange?: DateRange) => reportService.getCashFlow(orgId, months, dateRange),
      getExpenseBreakdown:        ()                                      => reportService.getExpenseBreakdown(orgId),
      getRevenueBreakdown:        ()                                      => reportService.getRevenueBreakdown(orgId),
      getForecast:                (monthsAhead?: number)                  => reportService.getForecast(orgId, monthsAhead),
      getDepartmentProfitability: (dateRange?: DateRange)                 => reportService.getDepartmentProfitability(orgId, dateRange),
    },

    // ── AI Classification Engine ─────────────────────────────────────────────
    classification: {
      classify:             (narration, amount, type, world, transactionId) => classificationService.classify(orgId, narration, amount, type, world, transactionId),
      batchClassify:        (txns, useAI)                     => classificationService.batchClassify(orgId, txns, useAI),
      learnFromCorrection:  (txnId, catId, deptId)            => classificationService.learnFromCorrection(orgId, txnId, catId, deptId),
      recordHumanOverride:  (payload)                         => classificationService.recordHumanOverride(orgId, payload),
      getRules:             ()                                => classificationService.getRules(orgId || undefined),
      addRule:              (rule)                            => classificationService.addRule(rule, orgId || undefined),
      updateRule:           (ruleId, updates)                 => classificationService.updateRule(ruleId, updates, orgId || undefined),
      deleteRule:           (ruleId)                          => classificationService.deleteRule(ruleId, orgId || undefined),
      revertRuleVersion:    (ruleId, targetVersion, reason)   => classificationService.revertRuleVersion(orgId, ruleId, targetVersion, reason),
      setRuleStatus:        (ruleId, status)                  => classificationService.setRuleStatus(orgId, ruleId, status),
      simulateRuleCollision:(candidateRule)                   => classificationService.simulateRuleCollision(orgId, candidateRule),
      getBulkReviewGroups:  ()                                => classificationService.getBulkReviewGroups(orgId),
      approveBulkReviewGroup:(txIds, catId)                   => classificationService.approveBulkReviewGroup(orgId, txIds, catId),
      getDriftMetrics:      ()                                => classificationService.getDriftMetrics(orgId),
      getTransactionEvidence:(txnId)                          => classificationService.getTransactionEvidence(orgId, txnId),
      getStats:             ()                                => classificationService.getStats(orgId),
    },

    // ── Notifications ───────────────────────────────────────────────────────
    notifications: {
      getAll:         ()               => notificationService.getAll(userId, orgId),
      getUnreadCount: ()               => notificationService.getUnreadCount(userId, orgId),
      markAsRead:     (notifId)        => notificationService.markAsRead(notifId),
      markAllAsRead:  ()               => notificationService.markAllAsRead(userId, orgId),
      /** userId + organizationId are injected automatically */
      create: (notification) =>
        notificationService.create({
          ...notification,
          userId,
          organizationId: orgId,
        }),
      delete: (notifId) => notificationService.delete(notifId),
    },

    // ── Statement Imports ────────────────────────────────────────────────────
    imports: {
      previewFile:       (file) => importService.previewFile(orgId, file),
      executeImport:     (uploadId, bankAccId, mapping, opt) =>
        importService.executeImport(orgId, uploadId, bankAccId, mapping, opt),
      commitParsedImport: (bankAccId, currency, fileName, rows, opt) =>
        importService.commitParsedImport(orgId, bankAccId, currency, fileName, rows, opt),
      getHistory:        () => importService.getHistory(orgId),
      deleteHistory:     (id) => importService.deleteHistory(orgId, id),
    },

    // ── Org Admin (current org management) ──────────────────────────────────
    org: {
      get:              ()                  => organizationService.getById(orgId),
      update:           (updates)           => organizationService.update(orgId, updates),
      delete:           ()                  => organizationService.delete(orgId),
      getMembers:       ()                  => organizationService.getMembers(orgId),
      addMember:        (uid, role)         => organizationService.addMember(orgId, uid, role),
      updateMemberRole: (uid, newRole)      => organizationService.updateMemberRole(orgId, uid, newRole),
      removeMember:     (uid)               => organizationService.removeMember(orgId, uid),
    },

    // ── Recurring / scheduled transactions ───────────────────────────────────
    recurring: {
      getAll:   ()                      => recurringTransactionService.getAll(orgId),
      create:   (data)                  => recurringTransactionService.create(orgId, data),
      update:   (id, updates)           => recurringTransactionService.update(id, updates, orgId || undefined),
      delete:   (id)                    => recurringTransactionService.delete(id, orgId || undefined),
      toggle:   (id)                    => recurringTransactionService.toggle(id, orgId || undefined),
      generate: (asOfDate)              => recurringTransactionService.generate(orgId, asOfDate),
      generateSingle: (recurringId)     => recurringTransactionService.generateSingle(recurringId, orgId || undefined),
      getTotals: ()                     => recurringTransactionService.getTotals(orgId),
    },

    // ── Costing & Pricing Intelligence ──────────────────────────────────────
    costing: {
      getOverheadAllocations:   ()                            => costingService.getOverheadAllocations(orgId),
      createOverheadAllocation: (data)                        => costingService.createOverheadAllocation(orgId, data),
      updateOverheadAllocation: (id, updates)                 => costingService.updateOverheadAllocation(orgId, id, updates),
      deleteOverheadAllocation: (id)                          => costingService.deleteOverheadAllocation(orgId, id),
      setAllocationMethod:      (method)                      => costingService.setAllocationMethod(orgId, method),
      getCommissionStructures:  ()                            => costingService.getCommissionStructures(orgId),
      createCommissionStructure:(data)                        => costingService.createCommissionStructure(orgId, data),
      updateCommissionStructure:(id, updates)                 => costingService.updateCommissionStructure(orgId, id, updates),
      deleteCommissionStructure:(id)                          => costingService.deleteCommissionStructure(orgId, id),
      getExchangeRates:         ()                            => costingService.getExchangeRates(orgId),
      convertCurrency:          (amount, from, to)            => costingService.convertCurrency(orgId, amount, from, to),
    },

    // ── What-If Simulator ────────────────────────────────────────────────────
    simulator: (() => {
      const simSvc = createSimulatorService(orgId);
      return {
        getBaseline:      ()                  => simSvc.getBaseline(),
        getProjection:    (months?)           => simSvc.getProjection(months),
        getAllScenarios:  ()                  => simSvc.getAllScenarios(),
        getScenario:      (scenarioId)        => simSvc.getScenario(scenarioId),
        createScenario:   (scenario)          => simSvc.createScenario(scenario),
        updateScenario:   (scenarioId, updates) => simSvc.updateScenario(scenarioId, updates),
        deleteScenario:   (scenarioId)        => simSvc.deleteScenario(scenarioId),
        calculateImpact:  (baseline, scenario) => simSvc.calculateImpact(baseline, scenario),
      };
    })(),

    // ── Profit Intelligence ──────────────────────────────────────────────────
    profitIntelligence: {
      getSummary:             (params?) => profitIntelligenceService.getSummary(orgId, params),
      getClientProfitability: (params?) => profitIntelligenceService.getClientProfitability(orgId, params),
      getOverheadSummary:     ()        => profitIntelligenceService.getOverheadSummary(orgId),
      getBusinessVsPersonal:  (params?) => profitIntelligenceService.getBusinessVsPersonal(orgId, params),
    },

    // ── Overhead Allocations ─────────────────────────────────────────────────
    overheadAllocations: {
      getAll:   ()                => overheadAllocationService.getAll(orgId),
      getById:  (id)              => overheadAllocationService.getById(id, orgId),
      create:   (data)            => overheadAllocationService.create(orgId, data),
      update:   (id, updates)     => overheadAllocationService.update(id, orgId, updates),
      delete:   (id)              => overheadAllocationService.delete(id, orgId),
    },

  // Re-create only when the active org or user changes
  }), [orgId, userId]);
}

// ─── Convenience re-exports so callers can import types from one place ───────

export type {
  TransactionFilters,
  PaginationParams,
  ServiceResponse,
  PaginatedResult,
  DashboardSummary,
  CashFlowSummary,
  ProfitLossReport,
  BalanceSheetReport,
  DepartmentProfitability,
  ProjectProfitability,
  BulkOperationResult,
  ImportPreview,
  ImportResult,
  ImportHistoryRecord,
  ClassificationRule,
  ClassificationResult,
};