import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router';
import { motion } from 'motion/react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Building2, Lock, Eye, EyeOff, CheckCircle2, AlertCircle, Sparkles } from 'lucide-react';
import { useTheme } from '@/contexts/ThemeContext';
import { orgInvitationService } from '@/services/orgInvitationService';
import type { ValidateTokenResult } from '@/services/orgInvitationService';

export function AcceptOrgInvitePage() {
  const { token } = useParams<{ token: string }>();
  const [inviteData, setInviteData] = useState<ValidateTokenResult['invitation'] | null>(null);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isValidating, setIsValidating] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const navigate = useNavigate();
  const { theme } = useTheme();

  useEffect(() => {
    validateInvitation();
  }, [token]);

  async function validateInvitation() {
    if (!token) {
      setError('Invalid invitation link');
      setIsValidating(false);
      return;
    }

    try {
      const result = await orgInvitationService.validateToken(token);

      if (!result.valid || !result.invitation) {
        setError(result.error || 'Invalid or expired invitation');
        setIsValidating(false);
        return;
      }

      setInviteData(result.invitation);
    } catch (err) {
      console.error('Validation error:', err);
      setError('Failed to validate invitation');
    } finally {
      setIsValidating(false);
    }
  }

  async function handleAccept(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (password.length < 8) {
      setError('Password must be at least 8 characters long.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    if (!token) {
      setError('Invalid invitation token');
      return;
    }

    setIsLoading(true);

    try {
      const result = await orgInvitationService.acceptInvitation({
        token,
        password,
        confirmPassword,
      });

      if (!result.success) {
        throw new Error(result.error || 'Failed to create organization');
      }

      setSuccess(true);

      console.log('[AcceptInvitation] Organization created successfully!');
      console.log('[AcceptInvitation] Organization ID:', result.data.organizationId);
      console.log('[AcceptInvitation] User ID:', result.data.userId);

      // Wait a bit for database transactions to complete, then force full reload
      setTimeout(() => {
        console.log('[AcceptInvitation] Redirecting to dashboard...');
        // Force full page reload to refresh auth session with new organization context
        window.location.href = '/dashboard';
      }, 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create organization. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }

  if (isValidating) {
    return (
      <div className={`min-h-screen ${theme === 'dark' ? 'bg-black' : 'bg-gradient-to-br from-slate-50 to-slate-100'} flex items-center justify-center p-4`}>
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-emerald-500/30 border-t-emerald-500 mb-4" />
          <p className={`${theme === 'dark' ? 'text-slate-300' : 'text-slate-600'} font-mono text-sm`}>
            Validating invitation...
          </p>
        </div>
      </div>
    );
  }

  if (error && !inviteData) {
    return (
      <div className={`min-h-screen ${theme === 'dark' ? 'bg-black' : 'bg-gradient-to-br from-slate-50 to-slate-100'} flex items-center justify-center p-4`}>
        <Card className={`${theme === 'dark' ? 'bg-slate-900/70 border-red-500/30' : 'bg-white/90 border-red-400/40'} backdrop-blur-xl max-w-md w-full`}>
          <CardContent className="p-8 text-center space-y-4">
            <AlertCircle className="size-16 text-red-400 mx-auto" />
            <h3 className={`text-xl font-bold ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>
              Invalid Invitation
            </h3>
            <p className={`${theme === 'dark' ? 'text-slate-300' : 'text-slate-600'} text-sm`}>
              {error}
            </p>
            <Button
              onClick={() => navigate('/')}
              className="bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600"
            >
              Go to Homepage
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

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
                <Building2 className="size-10 text-white drop-shadow-lg" />
              </div>
            </div>
            <h1 className={`text-3xl font-bold ${theme === 'dark' ? 'bg-gradient-to-r from-emerald-300 via-teal-300 to-cyan-300 bg-clip-text text-transparent' : 'text-slate-900'} mb-2`}>
              Create Your Organization
            </h1>
            <p className={`${theme === 'dark' ? 'text-slate-300' : 'text-slate-600'} text-sm`}>
              Set up your password to activate <span className="font-semibold text-emerald-400">{inviteData?.organizationName}</span>
            </p>
          </div>

          <Card className={`${theme === 'dark' ? 'bg-slate-900/70 border-emerald-500/30' : 'bg-white/90 border-emerald-400/40'} backdrop-blur-xl relative overflow-hidden shadow-2xl shadow-emerald-500/10`}>
            <CardHeader className="relative pb-4">
              <div className="flex items-center justify-between">
                <CardTitle className={`text-lg ${theme === 'dark' ? 'text-white' : 'text-slate-900'} flex items-center gap-2`}>
                  <Lock className="size-5 text-emerald-400" />
                  Setup Administrator Account
                </CardTitle>
                <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  Owner
                </span>
              </div>
              {inviteData?.adminEmail && (
                <CardDescription className="font-mono text-xs text-emerald-400/80 break-all pt-1">
                  Admin email: <span className="font-semibold text-white">{inviteData.adminEmail}</span>
                </CardDescription>
              )}
            </CardHeader>

            <CardContent className="space-y-5 relative">
              {success ? (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="p-6 text-center space-y-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl"
                >
                  <CheckCircle2 className="size-12 text-emerald-400 mx-auto" />
                  <h3 className="text-lg font-bold text-white">Organization Created!</h3>
                  <p className="text-emerald-300 text-sm font-mono">
                    ✅ Your organization is ready!<br/>
                    Redirecting to dashboard in 2 seconds...
                  </p>
                </motion.div>
              ) : (
                <form onSubmit={handleAccept} className="space-y-4">
                  {/* Organization Info */}
                  <div className={`p-3 rounded-lg ${theme === 'dark' ? 'bg-slate-950/50 border border-emerald-500/20' : 'bg-slate-50 border border-emerald-400/20'}`}>
                    <p className="text-xs text-slate-400 mb-1">Organization</p>
                    <p className={`font-semibold ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>
                      {inviteData?.organizationName}
                    </p>
                    {inviteData?.adminName && (
                      <>
                        <p className="text-xs text-slate-400 mt-2 mb-1">Administrator</p>
                        <p className={`font-semibold ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>
                          {inviteData.adminName}
                        </p>
                      </>
                    )}
                  </div>

                  {/* Password Input */}
                  <div className="space-y-2">
                    <Label className={`${theme === 'dark' ? 'text-slate-300' : 'text-slate-700'} font-mono text-xs`}>
                      Create Password
                    </Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-emerald-400" />
                      <Input
                        type={showPassword ? 'text' : 'password'}
                        placeholder="At least 8 characters"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className={`${theme === 'dark' ? 'bg-slate-950/50 border-emerald-500/30 text-white' : 'bg-slate-50 border-emerald-400/40 text-slate-900'} pl-10 pr-10 h-11 focus:border-emerald-500/50 font-mono text-sm`}
                        required
                        minLength={8}
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
                        minLength={8}
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
                    disabled={isLoading}
                    className="w-full h-11 bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-500 hover:from-emerald-600 hover:to-cyan-600 text-white font-bold text-sm font-mono mt-2"
                  >
                    {isLoading ? 'CREATING ORGANIZATION...' : 'CREATE ORGANIZATION & SET PASSWORD'}
                  </Button>

                  <p className="text-center text-xs text-slate-500 font-mono mt-4">
                    By creating your organization, you agree to our Terms of Service
                  </p>
                </form>
              )}
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </div>
  );
}
