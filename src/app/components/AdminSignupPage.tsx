import { useState } from 'react';
import { useNavigate, Link } from 'react-router';
import { motion } from 'motion/react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Shield, Lock, Mail, User, Building2, ArrowLeft } from 'lucide-react';
import { useTheme } from '@/contexts/ThemeContext';
import { authService } from '@/services/authService';

interface AdminSignupPageProps {
  onLogin: (email: string, password: string) => Promise<void>;
}

export function AdminSignupPage({ onLogin }: AdminSignupPageProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [organizationName, setOrganizationName] = useState('');
  const [organizationSlug, setOrganizationSlug] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const navigate = useNavigate();
  const { theme } = useTheme();

  // Auto-generate slug from organization name
  const handleOrganizationNameChange = (name: string) => {
    setOrganizationName(name);
    // Auto-generate slug from name
    const autoSlug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    setOrganizationSlug(autoSlug);
  };

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

    if (!organizationName.trim()) {
      setError('Organization name is required');
      setIsLoading(false);
      return;
    }

    try {
      const result = await authService.signupOrgAdmin({ 
        email, 
        password, 
        fullName: fullName.trim() || undefined,
        organizationName: organizationName.trim(),
        organizationSlug: organizationSlug.trim() || undefined
      });
      
      if (result.success) {
        // Auto-login immediately after successful signup
        await onLogin(email, password);
        navigate('/dashboard');
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
          linear-gradient(${theme === 'dark' ? 'rgba(6, 182, 212, 0.1)' : 'rgba(6, 182, 212, 0.15)'} 1px, transparent 1px),
          linear-gradient(90deg, ${theme === 'dark' ? 'rgba(6, 182, 212, 0.1)' : 'rgba(6, 182, 212, 0.15)'} 1px, transparent 1px)
        `,
        backgroundSize: '50px 50px',
        animation: 'grid-flow 20s linear infinite'
      }}></div>

      {/* Cyan Glowing Orbs */}
      <div className={`absolute top-20 left-20 w-96 h-96 ${theme === 'dark' ? 'bg-cyan-500/20' : 'bg-cyan-400/10'} rounded-full blur-[120px] animate-pulse`}></div>
      <div className={`absolute bottom-20 right-20 w-96 h-96 ${theme === 'dark' ? 'bg-cyan-600/20' : 'bg-blue-400/10'} rounded-full blur-[120px] animate-pulse`} style={{ animationDelay: '1s' }}></div>

      {/* Back Button */}
      <motion.button
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        onClick={() => navigate('/')}
        className={`absolute top-8 left-8 flex items-center gap-2 ${theme === 'dark' ? 'text-cyan-400 hover:text-cyan-300' : 'text-cyan-600 hover:text-cyan-700'} transition-colors font-mono`}
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
              <div className={`size-24 rounded-2xl ${theme === 'dark' ? 'bg-gradient-to-br from-cyan-500 via-blue-500 to-indigo-500' : 'bg-gradient-to-br from-cyan-400 via-blue-400 to-indigo-400'} flex items-center justify-center relative`}>
                <Shield className="size-12 text-white" />
                <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-cyan-500 to-blue-500 blur-2xl opacity-50"></div>
              </div>
            </div>

            <div>
              <h1 className="text-6xl font-bold mb-4">
                <span className={`bg-gradient-to-r ${theme === 'dark' ? 'from-cyan-400 via-blue-400 to-indigo-400' : 'from-cyan-600 via-blue-600 to-indigo-600'} bg-clip-text text-transparent`}>
                  Organization Admin
                </span>
              </h1>
              <p className={`text-xl ${theme === 'dark' ? 'text-cyan-400/70' : 'text-cyan-600/70'} mb-2 font-mono`}>
                Create Your Organization
              </p>
              <p className={`${theme === 'dark' ? 'text-slate-400' : 'text-slate-600'} max-w-md`}>
                Set up your organization's financial management system with full administrative control over settings, users, and data.
              </p>
            </div>

            {/* Features */}
            <div className="space-y-3">
              {[
                { icon: Building2, text: 'Organization Management' },
                { icon: Shield, text: 'Full Administrative Control' },
                { icon: User, text: 'User & Team Management' }
              ].map((feature, index) => (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.3 + index * 0.1 }}
                  className="flex items-center gap-3"
                >
                  <div className={`size-10 rounded-lg ${theme === 'dark' ? 'bg-cyan-500/10 border-cyan-500/20' : 'bg-cyan-100 border-cyan-200'} flex items-center justify-center border`}>
                    <feature.icon className={`size-5 ${theme === 'dark' ? 'text-cyan-400' : 'text-cyan-600'}`} />
                  </div>
                  <span className={`${theme === 'dark' ? 'text-slate-300' : 'text-slate-700'} font-mono`}>{feature.text}</span>
                </motion.div>
              ))}
            </div>
          </motion.div>

          {/* Right Side - Signup Form */}
          <motion.div
            initial={{ opacity: 0, x: 50 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8 }}
          >
            <Card className={`${theme === 'dark' ? 'bg-slate-900/50 border-cyan-500/30' : 'bg-white/70 border-cyan-200'} backdrop-blur-xl relative overflow-hidden`}>
              {/* Glowing Border Effect */}
              <div className={`absolute inset-0 ${theme === 'dark' ? 'bg-gradient-to-r from-cyan-500/20 via-blue-500/20 to-indigo-500/20 opacity-50' : 'bg-gradient-to-r from-cyan-200/30 via-blue-200/30 to-indigo-200/30 opacity-70'}`}></div>

              <CardHeader className="relative">
                <CardTitle className={`text-2xl ${theme === 'dark' ? 'text-white' : 'text-slate-900'} flex items-center gap-2`}>
                  <Shield className={`size-6 ${theme === 'dark' ? 'text-cyan-400' : 'text-cyan-600'}`} />
                  Create Admin Account
                </CardTitle>
                <CardDescription className={`${theme === 'dark' ? 'text-cyan-400/70' : 'text-cyan-600/70'} font-mono`}>
                  Set up your organization and admin access
                </CardDescription>
              </CardHeader>

              <CardContent className="space-y-6 relative">
                <form onSubmit={handleSubmit} className="space-y-4">
                  {/* Organization Name */}
                  <div className="space-y-2">
                    <Label className={`${theme === 'dark' ? 'text-slate-300' : 'text-slate-700'} font-mono`}>Organization Name</Label>
                    <div className="relative">
                      <Building2 className={`absolute left-3 top-1/2 -translate-y-1/2 size-4 ${theme === 'dark' ? 'text-cyan-400' : 'text-cyan-600'}`} />
                      <Input
                        type="text"
                        placeholder="Your Company Name"
                        value={organizationName}
                        onChange={(e) => handleOrganizationNameChange(e.target.value)}
                        className={`${theme === 'dark' ? 'bg-slate-950/50 border-cyan-500/30 text-white focus:border-cyan-500/50' : 'bg-white/50 border-cyan-200 text-slate-900 focus:border-cyan-400'} pl-10 h-12 font-mono`}
                        required
                      />
                    </div>
                  </div>

                  {/* Organization Slug */}
                  <div className="space-y-2">
                    <Label className={`${theme === 'dark' ? 'text-slate-300' : 'text-slate-700'} font-mono`}>
                      Organization Slug
                      <span className={`ml-2 text-xs ${theme === 'dark' ? 'text-slate-500' : 'text-slate-400'}`}>(URL-friendly identifier)</span>
                    </Label>
                    <div className="relative">
                      <span className={`absolute left-3 top-1/2 -translate-y-1/2 text-sm ${theme === 'dark' ? 'text-cyan-400' : 'text-cyan-600'} font-mono`}>/</span>
                      <Input
                        type="text"
                        placeholder="your-company"
                        value={organizationSlug}
                        onChange={(e) => {
                          const sanitized = e.target.value
                            .toLowerCase()
                            .replace(/[^a-z0-9-]/g, '-')
                            .replace(/--+/g, '-')
                            .replace(/^-|-$/g, '');
                          setOrganizationSlug(sanitized);
                        }}
                        className={`${theme === 'dark' ? 'bg-slate-950/50 border-cyan-500/30 text-white focus:border-cyan-500/50' : 'bg-white/50 border-cyan-200 text-slate-900 focus:border-cyan-400'} pl-8 h-12 font-mono`}
                        required
                      />
                    </div>
                    {organizationSlug && (
                      <p className={`text-xs ${theme === 'dark' ? 'text-slate-500' : 'text-slate-400'} font-mono`}>
                        Your organization URL: <span className={theme === 'dark' ? 'text-cyan-400' : 'text-cyan-600'}>/org/{organizationSlug}</span>
                      </p>
                    )}
                  </div>

                  {/* Full Name */}
                  <div className="space-y-2">
                    <Label className={`${theme === 'dark' ? 'text-slate-300' : 'text-slate-700'} font-mono`}>Full Name</Label>
                    <div className="relative">
                      <User className={`absolute left-3 top-1/2 -translate-y-1/2 size-4 ${theme === 'dark' ? 'text-cyan-400' : 'text-cyan-600'}`} />
                      <Input
                        type="text"
                        placeholder="John Doe"
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        className={`${theme === 'dark' ? 'bg-slate-950/50 border-cyan-500/30 text-white focus:border-cyan-500/50' : 'bg-white/50 border-cyan-200 text-slate-900 focus:border-cyan-400'} pl-10 h-12 font-mono`}
                      />
                    </div>
                  </div>

                  {/* Email Input */}
                  <div className="space-y-2">
                    <Label className={`${theme === 'dark' ? 'text-slate-300' : 'text-slate-700'} font-mono`}>Email Address</Label>
                    <div className="relative">
                      <Mail className={`absolute left-3 top-1/2 -translate-y-1/2 size-4 ${theme === 'dark' ? 'text-cyan-400' : 'text-cyan-600'}`} />
                      <Input
                        type="email"
                        placeholder="admin@company.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className={`${theme === 'dark' ? 'bg-slate-950/50 border-cyan-500/30 text-white focus:border-cyan-500/50' : 'bg-white/50 border-cyan-200 text-slate-900 focus:border-cyan-400'} pl-10 h-12 font-mono`}
                        required
                      />
                    </div>
                  </div>

                  {/* Password Input */}
                  <div className="space-y-2">
                    <Label className={`${theme === 'dark' ? 'text-slate-300' : 'text-slate-700'} font-mono`}>Password</Label>
                    <div className="relative">
                      <Lock className={`absolute left-3 top-1/2 -translate-y-1/2 size-4 ${theme === 'dark' ? 'text-cyan-400' : 'text-cyan-600'}`} />
                      <Input
                        type="password"
                        placeholder="••••••••"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className={`${theme === 'dark' ? 'bg-slate-950/50 border-cyan-500/30 text-white focus:border-cyan-500/50' : 'bg-white/50 border-cyan-200 text-slate-900 focus:border-cyan-400'} pl-10 h-12 font-mono`}
                        required
                        minLength={6}
                      />
                    </div>
                  </div>

                  {/* Confirm Password Input */}
                  <div className="space-y-2">
                    <Label className={`${theme === 'dark' ? 'text-slate-300' : 'text-slate-700'} font-mono`}>Confirm Password</Label>
                    <div className="relative">
                      <Lock className={`absolute left-3 top-1/2 -translate-y-1/2 size-4 ${theme === 'dark' ? 'text-cyan-400' : 'text-cyan-600'}`} />
                      <Input
                        type="password"
                        placeholder="••••••••"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        className={`${theme === 'dark' ? 'bg-slate-950/50 border-cyan-500/30 text-white focus:border-cyan-500/50' : 'bg-white/50 border-cyan-200 text-slate-900 focus:border-cyan-400'} pl-10 h-12 font-mono`}
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
                    className={`w-full h-12 ${theme === 'dark' ? 'bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600' : 'bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600'} text-white font-bold text-lg relative overflow-hidden group`}
                  >
                    <div className="absolute inset-0 bg-gradient-to-r from-cyan-400/0 to-cyan-400/0 group-hover:from-cyan-400/20 group-hover:to-blue-400/20 transition-all"></div>
                    <span className="relative z-10 font-mono">
                      {isLoading ? 'CREATING ORGANIZATION...' : 'CREATE ORGANIZATION'}
                    </span>
                  </Button>
                </form>

                {/* Footer Note */}
                <div className="text-center pt-4 border-t border-cyan-500/20">
                  <p className={`text-sm ${theme === 'dark' ? 'text-slate-400' : 'text-slate-600'} font-mono`}>
                    Already have an admin account?{' '}
                    <Link to="/login/admin" className={`${theme === 'dark' ? 'text-cyan-400 hover:text-cyan-300' : 'text-cyan-600 hover:text-cyan-700'} transition-colors`}>
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