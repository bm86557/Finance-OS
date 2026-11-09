export interface PlanFeatureDefinition {
  id: string;
  label: string;
  description: string;
  category: 'core' | 'intelligence' | 'operations' | 'compliance' | 'enterprise';
  relatedViewId?: string;
  defaultInTiers?: ('basic' | 'professional' | 'enterprise')[];
}

export const CANONICAL_PLAN_FEATURES: PlanFeatureDefinition[] = [
  {
    id: 'statement_import',
    label: 'Statement Import & OCR',
    description: 'Bulk CSV, Excel and PDF statement parsing with OCR',
    category: 'core',
    relatedViewId: 'import',
    defaultInTiers: ['basic', 'professional', 'enterprise'],
  },
  {
    id: 'personal_finance',
    label: 'Personal Finance Tracking',
    description: 'Personal vs business expense tagging & categorization',
    category: 'core',
    defaultInTiers: ['professional', 'enterprise'],
  },
  {
    id: 'profit_intelligence',
    label: 'Profit Intelligence & Margin Analysis',
    description: 'Gross margin tracking, revenue velocity, and margin optimization',
    category: 'intelligence',
    relatedViewId: 'profit-intelligence',
    defaultInTiers: ['professional', 'enterprise'],
  },
  {
    id: 'team_management',
    label: 'Team Management & Multi-Seat RBAC',
    description: 'Invite members, assign custom roles, and audit access logs',
    category: 'operations',
    relatedViewId: 'team',
    defaultInTiers: ['professional', 'enterprise'],
  },
  {
    id: 'costing_engine',
    label: 'Costing Engine & Unit Economics',
    description: 'Unit cost breakdown, direct vs indirect cost allocation',
    category: 'operations',
    relatedViewId: 'costing',
    defaultInTiers: ['professional', 'enterprise'],
  },
  {
    id: 'ai_assistant',
    label: 'Neural AI Financial Analyst',
    description: 'Conversational financial analysis, anomaly detection and smart insights',
    category: 'intelligence',
    relatedViewId: 'ai-assistant',
    defaultInTiers: ['professional', 'enterprise'],
  },
  {
    id: 'recurring_transactions',
    label: 'Recurring Schedules & Auto-Posting',
    description: 'Automated recurring billing, subscriptions and payroll generation',
    category: 'operations',
    relatedViewId: 'recurring',
    defaultInTiers: ['professional', 'enterprise'],
  },
  {
    id: 'budget_alerts',
    label: 'Budgets & Overspend Alerts',
    description: 'Custom monthly/quarterly department budgets with real-time alerts',
    category: 'core',
    relatedViewId: 'budgets',
    defaultInTiers: ['professional', 'enterprise'],
  },
  {
    id: 'forecast_modeling',
    label: 'Cash Flow Forecasting & Runway',
    description: 'Predictive 12-month forward runway projection and cash burn',
    category: 'intelligence',
    relatedViewId: 'forecast',
    defaultInTiers: ['enterprise'],
  },
  {
    id: 'projects',
    label: 'Project Profitability & Costing',
    description: 'Job costing, project revenue and expense attribution',
    category: 'operations',
    relatedViewId: 'projects',
    defaultInTiers: ['enterprise'],
  },
  {
    id: 'simulator',
    label: 'Financial Scenario Simulator',
    description: 'Stress-test revenue drops, hiring spikes and capital expenditures',
    category: 'intelligence',
    relatedViewId: 'simulator',
    defaultInTiers: ['enterprise'],
  },
  {
    id: 'assets',
    label: 'Fixed Assets & Depreciation Engine',
    description: 'Asset lifecycle management and automated straight-line/declining depreciation',
    category: 'compliance',
    relatedViewId: 'assets',
    defaultInTiers: ['enterprise'],
  },
  {
    id: 'inventory',
    label: 'Inventory & Stock Valuation',
    description: 'COGS calculations, FIFO/weighted average inventory valuation',
    category: 'operations',
    relatedViewId: 'inventory',
    defaultInTiers: ['enterprise'],
  },
  {
    id: 'loans',
    label: 'Debt & Loan Amortization Schedules',
    description: 'Principal and interest schedule tracking with auto-split entries',
    category: 'compliance',
    relatedViewId: 'loans',
    defaultInTiers: ['enterprise'],
  },
  {
    id: 'reports',
    label: 'Advanced Financial & Compliance Reports',
    description: 'Audit-ready Balance Sheet, Income Statement, and Tax summaries',
    category: 'compliance',
    relatedViewId: 'reports',
    defaultInTiers: ['enterprise'],
  },
  {
    id: 'payroll',
    label: 'Payroll Ledger & Tax Deductions',
    description: 'Employee compensation tracking and tax withholding records',
    category: 'operations',
    relatedViewId: 'payroll',
    defaultInTiers: ['enterprise'],
  },
  {
    id: 'integrations',
    label: 'Integrations & Webhooks',
    description: 'Connect external ERPs, payment gateways and automated webhooks',
    category: 'enterprise',
    relatedViewId: 'integrations',
    defaultInTiers: ['enterprise'],
  },
  {
    id: 'api_access',
    label: 'Platform REST & GraphQL API Access',
    description: 'Programmatic API tokens with rate-limit headroom for enterprise systems',
    category: 'enterprise',
    defaultInTiers: ['enterprise'],
  },
  {
    id: 'white_label',
    label: 'White Labeling & Custom Domain',
    description: 'Custom portal subdomain, corporate logo, and unbranded client reports',
    category: 'enterprise',
    defaultInTiers: ['enterprise'],
  },
];

