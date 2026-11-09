import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  MessageCircle, 
  X, 
  Send, 
  Sparkles,
  TrendingUp,
  DollarSign,
  AlertCircle,
  Minimize2,
  Maximize2,
  Loader2,
} from 'lucide-react';
import { Button } from '../ui/button';
import { Card, CardContent } from '../ui/card';
import { usePermissions } from '@/hooks/usePermissions';
import { useOrgServices } from '@/hooks/useOrgServices';
import { aiAssistantService } from '@/services/aiAssistantService';

interface Message {
  id: string;
  type: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  suggestions?: string[];
}

const QUICK_QUESTIONS = [
  'Why did profit drop last month?',
  'Show me cash flow forecast',
  'Which clients are most profitable?',
  'What are my biggest expenses?',
  'How is my budget tracking?'
];

export function AIAssistantChat() {
  const { can } = usePermissions();
  const { orgId } = useOrgServices();
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      type: 'assistant',
      content: 'Hi! I\'m your AI financial assistant. Ask me anything about your finances, and I\'ll provide insights based on your data.',
      timestamp: new Date(),
      suggestions: QUICK_QUESTIONS
    }
  ]);
  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isTyping]);

  useEffect(() => {
    if (isOpen && !isMinimized && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen, isMinimized]);

  // Reset conversation when organization switches
  useEffect(() => {
    setMessages([
      {
        id: `welcome-${orgId}`,
        type: 'assistant',
        content: 'Hi! I\'m your AI financial assistant. Ask me anything about your finances, and I\'ll provide insights based on your data.',
        timestamp: new Date(),
        suggestions: QUICK_QUESTIONS
      }
    ]);
  }, [orgId]);

  const handleSend = async (text?: string) => {
    const messageText = (text || inputValue).trim();
    if (!messageText || isTyping) return;

    // Add user message immediately
    const userMessage: Message = {
      id: `user_${Date.now()}`,
      type: 'user',
      content: messageText,
      timestamp: new Date()
    };
    setMessages(prev => [...prev, userMessage]);
    setInputValue('');
    setIsTyping(true);

    try {
      // Build conversation history (last 6 messages)
      const history = messages
        .slice(-6)
        .map(m => ({
          role: m.type === 'user' ? 'user' : 'assistant',
          content: m.content
        }));

      const res = await aiAssistantService.sendMessage(orgId, messageText, history);

      if (res.success && res.data) {
        const assistantMessage: Message = {
          id: `assistant_${Date.now()}`,
          type: 'assistant',
          content: res.data.reply,
          timestamp: new Date(),
          suggestions: res.data.suggestions && res.data.suggestions.length > 0
            ? res.data.suggestions
            : QUICK_QUESTIONS
        };
        setMessages(prev => [...prev, assistantMessage]);
      } else {
        throw new Error(res.error || 'Failed to generate financial analysis.');
      }
    } catch (err: any) {
      console.warn('[AIAssistantChat] Error sending message:', err);
      const fallbackMessage: Message = {
        id: `assistant_err_${Date.now()}`,
        type: 'assistant',
        content: `I analyzed your inquiry based on available records, but the connection encountered an issue: ${err?.message || 'Service unavailable'}. Please verify your network and active session.`,
        timestamp: new Date(),
        suggestions: QUICK_QUESTIONS
      };
      setMessages(prev => [...prev, fallbackMessage]);
    } finally {
      setIsTyping(false);
    }
  };

  const handleQuickQuestion = (question: string) => {
    void handleSend(question);
  };

  if (!can('ai_assistant')) {
    return null;
  }

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 left-6 w-14 h-14 bg-primary/10 border border-primary/15 rounded-full flex items-center justify-center shadow-[0_0_0_1px_rgba(58,125,255,0.15)] hover:shadow-[0_0_26px_rgba(58,125,255,0.15)] transition-all z-40 group"
        title="AI Assistant"
      >
        <MessageCircle className="w-6 h-6 text-primary" />
      </button>
    );
  }

  return (
    <>
      {/* Chat Widget Button */}
      {!isOpen && !isMinimized && (
        <motion.button
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0, opacity: 0 }}
          whileHover={{ scale: 1.05 }}
          whileTap={{ scale: 0.95 }}
          onClick={() => setIsOpen(true)}
          className="fixed bottom-6 right-6 z-50 rounded-full p-4 border border-primary/15 bg-primary/10 hover:bg-primary/15 shadow-[0_0_0_1px_rgba(58,125,255,0.15)] hover:shadow-[0_0_40px_rgba(58,125,255,0.15)] transition-all"
          style={{
            background: 'transparent',
            boxShadow: 'none',
          }}
        >
          <Sparkles className="w-6 h-6 text-primary" />
        </motion.button>
      )}

      {/* Chat Window */}
      {isOpen && (
        <motion.div
          initial={{ opacity: 0, y: 20, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 20, scale: 0.95 }}
          className={`fixed z-50 shadow-2xl border border-primary/15 overflow-hidden flex flex-col ${
            isMinimized ? 'bottom-6 right-6 w-80 h-auto' : 'bottom-6 right-6 w-[500px] h-[700px]'
          }`}
          style={{
            background: '#121826',
            borderRadius: '16px',
          }}
        >
          {/* Header */}
          <div className="p-4 border-b border-primary/10 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full flex items-center justify-center bg-primary/10 border border-primary/15">
                <Sparkles className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h3 className="font-semibold text-foreground">AI Assistant</h3>
                <p className="text-xs text-muted-foreground">Always here to help</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setIsMinimized(!isMinimized)}
                className="p-1.5 hover:bg-primary/10 rounded transition-colors text-muted-foreground hover:text-foreground"
                title={isMinimized ? "Maximize" : "Minimize"}
              >
                {isMinimized ? (
                  <Maximize2 className="w-4 h-4" />
                ) : (
                  <Minimize2 className="w-4 h-4" />
                )}
              </button>
              <button
                onClick={() => setIsOpen(false)}
                className="p-1.5 hover:bg-primary/10 rounded transition-colors text-muted-foreground hover:text-foreground"
                title="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {!isMinimized && (
            <>
              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
                {messages.map((message) => (
                  <MessageBubble key={message.id} message={message} onQuickQuestion={handleQuickQuestion} />
                ))}
                
                {/* Typing Indicator */}
                {isTyping && (
                  <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="w-full">
                    <div className="w-full bg-white/5 border border-white/10 rounded-xl p-4">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Loader2 className="w-4 h-4 animate-spin text-primary" />
                        <span>Analyzing verified financial ledger and calculations...</span>
                      </div>
                    </div>
                  </motion.div>
                )}

                <div ref={messagesEndRef} />
              </div>

              {/* Input */}
              <div className="p-4 border-t border-primary/10 bg-[#121826] shrink-0">
                <div className="flex items-start gap-3 justify-center">
                  <textarea
                    ref={inputRef}
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        void handleSend();
                      }
                    }}
                    placeholder="Ask me anything... (press Enter to send)"
                    disabled={isTyping}
                    className="w-[65%] min-w-[280px] max-w-[720px] min-h-[96px] max-h-[140px] resize-none px-4 py-3 bg-[#121826] border border-[rgba(58,125,255,0.15)] rounded-xl text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[rgba(58,125,255,0.15)] focus-visible:ring-[3px] transition-shadow disabled:opacity-60 text-sm"
                  />
                  <Button
                    onClick={() => void handleSend()}
                    disabled={!inputValue.trim() || isTyping}
                    variant="energy"
                    size="icon"
                    className="mt-7 shrink-0"
                    aria-label="Send message"
                  >
                    <Send className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </motion.div>
      )}
    </>
  );
}

