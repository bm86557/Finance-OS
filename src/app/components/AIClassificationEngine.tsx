import { useState, useMemo } from 'react';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import {
  Brain,
  Sparkles,
  ArrowLeft,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  HelpCircle,
  ThumbsUp,
  ThumbsDown,
  Search,
  Filter,
  ChevronDown,
  ChevronRight,
  Zap,
  TrendingUp,
  BarChart3,
  Target,
  BookOpen,
  Eye,
  Edit3,
  MessageSquare,
  RefreshCw,
  Layers,
  GitBranch,
  Clock,
  ArrowRight,
  Check,
  X,
  Send,
  Lightbulb,
  Shield,
  Activity,
  Plus,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useNavigate } from 'react-router';
import { useTheme } from '../../contexts/ThemeContext';
import { AXIOM } from '../../styles/axiom-tokens';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend, LineChart, Line, Area, AreaChart,
} from 'recharts';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MOCK DATA
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface ClassificationRule {
  id: string;
  pattern: string;
  category: string;
  subCategory?: string;
  confidence: number;
  timesApplied: number;
  source: 'ai_learned' | 'user_defined' | 'system';
  createdAt: string;
  lastUsed: string;
}

interface PendingTransaction {
  id: string;
  date: string;
  narration: string;
  amount: number;
  currency: string;
  type: 'debit' | 'credit';
  account: string;
  aiSuggestion: {
    category: string;
    subCategory?: string;
    confidence: number;
    reasoning: string;
    alternativeSuggestions?: { category: string; confidence: number }[];
  };
  clarifyingQuestion?: string;
  status: 'pending' | 'confirmed' | 'rejected' | 'needs_clarification';
}

interface LearningMetric {
  date: string;
  accuracy: number;
  autoClassified: number;
  manualOverrides: number;
  rulesLearned: number;
}

const mockRules: ClassificationRule[] = [
  { id: 'r1', pattern: 'AWS|Amazon Web Services|EC2', category: 'Infrastructure', subCategory: 'Cloud Hosting', confidence: 0.97, timesApplied: 234, source: 'ai_learned', createdAt: '2025-01-15', lastUsed: '2026-02-26' },
  { id: 'r2', pattern: 'SALARY|PAYROLL|PAY RUN', category: 'Staff Costs', subCategory: 'Salaries', confidence: 0.99, timesApplied: 48, source: 'system', createdAt: '2024-06-01', lastUsed: '2026-02-25' },
  { id: 'r3', pattern: 'FIGMA|SKETCH|ADOBE', category: 'Software', subCategory: 'Design Tools', confidence: 0.95, timesApplied: 72, source: 'ai_learned', createdAt: '2025-03-10', lastUsed: '2026-02-24' },
  { id: 'r4', pattern: 'UBER|BOLT|LYFT', category: 'Travel', subCategory: 'Rideshare', confidence: 0.92, timesApplied: 156, source: 'ai_learned', createdAt: '2025-02-20', lastUsed: '2026-02-26' },
  { id: 'r5', pattern: 'STRIPE|PAYPAL MERCHANT', category: 'Revenue', subCategory: 'Client Payments', confidence: 0.98, timesApplied: 312, source: 'ai_learned', createdAt: '2024-12-01', lastUsed: '2026-02-26' },
  { id: 'r6', pattern: 'SLACK|NOTION|JIRA|ASANA', category: 'Software', subCategory: 'Productivity Tools', confidence: 0.94, timesApplied: 96, source: 'ai_learned', createdAt: '2025-04-05', lastUsed: '2026-02-25' },
  { id: 'r7', pattern: 'WEWORK|OFFICE RENT|REGUS', category: 'Office', subCategory: 'Rent & Coworking', confidence: 0.96, timesApplied: 24, source: 'user_defined', createdAt: '2025-05-15', lastUsed: '2026-02-01' },
  { id: 'r8', pattern: 'GOOGLE ADS|META ADS|LINKEDIN ADS', category: 'Marketing', subCategory: 'Paid Advertising', confidence: 0.93, timesApplied: 89, source: 'ai_learned', createdAt: '2025-06-20', lastUsed: '2026-02-22' },
  { id: 'r9', pattern: 'GITHUB|GITLAB|BITBUCKET', category: 'Software', subCategory: 'Dev Tools', confidence: 0.96, timesApplied: 36, source: 'ai_learned', createdAt: '2025-07-01', lastUsed: '2026-02-26' },
  { id: 'r10', pattern: 'CONTRACTOR|FREELANCER|UPWORK', category: 'Staff Costs', subCategory: 'Contractors', confidence: 0.88, timesApplied: 67, source: 'ai_learned', createdAt: '2025-08-12', lastUsed: '2026-02-20' },
];

