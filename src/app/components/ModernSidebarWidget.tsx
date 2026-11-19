import { useState } from 'react';
import { motion } from 'motion/react';
import { LucideIcon, ArrowUpRight, ArrowDownRight, ArrowRight } from 'lucide-react';
import { formatCurrency } from '@/lib/formatters';
import { useTheme } from '../../contexts/ThemeContext';
import { cn } from './ui/utils';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';

interface Transaction {
  id: string;
  date: string;
  title: string;
  amount: number;
  type: 'income' | 'expense';
}

interface ModernSidebarWidgetProps {
  title: string;
  icon: LucideIcon;
  items: Transaction[];
  currency?: string;
  delay?: number;
  /** Shown when `items` is empty (ORG-P02: no blank list) */
  emptyLabel?: string;
  /** Optional custom handler when "View all" is clicked; if omitted, opens a responsive modal with all items */
  onViewAll?: () => void;
  /** Optional secondary navigation action inside the "View all" modal */
  viewAllPageLabel?: string;
  onViewAllPage?: () => void;
}

export function ModernSidebarWidget({
  title,
  icon: Icon,
  items,
  currency = 'USD',
  delay = 0,
  emptyLabel = 'No entries yet.',
  onViewAll,
  viewAllPageLabel,
  onViewAllPage,
}: ModernSidebarWidgetProps) {
  const { theme } = useTheme();
  const [dialogOpen, setDialogOpen] = useState(false);

  const handleViewAll = () => {
    if (onViewAll) {
      onViewAll();
      return;
    }
    setDialogOpen(true);
  };

  return (
    <>
      <motion.div
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay, duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
        whileHover={{ y: -4 }}
        className="relative overflow-hidden rounded-2xl sm:rounded-3xl p-4 sm:p-6"
        style={{
          background: theme === 'dark' 
            ? 'linear-gradient(135deg, rgba(15, 30, 60, 0.5) 0%, rgba(5, 10, 30, 0.7) 100%)'
            : 'linear-gradient(135deg, rgba(255, 255, 255, 0.9) 0%, rgba(248, 250, 252, 0.9) 100%)',
          border: theme === 'dark' 
            ? '1px solid rgba(59, 130, 246, 0.2)' 
            : '1px solid rgba(59, 130, 246, 0.15)',
          boxShadow: theme === 'dark' 
            ? '0 20px 60px -20px rgba(59, 130, 246, 0.4)'
            : '0 4px 12px -2px rgba(59, 130, 246, 0.1)',
        }}
      >
        {/* Header */}
        <div className="flex items-center gap-3 mb-4">
          <div
            className="p-2.5 rounded-xl flex items-center justify-center shrink-0"
            style={{
              background: 'linear-gradient(135deg, #3b82f6, #2563eb)',
              boxShadow: '0 8px 20px -8px rgba(59, 130, 246, 0.6)',
            }}
          >
            <Icon className="w-4 h-4 text-white" />
          </div>
          <h3 
            className="text-base font-bold truncate"
            style={{ color: theme === 'dark' ? '#ffffff' : '#1e293b' }}
          >
            {title}
          </h3>
        </div>

        {/* Items List */}
        <div className="space-y-2">
          {items.length === 0 && (
            <p
              className="text-sm font-mono py-2"
              style={{ color: '#64748b' }}
            >
              {emptyLabel}
            </p>
          )}
          {items.slice(0, 5).map((item, index) => (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: delay + 0.1 + index * 0.05 }}
              whileHover={{ scale: 1.02, x: 4 }}
              onClick={handleViewAll}
              className="group p-3 rounded-xl transition-all cursor-pointer"
              style={{
                background: theme === 'dark' 
                  ? 'rgba(15, 30, 60, 0.3)' 
                  : 'rgba(255, 255, 255, 0.5)',
                border: theme === 'dark'
                  ? '1px solid rgba(59, 130, 246, 0.15)'
                  : '1px solid rgba(148, 163, 184, 0.2)',
              }}
            >
              <div className="flex items-start justify-between gap-2 sm:gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <div 
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{
                        background: item.type === 'income' 
                          ? '#10b981' 
                          : '#3b82f6'
                      }}
                    />
                    <p 
                      className="text-sm font-semibold truncate"
                      style={{ color: theme === 'dark' ? '#ffffff' : '#1e293b' }}
                    >
                      {item.title}
                    </p>
                  </div>
                  <p 
                    className="text-xs"
                    style={{ color: theme === 'dark' ? '#94a3b8' : '#64748b' }}
                  >
                    {item.date}
                  </p>
                </div>

                <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                  {item.type === 'income' ? (
                    <ArrowUpRight className="w-4 h-4 text-emerald-500 shrink-0" />
                  ) : (
                    <ArrowDownRight className="w-4 h-4 shrink-0" style={{ color: '#3b82f6' }} />
                  )}
                  <p 
                    className="text-sm font-bold whitespace-nowrap"
                    style={{
                      color: item.type === 'income' 
                        ? '#10b981' 
                        : '#3b82f6'
                    }}
                  >
                    {item.type === 'income' ? '+' : ''}
                    {formatCurrency(item.amount, currency, { compact: true })}
                  </p>
                </div>
              </div>
            </motion.div>
          ))}
        </div>

        {items.length > 5 && (
          <motion.button 
            type="button"
            onClick={handleViewAll}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            aria-label={`View all ${items.length} ${title} items`}
            className="relative z-10 w-full min-h-[44px] mt-4 py-2.5 px-4 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2 cursor-pointer touch-manipulation"
            style={{
              background: theme === 'dark'
                ? 'rgba(59, 130, 246, 0.15)'
                : 'rgba(59, 130, 246, 0.1)',
              color: theme === 'dark' ? '#60a5fa' : '#2563eb',
              border: theme === 'dark'
                ? '1px solid rgba(59, 130, 246, 0.3)'
                : '1px solid rgba(59, 130, 246, 0.25)',
            }}
          >
            View all {items.length} items →
          </motion.button>
        )}
      </motion.div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent
          className={cn(
            'flex max-h-[min(90vh,100dvh)] w-[calc(100vw-1rem)] max-w-lg flex-col overflow-hidden p-0 sm:max-w-xl',
            theme === 'dark'
              ? 'border-slate-700 bg-slate-950 text-slate-100'
              : 'border-slate-200 bg-white text-slate-900',
          )}
        >
          <DialogHeader
            className={cn(
              'shrink-0 border-b p-4 sm:p-6 text-left',
              theme === 'dark' ? 'border-slate-800' : 'border-slate-200',
            )}
          >
            <div className="flex items-center gap-3 pr-6">
              <div
                className="p-2.5 rounded-xl flex items-center justify-center shrink-0"
                style={{
                  background: 'linear-gradient(135deg, #3b82f6, #2563eb)',
                  boxShadow: '0 8px 20px -8px rgba(59, 130, 246, 0.6)',
                }}
              >
                <Icon className="w-4 h-4 text-white" />
              </div>
              <div className="min-w-0 flex-1">
                <DialogTitle className="text-base sm:text-lg font-bold">
                  {title}
                </DialogTitle>
                <DialogDescription
                  className={cn(
                    'text-xs sm:text-sm',
                    theme === 'dark' ? 'text-slate-400' : 'text-slate-500',
                  )}
                >
                  Showing all {items.length} {items.length === 1 ? 'item' : 'items'}
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-2.5">
            {items.length === 0 ? (
              <p className="text-sm text-slate-500 py-4 text-center">{emptyLabel}</p>
            ) : (
              items.map((item) => (
                <div
                  key={item.id}
                  className={cn(
                    'p-3 sm:p-3.5 rounded-xl border transition-colors',
                    theme === 'dark'
                      ? 'bg-slate-900/60 border-blue-500/15 hover:border-blue-500/30'
                      : 'bg-slate-50 border-slate-200 hover:border-blue-300',
                  )}
                >
                  <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start gap-2">
                        <div
                          className="mt-1.5 w-2 h-2 rounded-full shrink-0"
                          style={{
                            background: item.type === 'income' ? '#10b981' : '#3b82f6',
                          }}
                        />
                        <p
                          className={cn(
                            'text-sm font-semibold break-words',
                            theme === 'dark' ? 'text-white' : 'text-slate-900',
                          )}
                        >
                          {item.title}
                        </p>
                      </div>
                      <p
                        className={cn(
                          'text-xs pl-4 mt-0.5',
                          theme === 'dark' ? 'text-slate-400' : 'text-slate-500',
                        )}
                      >
                        {item.date}
                      </p>
                    </div>

                    <div className="flex items-center gap-1.5 pl-4 sm:pl-0 shrink-0">
                      {item.type === 'income' ? (
                        <ArrowUpRight className="w-4 h-4 text-emerald-500 shrink-0" />
                      ) : (
                        <ArrowDownRight className="w-4 h-4 shrink-0" style={{ color: '#3b82f6' }} />
                      )}
                      <p
                        className="text-sm font-bold whitespace-nowrap"
                        style={{
                          color: item.type === 'income' ? '#10b981' : '#3b82f6',
                        }}
                      >
                        {item.type === 'income' ? '+' : ''}
                        {formatCurrency(item.amount, currency)}
                      </p>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          <div
            className={cn(
              'shrink-0 border-t p-4 sm:px-6 sm:py-4 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-2',
              theme === 'dark' ? 'border-slate-800 bg-slate-950' : 'border-slate-200 bg-slate-50/70',
            )}
          >
            <button
              type="button"
              onClick={() => setDialogOpen(false)}
              className={cn(
                'min-h-[40px] px-4 py-2 rounded-xl text-sm font-semibold transition-colors cursor-pointer touch-manipulation',
                theme === 'dark'
                  ? 'bg-slate-800 text-slate-200 hover:bg-slate-700'
                  : 'bg-slate-200 text-slate-700 hover:bg-slate-300',
              )}
            >
              Close
            </button>

            {onViewAllPage && viewAllPageLabel && (
              <button
                type="button"
                onClick={() => {
                  setDialogOpen(false);
                  onViewAllPage();
                }}
                className="min-h-[40px] px-4 py-2 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2 transition-all cursor-pointer touch-manipulation"
                style={{
                  background: 'linear-gradient(135deg, #3b82f6, #2563eb)',
                  boxShadow: '0 8px 20px -8px rgba(59, 130, 246, 0.6)',
                }}
              >
                {viewAllPageLabel}
                <ArrowRight className="w-4 h-4" />
              </button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}