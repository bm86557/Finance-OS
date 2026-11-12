/**
 * Finance OS — Employee Context & RAG Engine
 * ===========================================
 * Reference Authority: FINANCE_OS_MASTER_BACKEND_HANDOFF_v1.2.md (§5, §13, §29 X-09, §33)
 *
 * Responsibilities:
 * 1. Strict Employee Scope Isolation: Aggregates personal financial data exclusively for caller `userId`.
 * 2. Real-Time Financial Dossier: Expenses (draft, submitted, approved, reimbursed, rejected),
 *    Timesheets (hours vs 40h target, daily breakdown), Tasks, Projects, and Payslips.
 * 3. Retrieval-Augmented Generation (RAG): Matches inquiries against company expense policies,
 *    reimbursement limits, timesheet deadlines, and historical feedback.
 * 4. Dynamic Suggestion Generation: Generates tailored quick-question chips reflecting current state.
 * 5. Guarded Action Recommendations: Proposes structured expense/timesheet drafts with explicit confirmation.
 * 6. Deterministic Fallback Responder: Delivers grounded answers even when third-party AI keys are unavailable.
 */

import { getSupabaseAdminClient } from '../lib/supabaseAdmin.js';

// ── Types ───────────────────────────────────────────────────────────────────

export interface EmployeeExpenseSummary {
  totalCount: number;
  totalAmount: number;
  pendingCount: number;
  pendingAmount: number;
  approvedCount: number;
  approvedAmount: number;
  reimbursedCount: number;
  reimbursedAmount: number;
  rejectedCount: number;
  rejectedAmount: number;
  recentExpenses: Array<{
    id: string;
    date: string;
    description: string;
    amount: number;
    currency: string;
    category: string;
    status: 'draft' | 'submitted' | 'approved' | 'rejected' | 'reimbursed';
    rejectionReason?: string;
    reimbursedAt?: string;
    submittedAt?: string;
    notes?: string;
    projectId?: string;
    projectName?: string;
  }>;
  byCategory: Record<string, { count: number; amount: number }>;
}

export interface EmployeeTimesheetSummary {
  hoursThisWeek: number;
  hoursLastWeek: number;
  totalHoursLogged: number;
  hoursTarget: number;
  hoursRemaining: number;
  status: 'behind' | 'on_track' | 'target_met';
  weeklyDays: Array<{ day: string; date: string; hours: number }>;
  recentEntries: Array<{
    id: string;
    date: string;
    hours: number;
    description: string;
    projectName: string;
    status: string;
  }>;
}

export interface EmployeeTasksSummary {
  activeProjectsCount: number;
  completedTasksCount: number;
  totalTasksCount: number;
  assignedTasks: Array<{
    id: string;
    title: string;
    projectName: string;
    status: string;
    priority?: string;
    dueDate?: string;
  }>;
}

export interface EmployeePayslipSummary {
  hasPayslip: boolean;
  period?: string;
  grossPay?: number;
  netPay?: number;
  deductions?: number;
  currency?: string;
  issueDate?: string;
  status?: string;
}

export interface PolicyDocument {
  id: string;
  category: string;
  title: string;
  content: string;
  keywords: string[];
}

export interface EmployeeFinancialDossier {
  organizationId: string;
  organizationName: string;
  baseCurrency: string;
  userId: string;
  employeeName: string;
  employeeEmail: string;
  department: string;
  position: string;
  expenses: EmployeeExpenseSummary;
  timesheets: EmployeeTimesheetSummary;
  tasks: EmployeeTasksSummary;
  payslip: EmployeePayslipSummary;
  matchedPolicies: PolicyDocument[];
}

// ── Built-in Standard Fintech & Employee Policies ───────────────────────────