const mockPendingTransactions: PendingTransaction[] = [
  {
    id: 't1', date: '2026-02-26', narration: 'TFR TO JOHN SMITH - PROJECT ALPHA', amount: 4500, currency: 'USD', type: 'debit', account: 'Business Checking',
    aiSuggestion: { category: 'Staff Costs', subCategory: 'Contractors', confidence: 0.62, reasoning: 'Name pattern suggests contractor payment, but "PROJECT ALPHA" could indicate a client refund or project expense', alternativeSuggestions: [{ category: 'Project Costs', confidence: 0.25 }, { category: 'Client Refund', confidence: 0.13 }] },
    clarifyingQuestion: 'Is "John Smith" a contractor working on Project Alpha, or is this a different type of payment?',
    status: 'needs_clarification',
  },
  {
    id: 't2', date: '2026-02-25', narration: 'AMZN MKTP US*2K4J8R9P', amount: 189.99, currency: 'USD', type: 'debit', account: 'Business Credit Card',
    aiSuggestion: { category: 'Office Supplies', subCategory: 'Equipment', confidence: 0.45, reasoning: 'Amazon marketplace purchase — could be office supplies, equipment, software, or personal. Amount suggests equipment or supplies.', alternativeSuggestions: [{ category: 'Software', confidence: 0.20 }, { category: 'Personal', confidence: 0.15 }, { category: 'Infrastructure', confidence: 0.10 }] },
    clarifyingQuestion: 'What was this Amazon purchase for? (Office supplies, equipment, software, or personal use?)',
    status: 'needs_clarification',
  },
  {
    id: 't3', date: '2026-02-25', narration: 'VERCEL INC - PRO PLAN', amount: 20, currency: 'USD', type: 'debit', account: 'Business Credit Card',
    aiSuggestion: { category: 'Infrastructure', subCategory: 'Cloud Hosting', confidence: 0.94, reasoning: 'Vercel is a cloud hosting/deployment platform commonly used by development agencies. High confidence based on similar past transactions.' },
    status: 'pending',
  },
  {
    id: 't4', date: '2026-02-24', narration: 'PAYMENT FROM ACME CORP INV-2026-0089', amount: 15750, currency: 'USD', type: 'credit', account: 'Business Checking',
    aiSuggestion: { category: 'Revenue', subCategory: 'Client Payments', confidence: 0.97, reasoning: 'Payment from known client "ACME CORP" with invoice reference. Matches historical pattern of client payments.' },
    status: 'pending',
  },
  {
    id: 't5', date: '2026-02-24', narration: 'TRANSFER TO SAVINGS ACC', amount: 5000, currency: 'USD', type: 'debit', account: 'Business Checking',
    aiSuggestion: { category: 'Internal Transfer', subCategory: 'Savings', confidence: 0.91, reasoning: 'Internal bank transfer to savings account. Common pattern for cash management.' },
    status: 'pending',
  },
  {
    id: 't6', date: '2026-02-23', narration: 'RESTAURANT BLUE DOOR CAFE', amount: 124.50, currency: 'USD', type: 'debit', account: 'Business Credit Card',
    aiSuggestion: { category: 'Meals & Entertainment', subCategory: 'Client Entertainment', confidence: 0.55, reasoning: 'Restaurant expense on business card. Could be client entertainment, team lunch, or personal. Amount suggests a business meal.', alternativeSuggestions: [{ category: 'Team Building', confidence: 0.25 }, { category: 'Personal', confidence: 0.20 }] },
    clarifyingQuestion: 'Was this restaurant visit for client entertainment, a team meal, or personal use?',
    status: 'needs_clarification',
  },
  {
    id: 't7', date: '2026-02-23', narration: 'OPENAI API USAGE FEB 2026', amount: 342.80, currency: 'USD', type: 'debit', account: 'Business Credit Card',
    aiSuggestion: { category: 'Software', subCategory: 'AI/ML Services', confidence: 0.96, reasoning: 'OpenAI API charge - matches pattern of SaaS/API subscriptions. Commonly used by development agencies.' },
    status: 'pending',
  },
  {
    id: 't8', date: '2026-02-22', narration: 'CONSULTING FEE - SARAH CHEN', amount: 3200, currency: 'USD', type: 'debit', account: 'Business Checking',
    aiSuggestion: { category: 'Staff Costs', subCategory: 'Contractors', confidence: 0.85, reasoning: 'Consulting fee payment to individual. Strong indicator of contractor/consultant payment.' },
    status: 'pending',
  },
];

const mockLearningMetrics: LearningMetric[] = [
  { date: 'Sep', accuracy: 72, autoClassified: 45, manualOverrides: 28, rulesLearned: 12 },
  { date: 'Oct', accuracy: 78, autoClassified: 62, manualOverrides: 22, rulesLearned: 18 },
  { date: 'Nov', accuracy: 83, autoClassified: 74, manualOverrides: 16, rulesLearned: 8 },
  { date: 'Dec', accuracy: 87, autoClassified: 81, manualOverrides: 12, rulesLearned: 6 },
  { date: 'Jan', accuracy: 91, autoClassified: 88, manualOverrides: 8, rulesLearned: 5 },
  { date: 'Feb', accuracy: 94, autoClassified: 92, manualOverrides: 5, rulesLearned: 3 },
];

const categoryDistribution = [
  { name: 'Staff Costs', value: 35, color: '#3b82f6' },
  { name: 'Software', value: 18, color: '#06b6d4' },
  { name: 'Infrastructure', value: 12, color: '#a855f7' },
  { name: 'Revenue', value: 15, color: '#10b981' },
  { name: 'Marketing', value: 8, color: '#f59e0b' },
  { name: 'Office', value: 5, color: '#ec4899' },
  { name: 'Travel', value: 4, color: '#ef4444' },
  { name: 'Other', value: 3, color: '#64748b' },
];

const confidenceDistribution = [
  { range: '0-50%', count: 12, color: '#ef4444' },
  { range: '50-70%', count: 28, color: '#f59e0b' },
  { range: '70-85%', count: 45, color: '#06b6d4' },
  { range: '85-95%', count: 124, color: '#3b82f6' },
  { range: '95-100%', count: 203, color: '#10b981' },
];

