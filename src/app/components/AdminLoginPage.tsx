import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { motion } from 'motion/react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Shield, Lock, Mail, ArrowLeft, Eye, EyeOff, CheckCircle2, DollarSign, Users, AlertCircle } from 'lucide-react';
import { useTheme } from '@/contexts/ThemeContext';
import { authService } from '@/services/authService';
import type { PortalType } from '@/services/authSessionTypes';
import type { MemberAccessRole } from '@/services/types';

interface AdminLoginPageProps {
  onLogin: (
    email: string,
    password: string,
    orgSlug?: string,
    portalType?: PortalType,
    requiredAccessRole?: MemberAccessRole
  ) => Promise<void>;
}

interface RoleOption {
  id: MemberAccessRole;
  name: string;
  badge: string;
  description: string;
  icon: any;
  accentColor: string;
  borderColor: string;
  textColor: string;
  bgColor: string;
  hoverBorder: string;
}

const ROLE_OPTIONS: RoleOption[] = [
  {
    id: 'org_admin',
    name: 'Organization Admin',
    badge: 'ORG ADMIN',
    description: 'Full access to all features and settings',
    icon: Shield,
    accentColor: 'from-purple-500 to-indigo-600',
    borderColor: 'border-purple-500/40',
    textColor: 'text-purple-400',
    bgColor: 'bg-purple-500/10',
    hoverBorder: 'hover:border-purple-500/60',
  },
  {
    id: 'accountant',
    name: 'Accountant',
    badge: 'ACCOUNTANT',
    description: 'Full financial access, limited team management',
    icon: DollarSign,
    accentColor: 'from-cyan-500 to-blue-600',
    borderColor: 'border-cyan-500/40',
    textColor: 'text-cyan-400',
    bgColor: 'bg-cyan-500/10',
    hoverBorder: 'hover:border-cyan-500/60',
  },
  {
    id: 'team_member',
    name: 'Team Member',
    badge: 'TEAM MEMBER',
    description: 'Add transactions and view reports',
    icon: Users,
    accentColor: 'from-blue-500 to-indigo-500',
    borderColor: 'border-blue-500/40',
    textColor: 'text-blue-400',
    bgColor: 'bg-blue-500/10',
    hoverBorder: 'hover:border-blue-500/60',
  },
  {
    id: 'viewer',
    name: 'Viewer',
    badge: 'VIEWER',
    description: 'View-only access to reports and dashboard',
    icon: Eye,
    accentColor: 'from-emerald-500 to-teal-600',
    borderColor: 'border-emerald-500/40',
    textColor: 'text-emerald-400',
    bgColor: 'bg-emerald-500/10',
    hoverBorder: 'hover:border-emerald-500/60',
  },
];

