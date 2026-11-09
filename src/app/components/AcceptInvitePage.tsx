import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { motion } from 'motion/react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Users, Lock, Eye, EyeOff, CheckCircle2, AlertCircle, Sparkles } from 'lucide-react';
import { useTheme } from '@/contexts/ThemeContext';
import { getSupabaseClient } from '@/lib/supabaseClient';
import { useAuth } from '@/contexts/AuthContext';
import { authService } from '@/services/authService';

export function AcceptInvitePage() {
  const [email, setEmail] = useState('');
  const [orgName, setOrgName] = useState('');
  const [role, setRole] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isDeclining, setIsDeclining] = useState(false);
  const [isVerifyingSession, setIsVerifyingSession] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [declined, setDeclined] = useState(false);
  const navigate = useNavigate();
  const { theme } = useTheme();
  const { login } = useAuth();

  useEffect(() => {
    const checkInviteSession = async () => {
      const urlParams = new URLSearchParams(window.location.search);
      const emailParam = urlParams.get('email');
      if (emailParam) setEmail(emailParam);

      const sb = getSupabaseClient();
      if (!sb) {
        setIsVerifyingSession(false);
        return;
      }

      try {
        // Let Supabase client handle code exchange automatically via detectSessionInUrl
        // Wait for session to be established
        let session = null;
        for (let i = 0; i < 10; i++) {
          const { data } = await sb.auth.getSession();
          if (data?.session?.user) {
            session = data.session;
            break;
          }
          await new Promise(r => setTimeout(r, 200));
        }

        if (session?.user) {
          setEmail(session.user.email || emailParam || '');
          const meta = session.user.user_metadata || {};
          setOrgName(meta.organization_name || meta.org_name || 'Organization');
          setRole(meta.role || 'Team Member');
        } else {
          // Fallback: listen for auth state changes
          const { data: { subscription } } = sb.auth.onAuthStateChange((_event, session) => {
            if (session?.user) {
              setEmail(session.user.email || emailParam || '');
              const meta = session.user.user_metadata || {};
              setOrgName(meta.organization_name || meta.org_name || 'Organization');
              setRole(meta.role || 'Team Member');
              setIsVerifyingSession(false);
            }
          });
          setTimeout(() => setIsVerifyingSession(false), 3000);
          return () => subscription.unsubscribe();
        }
      } catch (err) {
        console.error('Invite session error:', err);
      } finally {
        setIsVerifyingSession(false);
      }
    };

    checkInviteSession();
  }, []);

  const handleAccept = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password.length < 6) {
      setError('Password must be at least 6 characters long.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setIsLoading(true);

    try {
      if (!email) {
        throw new Error('Email not found. Please use the link from your invitation email.');
      }

      // Use backend API to set up password (handles Supabase + local store sync)
      const res = await authService.setupEmployeePassword({ email, password });

      if (!res.success) {
        throw new Error(res.error || 'Failed to set up account');
      }

      setSuccess(true);

      // Auto-login to employee portal
      try {
        await login(email, password, undefined, 'employee');
        setTimeout(() => {
          navigate('/employee');
        }, 1200);
      } catch {
        setTimeout(() => {
          navigate('/login/employee');
        }, 1500);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to set password. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDecline = async () => {
    if (!window.confirm('Are you sure you want to decline this invitation?')) return;
    setIsDeclining(true);
    try {
      const sb = getSupabaseClient();
      if (sb) {
        const { data: { session } } = await sb.auth.getSession();
        if (session?.user?.id) {
          // Remove or mark status as rejected
          await sb
            .from('organization_members')
            .update({ status: 'rejected' })
            .eq('user_id', session.user.id);
        }
        await sb.auth.signOut();
      }
      setDeclined(true);
      setTimeout(() => {
        navigate('/login/employee?notice=declined');
      }, 2000);
    } catch (err) {
      console.error('Decline error:', err);
      navigate('/login/employee');
    } finally {
      setIsDeclining(false);
    }
  };

  return (
    <div className={`min-h-screen ${theme === 'dark' ? 'bg-black' : 'bg-gradient-to-br from-slate-50 to-slate-100'} flex items-center justify-center p-4 relative overflow-hidden`}>
      {/* Animated Grid Background */}
      <div className={`absolute inset-0 ${theme === 'dark' ? 'opacity-20' : 'opacity-10'}`} style={{
        backgroundImage: `
          linear-gradient(${theme === 'dark' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(16, 185, 129, 0.15)'} 1px, transparent 1px),
          linear-gradient(90deg, ${theme === 'dark' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(16, 185, 129, 0.15)'} 1px, transparent 1px)
        `,
        backgroundSize: '50px 50px',
      }} />

      {/* Glowing Orbs */}
      <div className={`absolute top-20 left-20 w-96 h-96 ${theme === 'dark' ? 'bg-emerald-500/20' : 'bg-emerald-400/10'} rounded-full blur-[120px] animate-pulse`} />
      <div className={`absolute bottom-20 right-20 w-96 h-96 ${theme === 'dark' ? 'bg-teal-600/20' : 'bg-teal-400/10'} rounded-full blur-[120px] animate-pulse`} style={{ animationDelay: '1s' }} />

      <div className="w-full max-w-md relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
        >
          {/* Header */}
          <div className="text-center mb-6">
            <div className="inline-block mb-4">
              <div className="size-20 rounded-2xl bg-gradient-to-br from-emerald-400 via-teal-500 to-cyan-600 flex items-center justify-center relative shadow-2xl shadow-emerald-500/30">
                <Sparkles className="size-10 text-white drop-shadow-lg" />
              </div>
            </div>
            <h1 className={`text-3xl font-bold ${theme === 'dark' ? 'bg-gradient-to-r from-emerald-300 via-teal-300 to-cyan-300 bg-clip-text text-transparent' : 'text-slate-900'} mb-2`}>
              Team Invitation
            </h1>
            <p className={`${theme === 'dark' ? 'text-slate-300' : 'text-slate-600'} text-sm`}>
              You have been invited by <span className="font-semibold text-emerald-400">{orgName || 'your organization'}</span> to join Finance OS.
            </p>
          </div>

          <Card className={`${theme === 'dark' ? 'bg-slate-900/70 border-emerald-500/30' : 'bg-white/90 border-emerald-400/40'} backdrop-blur-xl relative overflow-hidden shadow-2xl shadow-emerald-500/10`}>
            <CardHeader className="relative pb-4">
              <div className="flex items-center justify-between">
                <CardTitle className={`text-lg ${theme === 'dark' ? 'text-white' : 'text-slate-900'} flex items-center gap-2`}>
                  <Lock className="size-5 text-emerald-400" />
                  Accept & Activate Account
                </CardTitle>
                <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 capitalize">
                  {role.replace('_', ' ')}
                </span>
              </div>
              {email && (
                <CardDescription className="font-mono text-xs text-emerald-400/80 break-all pt-1">
                  Invited email: <span className="font-semibold text-white">{email}</span>
                </CardDescription>
              )}
            </CardHeader>

            <CardContent className="space-y-5 relative">
              {declined ? (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="p-6 text-center space-y-3 bg-red-500/10 border border-red-500/30 rounded-xl"
                >
                  <AlertCircle className="size-12 text-red-400 mx-auto" />
                  <h3 className="text-lg font-bold text-white">Invitation Declined</h3>
                  <p className="text-red-300 text-sm font-mono">
                    You have declined the invitation to join {orgName}. Redirecting...
                  </p>
                </motion.div>
              ) : success ? (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="p-6 text-center space-y-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl"
                >
                  <CheckCircle2 className="size-12 text-emerald-400 mx-auto" />
                  <h3 className="text-lg font-bold text-white">Invitation Accepted!</h3>
                  <p className="text-emerald-300 text-sm font-mono">
                    Your password is saved and your account is active. Launching your workspace...
                  </p>
                </motion.div>
              ) : (
                <form onSubmit={handleAccept} className="space-y-4">
                  {!email && (
                    <div className="space-y-2">
                      <Label className={`${theme === 'dark' ? 'text-slate-300' : 'text-slate-700'} font-mono text-xs`}>
                        Invited Email Address
                      </Label>
                      <div className="relative">
                        <Users className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-emerald-400" />
                        <Input
                          type="email"
                          placeholder="employee@agency.com"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          className={`${theme === 'dark' ? 'bg-slate-950/50 border-emerald-500/30 text-white' : 'bg-slate-50 border-emerald-400/40 text-slate-900'} pl-10 h-11 focus:border-emerald-500/50 font-mono text-sm`}
                          required
                        />
                      </div>
                    </div>
                  )}

                  {/* Password Input */}
                  <div className="space-y-2">
                    <Label className={`${theme === 'dark' ? 'text-slate-300' : 'text-slate-700'} font-mono text-xs`}>
                      Create Chosen Password
                    </Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-emerald-400" />
                      <Input
                        type={showPassword ? 'text' : 'password'}
                        placeholder="At least 6 characters"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className={`${theme === 'dark' ? 'bg-slate-950/50 border-emerald-500/30 text-white' : 'bg-slate-50 border-emerald-400/40 text-slate-900'} pl-10 pr-10 h-11 focus:border-emerald-500/50 font-mono text-sm`}
                        required
                        minLength={6}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-400/70 hover:text-emerald-400 transition-colors p-1"
                      >
                        {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                      </button>
                    </div>
                  </div>

                  {/* Confirm Password Input */}
                  <div className="space-y-2">
                    <Label className={`${theme === 'dark' ? 'text-slate-300' : 'text-slate-700'} font-mono text-xs`}>
                      Confirm Password
                    </Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-emerald-400" />
                      <Input
                        type={showConfirmPassword ? 'text' : 'password'}
                        placeholder="Re-enter password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        className={`${theme === 'dark' ? 'bg-slate-950/50 border-emerald-500/30 text-white' : 'bg-slate-50 border-emerald-400/40 text-slate-900'} pl-10 pr-10 h-11 focus:border-emerald-500/50 font-mono text-sm`}
                        required
                        minLength={6}
                      />
                      <button
                        type="button"
                        onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-400/70 hover:text-emerald-400 transition-colors p-1"
                      >
                        {showConfirmPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                      </button>
                    </div>
                  </div>

                  {/* Error Box */}
                  {error && (
                    <motion.div
                      initial={{ opacity: 0, y: -5 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg flex items-center gap-2"
                    >
                      <AlertCircle className="size-4 text-red-400 shrink-0" />
                      <p className="text-red-400 text-xs font-mono">{error}</p>
                    </motion.div>
                  )}

                  {/* Submit Button */}
                  <Button
                    type="submit"
                    disabled={isLoading || isDeclining || isVerifyingSession}
                    className="w-full h-11 bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-500 hover:from-emerald-600 hover:to-cyan-600 text-white font-bold text-sm font-mono mt-2"
                  >
                    {isLoading ? 'ACTIVATING ACCOUNT...' : 'ACCEPT INVITATION & SET PASSWORD'}
                  </Button>

                  {/* Decline Button */}
                  <button
                    type="button"
                    onClick={handleDecline}
                    disabled={isLoading || isDeclining}
                    className="w-full py-2.5 text-xs text-red-400 hover:text-red-300 font-mono transition-colors text-center disabled:opacity-50"
                  >
                    {isDeclining ? 'Declining invitation...' : 'Decline this invitation'}
                  </button>
                </form>
              )}
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </div>
  );
}
