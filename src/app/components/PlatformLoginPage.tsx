import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { motion } from 'motion/react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Building2, Lock, Mail, ArrowLeft } from 'lucide-react';
import { mockUsers } from '@/data/mockDatabase';
import { useTheme } from '@/contexts/ThemeContext';
import { authService } from '@/services/authService';
import type { PortalType } from '@/services/authSessionTypes';
import { useLocation } from 'react-router';

interface PlatformLoginPageProps {
  onLogin: (email: string, password: string, orgSlug?: string, portalType?: PortalType) => Promise<void>;
}

export function PlatformLoginPage({ onLogin }: PlatformLoginPageProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [scanProgress, setScanProgress] = useState(0);
  const [hasAdmin, setHasAdmin] = useState(true);
  const [isResetting, setIsResetting] = useState(false);
  const [infoMessage, setInfoMessage] = useState('');
  const navigate = useNavigate();
  const location = useLocation();
  const { theme } = useTheme();

  useEffect(() => {
    let isMounted = true;
    void authService.hasExistingPlatformAdmin().then((exists) => {
      if (isMounted) setHasAdmin(exists);
    });
    const params = new URLSearchParams(location.search);
    if (params.get('notice') === 'admin_exists') {
      setNotice('A platform administrator account is already configured. Direct registration is disabled.');
    }
    return () => {
      isMounted = false;
    };
  }, [location.search]);

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
      setError('Please enter your administrator email address first, then click "Forgot password?".');
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

    try {
      await onLogin(email, password, undefined, 'platform_admin');
      navigate('/platform');
    } catch (err) {
      setError('Invalid platform credentials or no platform admin account found.');
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

    try {
      await onLogin(demoEmail, 'demo', undefined, 'platform_admin');
      navigate('/platform');
    } catch (err) {
      setError('Login failed or no platform admin account found.');
    } finally {
      setIsLoading(false);
      setScanProgress(0);
    }
  };

  // Filter platform users (admins and managers)
  const platformUsers = mockUsers.filter(u => u.role === 'platform_admin' || u.role === 'platform_manager');

  return (
    <div className={`min-h-screen ${theme === 'dark' ? 'bg-black' : 'bg-gradient-to-br from-slate-50 to-slate-100'} flex items-center justify-center p-4 relative overflow-hidden`}>
      {/* Animated Grid Background */}
      <div className={`absolute inset-0 ${theme === 'dark' ? 'opacity-20' : 'opacity-10'}`} style={{
        backgroundImage: `
          linear-gradient(${theme === 'dark' ? 'rgba(99, 102, 241, 0.1)' : 'rgba(99, 102, 241, 0.15)'} 1px, transparent 1px),
          linear-gradient(90deg, ${theme === 'dark' ? 'rgba(99, 102, 241, 0.1)' : 'rgba(99, 102, 241, 0.15)'} 1px, transparent 1px)
        `,
        backgroundSize: '50px 50px',
        animation: 'grid-flow 20s linear infinite'
      }}></div>

      {/* Blue/Indigo Glowing Orbs */}
      <div className={`absolute top-20 left-20 w-96 h-96 ${theme === 'dark' ? 'bg-gradient-to-br from-blue-500/25 to-indigo-500/25' : 'bg-blue-400/10'} rounded-full blur-[120px] animate-pulse`}></div>
      <div className={`absolute bottom-20 right-20 w-96 h-96 ${theme === 'dark' ? 'bg-gradient-to-br from-indigo-500/25 to-purple-500/25' : 'bg-indigo-400/10'} rounded-full blur-[120px] animate-pulse`} style={{ animationDelay: '1s' }}></div>
      <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] ${theme === 'dark' ? 'bg-gradient-to-br from-blue-600/15 to-purple-600/15' : 'bg-blue-300/10'} rounded-full blur-[140px] animate-pulse`} style={{ animationDelay: '0.5s' }}></div>

      {/* Back Button */}
      <motion.button
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        onClick={() => navigate('/')}
        className={`absolute top-8 left-8 flex items-center gap-2 ${theme === 'dark' ? 'text-blue-400 hover:text-blue-300' : 'text-blue-600 hover:text-blue-700'} transition-colors font-mono`}
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
              animate={{ scale: [1, 1.1, 1] }}
              transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
            >
              <div className="size-20 rounded-xl bg-gradient-to-br from-blue-500 via-indigo-500 to-purple-500 flex items-center justify-center relative">
                <Building2 className="size-10 text-white" />
                <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-blue-500 to-purple-500 blur-xl opacity-50 animate-pulse" />
              </div>
            </motion.div>
            <h1 className={`text-4xl font-bold ${theme === 'dark' ? 'text-white' : 'text-slate-900'} mb-2`}>Platform Access</h1>
            <p className={`${theme === 'dark' ? 'text-blue-400/70' : 'text-blue-600/90'} font-mono`}>Multi-Organization Management</p>
          </div>

          {/* Login Card */}
          <Card className={`${theme === 'dark' ? 'bg-slate-900/50 border-blue-500/30' : 'bg-white/80 border-blue-400/40'} backdrop-blur-xl relative overflow-hidden shadow-2xl`}>
            {/* Glowing Border Effect */}
            <div className={`absolute inset-0 ${theme === 'dark' ? 'bg-gradient-to-r from-blue-500/20 via-indigo-500/20 to-purple-500/20' : 'bg-gradient-to-r from-blue-400/10 via-indigo-400/10 to-purple-400/10'} opacity-50`}></div>
            <motion.div
              className="absolute inset-0 bg-gradient-to-r from-transparent via-blue-500/30 to-transparent"
              animate={{ x: ['-100%', '100%'] }}
              transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
            ></motion.div>

            <CardHeader className="relative">
              <CardTitle className={`text-2xl ${theme === 'dark' ? 'text-white' : 'text-slate-900'} flex items-center gap-2`}>
                <Lock className="size-6 text-blue-400" />
                Platform Authentication
              </CardTitle>
              <CardDescription className={`${theme === 'dark' ? 'text-blue-400/70' : 'text-blue-600/80'} font-mono`}>
                Enter platform credentials to access
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-6 relative">
              <form onSubmit={handleSubmit} className="space-y-4">
                {/* Email Input */}
                <div className="space-y-2">
                  <Label className={`${theme === 'dark' ? 'text-slate-300' : 'text-slate-700'} font-mono`}>Platform Email</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-blue-400" />
                    <Input
                      type="email"
                      placeholder="platform@financeos.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className={`${theme === 'dark' ? 'bg-slate-950/50 border-blue-500/30 text-white' : 'bg-slate-50 border-blue-400/40 text-slate-900'} pl-10 h-12 focus:border-blue-500/50 font-mono`}
                      required
                    />
                  </div>
                </div>

                {/* Password Input */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className={`${theme === 'dark' ? 'text-slate-300' : 'text-slate-700'} font-mono`}>Password</Label>
                    <button
                      type="button"
                      onClick={handleForgotPassword}
                      disabled={isResetting || isLoading}
                      className="text-xs font-mono text-blue-400 hover:text-blue-300 transition-colors disabled:opacity-50"
                    >
                      {isResetting ? 'Sending link...' : 'Forgot password?'}
                    </button>
                  </div>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-blue-400" />
                    <Input
                      type="password"
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className={`${theme === 'dark' ? 'bg-slate-950/50 border-blue-500/30 text-white' : 'bg-slate-50 border-blue-400/40 text-slate-900'} pl-10 h-12 focus:border-blue-500/50 font-mono`}
                      required
                    />
                  </div>
                </div>

                {/* Notice Message */}
                {notice && !error && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg"
                  >
                    <p className="text-blue-300 text-xs font-mono">{notice}</p>
                  </motion.div>
                )}

                {/* Info Message */}
                {infoMessage && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-lg"
                  >
                    <p className="text-emerald-300 text-xs font-mono">{infoMessage}</p>
                  </motion.div>
                )}

                {/* Error Message */}
                {error && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg"
                  >
                    <p className="text-red-400 text-sm font-mono">{error}</p>
                  </motion.div>
                )}

                {/* Loading Progress */}
                {isLoading && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    className="space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-blue-400 text-sm font-mono">Authenticating...</span>
                      <span className="text-blue-400 text-sm font-mono">{scanProgress}%</span>
                    </div>
                    <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                      <motion.div
                        className="h-full bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-500"
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
                  className="w-full h-12 bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-500 hover:from-blue-600 hover:via-indigo-600 hover:to-purple-600 text-white font-bold text-lg relative overflow-hidden group"
                >
                  <div className="absolute inset-0 bg-gradient-to-r from-blue-400/0 to-blue-400/0 group-hover:from-blue-400/20 group-hover:to-purple-400/20 transition-all"></div>
                  <span className="relative z-10 font-mono">
                    {isLoading ? 'AUTHENTICATING...' : 'ACCESS PLATFORM'}
                  </span>
                </Button>
              </form>

              {/* Divider */}
              {platformUsers.length > 0 && (
                <>
                  <div className="relative">
                    <div className="absolute inset-0 flex items-center">
                      <div className="w-full border-t border-blue-500/20"></div>
                    </div>
                    <div className="relative flex justify-center text-xs">
                      <span className={`${theme === 'dark' ? 'bg-slate-900/50' : 'bg-white/80'} px-2 text-blue-400/70 font-mono`}>QUICK ACCESS</span>
                    </div>
                  </div>

                  {/* Demo Platform Accounts */}
                  {/* <div className="space-y-2">
                    {platformUsers.map((user, index) => (
                      <motion.button
                        key={user.email}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.2 + index * 0.1 }}
                        onClick={() => handleDemoLogin(user.email)}
                        disabled={isLoading}
                        className={`w-full p-3 ${theme === 'dark' ? 'bg-slate-950/50 hover:bg-slate-950/80' : 'bg-slate-50 hover:bg-slate-100'} border border-blue-500/20 hover:border-blue-500/40 rounded-lg transition-all group text-left relative overflow-hidden`}
                      >
                        <div className="absolute inset-0 bg-gradient-to-r from-blue-500/0 to-blue-500/0 group-hover:from-blue-500/5 group-hover:to-purple-500/5 transition-all"></div>
                        <div className="flex items-center gap-3 relative z-10">
                          <div className="size-8 rounded-lg bg-gradient-to-br from-blue-500/20 via-indigo-500/20 to-purple-500/20 flex items-center justify-center">
                            <Building2 className="size-4 text-blue-400" />
                          </div>
                          <div className="flex-1">
                            <p className={`text-sm font-medium font-mono ${theme === 'dark' ? 'text-white' : 'text-slate-900'}`}>{user.name}</p>
                            <p className="text-blue-400/70 text-xs font-mono">{user.email}</p>
                          </div>
                          <span className="text-xs text-blue-400 font-mono">PLATFORM</span>
                        </div>
                      </motion.button>
                    ))}
                  </div> */}
                  {/* Footer Note */}
                  <div className="text-center space-y-2">
                    <p className={`text-xs ${theme === 'dark' ? 'text-slate-500' : 'text-slate-600'} font-mono`}>
                      Platform administrator portal — sign in with your administrator credentials
                    </p>
                    {!hasAdmin && (
                      <p className={`text-sm ${theme === 'dark' ? 'text-slate-400' : 'text-slate-600'} font-mono`}>
                        No platform admin configured yet.{' '}
                        <a href="/signup/platform" className={`${theme === 'dark' ? 'text-purple-400 hover:text-purple-300' : 'text-purple-600 hover:text-purple-700'} transition-colors`}>
                          Create initial admin here
                        </a>
                      </p>
                    )}
                  </div>
                </>
              )}
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