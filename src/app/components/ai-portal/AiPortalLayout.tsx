import { ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '../ui/button';
import { AXIOM } from '../../../styles/axiom-tokens';
import {
  Brain, Cpu, Radio, Shield, LogOut, User,
  Activity, ArrowLeft, CheckCircle2, Lock,
  ChevronRight, Building2, Zap, LayoutDashboard
} from 'lucide-react';
import { cn } from '../ui/utils';

export type AiPortalView = 'telemetry' | 'tenants' | 'gateway' | 'quality' | 'privacy';

interface AiPortalLayoutProps {
  children: ReactNode;
  currentView: AiPortalView;
  onViewChange: (view: AiPortalView) => void;
}

export function AiPortalLayout({ children, currentView, onViewChange }: AiPortalLayoutProps) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const navItems = [
    { id: 'telemetry' as AiPortalView, label: 'Overview & Telemetry', icon: Activity },
    { id: 'tenants' as AiPortalView, label: 'Tenant Quotas & Margins', icon: Building2 },
    { id: 'gateway' as AiPortalView, label: 'Model Gateway & Failover', icon: Radio },
    { id: 'quality' as AiPortalView, label: 'Classification Quality (§11)', icon: CheckCircle2 },
    { id: 'privacy' as AiPortalView, label: 'Privacy & Security Vault', icon: Lock },
  ];

  return (
    <div className="size-full flex flex-col relative overflow-hidden" style={{ background: AXIOM.backgrounds.main }}>
      {/* Background Grid */}
      <div className="absolute inset-0 opacity-5 pointer-events-none" style={{
        backgroundImage: `
          linear-gradient(rgba(236, 72, 153, 0.1) 1px, transparent 1px),
          linear-gradient(90deg, rgba(236, 72, 153, 0.1) 1px, transparent 1px)
        `,
        backgroundSize: '50px 50px'
      }} />

      {/* Radial Pink/Purple AI Overlay */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[900px] h-[400px] rounded-full pointer-events-none" style={{
        background: 'radial-gradient(ellipse at center, rgba(236, 72, 153, 0.08), rgba(168, 85, 247, 0.05), transparent 70%)'
      }} />

      {/* Top Header Bar */}
      <div className="h-20 backdrop-blur-xl flex items-center justify-between px-8 shrink-0 relative z-20" style={{
        background: AXIOM.backgrounds.topBar,
        borderBottom: '1px solid rgba(236, 72, 153, 0.25)',
      }}>
        {/* Glowing Top Border */}
        <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-pink-500 to-transparent" />

        <div className="flex items-center gap-4">
          <div className="relative">
            <div className="size-12 rounded-xl bg-gradient-to-br from-pink-500 via-purple-600 to-indigo-600 flex items-center justify-center relative shadow-lg shadow-pink-500/20">
              <Brain className="size-6 text-white" />
              <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-pink-500 to-purple-600 blur-lg opacity-50 animate-pulse" />
            </div>
          </div>

          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold bg-gradient-to-r from-pink-400 via-rose-300 to-purple-400 bg-clip-text text-transparent">
                Finance OS — AI Command Portal
              </h1>
              <span className="text-[10px] px-2 py-0.5 rounded font-mono bg-pink-500/20 text-pink-300 border border-pink-500/30">
                STANDALONE 4TH PORTAL
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div className="size-2 rounded-full bg-emerald-400 shadow-lg shadow-emerald-400/50" />
              <p className="text-xs text-pink-300/80 font-mono">Super Admin AI Control Tower · Gemini Primary Active</p>
            </div>
          </div>
        </div>
        
        <div className="flex items-center gap-4">
          {/* Quick link to General Platform Console */}
          <Button
            onClick={() => navigate('/platform')}
            className="bg-slate-900/60 hover:bg-slate-800 text-slate-300 border border-slate-700/60 text-xs font-mono flex items-center gap-2"
          >
            <ArrowLeft className="size-3.5" />
            <span>Platform Console</span>
          </Button>

          {/* User Profile Badge */}
          <div className="flex items-center gap-3 px-4 py-2 backdrop-blur-xl rounded-xl" style={{
            background: 'rgba(0, 0, 0, 0.3)',
            border: '1px solid rgba(236, 72, 153, 0.25)',
          }}>
            <User className="size-4 text-pink-400" />
            <div>
              <p className="text-sm text-white font-medium">{user?.name || 'Platform Administrator'}</p>
              <div className="flex items-center gap-2">
                <p className="text-xs text-pink-300/70 font-mono">{user?.email}</p>
                <span className="text-[10px] px-1.5 py-0.5 rounded text-pink-300 font-mono" style={{
                  background: 'rgba(236, 72, 153, 0.15)',
                  border: '1px solid rgba(236, 72, 153, 0.3)',
                }}>
                  {user?.role === 'platform_admin' ? 'PLATFORM ADMIN' : 'PLATFORM MGR'}
                </span>
              </div>
            </div>
          </div>

          <Button
            onClick={logout}
            className="bg-gradient-to-r from-red-600 to-red-700 hover:from-red-700 hover:to-red-800 text-white font-medium px-5 text-sm"
          >
            <LogOut className="size-4 mr-1.5" />
            Logout
          </Button>
        </div>
      </div>

      {/* Main Content Area with Dedicated Sidebar */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Dedicated AI Portal Sidebar */}
        <div className="w-72 backdrop-blur-xl flex flex-col shrink-0 relative" style={{
          background: 'rgba(15, 23, 42, 0.65)',
          borderRight: '1px solid rgba(236, 72, 153, 0.2)',
        }}>
          {/* Glowing Edge */}
          <div className="absolute top-0 bottom-0 right-0 w-px bg-gradient-to-b from-transparent via-pink-500/30 to-transparent" />

          {/* AI Gateway Status Card */}
          <div className="p-4" style={{ borderBottom: '1px solid rgba(236, 72, 153, 0.15)' }}>
            <div className="p-3 rounded-lg" style={{
              background: 'rgba(0, 0, 0, 0.35)',
              border: '1px solid rgba(236, 72, 153, 0.25)',
            }}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-pink-400 font-mono">AI GATEWAY STATUS</span>
                <Radio className="size-3 text-emerald-400 animate-pulse" />
              </div>
              <div className="flex items-center gap-2">
                <Activity className="size-3 text-emerald-400" />
                <span className="text-xs text-emerald-400 font-mono">All Systems Operational</span>
              </div>
              <div className="mt-2 pt-2 border-t border-pink-500/10 flex items-center justify-between text-[10px] font-mono text-slate-400">
                <span>Failover Chain:</span>
                <span className="text-pink-300">Gemini → OpenAI</span>
              </div>
            </div>
          </div>

          {/* Navigation Items */}
          <nav className="flex-1 p-4 space-y-1.5 overflow-auto">
            {navItems.map((item) => (
              <button
                key={item.id}
                onClick={() => onViewChange(item.id)}
                className={cn(
                  'w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm transition-all duration-200 cursor-pointer',
                  currentView === item.id
                    ? 'text-pink-200 font-medium'
                    : 'text-slate-400 hover:text-white hover:bg-white/5 border border-transparent'
                )}
                style={currentView === item.id ? {
                  background: 'linear-gradient(135deg, rgba(236, 72, 153, 0.2), rgba(168, 85, 247, 0.15))',
                  border: '1px solid rgba(236, 72, 153, 0.4)',
                  boxShadow: '0 0 20px rgba(236, 72, 153, 0.15)',
                } : undefined}
              >
                <item.icon className="size-4 shrink-0 text-pink-400" />
                <span className="flex-1 text-left font-mono text-xs">{item.label}</span>
                {currentView === item.id && (
                  <ChevronRight className="size-4 text-pink-400" />
                )}
              </button>
            ))}
          </nav>

          {/* Footer Security / Air Gap Badge */}
          <div className="p-4" style={{ borderTop: '1px solid rgba(236, 72, 153, 0.15)' }}>
            <div className="p-3 rounded-lg" style={{
              background: 'linear-gradient(135deg, rgba(236, 72, 153, 0.1), rgba(168, 85, 247, 0.1))',
              border: '1px solid rgba(236, 72, 153, 0.25)',
            }}>
              <div className="flex items-center gap-2 mb-1">
                <Shield className="size-4 text-pink-400" />
                <span className="text-xs text-pink-400 font-mono">AIR-GAP SECURITY</span>
              </div>
              <p className="text-[11px] text-slate-400 font-mono">Zero Customer Data In Training</p>
            </div>
          </div>
        </div>

        {/* Dedicated Main Content Workspace */}
        <div className="flex-1 overflow-auto relative bg-black/40">
          {children}
        </div>
      </div>
    </div>
  );
}

