import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { motion } from 'motion/react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Sparkles, Lock, Mail, ArrowLeft, Zap, Brain } from 'lucide-react';
import { useTheme } from '@/contexts/ThemeContext';
import type { PortalType } from '@/services/authSessionTypes';

interface BingLoginPageProps {
  onLogin: (email: string, password: string, orgSlug?: string, portalType?: PortalType) => Promise<void>;
}

export function BingLoginPage({ onLogin }: BingLoginPageProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [scanProgress, setScanProgress] = useState(0);
  const [aiStatus, setAiStatus] = useState('Initializing AI...');
  const navigate = useNavigate();
  const { theme } = useTheme();

  useEffect(() => {
    if (isLoading && scanProgress < 100) {
      const timer = setTimeout(() => {
        setScanProgress(prev => Math.min(prev + 10, 100));
        // Update AI status based on progress
        if (scanProgress < 30) setAiStatus('Scanning biometric patterns...');
        else if (scanProgress < 60) setAiStatus('Analyzing neural signatures...');
        else if (scanProgress < 90) setAiStatus('Verifying quantum credentials...');
        else setAiStatus('Authentication complete!');
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isLoading, scanProgress]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setScanProgress(0);
    setError('');
    setAiStatus('Initializing AI...');

    try {
      await onLogin(email, password, undefined, 'ai_assistant');
      navigate('/ai-portal');
    } catch (err: any) {
      setError(err?.message || 'Access denied or authentication failed.');
    } finally {
      setIsLoading(false);
      setScanProgress(0);
      setAiStatus('Initializing AI...');
    }
  };


  return (
    <div className={`min-h-screen ${theme === 'dark' ? 'bg-black' : 'bg-gradient-to-br from-slate-50 to-slate-100'} flex items-center justify-center p-4 relative overflow-hidden`}>
      {/* Animated Grid Background */}
      <div className={`absolute inset-0 ${theme === 'dark' ? 'opacity-20' : 'opacity-10'}`} style={{
        backgroundImage: `
          linear-gradient(${theme === 'dark' ? 'rgba(168, 85, 247, 0.1)' : 'rgba(168, 85, 247, 0.15)'} 1px, transparent 1px),
          linear-gradient(90deg, ${theme === 'dark' ? 'rgba(168, 85, 247, 0.1)' : 'rgba(168, 85, 247, 0.15)'} 1px, transparent 1px)
        `,
        backgroundSize: '50px 50px',
        animation: 'grid-flow 20s linear infinite'
      }}></div>

      {/* Purple/Pink/Rose Glowing Orbs with Gradients */}
      <div className={`absolute top-20 left-20 w-96 h-96 ${theme === 'dark' ? 'bg-gradient-to-br from-purple-500/30 to-pink-500/30' : 'bg-purple-400/10'} rounded-full blur-[120px] animate-pulse`}></div>
      <div className={`absolute bottom-20 right-20 w-96 h-96 ${theme === 'dark' ? 'bg-gradient-to-br from-pink-500/30 to-rose-500/30' : 'bg-pink-400/10'} rounded-full blur-[120px] animate-pulse`} style={{ animationDelay: '1s' }}></div>
      <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] ${theme === 'dark' ? 'bg-gradient-to-br from-violet-600/20 to-fuchsia-600/20' : 'bg-purple-300/10'} rounded-full blur-[150px] animate-pulse`} style={{ animationDelay: '0.7s' }}></div>

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
              animate={{
                rotate: [0, 360],
                scale: [1, 1.2, 1]
              }}
              transition={{
                duration: 4,
                repeat: Infinity,
                ease: "linear"
              }}
            >
              <div className="size-20 rounded-xl bg-gradient-to-br from-purple-500 via-pink-500 to-rose-500 flex items-center justify-center relative">
                <Brain className="size-10 text-white" />
                <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 blur-xl opacity-50 animate-pulse" />
                <motion.div
                  className="absolute inset-0 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500"
                  animate={{ scale: [1, 1.3, 1], opacity: [0.5, 0, 0.5] }}
                  transition={{ duration: 2, repeat: Infinity }}
                />
              </div>
            </motion.div>
            <h1 className={`text-4xl font-bold ${theme === 'dark' ? 'text-white' : 'text-slate-900'} mb-2`}>Bing AI Access</h1>
            <p className={`${theme === 'dark' ? 'text-purple-400/70' : 'text-purple-600/90'} font-mono flex items-center justify-center gap-2`}>
              <Sparkles className="size-4" />
              AI-Powered Authentication
              <Sparkles className="size-4" />
            </p>
          </div>

          {/* Login Card */}
          <Card className={`${theme === 'dark' ? 'bg-slate-900/50 border-purple-500/30' : 'bg-white/80 border-purple-400/40'} backdrop-blur-xl relative overflow-hidden shadow-2xl`}>
            {/* Glowing Border Effect */}
            <div className={`absolute inset-0 ${theme === 'dark' ? 'bg-gradient-to-r from-purple-500/20 via-pink-500/20 to-rose-500/20' : 'bg-gradient-to-r from-purple-400/10 via-pink-400/10 to-rose-400/10'} opacity-50`}></div>
            <motion.div
              className="absolute inset-0 bg-gradient-to-r from-transparent via-purple-500/30 to-transparent"
              animate={{ x: ['-100%', '100%'] }}
              transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
            ></motion.div>

            {/* Floating AI Particles */}
            <motion.div
              className="absolute top-10 left-10 w-2 h-2 bg-purple-400 rounded-full"
              animate={{
                y: [0, -20, 0],
                opacity: [1, 0.3, 1]
              }}
              transition={{ duration: 3, repeat: Infinity }}
            />
            <motion.div
              className="absolute bottom-10 right-10 w-2 h-2 bg-pink-400 rounded-full"
              animate={{
                y: [0, -20, 0],
                opacity: [1, 0.3, 1]
              }}
              transition={{ duration: 3, repeat: Infinity, delay: 1.5 }}
            />

            <CardHeader className="relative">
              <CardTitle className={`text-2xl ${theme === 'dark' ? 'text-white' : 'text-slate-900'} flex items-center gap-2`}>
                <Zap className="size-6 text-purple-400" />
                AI Authentication
              </CardTitle>
              <CardDescription className={`${theme === 'dark' ? 'text-purple-400/70' : 'text-purple-600/80'} font-mono`}>
                Enter Platform Admin credentials to access
              </CardDescription>
            </CardHeader>

            <CardContent className="space-y-6 relative">
              <form onSubmit={handleSubmit} className="space-y-4">
                {/* Email Input */}
                <div className="space-y-2">
                  <Label className={`${theme === 'dark' ? 'text-slate-300' : 'text-slate-700'} font-mono`}>AI Email</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-purple-400" />
                    <Input
                      type="email"
                      placeholder="admin@yourcompany.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className={`${theme === 'dark' ? 'bg-slate-950/50 border-purple-500/30 text-white' : 'bg-slate-50 border-purple-400/40 text-slate-900'} pl-10 h-12 focus:border-purple-500/50 font-mono`}
                      required
                    />
                  </div>
                </div>

                {/* Password Input */}
                <div className="space-y-2">
                  <Label className={`${theme === 'dark' ? 'text-slate-300' : 'text-slate-700'} font-mono`}>Password</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-purple-400" />
                    <Input
                      type="password"
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className={`${theme === 'dark' ? 'bg-slate-950/50 border-purple-500/30 text-white' : 'bg-slate-50 border-purple-400/40 text-slate-900'} pl-10 h-12 focus:border-purple-500/50 font-mono`}
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

                {/* Loading Progress with AI Status */}
                {isLoading && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    className="space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-purple-400 text-sm font-mono flex items-center gap-2">
                        <Brain className="size-4 animate-pulse" />
                        {aiStatus}
                      </span>
                      <span className="text-purple-400 text-sm font-mono">{scanProgress}%</span>
                    </div>
                    <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                      <motion.div
                        className="h-full bg-gradient-to-r from-purple-500 via-pink-500 to-rose-500"
                        style={{ width: `${scanProgress}%` }}
                      >
                        <motion.div
                          className="absolute inset-0 bg-white/30"
                          animate={{ x: ['-100%', '100%'] }}
                          transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                        />
                      </motion.div>
                    </div>
                  </motion.div>
                )}

                {/* Submit Button */}
                <Button
                  type="submit"
                  disabled={isLoading}
                  className="w-full h-12 bg-gradient-to-r from-purple-500 via-pink-500 to-rose-500 hover:from-purple-600 hover:via-pink-600 hover:to-rose-600 text-white font-bold text-lg relative overflow-hidden group"
                >
                  <div className="absolute inset-0 bg-gradient-to-r from-purple-400/0 to-purple-400/0 group-hover:from-purple-400/20 group-hover:to-rose-400/20 transition-all"></div>
                  <span className="relative z-10 font-mono flex items-center justify-center gap-2">
                    {isLoading ? (
                      <>
                        <Brain className="size-5 animate-pulse" />
                        AI PROCESSING...
                      </>
                    ) : (
                      <>
                        <Zap className="size-5" />
                        ACCESS AI SYSTEM
                      </>
                    )}
                  </span>
                </Button>
              </form>

              {/* Security Access Notice */}
              <div className="pt-3 border-t border-purple-500/20 flex items-center justify-between text-[11px] font-mono text-purple-400/80">
                <span className="flex items-center gap-1.5">
                  <Lock className="size-3 text-purple-400" />
                  RESTRICTED PORTAL
                </span>
                <span className="text-slate-400">Platform Admin Credentials Required</span>
              </div>
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