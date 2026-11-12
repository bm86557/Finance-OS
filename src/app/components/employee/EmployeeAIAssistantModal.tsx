import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Brain,
  X,
  Send,
  Sparkles,
  ThumbsUp,
  ThumbsDown,
  CheckCircle,
  Clock,
  DollarSign,
  AlertCircle,
  Loader2,
  PlusCircle,
  RefreshCw,
  Minus,
  Maximize2,
} from 'lucide-react';
import {
  employeeAIAssistantService,
  type EmployeeAISuggestionsResponse,
  type ActionCardRecommendation,
} from '@/services/employeeAIAssistantService';
import { toast } from 'sonner';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  suggestions?: string[];
  actionCard?: ActionCardRecommendation;
  feedbackGiven?: 'positive' | 'negative';
}

interface EmployeeAIAssistantModalProps {
  isOpen: boolean;
  onClose: () => void;
  orgId: string;
  userId?: string;
  employeeName?: string;
}

/**
 * Lightweight formatting helper for assistant Markdown messages
 */
function FormattedMessage({ text }: { text: string }) {
  const lines = text.split('\n');

  return (
    <div className="space-y-1.5 text-xs sm:text-[13px] leading-relaxed">
      {lines.map((line, idx) => {
        const trimmed = line.trim();
        if (!trimmed) {
          return <div key={idx} className="h-1" />;
        }

        // Heading 3 / Section
        if (trimmed.startsWith('### ')) {
          return (
            <h4 key={idx} className="font-bold text-blue-300 font-mono text-xs uppercase tracking-wider pt-1.5">
              {trimmed.replace(/^###\s*/, '')}
            </h4>
          );
        }

        // Bullet point
        if (trimmed.startsWith('• ') || trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
          const rawBullet = trimmed.replace(/^[•\-\*]\s*/, '');
          return (
            <div key={idx} className="flex items-start gap-1.5 pl-1">
              <span className="text-blue-400 mt-1 shrink-0">•</span>
              <span className="flex-1">{renderInlineStyles(rawBullet)}</span>
            </div>
          );
        }

        return <p key={idx}>{renderInlineStyles(trimmed)}</p>;
      })}
    </div>
  );
}

function renderInlineStyles(str: string): React.ReactNode[] {
  // Parses **bold** and `code`
  const parts = str.split(/(\*\*.*?\*\*|`.*?`)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={i} className="text-white font-semibold">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code key={i} className="px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-300 font-mono text-[11px]">
          {part.slice(1, -1)}
        </code>
      );
    }
    return part;
  });
}

