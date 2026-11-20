import { ReactNode, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '../ui/button';
import { NotificationCenter } from '../notifications/NotificationCenter';
import { AXIOM } from '../../../styles/axiom-tokens';
import { EmployeeAIAssistantModal } from './EmployeeAIAssistantModal';
import { 
  LayoutDashboard, 
  Receipt, 
  Briefcase, 
  Clock, 
  FileText, 
  Users, 
  Megaphone,
  DollarSign,
  LogOut,
  User,
  Cpu,
  Radio,
  Brain,
  Sparkles,
  ChevronRight,
  Settings,
  HelpCircle,
  Menu,
  X
} from 'lucide-react';
import { cn } from '../ui/utils';
import type { EmployeeView } from './EmployeeWorkspace';

interface EmployeeLayoutProps {
  children: ReactNode;
  currentView: EmployeeView;
  onViewChange: (view: EmployeeView) => void;
}

export function EmployeeLayout({ children, currentView, onViewChange }: EmployeeLayoutProps) {
  const { user, logout, userRole, currentOrganization } = useAuth();
  const [isAIAssistantOpen, setIsAIAssistantOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const selectView = (view: EmployeeView) => {
    onViewChange(view);
    setMobileNavOpen(false);
  };

  const navItems: { id: EmployeeView; label: string; icon: any; section?: string }[] = [
    { id: 'dashboard', label: 'My Dashboard', icon: LayoutDashboard, section: 'OVERVIEW' },
    { id: 'expenses', label: 'My Expenses', icon: DollarSign, section: 'FINANCE' },
    { id: 'timesheet', label: 'My Timesheet', icon: Clock },
    { id: 'projects', label: 'My Projects', icon: Briefcase },
    { id: 'payslips', label: 'Payslips', icon: FileText, section: 'HR & TEAM' },
    { id: 'team', label: 'Team Directory', icon: Users },
    { id: 'announcements', label: 'Announcements', icon: Megaphone },
    { id: 'help', label: 'Help & Support', icon: HelpCircle, section: 'SETTINGS' },
    { id: 'settings', label: 'My Settings', icon: Settings },
  ];

  return (
    <div className="size-full flex flex-col relative overflow-hidden" style={{ background: AXIOM.backgrounds.main }}>
      {/* Background Grid */}
      <div className="absolute inset-0 opacity-5 pointer-events-none" style={{
        backgroundImage: `
          linear-gradient(rgba(59, 130, 246, 0.1) 1px, transparent 1px),
          linear-gradient(90deg, rgba(59, 130, 246, 0.1) 1px, transparent 1px)
        `,
        backgroundSize: '50px 50px'
      }} />

      {/* Radial blue overlay */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] rounded-full pointer-events-none" style={{
        background: 'radial-gradient(ellipse at center, rgba(59, 130, 246, 0.08), transparent 70%)'
      }} />

      {/* Top Header Bar */}
      <div className="min-h-16 sm:min-h-[4.5rem] backdrop-blur-xl flex items-center justify-between gap-2 px-3 sm:px-5 lg:px-6 py-2 shrink-0 relative z-30" style={{
        background: AXIOM.backgrounds.topBar,
        borderBottom: '1px solid rgba(59, 130, 246, 0.2)',
      }}>
        {/* Glowing Top Border */}
        <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-blue-500 to-transparent" />

        <div className="flex items-center gap-2.5 sm:gap-4 min-w-0">
          <button
            type="button"
            aria-label={mobileNavOpen ? 'Close menu' : 'Open menu'}
            onClick={() => setMobileNavOpen(o => !o)}
            className="lg:hidden shrink-0 p-2 rounded-xl border border-blue-500/30 bg-slate-950/60 text-blue-300"
          >
            {mobileNavOpen ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
          {/* Logo */}
          <div className="relative shrink-0">
            <div className="size-10 sm:size-11 rounded-xl bg-gradient-to-br from-blue-500 via-blue-600 to-purple-600 flex items-center justify-center relative">
              <Cpu className="size-5 sm:size-6 text-white" />
              <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 blur-lg opacity-50" />
            </div>
          </div>

          <div className="min-w-0">
            <h1 className="text-base sm:text-xl font-bold bg-gradient-to-r from-blue-400 via-blue-300 to-purple-400 bg-clip-text text-transparent truncate">
              Finance OS
            </h1>
            <div className="hidden sm:flex items-center gap-2">
              <div className="size-2 rounded-full bg-blue-400 shadow-lg shadow-blue-400/50" />
              <p className="text-xs text-blue-400/70 font-mono">Employee Portal</p>
            </div>
          </div>
        </div>
        
        {/* User Info and Logout */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <NotificationCenter />
          
          <div className="hidden sm:flex items-center gap-2.5 px-3 py-1.5 max-w-[190px] xl:max-w-[260px] backdrop-blur-xl rounded-xl min-w-0" style={{
            background: 'rgba(0, 0, 0, 0.3)',
            border: '1px solid rgba(59, 130, 246, 0.2)',
          }}>
            <User className="size-4 text-blue-400 shrink-0" />
            <div className="min-w-0">
              <p className="text-xs sm:text-sm text-white font-medium truncate">{user?.name}</p>
              <div className="flex items-center gap-1.5 min-w-0">
                <p className="text-[11px] text-blue-400/70 font-mono truncate">{user?.email}</p>
                <span className="hidden xl:inline text-[10px] px-1.5 py-0.5 rounded text-blue-300 font-mono shrink-0" style={{
                  background: 'rgba(59, 130, 246, 0.15)',
                  border: '1px solid rgba(59, 130, 246, 0.3)',
                }}>EMPLOYEE</span>
              </div>
            </div>
          </div>
          
          <Button
            onClick={logout}
            title="Logout"
            className="bg-gradient-to-r from-red-600 to-red-700 hover:from-red-700 hover:to-red-800 text-white font-medium px-3 sm:px-5"
          >
            <LogOut className="size-4 sm:mr-2" />
            <span className="hidden sm:inline">Logout</span>
          </Button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden relative min-h-0">
        {mobileNavOpen && (
          <button
            type="button"
            aria-label="Close menu"
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
            onClick={() => setMobileNavOpen(false)}
          />
        )}

        {/* Sidebar */}
        <div
          className={cn(
            'w-64 lg:w-60 2xl:w-64 backdrop-blur-xl flex flex-col shrink-0 relative',
            'fixed z-50 top-16 sm:top-[4.5rem] bottom-0 left-0 lg:static lg:z-0 lg:top-auto lg:bottom-auto transition-transform duration-200 ease-out',
            mobileNavOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
          )}
          style={{
            background: 'rgba(15, 23, 42, 0.85)',
            borderRight: '1px solid rgba(59, 130, 246, 0.15)',
          }}
        >
          {/* Glowing Edge */}
          <div className="absolute top-0 bottom-0 right-0 w-px bg-gradient-to-b from-transparent via-blue-500/30 to-transparent" />

          {/* Status Indicator */}
          <div className="p-4" style={{ borderBottom: '1px solid rgba(59, 130, 246, 0.15)' }}>
            <div className="p-3 rounded-lg" style={{
              background: 'rgba(0, 0, 0, 0.3)',
              border: '1px solid rgba(59, 130, 246, 0.2)',
            }}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-blue-400 font-mono">EMPLOYEE PORTAL</span>
                <Radio className="size-3 text-green-400" />
              </div>
              <div className="h-1 bg-slate-800 rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-blue-500 to-green-500 w-full" />
              </div>
            </div>
          </div>

          <nav className="flex-1 p-4 space-y-1 overflow-auto">
            {navItems.map((item) => (
              <div key={item.id}>
                {item.section && (
                  <div className="px-4 pt-4 pb-2">
                    <span className="text-[10px] text-blue-400/50 font-mono tracking-widest">{item.section}</span>
                  </div>
                )}
                <button
                  onClick={() => selectView(item.id)}
                  className={cn(
                    'w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm transition-all duration-200 cursor-pointer',
                    currentView === item.id
                      ? 'text-blue-300 font-medium'
                      : 'text-slate-400 hover:text-white hover:bg-white/5 border border-transparent'
                  )}
                  style={currentView === item.id ? {
                    background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.15), rgba(139, 92, 246, 0.1))',
                    border: '1px solid rgba(59, 130, 246, 0.3)',
                    boxShadow: '0 0 20px rgba(59, 130, 246, 0.1)',
                  } : undefined}
                >
                  <item.icon className="size-4" />
                  <span className="flex-1 text-left font-mono">{item.label}</span>
                  {currentView === item.id && (
                    <ChevronRight className="size-4 text-blue-400" />
                  )}
                </button>
              </div>
            ))}
          </nav>
        </div>

        {/* Main Content */}
        <div className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden relative">
          {children}

          {/* Single Floating AI Assistant Action Trigger (Bottom-Right) */}
          <button
            type="button"
            onClick={() => setIsAIAssistantOpen(true)}
            className="fixed bottom-4 right-4 sm:bottom-6 sm:right-6 px-4 py-3 rounded-full flex items-center gap-2.5 cursor-pointer shadow-2xl transition-all duration-200 hover:scale-105 z-40 group"
            style={{
              background: 'linear-gradient(135deg, rgba(124, 58, 237, 0.95) 0%, rgba(59, 130, 246, 0.95) 100%)',
              border: '1px solid rgba(147, 197, 253, 0.4)',
              boxShadow: '0 12px 32px -6px rgba(99, 102, 241, 0.6), 0 0 20px rgba(59, 130, 246, 0.35)',
              backdropFilter: 'blur(12px)',
            }}
            title="Open AI Assistant"
          >
            <span className="relative flex items-center justify-center size-7 rounded-full bg-white/15 border border-white/20">
              <Brain className="size-4 text-white group-hover:scale-110 transition-transform" />
              <Sparkles className="size-2.5 text-cyan-200 absolute -top-0.5 -right-0.5" />
            </span>
            <span className="text-xs font-mono font-bold tracking-wide text-white pr-1">
              AI Assistant
            </span>
            <span className="size-2 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_8px_#34d399]" />
          </button>

          {/* Modal */}
          <EmployeeAIAssistantModal
            isOpen={isAIAssistantOpen}
            onClose={() => setIsAIAssistantOpen(false)}
            orgId={currentOrganization?.id || ''}
            userId={user?.id || ''}
            employeeName={user?.name || 'there'}
          />
        </div>
      </div>
    </div>
  );
}