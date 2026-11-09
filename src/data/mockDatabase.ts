/**
 * Initial store seed (local-first “real” data)
 * ============================================
 * Only identity + org structure is prefilled so demo logins and routing work.
 * Expenses/timesheets start empty (usage + localStorage); one payslip per FLOW demo employee seeds the employee dashboard pay KPI on clean install.
 *
 * Types live in @/services/types.ts — this file is DATA ONLY.
 */

import type {
  UserRole, PlatformRole, Organization, User, OrganizationMember,
  Account, BankAccount, Transaction, Category, Department, Project,
  Asset, DepreciationSchedule, InventoryItem, InventoryTransaction,
  OverheadAllocation, RecurringTransaction, Budget, Loan, CashFlowForecast,
  ActiveSession, Notification,
  EmployeeExpense, EmployeePayslip, TimesheetEntry, EmployeeTeamMember, CompanyAnnouncement,
} from '@/services/types';

export type {
  UserRole, PlatformRole, Organization, User, OrganizationMember,
  Account, BankAccount, Transaction, Category, Department, Project,
  Asset, DepreciationSchedule, InventoryItem, InventoryTransaction,
  OverheadAllocation, RecurringTransaction, Budget, Loan, CashFlowForecast,
  ActiveSession, Notification,
};

/** Demo password for all seeded accounts (see AGENTS.md / login screens). */
export const DEMO_AUTH_PASSWORD = 'demo';

export const mockCurrentUser: User = {
  id: 'user-001',
  email: 'john.doe@agency.com',
  name: 'John Doe',
  avatar: 'https://i.pravatar.cc/150?u=johndoe',
  role: 'organization_user',
  createdAt: '2024-01-15T10:00:00Z',
};

export const mockCurrentOrganization: Organization = {
  id: 'org-001',
  slug: 'creative-agency',
  name: 'Creative Agency Co.',
  logo: '🚀',
  currency: 'USD',
  fiscalYearStart: '01-01',
  createdAt: '2024-01-15T10:00:00Z',
  settings: {
    theme: 'dark',
    notifications: true,
  },
};

export const mockCurrentUserRole: UserRole = 'owner';

export const mockOrganizations: Organization[] = [
  mockCurrentOrganization,
  {
    id: 'org-002',
    slug: 'digital-solutions',
    name: 'Digital Solutions Ltd',
    logo: '💼',
    currency: 'EUR',
    fiscalYearStart: '04-01',
    createdAt: '2024-02-10T10:00:00Z',
    settings: { theme: 'dark', notifications: true },
  },
  {
    id: 'org-003',
    slug: 'tech-innovations',
    name: 'Tech Innovations Inc',
    logo: '⚡',
    currency: 'GBP',
    fiscalYearStart: '01-01',
    createdAt: '2024-03-05T10:00:00Z',
    settings: { theme: 'dark', notifications: false },
  },
];