// Views that are always accessible regardless of subscription tier
export const ALWAYS_ACCESSIBLE_VIEWS = new Set<string>([
  'finance-os',
  'dashboard',
  'quick-add',
  'transactions',
  'accounts',
  'payment-methods',
  'settings',
]);

// Map view IDs to required feature ID (or multiple acceptable feature IDs)
export const VIEW_TO_FEATURE_MAP: Record<string, string> = {
  import: 'statement_import',
  'profit-intelligence': 'profit_intelligence',
  profit_intelligence: 'profit_intelligence',
  team: 'team_management',
  team_management: 'team_management',
  costing: 'costing_engine',
  costing_engine: 'costing_engine',
  'ai-assistant': 'ai_assistant',
  ai_assistant: 'ai_assistant',
  assistant: 'ai_assistant',
  recurring: 'recurring_transactions',
  recurring_transactions: 'recurring_transactions',
  budgets: 'budget_alerts',
  budget_alerts: 'budget_alerts',
  forecast: 'forecast_modeling',
  forecast_modeling: 'forecast_modeling',
  projects: 'projects',
  simulator: 'simulator',
  assets: 'assets',
  inventory: 'inventory',
  loans: 'loans',
  reports: 'reports',
  payroll: 'payroll',
  integrations: 'integrations',
};

/**
 * Normalizes feature strings (handles kebab-case, snake_case, or human strings like "Statement Import")
 */
