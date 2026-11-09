import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Eye,
  EyeOff,
  Check,
  X,
  Search,
  Calendar,
  DollarSign,
  Percent,
  Hash,
  AlertCircle,
  Info,
  ChevronDown
} from 'lucide-react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
  icon?: any;
  success?: boolean;
  loading?: boolean;
}

// Premium Text Input
export function PremiumInput({
  label,
  error,
  hint,
  icon: Icon,
  success,
  loading,
  className = '',
  ...props
}: InputProps) {
  const [isFocused, setIsFocused] = useState(false);

  return (
    <div className="space-y-2">
      {label && (
        <label className="block text-sm font-medium text-slate-300">
          {label}
          {props.required && <span className="text-red-400 ml-1">*</span>}
        </label>
      )}

      <div className="relative">
        {Icon && (
          <Icon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
        )}
        <input
          {...props}
          onFocus={(e) => {
            setIsFocused(true);
            props.onFocus?.(e);
          }}
          onBlur={(e) => {
            setIsFocused(false);
            props.onBlur?.(e);
          }}
          className={`w-full ${Icon ? 'pl-11' : 'pl-4'} ${
            success || error ? 'pr-11' : 'pr-4'
          } py-3 bg-slate-800 border ${
            error
              ? 'border-red-500/50 focus:border-red-500'
              : success
              ? 'border-green-500/50 focus:border-green-500'
              : 'border-white/10 focus:border-blue-500'
          } rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 ${
            error
              ? 'focus:ring-red-500/20'
              : success
              ? 'focus:ring-green-500/20'
              : 'focus:ring-blue-500/20'
          } transition-all ${className}`}
        />

        {/* Status Icons */}
        {(success || error || loading) && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            {loading && (
              <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
            )}
            {success && !loading && (
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                className="w-6 h-6 rounded-full bg-green-500 flex items-center justify-center"
              >
                <Check className="w-4 h-4 text-white" />
              </motion.div>
            )}
            {error && !loading && (
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                className="w-6 h-6 rounded-full bg-red-500 flex items-center justify-center"
              >
                <X className="w-4 h-4 text-white" />
              </motion.div>
            )}
          </div>
        )}

        {/* Focus Border Animation */}
        <AnimatePresence>
          {isFocused && !error && (
            <motion.div
              initial={{ scaleX: 0 }}
              animate={{ scaleX: 1 }}
              exit={{ scaleX: 0 }}
              className="absolute bottom-0 left-0 right-0 h-0.5 bg-gradient-to-r from-blue-500 to-purple-500"
            />
          )}
        </AnimatePresence>
      </div>

      {/* Error Message */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="flex items-center gap-2 text-red-400 text-sm"
          >
            <AlertCircle className="w-4 h-4" />
            {error}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Hint */}
      {hint && !error && (
        <div className="flex items-center gap-2 text-slate-400 text-xs">
          <Info className="w-3 h-3" />
          {hint}
        </div>
      )}
    </div>
  );
}

// Password Input with Strength Indicator
export function PasswordInput({
  label = 'Password',
  showStrength = true,
  ...props
}: InputProps & { showStrength?: boolean }) {
  const [isVisible, setIsVisible] = useState(false);
  const [password, setPassword] = useState('');

  const calculateStrength = (pwd: string): number => {
    let strength = 0;
    if (pwd.length >= 8) strength++;
    if (pwd.length >= 12) strength++;
    if (/[a-z]/.test(pwd) && /[A-Z]/.test(pwd)) strength++;
    if (/\d/.test(pwd)) strength++;
    if (/[^a-zA-Z0-9]/.test(pwd)) strength++;
    return strength;
  };

  const strength = calculateStrength(password);
  const strengthLabels = ['Weak', 'Fair', 'Good', 'Strong', 'Very Strong'];
  const strengthColors = ['#ef4444', '#f59e0b', '#eab308', '#10b981', '#059669'];

  return (
    <div className="space-y-2">
      {label && (
        <label className="block text-sm font-medium text-slate-300">
          {label}
          {props.required && <span className="text-red-400 ml-1">*</span>}
        </label>
      )}

      <div className="relative">
        <input
          {...props}
          type={isVisible ? 'text' : 'password'}
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            props.onChange?.(e);
          }}
          className="w-full pl-4 pr-11 py-3 bg-slate-800 border border-white/10 focus:border-blue-500 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
        />
        <button
          type="button"
          onClick={() => setIsVisible(!isVisible)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white transition-colors"
        >
          {isVisible ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
        </button>
      </div>

      {/* Strength Indicator */}
      {showStrength && password && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-2"
        >
          <div className="flex gap-1">
            {[...Array(5)].map((_, i) => (
              <motion.div
                key={i}
                initial={{ scaleX: 0 }}
                animate={{ scaleX: i < strength ? 1 : 0 }}
                className="flex-1 h-1.5 bg-slate-700 rounded-full overflow-hidden"
              >
                <div
                  className="h-full transition-all"
                  style={{
                    backgroundColor: i < strength ? strengthColors[strength - 1] : 'transparent'
                  }}
                />
              </motion.div>
            ))}
          </div>
          <p className="text-xs" style={{ color: strengthColors[strength - 1] }}>
            Password strength: {strengthLabels[strength - 1]}
          </p>
        </motion.div>
      )}
    </div>
  );
}

