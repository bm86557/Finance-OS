import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router';
import { motion } from 'motion/react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Cpu, Lock, Mail, User, Crown, ArrowLeft, Settings } from 'lucide-react';
import { useTheme } from '@/contexts/ThemeContext';
import { authService } from '@/services/authService';

interface PlatformSignupPageProps {
  onLogin: (email: string, password: string) => Promise<void>;
}

export function PlatformSignupPage({ onLogin }: PlatformSignupPageProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [checkingExisting, setCheckingExisting] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const navigate = useNavigate();
  const { theme } = useTheme();

  useEffect(() => {
    let isMounted = true;
    void authService.hasExistingPlatformAdmin().then((exists) => {
      if (!isMounted) return;
      if (exists) {
        // Platform admin already configured — redirect immediately to login
        navigate('/login/platform?notice=admin_exists', { replace: true });
      } else {
        setCheckingExisting(false);
      }
    });
    return () => {
      isMounted = false;
    };
  }, [navigate]);

  if (checkingExisting) {
    return (
      <div className={`min-h-screen ${theme === 'dark' ? 'bg-black' : 'bg-slate-900'} flex items-center justify-center`}>
        <div className="w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');
    setMessage('');

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      setIsLoading(false);
      return;
    }

    if (password.length < 8) {
      setError('Platform admin password must be at least 8 characters');
      setIsLoading(false);
      return;
    }

    try {
      const result = await authService.signupPlatformAdmin({ 
        email, 
        password, 
        fullName: fullName.trim() || undefined
      });
      
      if (result.success && result.data) {
        // Auto-login after successful signup
        await onLogin(email, password);
        navigate('/platform');
      } else if (result.success && result.message) {
        setMessage(result.message);
      } else {
        setError(result.error || 'Signup failed');
      }
    } catch (err) {
      setError('Signup failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={`min-h-screen ${theme === 'dark' ? 'bg-black' : 'bg-gradient-to-br from-slate-50 to-slate-100'} flex items-center justify-center p-4 relative overflow-hidden`}>
      {/* Background Effects */}
      <div className={`absolute inset-0 ${theme === 'dark' ? 'opacity-20' : 'opacity-10'}`} style={{
        backgroundImage: `
          linear-gradient(${theme === 'dark' ? 'rgba(147, 51, 234, 0.1)' : 'rgba(147, 51, 234, 0.15)'} 1px, transparent 1px),
          linear-gradient(90deg, ${theme === 'dark' ? 'rgba(147, 51, 234, 0.1)' : 'rgba(147, 51, 234, 0.15)'} 1px, transparent 1px)
        `,
        backgroundSize: '50px 50px',
        animation: 'grid-flow 20s linear infinite'
      }}></div>

      {/* Purple Glowing Orbs */}
      <div className={`absolute top-20 left-20 w-96 h-96 ${theme === 'dark' ? 'bg-purple-500/20' : 'bg-purple-400/10'} rounded-full blur-[120px] animate-pulse`}></div>
      <div className={`absolute bottom-20 right-20 w-96 h-96 ${theme === 'dark' ? 'bg-indigo-500/20' : 'bg-indigo-400/10'} rounded-full blur-[120px] animate-pulse`} style={{ animationDelay: '1s' }}></div>

      {/* Back Button */}
      <motion.button
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        onClick={() => navigate('/')}
        className={`absolute top-8 left-8 flex items-center gap-2 ${theme === 'dark' ? 'text-purple-400 hover:text-purple-300' : 'text-purple-600 hover:text-purple-700'} transition-colors font-mono`}
      >
        <ArrowLeft className="size-5" />
        <span>Back to Portal</span>
      </motion.button>

      <div className="w-full max-w-4xl relative z-10">
        <div className="grid md:grid-cols-2 gap-8 items-center">
          {/* Left Side - Branding */}
          <motion.div
            initial={{ opacity: 0, x: -50 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8 }}
            className="text-center md:text-left space-y-6"
          >
            {/* Logo */}
            <div className="inline-block relative">
              <div className={`size-24 rounded-2xl ${theme === 'dark' ? 'bg-gradient-to-br from-purple-500 via-indigo-500 to-blue-500' : 'bg-gradient-to-br from-purple-400 via-indigo-400 to-blue-400'} flex items-center justify-center relative`}>
                <Cpu className="size-12 text-white" />
                <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-purple-500 to-indigo-500 blur-2xl opacity-50"></div>
              </div>
            </div>

            <div>
              <h1 className="text-6xl font-bold mb-4">
                <span className={`bg-gradient-to-r ${theme === 'dark' ? 'from-purple-400 via-indigo-400 to-blue-400' : 'from-purple-600 via-indigo-600 to-blue-600'} bg-clip-text text-transparent`}>
                  Platform Admin
                </span>
              </h1>
              <p className={`text-xl ${theme === 'dark' ? 'text-purple-400/70' : 'text-purple-600/70'} mb-2 font-mono`}>
                Master Control Access
              </p>
              <p className={`${theme === 'dark' ? 'text-slate-400' : 'text-slate-600'} max-w-md`}>
                Create a platform administrator account with system-wide access to manage multiple organizations, users, and platform settings.
              </p>
            </div>

            {/* Features */}
            <div className="space-y-3">
              {[
                { icon: Crown, text: 'System-Wide Control' },
                { icon: Settings, text: 'Platform Configuration' },
                { icon: Cpu, text: 'Multi-Org Management' }
              ].map((feature, index) => (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.3 + index * 0.1 }}
                  className="flex items-center gap-3"
                >
                  <div className={`size-10 rounded-lg ${theme === 'dark' ? 'bg-purple-500/10 border-purple-500/20' : 'bg-purple-100 border-purple-200'} flex items-center justify-center border`}>
                    <feature.icon className={`size-5 ${theme === 'dark' ? 'text-purple-400' : 'text-purple-600'}`} />
                  </div>
                  <span className={`${theme === 'dark' ? 'text-slate-300' : 'text-slate-700'} font-mono`}>{feature.text}</span>
                </motion.div>
              ))}
            </div>

            {/* Warning */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.6 }}
              className={`p-4 rounded-lg ${theme === 'dark' ? 'bg-amber-500/10 border-amber-500/20' : 'bg-amber-100 border-amber-200'} border`}
            >
              <p className={`text-sm ${theme === 'dark' ? 'text-amber-400' : 'text-amber-700'} font-mono`}>
                <Crown className="inline size-4 mr-2" />
                Platform Admin accounts have elevated privileges. Use responsibly.
              </p>
            </motion.div>
          </motion.div>

          {/* Right Side - Signup Form */}
          <motion.div
            initial={{ opacity: 0, x: 50 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8 }}
          >
            <Card className={`${theme === 'dark' ? 'bg-slate-900/50 border-purple-500/30' : 'bg-white/70 border-purple-200'} backdrop-blur-xl relative overflow-hidden`}>
              {/* Glowing Border Effect */}
              <div className={`absolute inset-0 ${theme === 'dark' ? 'bg-gradient-to-r from-purple-500/20 via-indigo-500/20 to-blue-500/20 opacity-50' : 'bg-gradient-to-r from-purple-200/30 via-indigo-200/30 to-blue-200/30 opacity-70'}`}></div>

              <CardHeader className="relative">
                <CardTitle className={`text-2xl ${theme === 'dark' ? 'text-white' : 'text-slate-900'} flex items-center gap-2`}>
                  <Crown className={`size-6 ${theme === 'dark' ? 'text-purple-400' : 'text-purple-600'}`} />
                  Platform Admin Account
                </CardTitle>
                <CardDescription className={`${theme === 'dark' ? 'text-purple-400/70' : 'text-purple-600/70'} font-mono`}>
                  Register for system-wide access
                </CardDescription>
              </CardHeader>

              <CardContent className="space-y-6 relative">
                <form onSubmit={handleSubmit} className="space-y-4">
                  {/* Full Name */}
                  <div className="space-y-2">
                    <Label className={`${theme === 'dark' ? 'text-slate-300' : 'text-slate-700'} font-mono`}>Full Name</Label>
                    <div className="relative">
                      <User className={`absolute left-3 top-1/2 -translate-y-1/2 size-4 ${theme === 'dark' ? 'text-purple-400' : 'text-purple-600'}`} />
                      <Input
                        type="text"
                        placeholder="Platform Administrator"
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        className={`${theme === 'dark' ? 'bg-slate-950/50 border-purple-500/30 text-white focus:border-purple-500/50' : 'bg-white/50 border-purple-200 text-slate-900 focus:border-purple-400'} pl-10 h-12 font-mono`}
                        required
                      />
                    </div>
                  </div>

                  {/* Email Input */}
                  <div className="space-y-2">
                    <Label className={`${theme === 'dark' ? 'text-slate-300' : 'text-slate-700'} font-mono`}>Email Address</Label>
                    <div className="relative">
                      <Mail className={`absolute left-3 top-1/2 -translate-y-1/2 size-4 ${theme === 'dark' ? 'text-purple-400' : 'text-purple-600'}`} />
                      <Input
                        type="email"
                        placeholder="admin@platform.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className={`${theme === 'dark' ? 'bg-slate-950/50 border-purple-500/30 text-white focus:border-purple-500/50' : 'bg-white/50 border-purple-200 text-slate-900 focus:border-purple-400'} pl-10 h-12 font-mono`}
                        required
                      />
                    </div>
                  </div>

                  {/* Password Input */}
                  <div className="space-y-2">
                    <Label className={`${theme === 'dark' ? 'text-slate-300' : 'text-slate-700'} font-mono`}>Password</Label>
                    <div className="relative">
                      <Lock className={`absolute left-3 top-1/2 -translate-y-1/2 size-4 ${theme === 'dark' ? 'text-purple-400' : 'text-purple-600'}`} />
                      <Input
                        type="password"
                        placeholder="••••••••"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className={`${theme === 'dark' ? 'bg-slate-950/50 border-purple-500/30 text-white focus:border-purple-500/50' : 'bg-white/50 border-purple-200 text-slate-900 focus:border-purple-400'} pl-10 h-12 font-mono`}
                        required
                        minLength={8}
                      />
                    </div>
                    <p className={`text-xs ${theme === 'dark' ? 'text-slate-400' : 'text-slate-500'} font-mono`}>
                      Minimum 8 characters for platform admin access
                    </p>
                  </div>

                  {/* Confirm Password Input */}
                  <div className="space-y-2">
                    <Label className={`${theme === 'dark' ? 'text-slate-300' : 'text-slate-700'} font-mono`}>Confirm Password</Label>
                    <div className="relative">
                      <Lock className={`absolute left-3 top-1/2 -translate-y-1/2 size-4 ${theme === 'dark' ? 'text-purple-400' : 'text-purple-600'}`} />
                      <Input
                        type="password"
                        placeholder="••••••••"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        className={`${theme === 'dark' ? 'bg-slate-950/50 border-purple-500/30 text-white focus:border-purple-500/50' : 'bg-white/50 border-purple-200 text-slate-900 focus:border-purple-400'} pl-10 h-12 font-mono`}
                        required
                      />
                    </div>
                  </div>

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

                  {/* Success Message */}
                  {message && (
                    <motion.div
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="p-3 bg-green-500/10 border border-green-500/30 rounded-lg"
                    >
                      <p className="text-green-400 text-sm font-mono">{message}</p>
                    </motion.div>
                  )}

                  {/* Submit Button */}
                  <Button
                    type="submit"
                    disabled={isLoading}
                    className={`w-full h-12 ${theme === 'dark' ? 'bg-gradient-to-r from-purple-500 to-indigo-500 hover:from-purple-600 hover:to-indigo-600' : 'bg-gradient-to-r from-purple-500 to-indigo-500 hover:from-purple-600 hover:to-indigo-600'} text-white font-bold text-lg relative overflow-hidden group`}
                  >
                    <div className="absolute inset-0 bg-gradient-to-r from-purple-400/0 to-purple-400/0 group-hover:from-purple-400/20 group-hover:to-indigo-400/20 transition-all"></div>
                    <span className="relative z-10 font-mono">
                      {isLoading ? 'CREATING PLATFORM ACCESS...' : 'CREATE PLATFORM ADMIN'}
                    </span>
                  </Button>
                </form>

                {/* Footer Note */}
                <div className="text-center pt-4 border-t border-purple-500/20">
                  <p className={`text-sm ${theme === 'dark' ? 'text-slate-400' : 'text-slate-600'} font-mono`}>
                    Already have platform admin access?{' '}
                    <Link to="/login/platform" className={`${theme === 'dark' ? 'text-purple-400 hover:text-purple-300' : 'text-purple-600 hover:text-purple-700'} transition-colors`}>
                      Sign in here
                    </Link>
                  </p>
                </div>
              </CardContent>
            </Card>
          </motion.div>
        </div>
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