export const mockUsers: User[] = [
  {
    id: 'user-platform-001',
    email: 'admin@financeos.com',
    name: 'System Administrator',
    avatar: 'https://i.pravatar.cc/150?u=systemadmin',
    role: 'platform_admin',
    createdAt: '2023-01-01T10:00:00Z',
  },
  {
    id: 'user-platform-002',
    email: 'support@financeos.com',
    name: 'Support Admin',
    avatar: 'https://i.pravatar.cc/150?u=supportadmin',
    role: 'platform_admin',
    createdAt: '2023-01-01T10:00:00Z',
  },
  {
    id: 'user-platform-mgr-001',
    email: 'platform.manager@financeos.com',
    name: 'Platform Manager',
    avatar: 'https://i.pravatar.cc/150?u=platformmgr',
    role: 'platform_manager',
    createdAt: '2023-01-15T10:00:00Z',
  },
  {
    id: 'user-platform-mgr-002',
    email: 'ops.manager@financeos.com',
    name: 'Operations Manager',
    avatar: 'https://i.pravatar.cc/150?u=opsmgr',
    role: 'platform_manager',
    createdAt: '2023-01-15T10:00:00Z',
  },
  mockCurrentUser,
  {
    id: 'user-002',
    email: 'sarah.smith@agency.com',
    name: 'Sarah Smith',
    avatar: 'https://i.pravatar.cc/150?u=sarahsmith',
    role: 'organization_user',
    createdAt: '2024-01-20T10:00:00Z',
  },
  {
    id: 'user-003',
    email: 'mike.johnson@agency.com',
    name: 'Mike Johnson',
    avatar: 'https://i.pravatar.cc/150?u=mikejohnson',
    role: 'organization_user',
    createdAt: '2024-02-01T10:00:00Z',
  },
  {
    id: 'user-004',
    email: 'emma.wilson@agency.com',
    name: 'Emma Wilson',
    avatar: 'https://i.pravatar.cc/150?u=emmawilson',
    role: 'organization_user',
    createdAt: '2024-02-15T10:00:00Z',
  },
  {
    id: 'user-emp-001',
    email: 'alex.chen@agency.com',
    name: 'Alex Chen',
    avatar: 'https://i.pravatar.cc/150?u=alexchen',
    role: 'organization_user',
    createdAt: '2024-03-01T10:00:00Z',
  },
  {
    id: 'user-emp-002',
    email: 'lisa.kumar@agency.com',
    name: 'Lisa Kumar',
    avatar: 'https://i.pravatar.cc/150?u=lisakumar',
    role: 'organization_user',
    createdAt: '2024-03-10T10:00:00Z',
  },
  {
    id: 'user-emp-003',
    email: 'david.park@agency.com',
    name: 'David Park',
    avatar: 'https://i.pravatar.cc/150?u=davidpark',
    role: 'organization_user',
    createdAt: '2024-03-15T10:00:00Z',
  },
  {
    id: 'user-emp-004',
    email: 'rachel.green@agency.com',
    name: 'Rachel Green',
    avatar: 'https://i.pravatar.cc/150?u=rachelgreen',
    role: 'organization_user',
    createdAt: '2024-04-01T10:00:00Z',
  },
];

export const mockOrganizationMembers: OrganizationMember[] = [
  { userId: 'user-001', organizationId: 'org-001', role: 'owner', joinedAt: '2024-01-15T10:00:00Z', status: 'active', portalType: 'organization_admin' },
  { userId: 'user-002', organizationId: 'org-001', role: 'admin', joinedAt: '2024-01-20T10:00:00Z', status: 'active', portalType: 'organization_admin' },
  { userId: 'user-003', organizationId: 'org-001', role: 'admin', joinedAt: '2024-02-01T10:00:00Z', status: 'active', portalType: 'organization_admin' },
  { userId: 'user-004', organizationId: 'org-001', role: 'admin', joinedAt: '2024-02-15T10:00:00Z', status: 'active', portalType: 'organization_admin' },
  { userId: 'user-emp-001', organizationId: 'org-001', role: 'employee', joinedAt: '2024-03-01T10:00:00Z', status: 'active', portalType: 'employee' },
  { userId: 'user-emp-002', organizationId: 'org-001', role: 'employee', joinedAt: '2024-03-10T10:00:00Z', status: 'active', portalType: 'employee' },
  { userId: 'user-emp-003', organizationId: 'org-001', role: 'employee', joinedAt: '2024-03-15T10:00:00Z', status: 'active', portalType: 'employee' },
  { userId: 'user-emp-004', organizationId: 'org-001', role: 'employee', joinedAt: '2024-04-01T10:00:00Z', status: 'active', portalType: 'employee' },
];

function memberRoleLabel(role: UserRole): string {
  switch (role) {
    case 'owner': return 'Owner';
    case 'admin': return 'Admin';
    case 'employee': return 'Team member';
    default: return 'Member';
  }
}