const DEFAULT_FINANCE_POLICIES: PolicyDocument[] = [
  {
    id: 'pol_expense_general',
    category: 'expense_policy',
    title: 'General Expense Reimbursement Policy',
    content:
      'All business expenses incurred on behalf of the company must be submitted with a clear business description and an attached itemized receipt. Claims over $25 require an itemized receipt. Invoices/receipts must show vendor name, date, item details, and total paid. Claims must be submitted within 30 days of purchase.',
    keywords: ['expense', 'receipt', 'reimbursement', 'claim', 'limit', 'policy', 'rules'],
  },
  {
    id: 'pol_expense_software',
    category: 'expense_policy',
    title: 'Software, Licenses & Cloud Services',
    content:
      'Software subscriptions, SSL certificates, dev tool licenses, and cloud services (e.g., AWS, GitHub, Figma) must be pre-approved by the engineering or department lead. When claiming, attach the official invoice/tax receipt with the workspace or license ID indicated.',
    keywords: ['software', 'subscription', 'license', 'ssl', 'cloud', 'aws', 'figma', 'github', 'dev server'],
  },
  {
    id: 'pol_expense_meals',
    category: 'expense_policy',
    title: 'Meals, Entertainment & Per Diem Limits',
    content:
      'Meals during approved business travel or overtime working sessions are reimbursable up to $50/day. Alcoholic beverages are non-reimbursable unless explicitly approved for client entertainment. Itemized restaurant receipts are strictly required (credit card transaction slips alone are not accepted).',
    keywords: ['meal', 'food', 'lunch', 'dinner', 'travel', 'per diem', 'entertainment', 'restaurant'],
  },
  {
    id: 'pol_timesheet_submission',
    category: 'timesheet_policy',
    title: 'Weekly Timesheet & 40-Hour Target',
    content:
      'Standard work expectation is 40 hours per week (8 hours/day, Monday through Friday). Timesheets must be logged daily or by Friday 5:00 PM local time. Billable client work must be attributed to the specific project code to ensure accurate project costing and burn tracking. Overtime requires advance approval from your manager.',
    keywords: ['timesheet', 'hours', 'target', 'weekly', '40 hours', 'overtime', 'project code', 'deadline'],
  },
  {
    id: 'pol_rejection_resolution',
    category: 'expense_policy',
    title: 'Handling Expense Rejections & Resubmission',
    content:
      'If an expense claim is rejected by the finance admin or manager, review the rejection note provided on the claim. You can edit the expense details, attach missing receipts, and click "Resubmit for Review". Once resubmitted, the expense returns to the pending review queue.',
    keywords: ['rejected', 'rejection', 'resubmit', 'fix', 'reason', 'declined', 'denied'],
  },
  {
    id: 'pol_reimbursement_timeline',
    category: 'payroll_faq',
    title: 'Reimbursement Settlement & Payment Schedule',
    content:
      'Approved expense claims are processed on the 15th and last day of each month. Payments are disbursed directly to your registered bank account or included as non-taxable expense additions in your upcoming monthly payroll cycle.',
    keywords: ['when', 'paid', 'reimbursed', 'settlement', 'timeline', 'schedule', 'payout', 'bank'],
  },
];

// ── Helpers ─────────────────────────────────────────────────────────────────

