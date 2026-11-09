import { useState } from 'react';
import { useNavigate, Link } from 'react-router';
import { motion } from 'motion/react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Bot, Lock, Mail, User, Sparkles, ArrowLeft, Brain, Zap } from 'lucide-react';
import { useTheme } from '@/contexts/ThemeContext';
import { authService } from '@/services/authService';

interface BingSignupPageProps {
  onLogin: (email: string, password: string) => Promise<void>;
}

export function BingSignupPage({ onLogin }: BingSignupPageProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const navigate = useNavigate();
  const { theme } = useTheme();

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

    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      setIsLoading(false);
      return;
    }

    try {
      const result = await authService.signup({ 
        email, 
        password 
      });
      
      if (result.success && result.data) {
        // Auto-login after successful signup
        await onLogin(email, password);
        navigate('/');
      } else if (result.success && result.message) {
        setMessage(result.message + ' You can use AI Assistant features once verified.');
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
          linear-gradient(${theme === 'dark' ? 'rgba(236, 72, 153, 0.1)' : 'rgba(236, 72, 153, 0.15)'} 1px, transparent 1px),
          linear-gradient(90deg, ${theme === 'dark' ? 'rgba(236, 72, 153, 0.1)' : 'rgba(236, 72, 153, 0.15)'} 1px, transparent 1px)
        `,
        backgroundSize: '50px 50px',
        animation: 'grid-flow 20s linear infinite'
      }}></div>

      {/* Pink/Orange Glowing Orbs */}
      <div className={`absolute top-20 left-20 w-96 h-96 ${theme === 'dark' ? 'bg-pink-500/20' : 'bg-pink-400/10'} rounded-full blur-[120px] animate-pulse`}></div>
      <div className={`absolute bottom-20 right-20 w-96 h-96 ${theme === 'dark' ? 'bg-orange-500/20' : 'bg-orange-400/10'} rounded-full blur-[120px] animate-pulse`} style={{ animationDelay: '1s' }}></div>

      {/* Back Button */}
      <motion.button
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        onClick={() => navigate('/')}
        className={`absolute top-8 left-8 flex items-center gap-2 ${theme === 'dark' ? 'text-pink-400 hover:text-pink-300' : 'text-pink-600 hover:text-pink-700'} transition-colors font-mono`}
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
              <div className={`size-24 rounded-2xl ${theme === 'dark' ? 'bg-gradient-to-br from-pink-500 via-orange-500 to-red-500' : 'bg-gradient-to-br from-pink-400 via-orange-400 to-red-400'} flex items-center justify-center relative`}>
                <Bot className="size-12 text-white" />
                <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-pink-500 to-orange-500 blur-2xl opacity-50"></div>
              </div>
            </div>

            <div>
              <h1 className="text-6xl font-bold mb-4">
                <span className={`bg-gradient-to-r ${theme === 'dark' ? 'from-pink-400 via-orange-400 to-red-400' : 'from-pink-600 via-orange-600 to-red-600'} bg-clip-text text-transparent`}>
                  AI Assistant
                </span>
              </h1>
              <p className={`text-xl ${theme === 'dark' ? 'text-pink-400/70' : 'text-pink-600/70'} mb-2 font-mono`}>
                AI-Powered Access
              </p>
              <p className={`${theme === 'dark' ? 'text-slate-400' : 'text-slate-600'} max-w-md`}>
                Join the AI-powered financial intelligence system. Get personalized insights, automated workflows, and intelligent recommendations.
              </p>
            </div>

            {/* Features */}
            <div className="space-y-3">
              {[
                { icon: Brain, text: 'Intelligent Analytics' },
                { icon: Sparkles, text: 'Smart Automation' },
                { icon: Zap, text: 'Real-time Insights' }
              ].map((feature, index) => (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.3 + index * 0.1 }}
                  className="flex items-center gap-3"
                >
                  <div className={`size-10 rounded-lg ${theme === 'dark' ? 'bg-pink-500/10 border-pink-500/20' : 'bg-pink-100 border-pink-200'} flex items-center justify-center border`}>
                    <feature.icon className={`size-5 ${theme === 'dark' ? 'text-pink-400' : 'text-pink-600'}`} />
                  </div>
                  <span className={`${theme === 'dark' ? 'text-slate-300' : 'text-slate-700'} font-mono`}>{feature.text}</span>
                </motion.div>
              ))}
            </div>

            {/* AI Status */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.6 }}
              className="flex items-center gap-2 text-pink-400"
            >
              <motion.div
                animate={{ 
                  scale: [1, 1.2, 1],
                  opacity: [0.5, 1, 0.5]
                }}
                transition={{ duration: 2, repeat: Infinity }}
                className={`size-2 rounded-full ${theme === 'dark' ? 'bg-pink-400 shadow-lg shadow-pink-400/50' : 'bg-pink-500 shadow-lg shadow-pink-500/50'}`}
              ></motion.div>
              <span className="text-sm font-mono">AI SYSTEMS ONLINE</span>
            </motion.div>
          </motion.div>

          {/* Right Side - Signup Form */}
          <motion.div
            initial={{ opacity: 0, x: 50 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8 }}
          >
            <Card className={`${theme === 'dark' ? 'bg-slate-900/50 border-pink-500/30' : 'bg-white/70 border-pink-200'} backdrop-blur-xl relative overflow-hidden`}>
              {/* Glowing Border Effect */}
              <div className={`absolute inset-0 ${theme === 'dark' ? 'bg-gradient-to-r from-pink-500/20 via-orange-500/20 to-red-500/20 opacity-50' : 'bg-gradient-to-r from-pink-200/30 via-orange-200/30 to-red-200/30 opacity-70'}`}></div>

              <CardHeader className="relative">
                <CardTitle className={`text-2xl ${theme === 'dark' ? 'text-white' : 'text-slate-900'} flex items-center gap-2`}>
                  <Bot className={`size-6 ${theme === 'dark' ? 'text-pink-400' : 'text-pink-600'}`} />
                  AI Assistant Access
                </CardTitle>
                <CardDescription className={`${theme === 'dark' ? 'text-pink-400/70' : 'text-pink-600/70'} font-mono`}>
                  Connect with AI-powered insights
                </CardDescription>
              </CardHeader>

              <CardContent className="space-y-6 relative">
                <form onSubmit={handleSubmit} className="space-y-4">
                  {/* Full Name */}
                  <div className="space-y-2">
                    <Label className={`${theme === 'dark' ? 'text-slate-300' : 'text-slate-700'} font-mono`}>Full Name</Label>
                    <div className="relative">
                      <User className={`absolute left-3 top-1/2 -translate-y-1/2 size-4 ${theme === 'dark' ? 'text-pink-400' : 'text-pink-600'}`} />
                      <Input
                        type="text"
                        placeholder="AI Assistant User"
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        className={`${theme === 'dark' ? 'bg-slate-950/50 border-pink-500/30 text-white focus:border-pink-500/50' : 'bg-white/50 border-pink-200 text-slate-900 focus:border-pink-400'} pl-10 h-12 font-mono`}
                      />
                    </div>
                  </div>

                  {/* Email Input */}
                  <div className="space-y-2">
                    <Label className={`${theme === 'dark' ? 'text-slate-300' : 'text-slate-700'} font-mono`}>Email Address</Label>
                    <div className="relative">
                      <Mail className={`absolute left-3 top-1/2 -translate-y-1/2 size-4 ${theme === 'dark' ? 'text-pink-400' : 'text-pink-600'}`} />
                      <Input
                        type="email"
                        placeholder="ai-user@company.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className={`${theme === 'dark' ? 'bg-slate-950/50 border-pink-500/30 text-white focus:border-pink-500/50' : 'bg-white/50 border-pink-200 text-slate-900 focus:border-pink-400'} pl-10 h-12 font-mono`}
                        required
                      />
                    </div>
                  </div>

                  {/* Password Input */}
                  <div className="space-y-2">
                    <Label className={`${theme === 'dark' ? 'text-slate-300' : 'text-slate-700'} font-mono`}>Password</Label>
                    <div className="relative">
                      <Lock className={`absolute left-3 top-1/2 -translate-y-1/2 size-4 ${theme === 'dark' ? 'text-pink-400' : 'text-pink-600'}`} />
                      <Input
                        type="password"
                        placeholder="••••••••"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className={`${theme === 'dark' ? 'bg-slate-950/50 border-pink-500/30 text-white focus:border-pink-500/50' : 'bg-white/50 border-pink-200 text-slate-900 focus:border-pink-400'} pl-10 h-12 font-mono`}
                        required
                        minLength={6}
                      />
                    </div>
                  </div>

                  {/* Confirm Password Input */}
                  <div className="space-y-2">
                    <Label className={`${theme === 'dark' ? 'text-slate-300' : 'text-slate-700'} font-mono`}>Confirm Password</Label>
                    <div className="relative">
                      <Lock className={`absolute left-3 top-1/2 -translate-y-1/2 size-4 ${theme === 'dark' ? 'text-pink-400' : 'text-pink-600'}`} />
                      <Input
                        type="password"
                        placeholder="••••••••"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        className={`${theme === 'dark' ? 'bg-slate-950/50 border-pink-500/30 text-white focus:border-pink-500/50' : 'bg-white/50 border-pink-200 text-slate-900 focus:border-pink-400'} pl-10 h-12 font-mono`}
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
                    className={`w-full h-12 ${theme === 'dark' ? 'bg-gradient-to-r from-pink-500 to-orange-500 hover:from-pink-600 hover:to-orange-600' : 'bg-gradient-to-r from-pink-500 to-orange-500 hover:from-pink-600 hover:to-orange-600'} text-white font-bold text-lg relative overflow-hidden group`}
                  >
                    <div className="absolute inset-0 bg-gradient-to-r from-pink-400/0 to-pink-400/0 group-hover:from-pink-400/20 group-hover:to-orange-400/20 transition-all"></div>
                    <span className="relative z-10 font-mono">
                      {isLoading ? 'INITIALIZING AI...' : 'CONNECT TO AI'}
                    </span>
                  </Button>
                </form>

                {/* Footer Note */}
                <div className="text-center pt-4 border-t border-pink-500/20">
                  <p className={`text-sm ${theme === 'dark' ? 'text-slate-400' : 'text-slate-600'} font-mono`}>
                    Already have AI access?{' '}
                    <Link to="/login/bing" className={`${theme === 'dark' ? 'text-pink-400 hover:text-pink-300' : 'text-pink-600 hover:text-pink-700'} transition-colors`}>
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