/** Team directory rows mirror org membership + user profile (no separate fictional roster). */
function buildTeamForOrg(orgId: string): EmployeeTeamMember[] {
  const result: EmployeeTeamMember[] = [];
  for (const m of mockOrganizationMembers.filter(x => x.organizationId === orgId)) {
    const u = mockUsers.find(x => x.id === m.userId);
    if (u) {
      result.push({
        id: u.id,
        organizationId: orgId,
        name: u.name,
        email: u.email,
        role: memberRoleLabel(m.role),
        department: m.role === 'employee' ? 'Team' : 'Operations',
        avatar: u.avatar,
        joinedAt: m.joinedAt,
        status: 'active',
      });
    }
  }
  return result;
}

/** Minimal chart + bank wallet so Quick Add and ledger flows work on a clean seed. */
export const mockAccounts: Account[] = [
  {
    id: 'acc-org001-cash-bank',
    organizationId: 'org-001',
    code: '1010',
    name: 'Cash at bank',
    type: 'asset',
    subtype: 'current_asset',
    currency: 'PKR',
    balance: 0,
    isActive: true,
    createdAt: '2024-01-15T10:00:00Z',
  },
  // Minimal chart-of-accounts entries backing the default categories below — without at least
  // one income + a few expense accounts, `Category.accountId` (required) has nothing to link to
  // and every transaction is permanently "Uncategorised" with no in-app way to add a category.
  {
    id: 'acc-org001-revenue',
    organizationId: 'org-001',
    code: '4000',
    name: 'Client Revenue',
    type: 'income',
    subtype: 'revenue',
    currency: 'PKR',
    balance: 0,
    isActive: true,
    createdAt: '2024-01-15T10:00:00Z',
  },
  {
    id: 'acc-org001-cogs-contractors',
    organizationId: 'org-001',
    code: '5000',
    name: 'Contractor & Freelancer Costs',
    type: 'expense',
    subtype: 'cogs',
    currency: 'PKR',
    balance: 0,
    isActive: true,
    createdAt: '2024-01-15T10:00:00Z',
  },
  {
    id: 'acc-org001-opex-software',
    organizationId: 'org-001',
    code: '6000',
    name: 'Software & Subscriptions',
    type: 'expense',
    subtype: 'operating_expense',
    currency: 'PKR',
    balance: 0,
    isActive: true,
    createdAt: '2024-01-15T10:00:00Z',
  },
  {
    id: 'acc-org001-opex-rent',
    organizationId: 'org-001',
    code: '6010',
    name: 'Rent & Utilities',
    type: 'expense',
    subtype: 'operating_expense',
    currency: 'PKR',
    balance: 0,
    isActive: true,
    createdAt: '2024-01-15T10:00:00Z',
  },
  {
    id: 'acc-org001-opex-payroll',
    organizationId: 'org-001',
    code: '6020',
    name: 'Payroll & Benefits',
    type: 'expense',
    subtype: 'operating_expense',
    currency: 'PKR',
    balance: 0,
    isActive: true,
    createdAt: '2024-01-15T10:00:00Z',
  },
];