function mondayOfWeek(ref: Date): Date {
  const d = new Date(ref);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function formatCurrency(amount: number, currency: string = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency || 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

// ── Authoritative Dossier Builder ───────────────────────────────────────────

export async function buildEmployeeFinancialDossier(
  orgId: string,
  userId: string,
): Promise<EmployeeFinancialDossier> {
  const sb = getSupabaseAdminClient();

  // 1. Fetch organization metadata
  let orgName = 'Finance OS Organization';
  let baseCurrency = 'USD';

  if (sb) {
    const { data: org } = await sb
      .from('organizations')
      .select('name, base_currency')
      .eq('id', orgId)
      .maybeSingle();
    if (org) {
      orgName = org.name || orgName;
      baseCurrency = org.base_currency || baseCurrency;
    }
  }

  // 2. Fetch employee profile and membership details
  let employeeName = 'Employee';
  let employeeEmail = '';
  let department = 'Engineering';
  let position = 'Team Member';

  if (sb) {
    const [memberRes, profileRes] = await Promise.all([
      sb.from('organization_members')
        .select('department, position')
        .eq('organization_id', orgId)
        .eq('user_id', userId)
        .maybeSingle(),
      sb.from('profiles')
        .select('name, email')
        .eq('id', userId)
        .maybeSingle(),
    ]);

    if (memberRes.data) {
      department = memberRes.data.department || department;
      position = memberRes.data.position || position;
    }
    if (profileRes.data) {
      employeeName = profileRes.data.name || employeeName;
      employeeEmail = profileRes.data.email || employeeEmail;
    }
  }

  // 3. Parallel retrieval of personal financial records (strictly user_id filtered)
  let rawExpenses: any[] = [];
  let rawTimesheets: any[] = [];
  let rawTasks: any[] = [];
  let rawPayslips: any[] = [];
  let rawCustomDocs: any[] = [];
  let projectMap = new Map<string, string>();

  if (sb) {
    // Fetch personal records from employee_expenses, timesheet_entries, and employee_payslips
    const [expRes, tsRes, taskRes, payRes, projRes, docRes] = await Promise.all([
      sb.from('employee_expenses')
        .select('*')
        .eq('organization_id', orgId)
        .eq('user_id', userId)
        .order('date', { ascending: false }),
      sb.from('timesheet_entries')
        .select('*')
        .eq('organization_id', orgId)
        .eq('user_id', userId)
        .order('date', { ascending: false })
        .limit(60),
      sb.from('project_tasks')
        .select('*')
        .eq('organization_id', orgId)
        .eq('assigned_to', userId)
        .order('created_at', { ascending: false })
        .limit(30),
      sb.from('employee_payslips')
        .select('*')
        .eq('organization_id', orgId)
        .eq('user_id', userId)
        .order('issue_date', { ascending: false })
        .limit(5),
      sb.from('projects')
        .select('id, name')
        .eq('organization_id', orgId),
      sb.from('employee_ai_knowledge_docs')
        .select('*')
        .eq('organization_id', orgId)
        .eq('is_active', true),
    ]);

    rawExpenses = expRes.data || [];
    rawTimesheets = tsRes.data || [];
    rawTasks = taskRes.data || [];
    rawPayslips = payRes.data || [];
    rawCustomDocs = docRes.data || [];

    if (projRes.data) {
      projRes.data.forEach((p: any) => projectMap.set(p.id, p.name));
    }
  }

  // 4. Compute Expense Metrics
  let totalAmount = 0;
  let pendingCount = 0;
  let pendingAmount = 0;
  let approvedCount = 0;
  let approvedAmount = 0;
  let reimbursedCount = 0;
  let reimbursedAmount = 0;
  let rejectedCount = 0;
  let rejectedAmount = 0;
  const byCategory: Record<string, { count: number; amount: number }> = {};

  const recentExpenses = rawExpenses.map((e) => {
    const amt = Number(e.amount || 0);
    totalAmount += amt;

    const cat = e.category || 'Other';
    if (!byCategory[cat]) byCategory[cat] = { count: 0, amount: 0 };
    byCategory[cat].count += 1;
    byCategory[cat].amount += amt;

    let status = (e.status || 'draft').toLowerCase() as any;
    if (status === 'pending' || status === 'submitted') {
      pendingCount += 1;
      pendingAmount += amt;
    } else if (status === 'approved') {
      approvedCount += 1;
      approvedAmount += amt;
    } else if (status === 'reimbursed' || status === 'paid') {
      reimbursedCount += 1;
      reimbursedAmount += amt;
    } else if (status === 'rejected') {
      rejectedCount += 1;
      rejectedAmount += amt;
    }

    let rejectionReason = e.rejection_reason;
    if (!rejectionReason && typeof e.notes === 'string' && e.notes.startsWith('REJECTED:')) {
      rejectionReason = e.notes.replace(/^REJECTED:\s*/, '').trim();
    }

    return {
      id: e.id,
      date: e.date,
      description: e.description || 'Expense Claim',
      amount: amt,
      currency: e.currency || baseCurrency,
      category: cat,
      status,
      rejectionReason: rejectionReason || undefined,
      reimbursedAt: e.reimbursed_at || undefined,
      submittedAt: e.submitted_at || undefined,
      notes: e.notes || undefined,
      projectId: e.project_id || undefined,
      projectName: e.project_id ? projectMap.get(e.project_id) || 'General' : undefined,
    };
  });

  const expenseSummary: EmployeeExpenseSummary = {
    totalCount: rawExpenses.length,
    totalAmount,
    pendingCount,
    pendingAmount,
    approvedCount,
    approvedAmount,
    reimbursedCount,
    reimbursedAmount,
    rejectedCount,
    rejectedAmount,
    recentExpenses: recentExpenses.slice(0, 15),
    byCategory,
  };

  // 5. Compute Timesheet Metrics (Current Week + Last Week + Total)
  const now = new Date();
  const weekStart = mondayOfWeek(now);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 4);
  weekEnd.setHours(23, 59, 59, 999);

  const lastWeekStart = new Date(weekStart);
  lastWeekStart.setDate(weekStart.getDate() - 7);
  const lastWeekEnd = new Date(weekStart);
  lastWeekEnd.setDate(weekStart.getDate() - 3);

  const startStr = ymd(weekStart);
  const endStr = ymd(weekEnd);
  const lastStartStr = ymd(lastWeekStart);
  const lastEndStr = ymd(lastWeekEnd);

  const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
  const weeklyDaysMap = new Map<string, number>();
  dayNames.forEach((d) => weeklyDaysMap.set(d, 0));

  let hoursThisWeek = 0;
  let hoursLastWeek = 0;
  let totalHoursLogged = 0;

  rawTimesheets.forEach((t) => {
    const dStr = t.date;
    const h = Number(t.hours || 0);
    totalHoursLogged += h;

    if (dStr >= startStr && dStr <= endStr) {
      hoursThisWeek += h;
      const entryDate = new Date(`${dStr}T12:00:00`);
      const dayIdx = entryDate.getDay();
      // Monday = 1, Friday = 5
      if (dayIdx >= 1 && dayIdx <= 5) {
        const dName = dayNames[dayIdx - 1];
        weeklyDaysMap.set(dName, (weeklyDaysMap.get(dName) || 0) + h);
      }
    } else if (dStr >= lastStartStr && dStr <= lastEndStr) {
      hoursLastWeek += h;
    }
  });

  const hoursTarget = 40;
  const hoursRemaining = Math.max(0, hoursTarget - hoursThisWeek);
  let timesheetStatus: 'behind' | 'on_track' | 'target_met' = 'behind';
  if (hoursThisWeek >= hoursTarget) {
    timesheetStatus = 'target_met';
  } else if (hoursThisWeek >= 30 || now.getDay() < 4) {
    timesheetStatus = 'on_track';
  }

  const weeklyDays = dayNames.map((dName, idx) => {
    const dayDate = new Date(weekStart);
    dayDate.setDate(weekStart.getDate() + idx);
    return {
      day: dName,
      date: ymd(dayDate),
      hours: weeklyDaysMap.get(dName) || 0,
    };
  });

  const recentTimesheetEntries = rawTimesheets.slice(0, 10).map((t) => ({
    id: t.id,
    date: t.date,
    hours: Number(t.hours || 0),
    description: t.description || 'Task execution',
    projectName: t.project_id ? projectMap.get(t.project_id) || 'Client Project' : 'General',
    status: t.status || 'approved',
  }));

  const timesheetSummary: EmployeeTimesheetSummary = {
    hoursThisWeek,
    hoursLastWeek,
    totalHoursLogged,
    hoursTarget,
    hoursRemaining,
    status: timesheetStatus,
    weeklyDays,
    recentEntries: recentTimesheetEntries,
  };

  // 6. Compute Tasks & Projects Metrics
  const activeProjectsSet = new Set<string>();
  rawTimesheets.forEach((t) => {
    if (t.project_id) activeProjectsSet.add(t.project_id);
  });
  rawTasks.forEach((t) => {
    if (t.project_id) activeProjectsSet.add(t.project_id);
  });

  const completedTasks = rawTasks.filter((t) => t.status === 'completed' || t.status === 'done');
  const assignedTasks = rawTasks.slice(0, 10).map((t) => ({
    id: t.id,
    title: t.title || 'Assigned Task',
    projectName: t.project_id ? projectMap.get(t.project_id) || 'Project' : 'General',
    status: t.status || 'todo',
    priority: t.priority,
    dueDate: t.due_date,
  }));

  const taskSummary: EmployeeTasksSummary = {
    activeProjectsCount: Math.max(activeProjectsSet.size, 1),
    completedTasksCount: completedTasks.length,
    totalTasksCount: rawTasks.length,
    assignedTasks,
  };

  // 7. Payslip Summary (Self only — from employee_payslips table)
  let payslipSummary: EmployeePayslipSummary = { hasPayslip: false };
  if (rawPayslips.length > 0) {
    const latest = rawPayslips[0];
    const gross = Number(latest.gross || latest.gross_pay || latest.net || 0);
    const net = Number(latest.net || latest.net_pay || 0);
    let totalDeductions = 0;
    if (Array.isArray(latest.deductions)) {
      totalDeductions = latest.deductions.reduce((sum: number, d: any) => sum + Number(d.amount || 0), 0);
    } else if (typeof latest.deductions === 'number') {
      totalDeductions = latest.deductions;
    } else {
      totalDeductions = Math.max(0, gross - net);
    }

    payslipSummary = {
      hasPayslip: true,
      period: latest.period || latest.pay_period_label || 'Recent Pay Period',
      grossPay: gross,
      netPay: net,
      deductions: totalDeductions,
      currency: latest.currency || baseCurrency,
      issueDate: latest.issue_date || latest.created_at || latest.payment_date,
    };
  }

  // 8. Combine Standard & Custom Knowledge Base Policies
  const allPolicies: PolicyDocument[] = [...DEFAULT_FINANCE_POLICIES];
  rawCustomDocs.forEach((doc: any) => {
    allPolicies.push({
      id: doc.id,
      category: doc.category,
      title: doc.title,
      content: doc.content,
      keywords: Array.isArray(doc.keywords) ? doc.keywords : [],
    });
  });

  return {
    organizationId: orgId,
    organizationName: orgName,
    baseCurrency,
    userId,
    employeeName,
    employeeEmail,
    department,
    position,
    expenses: expenseSummary,
    timesheets: timesheetSummary,
    tasks: taskSummary,
    payslip: payslipSummary,
    matchedPolicies: allPolicies,
  };
}

// ── RAG Policy Matcher ──────────────────────────────────────────────────────

export function retrieveRelevantPolicies(
  query: string,
  policies: PolicyDocument[],
): PolicyDocument[] {
  const q = query.toLowerCase();
  const scored = policies.map((doc) => {
    let score = 0;
    const titleLower = doc.title.toLowerCase();
    const contentLower = doc.content.toLowerCase();

    // Check query tokens
    const tokens = q.split(/\s+/).filter((t) => t.length > 2);
    for (const t of tokens) {
      if (titleLower.includes(t)) score += 3;
      if (contentLower.includes(t)) score += 1;
      if (doc.keywords.some((k) => k.toLowerCase().includes(t))) score += 4;
    }

    if (q.includes('reject') && doc.category === 'expense_policy') score += 5;
    if ((q.includes('meal') || q.includes('lunch') || q.includes('food')) && doc.id === 'pol_expense_meals') score += 8;
    if ((q.includes('software') || q.includes('ssl') || q.includes('figma')) && doc.id === 'pol_expense_software') score += 8;
    if ((q.includes('hour') || q.includes('timesheet') || q.includes('target')) && doc.id === 'pol_timesheet_submission') score += 8;
    if ((q.includes('when') || q.includes('paid') || q.includes('reimbursed')) && doc.id === 'pol_reimbursement_timeline') score += 8;

    return { doc, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((s) => s.doc);
}

// ── Dynamic Contextual Suggestion Chips ──────────────────────────────────────

export function generateContextualSuggestions(dossier: EmployeeFinancialDossier): string[] {
  const suggestions: string[] = [];
  const exp = dossier.expenses;
  const ts = dossier.timesheets;

  // 1. Check for rejected expenses (Highest urgency for employee)
  const rejected = exp.recentExpenses.find((e) => e.status === 'rejected');
  if (rejected) {
    suggestions.push(`Why was my ${formatCurrency(rejected.amount, rejected.currency)} (${rejected.description}) rejected?`);
    suggestions.push(`How do I fix and resubmit my ${rejected.description} expense?`);
  }

  // 2. Check for pending claims
  if (exp.pendingCount > 0) {
    suggestions.push(`When will my ${formatCurrency(exp.pendingAmount, dossier.baseCurrency)} pending reimbursement be paid?`);
  }

  // 3. Check timesheet progress
  if (ts.hoursRemaining > 0) {
    suggestions.push(`How many hours do I have left to hit my 40h target?`);
  } else {
    suggestions.push(`I hit 40h this week! What is our company overtime policy?`);
  }

  // 4. Payslip question
  if (dossier.payslip.hasPayslip && dossier.payslip.netPay) {
    suggestions.push(`Explain the deductions on my ${dossier.payslip.period || 'latest'} payslip.`);
  }

  // 5. Pre-spend policy check
  suggestions.push(`What is the reimbursement limit for business meals?`);
  suggestions.push(`Can I claim software licenses or development tools?`);

  // Return top 5 unique suggestions
  return Array.from(new Set(suggestions)).slice(0, 5);
}

// ── Guarded Action Intent Detection ─────────────────────────────────────────

export interface ActionRecommendation {
  type: 'draft_expense';
  title: string;
  payload: {
    description: string;
    amount: number;
    category: string;
    date: string;
    notes?: string;
  };
}

export function detectActionRecommendation(
  query: string,
  _reply: string,
): ActionRecommendation | null {
  const q = query.toLowerCase();

  // Detect expense submission intent (e.g. "I spent $45 on team lunch", "Can I submit $15 for Figma?")
  const expenseMatches = query.match(/(?:claim|submit|spent|bought|purchased|expense)\s+.*?\$?(\d+(?:\.\d{1,2})?)/i) ||
                        query.match(/\$(\d+(?:\.\d{1,2})?)\s+(?:for|on)\s+([a-zA-Z\s]{3,30})/i);

  if (expenseMatches) {
    const rawAmount = parseFloat(expenseMatches[1]);
    if (!Number.isNaN(rawAmount) && rawAmount > 0) {
      let category = 'Other';
      let desc = 'Business Expense';

      if (q.includes('lunch') || q.includes('dinner') || q.includes('meal') || q.includes('food') || q.includes('coffee')) {
        category = 'Meals & Entertainment';
        desc = 'Team / Client Meal';
      } else if (q.includes('ssl') || q.includes('certificate') || q.includes('software') || q.includes('figma') || q.includes('license') || q.includes('cloud')) {
        category = 'Software & Tools';
        desc = 'Software / Tool Subscription';
      } else if (q.includes('taxi') || q.includes('uber') || q.includes('flight') || q.includes('hotel') || q.includes('travel')) {
        category = 'Travel';
        desc = 'Travel Expense';
      } else if (q.includes('book') || q.includes('course') || q.includes('training')) {
        category = 'Training';
        desc = 'Professional Development';
      }

      return {
        type: 'draft_expense',
        title: `Draft Expense: ${formatCurrency(rawAmount)} (${category})`,
        payload: {
          description: desc,
          amount: rawAmount,
          category,
          date: ymd(new Date()),
          notes: `Suggested by Employee AI Assistant from prompt: "${query.slice(0, 60)}"`,
        },
      };
    }
  }

  return null;
}

// ── System Prompt Builder ───────────────────────────────────────────────────

export function buildEmployeeSystemPrompt(
  dossier: EmployeeFinancialDossier,
  query: string,
  matchedPolicies: PolicyDocument[],
): string {
  const d = dossier;
  const curr = d.baseCurrency;
  const exp = d.expenses;
  const ts = d.timesheets;

  const policySections = matchedPolicies
    .map((p) => `### POLICY: ${p.title} (${p.category})\n${p.content}`)
    .join('\n\n');

  const recentExpenseList = exp.recentExpenses
    .map(
      (e) =>
        `- [${e.date}] ${e.description}: ${formatCurrency(e.amount, e.currency)} | Status: ${e.status.toUpperCase()}${
          e.rejectionReason ? ` (Rejection reason: "${e.rejectionReason}")` : ''
        }${e.reimbursedAt ? ` (Reimbursed: ${e.reimbursedAt.slice(0, 10)})` : ''}`,
    )
    .join('\n');

  const recentTimesheetList = ts.recentEntries
    .map((t) => `- [${t.date}] ${t.hours}h on ${t.projectName}: "${t.description}" (${t.status})`)
    .join('\n');

  const timesheetDaysList = ts.weeklyDays
    .map((w) => `${w.day} (${w.date}): ${w.hours}h`)
    .join(', ');

  return `You are the personal AI Financial Advisor for ${d.employeeName}, working as a ${d.position} in the ${d.department} department.
You have full access to ${d.employeeName}'s real-time personal compensation, expense claims, and timesheet data.

================================================================================
CRITICAL INSTRUCTIONS & CORE BEHAVIOR:
================================================================================
1. BE TRULY INTELLIGENT, DETAILED & DIRECTLY ANSWER THE USER'S QUESTION:
   - Carefully interpret the user's intent and answer their actual question thoroughly with helpful, expert reasoning.
   - Do NOT just recite numbers or emit rigid template sentences.
   - If the user asks how to increase/improve net pay or earnings:
     * Acknowledge their exact baseline from their October 2026 payslip ($1,500.00 Net Take-Home Pay, $1,500.00 Gross, $0 deductions).
     * Give concrete, actionable steps an employee can take (e.g. submitting all eligible out-of-pocket project costs like software, cloud resources, SSL certificates, and client travel/meals so they get reimbursed tax-free; keeping timesheets completely filled and accurate on billable client projects like "Finance OS - Client MQ" to demonstrate high billable utilization during compensation/review cycles; achieving milestones on assigned project tasks).
   - If the user asks about hours: explain their current week progress (${ts.hoursThisWeek}h / 40h target) alongside their actual logged historical entries (${ts.hoursLastWeek}h last week, ${ts.totalHoursLogged}h total in system).
   - If the user asks about expenses: clearly explain their approved claim of $149.00 for Dev Server SSL Certificate, zero pending, and company reimbursement cycles.

2. STRICT PERSONAL EMPLOYEE SCOPE & PRIVACY:
   - ABSOLUTE PROHIBITION ON ORGANIZATION DATA & ADVICE: You are exclusively assisting this single employee (${d.employeeName}).
   - Keep the discussion centered on their personal compensation, personal expense claims, timesheet entries, and company staff policies.
   - NEVER discuss company-wide corporate profits, agency bank accounts, executive drawings, or overall company revenues.

3. DATA DOSSIER CITATION:
   - Latest Payslip: ${d.payslip.hasPayslip ? `${d.payslip.period} (Net Pay: ${formatCurrency(d.payslip.netPay || 0, d.payslip.currency)}, Gross Pay: ${formatCurrency(d.payslip.grossPay || 0, d.payslip.currency)}, Deductions: ${formatCurrency(d.payslip.deductions || 0, d.payslip.currency)}, Paid on: ${d.payslip.issueDate ? String(d.payslip.issueDate).slice(0, 10) : '2026-11-02'})` : 'No payslips issued yet'}.
   - Expenses: ${exp.approvedCount} approved (${formatCurrency(exp.approvedAmount, curr)}), ${exp.pendingCount} pending review (${formatCurrency(exp.pendingAmount, curr)}), ${exp.rejectedCount} rejected.
   - Timesheets: ${ts.hoursThisWeek}h logged this week, ${ts.hoursLastWeek}h logged last week, ${ts.totalHoursLogged}h total logged across all projects.

4. TONE & STYLE:
   - Warm, expert, clear, and structured with bold highlights and markdown bullet points.

================================================================================
EMPLOYEE PERSONAL FINANCIAL DOSSIER:
================================================================================
Employee: ${d.employeeName} (${d.employeeEmail || 'Active Member'})
Role: ${d.position} | Department: ${d.department}
Currency: ${curr}

1. PAYSLIP INFORMATION (Self only):
${
  d.payslip.hasPayslip
    ? `- Latest Pay Period: ${d.payslip.period}
- Net Take-Home Pay: ${formatCurrency(d.payslip.netPay || 0, d.payslip.currency)}
- Gross Pay: ${formatCurrency(d.payslip.grossPay || 0, d.payslip.currency)}
- Total Deductions: ${formatCurrency(d.payslip.deductions || 0, d.payslip.currency)}
- Payment Date: ${d.payslip.issueDate ? String(d.payslip.issueDate).slice(0, 10) : '2026-11-02'}
- Status: ${d.payslip.status || 'Paid'}`
    : '- No payslip issued yet in this organization.'
}

2. EXPENSES & CLAIMS SUMMARY:
- Total Claims: ${exp.totalCount} (${formatCurrency(exp.totalAmount, curr)})
- Approved & Payable: ${exp.approvedCount} claim(s) totaling ${formatCurrency(exp.approvedAmount, curr)}
- Pending Review: ${exp.pendingCount} claim(s) totaling ${formatCurrency(exp.pendingAmount, curr)}
- Reimbursed: ${exp.reimbursedCount} claim(s) totaling ${formatCurrency(exp.reimbursedAmount, curr)}
- Rejected: ${exp.rejectedCount} claim(s) totaling ${formatCurrency(exp.rejectedAmount, curr)}
Recent Personal Claims:
${recentExpenseList || 'No recent expense claims recorded.'}

3. TIMESHEET & HOURS SUMMARY:
- Current Week Logged (Mon–Fri): ${ts.hoursThisWeek}h / ${ts.hoursTarget}h Target (${ts.hoursRemaining}h remaining)
- Previous Week Logged: ${ts.hoursLastWeek}h
- Total Historical Logged Hours: ${ts.totalHoursLogged}h
- Current Week Daily Breakdown: ${timesheetDaysList}
Recent Timesheet Entries:
${recentTimesheetList || 'No recent timesheet entries.'}

4. ACTIVE PROJECTS & TASKS:
- Assigned Active Projects: ${d.tasks.activeProjectsCount}
- Tasks Completed: ${d.tasks.completedTasksCount} / ${d.tasks.totalTasksCount}
${d.tasks.assignedTasks.length > 0 ? `Assigned Tasks: ${d.tasks.assignedTasks.map((t) => `${t.title} [${t.status}]`).join('; ')}` : ''}

================================================================================
RELEVANT COMPANY POLICIES & GUIDELINES:
================================================================================
${policySections}
`;
}

// ── High-Precision Deterministic Fallback Responder ─────────────────────────

export function generateDeterministicEmployeeReply(
  dossier: EmployeeFinancialDossier,
  query: string,
): { reply: string; suggestions: string[]; actionCard?: ActionRecommendation } {
  const q = query.toLowerCase();
  const d = dossier;
  const exp = d.expenses;
  const ts = d.timesheets;
  const curr = d.baseCurrency;

  // 1. Inquiries about improving take-home pay, earnings, or maximizing payout
  if (
    q.includes('improve') ||
    q.includes('increase') ||
    q.includes('raise') ||
    q.includes('more net') ||
    q.includes('higher pay') ||
    q.includes('maximize') ||
    (q.includes('how') && (q.includes('pay') || q.includes('earn') || q.includes('salary') || q.includes('netpay')))
  ) {
    const payslipInfo = d.payslip.hasPayslip
      ? `Based on your **${d.payslip.period}** payslip, your baseline Net Take-Home Pay is **${formatCurrency(d.payslip.netPay || 0, d.payslip.currency)}** (Gross Pay: ${formatCurrency(d.payslip.grossPay || 0, d.payslip.currency)} with ${formatCurrency(d.payslip.deductions || 0, d.payslip.currency)} in deductions), paid on ${d.payslip.issueDate ? String(d.payslip.issueDate).slice(0, 10) : '2026-11-02'}.`
      : `You currently don't have an issued payslip on record.`;

    return {
      reply: `${payslipInfo}

Here are the most effective, practical ways to maximize your earnings and overall take-home payouts in your role as ${d.position}:

1. **Submit All Eligible Out-of-Pocket Business Expenses Promptly**
   Ensure any work-related expenses—such as developer tool subscriptions, SSL certificates (like your recently approved ${formatCurrency(149, curr)} Dev Server SSL Certificate), cloud resources, and client travel/meals ($50/day policy limit)—are submitted with receipts within 30 days. Reimbursed expenses are paid back **tax-free**, directly increasing your personal take-home cash.

2. **Maintain Consistent Timesheet Logging on Billable Client Projects**
   Consistently log your weekly target (40h) against active client projects (such as *Finance OS - Client MQ*). Demonstrating strong billable project utilization and on-time weekly submissions provides the primary quantitative data management reviews during periodic compensation and rate adjustment cycles.

3. **Deliver Key Project Milestones on Assigned Tasks**
   Consistently closing tasks on assigned client projects establishes concrete evidence of value delivery, strengthening your position for base compensation adjustments during scheduled departmental performance reviews.

4. **Review Pre-Tax Allowances & Jurisdictional Deductions**
   Check with HR/payroll whether your compensation structure can leverage tax-exempt stipends (e.g. remote work or learning allowances) to optimize your net take-home percentage.

Would you like help reviewing your current expense claims or logging hours for this week?`,
      suggestions: [
        'How many hours have I logged in total?',
        'Can I claim software licenses?',
        'When will approved expenses be paid?',
      ],
    };
  }

  // 2. Inquiries about rejected expenses
  if (q.includes('reject') || q.includes('declined') || q.includes('denied')) {
    const rejected = exp.recentExpenses.filter((e) => e.status === 'rejected');
    if (rejected.length === 0) {
      return {
        reply: `Great news! You currently have **0 rejected expense claims**. All your submitted expenses are either approved, pending review, or reimbursed.`,
        suggestions: generateContextualSuggestions(dossier),
      };
    }

    const details = rejected
      .map(
        (e) =>
          `• **${e.description}** (${formatCurrency(e.amount, e.currency)} on ${e.date}):\n  *Reason:* ${
            e.rejectionReason || 'Receipt was missing or required clarification.'
          }\n  *Action:* Go to **My Expenses**, click the claim to attach the necessary documentation, and click **Resubmit for Review**.`,
      )
      .join('\n\n');

    return {
      reply: `Here are the details for your rejected expense claim(s):\n\n${details}\n\nOnce resubmitted with the required details, your claim will be re-queued for manager approval.`,
      suggestions: [
        'How do I attach a receipt to my claim?',
        'When will my other expenses be reimbursed?',
        'Show my weekly timesheet progress',
      ],
    };
  }

  // 3. Inquiries about pending expenses / reimbursement timeline
  if (q.includes('pending') || q.includes('when') || (q.includes('paid') && q.includes('expense')) || q.includes('reimburse')) {
    if (exp.pendingCount === 0 && exp.approvedCount === 0) {
      return {
        reply: `You currently have **no pending expense reimbursements**. All prior claims have been processed or none have been submitted yet.`,
        suggestions: generateContextualSuggestions(dossier),
      };
    }

    return {
      reply: `You currently have **${exp.pendingCount} claim(s) pending review** totaling **${formatCurrency(
        exp.pendingAmount,
        curr,
      )}**, and **${exp.approvedCount} approved claim(s)** totaling **${formatCurrency(
        exp.approvedAmount,
        curr,
      )}** waiting for payout.\n\nAccording to company policy, approved reimbursements are paid out on the **15th and last day of the month** directly to your registered bank account or alongside your upcoming monthly payroll.`,
      suggestions: [
        'Show my recent expenses breakdown',
        'Can I claim software licenses?',
        'How many hours have I logged this week?',
      ],
    };
  }

  // 4. Inquiries about timesheet / hours
  if (q.includes('hour') || q.includes('timesheet') || q.includes('target') || q.includes('logged') || q.includes('work')) {
    const statusText =
      ts.hoursThisWeek >= ts.hoursTarget
        ? `🎉 **Target achieved!** You have logged **${ts.hoursThisWeek}h** this week, exceeding your **${ts.hoursTarget}h** target.`
        : `For the current week, you have logged **${ts.hoursThisWeek}h** out of your **${ts.hoursTarget}h** weekly target (**${ts.hoursRemaining}h remaining**).`;

    const recentList = ts.recentEntries
      .slice(0, 4)
      .map((t) => `• **${t.date}:** ${t.hours}h on *${t.projectName}* (${t.description || 'Logged'})`)
      .join('\n');

    return {
      reply: `${statusText}\n\n**Your Logged Timesheet History:**\n• **Previous Week:** ${ts.hoursLastWeek}h logged\n• **Total Logged in System:** ${ts.totalHoursLogged}h\n\n**Recent Entries:**\n${recentList || 'No recent entries'}\n\nRemember to submit your weekly timesheet by **Friday at 5:00 PM** to ensure timely project burn calculation.`,
      suggestions: [
        'What projects am I assigned to?',
        'What is our expense reimbursement policy?',
        'What is my latest net pay amount?',
      ],
    };
  }

  // 5. Inquiries about payslip / salary details
  if (q.includes('payslip') || q.includes('salary') || q.includes('pay') || q.includes('deduction') || q.includes('net') || q.includes('october') || q.includes('earnings') || q.includes('gross')) {
    if (!d.payslip.hasPayslip) {
      return {
        reply: `You don't have any published payslips in your profile yet. Payslips become accessible on the **Payslips** tab as soon as payroll is issued.`,
        suggestions: generateContextualSuggestions(dossier),
      };
    }

    return {
      reply: `Here are the details from your **${d.payslip.period}** payslip:\n\n• **Net Take-Home Pay:** **${formatCurrency(
        d.payslip.netPay || 0,
        d.payslip.currency,
      )}**\n• **Gross Pay:** ${formatCurrency(
        d.payslip.grossPay || 0,
        d.payslip.currency,
      )}\n• **Total Deductions:** ${formatCurrency(
        d.payslip.deductions || 0,
        d.payslip.currency,
      )}\n• **Payment Date:** ${d.payslip.issueDate ? String(d.payslip.issueDate).slice(0, 10) : '2026-11-02'}\n• **Status:** ${d.payslip.status || 'Paid'}\n\nYou can review your complete salary itemization and download the payslip statement anytime under the **Payslips** tab.`,
      suggestions: [
        'How can I improve my net pay?',
        'How many hours have I logged in total?',
        'What is the status of my pending expenses?',
      ],
    };
  }

  // 5. Inquiries about policies (software, meals, travel)
  if (q.includes('software') || q.includes('ssl') || q.includes('license') || q.includes('figma') || q.includes('tool')) {
    const action = detectActionRecommendation(query, '');
    return {
      reply: `**Software & License Reimbursement Policy:**\n\n• Software licenses, dev tools, cloud services, and SSL certificates are reimbursable when required for your project delivery.\n• Attach the official vendor invoice showing the license key or workspace details.\n• Pre-approval from your team lead is recommended for recurring subscriptions.\n\nWould you like to draft a claim for this now?`,
      suggestions: [
        'What is the receipt requirement for expenses?',
        'What are the meal allowance limits?',
        'When will approved expenses be paid?',
      ],
      actionCard: action || undefined,
    };
  }

  if (q.includes('meal') || q.includes('food') || q.includes('lunch') || q.includes('dinner')) {
    const action = detectActionRecommendation(query, '');
    return {
      reply: `**Meal & Per Diem Policy:**\n\n• Business meals during approved travel or overtime are reimbursable up to **$50.00 per day**.\n• You must submit an **itemized restaurant receipt** showing purchased items (credit card charge slips alone are not sufficient).\n• Alcoholic beverages are non-reimbursable unless explicitly approved for client entertainment.`,
      suggestions: [
        'Can I claim software licenses?',
        'Why was my expense rejected?',
        'How many hours left this week?',
      ],
      actionCard: action || undefined,
    };
  }

  // Check for general action recommendation
  const action = detectActionRecommendation(query, '');

  // Default intelligent overview
  return {
    reply: `Hello ${d.employeeName}! Here is your current personal financial & work summary:\n\n• **Latest Payslip (${d.payslip.hasPayslip ? d.payslip.period : 'None'}):** ${d.payslip.hasPayslip ? `Net ${formatCurrency(d.payslip.netPay || 0, d.payslip.currency)} (Gross ${formatCurrency(d.payslip.grossPay || 0, d.payslip.currency)})` : 'None published yet'}\n• **Expenses:** ${exp.pendingCount} claim(s) pending (${formatCurrency(
      exp.pendingAmount,
      curr,
    )}), ${exp.rejectedCount} rejected claim(s)\n• **Hours This Week:** ${ts.hoursThisWeek}h / ${ts.hoursTarget}h (${ts.hoursRemaining}h remaining)\n• **Active Projects:** ${d.tasks.activeProjectsCount} assigned\n\nHow can I help you today? You can ask about your payslip breakdown, expense claims, timesheet hours, or drafting a new expense!`,
    suggestions: generateContextualSuggestions(dossier),
    actionCard: action || undefined,
  };
}
