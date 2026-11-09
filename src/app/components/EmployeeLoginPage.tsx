import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { motion } from 'motion/react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Users, Lock, Mail, ArrowLeft, Briefcase, Clock, DollarSign, Eye, EyeOff, CheckCircle2, AlertCircle } from 'lucide-react';
import { mockUsers, mockOrganizationMembers, mockOrganizations } from '@/data/mockDatabase';
import { useTheme } from '@/contexts/ThemeContext';
import { authService } from '@/services/authService';
import { SupabaseConnectionPanel } from './SupabaseConnectionPanel';
import type { PortalType } from '@/services/authSessionTypes';

interface EmployeeLoginPageProps {
  onLogin: (email: string, password: string, orgSlug?: string, portalType?: PortalType) => Promise<void>;
}

export function EmployeeLoginPage({ onLogin }: EmployeeLoginPageProps) {
  const { orgSlug } = useParams<{ orgSlug?: string }>();
  const [searchParams] = useSearchParams();
  const workspaceLabel = useMemo(() => {
    if (!orgSlug?.trim()) return null;
    const s = orgSlug.trim().toLowerCase();
    const o = mockOrganizations.find(x => (x.slug || '').toLowerCase() === s);
    return o?.name ?? orgSlug;
  }, [orgSlug]);

  const urlEmail = searchParams.get('email') || '';

  const [email, setEmail] = useState(urlEmail);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [error, setError] = useState('');
  const [infoMessage, setInfoMessage] = useState(
    searchParams.get('notice') === 'invite_only'
      ? 'Employee accounts are invite-only. Set your password using the activation link in your invitation email, then sign in below.'
      : ''
  );
  const [scanProgress, setScanProgress] = useState(0);
  const navigate = useNavigate();
  const { theme } = useTheme();

  useEffect(() => {
    if (isLoading && scanProgress < 100) {
      const timer = setTimeout(() => {
        setScanProgress(prev => Math.min(prev + 10, 100));
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isLoading, scanProgress]);

  const handleForgotPassword = async () => {
    if (!email.trim()) {
      setError('Please enter your employee email address first, then click "Forgot password?".');
      return;
    }
    setIsResetting(true);
    setError('');
    setInfoMessage('');
    try {
      const res = await authService.resetPassword(email.trim());
      if (res.success) {
        setInfoMessage('Password reset link sent! Please check your email inbox.');
      } else {
        setError(res.error || 'Failed to send password reset email.');
      }
    } catch {
      setError('Failed to send password reset request.');
    } finally {
      setIsResetting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setScanProgress(0);
    setError('');
    setInfoMessage('');

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setError('Please enter your employee email address.');
      setIsLoading(false);
      return;
    }

    try {
      // Check if email has received an organization invitation
      const inviteCheck = await authService.checkInviteStatus(trimmedEmail);
      if (!inviteCheck.isInvited) {
        setError('You are not invited by any organization, so you are not allowed to log in. Please contact your organization administrator to receive an invitation.');
        setIsLoading(false);
        return;
      }

      await onLogin(trimmedEmail, password, orgSlug, 'employee');
      navigate('/employee');
    } catch (err) {
      const rawMsg = err instanceof Error ? err.message : String(err || '');
      if (rawMsg.toLowerCase().includes('not invited') || rawMsg.toLowerCase().includes('no employee account')) {
        setError('You are not invited by any organization, so you are not allowed to log in. Please contact your organization administrator to receive an invitation.');
      } else if (rawMsg.toLowerCase().includes('invalid login credentials') || rawMsg.toLowerCase().includes('invalid email or password')) {
        const inviteCheck = await authService.checkInviteStatus(trimmedEmail);
        if (!inviteCheck.isInvited) {
          setError('You are not invited by any organization, so you are not allowed to log in. Please contact your organization administrator to receive an invitation.');
        } else {
          setError('Incorrect password. If you haven\'t set your password yet, please use the activation link in your invitation email.');
        }
      } else if (rawMsg) {
        setError(rawMsg);
      } else {
        setError('You are not invited by any organization, so you are not allowed to log in.');
      }
    } finally {
      setIsLoading(false);
      setScanProgress(0);
    }
  };


  const handleDemoLogin = async (demoEmail: string) => {
    setEmail(demoEmail);
    setPassword('demo');
    setIsLoading(true);
    setScanProgress(0);
    setError('');
    setInfoMessage('');

    try {
      await onLogin(demoEmail, 'demo', orgSlug, 'employee');
      navigate('/employee');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed or no employee account found.');
    } finally {
      setIsLoading(false);
      setScanProgress(0);
    }
  };

  // Filter employee users
  const employeeUsers = mockUsers.filter(u => {
    const membership = mockOrganizationMembers.find(m => m.userId === u.id && m.role === 'employee');
    return !!membership;
  });

  return (
    <div className={`min-h-screen ${theme === 'dark' ? 'bg-black' : 'bg-gradient-to-br from-slate-50 to-slate-100'} flex items-center justify-center p-4 relative overflow-hidden`}>
      {/* Animated Grid Background */}
      <div className={`absolute inset-0 ${theme === 'dark' ? 'opacity-20' : 'opacity-10'}`} style={{
        backgroundImage: `
          linear-gradient(${theme === 'dark' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(16, 185, 129, 0.15)'} 1px, transparent 1px),
          linear-gradient(90deg, ${theme === 'dark' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(16, 185, 129, 0.15)'} 1px, transparent 1px)
        `,
        backgroundSize: '50px 50px',
        animation: 'grid-flow 20s linear infinite'
      }}></div>

      {/* Green/Teal Glowing Orbs */}
      <div className={`absolute top-20 left-20 w-96 h-96 ${theme === 'dark' ? 'bg-gradient-to-br from-green-500/25 to-teal-500/25' : 'bg-green-400/10'} rounded-full blur-[120px] animate-pulse`}></div>
      <div className={`absolute bottom-20 right-20 w-96 h-96 ${theme === 'dark' ? 'bg-gradient-to-br from-teal-500/25 to-cyan-500/25' : 'bg-teal-400/10'} rounded-full blur-[120px] animate-pulse`} style={{ animationDelay: '1s' }}></div>

      {/* Back Button */}
      <motion.button
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        onClick={() => navigate('/')}
        className={`absolute top-8 left-8 flex items-center gap-2 ${theme === 'dark' ? 'text-green-400 hover:text-green-300' : 'text-green-600 hover:text-green-700'} transition-colors font-mono`}
      >
        <ArrowLeft className="size-5" />
        <span>Back to Portal</span>
      </motion.button>

      <div className="w-full max-w-md relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 50 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
        >
          {/* Header */}
          <div className="text-center mb-8">
            <motion.div
              className="inline-block mb-4"
              animate={{ scale: [1, 1.05, 1] }}
              transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
            >
              <div className="size-20 rounded-xl bg-gradient-to-br from-green-500 via-teal-500 to-cyan-500 flex items-center justify-center relative">
                <Users className="size-10 text-white" />
                <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-green-500 to-cyan-500 blur-xl opacity-50 animate-pulse" />
              </div>
            </motion.div>
            <h1 className={`text-4xl font-bold ${theme === 'dark' ? 'bg-gradient-to-r from-green-300 via-teal-300 to-cyan-300 bg-clip-text text-transparent' : 'text-slate-900'} mb-2`}>Employee Portal</h1>
            <p className={`${theme === 'dark' ? 'text-green-400/70' : 'text-green-600/90'} font-mono`}>Team Member Access</p>
            {workspaceLabel && (
              <p className={`mt-2 text-sm ${theme === 'dark' ? 'text-slate-400' : 'text-slate-600'} font-mono`}>
                Workspace: <span className="text-green-400/90">{workspaceLabel}</span>
              </p>
            )}
          </div>

          {/* Quick Features */}
          <div className="grid grid-cols-3 gap-3 mb-6">
            {[
              { icon: Clock, label: 'Timesheet' },
              { icon: DollarSign, label: 'Expenses' },
              { icon: Briefcase, label: 'Projects' },
            ].map((feat, i) => (
              <motion.div
                key={feat.label}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 + i * 0.1 }}
                className={`flex flex-col items-center gap-1 p-3 rounded-lg ${theme === 'dark' ? 'bg-green-500/5 border-green-500/20' : 'bg-green-50 border-green-200'} border`}
              >
                <feat.icon className={`size-5 ${theme === 'dark' ? 'text-green-400' : 'text-green-600'}`} />
                <span className={`text-xs font-mono ${theme === 'dark' ? 'text-green-400/70' : 'text-green-600/80'}`}>{feat.label}</span>
              </motion.div>
            ))}
          </div>

          {/* Login Card */}
          <Card className={`${theme === 'dark' ? 'bg-slate-900/50 border-green-500/30' : 'bg-white/80 border-green-400/40'} backdrop-blur-xl relative overflow-hidden shadow-2xl`}>
            <div className={`absolute inset-0 ${theme === 'dark' ? 'bg-gradient-to-r from-green-500/20 via-teal-500/20 to-cyan-500/20' : 'bg-gradient-to-r from-green-400/10 to-teal-400/10'} opacity-50`}></div>
            <CardHeader className="relative pb-3">
              <div className="flex items-center justify-between mb-2">
                <CardTitle className={`text-2xl ${theme === 'dark' ? 'text-white' : 'text-slate-900'} flex items-center gap-2`}>
                  <Lock className="size-6 text-green-400" />
                  Employee Sign In
                </CardTitle>
              </div>

              <CardDescription className={`${theme === 'dark' ? 'text-green-400/70' : 'text-green-600/80'} font-mono text-xs`}>
                Enter your credentials to access your employee workspace
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-6 relative">
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label className={`${theme === 'dark' ? 'text-slate-300' : 'text-slate-700'} font-mono`}>Email</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-green-400" />
                    <Input
                      type="email"
                      placeholder="employee@agency.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className={`${theme === 'dark' ? 'bg-slate-950/50 border-green-500/30 text-white' : 'bg-slate-50 border-green-400/40 text-slate-900'} pl-10 h-12 focus:border-green-500/50 font-mono`}
                      required
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className={`${theme === 'dark' ? 'text-slate-300' : 'text-slate-700'} font-mono`}>Password</Label>
                    <button
                      type="button"
                      onClick={handleForgotPassword}
                      disabled={isResetting || isLoading}
                      className={`text-xs ${theme === 'dark' ? 'text-green-400 hover:text-green-300' : 'text-green-600 hover:text-green-700'} font-mono transition-colors underline`}
                    >
                      {isResetting ? 'Sending link...' : 'Forgot password?'}
                    </button>
                  </div>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-green-400" />
                    <Input
                      type={showPassword ? 'text' : 'password'}
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className={`${theme === 'dark' ? 'bg-slate-950/50 border-green-500/30 text-white' : 'bg-slate-50 border-green-400/40 text-slate-900'} pl-10 pr-10 h-12 focus:border-green-500/50 font-mono`}
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-green-400/70 hover:text-green-400 transition-colors p-1"
                      title={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                </div>

                {/* Info Message */}
                {infoMessage && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-lg flex items-center gap-2"
                  >
                    <CheckCircle2 className="size-4 text-emerald-400 shrink-0" />
                    <p className="text-emerald-300 text-xs font-mono">{infoMessage}</p>
                  </motion.div>
                )}

                {/* Error Message */}
                {error && (
                  <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg space-y-2">
                    <div className="flex items-center gap-2">
                      <AlertCircle className="size-4 text-red-400 shrink-0" />
                      <p className="text-red-400 text-sm font-mono">{error}</p>
                    </div>
                  </motion.div>
                )}

                {isLoading && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-green-400 text-sm font-mono">Authenticating...</span>
                      <span className="text-green-400 text-sm font-mono">{scanProgress}%</span>
                    </div>
                    <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                      <motion.div className="h-full bg-gradient-to-r from-green-500 via-teal-500 to-cyan-500" style={{ width: `${scanProgress}%` }} />
                    </div>
                  </motion.div>
                )}

                <Button
                  type="submit"
                  disabled={isLoading}
                  className="w-full h-12 bg-gradient-to-r from-green-500 via-teal-500 to-cyan-500 hover:from-green-600 hover:via-teal-600 hover:to-cyan-600 text-white font-bold text-lg relative overflow-hidden group"
                >
                  <span className="relative z-10 font-mono">
                    {isLoading ? 'AUTHENTICATING...' : 'ACCESS EMPLOYEE PORTAL'}
                  </span>
                </Button>
              </form>

              <SupabaseConnectionPanel />

              {employeeUsers.length > 0 && (
                <>
                  <div className="relative">
                    <div className="absolute inset-0 flex items-center">
                      <div className="w-full border-t border-green-500/20"></div>
                    </div>
                    <div className="relative flex justify-center text-xs">
                      <span className={`${theme === 'dark' ? 'bg-slate-900/50' : 'bg-white/80'} px-2 text-green-400/70 font-mono`}>QUICK ACCESS</span>
                    </div>
                  </div>

                  <div className="space-y-2">
                    {employeeUsers.map((user, index) => (
                      <motion.button
                        key={user.email}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.2 + index * 0.1 }}
                        onClick={() => handleDemoLogin(user.email)}
                        disabled={isLoading}
                        className={`w-full p-3 ${theme === 'dark' ? 'bg-slate-950/50 hover:bg-slate-950/80' : 'bg-slate-50 hover:bg-slate-100'} border border-green-500/20 hover:border-green-500/40 rounded-lg transition-all group text-left relative overflow-hidden`}
                      >
                        <div className="flex items-center gap-3 relative z-10">
                          <div className="size-8 rounded-lg bg-gradient-to-br from-green-500/20 via-teal-500/20 to-cyan-500/20 flex items-center justify-center">
                            <Users className="size-4 text-green-400" />
                          </div>
                          <div className="flex-1">
                            <p className={`text-sm font-medium font-mono ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>{user.name}</p>
                            <p className="text-green-400/70 text-xs font-mono">{user.email}</p>
                          </div>
                          <span className="text-xs text-green-400 font-mono">EMPLOYEE</span>
                        </div>
                      </motion.button>
                    ))}
                  </div>

                  <p className={`text-xs text-center ${theme === 'dark' ? 'text-slate-500' : 'text-slate-600'} font-mono`}>
                    Demo account — click a name above to sign in instantly
                  </p>
                  
                  {/* Invite Only Notice */}
                  <div className="text-center pt-2">
                    <p className={`text-xs ${theme === 'dark' ? 'text-slate-400' : 'text-slate-600'} font-mono`}>
                      Employee accounts are invite-only. Contact your organization administrator for an invitation.
                    </p>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </motion.div>
      </div>

      <style>{`
        @keyframes grid-flow {
          0% { transform: translateY(0); }
          100% { transform: translateY(50px); }
        }
      `}</style>
    </div>
  );
}
