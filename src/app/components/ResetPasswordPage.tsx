import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { motion } from 'motion/react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Lock, Eye, EyeOff, CheckCircle2, AlertCircle, KeyRound, ArrowLeft } from 'lucide-react';
import { useTheme } from '@/contexts/ThemeContext';
import { getSupabaseClient } from '@/lib/supabaseClient';

export function ResetPasswordPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [isSessionValid, setIsSessionValid] = useState<boolean | null>(null);
  const [errorDetails, setErrorDetails] = useState<string | null>(null);
  const navigate = useNavigate();
  const { theme } = useTheme();

  useEffect(() => {
    const checkRecoverySession = async () => {
      // 1. Check for URL error parameters in query or hash (e.g. expired link)
      const hash = window.location.hash || '';
      const search = window.location.search || '';
      const urlParams = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
      const hashParams = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);

      const errDesc =
        urlParams.get('error_description') ||
        hashParams.get('error_description') ||
        urlParams.get('error') ||
        hashParams.get('error');

      if (errDesc) {
        const decoded = decodeURIComponent(errDesc.replace(/\+/g, ' '));
        setError(decoded);
        setErrorDetails('This password reset link is invalid or has expired. Please request a new link.');
        setIsSessionValid(false);
        return;
      }

      const sb = getSupabaseClient();
      if (!sb) {
        setError('Supabase authentication client is not configured.');
        setIsSessionValid(false);
        return;
      }

      try {
        // 2. If PKCE code is in query string, exchange it for a session
        const code = urlParams.get('code');
        if (code) {
          const { error: exchangeErr } = await sb.auth.exchangeCodeForSession(code);
          if (exchangeErr) {
            console.warn('PKCE code exchange error:', exchangeErr.message);
          }
        }

        // 3. Check active session
        const { data: { session } } = await sb.auth.getSession();
        if (session?.user?.email) {
          setEmail(session.user.email);
          setIsSessionValid(true);
        } else {
          // Listen for recovery state change
          const { data: authListener } = sb.auth.onAuthStateChange((event, session) => {
            if (session?.user?.email) {
              setEmail(session.user.email);
              setIsSessionValid(true);
            }
          });

          // Give a short grace period for session recovery parsing
          setTimeout(async () => {
            const { data: { session: retrySession } } = await sb.auth.getSession();
            if (retrySession?.user?.email) {
              setEmail(retrySession.user.email);
              setIsSessionValid(true);
            } else {
              setIsSessionValid(false);
            }
          }, 800);

          return () => {
            authListener.subscription.unsubscribe();
          };
        }
      } catch (err: any) {
        console.error('Recovery session check error:', err);
        setIsSessionValid(false);
      }
    };

    checkRecoverySession();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
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
      const sb = getSupabaseClient();
      if (!sb) {
        throw new Error('Supabase client is not available.');
      }

      const { error: updateErr } = await sb.auth.updateUser({
        password: password,
      });

      if (updateErr) {
        throw new Error(updateErr.message);
      }

      setSuccess(true);
      setTimeout(() => {
        navigate('/login');
      }, 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update password. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={`min-h-screen ${theme === 'dark' ? 'bg-black' : 'bg-gradient-to-br from-slate-50 to-slate-100'} flex items-center justify-center p-4 relative overflow-hidden`}>
      {/* Animated Grid Background */}
      <div className={`absolute inset-0 ${theme === 'dark' ? 'opacity-20' : 'opacity-10'}`} style={{
        backgroundImage: `
          linear-gradient(${theme === 'dark' ? 'rgba(6, 182, 212, 0.1)' : 'rgba(6, 182, 212, 0.15)'} 1px, transparent 1px),
          linear-gradient(90deg, ${theme === 'dark' ? 'rgba(6, 182, 212, 0.1)' : 'rgba(6, 182, 212, 0.15)'} 1px, transparent 1px)
        `,
        backgroundSize: '50px 50px',
      }} />

      {/* Cyan Glowing Orbs */}
      <div className={`absolute top-20 left-20 w-96 h-96 ${theme === 'dark' ? 'bg-cyan-500/20' : 'bg-cyan-400/10'} rounded-full blur-[120px] animate-pulse`} />
      <div className={`absolute bottom-20 right-20 w-96 h-96 ${theme === 'dark' ? 'bg-blue-600/20' : 'bg-blue-400/10'} rounded-full blur-[120px] animate-pulse`} style={{ animationDelay: '1s' }} />

      {/* Back to Login Button */}
      <motion.button
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        onClick={() => navigate('/login/employee')}
        className={`absolute top-8 left-8 flex items-center gap-2 ${theme === 'dark' ? 'text-cyan-400 hover:text-cyan-300' : 'text-cyan-600 hover:text-cyan-700'} transition-colors font-mono text-sm`}
      >
        <ArrowLeft className="size-4" />
        <span>Back to Login</span>
      </motion.button>

      <div className="w-full max-w-md relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
        >
          {/* Header */}
          <div className="text-center mb-8">
            <div className="inline-block mb-4">
              <div className="size-20 rounded-2xl bg-gradient-to-br from-cyan-400 via-blue-500 to-indigo-600 flex items-center justify-center relative shadow-2xl shadow-cyan-500/30">
                <KeyRound className="size-10 text-white drop-shadow-lg" />
              </div>
            </div>
            <h1 className={`text-3xl font-bold ${theme === 'dark' ? 'bg-gradient-to-r from-cyan-300 via-blue-300 to-indigo-300 bg-clip-text text-transparent' : 'text-slate-900'} mb-2`}>
              Reset Password
            </h1>
            <p className={`${theme === 'dark' ? 'text-cyan-400/70' : 'text-cyan-600/90'} font-mono text-sm`}>
              Choose a new secure password for your account
            </p>
          </div>

          <Card className={`${theme === 'dark' ? 'bg-slate-900/70 border-cyan-500/30' : 'bg-white/90 border-cyan-400/40'} backdrop-blur-xl relative overflow-hidden shadow-2xl shadow-cyan-500/10`}>
            <CardHeader className="relative pb-4">
              <CardTitle className={`text-xl ${theme === 'dark' ? 'text-white' : 'text-slate-900'} flex items-center gap-2`}>
                <Lock className="size-5 text-cyan-400" />
                Set New Password
              </CardTitle>
              {email && (
                <CardDescription className="font-mono text-xs text-cyan-400/80 break-all pt-1">
                  Account: <span className="font-semibold text-white">{email}</span>
                </CardDescription>
              )}
            </CardHeader>

            <CardContent className="space-y-5 relative">
              {success ? (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="p-6 text-center space-y-3 bg-cyan-500/10 border border-cyan-500/30 rounded-xl"
                >
                  <CheckCircle2 className="size-12 text-cyan-400 mx-auto" />
                  <h3 className="text-lg font-bold text-white">Password Updated!</h3>
                  <p className="text-cyan-300 text-sm font-mono">
                    Your password has been changed successfully. Redirecting to login...
                  </p>
                </motion.div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-4">
                  {/* New Password Input */}
                  <div className="space-y-2">
                    <Label className={`${theme === 'dark' ? 'text-slate-300' : 'text-slate-700'} font-mono text-xs`}>
                      New Password
                    </Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-cyan-400" />
                      <Input
                        type={showPassword ? 'text' : 'password'}
                        placeholder="At least 6 characters"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className={`${theme === 'dark' ? 'bg-slate-950/50 border-cyan-500/30 text-white' : 'bg-slate-50 border-cyan-400/40 text-slate-900'} pl-10 pr-10 h-11 focus:border-cyan-500/50 font-mono text-sm`}
                        required
                        minLength={6}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-cyan-400/70 hover:text-cyan-400 transition-colors p-1"
                      >
                        {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                      </button>
                    </div>
                  </div>

                  {/* Confirm New Password Input */}
                  <div className="space-y-2">
                    <Label className={`${theme === 'dark' ? 'text-slate-300' : 'text-slate-700'} font-mono text-xs`}>
                      Confirm New Password
                    </Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-cyan-400" />
                      <Input
                        type={showConfirmPassword ? 'text' : 'password'}
                        placeholder="Re-enter new password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        className={`${theme === 'dark' ? 'bg-slate-950/50 border-cyan-500/30 text-white' : 'bg-slate-50 border-cyan-400/40 text-slate-900'} pl-10 pr-10 h-11 focus:border-cyan-500/50 font-mono text-sm`}
                        required
                        minLength={6}
                      />
                      <button
                        type="button"
                        onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-cyan-400/70 hover:text-cyan-400 transition-colors p-1"
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
                      className="p-3.5 bg-red-500/10 border border-red-500/30 rounded-xl space-y-2"
                    >
                      <div className="flex items-center gap-2">
                        <AlertCircle className="size-4 text-red-400 shrink-0" />
                        <p className="text-red-400 text-xs font-mono">{error}</p>
                      </div>
                      {errorDetails && (
                        <p className="text-slate-300 text-[11px] font-mono pl-6">{errorDetails}</p>
                      )}
                      {(errorDetails || isSessionValid === false) && (
                        <div className="pt-1 pl-6">
                          <button
                            type="button"
                            onClick={() => navigate('/login')}
                            className="text-xs font-mono font-bold text-cyan-400 hover:text-cyan-300 underline underline-offset-2"
                          >
                            Request a new password reset link →
                          </button>
                        </div>
                      )}
                    </motion.div>
                  )}

                  {/* Submit Button */}
                  <Button
                    type="submit"
                    disabled={isLoading}
                    className="w-full h-11 bg-gradient-to-r from-cyan-500 via-blue-500 to-indigo-500 hover:from-cyan-600 hover:to-indigo-600 text-white font-bold text-sm font-mono mt-2"
                  >
                    {isLoading ? 'UPDATING PASSWORD...' : 'RESET PASSWORD & CONTINUE'}
                  </Button>
                </form>
              )}
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </div>
  );
}