const recentActivity = [
  { id: 'a1', action: 'Auto-classified', narration: 'GITHUB TEAM PLAN', category: 'Software → Dev Tools', confidence: 0.96, time: '2 min ago' },
  { id: 'a2', action: 'User confirmed', narration: 'STRIPE PAYOUT', category: 'Revenue → Client Payments', confidence: 0.98, time: '5 min ago' },
  { id: 'a3', action: 'Rule learned', narration: 'CALENDLY PRO', category: 'Software → Productivity Tools', confidence: 0.91, time: '12 min ago' },
  { id: 'a4', action: 'User override', narration: 'TAXI TO CLIENT OFFICE', category: 'Travel → Client Visits', confidence: 0.72, time: '18 min ago' },
  { id: 'a5', action: 'Question asked', narration: 'TFR TO M. JOHNSON', category: 'Pending', confidence: 0.48, time: '25 min ago' },
];

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// HELPER COMPONENTS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function ConfidenceBar({ confidence, size = 'md' }: { confidence: number; size?: 'sm' | 'md' | 'lg' }) {
  const getColor = (c: number) => {
    if (c >= 0.90) return '#10b981';
    if (c >= 0.70) return '#3b82f6';
    if (c >= 0.50) return '#f59e0b';
    return '#ef4444';
  };
  const color = getColor(confidence);
  const h = size === 'sm' ? 'h-1.5' : size === 'lg' ? 'h-3' : 'h-2';

  return (
    <div className="flex items-center gap-2 w-full">
      <div className={`flex-1 ${h} rounded-full overflow-hidden`} style={{ background: 'rgba(148, 163, 184, 0.1)' }}>
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${confidence * 100}%` }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
          className={`${h} rounded-full`}
          style={{ background: color, boxShadow: `0 0 8px ${color}80` }}
        />
      </div>
      <span className="text-xs font-mono" style={{ color, minWidth: '36px', textAlign: 'right' }}>
        {(confidence * 100).toFixed(0)}%
      </span>
    </div>
  );
}

function GlowContainer({
  children,
  color = 'blue',
  className = '',
  delay = 0,
}: {
  children: React.ReactNode;
  color?: 'blue' | 'cyan' | 'purple' | 'green' | 'amber' | 'pink' | 'red';
  className?: string;
  delay?: number;
}) {
  const containerKey = `chart${color.charAt(0).toUpperCase() + color.slice(1)}` as keyof typeof AXIOM.containers;
  const containerStyle = AXIOM.containers[containerKey] || AXIOM.containers.chartBlue;

  return (
    <motion.div
      initial={{ opacity: 0, y: 30 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.6 }}
      className={`rounded-2xl p-6 relative overflow-hidden ${className}`}
      style={containerStyle}
    >
      <div className="absolute inset-0 pointer-events-none" style={{ background: AXIOM.radialOverlays[color] || AXIOM.radialOverlays.blue, opacity: 0.15 }} />
      <div className="relative z-10">{children}</div>
    </motion.div>
  );
}

function SectionTitle({ icon: Icon, title, subtitle, color = '#3b82f6' }: { icon: any; title: string; subtitle?: string; color?: string }) {
  return (
    <div className="flex items-center gap-3 mb-5">
      <div className="p-2.5 rounded-xl" style={{ background: `linear-gradient(135deg, ${color}, ${color}cc)`, boxShadow: `0 8px 20px -6px ${color}80` }}>
        <Icon className="size-5 text-white" />
      </div>
      <div>
        <h3 className="text-white text-lg">{title}</h3>
        {subtitle && <p className="text-sm" style={{ color: '#94a3b8' }}>{subtitle}</p>}
      </div>
    </div>
  );
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MAIN COMPONENT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

export function AIClassificationEngine() {
  const navigate = useNavigate();
  const { theme = 'dark' } = useTheme();
  const [activeTab, setActiveTab] = useState<'queue' | 'rules' | 'insights'>('queue');
  const [transactions, setTransactions] = useState(mockPendingTransactions);
  const [expandedTx, setExpandedTx] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterConfidence, setFilterConfidence] = useState<'all' | 'low' | 'medium' | 'high'>('all');
  const [clarificationResponses, setClarificationResponses] = useState<Record<string, string>>({});
  const [rulesSearch, setRulesSearch] = useState('');

  // Stats
  const stats = useMemo(() => {
    const total = transactions.length;
    const needsClarification = transactions.filter(t => t.status === 'needs_clarification').length;
    const highConfidence = transactions.filter(t => t.aiSuggestion.confidence >= 0.85).length;
    const confirmed = transactions.filter(t => t.status === 'confirmed').length;
    return { total, needsClarification, highConfidence, confirmed };
  }, [transactions]);

  const filteredTransactions = useMemo(() => {
    let filtered = transactions;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(t => t.narration.toLowerCase().includes(q) || t.aiSuggestion.category.toLowerCase().includes(q));
    }
    if (filterConfidence === 'low') filtered = filtered.filter(t => t.aiSuggestion.confidence < 0.60);
    else if (filterConfidence === 'medium') filtered = filtered.filter(t => t.aiSuggestion.confidence >= 0.60 && t.aiSuggestion.confidence < 0.85);
    else if (filterConfidence === 'high') filtered = filtered.filter(t => t.aiSuggestion.confidence >= 0.85);
    return filtered;
  }, [transactions, searchQuery, filterConfidence]);

  const filteredRules = useMemo(() => {
    if (!rulesSearch) return mockRules;
    const q = rulesSearch.toLowerCase();
    return mockRules.filter(r => r.pattern.toLowerCase().includes(q) || r.category.toLowerCase().includes(q));
  }, [rulesSearch]);

  const handleConfirm = (txId: string) => {
    setTransactions(prev => prev.map(t => t.id === txId ? { ...t, status: 'confirmed' as const } : t));
  };

  const handleReject = (txId: string) => {
    setTransactions(prev => prev.map(t => t.id === txId ? { ...t, status: 'rejected' as const } : t));
  };

  const handleBulkConfirmHigh = () => {
    setTransactions(prev => prev.map(t => t.aiSuggestion.confidence >= 0.85 && t.status === 'pending' ? { ...t, status: 'confirmed' as const } : t));
  };

  const kpiCards = [
    { icon: Brain, label: 'AI Accuracy', value: '94.2%', delta: '+2.1%', trend: 'up' as const, color: '#3b82f6' },
    { icon: Zap, label: 'Auto-Classified', value: '92%', delta: '+4%', trend: 'up' as const, color: '#10b981' },
    { icon: HelpCircle, label: 'Needs Review', value: String(stats.needsClarification), delta: '-3', trend: 'down' as const, color: '#f59e0b' },
    { icon: BookOpen, label: 'Rules Learned', value: String(mockRules.length), delta: '+3', trend: 'up' as const, color: '#a855f7' },
  ];

  return (
    <div className="min-h-screen" style={{ background: AXIOM.backgrounds.main }}>
      {/* Ambient gradient orbs */}
      <div className="fixed top-20 left-20 w-96 h-96 bg-gradient-to-br from-blue-600/10 to-cyan-600/10 rounded-full blur-[120px] animate-pulse pointer-events-none" />
      <div className="fixed bottom-20 right-20 w-96 h-96 bg-gradient-to-br from-blue-600/10 to-indigo-600/10 rounded-full blur-[120px] animate-pulse pointer-events-none" style={{ animationDelay: '1s' }} />
      <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-gradient-to-br from-purple-600/5 to-blue-600/5 rounded-full blur-[150px] pointer-events-none" />

      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="sticky top-0 z-50 backdrop-blur-lg border-b px-8 py-6"
        style={{
          background: AXIOM.backgrounds.topBar,
          borderBottom: AXIOM.borders.topBar,
        }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <motion.button
              whileHover={{ scale: 1.05, x: -4 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => navigate('/organization')}
              className="px-4 py-2 rounded-xl text-sm font-medium flex items-center gap-2"
              style={AXIOM.buttons.secondary}
            >
              <ArrowLeft className="size-4" />
              Back
            </motion.button>
            <div className="flex items-center gap-3">
              <div
                className="p-3 rounded-xl flex items-center justify-center"
                style={{
                  background: 'linear-gradient(135deg, #3b82f6, #06b6d4)',
                  boxShadow: '0 10px 30px -10px rgba(59, 130, 246, 0.8)',
                }}
              >
                <Brain className="size-6 text-white" />
              </div>
              <div>
                <h1 className="text-4xl font-bold" style={AXIOM.text.titleStyle}>
                  AI Classification Engine
                </h1>
                <p className="text-sm" style={{ color: '#94a3b8' }}>
                  Narration-Based Auto-Classification with Adaptive Learning
                </p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={handleBulkConfirmHigh}
              className="px-4 py-2 rounded-xl text-sm font-medium flex items-center gap-2"
              style={AXIOM.buttons.success}
            >
              <CheckCircle2 className="size-4" />
              Confirm All High ({stats.highConfidence})
            </motion.button>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              className="px-4 py-2 rounded-xl text-sm font-medium flex items-center gap-2"
              style={AXIOM.buttons.action}
            >
              <RefreshCw className="size-4" />
              Re-Analyze
            </motion.button>
          </div>
        </div>
      </motion.div>

      <div className="relative z-10 p-8 space-y-8">
        {/* KPI Row */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {kpiCards.map((kpi, i) => (
            <motion.div
              key={kpi.label}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.1 }}
              className="rounded-2xl p-5 relative overflow-hidden"
              style={{
                background: AXIOM.backgrounds.chartContainer,
                border: `1px solid ${kpi.color}33`,
                boxShadow: `0 15px 40px -15px ${kpi.color}40`,
              }}
            >
              <div className="absolute inset-0 pointer-events-none" style={{ background: `radial-gradient(circle at 50% 50%, ${kpi.color}15, transparent 70%)` }} />
              <div className="relative z-10">
                <div className="flex items-center justify-between mb-3">
                  <div className="p-2 rounded-lg" style={{ background: `${kpi.color}20`, boxShadow: `0 4px 12px ${kpi.color}30` }}>
                    <kpi.icon className="size-4" style={{ color: kpi.color }} />
                  </div>
                  <span className={`text-xs font-mono px-2 py-0.5 rounded-full ${kpi.trend === 'up' ? 'text-emerald-400' : 'text-amber-400'}`}
                    style={{ background: kpi.trend === 'up' ? 'rgba(16, 185, 129, 0.1)' : 'rgba(245, 158, 11, 0.1)' }}>
                    {kpi.delta}
                  </span>
                </div>
                <p className="text-3xl font-bold text-white mb-1">{kpi.value}</p>
                <p className="text-xs" style={{ color: '#94a3b8' }}>{kpi.label}</p>
              </div>
            </motion.div>
          ))}
        </div>

        {/* Tab Navigation */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="flex gap-2 p-1.5 rounded-xl w-fit"
          style={{ background: 'rgba(0, 0, 0, 0.3)', border: '1px solid rgba(148, 163, 184, 0.1)' }}
        >
          {[
            { key: 'queue', label: 'Classification Queue', icon: Layers, count: stats.total - stats.confirmed },
            { key: 'rules', label: 'Learned Rules', icon: GitBranch, count: mockRules.length },
            { key: 'insights', label: 'Learning Insights', icon: TrendingUp },
          ].map((tab) => (
            <motion.button
              key={tab.key}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => setActiveTab(tab.key as typeof activeTab)}
              className="px-5 py-2.5 rounded-lg text-sm font-medium flex items-center gap-2 transition-all"
              style={activeTab === tab.key ? AXIOM.buttons.primary : AXIOM.buttons.secondary}
            >
              <tab.icon className="size-4" />
              {tab.label}
              {tab.count !== undefined && (
                <span className="ml-1 px-1.5 py-0.5 rounded-full text-xs" style={{ background: activeTab === tab.key ? 'rgba(255,255,255,0.2)' : 'rgba(148, 163, 184, 0.15)' }}>
                  {tab.count}
                </span>
              )}
            </motion.button>
          ))}
        </motion.div>

        <AnimatePresence mode="wait">
          {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
          {/* TAB: CLASSIFICATION QUEUE */}
          {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
          {activeTab === 'queue' && (
            <motion.div key="queue" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="space-y-6">
              {/* Search & Filters */}
              <div className="flex items-center gap-4">
                <div className="flex-1 relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4" style={{ color: '#64748b' }} />
                  <input
                    type="text"
                    placeholder="Search narrations, categories..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 rounded-xl text-sm text-white placeholder:text-slate-500 focus:outline-none"
                    style={{ ...AXIOM.inputs, border: AXIOM.inputs.border }}
                  />
                </div>
                <div className="flex gap-2">
                  {(['all', 'low', 'medium', 'high'] as const).map(f => (
                    <motion.button
                      key={f}
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      onClick={() => setFilterConfidence(f)}
                      className="px-3 py-2 rounded-lg text-xs font-medium capitalize"
                      style={filterConfidence === f ? AXIOM.buttons.info : AXIOM.buttons.secondary}
                    >
                      {f === 'all' ? 'All' : `${f} conf.`}
                    </motion.button>
                  ))}
                </div>
              </div>

              {/* Transaction Cards */}
              <div className="space-y-4">
                {filteredTransactions.map((tx, i) => {
                  const isExpanded = expandedTx === tx.id;
                  const isResolved = tx.status === 'confirmed' || tx.status === 'rejected';

                  return (
                    <motion.div
                      key={tx.id}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.05 }}
                      layout
                    >
                      <GlowContainer
                        color={tx.status === 'needs_clarification' ? 'amber' : tx.status === 'confirmed' ? 'green' : tx.status === 'rejected' ? 'red' : tx.aiSuggestion.confidence >= 0.85 ? 'blue' : 'cyan'}
                        className={`${isResolved ? 'opacity-60' : ''}`}
                      >
                        {/* Main Row */}
                        <div
                          className="flex items-center gap-4 cursor-pointer"
                          onClick={() => setExpandedTx(isExpanded ? null : tx.id)}
                        >
                          {/* Status Icon */}
                          <div className="flex-shrink-0">
                            {tx.status === 'needs_clarification' ? (
                              <div className="p-2 rounded-lg" style={{ background: 'rgba(245, 158, 11, 0.15)' }}>
                                <MessageSquare className="size-5 text-amber-400" />
                              </div>
                            ) : tx.status === 'confirmed' ? (
                              <div className="p-2 rounded-lg" style={{ background: 'rgba(16, 185, 129, 0.15)' }}>
                                <CheckCircle2 className="size-5 text-emerald-400" />
                              </div>
                            ) : tx.status === 'rejected' ? (
                              <div className="p-2 rounded-lg" style={{ background: 'rgba(239, 68, 68, 0.15)' }}>
                                <XCircle className="size-5 text-red-400" />
                              </div>
                            ) : (
                              <div className="p-2 rounded-lg" style={{ background: 'rgba(59, 130, 246, 0.15)' }}>
                                <Sparkles className="size-5 text-blue-400" />
                              </div>
                            )}
                          </div>

                          {/* Transaction Details */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <p className="text-white text-sm font-medium truncate">{tx.narration}</p>
                              {tx.status === 'needs_clarification' && (
                                <span className="flex-shrink-0 px-2 py-0.5 rounded-full text-xs" style={AXIOM.badges.warning}>
                                  Needs Review
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-3 text-xs" style={{ color: '#94a3b8' }}>
                              <span>{tx.date}</span>
                              <span>·</span>
                              <span>{tx.account}</span>
                              <span>·</span>
                              <span className="font-mono" style={{ color: tx.aiSuggestion.category === 'Revenue' ? '#10b981' : '#94a3b8' }}>
                                {tx.aiSuggestion.category}{tx.aiSuggestion.subCategory ? ` → ${tx.aiSuggestion.subCategory}` : ''}
                              </span>
                            </div>
                          </div>

                          {/* Confidence */}
                          <div className="w-32 flex-shrink-0">
                            <ConfidenceBar confidence={tx.aiSuggestion.confidence} size="sm" />
                          </div>

                          {/* Amount */}
                          <div className="text-right flex-shrink-0">
                            <p className={`text-sm font-mono ${tx.type === 'credit' ? 'text-emerald-400' : 'text-white'}`}>
                              {tx.type === 'credit' ? '+' : '-'}${tx.amount.toLocaleString()}
                            </p>
                            <p className="text-xs" style={{ color: '#64748b' }}>{tx.currency}</p>
                          </div>

                          {/* Actions */}
                          {!isResolved && (
                            <div className="flex items-center gap-1.5 flex-shrink-0">
                              <motion.button
                                whileHover={{ scale: 1.1 }}
                                whileTap={{ scale: 0.9 }}
                                onClick={(e) => { e.stopPropagation(); handleConfirm(tx.id); }}
                                className="p-1.5 rounded-lg"
                                style={{ background: 'rgba(16, 185, 129, 0.15)' }}
                              >
                                <Check className="size-4 text-emerald-400" />
                              </motion.button>
                              <motion.button
                                whileHover={{ scale: 1.1 }}
                                whileTap={{ scale: 0.9 }}
                                onClick={(e) => { e.stopPropagation(); handleReject(tx.id); }}
                                className="p-1.5 rounded-lg"
                                style={{ background: 'rgba(239, 68, 68, 0.15)' }}
                              >
                                <X className="size-4 text-red-400" />
                              </motion.button>
                            </div>
                          )}

                          {/* Expand chevron */}
                          <motion.div animate={{ rotate: isExpanded ? 90 : 0 }} className="flex-shrink-0">
                            <ChevronRight className="size-4" style={{ color: '#64748b' }} />
                          </motion.div>
                        </div>

                        {/* Expanded Details */}
                        <AnimatePresence>
                          {isExpanded && (
                            <motion.div
                              initial={{ opacity: 0, height: 0 }}
                              animate={{ opacity: 1, height: 'auto' }}
                              exit={{ opacity: 0, height: 0 }}
                              transition={{ duration: 0.3 }}
                              className="overflow-hidden"
                            >
                              <div className="mt-4 pt-4" style={{ borderTop: '1px solid rgba(148, 163, 184, 0.1)' }}>
                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                  {/* AI Reasoning */}
                                  <div>
                                    <div className="flex items-center gap-2 mb-3">
                                      <Lightbulb className="size-4 text-blue-400" />
                                      <span className="text-sm text-white">AI Reasoning</span>
                                    </div>
                                    <p className="text-sm" style={{ color: '#94a3b8', lineHeight: '1.6' }}>
                                      {tx.aiSuggestion.reasoning}
                                    </p>

                                    {/* Alternative Suggestions */}
                                    {tx.aiSuggestion.alternativeSuggestions && tx.aiSuggestion.alternativeSuggestions.length > 0 && (
                                      <div className="mt-4">
                                        <p className="text-xs text-slate-500 mb-2">Alternative Classifications:</p>
                                        <div className="space-y-2">
                                          {tx.aiSuggestion.alternativeSuggestions.map((alt, idx) => (
                                            <div key={idx} className="flex items-center justify-between px-3 py-2 rounded-lg" style={{ background: 'rgba(0, 0, 0, 0.3)', border: '1px solid rgba(148, 163, 184, 0.08)' }}>
                                              <span className="text-xs text-white">{alt.category}</span>
                                              <ConfidenceBar confidence={alt.confidence} size="sm" />
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                  </div>

                                  {/* Clarifying Question */}
                                  {tx.clarifyingQuestion && (
                                    <div>
                                      <div className="flex items-center gap-2 mb-3">
                                        <MessageSquare className="size-4 text-amber-400" />
                                        <span className="text-sm text-white">AI Question</span>
                                      </div>
                                      <div className="rounded-xl p-4 mb-3" style={{ background: 'rgba(245, 158, 11, 0.08)', border: '1px solid rgba(245, 158, 11, 0.2)' }}>
                                        <p className="text-sm text-amber-200">{tx.clarifyingQuestion}</p>
                                      </div>
                                      <div className="flex gap-2">
                                        <input
                                          type="text"
                                          placeholder="Type your answer..."
                                          value={clarificationResponses[tx.id] || ''}
                                          onChange={e => setClarificationResponses(prev => ({ ...prev, [tx.id]: e.target.value }))}
                                          className="flex-1 px-3 py-2 rounded-lg text-sm text-white placeholder:text-slate-500 focus:outline-none"
                                          style={{ ...AXIOM.inputs, border: AXIOM.inputs.border }}
                                          onClick={e => e.stopPropagation()}
                                        />
                                        <motion.button
                                          whileHover={{ scale: 1.05 }}
                                          whileTap={{ scale: 0.95 }}
                                          onClick={(e) => { e.stopPropagation(); handleConfirm(tx.id); }}
                                          className="px-3 py-2 rounded-lg text-sm flex items-center gap-1.5"
                                          style={AXIOM.buttons.action}
                                        >
                                          <Send className="size-3.5" />
                                          Submit
                                        </motion.button>
                                      </div>
                                    </div>
                                  )}

                                  {!tx.clarifyingQuestion && (
                                    <div>
                                      <div className="flex items-center gap-2 mb-3">
                                        <Shield className="size-4 text-blue-400" />
                                        <span className="text-sm text-white">Classification Details</span>
                                      </div>
                                      <div className="space-y-3">
                                        <div className="flex justify-between items-center">
                                          <span className="text-xs" style={{ color: '#94a3b8' }}>Primary Category</span>
                                          <span className="text-xs text-white font-mono">{tx.aiSuggestion.category}</span>
                                        </div>
                                        {tx.aiSuggestion.subCategory && (
                                          <div className="flex justify-between items-center">
                                            <span className="text-xs" style={{ color: '#94a3b8' }}>Sub Category</span>
                                            <span className="text-xs text-white font-mono">{tx.aiSuggestion.subCategory}</span>
                                          </div>
                                        )}
                                        <div className="flex justify-between items-center">
                                          <span className="text-xs" style={{ color: '#94a3b8' }}>Confidence</span>
                                          <ConfidenceBar confidence={tx.aiSuggestion.confidence} size="sm" />
                                        </div>
                                        <div className="flex justify-between items-center">
                                          <span className="text-xs" style={{ color: '#94a3b8' }}>Status</span>
                                          <span className="text-xs font-mono capitalize" style={{ color: tx.status === 'confirmed' ? '#10b981' : tx.status === 'rejected' ? '#ef4444' : '#3b82f6' }}>
                                            {tx.status.replace('_', ' ')}
                                          </span>
                                        </div>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </GlowContainer>
                    </motion.div>
                  );
                })}
              </div>
            </motion.div>
          )}

          {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
          {/* TAB: LEARNED RULES */}
          {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
          {activeTab === 'rules' && (
            <motion.div key="rules" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="space-y-6">
              <div className="flex items-center gap-4">
                <div className="flex-1 relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4" style={{ color: '#64748b' }} />
                  <input
                    type="text"
                    placeholder="Search rules by pattern or category..."
                    value={rulesSearch}
                    onChange={e => setRulesSearch(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 rounded-xl text-sm text-white placeholder:text-slate-500 focus:outline-none"
                    style={{ ...AXIOM.inputs, border: AXIOM.inputs.border }}
                  />
                </div>
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  className="px-4 py-2.5 rounded-xl text-sm font-medium flex items-center gap-2"
                  style={AXIOM.buttons.action}
                >
                  <Plus className="size-4" />
                  Add Rule
                </motion.button>
              </div>

              <GlowContainer color="purple" delay={0.1}>
                <SectionTitle icon={GitBranch} title="Classification Rules" subtitle={`${filteredRules.length} rules actively learning`} color="#a855f7" />
                
                {/* Rules Table */}
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr style={{ borderBottom: '1px solid rgba(148, 163, 184, 0.1)' }}>
                        {['Pattern', 'Category', 'Confidence', 'Times Used', 'Source', 'Last Used', 'Actions'].map(h => (
                          <th key={h} className="text-left py-3 px-3 text-xs font-medium" style={{ color: '#64748b' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredRules.map((rule, i) => (
                        <motion.tr
                          key={rule.id}
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          transition={{ delay: i * 0.04 }}
                          className="group hover:bg-white/[0.02] transition-colors"
                          style={{ borderBottom: '1px solid rgba(148, 163, 184, 0.05)' }}
                        >
                          <td className="py-3 px-3">
                            <code className="text-xs px-2 py-1 rounded" style={{ background: 'rgba(59, 130, 246, 0.1)', color: '#60a5fa' }}>
                              {rule.pattern}
                            </code>
                          </td>
                          <td className="py-3 px-3">
                            <span className="text-sm text-white">{rule.category}</span>
                            {rule.subCategory && (
                              <span className="text-xs block" style={{ color: '#64748b' }}>{rule.subCategory}</span>
                            )}
                          </td>
                          <td className="py-3 px-3 w-32">
                            <ConfidenceBar confidence={rule.confidence} size="sm" />
                          </td>
                          <td className="py-3 px-3">
                            <span className="text-sm font-mono text-white">{rule.timesApplied}</span>
                          </td>
                          <td className="py-3 px-3">
                            <span className="text-xs px-2 py-0.5 rounded-full" style={
                              rule.source === 'ai_learned' ? AXIOM.badges.info :
                              rule.source === 'user_defined' ? AXIOM.badges.purple :
                              AXIOM.badges.cyan
                            }>
                              {rule.source === 'ai_learned' ? '🤖 AI' : rule.source === 'user_defined' ? '👤 User' : '⚙️ System'}
                            </span>
                          </td>
                          <td className="py-3 px-3">
                            <span className="text-xs" style={{ color: '#94a3b8' }}>{rule.lastUsed}</span>
                          </td>
                          <td className="py-3 px-3">
                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <motion.button whileHover={{ scale: 1.1 }} className="p-1.5 rounded-lg" style={{ background: 'rgba(59, 130, 246, 0.1)' }}>
                                <Edit3 className="size-3.5 text-blue-400" />
                              </motion.button>
                              <motion.button whileHover={{ scale: 1.1 }} className="p-1.5 rounded-lg" style={{ background: 'rgba(239, 68, 68, 0.1)' }}>
                                <X className="size-3.5 text-red-400" />
                              </motion.button>
                            </div>
                          </td>
                        </motion.tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </GlowContainer>
            </motion.div>
          )}

          {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
          {/* TAB: LEARNING INSIGHTS */}
          {/* ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
          {activeTab === 'insights' && (
            <motion.div key="insights" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} className="space-y-6">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Accuracy Over Time */}
                <GlowContainer color="blue" delay={0.1}>
                  <SectionTitle icon={TrendingUp} title="AI Accuracy Over Time" subtitle="Classification accuracy improving through learning" color="#3b82f6" />
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={mockLearningMetrics}>
                        <defs>
                          <linearGradient id="accuracyGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.05} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid stroke={AXIOM.charts.grid.stroke} strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="date" stroke={AXIOM.charts.axis.stroke} style={{ fontSize: '12px' }} tickLine={false} axisLine={false} />
                        <YAxis stroke={AXIOM.charts.axis.stroke} style={{ fontSize: '12px' }} tickLine={false} axisLine={false} domain={[60, 100]} unit="%" />
                        <Tooltip contentStyle={AXIOM.charts.tooltip} />
                        <Area type="monotone" dataKey="accuracy" stroke="#3b82f6" fill="url(#accuracyGrad)" strokeWidth={2} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </GlowContainer>

                {/* Auto-Classification Rate */}
                <GlowContainer color="green" delay={0.2}>
                  <SectionTitle icon={Zap} title="Auto-Classification Rate" subtitle="Percentage of transactions classified automatically" color="#10b981" />
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={mockLearningMetrics}>
                        <defs>
                          <linearGradient id="autoGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="#10b981" stopOpacity={0.05} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid stroke={AXIOM.charts.grid.stroke} strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="date" stroke={AXIOM.charts.axis.stroke} style={{ fontSize: '12px' }} tickLine={false} axisLine={false} />
                        <YAxis stroke={AXIOM.charts.axis.stroke} style={{ fontSize: '12px' }} tickLine={false} axisLine={false} domain={[30, 100]} unit="%" />
                        <Tooltip contentStyle={AXIOM.charts.tooltip} />
                        <Area type="monotone" dataKey="autoClassified" stroke="#10b981" fill="url(#autoGrad)" strokeWidth={2} name="Auto-Classified %" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </GlowContainer>

                {/* Category Distribution */}
                <GlowContainer color="purple" delay={0.3}>
                  <SectionTitle icon={BarChart3} title="Category Distribution" subtitle="How transactions are distributed across categories" color="#a855f7" />
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={categoryDistribution}
                          cx="50%"
                          cy="50%"
                          innerRadius={60}
                          outerRadius={90}
                          paddingAngle={3}
                          dataKey="value"
                        >
                          {categoryDistribution.map((entry, idx) => (
                            <Cell key={`cell-${idx}`} fill={entry.color} stroke="transparent" />
                          ))}
                        </Pie>
                        <Tooltip
                          contentStyle={AXIOM.charts.tooltip}
                          formatter={(value: any) => [`${value}%`, 'Share']}
                        />
                        <Legend
                          wrapperStyle={{ fontSize: '11px', color: '#94a3b8' }}
                          formatter={(value) => <span style={{ color: '#94a3b8' }}>{value}</span>}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </GlowContainer>

                {/* Confidence Distribution */}
                <GlowContainer color="cyan" delay={0.4}>
                  <SectionTitle icon={Target} title="Confidence Distribution" subtitle="Distribution of AI confidence scores across all classifications" color="#06b6d4" />
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={confidenceDistribution}>
                        <CartesianGrid stroke={AXIOM.charts.grid.stroke} strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="range" stroke={AXIOM.charts.axis.stroke} style={{ fontSize: '11px' }} tickLine={false} axisLine={false} />
                        <YAxis stroke={AXIOM.charts.axis.stroke} style={{ fontSize: '12px' }} tickLine={false} axisLine={false} />
                        <Tooltip contentStyle={AXIOM.charts.tooltip} />
                        <Bar dataKey="count" radius={[6, 6, 0, 0]} name="Transactions">
                          {confidenceDistribution.map((entry, idx) => (
                            <Cell key={`cell-${idx}`} fill={entry.color} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </GlowContainer>

                {/* Manual Overrides Trend */}
                <GlowContainer color="amber" delay={0.5}>
                  <SectionTitle icon={Activity} title="Manual Overrides Declining" subtitle="Fewer overrides means the AI is learning effectively" color="#f59e0b" />
                  <div className="h-64">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={mockLearningMetrics}>
                        <defs>
                          <linearGradient id="overrideGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="#f59e0b" stopOpacity={0.05} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid stroke={AXIOM.charts.grid.stroke} strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="date" stroke={AXIOM.charts.axis.stroke} style={{ fontSize: '12px' }} tickLine={false} axisLine={false} />
                        <YAxis stroke={AXIOM.charts.axis.stroke} style={{ fontSize: '12px' }} tickLine={false} axisLine={false} />
                        <Tooltip contentStyle={AXIOM.charts.tooltip} />
                        <Area type="monotone" dataKey="manualOverrides" stroke="#f59e0b" fill="url(#overrideGrad)" strokeWidth={2} name="Manual Overrides" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </GlowContainer>

                {/* Recent Activity Feed */}
                <GlowContainer color="blue" delay={0.6}>
                  <SectionTitle icon={Clock} title="Recent AI Activity" subtitle="Latest classification actions and learning events" color="#3b82f6" />
                  <div className="space-y-3">
                    {recentActivity.map((activity, i) => (
                      <motion.div
                        key={activity.id}
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: 0.6 + i * 0.08 }}
                        className="flex items-center gap-3 px-4 py-3 rounded-xl"
                        style={{ background: 'rgba(0, 0, 0, 0.3)', border: '1px solid rgba(148, 163, 184, 0.08)' }}
                      >
                        <div className="flex-shrink-0">
                          {activity.action === 'Auto-classified' && <Zap className="size-4 text-blue-400" />}
                          {activity.action === 'User confirmed' && <CheckCircle2 className="size-4 text-emerald-400" />}
                          {activity.action === 'Rule learned' && <Sparkles className="size-4 text-purple-400" />}
                          {activity.action === 'User override' && <Edit3 className="size-4 text-amber-400" />}
                          {activity.action === 'Question asked' && <MessageSquare className="size-4 text-cyan-400" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-white truncate">{activity.narration}</p>
                          <p className="text-xs" style={{ color: '#64748b' }}>
                            {activity.action} · {activity.category}
                          </p>
                        </div>
                        <span className="text-xs flex-shrink-0" style={{ color: '#64748b' }}>{activity.time}</span>
                      </motion.div>
                    ))}
                  </div>
                </GlowContainer>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}