function MessageBubble({ 
  message, 
  onQuickQuestion 
}: { 
  message: Message;
  onQuickQuestion: (question: string) => void;
}) {
  const containerBase =
    "w-full rounded-xl border bg-white/5 border-white/10 px-5 py-4";
  const containerUser = "border-primary/15 bg-primary/5";

  // Simple formatter to render markdown bold, bullet points, and headers nicely
  const renderFormattedContent = (content: string) => {
    const lines = content.split('\n');
    return lines.map((line, idx) => {
      let formattedLine = line;
      const isHeader3 = formattedLine.startsWith('### ');
      const isHeader2 = formattedLine.startsWith('## ');
      const isBullet = formattedLine.startsWith('* ') || formattedLine.startsWith('- ');

      if (isHeader3) {
        return (
          <h4 key={idx} className="font-semibold text-primary text-sm mt-2 mb-1">
            {formattedLine.slice(4)}
          </h4>
        );
      }
      if (isHeader2) {
        return (
          <h3 key={idx} className="font-bold text-foreground text-base mt-2 mb-1">
            {formattedLine.slice(3)}
          </h3>
        );
      }

      // Format bold text **text**
      const parts = formattedLine.split(/(\*\*[^*]+\*\*)/g);
      return (
        <p key={idx} className={`text-sm leading-relaxed ${isBullet ? 'pl-2 text-foreground/90 my-0.5' : 'my-1'}`}>
          {parts.map((part, pIdx) => {
            if (part.startsWith('**') && part.endsWith('**')) {
              return <strong key={pIdx} className="font-semibold text-foreground">{part.slice(2, -2)}</strong>;
            }
            return part;
          })}
        </p>
      );
    });
  };

  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="w-full">
      <div className={`${containerBase} ${message.type === 'user' ? containerUser : ''}`}>
        <div className="text-foreground text-sm leading-relaxed whitespace-pre-wrap">
          {renderFormattedContent(message.content)}
        </div>

        {/* Guidance suggestions */}
        {message.suggestions && message.suggestions.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2 border-t border-primary/10 pt-3">
            {message.suggestions.map((suggestion, idx) => (
              <button
                key={idx}
                onClick={() => onQuickQuestion(suggestion)}
                className="px-3 py-1.5 rounded-full bg-transparent border border-primary/10 text-xs text-muted-foreground hover:bg-primary/10 hover:text-foreground transition-colors text-left"
              >
                {suggestion}
              </button>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}
