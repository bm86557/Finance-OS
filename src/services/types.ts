/**
 * Service Layer Type Contracts
 * ============================
 * These types define the interface between UI and data.
 * They stay the SAME whether data comes from in-memory store or real API.
 *
 * SINGLE SOURCE OF TRUTH for all domain types.
 * When migrating to Supabase, keep this file — only swap the data layer.
 */

// ═══════════════════════════════════════════════════════════════════════════
// Domain Entity Types (moved from mockDatabase.ts)
// ═══════════════════════════════════════════════════════════════════════════

export type UserRole = 'owner' | 'admin' | 'viewer' | 'employee' | 'accountant' | 'manager';
export type PlatformRole = 'platform_admin' | 'platform_manager' | 'organization_user';

export interface Organization {
  id: string;
  /** URL-safe tenant key (e.g. path `/login/employee/:orgSlug`). Optional until backfilled. */
  slug?: string;
  name: string;
  logo?: string;
  currency: string;
  baseCurrency?: string;
  fiscalYearStart: string; // MM-DD format
  taxId?: string;
  defaultTaxRate?: number;
  accountingBasis?: 'cash' | 'accrual';
  settingsVersion?: number;
  createdAt: string;
  settings: {
    theme: string;
    notifications: boolean;
    enabledCurrencies?: string[];
    timezone?: string;
    dateFormat?: string;
    accountingBasis?: 'cash' | 'accrual';
    defaultTaxRate?: number;
    taxRegistrationNumber?: string;
    teamSettings?: {
      requireApproval?: boolean;
      allowComments?: boolean;
      activityNotify?: boolean;
    };
    notificationPreferences?: {
      email?: boolean;
      transactionAlerts?: boolean;
      budgetAlerts?: boolean;
      reportAlerts?: boolean;
    };
    whiteLabel?: {
      brandName?: string;
      subtitle?: string;
      hideDefaultBranding?: boolean;
    };
    features?: Record<string, boolean>;
    limits?: any;
    [key: string]: any;
  };
}

export interface User {
  id: string;
  email: string;
  name: string;
  phone?: string;
  avatar?: string;
  role: PlatformRole; // Platform-level role
  createdAt: string;
  /**
   * @deprecated Legacy field. Passwords now live exclusively in Supabase Auth and no route reads
   * or writes a local hash — the local bcrypt flow (server/lib/passwords.ts) has been deleted.
   * Kept on the type only so existing mock/bundle payloads still compile during the store
   * migration; safe to remove once those payloads are gone.
   */
  passwordHash?: string;
}

export type MemberAccessRole = 'org_admin' | 'accountant' | 'team_member' | 'viewer';

export interface OrganizationMember {
  userId: string;
  organizationId: string;
  role: UserRole;
  accessRole?: MemberAccessRole;
  portalType?: 'organization_admin' | 'employee' | 'platform_admin' | 'ai_assistant';
  status?: 'active' | 'pending' | 'rejected';
  /** Team/department label. Mirrors the `organization_members.department` column. */
  department?: string;
  position?: string;
  fixedSalary?: number;
  assignedProjects?: string[];
  joinedAt: string;
}

export interface Account {
  id: string;
  organizationId: string;
  code: string;
  name: string;
  type: 'asset' | 'liability' | 'equity' | 'income' | 'expense';
  subtype: string;
  currency: string;
  balance: number;
  isActive: boolean;
  parentAccountId?: string;
  createdAt: string;
}

export interface BankAccount {
  id: string;
  organizationId: string;
  accountId: string; // Links to Chart of Accounts
  bankName: string;
  accountNumber: string;
  accountType: 'checking' | 'savings' | 'credit_card' | 'line_of_credit' | 'cash' | 'online_wallet' | 'debit_card' | 'prepaid_card';
  currency: string;
  balance: number;
  openingBalance?: number;
  lastSyncedAt?: string;
  isActive: boolean;
  iban?: string;
  swiftCode?: string;
  routingNumber?: string;
  /** Personal vs business — reporting and filters (defaults to business if omitted, e.g. older saves) */
  usage?: 'personal' | 'business';
}

