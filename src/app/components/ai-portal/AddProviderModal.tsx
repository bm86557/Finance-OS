import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  X,
  Server,
  Zap,
  KeyRound,
  Eye,
  EyeOff,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Sparkles,
  Sliders,
  DollarSign,
  ShieldCheck,
  Activity,
} from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import {
  platformAiService,
  type GatewayNodeStatus,
  type CreateGatewayProviderInput,
  type UpdateGatewayProviderInput,
} from '@/services/platformAiService';
import { toast } from 'sonner';

interface AddProviderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
  providerToEdit?: GatewayNodeStatus | null;
  existingCount?: number;
}

interface ProviderPreset {
  id: string;
  name: string;
  providerType: 'gemini' | 'openai' | 'anthropic' | 'custom';
  defaultModel: string;
  baseUrl?: string;
  rpm: number;
  tpm: number;
  costIn: number;
  costOut: number;
}

const PRESETS: Record<string, ProviderPreset> = {
  gemini: {
    id: 'gemini',
    name: 'Google Gemini',
    providerType: 'gemini',
    defaultModel: 'gemini-flash-lite-latest',
    baseUrl: 'https://generativelanguage.googleapis.com',
    rpm: 15,
    tpm: 1000000,
    costIn: 0.075,
    costOut: 0.300,
  },
  openai: {
    id: 'openai',
    name: 'OpenAI',
    providerType: 'openai',
    defaultModel: 'gpt-4o-mini',
    baseUrl: 'https://api.openai.com/v1',
    rpm: 500,
    tpm: 2000000,
    costIn: 0.150,
    costOut: 0.600,
  },
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic Claude',
    providerType: 'anthropic',
    defaultModel: 'claude-3-5-haiku-20241022',
    baseUrl: 'https://api.anthropic.com',
    rpm: 100,
    tpm: 500000,
    costIn: 0.800,
    costOut: 4.000,
  },
  deepseek: {
    id: 'deepseek',
    name: 'DeepSeek (Official)',
    providerType: 'custom',
    defaultModel: 'deepseek-chat',
    baseUrl: 'https://api.deepseek.com/v1',
    rpm: 120,
    tpm: 1500000,
    costIn: 0.140,
    costOut: 0.280,
  },
  groq: {
    id: 'groq',
    name: 'Groq Cloud (Fast LLaMA)',
    providerType: 'custom',
    defaultModel: 'llama-3.3-70b-versatile',
    baseUrl: 'https://api.groq.com/openai/v1',
    rpm: 30,
    tpm: 1000000,
    costIn: 0.590,
    costOut: 0.790,
  },
  mistral: {
    id: 'mistral',
    name: 'Mistral AI',
    providerType: 'custom',
    defaultModel: 'mistral-small-latest',
    baseUrl: 'https://api.mistral.ai/v1',
    rpm: 60,
    tpm: 1000000,
    costIn: 0.200,
    costOut: 0.600,
  },
  custom: {
    id: 'custom',
    name: 'Custom OpenAI-Compatible API',
    providerType: 'custom',
    defaultModel: 'custom-model',
    baseUrl: '',
    rpm: 60,
    tpm: 1000000,
    costIn: 0.150,
    costOut: 0.600,
  },
};

