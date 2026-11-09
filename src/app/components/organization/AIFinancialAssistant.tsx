import { motion } from 'motion/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useOrgServices } from '@/hooks/useOrgServices';
import { fetchOrgAiSettings, type ExtendedOrgAiSettings } from '@/services/aiSettingsService';
import type { OrgAiIntegrationSettings } from '@/services/types';
import {
  aiAssistantService,
  type AIAnalysisData,
  type AIInsight,
  type FinancialPattern,
  type AIFinancialSituation,
  type AIProjections,
} from '@/services/aiAssistantService';
import {
  Brain,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  CheckCircle2,
  Lightbulb,
  Target,
  Users,
  PieChart,
  Activity,
  Send,
  Loader2,
  MessageCircle,
  RefreshCw,
  Sparkles,
} from 'lucide-react';

type ChatRole = 'user' | 'assistant';
interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  suggestions?: string[];
}

const CHAT_QUICK_PROMPTS = [
  'How is my cash position and runway?',
  'What are my biggest expenses?',
  'Explain profit margin trends',
  'Are my personal drawings too high?',
];

/** Hard cap (paste + typing); soft threshold shows a calm warning only */
const CHAT_INPUT_MAX = 4000;
const CHAT_SOFT_WARN = 2000;

export function AIFinancialAssistant() {
  const { orgId } = useOrgServices();
  const [aiSettings, setAiSettings] = useState<ExtendedOrgAiSettings | null>(null);

  // Live analysis state (pattern recognition, situation, projections, insights)
  const [analysis, setAnalysis] = useState<AIAnalysisData | null>(null);
  const [loadingAnalysis, setLoadingAnalysis] = useState<boolean>(true);
  const [refreshingAnalysis, setRefreshingAnalysis] = useState<boolean>(false);

  const loadAnalysis = useCallback(async (isRefresh = false) => {
    if (!orgId) return;
    if (isRefresh) setRefreshingAnalysis(true);
    else setLoadingAnalysis(true);
    try {
      const res = await aiAssistantService.getAnalysis(orgId);
      if (res.success && res.data) {
        setAnalysis(res.data);
      }
    } catch (err) {
      console.error('Failed to load AI analysis:', err);
    } finally {
      setLoadingAnalysis(false);
      setRefreshingAnalysis(false);
    }
  }, [orgId]);

  useEffect(() => {
    void loadAnalysis();
  }, [loadAnalysis]);

  useEffect(() => {
    const sync = () => {
      void (async () => {
        const res = await fetchOrgAiSettings(orgId);
        setAiSettings(res.success ? res.data ?? null : null);
      })();
    };
    sync();
    window.addEventListener('finance-os-ai-settings', sync);
    return () => window.removeEventListener('finance-os-ai-settings', sync);
  }, [orgId]);

  const currentSituation: AIFinancialSituation = analysis?.situation ?? {
    cashPosition: loadingAnalysis ? 'analyzing...' : 'healthy',
    burnRate: loadingAnalysis ? 'calculating...' : '$0/month',
    runway: loadingAnalysis ? 'calculating...' : '0 months',
    profitMargin: loadingAnalysis ? 'calculating...' : '0%',
    personalDrawings: loadingAnalysis ? 'calculating...' : '0% (none)',
    teamUtilization: loadingAnalysis ? 'calculating...' : '85%',
  };

  const futureProjections: AIProjections = analysis?.projections ?? {
    nextQuarter: {
      revenue: loadingAnalysis ? 'calculating...' : '$0',
      profit: loadingAnalysis ? 'calculating...' : '$0',
      confidence: 75,
    },
    nextYear: {
      revenue: loadingAnalysis ? 'calculating...' : '$0',
      profit: loadingAnalysis ? 'calculating...' : '$0',
      confidence: 65,
    },
  };

  const aiInsights: AIInsight[] = analysis?.insights ?? [];
  const financialPatterns: FinancialPattern[] = analysis?.patterns ?? [];

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, sending]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSend = useCallback(async (text?: string) => {
    const raw = (text ?? input).trim();
    if (!raw || sending) return;
    if (raw.length > CHAT_INPUT_MAX) return;
    setSendError(null);

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: raw,
    };
    // Commit user bubble before sending=true so the log never briefly shows neither empty hero nor bubbles
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setSending(true);

    try {
      const history = messages.map((m) => ({ role: m.role, content: m.content }));
      const res = await aiAssistantService.sendMessage(orgId, raw, history);

      if (res.success && res.data) {
        const assistantMsg: ChatMessage = {
          id: `a-${Date.now()}`,
          role: 'assistant',
          content: res.data.reply,
          suggestions: res.data.suggestions,
        };
        setMessages((prev) => [...prev, assistantMsg]);
      } else {
        throw new Error(res.error || 'AI Assistant is currently unavailable.');
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Something went wrong. Try again.';
      setSendError(msg);
    } finally {
      setSending(false);
    }
  }, [input, sending, messages, orgId]);

  return (
    <div className="min-h-screen p-8 space-y-6" style={{ background: '#0a0a0a' }}>
      {/* Header with Dashboard Gradient and Actions */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col md:flex-row md:items-center justify-between gap-4"
      >
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div
              className="p-3 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center"
              style={{ boxShadow: '0 10px 30px -10px rgba(168, 85, 247, 0.6)' }}
            >
              <Brain className="size-6 text-white" />
            </div>
            <h1 className="text-4xl font-bold" style={{
              background: 'linear-gradient(135deg, #ffffff 0%, #a855f7 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
            }}>AI Financial Assistant</h1>
          </div>
          <p className="text-slate-400 text-xs">Pattern recognition, financial intelligence, and strategic recommendations</p>
          {aiSettings && (aiSettings.providerName.trim() || aiSettings.modelName.trim()) && (
            <p className="text-slate-500 text-xs mt-2 max-w-2xl leading-relaxed">
              Provider: {aiSettings.providerName.trim() || 'Gemini'}
              {aiSettings.modelName.trim() ? ` · Model: ${aiSettings.modelName.trim()}` : ''}
              {aiSettings.useCustomKey && ' · Custom API Key active'}
            </p>
          )}
        </div>

        <div className="flex items-center gap-3">
          {aiSettings?.quotaExceeded ? (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-amber-500/40 bg-amber-950/40 text-amber-200 text-xs font-medium">
              <AlertTriangle className="size-3.5 text-amber-400" />
              <span>Org Key Quota Reached</span>
            </div>
          ) : aiSettings?.useCustomKey ? (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-emerald-500/40 bg-emerald-950/40 text-emerald-200 text-xs font-medium">
              <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span>{aiSettings.providerName || 'Your API Key'} Connected</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-purple-500/30 bg-purple-950/40 text-purple-200 text-xs font-medium">

              <Sparkles className="size-3.5 text-purple-400" />
              <span>Finance OS AI Connected</span>
            </div>
          )}

          <button
            type="button"
            onClick={() => void loadAnalysis(true)}
            disabled={refreshingAnalysis || loadingAnalysis}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-medium text-white bg-slate-800/90 hover:bg-slate-700/90 border border-slate-700 transition-colors disabled:opacity-50"
            title="Refresh Pattern Recognition and Insights"
          >
            <RefreshCw className={`size-3.5 ${refreshingAnalysis ? 'animate-spin' : ''}`} />
            <span>{refreshingAnalysis ? 'Analyzing...' : 'Refresh Insights'}</span>
          </button>
        </div>
      </motion.div>

      {/* ORG-P04: chat panel — send path + empty state + errors in UI */}
      <motion.section
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        className="rounded-3xl border border-purple-500/25 bg-gradient-to-b from-slate-900/90 to-black/40 p-6 shadow-lg shadow-purple-900/20"
        aria-label="AI chat"
      >
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-600/30 ring-1 ring-purple-400/30">
            <MessageCircle className="h-5 w-5 text-purple-200" aria-hidden />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-white">Ask the assistant</h2>
            <p className="text-xs text-slate-400">
              Live Gemini AI financial intelligence connected to your ledger. Ask questions or use a quick prompt.
            </p>
          </div>
        </div>

        <div
          className="mb-4 max-h-[min(360px,50vh)] min-h-[200px] overflow-y-auto rounded-2xl border border-slate-700/60 bg-black/30 px-4 py-3"
          role="log"
          aria-live="polite"
        >
          {messages.length === 0 && !sending && (
            <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
              <p className="text-sm text-slate-300">No messages yet</p>
              <p className="max-w-md text-xs text-slate-500">
                Start a conversation about your finances. Answers below the fold are sample dashboards until your data is connected.
              </p>
              <div className="mt-2 flex flex-wrap justify-center gap-2">
                {CHAT_QUICK_PROMPTS.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => void handleSend(q)}
                    disabled={sending}
                    className="rounded-full border border-slate-600 bg-slate-800/80 px-3 py-1.5 text-xs text-slate-200 transition-colors hover:bg-slate-700 disabled:opacity-50"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.length === 0 && sending && (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-400" aria-live="polite">
              <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
              <span>Sending your message…</span>
            </div>
          )}

          <ul className="space-y-3">
            {messages.map((m) => (
              <li
                key={m.id}
                className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${m.role === 'user'
                    ? 'bg-purple-600/35 text-white ring-1 ring-purple-400/30'
                    : 'border border-slate-600/80 bg-slate-900/80 text-slate-100'
                    }`}
                >
                  {m.content}
                  {m.role === 'assistant' && m.suggestions && m.suggestions.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-600/50 pt-3">
                      {m.suggestions.map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => void handleSend(s)}
                          disabled={sending}
                          className="rounded-full border border-slate-600 bg-transparent px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-800 disabled:opacity-50"
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {sending && messages.length > 0 && (
            <div className="mt-3 flex items-center gap-2 text-xs text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              <span>Thinking…</span>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {sendError && (
          <div
            className="mb-3 rounded-xl border border-amber-500/40 bg-amber-950/30 px-3 py-2 text-sm text-amber-100"
            role="alert"
          >
            {sendError}
          </div>
        )}

        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <textarea
              ref={inputRef}
              id="ai-chat-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void handleSend();
                }
              }}
              placeholder="Ask about cash flow, expenses, or margins…"
              disabled={sending}
              rows={3}
              maxLength={CHAT_INPUT_MAX}
              aria-describedby="ai-chat-input-hint"
              className="min-h-[88px] w-full resize-y rounded-xl border border-slate-600 bg-slate-950/80 px-4 py-3 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500/40 disabled:opacity-60"
            />
            <div
              id="ai-chat-input-hint"
              className="flex flex-wrap items-center justify-between gap-2 px-0.5 text-xs text-slate-500"
            >
              <span className={input.length > CHAT_SOFT_WARN ? 'text-amber-200/85' : 'text-slate-600'}>
                {input.length > CHAT_SOFT_WARN
                  ? 'Long messages may feel slower in the demo. Consider shortening.'
                  : '\u00a0'}
              </span>
              <span
                className={`tabular-nums ${input.length > CHAT_SOFT_WARN ? 'text-amber-200/90' : ''}`}
              >
                {input.length} / {CHAT_INPUT_MAX}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={sending || !input.trim() || input.length > CHAT_INPUT_MAX}
            className="inline-flex h-11 min-w-[100px] shrink-0 items-center justify-center gap-2 rounded-xl bg-purple-600 px-4 text-sm font-medium text-white transition-opacity hover:bg-purple-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Send
          </button>
        </div>
      </motion.section>

      {/* Current Situation - Dashboard Style */}
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="p-8 rounded-3xl relative overflow-hidden"
        style={{
          background: 'linear-gradient(135deg, rgba(30, 15, 50, 0.6) 0%, rgba(10, 5, 20, 0.8) 100%)',
          border: '1px solid rgba(6, 182, 212, 0.2)',
          boxShadow: '0 20px 60px -20px rgba(6, 182, 212, 0.5)',
        }}
      >
        <div
          className="absolute inset-0 opacity-40"
          style={{
            background: 'radial-gradient(circle at 50% 50%, rgba(6, 182, 212, 0.3), transparent 70%)',
          }}
        />

        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-6">
            <div
              className="w-12 h-12 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-500 flex items-center justify-center"
              style={{ boxShadow: '0 10px 30px -10px rgba(6, 182, 212, 0.6)' }}
            >
              <Activity className="w-6 h-6 text-white" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-white">Current Financial Situation</h2>
              <p className="text-slate-400 text-sm">AI-powered analysis of your business health</p>
            </div>
          </div>

          <div className="grid md:grid-cols-3 gap-4">
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.2 }}
              className="p-4 rounded-2xl"
              style={{
                background: 'rgba(0, 0, 0, 0.3)',
                border: '1px solid rgba(148, 163, 184, 0.1)',
              }}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-slate-400">Cash Position</span>
                <CheckCircle2 className="size-4 text-green-400" />
              </div>
              <p className="font-bold text-white text-xl capitalize">{currentSituation.cashPosition}</p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.25 }}
              className="p-4 rounded-2xl"
              style={{
                background: 'rgba(0, 0, 0, 0.3)',
                border: '1px solid rgba(148, 163, 184, 0.1)',
              }}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-slate-400">Monthly Burn Rate</span>
                <TrendingDown className="size-4 text-orange-400" />
              </div>
              <p className="font-bold text-white text-xl">{currentSituation.burnRate}</p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.3 }}
              className="p-4 rounded-2xl"
              style={{
                background: 'rgba(0, 0, 0, 0.3)',
                border: '1px solid rgba(148, 163, 184, 0.1)',
              }}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-slate-400">Runway</span>
                <Target className="size-4 text-cyan-400" />
              </div>
              <p className="font-bold text-white text-xl">{currentSituation.runway}</p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.35 }}
              className="p-4 rounded-2xl"
              style={{
                background: 'rgba(0, 0, 0, 0.3)',
                border: '1px solid rgba(148, 163, 184, 0.1)',
              }}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-slate-400">Profit Margin</span>
                <TrendingUp className="size-4 text-green-400" />
              </div>
              <p className="font-bold text-white text-xl">{currentSituation.profitMargin}</p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.4 }}
              className="p-4 rounded-2xl"
              style={{
                background: 'rgba(0, 0, 0, 0.3)',
                border: '1px solid rgba(148, 163, 184, 0.1)',
              }}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-slate-400">Personal Drawings</span>
                {currentSituation.personalDrawings.toLowerCase().includes('high') ? (
                  <AlertTriangle className="size-4 text-amber-400" />
                ) : (
                  <CheckCircle2 className="size-4 text-emerald-400" />
                )}
              </div>
              <p className="font-bold text-white text-xl">{currentSituation.personalDrawings}</p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.45 }}
              className="p-4 rounded-2xl"
              style={{
                background: 'rgba(0, 0, 0, 0.3)',
                border: '1px solid rgba(148, 163, 184, 0.1)',
              }}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm text-slate-400">Team Utilization</span>
                <Users className="size-4 text-blue-400" />
              </div>
              <p className="font-bold text-white text-xl">{currentSituation.teamUtilization}</p>
            </motion.div>
          </div>
        </div>
      </motion.div>

      {/* Future Projections - Dashboard Style */}
      <div className="grid md:grid-cols-2 gap-6">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
          className="p-8 rounded-3xl relative overflow-hidden"
          style={{
            background: 'linear-gradient(135deg, rgba(30, 15, 50, 0.6) 0%, rgba(10, 5, 20, 0.8) 100%)',
            border: '1px solid rgba(16, 185, 129, 0.2)',
            boxShadow: '0 20px 60px -20px rgba(16, 185, 129, 0.5)',
          }}
        >
          <div
            className="absolute inset-0 opacity-40"
            style={{
              background: 'radial-gradient(circle at 50% 50%, rgba(16, 185, 129, 0.3), transparent 70%)',
            }}
          />

          <div className="relative z-10">
            <div className="flex items-center gap-3 mb-6">
              <div
                className="w-12 h-12 rounded-xl bg-gradient-to-br from-emerald-500 to-green-500 flex items-center justify-center"
                style={{ boxShadow: '0 10px 30px -10px rgba(16, 185, 129, 0.6)' }}
              >
                <TrendingUp className="w-6 h-6 text-white" />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-white">Next Quarter Projection</h2>
                <p className="text-slate-400 text-sm">AI-powered forecast based on patterns</p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="p-4 rounded-2xl" style={{
                background: 'rgba(0, 0, 0, 0.3)',
                border: '1px solid rgba(148, 163, 184, 0.1)',
              }}>
                <div className="text-xs text-slate-400 mb-2">Expected Revenue</div>
                <p className="text-3xl font-bold text-white mb-3">{futureProjections.nextQuarter.revenue}</p>
                <div className="flex items-center gap-2">
                  <div className="flex-1 bg-slate-800 rounded-full h-2">
                    <motion.div
                      className="bg-gradient-to-r from-emerald-500 to-green-500 h-2 rounded-full"
                      initial={{ width: 0 }}
                      animate={{ width: `${futureProjections.nextQuarter.confidence}%` }}
                      transition={{ duration: 1.5, delay: 0.7 }}
                      style={{ boxShadow: '0 0 10px rgba(16, 185, 129, 0.6)' }}
                    />
                  </div>
                  <span className="text-xs text-slate-400">{futureProjections.nextQuarter.confidence}% confidence</span>
                </div>
              </div>
              <div className="p-4 bg-green-600/20 border border-green-500/30 rounded-2xl">
                <div className="text-xs text-green-400 mb-2">Expected Profit</div>
                <p className="text-3xl font-bold text-white">{futureProjections.nextQuarter.profit}</p>
              </div>
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6 }}
          className="p-8 rounded-3xl relative overflow-hidden"
          style={{
            background: 'linear-gradient(135deg, rgba(30, 15, 50, 0.6) 0%, rgba(10, 5, 20, 0.8) 100%)',
            border: '1px solid rgba(59, 130, 246, 0.2)',
            boxShadow: '0 20px 60px -20px rgba(59, 130, 246, 0.5)',
          }}
        >
          <div
            className="absolute inset-0 opacity-40"
            style={{
              background: 'radial-gradient(circle at 50% 50%, rgba(59, 130, 246, 0.3), transparent 70%)',
            }}
          />

          <div className="relative z-10">
            <div className="flex items-center gap-3 mb-6">
              <div
                className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center"
                style={{ boxShadow: '0 10px 30px -10px rgba(59, 130, 246, 0.6)' }}
              >
                <Target className="w-6 h-6 text-white" />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-white">Next Year Projection</h2>
                <p className="text-slate-400 text-sm">Long-term forecast</p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="p-4 rounded-2xl" style={{
                background: 'rgba(0, 0, 0, 0.3)',
                border: '1px solid rgba(148, 163, 184, 0.1)',
              }}>
                <div className="text-xs text-slate-400 mb-2">Expected Revenue</div>
                <p className="text-3xl font-bold text-white mb-3">{futureProjections.nextYear.revenue}</p>
                <div className="flex items-center gap-2">
                  <div className="flex-1 bg-slate-800 rounded-full h-2">
                    <motion.div
                      className="bg-gradient-to-r from-blue-500 to-cyan-500 h-2 rounded-full"
                      initial={{ width: 0 }}
                      animate={{ width: `${futureProjections.nextYear.confidence}%` }}
                      transition={{ duration: 1.5, delay: 0.8 }}
                      style={{ boxShadow: '0 0 10px rgba(59, 130, 246, 0.6)' }}
                    />
                  </div>
                  <span className="text-xs text-slate-400">{futureProjections.nextYear.confidence}% confidence</span>
                </div>
              </div>
              <div className="p-4 bg-blue-600/20 border border-blue-500/30 rounded-2xl">
                <div className="text-xs text-blue-400 mb-2">Expected Profit</div>
                <p className="text-3xl font-bold text-white">{futureProjections.nextYear.profit}</p>
              </div>
            </div>
          </div>
        </motion.div>
      </div>

      {/* AI Insights - Dashboard Style */}
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.7 }}
        className="p-8 rounded-3xl"
        style={{
          background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.5) 0%, rgba(0, 0, 0, 0.3) 100%)',
          border: '1px solid rgba(148, 163, 184, 0.1)',
          boxShadow: '0 20px 60px -20px rgba(0, 0, 0, 0.8)',
        }}
      >
        <div className="flex items-center gap-3 mb-6">
          <div
            className="w-12 h-12 rounded-xl bg-gradient-to-br from-yellow-500 to-amber-500 flex items-center justify-center"
            style={{ boxShadow: '0 10px 30px -10px rgba(245, 158, 11, 0.6)' }}
          >
            <Lightbulb className="w-6 h-6 text-white" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-white">AI-Generated Insights & Recommendations</h2>
            <p className="text-slate-400 text-sm">Actionable intelligence from your financial data</p>
          </div>
        </div>

        <div className="space-y-3">
          {aiInsights.length === 0 ? (
            <div className="py-8 text-center text-sm text-slate-400">
              {loadingAnalysis ? (
                <div className="flex items-center justify-center gap-2">
                  <Loader2 className="size-4 animate-spin text-purple-400" />
                  <span>Analyzing financial ledger and detecting insights...</span>
                </div>
              ) : (
                'No critical anomalies or insights detected yet. As you record transactions, AI will automatically flag opportunities and risks.'
              )}
            </div>
          ) : (
            aiInsights.map((insight, idx) => (
              <motion.div
                key={insight.id}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.8 + idx * 0.1 }}
                className={`p-5 rounded-2xl border ${insight.type === 'warning'
                  ? 'bg-red-900/10 border-red-600/30'
                  : insight.type === 'opportunity'
                    ? 'bg-cyan-900/10 border-cyan-600/30'
                    : insight.type === 'success'
                      ? 'bg-green-900/10 border-green-600/30'
                      : 'bg-blue-900/10 border-blue-600/30'
                  }`}
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-start gap-3 flex-1">
                    <div className={`p-2 rounded-lg ${insight.type === 'warning'
                      ? 'bg-red-600/20'
                      : insight.type === 'opportunity'
                        ? 'bg-cyan-600/20'
                        : insight.type === 'success'
                          ? 'bg-green-600/20'
                          : 'bg-blue-600/20'
                      }`}>
                      {insight.type === 'warning' && <AlertTriangle className="size-4 text-red-400" />}
                      {insight.type === 'opportunity' && <TrendingUp className="size-4 text-cyan-400" />}
                      {insight.type === 'success' && <CheckCircle2 className="size-4 text-green-400" />}
                      {insight.type === 'info' && <Brain className="size-4 text-blue-400" />}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-semibold text-white">{insight.title}</h3>
                        <div className="px-2 py-1 rounded text-xs text-slate-300 border border-slate-600">
                          {insight.category}
                        </div>
                        <div className={`px-2 py-1 rounded text-xs font-medium ${insight.impact === 'high'
                          ? 'bg-red-500/20 text-red-300 border border-red-400/30'
                          : insight.impact === 'medium'
                            ? 'bg-yellow-500/20 text-yellow-300 border border-yellow-400/30'
                            : 'bg-blue-500/20 text-blue-300 border border-blue-400/30'
                          }`}>
                          {insight.impact} impact
                        </div>
                      </div>
                      <p className="text-sm text-slate-300 mb-2">{insight.description}</p>
                      {insight.recommendation && (
                        <div className={`p-3 rounded-lg mt-2 ${insight.type === 'warning'
                          ? 'bg-red-950/50'
                          : insight.type === 'opportunity'
                            ? 'bg-cyan-950/50'
                            : 'bg-green-950/50'
                          }`}>
                          <div
                            className={`mb-1 flex items-center gap-1.5 text-xs ${insight.type === 'warning'
                              ? 'text-red-400'
                              : insight.type === 'opportunity'
                                ? 'text-cyan-400'
                                : 'text-green-400'
                              }`}
                          >
                            <Lightbulb className="size-3.5 shrink-0" aria-hidden />
                            AI recommendation
                          </div>
                          <p className="text-sm text-white">{insight.recommendation}</p>
                        </div>
                      )}
                    </div>
                  </div>
                  {insight.actionable && (
                    <motion.button
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      className="px-4 py-2 rounded-lg text-sm font-medium text-white ml-4"
                      style={{
                        background: 'linear-gradient(135deg, rgba(168, 85, 247, 0.3), rgba(236, 72, 153, 0.3))',
                        border: '1px solid rgba(168, 85, 247, 0.5)',
                      }}
                    >
                      Take Action
                    </motion.button>
                  )}
                </div>
              </motion.div>
            ))
          )}
        </div>
      </motion.div>

      {/* Financial Patterns - Dashboard Style */}
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.9 }}
        className="p-8 rounded-3xl"
        style={{
          background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.5) 0%, rgba(0, 0, 0, 0.3) 100%)',
          border: '1px solid rgba(148, 163, 184, 0.1)',
          boxShadow: '0 20px 60px -20px rgba(0, 0, 0, 0.8)',
        }}
      >
        <div className="flex items-center gap-3 mb-6">
          <div
            className="w-12 h-12 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center"
            style={{ boxShadow: '0 10px 30px -10px rgba(168, 85, 247, 0.6)' }}
          >
            <PieChart className="w-6 h-6 text-white" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-white">Detected Financial Patterns</h2>
            <p className="text-slate-400 text-sm">AI learns your business rhythm</p>
          </div>
        </div>

        <div className="space-y-3">
          {financialPatterns.length === 0 ? (
            <div className="py-8 text-center text-sm text-slate-400">
              {loadingAnalysis ? (
                <div className="flex items-center justify-center gap-2">
                  <Loader2 className="size-4 animate-spin text-purple-400" />
                  <span>Recognizing revenue rhythms and expenditure cycles...</span>
                </div>
              ) : (
                'Patterns will emerge here as transaction history grows across billing cycles.'
              )}
            </div>
          ) : (
            financialPatterns.map((pattern, idx) => (
              <motion.div
                key={pattern.id}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 1.0 + idx * 0.1 }}
                className="p-5 rounded-2xl"
                style={{
                  background: 'rgba(0, 0, 0, 0.3)',
                  border: '1px solid rgba(148, 163, 184, 0.1)',
                }}
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold text-white">{pattern.pattern}</h3>
                      <div className={`px-2 py-1 rounded text-xs font-medium flex items-center gap-1 ${pattern.trend === 'increasing'
                        ? 'bg-green-500/20 text-green-300 border border-green-400/30'
                        : pattern.trend === 'decreasing'
                          ? 'bg-red-500/20 text-red-300 border border-red-400/30'
                          : 'bg-blue-500/20 text-blue-300 border border-blue-400/30'
                        }`}>
                        {pattern.trend === 'increasing' && <TrendingUp className="size-3" />}
                        {pattern.trend === 'decreasing' && <TrendingDown className="size-3" />}
                        {pattern.trend}
                      </div>
                    </div>
                    <p className="text-sm text-slate-400 mb-2">Occurs: {pattern.frequency}</p>
                    <div className="p-3 bg-purple-900/20 rounded-lg border border-purple-600/30">
                      <p className="text-sm text-purple-300">{pattern.suggestion}</p>
                    </div>
                  </div>
                </div>
              </motion.div>
            ))
          )}
        </div>
      </motion.div>

      {/* How AI Works - Dashboard Style */}
      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 1.1 }}
        className="p-8 rounded-3xl relative overflow-hidden"
        style={{
          background: 'linear-gradient(135deg, rgba(30, 15, 50, 0.6) 0%, rgba(10, 5, 20, 0.8) 100%)',
          border: '1px solid rgba(168, 85, 247, 0.2)',
          boxShadow: '0 20px 60px -20px rgba(168, 85, 247, 0.5)',
        }}
      >
        <div
          className="absolute inset-0 opacity-40"
          style={{
            background: 'radial-gradient(circle at 50% 50%, rgba(139, 92, 246, 0.3), transparent 70%)',
          }}
        />

        <div className="relative z-10">
          <div className="flex items-start gap-4">
            <div
              className="p-3 rounded-xl bg-purple-600/20"
              style={{ border: '1px solid rgba(168, 85, 247, 0.3)' }}
            >
              <Brain className="size-6 text-purple-400" />
            </div>
            <div>
              <h3 className="font-semibold text-white mb-3 text-xl">How AI Financial Assistant Works</h3>
              <ul className="space-y-3 text-sm text-slate-300">
                <li className="flex items-start gap-2">
                  <span className="text-purple-400 mt-0.5 font-bold">•</span>
                  <span><strong className="text-white">Pattern Recognition:</strong> Analyzes your spending, revenue, and timing patterns</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-purple-400 mt-0.5 font-bold">•</span>
                  <span><strong className="text-white">Benchmarking:</strong> Compares your metrics against industry standards</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-purple-400 mt-0.5 font-bold">•</span>
                  <span><strong className="text-white">Predictive Analytics:</strong> Forecasts future scenarios based on historical data</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-purple-400 mt-0.5 font-bold">•</span>
                  <span><strong className="text-white">Proactive Alerts:</strong> Warns you before problems become critical</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-purple-400 mt-0.5 font-bold">•</span>
                  <span><strong className="text-white">Continuous Learning:</strong> Gets smarter as you use the system more</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}