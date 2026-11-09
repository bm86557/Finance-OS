/**
 * Report Service - Production-ready financial reports using Supabase
 * All calculations are organization-specific and use real data
 */

import type { 
  ProfitLossReport, 
  BalanceSheetReport,
  CashFlowReport,
  DepartmentProfitability,
  ExpenseBreakdown,
  RevenueBreakdown,
  DashboardSummary,
  CashFlowForecast,
  ServiceResponse
} from './types';
import { getSupabaseClient } from '@/lib/supabaseClient';

export interface DateRange {
  from?: string;
  to?: string;
}

export class ReportService {
  private baseUrl: string;
  private cache = new Map<string, { data: any; timestamp: number }>();
  private readonly TTL_MS = 30_000;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  /** Invalidate in-memory cache for an organization or all entries */
  invalidateCache(organizationId?: string): void {
    if (organizationId) {
      for (const key of this.cache.keys()) {
        if (key.includes(organizationId)) {
          this.cache.delete(key);
        }
      }
    } else {
      this.cache.clear();
    }
  }

  private getCached<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > this.TTL_MS) {
      this.cache.delete(key);
      return null;
    }
    return entry.data as T;
  }

  private setCached<T>(key: string, data: T): void {
    this.cache.set(key, { data, timestamp: Date.now() });
  }

  /** Attaches the Supabase bearer token so Supabase-backed `/api/v1` routes resolve the caller. */
  private async authHeaders(): Promise<HeadersInit> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    try {
      const sb = getSupabaseClient();
      if (sb) {
        const { data: { session } } = await sb.auth.getSession();
        if (session?.access_token) {
          headers['Authorization'] = `Bearer ${session.access_token}`;
        }
      }
    } catch {
      /* ignore — request proceeds without a token */
    }
    return headers;
  }

  private async unwrap<T>(response: Response): Promise<T> {
    if (!response.ok) {
      // Try to get detailed error from response body
      let errorMessage = `HTTP ${response.status} ${response.statusText}`;
      try {
        const errorData = await response.json();
        console.error('[ReportService.unwrap] Error response:', errorData);
        if (errorData?.error) {
          errorMessage = errorData.error;
        } else if (errorData?.message) {
          errorMessage = errorData.message;
        }
      } catch (parseErr) {
        console.error('[ReportService.unwrap] Failed to parse error response:', parseErr);
      }
      throw new Error(errorMessage);
    }
    
    try {
      const json = await response.json();
      console.log('[ReportService.unwrap] Success response:', json);
      
      // Handle both wrapped and unwrapped responses
      if (json && typeof json === 'object' && 'data' in json) {
        return json.data as T;
      }
      return json as T;
    } catch (parseErr) {
      console.error('[ReportService.unwrap] Failed to parse success response:', parseErr);
      throw new Error('Failed to parse response JSON');
    }
  }

  /**
   * Get Profit & Loss Statement
   * Returns revenue, COGS, operating expenses, and net income
   */
  async getProfitLoss(
    organizationId: string,
    dateRange?: DateRange
  ): Promise<ProfitLossReport> {
    const cacheKey = `pl:${organizationId}:${dateRange?.from || ''}:${dateRange?.to || ''}`;
    const cached = this.getCached<ProfitLossReport>(cacheKey);
    if (cached) return cached;

    const params = new URLSearchParams();
    if (dateRange?.from) params.set('dateFrom', dateRange.from);
    if (dateRange?.to) params.set('dateTo', dateRange.to);

    const response = await fetch(
      `${this.baseUrl}/organizations/${organizationId}/reports/profit-loss?${params}`,
      { headers: await this.authHeaders() }
    );

    const data = await this.unwrap<ProfitLossReport>(response);
    this.setCached(cacheKey, data);
    return data;
  }

  /**
   * Get Balance Sheet
   * Returns assets, liabilities, and equity as of a specific date
   */
  async getBalanceSheet(
    organizationId: string,
    asOfDate?: string
  ): Promise<BalanceSheetReport> {
    const cacheKey = `bs:${organizationId}:${asOfDate || ''}`;
    const cached = this.getCached<BalanceSheetReport>(cacheKey);
    if (cached) return cached;

    const params = new URLSearchParams();
    if (asOfDate) params.set('asOfDate', asOfDate);

    const response = await fetch(
      `${this.baseUrl}/organizations/${organizationId}/reports/balance-sheet?${params}`,
      { headers: await this.authHeaders() }
    );

    const data = await this.unwrap<BalanceSheetReport>(response);
    this.setCached(cacheKey, data);
    return data;
  }

  /**
   * Get Cash Flow Statement
   * Returns monthly cash inflows, outflows, and net cash flow
   */
  async getCashFlow(
    organizationId: string,
    months: number = 6,
    dateRange?: DateRange
  ): Promise<CashFlowReport[]> {
    const cacheKey = `cf:${organizationId}:${months}:${dateRange?.from || ''}:${dateRange?.to || ''}`;
    const cached = this.getCached<CashFlowReport[]>(cacheKey);
    if (cached) return cached;

    const params = new URLSearchParams();
    params.set('months', String(months));
    if (dateRange?.from) params.set('dateFrom', dateRange.from);
    if (dateRange?.to) params.set('dateTo', dateRange.to);

    const response = await fetch(
      `${this.baseUrl}/organizations/${organizationId}/reports/cash-flow?${params}`,
      { headers: await this.authHeaders() }
    );

    const data = await this.unwrap<CashFlowReport[]>(response);
    this.setCached(cacheKey, data);
    return data;
  }

  /**
   * Get Department P&L Analysis
   * Returns profitability breakdown by department
   */
  async getDepartmentProfitability(
    organizationId: string,
    dateRange?: DateRange
  ): Promise<DepartmentProfitability[]> {
    const cacheKey = `dept:${organizationId}:${dateRange?.from || ''}:${dateRange?.to || ''}`;
    const cached = this.getCached<DepartmentProfitability[]>(cacheKey);
    if (cached) return cached;

    const params = new URLSearchParams();
    if (dateRange?.from) params.set('dateFrom', dateRange.from);
    if (dateRange?.to) params.set('dateTo', dateRange.to);

    const response = await fetch(
      `${this.baseUrl}/organizations/${organizationId}/reports/department-profitability?${params}`,
      { headers: await this.authHeaders() }
    );

    const data = await this.unwrap<DepartmentProfitability[]>(response);
    this.setCached(cacheKey, data);
    return data;
  }

  /**
   * Get Expense Breakdown by Category
   * Returns expenses grouped by category with percentages
   */
  async getExpenseBreakdown(
    organizationId: string,
    dateRange?: DateRange
  ): Promise<ExpenseBreakdown[]> {
    const cacheKey = `exp:${organizationId}:${dateRange?.from || ''}:${dateRange?.to || ''}`;
    const cached = this.getCached<ExpenseBreakdown[]>(cacheKey);
    if (cached) return cached;

    const params = new URLSearchParams();
    if (dateRange?.from) params.set('dateFrom', dateRange.from);
    if (dateRange?.to) params.set('dateTo', dateRange.to);

    const response = await fetch(
      `${this.baseUrl}/organizations/${organizationId}/reports/expense-breakdown?${params}`,
      { headers: await this.authHeaders() }
    );

    const data = await this.unwrap<ExpenseBreakdown[]>(response);
    this.setCached(cacheKey, data);
    return data;
  }

  /**
   * Get Revenue Breakdown by Project
   * Returns revenue grouped by project with percentages
   */
  async getRevenueBreakdown(
    organizationId: string,
    dateRange?: DateRange
  ): Promise<RevenueBreakdown[]> {
    const cacheKey = `rev:${organizationId}:${dateRange?.from || ''}:${dateRange?.to || ''}`;
    const cached = this.getCached<RevenueBreakdown[]>(cacheKey);
    if (cached) return cached;

    const params = new URLSearchParams();
    if (dateRange?.from) params.set('dateFrom', dateRange.from);
    if (dateRange?.to) params.set('dateTo', dateRange.to);

    const response = await fetch(
      `${this.baseUrl}/organizations/${organizationId}/reports/revenue-breakdown?${params}`,
      { headers: await this.authHeaders() }
    );

    const data = await this.unwrap<RevenueBreakdown[]>(response);
    this.setCached(cacheKey, data);
    return data;
  }

  /**
   * Get Dashboard Summary
   * Returns current period summary with month-over-month changes
   */
  async getDashboardSummary(
    organizationId: string,
    options?: { world?: 'business' | 'personal' | 'all' }
  ): Promise<ServiceResponse<DashboardSummary>> {
    const cacheKey = `dash:${organizationId}:${options?.world || 'business'}`;
    const cached = this.getCached<DashboardSummary>(cacheKey);
    if (cached) return { success: true, data: cached };

    try {
      const response = await fetch(
        `${this.baseUrl}/organizations/${organizationId}/reports/dashboard${options?.world ? `?world=${options.world}` : ''}`,
        { headers: await this.authHeaders() }
      );

      const data = await this.unwrap<DashboardSummary>(response);
      this.setCached(cacheKey, data);
      return { success: true, data };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to fetch dashboard summary';
      return { success: false, data: null as any, error: message };
    }
  }

  /**
   * Get Cash Flow Forecast
   * Returns projected cash position, burn rate, runway, and daily forecast rows
   */
  async getForecast(
    organizationId: string,

    monthsAhead: number = 3
  ): Promise<{ kpis: Record<string, unknown>; forecasts: CashFlowForecast[] }> {
    const horizonDays = monthsAhead * 30;
    const params = new URLSearchParams();
    params.set('horizonDays', String(horizonDays));
    params.set('scenario', 'realistic');

    const response = await fetch(
      `${this.baseUrl}/organizations/${organizationId}/reports/forecast?${params}`,
      { headers: await this.authHeaders() }
    );

    return this.unwrap(response);
  }

  /**
   * Export report data to CSV
   * @param reportType - Type of report to export
   * @param data - Report data to export
   * @returns CSV string
   */
  exportToCSV(reportType: string, data: any): string {
    switch (reportType) {
      case 'profit-loss':
        return this.exportProfitLossToCSV(data);
      case 'balance-sheet':
        return this.exportBalanceSheetToCSV(data);
      case 'cash-flow':
        return this.exportCashFlowToCSV(data);
      case 'department-pl':
        return this.exportDepartmentPLToCSV(data);
      default:
        throw new Error(`Unknown report type: ${reportType}`);
    }
  }

  private exportProfitLossToCSV(data: ProfitLossReport): string {
    let csv = 'Profit & Loss Statement\n';
    const periodStr = typeof data.period === 'string' ? data.period : `${(data.period as any)?.from || ''} to ${(data.period as any)?.to || ''}`;
    csv += `Period: ${periodStr}\n\n`;
    
    csv += 'Category,Account,Amount\n';
    
    // Revenue
    csv += 'Revenue,,\n';
    if (Array.isArray(data.revenue)) {
      data.revenue.forEach((item: any) => {
        csv += `,${item.name},${item.amount}\n`;
      });
    }
    csv += `,Total Revenue,${data.totalRevenue}\n\n`;
    
    // COGS
    csv += 'Cost of Goods Sold,,\n';
    if (Array.isArray(data.cogs)) {
      data.cogs.forEach((item: any) => {
        csv += `,${item.name},${item.amount}\n`;
      });
    }
    csv += `,Total COGS,${data.totalCOGS}\n`;
    csv += `,Gross Profit,${data.grossProfit}\n\n`;
    
    // Operating Expenses
    csv += 'Operating Expenses,,\n';
    if (Array.isArray(data.operatingExpenses)) {
      data.operatingExpenses.forEach((item: any) => {
        csv += `,${item.name},${item.amount}\n`;
      });
    }
    csv += `,Total Operating Expenses,${data.totalOperatingExpenses}\n`;
    csv += `,Operating Income,${data.operatingIncome}\n`;
    csv += `,Net Income,${data.netIncome}\n`;
    
    return csv;
  }

  private exportBalanceSheetToCSV(data: BalanceSheetReport): string {
    let csv = 'Balance Sheet\n';
    csv += `As of: ${data.asOfDate}\n\n`;
    
    csv += 'Category,Account,Amount\n';
    
    // Assets
    csv += 'Assets,,\n';
    if (Array.isArray(data.assets)) {
      data.assets.forEach((item: any) => {
        csv += `,${item.name},${item.balance}\n`;
      });
    }
    csv += `,Total Assets,${data.totalAssets}\n\n`;
    
    // Liabilities
    csv += 'Liabilities,,\n';
    if (Array.isArray(data.liabilities)) {
      data.liabilities.forEach((item: any) => {
        csv += `,${item.name},${item.balance}\n`;
      });
    }
    csv += `,Total Liabilities,${data.totalLiabilities}\n\n`;
    
    // Equity
    csv += 'Equity,,\n';
    if (Array.isArray(data.equity)) {
      data.equity.forEach((item: any) => {
        csv += `,${item.name},${item.balance}\n`;
      });
    }
    csv += `,Total Equity,${data.totalEquity}\n`;
    
    return csv;
  }

  private exportCashFlowToCSV(data: CashFlowReport[]): string {
    let csv = 'Cash Flow Statement\n\n';
    csv += 'Month,Inflow,Outflow,Net\n';
    
    data.forEach(item => {
      csv += `${item.month},${item.inflow},${item.outflow},${item.net}\n`;
    });
    
    return csv;
  }

  private exportDepartmentPLToCSV(data: DepartmentProfitability[]): string {
    let csv = 'Department P&L Analysis\n\n';
    csv += 'Department,Revenue,Expenses,Profit,Margin %,Headcount\n';
    
    data.forEach(dept => {
      const expenses = (dept as any).expenses ?? (dept.directCosts + (dept.allocatedOverhead || 0));
      const profit = (dept as any).profit ?? dept.netProfit;
      csv += `${dept.departmentName},${dept.revenue},${expenses},${profit},${dept.profitMargin},${dept.headcount}\n`;
    });
    
    return csv;
  }

  /**
   * Get Reconciliation Summary & Equations status (§15)
   */
  async getReconciliationSummary(organizationId: string): Promise<any> {
    const response = await fetch(
      `${this.baseUrl}/organizations/${organizationId}/reports/reconciliation-summary`,
      { headers: await this.authHeaders() }
    );
    return this.unwrap(response);
  }

  /**
   * Get Client Profitability Rollup
   */
  async getClientProfitability(organizationId: string): Promise<any[]> {
    const response = await fetch(
      `${this.baseUrl}/organizations/${organizationId}/reports/profitability/clients`,
      { headers: await this.authHeaders() }
    );
    return this.unwrap(response);
  }

  /**
   * Get Profit Forecast (Recognized / Accrued Revenue & Costs)
   */
  async getProfitForecast(
    organizationId: string,
    scenario = 'realistic',
    horizonMonths = 6
  ): Promise<any> {
    const response = await fetch(
      `${this.baseUrl}/organizations/${organizationId}/reports/forecast/profit?scenario=${scenario}&horizonMonths=${horizonMonths}`,
      { headers: await this.authHeaders() }
    );
    return this.unwrap(response);
  }

  /**
   * Get Capacity Forecast (Hours, Rates & Utilization)
   */
  async getCapacityForecast(
    organizationId: string,
    scenario = 'realistic',
    horizonMonths = 6
  ): Promise<any> {
    const response = await fetch(
      `${this.baseUrl}/organizations/${organizationId}/reports/forecast/capacity?scenario=${scenario}&horizonMonths=${horizonMonths}`,
      { headers: await this.authHeaders() }
    );
    return this.unwrap(response);
  }

  /**
   * Get Integrated Cash, Profit & Capacity Forecast with Scenarios & Assumptions
   */
  async getCombinedForecast(
    organizationId: string,
    scenario = 'realistic',
    horizonMonths = 6
  ): Promise<any> {
    const response = await fetch(
      `${this.baseUrl}/organizations/${organizationId}/reports/forecast/combined?scenario=${scenario}&horizonMonths=${horizonMonths}`,
      { headers: await this.authHeaders() }
    );
    return this.unwrap(response);
  }

  /**
   * List Saved Versioned Report Snapshots
   */
  async getSnapshots(organizationId: string, reportType?: string): Promise<any[]> {
    const url = `${this.baseUrl}/organizations/${organizationId}/reports/snapshots${reportType ? `?reportType=${reportType}` : ''}`;
    const response = await fetch(url, { headers: await this.authHeaders() });
    return this.unwrap(response);
  }

  /**
   * Create Frozen Versioned Report Snapshot
   */
  async createSnapshot(organizationId: string, snapshotInput: {
    reportType: string;
    title: string;
    periodStart?: string;
    periodEnd?: string;
    accountingBasis?: 'cash' | 'accrual';
    snapshotData: any;
  }): Promise<any> {
    const response = await fetch(
      `${this.baseUrl}/organizations/${organizationId}/reports/snapshots`,
      {
        method: 'POST',
        headers: await this.authHeaders(),
        body: JSON.stringify(snapshotInput),
      }
    );
    return this.unwrap(response);
  }

  /**
   * Get Governance Audit & Classification Accuracy Metrics
   */
  async getGovernanceAuditHistory(organizationId: string): Promise<any> {
    const response = await fetch(
      `${this.baseUrl}/organizations/${organizationId}/reports/governance/audit-history`,
      { headers: await this.authHeaders() }
    );
    return this.unwrap(response);
  }

  /**
   * Download CSV file
   */
  downloadCSV(filename: string, csvContent: string): void {
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
}

// Singleton instance
let reportServiceInstance: ReportService | null = null;

export function getReportService(): ReportService {
  if (!reportServiceInstance) {
    const baseUrl = import.meta.env.VITE_API_BASE_URL || '/api/v1';
    reportServiceInstance = new ReportService(baseUrl);
  }
  return reportServiceInstance;
}

// Named export for convenience (backward compatible)
export const reportService = getReportService();

// Default export
export default getReportService();
