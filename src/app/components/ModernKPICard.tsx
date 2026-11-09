import { motion } from 'motion/react';
import { LucideIcon } from 'lucide-react';
import { formatCurrency } from '@/lib/formatters';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { useTheme } from '../../contexts/ThemeContext';

interface ModernKPICardProps {
  icon: LucideIcon;
  label: string;
  value: number;
  currency?: string;
  percentage: string;
  trend: 'up' | 'down';
  delay?: number;
  subtitle?: string;
}

export function ModernKPICard({
  icon: Icon,
  label,
  value,
  currency = 'PKR',
  percentage,
  trend,
  delay = 0,
  subtitle,
}: ModernKPICardProps) {
  const { theme } = useTheme();

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.5 }}
      whileHover={{ y: -4 }}
      className="group relative"
    >
      <div 
        className="relative overflow-hidden rounded-2xl p-6 transition-all duration-300"
        style={{
          background: theme === 'dark'
            ? 'linear-gradient(135deg, rgba(15, 30, 60, 0.5) 0%, rgba(5, 10, 30, 0.7) 100%)'
            : 'linear-gradient(135deg, rgba(255, 255, 255, 0.9) 0%, rgba(248, 250, 252, 0.95) 100%)',
          border: theme === 'dark'
            ? '1px solid rgba(59, 130, 246, 0.3)'
            : '1px solid rgba(59, 130, 246, 0.2)',
          boxShadow: theme === 'dark'
            ? '0 4px 24px -4px rgba(59, 130, 246, 0.3)'
            : '0 4px 20px -4px rgba(59, 130, 246, 0.2)',
        }}
      >
        {/* Hover gradient overlay */}
        <div 
          className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
          style={{
            background: theme === 'dark'
              ? 'radial-gradient(circle at 50% 50%, rgba(59, 130, 246, 0.2), transparent 70%)'
              : 'radial-gradient(circle at 50% 50%, rgba(59, 130, 246, 0.1), transparent 70%)',
          }}
        />
        
        {/* Top accent line */}
        <div 
          className="absolute top-0 left-0 right-0 h-[2px]"
          style={{
            background: 'linear-gradient(90deg, transparent, #3b82f6, transparent)',
          }}
        />
        
        <div className="relative z-10">
          {/* Icon and Trend */}
          <div className="flex items-start justify-between mb-4">
            <div 
              className="p-3 rounded-xl"
              style={{
                background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
                boxShadow: '0 8px 16px -4px rgba(59, 130, 246, 0.4)',
              }}
            >
              <Icon className="w-5 h-5 text-white" />
            </div>
            
            <div 
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold"
              style={{
                background: trend === 'up' 
                  ? 'rgba(16, 185, 129, 0.15)'
                  : 'rgba(239, 68, 68, 0.15)',
                color: trend === 'up' ? '#10b981' : '#ef4444',
                border: `1px solid ${trend === 'up' ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
              }}
            >
              {trend === 'up' ? (
                <TrendingUp className="w-3.5 h-3.5" />
              ) : (
                <TrendingDown className="w-3.5 h-3.5" />
              )}
              {percentage}
            </div>
          </div>

          {/* Label */}
          <p 
            className="text-sm font-medium mb-3 uppercase tracking-wider"
            style={{
              color: theme === 'dark' ? '#94a3b8' : '#64748b',
            }}
          >
            {label}
          </p>

          {/* Value */}
          <p 
            className="text-3xl font-bold"
            style={{
              color: theme === 'dark' ? '#ffffff' : '#1e293b',
            }}
          >
            {formatCurrency(value, currency, { compact: true })}
          </p>

          {/* Currency badge and optional subtitle */}
          <div className="mt-3 flex items-center justify-between gap-2">
            <span 
              className="text-xs font-medium px-2 py-1 rounded shrink-0"
              style={{
                background: theme === 'dark' 
                  ? 'rgba(59, 130, 246, 0.15)'
                  : 'rgba(59, 130, 246, 0.1)',
                color: '#3b82f6',
              }}
            >
              {currency}
            </span>
            {subtitle && (
              <span className={`text-[11px] font-mono truncate ${theme === 'dark' ? 'text-slate-400' : 'text-slate-500'}`} title={subtitle}>
                {subtitle}
              </span>
            )}
          </div>
        </div>

        {/* Bottom glow on hover */}
        <div 
          className="absolute bottom-0 left-0 right-0 h-[2px] opacity-0 group-hover:opacity-100 transition-opacity duration-300"
          style={{
            background: 'linear-gradient(90deg, transparent, #3b82f6, transparent)',
          }}
        />
      </div>
    </motion.div>
  );
}