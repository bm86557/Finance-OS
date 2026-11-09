import { motion } from 'motion/react';
import { LucideIcon } from 'lucide-react';
import { formatCurrency } from '@/lib/formatters';
import { ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { useTheme } from '../../contexts/ThemeContext';
import { cn } from './ui/utils';

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
}

export function ModernSidebarWidget({
  title,
  icon: Icon,
  items,
  currency = 'USD',
  delay = 0,
  emptyLabel = 'No entries yet.',
}: ModernSidebarWidgetProps) {
  const { theme } = useTheme();
  
  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay, duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
      whileHover={{ y: -4 }}
      className="relative overflow-hidden rounded-3xl p-6"
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
          className="p-2.5 rounded-xl flex items-center justify-center"
          style={{
            background: 'linear-gradient(135deg, #3b82f6, #2563eb)',
            boxShadow: '0 8px 20px -8px rgba(59, 130, 246, 0.6)',
          }}
        >
          <Icon className="w-4 h-4 text-white" />
        </div>
        <h3 
          className="text-base font-bold"
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
            style={{ color: theme === 'dark' ? '#64748b' : '#64748b' }}
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
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <div 
                    className="w-2 h-2 rounded-full"
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

              <div className="flex items-center gap-2">
                {item.type === 'income' ? (
                  <ArrowUpRight className="w-4 h-4 text-emerald-500" />
                ) : (
                  <ArrowDownRight className="w-4 h-4" style={{ color: '#3b82f6' }} />
                )}
                <p 
                  className="text-sm font-bold"
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
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
          className="w-full mt-4 py-2.5 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2"
          style={{
            background: theme === 'dark'
              ? 'rgba(59, 130, 246, 0.15)'
              : 'rgba(59, 130, 246, 0.1)',
            color: '#60a5fa',
            border: theme === 'dark'
              ? '1px solid rgba(59, 130, 246, 0.3)'
              : '1px solid rgba(59, 130, 246, 0.2)',
          }}
        >
          View all {items.length} items →
        </motion.button>
      )}
    </motion.div>
  );
}