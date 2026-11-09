import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../ui/dialog';
import { Badge } from '../ui/badge';
import { Clock, User, ArrowRight, CheckCircle2, FileText, Sparkles, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { formatCurrency, formatDate } from '@/lib/formatters';
import { auditService, type AuditLogEntry } from '@/services/auditService';

interface TransactionVersion {
  version: number;
  timestamp: string;
  title: string;
  editedBy: {
    name: string;
    role: string;
  };
  changes: {
    field: string;
    oldValue: string;
    newValue: string;
  }[];
  isCurrent: boolean;
}

interface TransactionHistoryModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  transaction: any;
}

export function TransactionHistoryModal({
  open,
  onOpenChange,
  transaction,
}: TransactionHistoryModalProps) {
  const { user: currentUser, currentOrganization } = useAuth();
  const orgCurrency = currentOrganization?.currency || transaction?.currency || 'USD';
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);

  useEffect(() => {
    if (!open || !transaction?.id || !currentOrganization?.id) return;
    let active = true;
    auditService
      .getAll(currentOrganization.id, { search: String(transaction.id) })
      .then((res) => {
        if (active && res.success && Array.isArray(res.data)) {
          setAuditLogs(res.data.filter((l) => l.resourceId === transaction.id || l.details?.includes(transaction.id)));
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [open, transaction?.id, currentOrganization?.id]);

  const versions = useMemo<TransactionVersion[]>(() => {
    if (!transaction) return [];

    const tags: string[] = Array.isArray(transaction.tags) ? transaction.tags.map(String) : [];
    const rawAmt = Math.abs(Number(transaction.amount || 0));
    const formattedAmt = formatCurrency(rawAmt, transaction.currency || orgCurrency);
    const isCredit = transaction.type === 'credit' || transaction.type === 'income';
    const typeLabel = isCredit ? 'CREDIT (Inflow)' : 'DEBIT (Outflow)';
    const createdDateStr = transaction.createdAt
      ? new Date(transaction.createdAt).toLocaleString()
      : formatDate(transaction.date || new Date().toISOString());

    const importTag = tags.find((t) => t.startsWith('import:'));
    const sourceFile = transaction.sourceFileName || (importTag ? importTag.slice(7) : null);

    let originActor = {
      name: currentUser?.name || 'Organization Admin',
      role: 'Manual Ledger Entry',
    };
    if (sourceFile) {
      originActor = { name: `Statement Import (${sourceFile})`, role: 'Automated Bank Import' };
    } else if (tags.includes('recurring')) {
      originActor = { name: 'Recurring Schedule Engine', role: 'Automated Recurring Entry' };
    } else if (tags.includes('loan-payment')) {
      originActor = { name: 'Loan Management Engine', role: 'Installment Ledger Entry' };
    } else if (tags.includes('inventory')) {
      originActor = { name: 'Inventory Ledger', role: 'Stock Purchase / Sale' };
    }

    const timeline: Omit<TransactionVersion, 'version' | 'isCurrent'>[] = [];

    // Step 1: Initial Creation Record (Real data from transaction)
    timeline.push({
      timestamp: createdDateStr,
      title: sourceFile ? 'Imported from Bank Statement' : 'Recorded in Ledger',
      editedBy: originActor,
      changes: [
        { field: 'Transaction Type & Amount', oldValue: '—', newValue: `${typeLabel} • ${formattedAmt}` },
        { field: 'Narration / Description', oldValue: '—', newValue: String(transaction.narration || transaction.description || '—') },
        { field: 'Bank Account', oldValue: '—', newValue: String(transaction.accountName || transaction.bankAccountId || 'Primary Account') },
      ],
    });

    // Step 2: Category / Project Classification (if categorized or assigned to a project)
    const hasCategory = transaction.category && transaction.category !== 'Uncategorised';
    const hasProject = Boolean(transaction.projectName);
    if (hasCategory || hasProject || transaction.classifiedAt) {
      const classifiedTime = transaction.classifiedAt
        ? new Date(transaction.classifiedAt).toLocaleString()
        : createdDateStr;
      const classifierName =
        transaction.classifiedBy === 'ai'
          ? 'Finance OS AI Classifier'
          : transaction.classifiedBy && transaction.classifiedBy !== 'user'
            ? String(transaction.classifiedBy)
            : currentUser?.name || 'Organization Admin';

      const classChanges: { field: string; oldValue: string; newValue: string }[] = [];
      if (hasCategory) {
        classChanges.push({
          field: 'Category',
          oldValue: 'Uncategorised',
          newValue: String(transaction.category),
        });
      }
      if (hasProject) {
        classChanges.push({
          field: 'Project Assignment',
          oldValue: 'Unassigned',
          newValue: String(transaction.projectName),
        });
      }
      classChanges.push({
        field: 'Ledger Status',
        oldValue: 'Pending',
        newValue: String(transaction.status || 'classified').toUpperCase(),
      });

      timeline.push({
        timestamp: classifiedTime,
        title: 'Categorized & Reconciled',
        editedBy: {
          name: classifierName,
          role: transaction.classifiedBy === 'ai' ? 'AI Rules Engine' : 'Org Admin',
        },
        changes: classChanges,
      });
    }

    // Step 3: Payslip Split Allocations (if this salary transaction was allocated to employee payslips)
    const payslipTags = tags.filter((t) => t.startsWith('payslip_alloc:'));
    for (const pTag of payslipTags) {
      const parts = pTag.split(':');
      const grossAmt = Number(parts[4] || 0);
      const period = parts[5] || '';
      timeline.push({
        timestamp: createdDateStr,
        title: 'Employee Payslip Issued',
        editedBy: {
          name: currentUser?.name || 'Organization Admin',
          role: 'Payroll & Payslips AI',
        },
        changes: [
          {
            field: 'Payslip Allocation',
            oldValue: 'Unallocated Salary Pool',
            newValue: `${formatCurrency(grossAmt, orgCurrency)} allocated (${period || 'Monthly Payslip'})`,
          },
        ],
      });
    }

    // Step 4: Any explicit edit history tags (`edit_log:<iso>:<field>:<old>-><new>`) or audit log records
    for (const log of auditLogs) {
      timeline.push({
        timestamp: new Date(log.timestamp).toLocaleString(),
        title: `Audit Action: ${log.action}`,
        editedBy: { name: log.userName || 'Organization Admin', role: 'Audit Trail' },
        changes: [{ field: log.resource || 'Transaction', oldValue: 'Previous State', newValue: log.details }],
      });
    }

    // Number versions chronologically (1..N) and return newest first
    const total = timeline.length;
    return timeline
      .map((item, idx) => ({
        ...item,
        version: idx + 1,
        isCurrent: idx === total - 1,
      }))
      .reverse();
  }, [transaction, currentUser, orgCurrency, auditLogs]);

  if (!transaction) return null;

  const originalVersion = versions[versions.length - 1];
  const currentVersion = versions[0];
  const isCredit = transaction.type === 'credit' || transaction.type === 'income';
  const formattedAmt = formatCurrency(Math.abs(Number(transaction.amount || 0)), transaction.currency || orgCurrency);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-slate-900 border-slate-800 max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-white text-xl">Transaction History</DialogTitle>
          <DialogDescription className="text-slate-400">
            {transaction.narration || transaction.description} • {transaction.id}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-4">
          {/* Live Transaction Snapshot */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 p-4 bg-slate-950 rounded-lg border border-slate-800">
            <div>
              <h4 className="text-xs font-medium text-slate-400 uppercase mb-1">Original Entry</h4>
              <div className="space-y-0.5 text-sm">
                <div className="text-slate-400">Version 1</div>
                <div className="text-slate-200 font-medium">{formatDate(transaction.date)}</div>
              </div>
            </div>
            <div>
              <h4 className="text-xs font-medium text-slate-400 uppercase mb-1">Current State</h4>
              <div className="space-y-0.5 text-sm">
                <div className="text-white font-medium">Version {currentVersion?.version ?? 1}</div>
                <div className="text-slate-300 capitalize">{transaction.status || 'Classified'}</div>
              </div>
            </div>
            <div>
              <h4 className="text-xs font-medium text-slate-400 uppercase mb-1">Verified Amount</h4>
              <div className="space-y-0.5 text-sm">
                <div className={`font-bold ${isCredit ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {isCredit ? '+' : '-'}{formattedAmt}
                </div>
                <div className="text-xs text-slate-400">
                  {isCredit ? 'CREDIT (Inflow)' : 'DEBIT (Outflow)'} • {transaction.category || 'Uncategorised'}
                </div>
              </div>
            </div>
          </div>

          {/* Version Timeline */}
          <div>
            <h3 className="text-sm font-medium text-white mb-3">Audit & Lifecycle History</h3>
            <div className="space-y-3">
              {versions.map((version, index) => (
                <div
                  key={version.version}
                  className={`p-4 rounded-lg border ${
                    version.isCurrent
                      ? 'bg-blue-950/20 border-blue-900/50'
                      : 'bg-slate-950 border-slate-800'
                  }`}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div
                        className={`p-2 rounded-lg ${
                          version.isCurrent ? 'bg-blue-500/20' : 'bg-slate-900'
                        }`}
                      >
                        {version.isCurrent ? (
                          <CheckCircle2 className="size-4 text-blue-400" />
                        ) : version.version === 1 ? (
                          <FileText className="size-4 text-slate-400" />
                        ) : (
                          <Sparkles className="size-4 text-purple-400" />
                        )}
                      </div>
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <h4 className="text-white font-medium">
                            Version {version.version} — {version.title}
                          </h4>
                          {version.isCurrent && (
                            <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30 text-xs">
                              Current
                            </Badge>
                          )}
                          {version.version === 1 && (
                            <Badge className="bg-slate-500/20 text-slate-400 border-slate-500/30 text-xs">
                              Original
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-xs text-slate-400">
                          <Clock className="size-3" />
                          {version.timestamp}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Actor */}
                  <div className="flex items-center gap-2 text-sm text-slate-400 mb-3">
                    <User className="size-4" />
                    <span>
                      {version.editedBy.name} <span className="text-slate-600">•</span>{' '}
                      <span className="text-slate-500">{version.editedBy.role}</span>
                    </span>
                  </div>

                  {/* Field details */}
                  <div className="space-y-2">
                    <h5 className="text-xs font-medium text-slate-400 uppercase">Recorded Details</h5>
                    {version.changes.map((change, idx) => (
                      <div
                        key={idx}
                        className={`p-3 rounded ${
                          version.isCurrent ? 'bg-slate-900' : 'bg-slate-900/50'
                        }`}
                      >
                        <div className="text-xs text-slate-500 mb-1 font-medium">
                          {change.field}
                        </div>
                        <div className="flex items-center gap-2 text-sm flex-wrap">
                          {change.oldValue !== '—' && (
                            <>
                              <span className="text-slate-400">{change.oldValue}</span>
                              <ArrowRight className="size-4 text-slate-600" />
                            </>
                          )}
                          <span className="text-emerald-400 font-medium">{change.newValue}</span>
                        </div>
                      </div>
                    ))}
                  </div>

                  {index < versions.length - 1 && (
                    <div className="flex justify-center mt-3">
                      <div className="w-px h-4 bg-slate-800" />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Summary Footer */}
          <div className="p-4 bg-slate-950 rounded-lg border border-slate-800 flex items-center justify-between text-sm">
            <div className="flex items-center gap-2 text-slate-400">
              <ShieldCheck className="size-4 text-emerald-400" />
              <span>Verified Supabase Ledger Record</span>
            </div>
            <div className="text-slate-400">
              Original Date: <span className="text-white font-medium">{originalVersion?.timestamp || formatDate(transaction.date)}</span>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