export function AdminLoginPage({ onLogin }: AdminLoginPageProps) {
  const [selectedRole, setSelectedRole] = useState<MemberAccessRole>('org_admin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [isResendingConfirmation, setIsResendingConfirmation] = useState(false);
  const [showResendButton, setShowResendButton] = useState(false);
  const [suggestedRole, setSuggestedRole] = useState<{ id: MemberAccessRole; label: string } | null>(null);
  const [error, setError] = useState('');
  const [infoMessage, setInfoMessage] = useState('');
  const [scanProgress, setScanProgress] = useState(0);
  const navigate = useNavigate();
  const { theme } = useTheme();

  const currentRoleConfig = ROLE_OPTIONS.find(r => r.id === selectedRole) || ROLE_OPTIONS[0];

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
      setError('Please enter your account email address first, then click "Forgot password?".');
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

  const handleResendConfirmation = async () => {
    if (!email.trim()) {
      setError('Please enter your email address first.');
      return;
    }
    setIsResendingConfirmation(true);
    setError('');
    setInfoMessage('');
    try {
      const res = await authService.resendConfirmation(email.trim());
      if (res.success) {
        setInfoMessage('Confirmation email sent! Check your inbox and click the link, then try logging in again.');
        setShowResendButton(false);
      } else {
        setError(res.error || 'Failed to resend confirmation email.');
      }
    } catch {
      setError('Failed to send confirmation email.');
    } finally {
      setIsResendingConfirmation(false);
    }
  };

  const executeLogin = async (targetRole: MemberAccessRole) => {
    setIsLoading(true);
    setScanProgress(0);
    setError('');
    setInfoMessage('');
    setShowResendButton(false);
    setSuggestedRole(null);

    const trimmedEmail = email.trim();

    try {
      // 1. Authenticate with credentials and enforce the selected role BEFORE session creation
      await onLogin(trimmedEmail, password, undefined, 'organization_admin', targetRole);

      // 2. Success! Credentials and role verified.
      const selectedRoleLabel = ROLE_OPTIONS.find(r => r.id === targetRole)?.name || targetRole;
      setInfoMessage(`✓ Role verified: Logging into organization dashboard as ${selectedRoleLabel}...`);

      // Brief delay so the user clearly sees the verification confirmation message
      setTimeout(() => {
        navigate('/dashboard');
      }, 500);
    } catch (err) {
      const rawMsg = err instanceof Error ? err.message : String(err || '');
      if (rawMsg === 'EMAIL_NOT_CONFIRMED' || rawMsg.toLowerCase().includes('email not confirmed')) {
        setError('Your email address has not been confirmed yet. Please check your inbox for a confirmation link.');
        setShowResendButton(true);
      } else if (rawMsg.toLowerCase().includes('invalid login credentials') || rawMsg.toLowerCase().includes('invalid email or password')) {
        setError('Incorrect email or password. Please verify your credentials or click "Forgot password?".');
      } else if (rawMsg.toLowerCase().includes('not a member') || rawMsg.toLowerCase().includes('no access')) {
        setError('You are not a member of this organization. Please contact your organization administrator.');
      } else if (rawMsg.includes('Role Mismatch')) {
        setError(rawMsg);
        // Extract the suggested role from the error message for 1-click switch
        if (rawMsg.includes('"Organization Admin"')) {
          setSuggestedRole({ id: 'org_admin', label: 'Organization Admin' });
        } else if (rawMsg.includes('"Accountant"')) {
          setSuggestedRole({ id: 'accountant', label: 'Accountant' });
        } else if (rawMsg.includes('"Team Member"')) {
          setSuggestedRole({ id: 'team_member', label: 'Team Member' });
        } else if (rawMsg.includes('"Viewer"')) {
          setSuggestedRole({ id: 'viewer', label: 'Viewer' });
        }
      } else if (rawMsg) {
        setError(rawMsg);
      } else {
        setError('Authentication failed. Please verify your credentials and access role.');
      }
      setIsLoading(false);
      setScanProgress(0);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await executeLogin(selectedRole);
  };

  return (
    <div className={`min-h-screen ${theme === 'dark' ? 'bg-black' : 'bg-gradient-to-br from-slate-50 to-slate-100'} flex items-center justify-center p-4 py-10 relative overflow-x-clip`}>
      {/* Animated Grid Background */}
      <div className={`absolute inset-0 ${theme === 'dark' ? 'opacity-20' : 'opacity-10'}`} style={{
        backgroundImage: `
          linear-gradient(${theme === 'dark' ? 'rgba(6, 182, 212, 0.1)' : 'rgba(6, 182, 212, 0.15)'} 1px, transparent 1px),
          linear-gradient(90deg, ${theme === 'dark' ? 'rgba(6, 182, 212, 0.1)' : 'rgba(6, 182, 212, 0.15)'} 1px, transparent 1px)
        `,
        backgroundSize: '50px 50px',
        animation: 'grid-flow 20s linear infinite'
      }}></div>

      {/* Cyan & Purple Glowing Orbs */}
      <div className={`absolute top-20 left-20 w-96 h-96 ${theme === 'dark' ? 'bg-cyan-500/20' : 'bg-cyan-400/10'} rounded-full blur-[120px] animate-pulse`}></div>
      <div className={`absolute bottom-20 right-20 w-96 h-96 ${theme === 'dark' ? 'bg-purple-600/20' : 'bg-blue-400/10'} rounded-full blur-[120px] animate-pulse`} style={{ animationDelay: '1s' }}></div>

      {/* Back Button */}
      <motion.button
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        onClick={() => navigate('/')}
        className={`absolute top-8 left-8 flex items-center gap-2 ${theme === 'dark' ? 'text-cyan-400 hover:text-cyan-300' : 'text-cyan-600 hover:text-cyan-700'} transition-colors font-mono z-20`}
      >
        <ArrowLeft className="size-5" />
        <span>Back to Portal</span>
      </motion.button>

      <div className="w-full max-w-xl relative z-10 py-6">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
        >
          {/* Header */}
          <div className="text-center mb-6">
            <div className="inline-block mb-3">
              <div className={`size-16 rounded-xl bg-gradient-to-br ${currentRoleConfig.accentColor} flex items-center justify-center relative shadow-2xl shadow-cyan-500/50 transition-all duration-300`}>
                <currentRoleConfig.icon className="size-8 text-white drop-shadow-lg" />
                <div className={`absolute inset-0 rounded-xl bg-gradient-to-br ${currentRoleConfig.accentColor} blur-xl opacity-60 animate-pulse`} />
              </div>
            </div>
            <h1 className={`text-3xl font-bold ${theme === 'dark' ? 'bg-gradient-to-r from-cyan-300 via-blue-300 to-purple-300 bg-clip-text text-transparent' : 'text-slate-900'} mb-1`}>
              Organization Dashboard Login
            </h1>
            <p className={`${theme === 'dark' ? 'text-cyan-400/70' : 'text-cyan-600/90'} font-mono text-sm`}>
              Sign in with your organization credentials and access role
            </p>
          </div>

          {/* Login Card */}
          <Card className={`${theme === 'dark' ? 'bg-gradient-to-br from-slate-900/90 via-slate-900/70 to-slate-950/90 border-cyan-500/30' : 'bg-white/90 border-cyan-400/40'} backdrop-blur-xl relative overflow-hidden shadow-2xl shadow-cyan-500/20`}>
            {/* Glowing Border Accent */}
            <div className={`absolute inset-0 ${theme === 'dark' ? 'bg-gradient-to-r from-cyan-500/10 via-blue-500/10 to-purple-500/10' : 'bg-gradient-to-r from-cyan-400/5 to-blue-400/5'} opacity-60 pointer-events-none`}></div>

            <CardHeader className="relative pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className={`text-xl ${theme === 'dark' ? 'text-white' : 'text-slate-900'} flex items-center gap-2`}>
                    <Lock className="size-5 text-cyan-400 drop-shadow-lg" />
                    Role-Based Authentication
                  </CardTitle>
                  <CardDescription className={`${theme === 'dark' ? 'text-cyan-400/70' : 'text-cyan-600/80'} font-mono text-xs mt-1`}>
                    Select your access role and enter your account credentials
                  </CardDescription>
                </div>
                <span className={`text-xs px-2.5 py-1 rounded-full font-mono font-bold border ${currentRoleConfig.borderColor} ${currentRoleConfig.textColor} ${currentRoleConfig.bgColor}`}>
                  {currentRoleConfig.badge}
                </span>
              </div>
            </CardHeader>

            <CardContent className="space-y-5 relative pt-1">
              {/* Role Selection Options */}
              <div className="space-y-2">
                <Label className={`${theme === 'dark' ? 'text-slate-300' : 'text-slate-700'} font-mono text-xs uppercase tracking-wider flex items-center justify-between`}>
                  <span>Select Your Organization Role:</span>
                  <span className="text-[11px] text-cyan-400 lowercase">permissions enforced at login</span>
                </Label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {ROLE_OPTIONS.map((opt) => {
                    const isSelected = selectedRole === opt.id;
                    const Icon = opt.icon;
                    return (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => {
                          setSelectedRole(opt.id);
                          setError('');
                        }}
                        className={`p-2.5 rounded-xl border text-left transition-all duration-200 relative flex flex-col justify-between ${
                          isSelected
                            ? `${opt.borderColor} ${opt.bgColor} shadow-lg ring-1 ring-cyan-500/30`
                            : `${theme === 'dark' ? 'bg-slate-950/40 border-slate-800' : 'bg-slate-50 border-slate-200'} opacity-75 hover:opacity-100 ${opt.hoverBorder}`
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1.5">
                          <div className={`p-1.5 rounded-lg ${isSelected ? `bg-gradient-to-br ${opt.accentColor} text-white` : `${theme === 'dark' ? 'bg-slate-900 text-slate-400' : 'bg-slate-200 text-slate-600'}`}`}>
                            <Icon className="size-4" />
                          </div>
                          {isSelected && (
                            <span className="size-2 rounded-full bg-cyan-400 shadow-sm shadow-cyan-400/80 animate-pulse" />
                          )}
                        </div>
                        <div>
                          <p className={`text-xs font-bold font-mono truncate ${isSelected ? opt.textColor : (theme === 'dark' ? 'text-slate-200' : 'text-slate-800')}`}>
                            {opt.name}
                          </p>
                          <p className="text-[10px] text-slate-400 line-clamp-1 mt-0.5 font-mono">
                            {opt.id === 'org_admin' ? 'Full Access' : opt.id === 'accountant' ? 'Financial' : opt.id === 'team_member' ? 'Add & View' : 'View Only'}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
                {/* Active Role Summary Notice */}
                <div className={`p-2.5 rounded-lg border ${currentRoleConfig.borderColor} ${currentRoleConfig.bgColor} flex items-center gap-2 text-xs font-mono`}>
                  <currentRoleConfig.icon className={`size-4 ${currentRoleConfig.textColor} shrink-0`} />
                  <span className={`${theme === 'dark' ? 'text-slate-300' : 'text-slate-700'}`}>
                    <strong>{currentRoleConfig.name}</strong>: {currentRoleConfig.description}
                  </span>
                </div>
              </div>

              {/* Login Form */}
              <form onSubmit={handleSubmit} className="space-y-4">
                {/* Email Input */}
                <div className="space-y-1.5">
                  <Label className={`${theme === 'dark' ? 'text-slate-300' : 'text-slate-700'} font-mono text-xs`}>
                    {selectedRole === 'org_admin' ? 'Admin Email' : `${currentRoleConfig.name} Email`}
                  </Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-cyan-400" />
                    <Input
                      type="email"
                      placeholder="account.email@agency.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className={`${theme === 'dark' ? 'bg-slate-950/60 border-cyan-500/30 text-white' : 'bg-slate-50 border-cyan-400/40 text-slate-900'} pl-10 h-11 focus:border-cyan-500/50 font-mono text-sm`}
                      required
                    />
                  </div>
                </div>

                {/* Password Input */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <Label className={`${theme === 'dark' ? 'text-slate-300' : 'text-slate-700'} font-mono text-xs`}>Password</Label>
                    <button
                      type="button"
                      onClick={handleForgotPassword}
                      disabled={isResetting || isLoading}
                      className={`text-xs ${theme === 'dark' ? 'text-cyan-400 hover:text-cyan-300' : 'text-cyan-600 hover:text-cyan-700'} font-mono transition-colors underline`}
                    >
                      {isResetting ? 'Sending link...' : 'Forgot password?'}
                    </button>
                  </div>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-cyan-400" />
                    <Input
                      type={showPassword ? 'text' : 'password'}
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className={`${theme === 'dark' ? 'bg-slate-950/60 border-cyan-500/30 text-white' : 'bg-slate-50 border-cyan-400/40 text-slate-900'} pl-10 pr-10 h-11 focus:border-cyan-500/50 font-mono text-sm`}
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-cyan-400/70 hover:text-cyan-400 transition-colors p-1"
                      title={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                </div>

                {/* Success / Verification Confirmation Message */}
                {infoMessage && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="p-3 bg-emerald-500/15 border border-emerald-500/40 rounded-lg flex items-start gap-2 shadow-lg"
                  >
                    <CheckCircle2 className="size-5 text-emerald-400 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-emerald-300 text-sm font-mono font-medium">{infoMessage}</p>
                    </div>
                  </motion.div>
                )}

                {/* Error Message */}
                {error && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="p-3 bg-red-500/10 border border-red-500/40 rounded-lg flex items-start gap-2"
                  >
                    <AlertCircle className="size-4 text-red-400 shrink-0 mt-0.5" />
                    <div className="space-y-2 flex-1">
                      <p className="text-red-400 text-xs font-mono">{error}</p>
                      {suggestedRole && (
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedRole(suggestedRole.id);
                            executeLogin(suggestedRole.id);
                          }}
                          className="w-full mt-1 px-3 py-2 bg-gradient-to-r from-cyan-500/20 to-blue-500/20 hover:from-cyan-500/30 hover:to-blue-500/30 border border-cyan-500/50 rounded-lg text-cyan-300 text-xs font-mono font-semibold transition-all flex items-center justify-between shadow-lg"
                        >
                          <span>👉 Switch to "{suggestedRole.label}" & Sign In</span>
                          <span className="underline">Switch</span>
                        </button>
                      )}
                      {showResendButton && (
                        <button
                          type="button"
                          onClick={handleResendConfirmation}
                          disabled={isResendingConfirmation}
                          className="w-full mt-1 px-3 py-1.5 bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/40 rounded text-cyan-300 text-xs font-mono transition-all"
                        >
                          {isResendingConfirmation ? 'Sending...' : '📧 Resend Confirmation Email'}
                        </button>
                      )}
                    </div>
                  </motion.div>
                )}

                {/* Loading Progress */}
                {isLoading && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    className="space-y-2 pt-1"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-cyan-400 text-xs font-mono">Verifying credentials & role...</span>
                      <span className="text-cyan-400 text-xs font-mono">{scanProgress}%</span>
                    </div>
                    <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                      <motion.div
                        className={`h-full bg-gradient-to-r ${currentRoleConfig.accentColor}`}
                        style={{ width: `${scanProgress}%` }}
                      >
                        <div className="absolute inset-0 bg-white/30 animate-pulse"></div>
                      </motion.div>
                    </div>
                  </motion.div>
                )}

                {/* Submit Button */}
                <Button
                  type="submit"
                  disabled={isLoading}
                  className={`w-full h-11 bg-gradient-to-r ${currentRoleConfig.accentColor} hover:brightness-110 text-white font-bold text-sm relative overflow-hidden group shadow-lg`}
                >
                  <span className="relative z-10 font-mono tracking-wider flex items-center justify-center gap-2">
                    <currentRoleConfig.icon className="size-4" />
                    {isLoading ? 'VERIFYING CREDENTIALS...' : `SIGN IN AS ${currentRoleConfig.badge}`}
                  </span>
                </Button>
              </form>
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* CSS Animation */}
      <style>{`
        @keyframes grid-flow {
          0% { transform: translateY(0); }
          100% { transform: translateY(50px); }
        }
      `}</style>
    </div>
  );
}