import { motion } from 'motion/react';
import { useNavigate } from 'react-router';
import { Shield, Building2, Users, Sparkles, Cpu, Zap, Lock, Globe, Sun, Moon } from 'lucide-react';
import { useTheme } from '@/contexts/ThemeContext';

export function LandingPage() {
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();

  const loginTypes = [
    {
      id: 'admin',
      title: 'Organization Admin',
      subtitle: 'Org Owner & Admin',
      description: 'Full organization management, financials, profit intelligence, and team oversight',
      icon: Shield,
      color: 'cyan',
      gradient: 'from-cyan-500 via-cyan-400 to-blue-500',
      glowColor: 'rgba(6, 182, 212, 0.3)',
      path: '/login/admin',
      credentials: [
        { email: 'john.doe@agency.com', role: 'Owner' },
        { email: 'sarah.smith@agency.com', role: 'Admin' },
      ],
      password: 'demo',
    },
    {
      id: 'employee',
      title: 'Employee Portal',
      subtitle: 'Team Member Access',
      description: 'Personal dashboard, timesheet, expense claims, project tracking, and payslips',
      icon: Users,
      color: 'green',
      gradient: 'from-green-500 via-teal-400 to-cyan-500',
      glowColor: 'rgba(16, 185, 129, 0.3)',
      path: '/login/employee',
      credentials: [
        { email: 'alex.chen@agency.com', role: 'Developer' },
        { email: 'lisa.kumar@agency.com', role: 'Designer' },
      ],
      password: 'demo',
    },
    {
      id: 'platform',
      title: 'Platform Admin',
      subtitle: 'Super Administration',
      description: 'Multi-organization management, platform settings, plans, and billing oversight',
      icon: Building2,
      color: 'purple',
      gradient: 'from-purple-500 via-indigo-400 to-pink-500',
      glowColor: 'rgba(168, 85, 247, 0.3)',
      path: '/login/platform',
      credentials: [
        { email: 'admin@financeos.com', role: 'Platform Admin' },
        { email: 'platform.manager@financeos.com', role: 'Platform Mgr' },
      ],
      password: 'demo',
    },
    {
      id: 'bing',
      title: 'AI Command Portal',
      subtitle: 'Global AI Control Tower',
      description: 'Centralized model gateway, token metering, cost-margin telemetry, and air-gap privacy vault',
      icon: Sparkles,
      color: 'pink',
      gradient: 'from-pink-500 via-rose-400 to-purple-500',
      glowColor: 'rgba(236, 72, 153, 0.3)',
      path: '/login/bing',
      credentials: [
        { email: 'Platform Admin Account', role: 'Super Admin' },
      ],
      password: '',
    },
  ];

  return (
    <div className={`min-h-screen ${theme === 'dark' ? 'bg-black' : 'bg-gradient-to-br from-slate-50 via-blue-50 to-cyan-50'} flex flex-col items-center justify-start md:justify-center py-10 sm:py-16 px-4 relative overflow-x-clip`}>
      {/* Theme Toggle Button */}
      <motion.button
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.5 }}
        onClick={toggleTheme}
        className={`fixed top-8 right-8 z-50 p-4 rounded-xl ${
          theme === 'dark' 
            ? 'bg-slate-800/80 hover:bg-slate-700/80 border-cyan-500/30' 
            : 'bg-white/80 hover:bg-white border-blue-500/30'
        } backdrop-blur-xl border-2 transition-all duration-300 group`}
      >
        {theme === 'dark' ? (
          <Sun className="size-6 text-cyan-400 group-hover:rotate-90 transition-transform duration-500" />
        ) : (
          <Moon className="size-6 text-blue-600 group-hover:-rotate-12 transition-transform duration-500" />
        )}
      </motion.button>

      {/* Subtle Gradient Overlay */}
      <div className={`absolute inset-0 ${
        theme === 'dark' 
          ? 'bg-gradient-to-br from-blue-950/30 via-black to-cyan-950/20' 
          : 'bg-gradient-to-br from-blue-100/30 via-transparent to-cyan-100/20'
      }`}></div>
      
      {/* Finance Pattern Background */}
      <div className={`absolute inset-0 ${theme === 'dark' ? 'opacity-[0.03]' : 'opacity-[0.05]'}`} style={{
        backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M30 10 L35 25 L50 25 L38 35 L43 50 L30 40 L17 50 L22 35 L10 25 L25 25 Z' fill='${theme === 'dark' ? '%2306b6d4' : '%230284c7'}' fill-opacity='0.4'/%3E%3C/svg%3E")`,
        backgroundSize: '60px 60px'
      }}></div>

      {/* Animated Grid Background */}
      <div 
        className={`absolute inset-0 ${theme === 'dark' ? 'opacity-20' : 'opacity-10'}`}
        style={{
          backgroundImage: theme === 'dark'
            ? `linear-gradient(rgba(6, 182, 212, 0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(6, 182, 212, 0.1) 1px, transparent 1px)`
            : `linear-gradient(rgba(2, 132, 199, 0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(2, 132, 199, 0.1) 1px, transparent 1px)`,
          backgroundSize: '50px 50px',
          animation: 'grid-flow 20s linear infinite'
        }}
      />

      {/* Glowing Orbs */}
      {theme === 'dark' ? (
        <>
          <div className="absolute top-20 left-20 w-96 h-96 bg-gradient-to-br from-blue-500/25 via-cyan-500/20 to-indigo-500/25 rounded-full blur-[120px] animate-pulse" />
          <div className="absolute bottom-20 right-20 w-96 h-96 bg-gradient-to-br from-indigo-600/25 via-purple-500/20 to-pink-500/25 rounded-full blur-[120px] animate-pulse" style={{ animationDelay: '1s' }} />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-gradient-to-br from-cyan-500/15 via-blue-500/10 to-violet-500/15 rounded-full blur-[150px] animate-pulse" style={{ animationDelay: '2s' }} />
        </>
      ) : (
        <>
          <div className="absolute top-20 left-20 w-96 h-96 bg-gradient-to-br from-blue-300/25 to-cyan-300/25 rounded-full blur-[120px]" />
          <div className="absolute bottom-20 right-20 w-96 h-96 bg-gradient-to-br from-indigo-300/25 to-purple-300/25 rounded-full blur-[120px]" />
        </>
      )}

      {/* Main Content */}
      <div className="w-full max-w-7xl relative z-10">
        {/* Header Section */}
        <motion.div
          initial={{ opacity: 0, y: -50 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
          className="text-center mb-12"
        >
          <div className="inline-block relative mb-6">
            <div className="size-20 rounded-2xl bg-gradient-to-br from-cyan-500 via-blue-500 to-purple-500 flex items-center justify-center relative">
              <Cpu className="size-10 text-white" />
              <div className={`absolute inset-0 rounded-2xl bg-gradient-to-br from-cyan-500 to-purple-500 blur-xl ${theme === 'dark' ? 'opacity-50' : 'opacity-30'}`} />
            </div>
          </div>

          <h1 className="text-6xl font-bold mb-4">
            <span className="bg-gradient-to-r from-cyan-400 via-blue-400 to-purple-400 bg-clip-text text-transparent">
              Finance OS
            </span>
          </h1>
          <p className={`text-xl ${theme === 'dark' ? 'text-cyan-400/70' : 'text-blue-600/80'} mb-3 font-mono`}>
            Agency Financial Intelligence System
          </p>
          <p className={`${theme === 'dark' ? 'text-slate-400' : 'text-slate-600'} max-w-2xl mx-auto`}>
            Next-generation AI-powered financial command center designed for agencies and software houses
          </p>

          {/* Status */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.6 }}
            className="flex items-center justify-center gap-2 mt-6"
          >
            <motion.div
              animate={{ scale: [1, 1.2, 1] }}
              transition={{ duration: 2, repeat: Infinity }}
              className="size-3 rounded-full bg-green-400 shadow-lg shadow-green-400/50"
            />
            <span className={`text-sm font-mono ${theme === 'dark' ? 'text-green-400' : 'text-green-600'}`}>ALL SYSTEMS OPERATIONAL</span>
          </motion.div>
        </motion.div>

        {/* Login Cards - 4 portals */}
        <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-6 mb-12">
          {loginTypes.map((loginType, index) => (
            <motion.div
              key={loginType.id}
              initial={{ opacity: 0, y: 50 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: index * 0.15 }}
              className="relative group"
            >
              {/* Glow Effect */}
              <div 
                className="absolute inset-0 rounded-2xl blur-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500"
                style={{ backgroundColor: loginType.glowColor }}
              />

              {/* Card */}
              <motion.button
                onClick={() => navigate(loginType.path)}
                whileHover={{ scale: 1.03, y: -5 }}
                whileTap={{ scale: 0.97 }}
                className={`relative w-full h-full p-6 ${
                  theme === 'dark' 
                    ? 'bg-slate-900/50 border-slate-700/50' 
                    : 'bg-white/70 border-slate-200/80'
                } backdrop-blur-xl border-2 rounded-2xl overflow-hidden transition-all duration-300 text-left`}
              >
                {/* Animated border glow */}
                <motion.div
                  className={`absolute inset-0 bg-gradient-to-r ${loginType.gradient} opacity-0 group-hover:opacity-10 transition-opacity`}
                />

                {/* Icon */}
                <div className="mb-4">
                  <div className={`size-14 rounded-xl bg-gradient-to-br ${loginType.gradient} flex items-center justify-center relative`}>
                    <loginType.icon className="size-7 text-white" />
                    <div className={`absolute inset-0 rounded-xl bg-gradient-to-br ${loginType.gradient} blur-lg ${theme === 'dark' ? 'opacity-40' : 'opacity-20'}`} />
                  </div>
                </div>

                {/* Content */}
                <h3 className={`text-xl font-bold ${theme === 'dark' ? 'text-white' : 'text-slate-900'} mb-1`}>{loginType.title}</h3>
                <p className={`text-${loginType.color}-400 font-mono mb-2 text-xs`}>
                  {loginType.subtitle}
                </p>
                <p className={`${theme === 'dark' ? 'text-slate-400' : 'text-slate-600'} text-xs mb-4 line-clamp-2`}>
                  {loginType.description}
                </p>

                {/* Credentials Section */}
                <div className={`p-3 rounded-lg mb-4 ${theme === 'dark' ? 'bg-black/30' : 'bg-slate-50'}`} style={{
                  border: theme === 'dark' ? `1px solid ${loginType.glowColor}` : '1px solid rgba(0,0,0,0.1)',
                }}>
                  {loginType.id === 'bing' ? (
                    <p className="text-[10px] text-pink-400 font-mono mb-2 font-semibold">AUTHENTICATION REQUIREMENT:</p>
                  ) : (
                    <p className="text-[10px] text-slate-500 font-mono mb-2">DEMO ACCOUNTS:</p>
                  )}
                  {loginType.credentials.map((cred, ci) => (
                    <div key={ci} className="flex items-center justify-between mb-1 last:mb-0">
                      <span className={`text-[11px] font-mono ${theme === 'dark' ? 'text-slate-300' : 'text-slate-700'} truncate flex-1`}>{cred.email}</span>
                      <span className={`text-[10px] font-mono text-${loginType.color}-400 ml-2 shrink-0`}>{cred.role}</span>
                    </div>
                  ))}
                  <div className="mt-1.5 pt-1.5" style={{ borderTop: theme === 'dark' ? '1px solid rgba(148,163,184,0.1)' : '1px solid rgba(0,0,0,0.05)' }}>
                    {loginType.id === 'bing' ? (
                      <span className="text-[10px] text-pink-400/80 font-mono">Sign in with your platform administrator credentials</span>
                    ) : (
                      <span className="text-[10px] text-slate-500 font-mono">One-click sign-in on the next screen — no password needed</span>
                    )}
                  </div>
                </div>

                {/* Access Button */}
                <div className={`flex items-center gap-2 text-${loginType.color}-400 font-mono text-xs group-hover:gap-4 transition-all`}>
                  <span>ACCESS</span>
                  <span>→</span>
                </div>

                {/* Corner Decorations */}
                <div className={`absolute top-3 right-3 size-2 rounded-full bg-${loginType.color}-400 animate-pulse`} />
              </motion.button>
            </motion.div>
          ))}
        </div>

        {/* Features Section */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1 }}
          className="grid md:grid-cols-3 gap-6 max-w-4xl mx-auto"
        >
          {[
            { icon: Zap, text: 'AI-Powered Intelligence' },
            { icon: Lock, text: 'Multi-Organization Security' },
            { icon: Globe, text: 'Multi-Currency Support' },
          ].map((feature, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 1.2 + index * 0.1 }}
              className="flex items-center gap-3 justify-center"
            >
              <div className={`size-12 rounded-lg ${
                theme === 'dark' 
                  ? 'bg-cyan-500/10 border-cyan-500/20' 
                  : 'bg-blue-500/10 border-blue-500/30'
              } flex items-center justify-center border`}>
                <feature.icon className={`size-6 ${theme === 'dark' ? 'text-cyan-400' : 'text-blue-600'}`} />
              </div>
              <span className={`${theme === 'dark' ? 'text-slate-300' : 'text-slate-700'} font-mono`}>{feature.text}</span>
            </motion.div>
          ))}
        </motion.div>

        {/* Version Info */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.5 }}
          className={`text-center mt-10 ${theme === 'dark' ? 'text-slate-500' : 'text-slate-400'} font-mono text-sm`}
        >
          <p>Finance OS v3.0.2026 - AXIOM Design System</p>
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