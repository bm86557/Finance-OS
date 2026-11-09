import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router';
import { motion, AnimatePresence } from 'motion/react';
import { Mail, Check, X, Sparkles } from 'lucide-react';
import { EmployeeLayout } from './EmployeeLayout';
import { EmployeeDashboard } from './EmployeeDashboard';
import { MyExpenses } from './MyExpenses';
import { MyTimesheet } from './MyTimesheet';
import { MyProjects } from './MyProjects';
import { MyPayslips } from './MyPayslips';
import { TeamDirectory } from './TeamDirectory';
import { CompanyAnnouncements } from './CompanyAnnouncements';
import { EmployeeSettings, EmployeeHelp } from './EmployeeSettings';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';

export type EmployeeView = 
  | 'dashboard'
  | 'expenses'
  | 'timesheet'
  | 'projects'
  | 'payslips'
  | 'team'
  | 'announcements'
  | 'help'
  | 'settings';

function normalizeTabParam(raw: string | null): EmployeeView | null {
  if (!raw) return null;
  const lower = raw.toLowerCase().trim();
  if (lower === 'timesheets') return 'timesheet';
  if (
    lower === 'dashboard' ||
    lower === 'expenses' ||
    lower === 'timesheet' ||
    lower === 'projects' ||
    lower === 'payslips' ||
    lower === 'team' ||
    lower === 'announcements' ||
    lower === 'help' ||
    lower === 'settings'
  ) {
    return lower as EmployeeView;
  }
  return null;
}

export function EmployeeWorkspace() {
  const [searchParams, setSearchParams] = useSearchParams();
  const rawTab = searchParams.get('tab');
  const normalizedInitial = normalizeTabParam(rawTab);

  const [currentView, setCurrentView] = useState<EmployeeView>(normalizedInitial || 'dashboard');
  const { membership, currentOrganization, acceptInvite, declineInvite } = useAuth();
  const [isProcessing, setIsProcessing] = useState(false);

  // Sync tab if URL search param changes (e.g. notification deep-links)
  useEffect(() => {
    const nextTab = normalizeTabParam(rawTab);
    if (nextTab && nextTab !== currentView) {
      setCurrentView(nextTab);
    }
  }, [rawTab]);

  const handleSelectView = (view: EmployeeView) => {
    setCurrentView(view);
    setSearchParams(view === 'dashboard' ? {} : { tab: view });
  };

  const isPending = membership?.status === 'pending';

  const handleAccept = async () => {
    setIsProcessing(true);
    try {
      await acceptInvite();
      toast.success(`Welcome to the team! Your membership in ${currentOrganization?.name || 'this organization'} is now active.`);
    } catch {
      toast.error('Failed to accept invitation.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDecline = async () => {
    if (!window.confirm('Are you sure you want to decline this organization invite?')) return;
    setIsProcessing(true);
    try {
      await declineInvite();
      toast.info('Organization invitation declined.');
    } catch {
      toast.error('Failed to decline invitation.');
    } finally {
      setIsProcessing(false);
    }
  };

  const renderView = () => {
    switch (currentView) {
      case 'dashboard':
        return <EmployeeDashboard />;
      case 'expenses':
        return <MyExpenses />;
      case 'timesheet':
        return <MyTimesheet />;
      case 'projects':
        return <MyProjects />;
      case 'payslips':
        return <MyPayslips />;
      case 'team':
        return <TeamDirectory />;
      case 'announcements':
        return <CompanyAnnouncements />;
      case 'help':
        return <EmployeeHelp />;
      case 'settings':
        return <EmployeeSettings />;
      default:
        return <EmployeeDashboard />;
    }
  };

  return (
    <EmployeeLayout currentView={currentView} onViewChange={handleSelectView}>
      <AnimatePresence>
        {isPending && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="mb-6 p-4 rounded-xl bg-gradient-to-r from-emerald-500/20 via-teal-500/20 to-cyan-500/20 border border-emerald-500/40 backdrop-blur-md flex flex-col md:flex-row items-center justify-between gap-4 shadow-lg shadow-emerald-500/10"
          >
            <div className="flex items-center gap-3">
              <div className="size-10 rounded-xl bg-emerald-500/30 flex items-center justify-center text-emerald-300 shrink-0">
                <Sparkles className="size-5" />
              </div>
              <div>
                <p className="text-white text-sm font-semibold flex items-center gap-2">
                  <span>Organization Invitation</span>
                  <span className="px-2 py-0.5 rounded text-[11px] font-mono bg-amber-500/20 text-amber-300 border border-amber-500/30">
                    Awaiting your response
                  </span>
                </p>
                <p className="text-slate-300 text-xs mt-0.5">
                  You are invited to join <strong className="text-emerald-300">{currentOrganization?.name || 'this organization'}</strong> as <span className="capitalize">{membership?.role || 'team member'}</span>.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0 w-full md:w-auto">
              <button
                onClick={handleAccept}
                disabled={isProcessing}
                className="flex-1 md:flex-none px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold font-mono flex items-center justify-center gap-1.5 transition-all shadow-md shadow-emerald-500/30 disabled:opacity-50"
              >
                <Check className="size-3.5" />
                {isProcessing ? 'Processing...' : 'Accept Invitation'}
              </button>
              <button
                onClick={handleDecline}
                disabled={isProcessing}
                className="flex-1 md:flex-none px-4 py-2 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/30 text-xs font-bold font-mono flex items-center justify-center gap-1.5 transition-all disabled:opacity-50"
              >
                <X className="size-3.5" />
                Decline
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {renderView()}
    </EmployeeLayout>
  );
}