export function AddProviderModal({
  isOpen,
  onClose,
  onSaved,
  providerToEdit,
  existingCount = 3,
}: AddProviderModalProps) {
  const [selectedPreset, setSelectedPreset] = useState<string>('gemini');
  const [providerType, setProviderType] = useState<'gemini' | 'openai' | 'anthropic' | 'custom'>('gemini');
  const [name, setName] = useState('');
  const [modelName, setModelName] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [baseUrl, setBaseUrl] = useState('');
  const [priority, setPriority] = useState<number>(existingCount + 1);
  const [rateLimitRpm, setRateLimitRpm] = useState<number>(60);
  const [rateLimitTpm, setRateLimitTpm] = useState<number>(1000000);
  const [costPer1MInput, setCostPer1MInput] = useState<number>(0.15);
  const [costPer1MOutput, setCostPer1MOutput] = useState<number>(0.60);
  const [timeoutMs, setTimeoutMs] = useState<number>(10000);
  const [maxTokensPerReq, setMaxTokensPerReq] = useState<number>(4096);

  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; latencyMs?: number; error?: string } | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setTestResult(null);
      return;
    }

    if (providerToEdit) {
      // Edit mode
      const provType = (['gemini', 'openai', 'anthropic'].includes(providerToEdit.provider)
        ? providerToEdit.provider
        : 'custom') as any;
      setProviderType(provType);
      setSelectedPreset(providerToEdit.provider in PRESETS ? providerToEdit.provider : 'custom');
      setName(providerToEdit.name || '');
      setModelName(providerToEdit.modelName || '');
      setApiKey(''); // Blank indicates keep existing encrypted key
      setBaseUrl(providerToEdit.baseUrl || '');
      setPriority(providerToEdit.priority || 1);
      setRateLimitRpm(providerToEdit.rateLimitRpm || 60);
      setRateLimitTpm(providerToEdit.rateLimitTpm || 1000000);
      setCostPer1MInput(providerToEdit.costPer1MInput ?? 0.15);
      setCostPer1MOutput(providerToEdit.costPer1MOutput ?? 0.60);
      setTimeoutMs(providerToEdit.timeoutMs || 10000);
      setMaxTokensPerReq(providerToEdit.maxTokensPerReq || 4096);
    } else {
      // Add mode - default to DeepSeek or custom preset
      const preset = PRESETS.deepseek;
      setSelectedPreset('deepseek');
      setProviderType(preset.providerType);
      setName('DeepSeek V3');
      setModelName(preset.defaultModel);
      setApiKey('');
      setBaseUrl(preset.baseUrl || '');
      setPriority(existingCount + 1);
      setRateLimitRpm(preset.rpm);
      setRateLimitTpm(preset.tpm);
      setCostPer1MInput(preset.costIn);
      setCostPer1MOutput(preset.costOut);
      setTimeoutMs(10000);
      setMaxTokensPerReq(4096);
    }
    setTestResult(null);
  }, [isOpen, providerToEdit, existingCount]);

  const handlePresetChange = (presetKey: string) => {
    setSelectedPreset(presetKey);
    const p = PRESETS[presetKey];
    if (p) {
      setProviderType(p.providerType);
      if (!providerToEdit) {
        setName(p.name);
        setModelName(p.defaultModel);
        setBaseUrl(p.baseUrl || '');
        setRateLimitRpm(p.rpm);
        setRateLimitTpm(p.tpm);
        setCostPer1MInput(p.costIn);
        setCostPer1MOutput(p.costOut);
      }
    }
  };

  const handleTestNode = async () => {
    if (providerToEdit?.id && !apiKey) {
      // Test existing node via ID
      setTesting(true);
      setTestResult(null);
      try {
        const res = await platformAiService.testGatewayNode(providerToEdit.id);
        if (res.success && res.data) {
          setTestResult({
            success: res.data.success,
            latencyMs: res.data.latencyMs,
            error: res.data.error,
          });
          if (res.data.success) {
            toast.success(`Gateway Node Connected! Latency: ${res.data.latencyMs}ms`);
          } else {
            toast.error(res.data.error || 'Connection test failed');
          }
        } else {
          setTestResult({ success: false, error: res.error || 'Test failed' });
          toast.error(res.error || 'Test failed');
        }
      } catch (err: any) {
        setTestResult({ success: false, error: err.message });
        toast.error(err.message || 'Connection test failed');
      } finally {
        setTesting(false);
      }
      return;
    }

    if (!apiKey && providerType !== 'gemini') {
      toast.error('Please enter an API Key to test connection');
      return;
    }

    // Direct multi-protocol test against provider with user's entered credentials
    setTesting(true);
    setTestResult(null);
    try {
      const res = await platformAiService.testConnection({
        provider: providerType,
        modelName,
        apiKey: apiKey.trim(),
        baseUrl: baseUrl ? baseUrl.trim() : undefined,
      });
      if (res.success && res.data) {
        setTestResult({
          success: res.data.success,
          latencyMs: res.data.latencyMs,
          error: res.data.error,
        });
        if (res.data.success) {
          toast.success(`Node Active! Latency: ${res.data.latencyMs}ms`);
        } else {
          toast.error(res.data.error || 'Connection test failed');
        }
      } else {
        setTestResult({
          success: false,
          error: res.error || 'Connection test failed',
        });
        toast.error(res.error || 'Connection test failed');
      }
    } catch (err: any) {
      setTestResult({ success: false, error: err.message });
      toast.error(err.message || 'Connection test failed');
    } finally {
      setTesting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !modelName.trim()) {
      toast.error('Display Name and Model Identifier are required');
      return;
    }

    setSaving(true);
    try {
      if (providerToEdit?.id) {
        // Update
        const payload: UpdateGatewayProviderInput = {
          name: name.trim(),
          modelName: modelName.trim(),
          baseUrl: baseUrl.trim() || undefined,
          priority: Number(priority),
          rateLimitRpm: Number(rateLimitRpm),
          rateLimitTpm: Number(rateLimitTpm),
          costPer1MInput: Number(costPer1MInput),
          costPer1MOutput: Number(costPer1MOutput),
          timeoutMs: Number(timeoutMs),
          maxTokensPerReq: Number(maxTokensPerReq),
        };
        if (apiKey.trim()) {
          payload.apiKey = apiKey.trim();
        }

        const res = await platformAiService.updateGatewayProvider(providerToEdit.id, payload);
        if (res.success) {
          toast.success(`Updated ${name} in Gateway Cascade`);
          onSaved();
          onClose();
        } else {
          toast.error(res.error || 'Failed to update provider');
        }
      } else {
        // Create
        const payload: CreateGatewayProviderInput = {
          provider: providerType,
          name: name.trim(),
          modelName: modelName.trim(),
          apiKey: apiKey.trim() || undefined,
          baseUrl: baseUrl.trim() || undefined,
          priority: Number(priority),
          rateLimitRpm: Number(rateLimitRpm),
          rateLimitTpm: Number(rateLimitTpm),
          costPer1MInput: Number(costPer1MInput),
          costPer1MOutput: Number(costPer1MOutput),
          timeoutMs: Number(timeoutMs),
          maxTokensPerReq: Number(maxTokensPerReq),
        };

        const res = await platformAiService.addGatewayProvider(payload);
        if (res.success) {
          toast.success(`Added ${name} to Gateway Failover Cascade`);
          onSaved();
          onClose();
        } else {
          toast.error(res.error || 'Failed to add provider');
        }
      }
    } catch (err: any) {
      toast.error(err.message || 'Operation failed');
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 15 }}
          className="relative w-full max-w-2xl bg-slate-900 border border-pink-500/30 rounded-2xl shadow-2xl shadow-pink-950/40 overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-pink-500/20 bg-slate-950/60">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-pink-500/10 border border-pink-500/30 text-pink-400">
                <Server className="size-5" />
              </div>
              <div>
                <h2 className="text-lg font-bold font-mono text-white flex items-center gap-2">
                  {providerToEdit ? 'Configure Gateway Provider Node' : 'Add Global LLM Provider & Failover Node'}
                  <span className="text-[10px] px-2 py-0.5 rounded font-mono bg-pink-500/20 text-pink-300 border border-pink-500/30">
                    SaaS Scope
                  </span>
                </h2>
                <p className="text-xs text-slate-400 font-mono mt-0.5">
                  Configure global LLM endpoint, failover priority cascade, rate limits, and AES-256 encrypted keys.
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
            >
              <X className="size-5" />
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="p-6 space-y-5 max-h-[75vh] overflow-y-auto">
            {/* Quick Provider Presets */}
            <div>
              <label className="block text-xs font-mono font-medium text-slate-300 mb-2">
                Quick Provider Template
              </label>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {Object.entries(PRESETS).map(([key, p]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => handlePresetChange(key)}
                    className={`p-2.5 rounded-xl text-left font-mono text-xs border transition-all ${
                      selectedPreset === key
                        ? 'bg-pink-950/60 border-pink-500 text-pink-200 shadow-md shadow-pink-500/20'
                        : 'bg-slate-950/40 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                    }`}
                  >
                    <div className="font-semibold truncate">{p.name.split(' ')[0]}</div>
                    <div className="text-[10px] text-slate-500 truncate">{p.defaultModel}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Basic Config */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-mono text-slate-300 mb-1.5">
                  Display Name *
                </label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Google Gemini Flash, DeepSeek V3"
                  className="bg-slate-950/80 border-slate-800 text-white font-mono text-xs"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-mono text-slate-300 mb-1.5">
                  Model Identifier *
                </label>
                <Input
                  value={modelName}
                  onChange={(e) => setModelName(e.target.value)}
                  placeholder="e.g. gemini-flash-latest, deepseek-chat"
                  className="bg-slate-950/80 border-slate-800 text-white font-mono text-xs"
                  required
                />
              </div>
            </div>

            {/* API Key with AES-256 Info */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-mono text-slate-300 flex items-center gap-1.5">
                  <KeyRound className="size-3.5 text-pink-400" />
                  API Key (Stored Encrypted with AES-256-GCM in Supabase DB Vault)
                </label>
                {providerToEdit?.hasApiKey && (
                  <span className="text-[10px] text-emerald-400 font-mono flex items-center gap-1">
                    <ShieldCheck className="size-3" /> Configured ({providerToEdit.keyLast4 || '••••'})
                  </span>
                )}
              </div>
              <div className="relative">
                <Input
                  type={showApiKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={
                    providerToEdit?.hasApiKey
                      ? '•••••••••••••••• (Leave blank to keep current encrypted key)'
                      : 'Enter API key (e.g. sk-..., AIzaSy...)'
                  }
                  className="bg-slate-950/80 border-slate-800 text-white font-mono text-xs pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey(!showApiKey)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                >
                  {showApiKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
              <p className="text-[10px] text-slate-500 font-mono mt-1">
                Keys entered here are encrypted at rest with AES-256-GCM and stored in Supabase DB table <span className="text-pink-300 font-mono">platform_ai_gateway_providers</span>. Plaintext is never exposed in source code, client bundles, or API responses (§5, §20).
              </p>
            </div>

            {/* Custom Endpoint / Base URL */}
            <div>
              <label className="block text-xs font-mono text-slate-300 mb-1.5">
                Base URL / Endpoint (Optional for official providers, required for custom proxies)
              </label>
              <Input
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://api.deepseek.com/v1 or https://api.groq.com/openai/v1"
                className="bg-slate-950/80 border-slate-800 text-white font-mono text-xs"
              />
            </div>

            {/* Priority & Failover Cascade */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-mono text-slate-300 mb-1.5">
                  Failover Priority (1 = Primary)
                </label>
                <Input
                  type="number"
                  min={1}
                  max={20}
                  value={priority}
                  onChange={(e) => setPriority(Number(e.target.value))}
                  className="bg-slate-950/80 border-slate-800 text-white font-mono text-xs"
                  required
                />
                <span className="text-[10px] text-slate-500 font-mono">
                  {priority === 1 ? 'Primary Active Model' : `Failover Standby Step ${priority}`}
                </span>
              </div>

              <div>
                <label className="block text-xs font-mono text-slate-300 mb-1.5">
                  Rate Limit (RPM)
                </label>
                <Input
                  type="number"
                  min={1}
                  value={rateLimitRpm}
                  onChange={(e) => setRateLimitRpm(Number(e.target.value))}
                  className="bg-slate-950/80 border-slate-800 text-white font-mono text-xs"
                />
              </div>

              <div>
                <label className="block text-xs font-mono text-slate-300 mb-1.5">
                  Rate Limit (TPM)
                </label>
                <Input
                  type="number"
                  min={1000}
                  value={rateLimitTpm}
                  onChange={(e) => setRateLimitTpm(Number(e.target.value))}
                  className="bg-slate-950/80 border-slate-800 text-white font-mono text-xs"
                />
              </div>
            </div>

            {/* Token Pricing & Timeout */}
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 p-3 bg-slate-950/40 rounded-xl border border-slate-800/80">
              <div>
                <label className="block text-[11px] font-mono text-slate-400 mb-1">
                  Input / 1M Tokens ($)
                </label>
                <Input
                  type="number"
                  step="0.001"
                  value={costPer1MInput}
                  onChange={(e) => setCostPer1MInput(Number(e.target.value))}
                  className="bg-slate-900 border-slate-800 text-white font-mono text-xs"
                />
              </div>

              <div>
                <label className="block text-[11px] font-mono text-slate-400 mb-1">
                  Output / 1M Tokens ($)
                </label>
                <Input
                  type="number"
                  step="0.001"
                  value={costPer1MOutput}
                  onChange={(e) => setCostPer1MOutput(Number(e.target.value))}
                  className="bg-slate-900 border-slate-800 text-white font-mono text-xs"
                />
              </div>

              <div>
                <label className="block text-[11px] font-mono text-slate-400 mb-1">
                  Timeout (ms)
                </label>
                <Input
                  type="number"
                  step="500"
                  value={timeoutMs}
                  onChange={(e) => setTimeoutMs(Number(e.target.value))}
                  className="bg-slate-900 border-slate-800 text-white font-mono text-xs"
                />
              </div>

              <div>
                <label className="block text-[11px] font-mono text-slate-400 mb-1">
                  Max Tokens / Req
                </label>
                <Input
                  type="number"
                  step="512"
                  value={maxTokensPerReq}
                  onChange={(e) => setMaxTokensPerReq(Number(e.target.value))}
                  className="bg-slate-900 border-slate-800 text-white font-mono text-xs"
                />
              </div>
            </div>

            {/* Live Test Feedback Banner */}
            {testResult && (
              <div
                className={`p-3 rounded-xl border font-mono text-xs flex items-center justify-between ${
                  testResult.success
                    ? 'bg-emerald-950/30 border-emerald-500/30 text-emerald-300'
                    : 'bg-red-950/30 border-red-500/30 text-red-300'
                }`}
              >
                <div className="flex items-center gap-2">
                  {testResult.success ? (
                    <CheckCircle2 className="size-4 text-emerald-400" />
                  ) : (
                    <AlertCircle className="size-4 text-red-400" />
                  )}
                  <span>
                    {testResult.success
                      ? `Connection Verified! Latency: ${testResult.latencyMs}ms`
                      : `Connection Test Failed: ${testResult.error || 'Check endpoint or API key'}`}
                  </span>
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center justify-between pt-4 border-t border-pink-500/20">
              <Button
                type="button"
                onClick={handleTestNode}
                disabled={testing || saving}
                variant="outline"
                className="border-slate-700 bg-slate-800/80 hover:bg-slate-800 text-slate-200 font-mono text-xs"
              >
                {testing ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin mr-1.5" />
                    Testing Node...
                  </>
                ) : (
                  <>
                    <Activity className="size-3.5 mr-1.5 text-cyan-400" />
                    Test Connection
                  </>
                )}
              </Button>

              <div className="flex items-center gap-3">
                <Button
                  type="button"
                  onClick={onClose}
                  variant="ghost"
                  className="text-slate-400 hover:text-white font-mono text-xs"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={saving || testing}
                  className="bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 text-white font-mono text-xs font-semibold px-5"
                >
                  {saving ? (
                    <>
                      <Loader2 className="size-3.5 animate-spin mr-1.5" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Zap className="size-3.5 mr-1.5" />
                      {providerToEdit ? 'Update Provider Node' : 'Save & Add to Cascade'}
                    </>
                  )}
                </Button>
              </div>
            </div>
          </form>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}

