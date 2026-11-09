// Export Utilities for Finance OS
// Handles CSV, Excel, PDF exports with formatting

import { formatCurrency, formatDate } from './formatters';

export interface ExportOptions {
  format: 'csv' | 'excel' | 'pdf';
  filename: string;
  includeHeaders?: boolean;
  dateRange?: { from: string; to: string };
}

// CSV Export
export function exportToCSV(data: any[], headers: string[], filename: string) {
  try {
    // Create CSV content
    const csvHeaders = headers.join(',');
    const csvRows = data.map(row => 
      headers.map(header => {
        const value = row[header];
        // Escape commas and quotes
        if (typeof value === 'string' && (value.includes(',') || value.includes('"'))) {
          return `"${value.replace(/"/g, '""')}"`;
        }
        return value;
      }).join(',')
    );
    
    const csvContent = [csvHeaders, ...csvRows].join('\n');
    
    // Create download
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    
    link.setAttribute('href', url);
    link.setAttribute('download', `${filename}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    return { success: true, message: 'CSV exported successfully' };
  } catch (error) {
    console.error('CSV export error:', error);
    return { success: false, message: 'Failed to export CSV' };
  }
}

// Transaction Export
export function exportTransactions(transactions: any[], options: Partial<ExportOptions> = {}) {
  const { format = 'csv', filename = 'transactions', dateRange } = options;
  
  let data = transactions;
  
  // Filter by date range if provided
  if (dateRange) {
    data = data.filter(txn => {
      const txnDate = new Date(txn.date);
      const fromDate = new Date(dateRange.from);
      const toDate = new Date(dateRange.to);
      return txnDate >= fromDate && txnDate <= toDate;
    });
  }
  
  // Format data for export
  const exportData = data.map(txn => ({
    Date: formatDate(txn.date),
    Narration: txn.narration,
    Category: txn.category,
    Type: txn.type,
    Scope: txn.scope,
    Amount: txn.amount,
    Currency: txn.currency,
    Account: txn.accountName,
    Department: txn.department || '',
    Status: txn.status || '',
  }));
  
  const headers = ['Date', 'Narration', 'Category', 'Type', 'Scope', 'Amount', 'Currency', 'Account', 'Department', 'Status'];
  
  if (format === 'csv') {
    return exportToCSV(exportData, headers, filename);
  }
  
  // Excel and PDF would use similar logic but with different libraries
  return { success: false, message: `${format.toUpperCase()} export not yet implemented` };
}

// Budget Export
export function exportBudgets(budgets: any[], options: Partial<ExportOptions> = {}) {
  const { format = 'csv', filename = 'budgets' } = options;
  
  const exportData = budgets.map(budget => ({
    Name: budget.name,
    Category: budget.category,
    'Budgeted Amount': budget.amount,
    'Spent Amount': budget.spent,
    'Remaining': budget.amount - budget.spent,
    'Usage %': ((budget.spent / budget.amount) * 100).toFixed(1),
    Period: budget.period,
    'Start Date': formatDate(budget.startDate),
    'End Date': formatDate(budget.endDate),
    Status: budget.status,
    Department: budget.department || ''
  }));
  
  const headers = ['Name', 'Category', 'Budgeted Amount', 'Spent Amount', 'Remaining', 'Usage %', 'Period', 'Start Date', 'End Date', 'Status', 'Department'];
  
  if (format === 'csv') {
    return exportToCSV(exportData, headers, filename);
  }
  
  return { success: false, message: `${format.toUpperCase()} export not yet implemented` };
}

// Cash Flow Forecast Export
export function exportForecast(forecastData: any[], options: Partial<ExportOptions> = {}) {
  const { format = 'csv', filename = 'cashflow-forecast' } = options;
  
  const exportData = forecastData.map(data => ({
    Date: formatDate(data.date),
    Type: data.type,
    Income: data.income,
    Expense: data.expense,
    'Net Flow': data.netFlow,
    Balance: data.balance
  }));
  
  const headers = ['Date', 'Type', 'Income', 'Expense', 'Net Flow', 'Balance'];
  
  if (format === 'csv') {
    return exportToCSV(exportData, headers, filename);
  }
  
  return { success: false, message: `${format.toUpperCase()} export not yet implemented` };
}

// P&L Export
export function exportProfitLoss(data: any, options: Partial<ExportOptions> = {}) {
  const { format = 'csv', filename = 'profit-loss-statement' } = options;
  
  const exportData = [
    { Category: 'INCOME', Amount: '', Percentage: '' },
    ...Object.entries(data.income || {}).map(([category, amount]: [string, any]) => ({
      Category: `  ${category}`,
      Amount: amount,
      Percentage: ((amount / data.totalIncome) * 100).toFixed(1) + '%'
    })),
    { Category: 'Total Income', Amount: data.totalIncome, Percentage: '100%' },
    { Category: '', Amount: '', Percentage: '' },
    { Category: 'EXPENSES', Amount: '', Percentage: '' },
    ...Object.entries(data.expenses || {}).map(([category, amount]: [string, any]) => ({
      Category: `  ${category}`,
      Amount: amount,
      Percentage: ((amount / data.totalExpenses) * 100).toFixed(1) + '%'
    })),
    { Category: 'Total Expenses', Amount: data.totalExpenses, Percentage: '100%' },
    { Category: '', Amount: '', Percentage: '' },
    { Category: 'NET PROFIT', Amount: data.netProfit, Percentage: ((data.netProfit / data.totalIncome) * 100).toFixed(1) + '%' }
  ];
  
  const headers = ['Category', 'Amount', 'Percentage'];
  
  if (format === 'csv') {
    return exportToCSV(exportData, headers, filename);
  }
  
  return { success: false, message: `${format.toUpperCase()} export not yet implemented` };
}

// Generic data export
export function exportData(data: any[], columns: string[], options: Partial<ExportOptions> = {}) {
  const { format = 'csv', filename = 'export' } = options;
  
  if (format === 'csv') {
    return exportToCSV(data, columns, filename);
  }
  
  return { success: false, message: `${format.toUpperCase()} export not yet implemented` };
}

/**
 * QuickBooks Online (.csv) & QuickBooks Desktop (.iif) Double-Entry Export
 * Controlled system-wide by the `export_to_quickbooks` Platform Feature Flag.
 */
export function exportToQuickBooks(
  transactions: any[],
  filename = 'quickbooks-ledger-export',
  mode: 'qbo_csv' | 'iif' = 'qbo_csv'
) {
  try {
    if (mode === 'iif') {
      const lines: string[] = [
        '!TRNS\tTRNSID\tTRNSTYPE\tDATE\tACCNT\tNAME\tAMOUNT\tDOCNUM\tMEMO',
        '!SPL\tSPLID\tTRNSTYPE\tDATE\tACCNT\tNAME\tAMOUNT\tDOCNUM\tMEMO',
        '!ENDTRNS',
      ];
      transactions.forEach((t, idx) => {
        const isCredit = t.type === 'credit' || t.type === 'income';
        const trnsType = isCredit ? 'DEPOSIT' : 'CHECK';
        const rawAmt = Math.abs(Number(t.amount || 0));
        const bankAmt = isCredit ? rawAmt : -rawAmt;
        const splitAmt = -bankAmt;
        const dateStr = String(t.date || new Date().toISOString().slice(0, 10));
        const bankAcct = String(t.accountName || t.bankAccountId || 'Operating Bank Account').replace(/\t/g, ' ');
        const catAcct = String(t.category || t.categoryName || (isCredit ? 'Sales Income' : 'Operating Expense')).replace(/\t/g, ' ');
        const memo = String(t.description || t.narration || '').replace(/[\r\n\t]+/g, ' ').slice(0, 120);
        const docNum = String(t.id || `TXN-${idx + 1}`);

        lines.push(`TRNS\t${idx + 1}\t${trnsType}\t${dateStr}\t${bankAcct}\t\t${bankAmt.toFixed(2)}\t${docNum}\t${memo}`);
        lines.push(`SPL\t${idx + 1}\t${trnsType}\t${dateStr}\t${catAcct}\t\t${splitAmt.toFixed(2)}\t${docNum}\t${memo}`);
        lines.push('ENDTRNS');
      });

      const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8;' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', `${filename}.iif`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      return { success: true, message: 'QuickBooks Desktop (.IIF) exported successfully' };
    }

    const qboRows = transactions.map((t, idx) => {
      const isCredit = t.type === 'credit' || t.type === 'income';
      const signedAmount = isCredit ? Math.abs(Number(t.amount || 0)) : -Math.abs(Number(t.amount || 0));
      return {
        Date: String(t.date || new Date().toISOString().slice(0, 10)),
        Description: String(t.description || t.narration || 'Transaction').replace(/[\r\n]+/g, ' '),
        Amount: signedAmount.toFixed(2),
        Account: String(t.accountName || t.bankAccountId || 'Operating Bank Account'),
        Category: String(t.category || t.categoryName || (isCredit ? 'Income' : 'Expense')),
        Reference: String(t.id || `QBO-${idx + 1}`),
        Currency: String(t.currency || 'PKR'),
      };
    });

    return exportToCSV(
      qboRows,
      ['Date', 'Description', 'Amount', 'Account', 'Category', 'Reference', 'Currency'],
      filename
    );
  } catch (error) {
    console.error('QuickBooks export error:', error);
    return { success: false, message: 'Failed to export to QuickBooks' };
  }
}

// Future: Excel export with XLSX library
/*
import * as XLSX from 'xlsx';

export function exportToExcel(data: any[], filename: string, sheetName: string = 'Sheet1') {
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, `${filename}.xlsx`);
}
*/

// Future: PDF export with jsPDF library
/*
import jsPDF from 'jspdf';
import 'jspdf-autotable';

export function exportToPDF(data: any[], headers: string[], filename: string) {
  const doc = new jsPDF();
  doc.text('Finance OS Report', 14, 15);
  doc.autoTable({
    head: [headers],
    body: data.map(row => headers.map(h => row[h])),
    startY: 25
  });
  doc.save(`${filename}.pdf`);
}
*/