export function EmployeeAIAssistantModal({
  isOpen,
  onClose,
  orgId,
  userId,
  employeeName = 'there',
}: EmployeeAIAssistantModalProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [suggestionsData, setSuggestionsData] = useState<EmployeeAISuggestionsResponse | null>(null);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [createdActions, setCreatedActions] = useState<Record<string, boolean>>({});

  // Feedback correction note state
  const [negativeFeedbackTarget, setNegativeFeedbackTarget] = useState<string | null>(null);
  const [correctionNote, setCorrectionNote] = useState('');

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    if (!isMinimized) {
      scrollToBottom();
    }
  }, [messages, isTyping, isMinimized]);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 150);
      loadSuggestions();
      if (messages.length === 0) {
        setMessages([
          {
            id: 'welcome',
            role: 'assistant',
            content: `Hi ${employeeName}! I'm your Finance OS Employee Assistant. Ask me about your expenses, hours, payslips, or company reimbursement policies.`,
            timestamp: new Date(),
          },
        ]);
      }
    }
  }, [isOpen, orgId]);

  const loadSuggestions = async () => {
    if (!orgId) return;
    setIsLoadingSuggestions(true);
    try {
      const res = await employeeAIAssistantService.getSuggestions(orgId, userId);
      if (res.success && res.data) {
        setSuggestionsData(res.data);
      }
    } catch (err) {
      console.warn('[EmployeeAIAssistant] Error loading suggestions:', err);
    } finally {
      setIsLoadingSuggestions(false);
    }
  };

  const handleSend = async (textToSend?: string) => {
    const text = (textToSend || inputValue).trim();
    if (!text || isTyping || !orgId) return;

    const userMsg: Message = {
      id: `usr_${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInputValue('');
    setIsTyping(true);

    try {
      const history = messages.slice(-6).map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const res = await employeeAIAssistantService.sendMessage(orgId, text, history, userId);

      if (res.success && res.data) {
        const assistantMsg: Message = {
          id: `ast_${Date.now()}`,
          role: 'assistant',
          content: res.data.reply,
          timestamp: new Date(),
          suggestions: res.data.suggestions,
          actionCard: res.data.actionCard,
        };
        setMessages((prev) => [...prev, assistantMsg]);
      } else {
        throw new Error(res.error || 'Failed to generate financial guidance');
      }
    } catch (err: any) {
      console.warn('[EmployeeAIAssistant] Chat error:', err);
      const fallbackMsg: Message = {
        id: `ast_err_${Date.now()}`,
        role: 'assistant',
        content: `I couldn't reach the live AI model at this second (${err?.message || 'Network delay'}). You can check your expense status directly in **My Expenses** or retry in a moment.`,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, fallbackMsg]);
    } finally {
      setIsTyping(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const handleFeedback = async (
    msg: Message,
    rating: 'positive' | 'negative',
    note?: string,
  ) => {
    if (msg.feedbackGiven) return;
    try {
      await employeeAIAssistantService.sendFeedback(orgId, {
        query: messages.find((m) => m.role === 'user')?.content || 'User question',
        reply: msg.content,
        rating,
        correctionNote: note,
      });

      setMessages((prev) =>
        prev.map((m) => (m.id === msg.id ? { ...m, feedbackGiven: rating } : m)),
      );

      toast.success(
        rating === 'positive'
          ? 'Thanks for the feedback!'
          : 'Feedback recorded. This helps improve future answers.',
      );
      setNegativeFeedbackTarget(null);
      setCorrectionNote('');
    } catch (err) {
      console.warn('Feedback error:', err);
    }
  };

  const handleExecuteDraft = async (card: ActionCardRecommendation, msgId: string) => {
    if (actionInProgress || createdActions[msgId]) return;
    setActionInProgress(msgId);
    try {
      const res = await employeeAIAssistantService.executeDraftExpense(orgId, card.payload);
      if (res.success) {
        setCreatedActions((prev) => ({ ...prev, [msgId]: true }));
        toast.success(`Draft created: "${card.payload.description}" ($${card.payload.amount.toFixed(2)})! View in My Expenses.`);
      } else {
        toast.error(res.error || 'Failed to create draft expense');
      }
    } catch (err: any) {
      toast.error(err?.message || 'Action failed');
    } finally {
      setActionInProgress(null);
    }
  };

  if (!isOpen) return null;

  const summary = suggestionsData?.summary;

  // Minimized Floating Pill
  if (isMinimized) {
    return (
      <div className="fixed bottom-4 right-4 z-50">
        <button
          type="button"
          onClick={() => setIsMinimized(false)}
          className="flex items-center gap-3 px-4 py-2.5 rounded-full shadow-2xl border border-blue-500/40 cursor-pointer hover:border-blue-400 transition-all group"
          style={{
            background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.96) 0%, rgba(30, 27, 75, 0.96) 100%)',
            boxShadow: '0 10px 30px rgba(59, 130, 246, 0.3)',
          }}
        >
          <div className="size-6 rounded-full bg-blue-500/20 flex items-center justify-center border border-blue-400/40">
            <Brain className="size-3.5 text-blue-400" />
          </div>
          <span className="text-xs font-mono font-bold text-white tracking-wide">
            AI ADVISOR
          </span>
          <span className="size-2 rounded-full bg-green-400 animate-pulse" />
          <Maximize2 className="size-3.5 text-slate-400 group-hover:text-white transition-colors" />
        </button>
      </div>
    );
  }

  return (
    <AnimatePresence>
      <div className="fixed inset-x-2 bottom-2 top-14 sm:inset-auto sm:bottom-4 sm:right-4 z-50 pointer-events-none">
        <motion.div
          initial={{ opacity: 0, y: 30, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 30, scale: 0.95 }}
          transition={{ duration: 0.22, ease: 'easeOut' }}
          className="w-full sm:w-[410px] md:w-[425px] h-full sm:h-[590px] max-h-[88vh] flex flex-col rounded-2xl overflow-hidden shadow-2xl relative pointer-events-auto border"
          style={{
            background: 'linear-gradient(145deg, rgba(15, 23, 42, 0.97) 0%, rgba(10, 15, 30, 0.98) 100%)',
            borderColor: 'rgba(59, 130, 246, 0.35)',
            boxShadow: '0 20px 60px -15px rgba(0, 0, 0, 0.8), 0 0 35px rgba(59, 130, 246, 0.2)',
          }}
        >
          {/* Header */}
          <div
            className="px-4 py-3 flex items-center justify-between border-b shrink-0"
            style={{
              borderColor: 'rgba(59, 130, 246, 0.2)',
              background: 'linear-gradient(180deg, rgba(30, 41, 59, 0.6) 0%, rgba(15, 23, 42, 0.6) 100%)',
            }}
          >
            <div className="flex items-center gap-2.5">
              <div
                className="size-8 rounded-lg flex items-center justify-center relative shrink-0"
                style={{
                  background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.25), rgba(168, 85, 247, 0.25))',
                  border: '1px solid rgba(59, 130, 246, 0.4)',
                }}
              >
                <Brain className="size-4 text-blue-400" />
                <span className="absolute -top-0.5 -right-0.5 size-2 bg-green-400 rounded-full animate-ping" />
                <span className="absolute -top-0.5 -right-0.5 size-2 bg-green-400 rounded-full" />
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <h2 className="text-xs font-bold text-white tracking-wide font-mono">
                    EMPLOYEE AI ADVISOR
                  </h2>
                  <span className="text-[9px] px-1.5 py-0.2 rounded font-mono bg-blue-500/15 text-blue-300 border border-blue-500/30">
                    RAG v1.2
                  </span>
                </div>
                <p className="text-[10px] text-slate-400 font-mono">
                  Expenses • Timesheets • Policies
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={loadSuggestions}
                disabled={isLoadingSuggestions}
                className="p-1.5 text-slate-400 hover:text-white rounded-md hover:bg-white/5 transition-colors cursor-pointer"
                title="Refresh suggestions"
              >
                <RefreshCw className={`size-3.5 ${isLoadingSuggestions ? 'animate-spin text-blue-400' : ''}`} />
              </button>
              <button
                type="button"
                onClick={() => setIsMinimized(true)}
                className="p-1.5 text-slate-400 hover:text-white rounded-md hover:bg-white/5 transition-colors cursor-pointer"
                title="Minimize"
              >
                <Minus className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={onClose}
                className="p-1.5 text-slate-400 hover:text-white rounded-md hover:bg-white/5 transition-colors cursor-pointer"
                title="Close"
              >
                <X className="size-4" />
              </button>
            </div>
          </div>

          {/* Compact Live Status Strip */}
          {summary && (
            <div
              className="px-3 py-1.5 flex items-center gap-1.5 overflow-x-auto text-[10px] font-mono border-b shrink-0 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
              style={{
                borderColor: 'rgba(59, 130, 246, 0.12)',
                background: 'rgba(0, 0, 0, 0.3)',
              }}
            >
              <div className="flex items-center gap-1 px-2 py-0.5 rounded bg-blue-500/10 border border-blue-500/20 text-blue-300 shrink-0">
                <Clock className="size-2.5 text-blue-400" />
                <span>{summary.hoursThisWeek}h / {summary.hoursTarget}h</span>
              </div>
              <div className="flex items-center gap-1 px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/20 text-amber-300 shrink-0">
                <DollarSign className="size-2.5 text-amber-400" />
                <span>{summary.pendingClaimsCount} claims (${summary.pendingClaimsAmount.toFixed(0)})</span>
              </div>
              {summary.rejectedClaimsCount > 0 && (
                <div className="flex items-center gap-1 px-2 py-0.5 rounded bg-rose-500/15 border border-rose-500/30 text-rose-300 shrink-0">
                  <AlertCircle className="size-2.5 text-rose-400" />
                  <span>{summary.rejectedClaimsCount} rejected</span>
                </div>
              )}
            </div>
          )}

          {/* Messages Scroll Area */}
          <div
            className="flex-1 overflow-y-auto p-3.5 space-y-3.5 text-xs font-sans"
            style={{
              scrollbarWidth: 'thin',
              scrollbarColor: 'rgba(59, 130, 246, 0.3) transparent',
            }}
          >
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex gap-2.5 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                {msg.role === 'assistant' && (
                  <div
                    className="size-6 rounded-md shrink-0 flex items-center justify-center mt-0.5"
                    style={{
                      background: 'rgba(59, 130, 246, 0.15)',
                      border: '1px solid rgba(59, 130, 246, 0.3)',
                    }}
                  >
                    <Brain className="size-3.5 text-blue-400" />
                  </div>
                )}

                <div className={`max-w-[88%] space-y-1.5`}>
                  <div
                    className={`p-3 rounded-xl ${
                      msg.role === 'user'
                        ? 'text-white ml-auto'
                        : 'text-slate-200'
                    }`}
                    style={
                      msg.role === 'user'
                        ? {
                            background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.4), rgba(37, 99, 235, 0.45))',
                            border: '1px solid rgba(59, 130, 246, 0.45)',
                          }
                        : {
                            background: 'rgba(15, 23, 42, 0.8)',
                            border: '1px solid rgba(59, 130, 246, 0.2)',
                          }
                    }
                  >
                    <FormattedMessage text={msg.content} />

                    {/* Action Card Recommendation (Guarded Execution) */}
                    {msg.actionCard && msg.actionCard.type === 'draft_expense' && (
                      <div
                        className="mt-2.5 p-2.5 rounded-lg border text-xs font-mono space-y-1.5"
                        style={{
                          background: 'rgba(0, 0, 0, 0.4)',
                          borderColor: 'rgba(16, 185, 129, 0.35)',
                        }}
                      >
                        <div className="flex items-center justify-between text-green-400 font-bold">
                          <span className="flex items-center gap-1">
                            <PlusCircle className="size-3" />
                            RECOMMENDED ACTION
                          </span>
                          <span className="text-[9px] uppercase px-1 py-0.5 rounded bg-green-500/10 border border-green-500/30">
                            Draft Expense
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-300">
                          <p><strong className="text-white">Item:</strong> {msg.actionCard.payload.description}</p>
                          <p><strong className="text-white">Amount:</strong> ${msg.actionCard.payload.amount.toFixed(2)}</p>
                          <p><strong className="text-white">Category:</strong> {msg.actionCard.payload.category}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleExecuteDraft(msg.actionCard!, msg.id)}
                          disabled={actionInProgress === msg.id || createdActions[msg.id]}
                          className="w-full py-1.5 px-2.5 rounded-md font-bold flex items-center justify-center gap-1.5 cursor-pointer transition-all text-xs"
                          style={{
                            background: createdActions[msg.id]
                              ? 'rgba(16, 185, 129, 0.2)'
                              : 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                            color: createdActions[msg.id] ? '#34d399' : '#ffffff',
                            border: createdActions[msg.id] ? '1px solid rgba(16, 185, 129, 0.4)' : 'none',
                          }}
                        >
                          {actionInProgress === msg.id ? (
                            <>
                              <Loader2 className="size-3 animate-spin" />
                              Creating draft...
                            </>
                          ) : createdActions[msg.id] ? (
                            <>
                              <CheckCircle className="size-3" />
                              Draft Created in My Expenses
                            </>
                          ) : (
                            <>
                              <PlusCircle className="size-3" />
                              Create Draft Claim Now
                            </>
                          )}
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Feedback Controls */}
                  {msg.role === 'assistant' && msg.id !== 'welcome' && (
                    <div className="flex items-center gap-2 px-1 text-[10px] text-slate-500 font-mono">
                      <span>Helpful?</span>
                      <button
                        type="button"
                        onClick={() => handleFeedback(msg, 'positive')}
                        disabled={!!msg.feedbackGiven}
                        className={`hover:text-green-400 transition-colors flex items-center gap-0.5 cursor-pointer ${
                          msg.feedbackGiven === 'positive' ? 'text-green-400 font-bold' : ''
                        }`}
                        title="Helpful"
                      >
                        <ThumbsUp className="size-2.5" />
                        {msg.feedbackGiven === 'positive' && <span>Yes</span>}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (msg.feedbackGiven) return;
                          setNegativeFeedbackTarget(msg.id);
                        }}
                        disabled={!!msg.feedbackGiven}
                        className={`hover:text-rose-400 transition-colors flex items-center gap-0.5 cursor-pointer ${
                          msg.feedbackGiven === 'negative' ? 'text-rose-400 font-bold' : ''
                        }`}
                        title="Not helpful"
                      >
                        <ThumbsDown className="size-2.5" />
                        {msg.feedbackGiven === 'negative' && <span>No</span>}
                      </button>
                    </div>
                  )}

                  {/* Feedback Correction Form */}
                  {negativeFeedbackTarget === msg.id && !msg.feedbackGiven && (
                    <motion.div
                      initial={{ opacity: 0, y: 3 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="p-2.5 rounded-lg border space-y-1.5 text-[11px] font-mono"
                      style={{
                        background: 'rgba(0, 0, 0, 0.5)',
                        borderColor: 'rgba(244, 63, 94, 0.35)',
                      }}
                    >
                      <p className="text-slate-300">
                        What was inaccurate or missing?
                      </p>
                      <input
                        type="text"
                        value={correctionNote}
                        onChange={(e) => setCorrectionNote(e.target.value)}
                        placeholder="e.g. Policy limit is $50..."
                        className="w-full px-2 py-1 rounded bg-black/60 border border-slate-700 text-white text-xs focus:outline-none focus:border-rose-400"
                      />
                      <div className="flex justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => setNegativeFeedbackTarget(null)}
                          className="px-2 py-0.5 text-slate-400 hover:text-white"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => handleFeedback(msg, 'negative', correctionNote)}
                          className="px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/30 hover:bg-rose-500/30"
                        >
                          Send Note
                        </button>
                      </div>
                    </motion.div>
                  )}
                </div>
              </div>
            ))}

            {isTyping && (
              <div className="flex gap-2.5 justify-start">
                <div
                  className="size-6 rounded-md shrink-0 flex items-center justify-center mt-0.5"
                  style={{
                    background: 'rgba(59, 130, 246, 0.15)',
                    border: '1px solid rgba(59, 130, 246, 0.3)',
                  }}
                >
                  <Brain className="size-3.5 text-blue-400 animate-pulse" />
                </div>
                <div
                  className="p-2.5 rounded-xl flex items-center gap-2 text-slate-400 text-xs font-mono"
                  style={{
                    background: 'rgba(15, 23, 42, 0.8)',
                    border: '1px solid rgba(59, 130, 246, 0.2)',
                  }}
                >
                  <Loader2 className="size-3.5 animate-spin text-blue-400" />
                  <span>Checking personal data & policies...</span>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Proactive Contextual Suggestion Chips (Clean, no horizontal scrollbar) */}
          <div
            className="px-3 py-2 border-t overflow-x-auto flex items-center gap-1.5 shrink-0 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
            style={{
              borderColor: 'rgba(59, 130, 246, 0.15)',
              background: 'rgba(10, 15, 30, 0.96)',
            }}
          >
            <Sparkles className="size-3 text-blue-400 shrink-0" />
            <div className="flex gap-1.5">
              {(suggestionsData?.suggestions || [
                'Why was my expense rejected?',
                'How many hours logged this week?',
                'What is the meal allowance policy?',
                'Can I claim software subscriptions?',
              ]).map((s, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => handleSend(s)}
                  disabled={isTyping}
                  className="px-2.5 py-1 rounded-full text-[11px] font-mono text-blue-200 border border-blue-500/25 hover:border-blue-400 hover:bg-blue-500/10 transition-colors whitespace-nowrap cursor-pointer shrink-0 disabled:opacity-50"
                  style={{ background: 'rgba(59, 130, 246, 0.06)' }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Compact Input Box */}
          <div
            className="p-2.5 sm:p-3 border-t shrink-0"
            style={{
              borderColor: 'rgba(59, 130, 246, 0.2)',
              background: 'rgba(15, 23, 42, 0.98)',
            }}
          >
            <div
              className="flex items-center gap-1.5 p-1.5 rounded-xl"
              style={{
                background: 'rgba(0, 0, 0, 0.45)',
                border: '1px solid rgba(59, 130, 246, 0.3)',
              }}
            >
              <textarea
                ref={inputRef}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                rows={1}
                placeholder="Ask about expenses, hours, payslips..."
                className="flex-1 bg-transparent text-white text-xs sm:text-sm focus:outline-none resize-none px-2 py-0.5 placeholder:text-slate-500 font-sans"
              />
              <button
                type="button"
                onClick={() => handleSend()}
                disabled={!inputValue.trim() || isTyping}
                className="size-8 rounded-lg flex items-center justify-center transition-all cursor-pointer disabled:opacity-40 shrink-0"
                style={{
                  background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
                  boxShadow: '0 0 12px rgba(59, 130, 246, 0.4)',
                }}
              >
                <Send className="size-3.5 text-white" />
              </button>
            </div>
            <p className="text-[9px] text-slate-500 font-mono text-center mt-1.5">
              Scoped strictly to your profile. Zero keys exposed in browser.
            </p>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