export interface Transaction {
  id: string;
  organizationId: string;
  bankAccountId: string;
  date: string;
  description: string;
  narration: string;
  amount: number;
  currency: string;
  type: 'debit' | 'credit';
  categoryId?: string;
  departmentId?: string;
  projectId?: string;
  status: 'pending' | 'classified' | 'reviewed' | 'reconciled';
  confidence?: number; // AI classification confidence 0-100
  tags: string[];
  attachments: string[];
  createdAt: string;
  classifiedAt?: string;
  classifiedBy?: string; // user or 'auto'
  idempotencyKey?: string;
  originalAmount?: number;
  originalCurrency?: string;
  fxRateToBase?: number;
  baseCurrency?: string;
  sourceImportId?: string; // Link to import_history_records
  sourceFileName?: string; // Cached from import_history_records
  sourceFileType?: string; // 'csv' | 'pdf'
  sourceImportedAt?: string; // When the file was imported
  // AI classification tracking
  suggestedCategoryId?: string; // What AI originally suggested
  suggestedConfidence?: number; // AI's original confidence score
  aiReasoning?: string; // Why AI suggested this category
  valueDate?: string;
  isTransfer?: boolean;
  worldScope?: string;
  originalNarration?: string;
  normalizedNarration?: string;
  source?: string;
  counterpartyId?: string;
  clientId?: string;
  costCenterId?: string;
  baseAmount?: number;
  transferGroupId?: string;
  classificationResultId?: string;
  approvalRequestId?: string;
  journalEntryId?: string;
  postedJournalId?: string;
  sourceImportRowId?: string;
  reversalOfTransactionId?: string;
  reversedByTransactionId?: string;
  version?: number;
  correctionReason?: string;
  ownerUserId?: string;
  createdBy?: string;
  approvedBy?: string;
  approvedAt?: string;
  postedAt?: string;
  updatedAt?: string;
}

export interface Category {
  id: string;
  organizationId: string;
  name: string;
  type: 'income' | 'expense';
  accountId: string; // Links to Chart of Accounts
  color: string;
  icon: string;
  patterns: string[]; // Learned patterns for auto-classification
  parentCategoryId?: string;
}

export interface Department {
  id: string;
  organizationId: string;
  name: string;
  code: string;
  budget?: number;
  headId?: string; // User ID of department head
  costCenter: string;
  isActive: boolean;
  squareFootage?: number;
  customWeight?: number;
}

export interface ProjectMemberAssignment {
  userId: string;
  assignedFrom?: string;
  assignedTo?: string;
  allocationPct?: number | null;
}

export interface Project {
  id: string;
  organizationId: string;
  name: string;
  code: string;
  clientName: string;
  departmentId: string;
  status: 'quoted' | 'active' | 'on_hold' | 'completed' | 'cancelled';
  startDate: string;
  endDate?: string;
  completedAt?: string;
  pausedAt?: string;
  pausedBusinessDays?: number;
  plannedTeamSize?: number;
  budgetedHours?: number | null;
  hoursPerDay?: number;
  monthlyCapacityHours?: number;
  memberAssignments?: ProjectMemberAssignment[];
  assignedMemberIds?: string[];
  quotedAmount: number;
  actualCost: number;
  currency: string;
  initialBaselineCost?: number;
  committedRemainingWork?: number;
}

export type TaskCompletionStatus =
  | 'completed_on_time'
  | 'completed_late'
  | 'closed_partial'
  | 'in_progress'
  | 'overdue'
  | 'scheduled';