export const mockBankAccounts: BankAccount[] = [
  {
    id: 'bank-org001-main',
    organizationId: 'org-001',
    accountId: 'acc-org001-cash-bank',
    bankName: 'Main operating',
    accountNumber: '00001234',
    accountType: 'checking',
    currency: 'PKR',
    balance: 0,
    isActive: true,
    usage: 'business',
  },
];
// Minimal default categories so new transactions have something to classify against and
// Logic & Learning's "Create Custom Rule" dropdown isn't empty. There is no in-app "Add Category"
// flow (only patterns/rules are user-editable), so this seed IS the category list.
export const mockCategories: Category[] = [
  {
    id: 'cat-org001-revenue',
    organizationId: 'org-001',
    name: 'Client Revenue',
    type: 'income',
    accountId: 'acc-org001-revenue',
    color: '#10b981',
    icon: '💰',
    patterns: ['client payment', 'invoice', 'payment received'],
  },
  {
    id: 'cat-org001-contractors',
    organizationId: 'org-001',
    name: 'Contractor & Freelancer Costs',
    type: 'expense',
    accountId: 'acc-org001-cogs-contractors',
    color: '#f59e0b',
    icon: '🧑‍💻',
    patterns: ['freelancer', 'contractor'],
  },
  {
    id: 'cat-org001-software',
    organizationId: 'org-001',
    name: 'Software & Subscriptions',
    type: 'expense',
    accountId: 'acc-org001-opex-software',
    color: '#6366f1',
    icon: '💻',
    patterns: ['software', 'subscription', 'saas', 'adobe', 'aws'],
  },
  {
    id: 'cat-org001-rent',
    organizationId: 'org-001',
    name: 'Rent & Utilities',
    type: 'expense',
    accountId: 'acc-org001-opex-rent',
    color: '#ef4444',
    icon: '🏢',
    patterns: ['rent', 'electricity', 'utility', 'utilities'],
  },
  {
    id: 'cat-org001-payroll',
    organizationId: 'org-001',
    name: 'Payroll & Benefits',
    type: 'expense',
    accountId: 'acc-org001-opex-payroll',
    color: '#8b5cf6',
    icon: '👥',
    patterns: ['salary', 'payroll', 'wages'],
  },
];
/** One default cost center so project CRUD can attach `departmentId` on a clean seed (projects stay empty). */
export const mockDepartments: Department[] = [
  {
    id: 'dept-org001-general',
    organizationId: 'org-001',
    name: 'General',
    code: 'GEN',
    costCenter: 'CC-001',
    isActive: true,
  },
];
export const mockProjects: Project[] = [];
export const mockTransactions: Transaction[] = [];
export const mockAssets: Asset[] = [];
export const mockDepreciationSchedule: DepreciationSchedule[] = [];
export const mockInventoryItems: InventoryItem[] = [];
export const mockInventoryTransactions: InventoryTransaction[] = [];
export const mockOverheadAllocations: OverheadAllocation[] = [];
export const mockRecurringTransactions: RecurringTransaction[] = [];
export const mockBudgets: Budget[] = [];

/** Demo loans for org-001 (Loans & Liabilities view). */
export const mockLoans: Loan[] = [
  {
    id: 'loan-1',
    organizationId: 'org-001',
    type: 'to_receive',
    party: 'ABC Corp',
    amount: 150000,
    principal: 150000,
    amountPaid: 0,
    remainingBalance: 150000,
    currency: 'USD',
    dueDate: '2026-02-15',
    startDate: '2025-12-01',
    status: 'pending',
    description: 'Short-term business loan',
    interestRate: 8.5,
    totalInterest: 12750,
    frequency: 'monthly',
    installmentAmount: 25000,
    paymentsCount: 6,
    paymentsCompleted: 0,
    nextPaymentDate: '2026-02-15',
  },
  {
    id: 'loan-2',
    organizationId: 'org-001',
    type: 'to_pay',
    party: 'XYZ Bank',
    amount: 500000,
    principal: 450000,
    amountPaid: 180000,
    remainingBalance: 320000,
    currency: 'USD',
    dueDate: '2028-06-30',
    startDate: '2024-06-01',
    status: 'partially_paid',
    description: 'Equipment financing',
    interestRate: 6.5,
    totalInterest: 50000,
    frequency: 'monthly',
    installmentAmount: 10416,
    paymentsCount: 48,
    paymentsCompleted: 18,
    nextPaymentDate: '2026-03-01',
  },
  {
    id: 'loan-3',
    organizationId: 'org-001',
    type: 'to_receive',
    party: 'Client - Tech Solutions',
    amount: 75000,
    principal: 75000,
    amountPaid: 0,
    remainingBalance: 75000,
    currency: 'USD',
    dueDate: '2026-01-20',
    startDate: '2025-11-20',
    status: 'overdue',
    description: 'Outstanding invoice payment',
    interestRate: 0,
    totalInterest: 0,
  },
  {
    id: 'loan-4',
    organizationId: 'org-001',
    type: 'to_pay',
    party: 'Metro Credit Union',
    amount: 250000,
    principal: 250000,
    amountPaid: 62500,
    remainingBalance: 187500,
    currency: 'USD',
    dueDate: '2027-12-31',
    startDate: '2025-01-01',
    status: 'active',
    description: 'Working capital loan',
    interestRate: 7.25,
    totalInterest: 18125,
    frequency: 'quarterly',
    installmentAmount: 21875,
    paymentsCount: 12,
    paymentsCompleted: 3,
    nextPaymentDate: '2026-04-01',
  },
  {
    id: 'loan-5',
    organizationId: 'org-001',
    type: 'to_receive',
    party: 'Partner Company Ltd',
    amount: 200000,
    principal: 200000,
    amountPaid: 100000,
    remainingBalance: 100000,
    currency: 'USD',
    dueDate: '2026-08-15',
    startDate: '2025-08-15',
    status: 'active',
    description: 'Joint venture funding',
    interestRate: 5.0,
    totalInterest: 10000,
    frequency: 'monthly',
    installmentAmount: 17500,
    paymentsCount: 12,
    paymentsCompleted: 6,
    nextPaymentDate: '2026-03-15',
  },
  {
    id: 'loan-6',
    organizationId: 'org-001',
    type: 'to_pay',
    party: 'Business Line of Credit',
    amount: 100000,
    principal: 100000,
    amountPaid: 100000,
    remainingBalance: 0,
    currency: 'USD',
    dueDate: '2025-12-31',
    startDate: '2025-01-01',
    status: 'paid',
    description: 'Short-term credit line',
    interestRate: 9.5,
    totalInterest: 9500,
    frequency: 'monthly',
    installmentAmount: 9125,
    paymentsCount: 12,
    paymentsCompleted: 12,
  },
];

