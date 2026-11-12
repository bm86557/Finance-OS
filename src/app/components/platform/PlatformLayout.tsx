import { ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '../ui/button';
import { AXIOM } from '../../../styles/axiom-tokens';
import { 
  Building2, LayoutDashboard, CreditCard, Settings, LogOut, User, 
  Cpu, Radio, Brain, ChevronRight, Shield, Activity, ArrowRight
} from 'lucide-react';
import { cn } from '../ui/utils';

interface PlatformLayoutProps {
  children: ReactNode;
  currentView: string;
  onViewChange: (view: string) => void;
}

export function PlatformLayout({ children, currentView, onViewChange }: PlatformLayoutProps) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const navItems = [
    { id: 'home', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'organizations', label: 'Organizations', icon: Building2 },
    { id: 'plans', label: 'Plans & Billing', icon: CreditCard },
    { id: 'settings', label: 'Platform Settings', icon: Settings },
  ];

  return (
    <div className="size-full flex flex-col relative overflow-hidden" style={{ background: AXIOM.backgrounds.main }}>
      {/* Background Grid */}
      <div className="absolute inset-0 opacity-5 pointer-events-none" style={{
        backgroundImage: `
          linear-gradient(rgba(168, 85, 247, 0.1) 1px, transparent 1px),
          linear-gradient(90deg, rgba(168, 85, 247, 0.1) 1px, transparent 1px)
        `,
        backgroundSize: '50px 50px'
      }} />

      {/* Radial purple overlay */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] rounded-full pointer-events-none" style={{
        background: 'radial-gradient(ellipse at center, rgba(168, 85, 247, 0.06), transparent 70%)'
      }} />

      {/* Top Header Bar */}
      <div className="h-20 backdrop-blur-xl flex items-center justify-between px-8 shrink-0 relative z-20" style={{
        background: AXIOM.backgrounds.topBar,
        borderBottom: '1px solid rgba(168, 85, 247, 0.2)',
      }}>
        {/* Glowing Top Border */}
        <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-purple-500 to-transparent" />

        <div className="flex items-center gap-4">
          <div className="relative">
            <div className="size-12 rounded-xl bg-gradient-to-br from-purple-500 via-purple-600 to-pink-600 flex items-center justify-center relative">
              <Shield className="size-6 text-white" />
              <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-purple-500 to-pink-600 blur-lg opacity-50" />
            </div>
          </div>

          <div>
            <h1 className="text-xl font-bold bg-gradient-to-r from-purple-400 via-pink-400 to-rose-400 bg-clip-text text-transparent">
              Finance OS - Platform Console
            </h1>
            <div className="flex items-center gap-2">
              <div className="size-2 rounded-full bg-purple-400 shadow-lg shadow-purple-400/50" />
              <p className="text-xs text-purple-400/70 font-mono">Super Admin Dashboard</p>
            </div>
          </div>
        </div>
        
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3 px-4 py-2 backdrop-blur-xl rounded-xl" style={{
            background: 'rgba(0, 0, 0, 0.3)',
            border: '1px solid rgba(168, 85, 247, 0.2)',
          }}>
            <User className="size-4 text-purple-400" />
            <div>
              <p className="text-sm text-white font-medium">{user?.name}</p>
              <div className="flex items-center gap-2">
                <p className="text-xs text-purple-400/70 font-mono">{user?.email}</p>
                <span className="text-xs px-1.5 py-0.5 rounded text-purple-300 font-mono" style={{
                  background: 'rgba(168, 85, 247, 0.15)',
                  border: '1px solid rgba(168, 85, 247, 0.3)',
                }}>
                  {user?.role === 'platform_admin' ? 'PLATFORM ADMIN' : 'PLATFORM MGR'}
                </span>
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
          borderRight: '1px solid rgba(168, 85, 247, 0.15)',
        }}>
          {/* Glowing Edge */}
          <div className="absolute top-0 bottom-0 right-0 w-px bg-gradient-to-b from-transparent via-purple-500/30 to-transparent" />

          {/* Status Indicator */}
          <div className="p-4" style={{ borderBottom: '1px solid rgba(168, 85, 247, 0.15)' }}>
            <div className="p-3 rounded-lg" style={{
              background: 'rgba(0, 0, 0, 0.3)',
              border: '1px solid rgba(168, 85, 247, 0.2)',
            }}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-purple-400 font-mono">PLATFORM STATUS</span>
                <Radio className="size-3 text-green-400" />
              </div>
              <div className="flex items-center gap-2">
                <Activity className="size-3 text-green-400" />
                <span className="text-xs text-green-400 font-mono">All Systems Operational</span>
              </div>
            </div>
          </div>

          <nav className="flex-1 p-4 space-y-1 overflow-auto">
            {navItems.map((item) => (
              <button
                key={item.id}
                onClick={() => onViewChange(item.id)}
                className={cn(
                  'w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm transition-all duration-200 cursor-pointer',
                  currentView === item.id
                    ? 'text-purple-300 font-medium'
                    : 'text-slate-400 hover:text-white hover:bg-white/5 border border-transparent'
                )}
                style={currentView === item.id ? {
                  background: 'linear-gradient(135deg, rgba(168, 85, 247, 0.15), rgba(236, 72, 153, 0.1))',
                  border: '1px solid rgba(168, 85, 247, 0.3)',
                  boxShadow: '0 0 20px rgba(168, 85, 247, 0.1)',
                } : undefined}
              >
                <item.icon className="size-4" />
                <span className="flex-1 text-left font-mono">{item.label}</span>
                {currentView === item.id && (
                  <ChevronRight className="size-4 text-purple-400" />
                )}
              </button>
            ))}
          </nav>

          {/* Footer - Standalone AI Portal Launcher */}
          <div className="p-4" style={{ borderTop: '1px solid rgba(168, 85, 247, 0.15)' }}>
            <button
              onClick={() => navigate('/ai-portal')}
              className="w-full p-3 rounded-lg text-left transition-all hover:border-pink-500/50 group cursor-pointer"
              style={{
                background: 'linear-gradient(135deg, rgba(236, 72, 153, 0.15), rgba(168, 85, 247, 0.15))',
                border: '1px solid rgba(236, 72, 153, 0.3)',
              }}
            >
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <Brain className="size-4 text-pink-400 group-hover:rotate-12 transition-transform" />
                  <span className="text-xs text-pink-300 font-mono font-bold">AI COMMAND PORTAL</span>
                </div>
                <ArrowRight className="size-3.5 text-pink-400 group-hover:translate-x-1 transition-transform" />
              </div>
              <p className="text-[10px] text-slate-400 font-mono">Launch Standalone 4th Portal</p>
            </button>
          </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 overflow-auto relative">
          {children}
        </div>
      </div>
    </div>
  );
}