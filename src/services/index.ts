/**
 * Service Layer - Barrel Export
 * ==============================
 *
 * ARCHITECTURE OVERVIEW:
 * =====================
 *
 * ┌────────────────────────────────────────────────────────┐
 * │                    React Components                     │
 * │          (UI stays 100% the same after migration)       │
 * └─────────────────────────┬──────────────────────────────┘
 *                           │ calls
 * ┌─────────────────────────▼──────────────────────────────┐
 * │                   Service Layer                         │
 * │            (function signatures stay the same)          │
 * │                                                         │
 * │  authService, transactionService, organizationService,  │
 * │  categoryService, projectService, departmentService,    │
 * │  accountService, assetService, inventoryService,        │
 * │  budgetService, reportService, classificationService,   │
 * │  notificationService, importService                     │
 * └─────────────────────────┬──────────────────────────────┘
 *                           │ reads/writes
 * ┌─────────────────────────▼──────────────────────────────┐
 * │              Data Layer (SWAP THIS)                     │
 * │                                                         │
 * │  CURRENT: In-memory DataStore (dataStore.ts)            │
 * │  FUTURE:  REST API calls (fetch/axios)                  │
 * │           OR Supabase client                            │
 * │           OR GraphQL queries                            │
 * └────────────────────────────────────────────────────────┘
 *
 * MIGRATION STEPS:
 * ================
 * 1. Set up your real backend (Supabase, Express, etc.)
 * 2. Create API endpoints matching the TODO comments in each service
 * 3. In each service method, replace:
 *      dataStore.transactions.filter(...)  →  await fetch('/api/transactions?...')
 * 4. Remove dataStore.ts and simulateDelay()
 * 5. Update authService to use real JWT tokens
 * 6. Business logic (calculations, classification) stays untouched
 *
 * ESTIMATED EFFORT: ~20% of total codebase
 * - All UI components: NO CHANGES
 * - All business logic: NO CHANGES
 * - Service interfaces (types.ts): NO CHANGES
 * - Service implementations: SWAP data access only
 */

// Core services
export { authService } from './authService';
export type { AuthSession, LoginCredentials } from './authService';

export { transactionService } from './transactionService';
export { organizationService } from './organizationService';
export { categoryService } from './categoryService';
export { projectService } from './projectService';
export { departmentService } from './departmentService';
export { accountService } from './accountService';
export { assetService } from './assetService';
export { inventoryService } from './inventoryService';
export { budgetService } from './budgetService';
export { getReportService, reportService } from './reportService';
export type { ReportService } from './reportService';
export { classificationService } from './classificationService';
export { patternEngineService } from './patternEngineService';
export { notificationService } from './notificationService';
export { importService } from './importService';
export { platformService } from './platformService';
export type { PlatformStats, PlatformPlan, PlatformOrgMeta, BillingStats } from './platformService';
export { platformOrganizationService } from './platformOrganizationService';
export type {
  PlatformOrganization,
  PlatformOrgStatus,
  PlatformOrgLimits,
  CreatePlatformOrganizationInput,
  UpdatePlatformOrganizationInput,
  OrganizationChangeEvent,
  RealtimeStatus,
} from './platformOrganizationService';
export { recurringTransactionService } from './recurringTransactionService';
export { auditService } from './auditService';
export type { AuditLogEntry } from './auditService';
export { employeeService } from './employeeService';
export type { Expense, Payslip, TimesheetEntry, TeamMember, Announcement } from './employeeService';
export { aiAssistantService } from './aiAssistantService';
export type {
  AIFinancialSituation,
  AIProjection,
  AIProjections,
  AIInsight,
  FinancialPattern,
  AIAnalysisData,
  AIChatResponse,
  AIAssistantStatus,
} from './aiAssistantService';

// HTTP client (API-000) — use when `isHttpBackendConfigured()`; else services use `dataStore`
export {
  getApiBaseUrl,
  isHttpBackendConfigured,
  apiRequest,
  apiGet,
  apiPostJson,
} from '@/lib/apiClient';

// Types
export type {
  ServiceResponse,
  PaginatedResult,
  PaginationParams,
  DateRangeFilter,
  TransactionFilters,
  DashboardSummary,
  CashFlowSummary,
  ProfitLossReport,
  BalanceSheetReport,
  DepartmentProfitability,
  ProjectProfitability,
  BulkOperationResult,
  ImportPreview,
  ImportResult,
} from './types';

// Data store (for direct access if needed, e.g., in development)
export { dataStore } from './dataStore';