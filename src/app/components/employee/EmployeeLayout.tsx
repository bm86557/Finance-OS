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
  ChevronRight,
  Settings,
  HelpCircle
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
      <div className="h-20 backdrop-blur-xl flex items-center justify-between px-8 shrink-0 relative z-20" style={{
        background: AXIOM.backgrounds.topBar,
        borderBottom: '1px solid rgba(59, 130, 246, 0.2)',
      }}>
        {/* Glowing Top Border */}
        <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-blue-500 to-transparent" />

        <div className="flex items-center gap-4">
          {/* Logo */}
          <div className="relative">
            <div className="size-12 rounded-xl bg-gradient-to-br from-blue-500 via-blue-600 to-purple-600 flex items-center justify-center relative">
              <Cpu className="size-6 text-white" />
              <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 blur-lg opacity-50" />
            </div>
          </div>

          <div>
            <h1 className="text-xl font-bold bg-gradient-to-r from-blue-400 via-blue-300 to-purple-400 bg-clip-text text-transparent">
              Finance OS
            </h1>
            <div className="flex items-center gap-2">
              <div className="size-2 rounded-full bg-blue-400 shadow-lg shadow-blue-400/50" />
              <p className="text-xs text-blue-400/70 font-mono">Employee Portal</p>
            </div>
          </div>
        </div>
        
        {/* User Info and Logout */}
        <div className="flex items-center gap-4">
          <NotificationCenter />
          
          <div className="flex items-center gap-3 px-4 py-2 backdrop-blur-xl rounded-xl" style={{
            background: 'rgba(0, 0, 0, 0.3)',
            border: '1px solid rgba(59, 130, 246, 0.2)',
          }}>
            <User className="size-4 text-blue-400" />
            <div>
              <p className="text-sm text-white font-medium">{user?.name}</p>
              <div className="flex items-center gap-2">
                <p className="text-xs text-blue-400/70 font-mono">{user?.email}</p>
                <span className="text-xs px-1.5 py-0.5 rounded text-blue-300 font-mono" style={{
                  background: 'rgba(59, 130, 246, 0.15)',
                  border: '1px solid rgba(59, 130, 246, 0.3)',
                }}>EMPLOYEE</span>
              </div>
            </div>
          </div>
          
          <Button
            onClick={logout}
            className="bg-gradient-to-r from-red-600 to-red-700 hover:from-red-700 hover:to-red-800 text-white font-medium px-6"
          >
            <LogOut className="size-4 mr-2" />
            Logout
          </Button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Sidebar */}
        <div className="w-72 backdrop-blur-xl flex flex-col shrink-0 relative" style={{
          background: 'rgba(15, 23, 42, 0.5)',
          borderRight: '1px solid rgba(59, 130, 246, 0.15)',
        }}>
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
                  onClick={() => onViewChange(item.id)}
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

          {/* Footer - Interactive AI Assistant */}
          <div className="p-4" style={{ borderTop: '1px solid rgba(59, 130, 246, 0.15)' }}>
            <button
              type="button"
              onClick={() => setIsAIAssistantOpen(true)}
              className="w-full p-3 rounded-lg text-left transition-all duration-200 group cursor-pointer hover:border-blue-400/60"
              style={{
                background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.12), rgba(139, 92, 246, 0.12))',
                border: '1px solid rgba(59, 130, 246, 0.3)',
                boxShadow: '0 0 15px rgba(59, 130, 246, 0.08)',
              }}
            >
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-2">
                  <Brain className="size-4 text-blue-400 group-hover:scale-110 transition-transform" />
                  <span className="text-xs text-blue-400 font-mono font-bold tracking-wide">AI ASSISTANT</span>
                </div>
                <span className="size-2 rounded-full bg-green-400 animate-pulse" />
              </div>
              <div className="flex items-center justify-between">
                <p className="text-xs text-slate-300 font-mono">Ask me anything</p>
                <ChevronRight className="size-3.5 text-blue-400 opacity-60 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" />
              </div>
            </button>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 overflow-auto relative">
          {children}

          {/* Floating AI Assistant Action Trigger */}
          <button
            type="button"
            onClick={() => setIsAIAssistantOpen(true)}
            className="fixed bottom-6 right-6 size-12 rounded-full flex items-center justify-center cursor-pointer shadow-2xl transition-all duration-200 hover:scale-105 z-40 group"
            style={{
              background: 'linear-gradient(135deg, #7c3aed 0%, #3b82f6 100%)',
              border: '1px solid rgba(255, 255, 255, 0.2)',
              boxShadow: '0 10px 30px -5px rgba(124, 58, 237, 0.5)',
            }}
            title="Open Employee AI Advisor"
          >
            <Brain className="size-6 text-white group-hover:rotate-12 transition-transform" />
            <span className="absolute -top-1 -right-1 size-3 bg-green-400 rounded-full border-2 border-slate-900" />
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