export interface ProjectTask {
  id: string;
  organizationId: string;
  projectId: string;
  projectName?: string;
  title: string;
  description?: string;
  status: 'todo' | 'in_progress' | 'completed' | 'blocked';
  assignedTo?: string;
  assignedToName?: string;
  startDate?: string;
  estimatedHours?: number;
  loggedHours?: number;
  approvedHours?: number;
  incompleteHours?: number;
  completionNote?: string;
  completionStatus?: TaskCompletionStatus;
  closedAt?: string;
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  dueDate?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface Asset {
  id: string;
  organizationId: string;
  name: string;
  assetCode: string;
  category: 'property' | 'equipment' | 'vehicle' | 'furniture' | 'software' | 'other';
  accountId: string;
  accumulatedDepreciationAccountId: string;
  depreciationExpenseAccountId: string;
  purchaseDate: string;
  purchasePrice: number;
  salvageValue: number;
  usefulLifeYears: number;
  depreciationMethod: 'straight_line' | 'declining_balance' | 'units_of_production';
  currentValue: number;
  accumulatedDepreciation: number;
  status: 'active' | 'disposed' | 'fully_depreciated';
  disposalDate?: string;
  disposalAmount?: number;
  departmentId?: string;
  locationDetails?: string;
  purchasePaymentMethod?: string;
  purchaseBankAccountId?: string;
  purchaseTransactionId?: string;
  placedInServiceDate?: string;
  costBasis?: number;
  taxDepreciationMethod?: string;
  taxUsefulLifeYears?: number;
  accumulatedTaxDepreciation?: number;
  gainLossOnDisposal?: number;
}

export interface DepreciationSchedule {
  id: string;
  assetId: string;
  organizationId: string;
  period: string; // YYYY-MM format
  openingValue: number;
  depreciationAmount: number;
  closingValue: number;
  status: 'scheduled' | 'posted' | 'reversed';
  journalEntryId?: string;
  postedAt?: string;
}

export interface InventoryItem {
  id: string;
  organizationId: string;
  sku: string;
  name: string;
  description?: string;
  category: string;
  unit: string;
  costingMethod: 'fifo' | 'lifo' | 'weighted_average';
  currentStock: number;
  reorderLevel: number;
  reorderQuantity: number;
  averageCost: number;
  lastCost: number;
  sellingPrice: number;
  assetAccountId: string;
  cogsAccountId: string;
  isActive: boolean;
  negativeStockPolicy?: 'disallow' | 'warn' | 'allow_with_backorder';
}

export interface InventoryTransaction {
  id: string;
  organizationId: string;
  inventoryItemId: string;
  date: string;
  type: 'purchase' | 'sale' | 'adjustment' | 'transfer' | 'write_off';
  quantity: number;
  unitCost: number;
  totalAmount: number;
  referenceNumber?: string;
  notes?: string;
  departmentId?: string;
  projectId?: string;
  bankAccountId?: string;
  idempotencyKey?: string;
}

export type OverheadAllocationBase =
  | 'revenue'
  | 'headcount'
  | 'direct_cost'
  | 'equal'
  | 'custom'
  | 'manual_weight'
  | 'department_ratio'
  | 'square_footage'
  | 'time_utilization';

export interface OverheadAllocation {
  id: string;
  organizationId: string;
  name: string;
  allocationBase: OverheadAllocationBase;
  accountIds: string[]; // Overhead expense accounts to allocate
  departments: {
    departmentId: string;
    percentage: number;
    weight?: number;
  }[];
  amount?: number; // Optional monthly pool amount
  policyVersion?: string | number;
  isOperating?: boolean;
}

export interface AllocationRunLine {
  poolId: string;
  poolName: string;
  departmentId: string;
  departmentName: string;
  driverBase: OverheadAllocationBase;
  driverValue: number;
  totalDriverValue: number;
  driverSharePercent: number;
  allocatedAmount: number;
  usedFallbackEqual?: boolean;
}

export interface AllocationRun {
  id: string;
  organizationId: string;
  periodStart: string;
  periodEnd: string;
  policyVersion: string;
  currency: string;
  totalPoolAmount: number;
  allocatedAmount: number;
  unallocatedRemainder: number;
  status: 'frozen' | 'superseded';
  lines?: AllocationRunLine[];
  createdAt: string;
}

export interface QuoteRoleEstimate {
  id: string;
  roleName: string;
  departmentId?: string;
  estimatedHours: number;
  costRate: number;
  billingRate?: number;
}

export interface QuoteDirectPurchase {
  id: string;
  description: string;
  category?: string;
  amount: number;
  currency?: string;
}

export interface QuoteVersion {
  version: string;
  createdAt: string;
  notes: string;
  proposedPrice: number;
  estimatedTotalCost: number;
  profitAmount: number;
  marginPercent: number | null;
  markupPercent: number | null;
}

export interface QuoteCalculationResult {
  estimatedDirectLabor: number;
  directPurchasesTotal: number;
  overheadAmount: number;
  contingencyAmount: number;
  contingencyPercent: number;
  estimatedTotalCost: number;
  proposedPrice: number;
  profitAmount: number;
  marginPercent: number | null;
  markupPercent: number | null;
  requiredPriceForTargetMargin: number | null;
  requiredPriceForTargetMarkup: number;
  isTargetMarginValid: boolean;
  isBelowCost: boolean;
  meetsTargetMargin: boolean;
  decimals?: Record<string, string | null>;
  isRevenueRecognized: false;
}

export interface Quote {
  id: string;
  organizationId: string;
  departmentId?: string | null;
  clientName: string;
  projectName: string;
  serviceType: string;
  billingModel: 'fixed_price' | 'time_and_materials' | 'retainer' | string;
  deliveryHorizonMonths: number;
  currency: string;
  targetMarginPercent: number;
  targetMarkupPercent: number;
  roleEstimates: QuoteRoleEstimate[];
  directPurchases: QuoteDirectPurchase[];
  overheadAmount: number;
  overheadMethod: OverheadAllocationBase | string;
  contingencyPercent: number;
  contingencyAmount: number;
  estimatedDirectLabor: number;
  directPurchasesTotal?: number;
  estimatedTotalCost: number;
  proposedPrice: number;
  profitAmount: number;
  marginPercent: number | null;
  markupPercent: number | null;
  requiredPriceForTargetMargin: number | null;
  requiredPriceForTargetMarkup?: number;
  isTargetMarginValid?: boolean;
  isBelowCost?: boolean;
  currentVersion: string;
  versions: QuoteVersion[];
  status: 'draft' | 'sent' | 'approved' | 'rejected' | 'archived';
  isRevenueRecognized: false;
  createdAt: string;
  updatedAt: string;
}

export interface CommissionStructure {
  id: string;
  organizationId: string;
  companyName: string;
  country?: string;
  currency: string;
  yourProfitPercentage: number;
  middlemanPercentage: number;
  exchangeRateToPKR?: number;
  createdAt?: string;
}

export interface ExchangeRate {
  id?: string;
  organizationId?: string | null;
  base: string;
  quote: string;
  rate: number;
  asOf: string;
  source?: string;
}


export interface RecurringTransaction {
  id: string;
  organizationId: string;
  description: string;
  amount: number;
  currency: string;
  type: 'debit' | 'credit';
  categoryId: string;
  bankAccountId: string;
  frequency: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';
  startDate: string;
  endDate?: string;
  nextOccurrence: string;
  isActive: boolean;
  departmentId?: string;
  projectId?: string;
  /** When both are set, list UI can show real run progress (e.g. posted vs cap). */
  generatedOccurrenceCount?: number;
  totalOccurrencesExpected?: number;
  /** Whether this recurring transaction has been paid for the current period (month/week/etc) */
  isPaidForCurrentPeriod?: boolean;
  /** Handoff v1.2 governance fields (§5, §7, §9) */
  timezone?: string;
  worldScope?: 'business' | 'personal';
  autoGenerate?: boolean;
  requiresApproval?: boolean;
  approvalThreshold?: number;
}

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

export interface RecurringOccurrenceItem {
  id: string;
  organizationId: string;
  templateId: string;
  templateDescription: string;
  templateType: 'credit' | 'debit';
  frequency: string;
  scheduledPeriodKey: string;
  scheduledDate: string;
  amount: number;
  currency: string;
  status: 'preview' | 'pending_approval' | 'approved' | 'posted' | 'matched_import' | 'skipped' | 'rejected';
  transactionId: string | null;
  journalEntryId: string | null;
  source: 'scheduler' | 'manual' | 'import_match';
  notes: string | null;
  createdAt: string;
}

export interface Budget {
  id: string;
  organizationId: string;
  name: string;
  period: 'monthly' | 'quarterly' | 'yearly';
  startDate: string;
  endDate: string;
  categoryId?: string;
  departmentId?: string;
  projectId?: string;
  clientId?: string;
  budgetedAmount: number;
  spentAmount: number;
  currency: string;
  status: 'active' | 'exceeded' | 'completed' | 'on-track' | 'warning';
  lifecycleStatus?: 'draft' | 'approved' | 'locked' | 'active' | 'archived' | 'rolled_over' | 'versioned';
  version?: number;
  isCurrent?: boolean;
  parentBudgetId?: string;
  approvedBy?: string;
  approvedAt?: string;
  rolledFromId?: string;
  alertThreshold?: number;
  scope?: 'business' | 'personal';
}

/** Org-scoped loan / liability record (receivable or payable). */
export type LoanDirection = 'to_receive' | 'to_pay';
export type LoanRecordStatus =
  | 'active'
  | 'pending'
  | 'overdue'
  | 'partially_paid'
  | 'paid'
  | 'defaulted';

export interface Loan {
  id: string;
  organizationId: string;
  type: LoanDirection;
  party: string;
  amount: number;
  currency: string;
  principal: number;
  interestRate?: number;
  totalInterest?: number;
  amountPaid?: number;
  remainingBalance?: number;
  dueDate: string;
  startDate?: string;
  status: LoanRecordStatus;
  description: string;
  installmentAmount?: number;
  frequency?: 'monthly' | 'quarterly' | 'annual';
  nextPaymentDate?: string;
  paymentsCount?: number;
  paymentsCompleted?: number;
  termMonths?: number;
  rateType?: 'fixed' | 'variable' | 'floating' | string;
  lastPaymentDate?: string;
  lastPaymentMonth?: string;
  accruedInterest?: number;
  overdueAmount?: number;
}

export interface LoanPayment {
  id: string;
  organizationId: string;
  loanId: string;
  amount: number;
  paymentMonth: string;
  paidOn: string;
  principalPart?: number;
  interestPart?: number;
  feePart?: number;
  journalEntryId?: string;
  bankAccountId?: string;
  method?: string;
  reference?: string;
  notes?: string;
  createdAt?: string;
}

export interface CashFlowForecast {
  id: string;
  organizationId: string;
  date: string;
  forecastedIncome: number;
  forecastedExpenses: number;
  netCashFlow: number;
  openingBalance: number;
  closingBalance: number;
  currency: string;
  confidence: number; // 0-100
}

export interface ActiveSession {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  organizationId: string;
  deviceType: string;
  browser: string;
  ipAddress: string;
  location: string;
  loginTime: string;
  lastActivity: string;
  isCurrentSession: boolean;
}

export interface Notification {
  id: string;
  userId: string;
  organizationId: string;
  type: 'info' | 'warning' | 'success' | 'error';
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
  actionUrl?: string;
  actionLabel?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Employee portal entities (shared store — see dataStore.ts)
// ═══════════════════════════════════════════════════════════════════════════

export interface EmployeeExpense {
  id: string;
  organizationId: string;
  userId: string;
  date: string;
  description: string;
  amount: number;
  currency: string;
  category: string;
  status: 'draft' | 'submitted' | 'approved' | 'rejected' | 'reimbursed';
  receiptUrl?: string;
  notes?: string;
  rejectionReason?: string;
  projectId?: string;
  submittedAt?: string;
  reviewedBy?: string;
  reviewedAt?: string;
  reimbursedAt?: string;
  settlementTransactionId?: string;
}

export type EmployeeSessionTimeout = '15 minutes' | '30 minutes' | '1 hour' | '4 hours' | '8 hours';

export interface EmployeeNotificationPreferences {
  emailNotifications: boolean;
  expenseApprovals: boolean;
  timesheetReminders: boolean;
  projectUpdates: boolean;
  companyAnnouncements: boolean;
}

export interface EmployeeSecuritySettings {
  twoFactorEnabled: boolean;
  sessionTimeout: EmployeeSessionTimeout;
}

export interface EmployeeUserSettings {
  userId: string;
  organizationId: string;
  profile: {
    fullName: string;
    email: string;
    phone?: string;
    department?: string;
    position?: string;
    role?: string;
    avatarUrl?: string;
  };
  notifications: EmployeeNotificationPreferences;
  security: EmployeeSecuritySettings;
  updatedAt?: string;
}

export interface EmployeeSalaryHistory {
  id: string;
  organizationId: string;
  userId: string;
  fixedSalary: number;
  effectiveDate: string;
  reason?: string;
  createdBy?: string;
  createdAt: string;
}

export interface EmployeeCompensationOverview {
  userId: string;
  name: string;
  email?: string;
  role: string;
  position?: string;
  departmentId?: string;
  departmentName?: string;
  fixedSalary: number;
  loggedHoursMonth: number;
  totalLoggedHours: number;
}

export interface EmployeePayrollBatch {
  id: string;
  organizationId: string;
  period: string;
  status: 'draft' | 'approved' | 'disbursed';
  totalGross: number;
  totalNet: number;
  employeeCount: number;
  createdAt: string;
}

export interface EmployeeSalaryAdjustmentInput {
  userId: string;
  fixedSalary: number;
  effectiveDate: string;
  reason?: string;
}

export interface EmployeePayslip {
  id: string;
  organizationId: string;
  userId: string;
  period: string;
  issueDate: string;
  gross: number;
  deductions: { name: string; amount: number }[];
  net: number;
  currency: string;
  status: 'draft' | 'pending' | 'processing' | 'issued' | 'paid' | 'voided';
  salaryAmount?: number;
  reimbursementAmount?: number;
  expectedSalary?: number;
  expectedReimbursements?: number;
  expectedTotal?: number;
  varianceAmount?: number;
  varianceStatus?: 'exact' | 'overpaid' | 'underpaid' | 'unpaid';
  reimbursementDetails?: Array<{
    expenseId?: string;
    description: string;
    amount: number;
    transactionId?: string;
  }>;
  linkedExpenseIds?: string[];
}

export interface TimesheetEntry {
  id: string;
  organizationId: string;
  userId: string;
  date: string;
  projectId: string;
  projectName: string;
  hours: number;
  description: string;
  billable: boolean;
  status: 'draft' | 'submitted' | 'approved';
  taskId?: string;
  startTime?: string;
  endTime?: string;
  durationMinutes?: number;
  durationSeconds?: number;
  clientEventId?: string;
  source?: 'live_timer' | 'manual' | 'offline_recovered' | 'batch_auto_fill';
  effectiveCostPerMinute?: number;
  effectiveCostPerHour?: number;
  calculatedLaborCost?: number;
  approvedAt?: string;
  approvedBy?: string;
  rejectionReason?: string;
  revisionHistory?: Array<{
    previousHours: number;
    newHours: number;
    revisedAt: string;
    revisedBy?: string;
    reason?: string;
  }>;
}

export interface ActiveTimerSession {
  id: string;
  organizationId: string;
  userId: string;
  projectId: string;
  projectName?: string;
  taskId?: string;
  description: string;
  billable: boolean;
  startedAt: string;
  pausedAt?: string;
  accumulatedSeconds: number;
  status: 'running' | 'paused' | 'stopped';
  clientEventId: string;
  lastHeartbeatAt: string;
}

export interface EmployeeTeamMember {
  id: string;
  organizationId: string;
  name: string;
  email: string;
  role: string;
  department: string;
  avatar?: string;
  joinedAt: string;
  status: 'active' | 'away' | 'offline' | 'pending' | 'rejected';
  isPending?: boolean;
}

export interface CompanyAnnouncement {
  id: string;
  organizationId: string;
  title: string;
  content: string;
  author: string;
  category: 'general' | 'hr' | 'finance' | 'project' | 'celebration';
  createdAt: string;
  isPinned: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// Service Layer Contracts
// ═══════════════════════════════════════════════════════════════════════════

// Standard API response wrapper
export interface ServiceResponse<T> {
  success: boolean;
  data: T;
  message?: string;
  error?: string;
}

// Paginated response
export interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  hasMore: boolean;
}

// Common filter/query params
export interface PaginationParams {
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface DateRangeFilter {
  dateFrom?: string;
  dateTo?: string;
}

// Transaction-specific filters
export interface TransactionFilters extends PaginationParams, DateRangeFilter {
  search?: string;
  categoryId?: string;
  departmentId?: string;
  projectId?: string;
  bankAccountId?: string;
  status?: string;
  type?: 'debit' | 'credit';
  minAmount?: number;
  maxAmount?: number;
  tags?: string[];
  counterpartyId?: string;
  clientId?: string;
  costCenterId?: string;
  source?: string;
  sourceImportId?: string;
  worldScope?: string;
  currency?: string;
  createdBy?: string;
  valueDateFrom?: string;
  valueDateTo?: string;
  minConfidence?: number;
  maxConfidence?: number;
}

// Dashboard summary types
export type UpcomingSourceType = 'recurring' | 'loan' | 'payroll' | 'invoice' | 'reimbursement';

export interface UpcomingItem {
  id: string;
  date: string;
  isoDate?: string;
  title: string;
  amount: number;
  rawAmount?: number;
  currency: string;
  originalCurrency?: string;
  type?: 'credit' | 'debit';
  sourceType?: UpcomingSourceType;
  sourceId?: string;
  isOverdue?: boolean;
  daysOverdue?: number;
  subtitle?: string;
}

export interface DashboardSummary {
  currency?: string;
  worldScope?: 'business' | 'personal' | 'all';
  totalRevenue: number;
  totalExpenses: number;
  netProfit: number;
  monthlyRevenue?: number;
  monthlyExpenses?: number;
  monthlyProfit?: number;
  monthlyProfitChange?: number | null;
  weeklyRevenue?: number;
  weeklyExpenses?: number;
  weeklyProfit?: number;
  weeklyProfitChange?: number | null;
  yearlyRevenue?: number;
  yearlyExpenses?: number;
  yearlyProfit?: number;
  yearlyProfitChange?: number | null;
  profitMargin: number | null;
  cashOnHand: number;
  cashOnHandChange?: number | null;
  cashInBank?: number;
  totalBankBalanceBase?: number;
  totalBalanceChange?: number | null;
  accountsReceivable: number;
  accountsPayable: number;
  totalAssets?: number;
  totalLiabilities?: number;
  netWorth?: number;
  netWorthChange?: number | null;
  liquidNetWorth?: number;
  totalInventory?: number;
  totalFixedAssets?: number;
  monthlyPayroll?: number;
  payrollConfidentialMasked?: boolean;
  monthlyBurnRate?: number;
  cashRunwayMonths?: number | null;
  loansReceivable?: number;
  loansPayable?: number;
  pendingTransactions: number;
  pendingReviewAmount?: number;
  revenueChange: number | null; // percentage
  expenseChange: number | null;
  profitChange: number | null;
  monthlyGoals?: {
    expenseBudget?: number | null;
    expenseActual?: number;
    expensePct?: number | null;
    revenueTarget?: number | null;
    revenueActual?: number;
    revenuePct?: number | null;
    savingsTarget?: number | null;
    savingsActual?: number;
    savingsPct?: number | null;
    targetSource?: string;
  };
  upcomingPayments?: UpcomingItem[];
  upcomingExpenses?: UpcomingItem[];
  overduePayments?: UpcomingItem[];
  overdueExpenses?: UpcomingItem[];
  totalUpcomingPayments?: number;
  totalUpcomingExpenses?: number;
  totalOverduePayments?: number;
  totalOverdueExpenses?: number;
  meta?: {
    basis?: string;
    baseCurrency?: string;
    worldScope?: string;
    asOf?: string;
    source?: string;
    unapprovedCount?: number;
    upcomingWindow?: {
      start: string;
      end: string;
      basis: string;
    };
  };
  chartData?: {
    profitData?: Array<Record<string, any>>;
    weeklyProfitData?: Array<Record<string, any>>;
    departmentData?: Array<Record<string, any>>;
    expenseCategoryData?: Array<{ name: string; value: number; color: string }>;
    monthlyComparisonData?: Array<Record<string, any>>;
  };
}

export interface CashFlowSummary {
  month: string;
  inflow: number;
  outflow: number;
  net: number;
}

export type CashFlowReport = CashFlowSummary;

// Report types
export interface ProfitLossReport {
  period: string;
  revenue: { accountId: string; name: string; amount: number }[];
  cogs: { accountId: string; name: string; amount: number }[];
  operatingExpenses: { accountId: string; name: string; amount: number }[];
  totalRevenue: number;
  totalCOGS: number;
  grossProfit: number;
  totalOperatingExpenses: number;
  operatingIncome: number;
  netIncome: number;
}

export interface BalanceSheetReport {
  asOfDate: string;
  assets: { accountId: string; name: string; balance: number; type: string }[];
  liabilities: { accountId: string; name: string; balance: number; type: string }[];
  equity: { accountId: string; name: string; balance: number; type: string }[];
  totalAssets: number;
  totalLiabilities: number;
  totalEquity: number;
  currentAssets?: number;
  fixedAssets?: number;
  currentLiabilities?: number;
  longTermLiabilities?: number;
  netWorth?: number;
  liquidNetWorth?: number;
  cashInBank?: number;
  cashOnHand?: number;
  totalBankBalanceBase?: number;
}

export interface DepartmentProfitability {
  departmentId: string;
  departmentName: string;
  revenue: number;
  allocatedStaffLabor?: number;
  directDepartmentExpenses?: number;
  directCosts: number;
  allocatedOverhead: number;
  fullDepartmentCost?: number;
  netProfit: number;
  profitMargin: number | null;
  headcount: number;
  revenuePerHead: number | null;
  squareFootage?: number;
  /** Total hours available (headcount × 160h FTE) — null when headcount is 0 (§12.1 L620) */
  totalHours: number | null;
  totalMinutes?: number | null;
  /** Hours spent on billable/client work */
  billableHours: number;
  /** billableHours / totalHours × 100 — null when no timesheet data or 0 capacity */
  utilization: number | null;
  /** Direct cost per hour (directCosts / totalHours) — null when 0 capacity */
  directCostPerHour?: number | null;
  directCostPerMinute?: number | null;
  /** Fully loaded cost per hour ((directCosts + allocatedOverhead) / totalHours) — null when 0 capacity */
  costPerHour: number | null;
  costPerMinute?: number | null;
  productiveHours?: number | null;
  productiveCostPerHour?: number | null;
  productiveCostPerMinute?: number | null;
  capacityBasis?: string;
  overheadSource?: string;
  includedPools?: Array<{ poolId: string; poolName: string; allocatedAmount: number }>;
  costMatrixMeta?: {
    period?: string;
    periodMonths?: number;
    currency?: string;
    policyVersion?: string;
    calculationTimestamp?: string;
    dataFreshness?: string;
    selectedCapacityHours?: number | null;
    selectedCapacityBasis?: string;
    includedPoolsCount?: number;
    excludedNonOperatingPoolsCount?: number;
    totalPoolsAmount?: number;
    unallocatedOverhead?: number;
    laborCostSource?: 'posted_payroll' | 'accrued_salary_160h' | 'none';
  };
  decimals?: {
    revenue: string;
    directCosts: string;
    allocatedOverhead: string;
    fullDepartmentCost: string;
    netProfit: string;
    costPerHour: string | null;
    costPerMinute: string | null;
    directCostPerHour: string | null;
    directCostPerMinute: string | null;
  };
  /** Monthly approved department budget */
  budget?: number;
  /** Direct costs spent against budget for period */
  budgetSpent?: number;
  /** Remaining available budget this period */
  budgetRemaining?: number;
  /** Percentage of budget utilized */
  budgetUtilization?: number;
  /** Budgeted standard capacity hourly rate */
  standardRate?: number | null;
}

export interface ProjectProfitability {
  projectId: string;
  projectName: string;
  clientName: string;
  quotedAmount: number;
  actualCost: number;
  revenue?: number; // sum of credits
  profit: number;
  operatingProfit?: number;
  projectContribution?: number;
  /** Strictly null (undefined) when recognized revenue <= 0 (§12.4 L666, §33 #9) */
  profitMargin: number | null;
  status: string;
  budgetVariance: number; // percentage over/under
  directCost?: number;
  laborCost?: number;
  assignedOverhead?: number;
  initialBaselineCost?: number;
  consumedBurn?: number;
  burnRatePerDay?: number;
  committedRemainingWork?: number;
  costToComplete?: number;
  projectedAtCompletion?: number;
  marginAtRisk?: number;
  loggedHours?: number;
  approvedHours?: number;
  billableHours?: number;
  nonBillableHours?: number;
  contributorCount?: number;
  contributors?: Array<{
    userId: string;
    name: string;
    email?: string;
    avatarUrl?: string | null;
    hours: number;
    approvedHours?: number;
    laborCost: number;
    allocationSharePct?: number;
    hourlyRate?: number;
    overrunHours?: number;
  }>;
  // Schedule-driven automatic Mon–Fri hours & loss detection fields
  startDate?: string;
  endDate?: string;
  completedAt?: string;
  pausedAt?: string;
  pausedBusinessDays?: number;
  plannedTeamSize?: number;
  budgetedHours?: number | null;
  capacityBasis?: 'scheduled_mon_fri_40h_160h';
  hoursPerDay?: number;
  monthlyCapacityHours?: number;
  plannedBusinessDays?: number;
  elapsedBusinessDays?: number;
  remainingBusinessDays?: number;
  overdueBusinessDays?: number;
  projectSchedulePlannedHours?: number;
  projectScheduleElapsedHours?: number;
  projectScheduleRemainingHours?: number;
  projectScheduleOverrunHours?: number;
  plannedHours?: number;
  elapsedHours?: number;
  remainingHours?: number;
  overrunHours?: number;
  weeklyScheduledHours?: number;
  exactCompletionHours?: number | null;
  scheduleProgressPct?: number;
  isOverdue?: boolean;
  isOpenEnded?: boolean;
  overrunLaborCost?: number;
  hourlyBurnRate?: number;
  plannedDailyBudget?: number;
  quoteProfit?: number;
  quoteMarginPct?: number | null;
  operatingMarginPct?: number | null;
  maxProfitableHours?: number | null;
  breakEvenDate?: string | null;
  daysUntilLoss?: number | null;
  healthStatus?:
    | 'in_loss'
    | 'overtime'
    | 'at_risk'
    | 'on_track'
    | 'quoted'
    | 'on_hold'
    | 'completed_profit'
    | 'completed_loss'
    | 'cancelled';
  lossAmount?: number;
  alertMessage?: string | null;
  isUsingDeptFallback?: boolean;
  missingSalaryMembers?: string[];
  teamAllocations?: Array<{
    userId: string;
    name: string;
    email: string;
    avatarUrl?: string | null;
    departmentId?: string;
    departmentName?: string;
    role?: string;
    assignedFrom: string;
    assignedTo?: string;
    allocationSharePct: number;
    isCustomAllocation: boolean;
    isOverAllocated: boolean;
    salaryMissing: boolean;
    hourlyRate: number;
    ratePerMinute: number;
    plannedHours: number;
    elapsedHours: number;
    overrunHours: number;
    laborCost: number;
    overrunLaborCost: number;
  }>;
  overheadBreakdown?: Array<{
    departmentId: string;
    departmentName: string;
    headcount: number;
    departmentOverheadPool: number;
    departmentCapacityHours: number;
    overheadRatePerHour: number;
    scheduledHours: number;
    allocatedOverhead: number;
    absorptionPercent: number;
  }>;
}

export interface DateRange {
  from?: string;
  to?: string;
}

export interface ProfitVelocity {
  dailyVelocity: number;
  windowDays: number;
  totalOperatingProfit: number;
  unit: string;
}

export interface ProfitabilitySnapshot {
  id: string;
  organizationId: string;
  periodStart: string;
  periodEnd: string;
  totalRevenue: number;
  totalExpense: number;
  totalOverhead: number;
  operatingProfit: number;
  netProfit: number;
  policyVersion?: string;
  createdAt: string;
  snapshotData?: Record<string, any>;
}

export interface WorkerLoadedLaborCost {
  userId: string;
  userName: string;
  userEmail: string;
  departmentId?: string | null;
  departmentName?: string | null;
  position?: string | null;
  baseSalary: number;
  employerTaxes: number;
  employerBenefits: number;
  approvedBonus: number;
  workforceOverhead: number;
  loadedLaborCost: number;
  availableCapacityHours: number;
  approvedProductiveHours: number | null;
  capacityHourlyCost: number | null;
  capacityMinuteCost: number | null;
  productiveHourlyCost: number | null;
  productiveMinuteCost: number | null;
  capacityBasis: 'fte_160h';
  currency?: string;
  policyVersion?: string;
  effectiveDate?: string;
}

export interface SquareFootProfitability {
  departmentId: string;
  departmentName: string;
  squareFootage: number;
  revenue: number;
  cost: number;
  profit: number;
  revPerSqft: number;
  costPerSqft: number;
  profitPerSqft: number;
  spaceSharePct: number;
}

export interface ProjectDetails {
  project: Project;
  income: Transaction[];
  expenses: Transaction[];
  summary: {
    totalRevenue: number;
    totalCosts: number;
    netProfit: number;
    varianceAmount: number;  // actualCost - quotedAmount
    variancePct: number;     // ((actualCost - quotedAmount) / quotedAmount) * 100
  };
}

// Bulk operation result
export interface BulkOperationResult {
  succeeded: number;
  failed: number;
  errors: { id: string; error: string }[];
}

// Import types
export interface ImportPreview {
  uploadId: string;
  fileName: string;
  totalRows: number;
  columns: { name: string; type: string; sampleValues: string[] }[];
  suggestedMapping: Record<string, string>;
  duplicatesDetected: number;
}

export interface ImportResult {
  imported: number;
  skipped: number;
  duplicates: number;
  errors: { row: number; error: string }[];
  summary: {
    totalIncome: number;
    totalExpenses: number;
    netAmount: number;
    autoClassified: number;
    needsReview: number;
  };
}

/** Single import history entry — enriched with classification stats */
export interface ImportHistoryRecord {
  id: string;
  organizationId?: string;
  fileName: string;
  importedAt: string;
  transactionCount: number;
  status: string;
  /** Display name of the bank account that was imported into */
  accountName: string;
  /** Number of transactions auto-classified with sufficient confidence */
  autoPlaced: number;
  /** Number of transactions flagged for manual review */
  needsReview: number;
  /** Number of duplicate transactions detected */
  duplicatesFound: number;
  fileType?: 'csv' | 'pdf';
  fileSize?: number;
  fileContent?: string;
  bankAccountId?: string;
  /** Time-limited signed URL for the original statement in Supabase Storage */
  fileUrl?: string;
  /** Storage object path: `{orgId}/{timestamp}_{fileName}` */
  filePath?: string;
}

/** Optional per-org AI provider settings (see aiSettingsService — browser storage for demo) */
export interface OrgAiIntegrationSettings {
  /** User opts in to supplying their own API key */
  useCustomKey: boolean;
  /** Display name, e.g. OpenAI, Anthropic */
  providerName: string;
  /** Model id, e.g. gpt-4o-mini */
  modelName: string;
  /** Secret — never log; in production store server-side only */
  apiKey: string;
}