export const mockCashFlowForecasts: CashFlowForecast[] = [];
export const mockActiveSessions: ActiveSession[] = [];
export const mockNotifications: Notification[] = [];

export const mockEmployeeExpenses: EmployeeExpense[] = [];
/** One issued payslip per FLOW demo employee so the employee dashboard pay KPI loads with realistic values on clean seed. */
export const mockEmployeePayslips: EmployeePayslip[] = [
  {
    id: 'payslip-seed-emp-001',
    organizationId: 'org-001',
    userId: 'user-emp-001',
    period: 'March 2026',
    issueDate: '2026-03-15',
    gross: 8500,
    deductions: [{ name: 'Withholding', amount: 1850 }],
    net: 6650,
    currency: 'USD',
    status: 'paid',
  },
  {
    id: 'payslip-seed-emp-002',
    organizationId: 'org-001',
    userId: 'user-emp-002',
    period: 'March 2026',
    issueDate: '2026-03-15',
    gross: 9200,
    deductions: [{ name: 'Withholding', amount: 2010 }],
    net: 7190,
    currency: 'USD',
    status: 'paid',
  },
  {
    id: 'payslip-seed-emp-003',
    organizationId: 'org-001',
    userId: 'user-emp-003',
    period: 'March 2026',
    issueDate: '2026-03-15',
    gross: 7800,
    deductions: [{ name: 'Withholding', amount: 1690 }],
    net: 6110,
    currency: 'USD',
    status: 'paid',
  },
  {
    id: 'payslip-seed-emp-004',
    organizationId: 'org-001',
    userId: 'user-emp-004',
    period: 'March 2026',
    issueDate: '2026-03-15',
    gross: 8800,
    deductions: [{ name: 'Withholding', amount: 1920 }],
    net: 6880,
    currency: 'USD',
    status: 'paid',
  },
];
export const mockEmployeeTimesheets: TimesheetEntry[] = [];
// Team members now come from Supabase only - no mock data
export const mockEmployeeTeamMembers: EmployeeTeamMember[] = [];
export const mockCompanyAnnouncements: CompanyAnnouncement[] = [];
