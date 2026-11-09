import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { AXIOM } from '../../../styles/axiom-tokens';
import { FileText, Download, Eye, DollarSign, TrendingUp, Calendar } from 'lucide-react';
import { employeeService } from '@/services/employeeService';
import { useService } from '@/hooks/useService';
import { useAuth } from '@/contexts/AuthContext';
import type { EmployeePayslip } from '@/services/types';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';

function downloadPayslip(p: EmployeePayslip, employeeName: string): void {
  const lines = [
    `Payslip — ${p.period}`,
    `Employee: ${employeeName}`,
    `Issue date: ${p.issueDate}`,
    `Status: ${p.status}`,
    '',
    `Gross pay: ${p.currency} ${p.gross.toLocaleString()}`,
    'Deductions:',
    ...(p.deductions || []).map((d: any) => `  - ${d.name || d.label || 'Deduction'}: ${p.currency} ${Number(d.amount || 0).toLocaleString()}`),
    `Net pay: ${p.currency} ${p.net.toLocaleString()}`,
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `payslip-${p.period.replace(/\s+/g, '-')}.txt`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function MyPayslips() {
  const { user, currentOrganization } = useAuth();
  const orgId = currentOrganization?.id || '';
  const userId = user?.id ?? '';

  const { data: rows, loading, error } = useService(
    () => (orgId && userId ? employeeService.getPayslips(orgId, userId) : Promise.resolve({ success: true, data: [] })),
    [orgId, userId],
  );

  const [viewingId, setViewingId] = useState<string | null>(null);
  const viewingPayslip = (rows ?? []).find(p => p.id === viewingId) ?? null;

  const payslips = useMemo(() => {
    const list = rows ?? [];
    return list.map(p => ({
      id: p.id,
      period: p.period,
      date: p.issueDate,
      gross: p.gross,
      deductions: (p.deductions || []).reduce((s, d: any) => s + Number(d?.amount || 0), 0),
      net: p.net,
      status: p.status,
    }));
  }, [rows]);

  const ytdGross = payslips.reduce((s, p) => s + p.gross, 0);
  const ytdNet = payslips.reduce((s, p) => s + p.net, 0);

  return (
    <div className="p-8 space-y-8" style={{ background: AXIOM.backgrounds.main, minHeight: '100%' }}>
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}>
        <h1 className="text-4xl font-bold mb-2" style={AXIOM.text.titleStyle as any}>Payslips</h1>
        <p className="text-slate-400 font-mono">View and download your salary statements</p>
      </motion.div>

      {error && (
        <div
          className="rounded-xl px-4 py-3 text-amber-200 text-sm font-mono border border-amber-500/30"
          style={{ background: 'rgba(245, 158, 11, 0.08)' }}
        >
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {[
          { label: 'LAST NET PAY', value: `$${(payslips[0]?.net ?? 0).toLocaleString()}`, sub: payslips[0]?.period || 'N/A', color: 'green', icon: DollarSign },
          { label: 'YTD GROSS', value: `$${ytdGross.toLocaleString()}`, sub: `${payslips.length} payslips`, color: 'blue', icon: TrendingUp },
          { label: 'YTD NET', value: `$${ytdNet.toLocaleString()}`, sub: 'After deductions', color: 'purple', icon: FileText },
        ].map((item, i) => (
          <motion.div
            key={item.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 + i * 0.05 }}
            className="rounded-2xl p-6 relative overflow-hidden"
            style={{
              background: AXIOM.backgrounds.chartContainer,
              border: AXIOM.borders[item.color as keyof typeof AXIOM.borders],
              boxShadow: AXIOM.shadows[item.color as keyof typeof AXIOM.shadows],
            }}
          >
            <div className="flex items-start justify-between relative z-10">
              <div>
                <p className="text-xs text-slate-400 font-mono mb-2">{item.label}</p>
                <p className="text-3xl font-bold text-white mb-1">{item.value}</p>
                <p className="text-sm text-slate-400 font-mono">{item.sub}</p>
              </div>
              <div className="size-12 rounded-xl flex items-center justify-center" style={{
                background: AXIOM.iconBoxes[item.color as keyof typeof AXIOM.iconBoxes],
              }}>
                <item.icon className="size-6 text-white" />
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.25 }}
        className="rounded-2xl overflow-hidden"
        style={{ ...AXIOM.containers.list, borderRadius: '1rem' }}
      >
        <div className="p-6 pb-4 flex items-center justify-between">
          <h3 className="text-white font-bold flex items-center gap-2">
            <Calendar className="size-5 text-blue-400" />
            Pay History
          </h3>
        </div>

        <div className="divide-y" style={{ borderColor: 'rgba(148, 163, 184, 0.1)' }}>
          {rows === null && loading && (
            <div className="p-12 text-center text-slate-400 font-mono text-sm">Loading payslips…</div>
          )}
          {error && (
            <div className="p-12 text-center text-slate-400 font-mono text-sm">Could not load payslips.</div>
          )}
          {!loading && !error && payslips.length === 0 && (
            <div className="p-12 text-center text-slate-400 font-mono text-sm">No payslips on file yet.</div>
          )}
          {payslips.map((payslip, i) => (
            <motion.div
              key={payslip.id}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.3 + i * 0.05 }}
              className="flex items-center gap-6 px-6 py-5 hover:bg-white/5 transition-colors"
            >
              <div className="size-12 rounded-xl flex items-center justify-center" style={{
                background: 'rgba(59, 130, 246, 0.15)',
                border: '1px solid rgba(59, 130, 246, 0.2)',
              }}>
                <FileText className="size-6 text-blue-400" />
              </div>

              <div className="flex-1">
                <p className="text-white font-medium">{payslip.period}</p>
                <p className="text-xs text-slate-400 font-mono mt-0.5">Paid: {payslip.date}</p>
              </div>

              <div className="grid grid-cols-3 gap-8 text-right">
                <div>
                  <p className="text-xs text-slate-400 font-mono">Gross</p>
                  <p className="text-sm text-white font-mono">${payslip.gross.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-400 font-mono">Deductions</p>
                  <p className="text-sm text-red-400 font-mono">-${payslip.deductions.toLocaleString()}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-400 font-mono">Net Pay</p>
                  <p className="text-sm text-green-400 font-bold font-mono">${payslip.net.toLocaleString()}</p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setViewingId(payslip.id)}
                  className="p-2 rounded-lg hover:bg-white/10 transition-colors"
                  title="View"
                >
                  <Eye className="size-4 text-blue-400" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const full = (rows ?? []).find(p => p.id === payslip.id);
                    if (full) downloadPayslip(full, user?.name ?? 'Employee');
                  }}
                  className="p-2 rounded-lg hover:bg-white/10 transition-colors"
                  title="Download"
                >
                  <Download className="size-4 text-slate-400" />
                </button>
              </div>
            </motion.div>
          ))}
        </div>
      </motion.div>

      <Dialog open={viewingPayslip != null} onOpenChange={(open) => { if (!open) setViewingId(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{viewingPayslip?.period}</DialogTitle>
            <DialogDescription>Issued {viewingPayslip?.issueDate} · {viewingPayslip?.status}</DialogDescription>
          </DialogHeader>
          {viewingPayslip && (
            <div className="space-y-3 py-2 font-mono text-sm">
              <div className="flex justify-between text-white">
                <span>Gross pay</span>
                <span>{viewingPayslip.currency} {viewingPayslip.gross.toLocaleString()}</span>
              </div>
              <div className="space-y-1 border-t border-white/10 pt-2">
                {(viewingPayslip.deductions || []).length === 0 ? (
                  <div className="flex justify-between text-slate-400">
                    <span>No deductions</span>
                    <span>{viewingPayslip.currency} 0</span>
                  </div>
                ) : (
                  (viewingPayslip.deductions || []).map((d: any, idx: number) => (
                    <div key={d.name || d.label || idx} className="flex justify-between text-red-400">
                      <span>{d.name || d.label || 'Deduction'}</span>
                      <span>-{viewingPayslip.currency} {Number(d.amount || 0).toLocaleString()}</span>
                    </div>
                  ))
                )}
              </div>
              <div className="flex justify-between border-t border-white/10 pt-2 font-bold text-green-400">
                <span>Net pay</span>
                <span>{viewingPayslip.currency} {viewingPayslip.net.toLocaleString()}</span>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
