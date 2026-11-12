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
  accessRole?: MemberAccessRole | string;
  portalType?: 'organization_admin' | 'employee' | 'platform_admin' | 'ai_assistant';
  status?: 'active' | 'pending' | 'rejected';
  /** Team/department label. Mirrors the `organization_members.department` column. */
  department?: string;
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
  quotedAmount: number;
  actualCost: number;
  currency: string;
  initialBaselineCost?: number;
  committedRemainingWork?: number;
}

export interface ProjectTask {
  id: string;
  organizationId: string;
  projectId: string;
  title: string;
  description?: string;
  status: 'todo' | 'in_progress' | 'completed' | 'blocked';
  assignedTo?: string;
  assignedToName?: string;
  startDate?: string;
  estimatedHours?: number;
  loggedHours?: number;
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
}

export interface OverheadAllocation {
  id: string;
  organizationId: string;
  name: string;
  allocationBase: 'revenue' | 'headcount' | 'direct_cost' | 'equal' | 'custom';
  accountIds: string[]; // Overhead expense accounts to allocate
  departments: {
    departmentId: string;
    percentage: number;
  }[];
  amount?: number; // Optional monthly pool amount
  policyVersion?: number;
  isOperating?: boolean;
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
  lifecycleStatus?: 'draft' | 'active' | 'archived' | 'rolled_over' | 'versioned';
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
  rateType?: 'fixed' | 'floating' | string;
  lastPaymentDate?: string;
  lastPaymentMonth?: string;
  accruedInterest?: number;
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
  status: 'draft' | 'issued' | 'paid';
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
export interface DashboardSummary {
  totalRevenue: number;
  totalExpenses: number;
  netProfit: number;
  profitMargin: number;
  cashOnHand: number;
  accountsReceivable: number;
  accountsPayable: number;
  pendingTransactions: number;
  revenueChange: number; // percentage
  expenseChange: number;
  profitChange: number;
}

export interface CashFlowSummary {
  month: string;
  inflow: number;
  outflow: number;
  net: number;
}

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
}

export interface DepartmentProfitability {
  departmentId: string;
  departmentName: string;
  revenue: number;
  directCosts: number;
  allocatedOverhead: number;
  netProfit: number;
  profitMargin: number;
  headcount: number;
  revenuePerHead: number;
  /** Total hours available (headcount × standard work month) */
  totalHours: number;
  /** Hours spent on billable/client work */
  billableHours: number;
  /** billableHours / totalHours × 100 — null when no timesheet data */
  utilization: number | null;
  /** (directCosts + allocatedOverhead) / billableHours (or totalHours if no timesheets) */
  costPerHour: number;
  /** Monthly approved department budget */
  budget?: number;
  /** Direct costs + allocated overhead spent against budget */
  budgetSpent?: number;
  /** Remaining available budget this period */
  budgetRemaining?: number;
  /** Percentage of budget utilized */
  budgetUtilization?: number;
  /** Budgeted standard capacity hourly rate */
  standardRate?: number;
}

export interface ProjectProfitability {
  projectId: string;
  projectName: string;
  clientName: string;
  quotedAmount: number;
  actualCost: number;
  revenue?: number; // sum of credits
  profit: number;
  profitMargin: number;
  status: string;
  budgetVariance: number; // percentage over/under
  directCost?: number;
  laborCost?: number;
  loggedHours?: number;
  contributorCount?: number;
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