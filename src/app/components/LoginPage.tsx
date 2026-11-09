import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { motion } from 'motion/react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Building2, Sparkles, Lock, Mail, Cpu, Orbit, Zap, Shield } from 'lucide-react';
import { mockUsers } from '../../lib/mockData';
import { useTheme } from '@/contexts/ThemeContext';
import { SupabaseConnectionPanel } from './SupabaseConnectionPanel';
import type { PortalType } from '@/services/authSessionTypes';

interface LoginPageProps {
  onLogin: (email: string, password: string, orgSlug?: string, portalType?: PortalType) => Promise<void>;
}

export function LoginPage({ onLogin }: LoginPageProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [scanProgress, setScanProgress] = useState(0);
  const navigate = useNavigate();
  const { theme } = useTheme();

  // Check for URL messages
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const message = params.get('message');
    
    if (message === 'email_expired') {
      setError('Email verification link expired. Please sign up again or try logging in if you already have an account.');
      // Clear the message from URL
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  useEffect(() => {
    if (isLoading && scanProgress < 100) {
      const timer = setTimeout(() => {
        setScanProgress(prev => Math.min(prev + 10, 100));
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isLoading, scanProgress]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setScanProgress(0);
    setError('');

    try {
      await onLogin(email, password);
      navigate('/');
    } catch (err) {
      setError('Invalid credentials. Try one of the demo accounts.');
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
      await onLogin(demoEmail, 'demo');
      navigate('/');
    } catch (err) {
      setError('Login failed.');
    } finally {
      setIsLoading(false);
      setScanProgress(0);
    }
  };

  return (
    <div className="min-h-screen bg-black flex items-center justify-center p-4 relative overflow-hidden">
      {/* Subtle Gradient Overlay */}
      <div className="absolute inset-0 bg-gradient-to-br from-purple-950/20 via-black to-pink-950/20"></div>
      
      {/* Subtle Finance Elements */}
      <div className="absolute inset-0 opacity-[0.02]">
        <div className="absolute top-1/4 left-1/4 text-purple-500/40 text-9xl font-bold">$</div>
        <div className="absolute bottom-1/3 right-1/4 text-pink-500/40 text-8xl font-bold">€</div>
        <div className="absolute top-1/2 right-1/3 text-purple-500/40 text-7xl font-bold">¥</div>
      </div>

      {/* Animated Grid Background */}
      <div className="absolute inset-0 opacity-20" style={{
        backgroundImage: `
          linear-gradient(rgba(6, 182, 212, 0.1) 1px, transparent 1px),
          linear-gradient(90deg, rgba(6, 182, 212, 0.1) 1px, transparent 1px)
        `,
        backgroundSize: '50px 50px',
        animation: 'grid-flow 20s linear infinite'
      }}></div>

      {/* Glowing Orbs */}
      <div className="absolute top-20 left-20 w-96 h-96 bg-purple-500/20 rounded-full blur-[120px] animate-pulse"></div>
      <div className="absolute bottom-20 right-20 w-96 h-96 bg-pink-500/20 rounded-full blur-[120px] animate-pulse" style={{ animationDelay: '1s' }}></div>

      <div className="w-full max-w-6xl relative z-10">
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
              <div className="size-24 rounded-2xl bg-gradient-to-br from-purple-500 via-pink-500 to-red-500 flex items-center justify-center relative">
                <Cpu className="size-12 text-white" />
                <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-purple-500 to-pink-500 blur-2xl opacity-50"></div>
              </div>
            </div>

            <div>
              <h1 className="text-6xl font-bold mb-4">
                <span className="bg-gradient-to-r from-purple-400 via-pink-400 to-red-400 bg-clip-text text-transparent">
                  Finance OS
                </span>
              </h1>
              <p className="text-xl text-purple-400/70 mb-2 font-mono">
                Agency Financial Intelligence System
              </p>
              <p className="text-slate-400 max-w-md">
                Next-generation AI-powered financial command center designed for agencies and software houses in 2050.
              </p>
            </div>

            {/* Features */}
            <div className="space-y-3">
              {[
                { icon: Zap, text: 'AI-Powered Intelligence' },
                { icon: Shield, text: 'Multi-Organization Security' },
                { icon: Orbit, text: 'Predictive Analytics' }
              ].map((feature, index) => (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.3 + index * 0.1 }}
                  className="flex items-center gap-3"
                >
                  <div className="size-10 rounded-lg bg-purple-500/10 flex items-center justify-center border border-purple-500/20">
                    <feature.icon className="size-5 text-purple-400" />
                  </div>
                  <span className="text-slate-300 font-mono">{feature.text}</span>
                </motion.div>
              ))}
            </div>

            {/* Status */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.6 }}
              className="flex items-center gap-2 text-green-400"
            >
              <motion.div
                animate={{ scale: [1, 1.2, 1] }}
                transition={{ duration: 2, repeat: Infinity }}
                className="size-2 rounded-full bg-green-400 shadow-lg shadow-green-400/50"
              ></motion.div>
              <span className="text-sm font-mono">ALL SYSTEMS OPERATIONAL</span>
            </motion.div>
          </motion.div>

          {/* Right Side - Login Form */}
          <motion.div
            initial={{ opacity: 0, x: 50 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8 }}
          >
            <Card className="bg-slate-900/50 backdrop-blur-xl border-purple-500/30 relative overflow-hidden">
              {/* Glowing Border Effect */}
              <div className="absolute inset-0 bg-gradient-to-r from-purple-500/20 via-pink-500/20 to-red-500/20 opacity-50"></div>

              <CardHeader className="relative">
                <CardTitle className="text-2xl text-white flex items-center gap-2">
                  <Lock className="size-6 text-purple-400" />
                  Access Control
                </CardTitle>
                <CardDescription className="text-purple-400/70 font-mono">
                  Enter credentials to initialize system
                </CardDescription>
              </CardHeader>

              <CardContent className="space-y-6 relative">
                <form onSubmit={handleSubmit} className="space-y-4">
                  {/* Email Input */}
                  <div className="space-y-2">
                    <Label className="text-slate-300 font-mono">Email Address</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-purple-400" />
                      <Input
                        type="email"
                        placeholder="user@agency.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="bg-slate-950/50 border-purple-500/30 text-white pl-10 h-12 focus:border-purple-500/50 font-mono"
                        required
                      />
                    </div>
                  </div>

                  {/* Password Input */}
                  <div className="space-y-2">
                    <Label className="text-slate-300 font-mono">Password</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-purple-400" />
                      <Input
                        type="password"
                        placeholder="••••••••"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="bg-slate-950/50 border-purple-500/30 text-white pl-10 h-12 focus:border-purple-500/50 font-mono"
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

                  {/* Loading Progress */}
                  {isLoading && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      className="space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-purple-400 text-sm font-mono">Authenticating...</span>
                        <span className="text-purple-400 text-sm font-mono">{scanProgress}%</span>
                      </div>
                      <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                        <motion.div
                          className="h-full bg-gradient-to-r from-purple-500 via-pink-500 to-red-500"
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
                    className="w-full h-12 bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white font-bold text-lg relative overflow-hidden group"
                  >
                    <div className="absolute inset-0 bg-gradient-to-r from-purple-400/0 to-purple-400/0 group-hover:from-purple-400/20 group-hover:to-pink-400/20 transition-all"></div>
                    <span className="relative z-10 font-mono">
                      {isLoading ? 'INITIALIZING...' : 'ACCESS SYSTEM'}
                    </span>
                  </Button>
                </form>

                <SupabaseConnectionPanel />

                {/* Divider */}
                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-purple-500/20"></div>
                  </div>
                  <div className="relative flex justify-center text-xs">
                    <span className="bg-slate-900/50 px-2 text-purple-400/70 font-mono">QUICK ACCESS</span>
                  </div>
                </div>

                {/* Demo Accounts */}
                <div className="space-y-2">
                  {mockUsers.slice(0, 3).map((user, index) => (
                    <motion.button
                      key={user.email}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.2 + index * 0.1 }}
                      onClick={() => handleDemoLogin(user.email)}
                      disabled={isLoading}
                      className="w-full p-3 bg-slate-950/50 hover:bg-slate-950/80 border border-purple-500/20 hover:border-purple-500/40 rounded-lg transition-all group text-left relative overflow-hidden"
                    >
                      <div className="absolute inset-0 bg-gradient-to-r from-purple-500/0 to-purple-500/0 group-hover:from-purple-500/5 group-hover:to-pink-500/5 transition-all"></div>
                      <div className="flex items-center gap-3 relative z-10">
                        <div className="size-8 rounded-lg bg-gradient-to-br from-purple-500/20 to-pink-500/20 flex items-center justify-center">
                          <Building2 className="size-4 text-purple-400" />
                        </div>
                        <div className="flex-1">
                          <p className="text-white text-sm font-medium font-mono">{user.name}</p>
                          <p className="text-purple-400/70 text-xs font-mono">{user.email}</p>
                        </div>
                        <span className="text-xs text-slate-500 font-mono">{user.role.replace('_', ' ').toUpperCase()}</span>
                      </div>
                    </motion.button>
                  ))}
                </div>

                {/* Footer Note */}
                <div className="text-center space-y-2">
                  <p className="text-xs text-slate-500 font-mono">
                    Demo account — click a name above to sign in instantly
                  </p>
                  <p className="text-sm text-slate-400 font-mono">
                    Joining a team?{' '}
                    <a href="/login/employee" className="text-purple-400 hover:text-purple-300 transition-colors">
                      Use your invitation email
                    </a>
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