// Currency Input
export function CurrencyInput({
  label,
  currency = 'USD',
  ...props
}: InputProps & { currency?: string }) {
  return (
    <div className="space-y-2">
      {label && (
        <label className="block text-sm font-medium text-slate-300">
          {label}
          {props.required && <span className="text-red-400 ml-1">*</span>}
        </label>
      )}

      <div className="relative">
        <div className="absolute left-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
          <DollarSign className="w-5 h-5 text-slate-400" />
          <span className="text-slate-400 text-sm">{currency}</span>
        </div>
        <input
          {...props}
          type="number"
          step="0.01"
          className="w-full pl-24 pr-4 py-3 bg-slate-800 border border-white/10 focus:border-blue-500 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
        />
      </div>
    </div>
  );
}

// Select/Dropdown
export function PremiumSelect({
  label,
  options,
  value,
  onChange,
  placeholder = 'Select an option...',
  ...props
}: {
  label?: string;
  options: { value: string; label: string }[];
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  required?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const selectedOption = options.find((opt) => opt.value === value);

  return (
    <div className="space-y-2">
      {label && (
        <label className="block text-sm font-medium text-slate-300">
          {label}
          {props.required && <span className="text-red-400 ml-1">*</span>}
        </label>
      )}

      <div className="relative">
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="w-full px-4 py-3 bg-slate-800 border border-white/10 focus:border-blue-500 rounded-lg text-white text-left flex items-center justify-between focus:outline-none focus:ring-2 focus:ring-blue-500/20 transition-all"
        >
          <span className={selectedOption ? 'text-white' : 'text-slate-400'}>
            {selectedOption?.label || placeholder}
          </span>
          <ChevronDown
            className={`w-5 h-5 text-slate-400 transition-transform ${
              isOpen ? 'rotate-180' : ''
            }`}
          />
        </button>

        <AnimatePresence>
          {isOpen && (
            <>
              <div
                className="fixed inset-0 z-10"
                onClick={() => setIsOpen(false)}
              />
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="absolute top-full mt-2 w-full bg-slate-900 border border-white/10 rounded-lg shadow-2xl z-20 overflow-hidden max-h-60 overflow-y-auto"
              >
                {options.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => {
                      onChange?.(option.value);
                      setIsOpen(false);
                    }}
                    className={`w-full px-4 py-2 text-left hover:bg-white/5 transition-colors ${
                      value === option.value
                        ? 'bg-blue-500/10 text-blue-400'
                        : 'text-white'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// Toggle Switch
export function ToggleSwitch({
  label,
  description,
  checked,
  onChange
}: {
  label?: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      {(label || description) && (
        <div className="flex-1">
          {label && <p className="text-sm font-medium text-white">{label}</p>}
          {description && <p className="text-xs text-slate-400 mt-1">{description}</p>}
        </div>
      )}

      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
          checked ? 'bg-blue-500' : 'bg-slate-700'
        }`}
      >
        <motion.span
          layout
          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-lg transition-transform ${
            checked ? 'translate-x-6' : 'translate-x-1'
          }`}
        />
      </button>
    </div>
  );
}

// Slider
export function PremiumSlider({
  label,
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  showValue = true,
  unit = ''
}: {
  label?: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  showValue?: boolean;
  unit?: string;
}) {
  const percentage = ((value - min) / (max - min)) * 100;

  return (
    <div className="space-y-2">
      {label && (
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-slate-300">{label}</label>
          {showValue && (
            <span className="text-sm font-medium text-white">
              {value}{unit}
            </span>
          )}
        </div>
      )}

      <div className="relative pt-2 pb-1">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer slider"
          style={{
            background: `linear-gradient(to right, #3b82f6 0%, #3b82f6 ${percentage}%, #334155 ${percentage}%, #334155 100%)`
          }}
        />
      </div>
    </div>
  );
}