export function normalizeFeatureKey(feature: string): string {
  const normalized = feature.toLowerCase().trim().replace(/[\s-]+/g, '_');

  // Also check if matches any label
  const foundByLabel = CANONICAL_PLAN_FEATURES.find(
    (f) => f.label.toLowerCase() === feature.toLowerCase().trim() || f.id === normalized
  );
  if (foundByLabel) return foundByLabel.id;

  // Aliases
  if (normalized.includes('personal')) return 'personal_finance';
  if (normalized.includes('statement') || normalized.includes('import')) return 'statement_import';
  if (normalized.includes('profit')) return 'profit_intelligence';
  if (normalized.includes('team')) return 'team_management';
  if (normalized.includes('costing')) return 'costing_engine';
  if (normalized.includes('api')) return 'api_access';
  if (normalized.includes('white_label') || normalized.includes('whitelabel')) return 'white_label';
  if (normalized.includes('ai') || normalized.includes('analyst')) return 'ai_assistant';
  if (normalized.includes('recurring')) return 'recurring_transactions';
  if (normalized.includes('budget')) return 'budget_alerts';
  if (normalized.includes('forecast')) return 'forecast_modeling';
  if (normalized.includes('simulator') || normalized.includes('what_if')) return 'simulator';
  if (normalized.includes('project')) return 'projects';
  if (normalized.includes('asset')) return 'assets';
  if (normalized.includes('inventory')) return 'inventory';
  if (normalized.includes('loan')) return 'loans';
  if (normalized.includes('report')) return 'reports';
  if (normalized.includes('payroll')) return 'payroll';
  if (normalized.includes('integration')) return 'integrations';

  return normalized;
}

/**
 * Checks if a specific view ID is allowed given a list of granted plan features
 */
export function isViewAllowedByPlanFeatures(
  viewId: string,
  grantedFeatures: string[] | undefined | null
): boolean {
  if (ALWAYS_ACCESSIBLE_VIEWS.has(viewId)) {
    return true;
  }

  const requiredFeature = VIEW_TO_FEATURE_MAP[viewId];
  if (!requiredFeature) {
    // If it's an unmapped view, permit by default or check if exact name exists
    return true;
  }

  if (!grantedFeatures || !Array.isArray(grantedFeatures) || grantedFeatures.length === 0) {
    return false;
  }

  const normalizedGranted = grantedFeatures.map(normalizeFeatureKey);
  return normalizedGranted.includes(requiredFeature);
}

/**
 * Returns human readable name for a view requirement
 */
export function getRequiredFeatureForView(viewId: string): PlanFeatureDefinition | undefined {
  const reqId = VIEW_TO_FEATURE_MAP[viewId];
  if (!reqId) return undefined;
  return CANONICAL_PLAN_FEATURES.find((f) => f.id === reqId);
}



// ── RBAC Permission to Plan Feature Mapping ─────────────────────────────────

export const PERMISSION_TO_FEATURE_MAP: Record<string, string> = {
  import_statements: 'statement_import',
  ai_assistant: 'ai_assistant',
  manage_team: 'team_management',
  manage_permissions: 'team_management',
  export_data: 'reports',
  profit_intelligence: 'profit_intelligence',
  costing_engine: 'costing_engine',
  simulator: 'simulator',
  recurring_transactions: 'recurring_transactions',
  budget_planning: 'budget_alerts',
  forecast_modeling: 'forecast_modeling',
  project_profitability: 'projects',
  assets_depreciation: 'assets',
  inventory_management: 'inventory',
  loans_liabilities: 'loans',
  payroll_management: 'payroll',
  integrations: 'integrations',
};

/**
 * Checks if an RBAC permission is allowed by the organization's current plan features.
 * Base permissions (view_dashboard, add_transaction, categorize, etc.) are always allowed.
 */
export function isPermissionAllowedByPlanFeatures(
  permissionId: string,
  grantedFeatures: string[] | undefined | null
): boolean {
  const reqFeature = PERMISSION_TO_FEATURE_MAP[permissionId];
  if (!reqFeature) {
    return true; // Base permission
  }

  if (!grantedFeatures || !Array.isArray(grantedFeatures) || grantedFeatures.length === 0) {
    return false;
  }

  const normalizedGranted = grantedFeatures.map(normalizeFeatureKey);
  return normalizedGranted.includes(reqFeature);
}

/**
 * Returns the plan feature required for an RBAC permission
 */
export function getRequiredPlanFeatureForPermission(
  permissionId: string
): PlanFeatureDefinition | undefined {
  const reqId = PERMISSION_TO_FEATURE_MAP[permissionId];
  if (!reqId) return undefined;
  return CANONICAL_PLAN_FEATURES.find((f) => f.id === reqId);
}
