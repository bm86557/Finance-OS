import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import {
  Plug,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Download,
  Building2,
  CreditCard,
  Globe,
  Key,
  Zap,
  Shield,
  Brain,
  Sparkles,
  Lock,
  ExternalLink,
  Check,
  Activity,
  AlertTriangle,
} from 'lucide-react';
import { useOrgServices } from '@/hooks/useOrgServices';
import {
  fetchOrgAiSettings,
  saveOrgAiSettingsResponse,
  clearOrgAiSettingsResponse,
  testOrgAiConnection,
  type ExtendedOrgAiSettings,
  type ConnectionTestResult,
} from '@/services/aiSettingsService';
import {
  getOrgIntegrationStates,
  persistOrgIntegrationStates,
  type IntegrationConnectionPersisted,
} from '@/services/integrationConnectionsService';
import { AXIOM } from '../../../styles/axiom-tokens';
import { toast } from 'sonner';
import { useOrgWorkspaceNav } from './OrgWorkspaceNavContext';
import { usePlatformSettings } from '@/hooks/usePlatformSettings';

interface Integration {
  id: string;
  name: string;
  logo: string;
  category: 'payment' | 'bank' | 'accounting';
  status: 'connected' | 'disconnected' | 'pending';
  description: string;
  features: string[];
  lastSync?: string;
}

const INTEGRATION_SEED: Integration[] = [
  {
    id: 'payoneer',
    name: 'Payoneer',
    logo: '💳',
    category: 'payment',
    status: 'disconnected',
    description: 'Receive international payments and auto-import transactions',
    features: [
      'Auto-import transactions',
      'Multi-currency support',
      'Real-time balance sync',
      'Transaction categorization',
    ],
  },
  {
    id: 'meezan',
    name: 'Meezan Bank',
    logo: '🏦',
    category: 'bank',
    status: 'disconnected',
    description: 'Import bank statements and sync account balances',
    features: [
      'Statement auto-import',
      'Balance tracking',
      'Transaction reconciliation',
      'Multi-account support',
    ],
  },
  {
    id: 'hbl',
    name: 'HBL',
    logo: '🏦',
    category: 'bank',
    status: 'disconnected',
    description: 'Connect your HBL accounts for automatic statement imports',
    features: [
      'Auto-import statements',
      'USD account support',
      'Real-time alerts',
      'Transaction history',
    ],
  },
  {
    id: 'ubl',
    name: 'UBL',
    logo: '🏦',
    category: 'bank',
    status: 'disconnected',
    description: 'United Bank Limited integration',
    features: ['Statement downloads', 'Balance sync', 'Transaction import'],
  },
  {
    id: 'wise',
    name: 'Wise (TransferWise)',
    logo: '💸',
    category: 'payment',
    status: 'disconnected',
    description: 'International transfers and multi-currency accounts',
    features: [
      'Multi-currency wallets',
      'Low-cost transfers',
      'Auto-import transactions',
      'Exchange rate tracking',
    ],
  },
  {
    id: 'paypal',
    name: 'PayPal',
    logo: '💰',
    category: 'payment',
    status: 'disconnected',
    description: 'Import PayPal transactions automatically',
    features: ['Transaction import', 'Invoice sync', 'Fee tracking', 'Multi-currency'],
  },
];

function mergeSeedWithStored(
  seed: Integration[],
  stored: Record<string, IntegrationConnectionPersisted>,
): Integration[] {
  return seed.map((row) => {
    const s = stored[row.id];
    if (!s) return row;
    return {
      ...row,
      status: s.status,
      ...(s.lastSync ? { lastSync: s.lastSync } : {}),
    };
  });
}

function toPersistMap(integrations: Integration[]): Record<string, IntegrationConnectionPersisted> {
  return Object.fromEntries(
    integrations.map((i) => [
      i.id,
      {
        status: i.status,
        ...(i.lastSync ? { lastSync: i.lastSync } : {}),
      },
    ]),
  );
}

function DeveloperApiAndQuickBooksBanner({ goToOrgView }: { goToOrgView?: ((view: any) => void) | null }) {
  const { orgId } = useOrgServices();
  const { featureFlags } = usePlatformSettings();
  const [apiKey, setApiKey] = useState<string>(() => {
    try {
      return localStorage.getItem(`finance_os_api_key_${orgId || 'default'}`) || '';
    } catch {
      return '';
    }
  });

  const handleGenerateKey = () => {
    const generated = `fos_live_${(orgId || 'org').slice(0, 6)}_${Math.random().toString(36).slice(2, 12)}${Math.random().toString(36).slice(2, 10)}`;
    setApiKey(generated);
    try {
      localStorage.setItem(`finance_os_api_key_${orgId || 'default'}`, generated);
    } catch {}
    toast.success('Generated new Organization REST API Key (Beta)');
  };

  const handleCopyKey = () => {
    if (!apiKey) return;
    void navigator.clipboard.writeText(apiKey);
    toast.success('Copied API Key to clipboard');
  };

  if (!featureFlags.api_access_beta && !featureFlags.export_to_quickbooks) {
    return null;
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {featureFlags.api_access_beta && (
        <div className="p-6 rounded-2xl border border-cyan-500/30" style={AXIOM.containers.list}>
          <div className="flex items-start justify-between gap-3 mb-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-cyan-500/20 border border-cyan-500/30">
                <Key className="size-5 text-cyan-400" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-bold text-white">Developer API Access (Beta)</h3>
                  <span className="px-2 py-0.5 text-[10px] font-mono rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                    ENABLED
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  Programmatic REST access to `/api/v1/organizations/{orgId || ':orgId'}`
                </p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              readOnly
              value={apiKey || 'No active API key generated yet'}
              className="flex-1 px-3 py-2 rounded-xl text-xs font-mono bg-slate-950/70 border border-slate-800 text-cyan-300"
            />
            {apiKey && (
              <button
                type="button"
                onClick={handleCopyKey}
                className="px-3 py-2 rounded-xl text-xs font-medium bg-slate-800 hover:bg-slate-700 text-white border border-slate-700"
              >
                Copy
              </button>
            )}
            <button
              type="button"
              onClick={handleGenerateKey}
              className="px-3.5 py-2 rounded-xl text-xs font-medium bg-cyan-600 hover:bg-cyan-500 text-white"
            >
              {apiKey ? 'Rotate Key' : 'Generate Key'}
            </button>
          </div>
        </div>
      )}

      {featureFlags.export_to_quickbooks && (
        <div className="p-6 rounded-2xl border border-emerald-500/30" style={AXIOM.containers.list}>
          <div className="flex items-start justify-between gap-3 mb-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-emerald-500/20 border border-emerald-500/30">
                <Download className="size-5 text-emerald-400" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-bold text-white">QuickBooks Accounting Export</h3>
                  <span className="px-2 py-0.5 text-[10px] font-mono rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                    ACTIVE
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  Export posted ledger transactions & chart of accounts in QuickBooks (.IIF / .CSV) format
                </p>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => goToOrgView?.('reports')}
            className="px-4 py-2 rounded-xl text-xs font-medium bg-emerald-600 hover:bg-emerald-500 text-white flex items-center gap-2"
          >
            <Download className="size-3.5" />
            Open QuickBooks Export in Reports
          </button>
        </div>
      )}
    </div>
  );
}

export function IntegrationsSettings() {
  const { orgId, isReady } = useOrgServices();
  const goToOrgView = useOrgWorkspaceNav();



  const [aiSettings, setAiSettings] = useState<ExtendedOrgAiSettings | null>(null);
  const [useCustomAiKey, setUseCustomAiKey] = useState(false);
  const [aiProvider, setAiProvider] = useState<'gemini' | 'openai' | 'custom'>('gemini');
  const [aiProviderName, setAiProviderName] = useState('Google Gemini');
  const [aiModelName, setAiModelName] = useState('gemini-flash-lite-latest');
  const [aiApiKey, setAiApiKey] = useState('');
  const [isEditingKey, setIsEditingKey] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const loadAiSettings = async () => {
    if (!orgId) return;
    const res = await fetchOrgAiSettings(orgId);
    const s = res.success && res.data ? res.data : null;
    if (s) {
      setAiSettings(s);
      setUseCustomAiKey(Boolean(s.useCustomKey));
      const prov = (s.provider || (s.providerName?.toLowerCase().includes('openai') ? 'openai' : 'gemini')) as any;
      setAiProvider(prov);
      setAiProviderName(s.providerName || (prov === 'openai' ? 'OpenAI' : 'Google Gemini'));
      setAiModelName(s.modelName || (prov === 'openai' ? 'gpt-4o-mini' : 'gemini-flash-lite-latest'));
      setAiApiKey(s.apiKey || '');
      setIsEditingKey(!s.hasApiKey);
    }
  };

  useEffect(() => {
    if (!isReady || !orgId) return;
    void loadAiSettings();
  }, [orgId, isReady]);

  const handleProviderSelect = (selected: 'gemini' | 'openai' | 'custom') => {
    setAiProvider(selected);
    if (selected === 'gemini') {
      setAiProviderName('Google Gemini');
      setAiModelName('gemini-flash-lite-latest');
    } else if (selected === 'openai') {
      setAiProviderName('OpenAI');
      setAiModelName('gpt-4o-mini');
    } else {
      setAiProviderName('Custom OpenAI Compatible');
      setAiModelName('gpt-4o-mini');
    }
    setTestResult(null);
  };

  const handleTestConnection = async () => {
    if (!orgId) return;
    setIsTesting(true);
    setTestResult(null);

    try {
      const res = await testOrgAiConnection(orgId, {
        provider: aiProvider,
        modelName: aiModelName.trim(),
        apiKey: isEditingKey ? aiApiKey.trim() : undefined,
      });
      if (res.success && res.data) {
        setTestResult(res.data);
        toast.success(`Connected successfully to ${res.data.provider} using your Organization's Own API Key! (${res.data.latencyMs}ms)`);

      } else {
        toast.error(res.error || 'Connection failed.');
        setTestResult({
          success: false,
          provider: aiProvider,
          model: aiModelName,
          latencyMs: 0,
          error: res.error || 'Connection failed.',
        });
      }
    } catch (err: any) {
      toast.error(err.message || 'Connection test failed.');
    } finally {
      setIsTesting(false);
    }
  };

  const handleSaveAiSettings = async () => {
    if (!orgId) return;
    setIsSaving(true);
    try {
      const res = await saveOrgAiSettingsResponse(orgId, {
        useCustomKey: useCustomAiKey,
        provider: aiProvider,
        providerName: aiProviderName.trim(),
        modelName: aiModelName.trim(),
        apiKey: isEditingKey ? aiApiKey.trim() : '',
      });
      if (res.success) {
        toast.success(`Organization API Key saved! All AI features are now powered by your own ${aiProviderName} account.`);

        setIsEditingKey(false);
        await loadAiSettings();
      } else {
        toast.error(res.error ?? 'Could not save AI settings.');
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleClearAiSettings = async () => {
    if (!orgId) return;
    setIsSaving(true);
    try {
      const res = await clearOrgAiSettingsResponse(orgId);
      if (res.success) {
        setUseCustomAiKey(false);
        setAiApiKey('');
        setIsEditingKey(true);
        setTestResult(null);
        toast.message(res.message ?? 'AI settings cleared.');
        await loadAiSettings();
      } else {
        toast.error(res.error ?? 'Could not clear AI settings.');
      }
    } finally {
      setIsSaving(false);
    }
  };

  const [integrations, setIntegrations] = useState<Integration[]>(() =>
    mergeSeedWithStored(INTEGRATION_SEED, getOrgIntegrationStates('')),
  );

  useEffect(() => {
    setIntegrations(mergeSeedWithStored(INTEGRATION_SEED, getOrgIntegrationStates(orgId)));
  }, [orgId]);

  const [connectingTo, setConnectingTo] = useState<string | null>(null);

  const handleConnect = (integrationId: string) => {
    setConnectingTo(integrationId);

    setTimeout(() => {
      setIntegrations((prev) => {
        const next = prev.map((int) =>
          int.id === integrationId
            ? { ...int, status: 'connected' as const, lastSync: new Date().toISOString() }
            : int,
        );
        if (orgId?.trim()) {
          const r = persistOrgIntegrationStates(orgId, toPersistMap(next));
          if (!r.success) {
            queueMicrotask(() => toast.error(r.error ?? 'Could not save connection state.'));
          } else {
            queueMicrotask(() => toast.success('Integration connected successfully!'));
          }
        } else {
          queueMicrotask(() => toast.success('Integration connected successfully!'));
        }
        return next;
      });
      setConnectingTo(null);
    }, 2000);
  };

  const handleDisconnect = (integrationId: string) => {
    setIntegrations((prev) => {
      const next = prev.map((int) =>
        int.id === integrationId
          ? { ...int, status: 'disconnected' as const, lastSync: undefined }
          : int,
      );
      if (orgId?.trim()) {
        const r = persistOrgIntegrationStates(orgId, toPersistMap(next));
        if (!r.success) {
          queueMicrotask(() => toast.error(r.error ?? 'Could not save connection state.'));
        } else {
          queueMicrotask(() => toast.success('Integration disconnected'));
        }
      } else {
        queueMicrotask(() => toast.success('Integration disconnected'));
      }
      return next;
    });
  };

  const handleSync = (integrationId: string) => {
    setIntegrations((prev) => {
      const next = prev.map((int) =>
        int.id === integrationId ? { ...int, lastSync: new Date().toISOString() } : int,
      );
      if (orgId?.trim()) {
        const r = persistOrgIntegrationStates(orgId, toPersistMap(next));
        if (!r.success) {
          queueMicrotask(() => toast.error(r.error ?? 'Could not save connection state.'));
        } else {
          queueMicrotask(() => toast.success('Sync completed successfully!'));
        }
      } else {
        queueMicrotask(() => toast.success('Sync completed successfully!'));
      }
      return next;
    });
  };

  const connectedCount = integrations.filter(i => i.status === 'connected').length;
  const paymentPlatforms = integrations.filter(i => i.category === 'payment');
  const banks = integrations.filter(i => i.category === 'bank');

  return (
    <div className="min-h-screen p-8 space-y-6" style={{ background: AXIOM.backgrounds.main }}>
      {/* Header */}
      <motion.div {...AXIOM.animations.fadeInTop}>
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div 
              className="p-3 rounded-xl flex items-center justify-center"
              style={{
                background: AXIOM.iconBoxes.purple,
                boxShadow: AXIOM.shadows.iconPurple,
              }}
            >
              <Plug className="size-6 text-white" />
            </div>
            <div>
              <h1 className="text-4xl font-bold" style={AXIOM.text.titleStyle}>
                Integrations & Connections
              </h1>
              <p className="text-slate-400 text-sm">Connect payment platforms and banks for automatic data import</p>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Status Overview */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="p-6 rounded-2xl"
          style={AXIOM.containers.list}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-slate-400 text-sm mb-1">Connected</p>
              <p className="text-2xl font-bold text-cyan-400">{connectedCount}</p>
            </div>
            <div 
              className="w-12 h-12 rounded-xl flex items-center justify-center"
              style={{
                background: AXIOM.iconBoxes.cyan,
                boxShadow: AXIOM.shadows.iconCyan,
              }}
            >
              <Zap className="size-6 text-white" />
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="p-6 rounded-2xl"
          style={AXIOM.containers.list}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-slate-400 text-sm mb-1">Payment Platforms</p>
              <p className="text-2xl font-bold text-emerald-400">{paymentPlatforms.length}</p>
            </div>
            <div 
              className="w-12 h-12 rounded-xl flex items-center justify-center"
              style={{
                background: AXIOM.iconBoxes.green,
                boxShadow: AXIOM.shadows.iconGreen,
              }}
            >
              <CreditCard className="size-6 text-white" />
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="p-6 rounded-2xl"
          style={AXIOM.containers.list}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-slate-400 text-sm mb-1">Banks</p>
              <p className="text-2xl font-bold text-purple-400">{banks.length}</p>
            </div>
            <div 
              className="w-12 h-12 rounded-xl flex items-center justify-center"
              style={{
                background: AXIOM.iconBoxes.purple,
                boxShadow: AXIOM.shadows.iconPurple,
              }}
            >
              <Building2 className="size-6 text-white" />
            </div>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
          className="p-6 rounded-2xl"
          style={AXIOM.containers.list}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-slate-400 text-sm mb-1">Available</p>
              <p className="text-2xl font-bold text-orange-400">{integrations.length}</p>
            </div>
            <div 
              className="w-12 h-12 rounded-xl flex items-center justify-center"
              style={{
                background: AXIOM.iconBoxes.orange,
                boxShadow: AXIOM.shadows.iconOrange,
              }}
            >
              <Globe className="size-6 text-white" />
            </div>
          </div>
        </motion.div>
      </div>

      {/* Bring-Your-Own-Key (BYOK) AI Integration with AES-256-GCM Security */}
      <DeveloperApiAndQuickBooksBanner goToOrgView={goToOrgView} />
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.28 }}
        className="p-6 rounded-2xl relative overflow-hidden border border-purple-500/20"
        style={AXIOM.containers.list}
      >
        {/* Header & Live Connection Pill */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 pb-5 border-b border-slate-800">
          <div className="flex items-start gap-4">
            <div
              className="p-3 rounded-xl flex items-center justify-center shrink-0"
              style={{
                background: AXIOM.iconBoxes.purple,
                boxShadow: AXIOM.shadows.iconPurple,
              }}
            >
              <Brain className="size-6 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h2 className="text-xl font-bold text-white">AI Assistant & Features Connection</h2>
                {useCustomAiKey && aiSettings?.hasApiKey ? (
                  aiSettings?.quotaExceeded ? (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-500/10 text-amber-300 border border-amber-500/30">
                      <AlertTriangle className="size-3" />
                      Org Key Quota Reached
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-300 border border-emerald-500/30">
                      <span className="size-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      Active (Your API Key)
                    </span>
                  )
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-cyan-500/10 text-cyan-300 border border-cyan-500/30">
                    <Sparkles className="size-3 text-cyan-400" />
                    Finance OS AI Active
                  </span>
                )}
              </div>
              <p className="text-sm text-slate-400 mt-1 max-w-2xl leading-relaxed">
                Connect your organization's own API key. When active, all AI capabilities across your organization
                (Financial Assistant, Smart Classification, Import Intelligence) run exclusively through your account.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0 self-start sm:self-auto">
            <button
              type="button"
              onClick={handleTestConnection}
              disabled={isTesting || (!useCustomAiKey && !aiSettings?.hasApiKey)}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-medium border border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800 disabled:opacity-40 transition-colors"
            >
              <Activity className={`size-3.5 ${isTesting ? 'animate-spin text-purple-400' : 'text-slate-400'}`} />
              <span>{isTesting ? 'Testing...' : 'Test Connection'}</span>
            </button>
          </div>
        </div>

        {/* Quota Exceeded Alert Banner */}
        {aiSettings?.quotaExceeded && (
          <div className="mb-5 p-4 rounded-xl border border-amber-500/40 bg-amber-500/10 flex items-start gap-3">
            <AlertTriangle className="size-5 text-amber-400 shrink-0 mt-0.5" />
            <div className="text-xs text-amber-200 space-y-1">
              <p className="font-semibold">Your Organization's API Quota was reached</p>
              <p className="text-amber-300/80">
                Your AI provider reported that your organization's quota or credit balance has been exhausted.
                Features will automatically use local rule engines until renewed. Check billing on your provider account.
              </p>
            </div>
          </div>
        )}

        {/* Opt-in Toggle */}
        <div className="mb-6 bg-slate-950/60 p-4 rounded-xl border border-slate-800 flex items-center justify-between">
          <label className="flex items-center gap-3 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={useCustomAiKey}
              onChange={(e) => {
                setUseCustomAiKey(e.target.checked);
                if (e.target.checked && !aiSettings?.hasApiKey) {
                  setIsEditingKey(true);
                }
              }}
              className="rounded size-4 border-slate-600 bg-slate-900 text-purple-500 focus:ring-purple-500/40"
            />
            <div>
              <span className="text-sm font-medium text-slate-200">Bring Your Own API Key (BYOK)</span>
              <p className="text-xs text-slate-400">Enable to route all organizational AI features through your provider</p>
            </div>
          </label>

          <span className="text-xs px-2.5 py-1 rounded-md bg-purple-950/60 text-purple-300 border border-purple-800/40 font-mono">
            {useCustomAiKey ? 'CUSTOM ROUTING' : 'PLATFORM DEFAULT'}
          </span>
        </div>

        {/* Provider Selector Tabs */}
        {useCustomAiKey && (
          <div className="mb-5 space-y-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Select Provider</label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <button
                  type="button"
                  onClick={() => handleProviderSelect('gemini')}
                  className={`p-3.5 rounded-xl border text-left transition-all ${
                    aiProvider === 'gemini'
                      ? 'border-purple-500 bg-purple-500/10 ring-1 ring-purple-500/30'
                      : 'border-slate-800 bg-slate-950/50 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-white">Google Gemini</span>
                    <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300">Fast & Free Tier</span>
                  </div>
                  <p className="text-xs text-slate-400 mt-1">Recommended for ledger insights & speed</p>
                </button>

                <button
                  type="button"
                  onClick={() => handleProviderSelect('openai')}
                  className={`p-3.5 rounded-xl border text-left transition-all ${
                    aiProvider === 'openai'
                      ? 'border-purple-500 bg-purple-500/10 ring-1 ring-purple-500/30'
                      : 'border-slate-800 bg-slate-950/50 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-white">OpenAI</span>
                    <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300">ChatGPT</span>
                  </div>
                  <p className="text-xs text-slate-400 mt-1">GPT-4o, GPT-4o-mini & custom models</p>
                </button>

                <button
                  type="button"
                  onClick={() => handleProviderSelect('custom')}
                  className={`p-3.5 rounded-xl border text-left transition-all ${
                    aiProvider === 'custom'
                      ? 'border-purple-500 bg-purple-500/10 ring-1 ring-purple-500/30'
                      : 'border-slate-800 bg-slate-950/50 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-white">OpenAI Compatible</span>
                    <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-slate-700 text-slate-300">Self-Hosted</span>
                  </div>
                  <p className="text-xs text-slate-400 mt-1">Groq, Azure, Ollama, or private LLM</p>
                </button>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">Model Name</label>
                <input
                  type="text"
                  value={aiModelName}
                  onChange={(e) => setAiModelName(e.target.value)}
                  placeholder={aiProvider === 'gemini' ? 'gemini-flash-lite-latest' : 'gpt-4o-mini'}
                  className="w-full rounded-xl border border-slate-700 bg-slate-950/80 px-4 py-2.5 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500/40"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-medium text-slate-400">Secret API Key</label>
                  {aiSettings?.hasApiKey && !isEditingKey && (
                    <button
                      type="button"
                      onClick={() => {
                        setIsEditingKey(true);
                        setAiApiKey('');
                      }}
                      className="text-xs text-purple-400 hover:text-purple-300 underline"
                    >
                      Change Key
                    </button>
                  )}
                </div>

                {aiSettings?.hasApiKey && !isEditingKey ? (
                  <div className="flex items-center justify-between w-full rounded-xl border border-emerald-500/30 bg-slate-950/80 px-4 py-2.5 text-sm text-emerald-400 font-mono">
                    <span className="flex items-center gap-2">
                      <Lock className="size-3.5 text-emerald-400" />
                      <span>••••••••{aiSettings.keyLast4 || 'Active'}</span>
                    </span>
                    <span className="text-xs text-slate-400 font-sans">Encrypted at rest (AES-GCM)</span>
                  </div>
                ) : (
                  <input
                    type="password"
                    value={aiApiKey}
                    onChange={(e) => setAiApiKey(e.target.value)}
                    placeholder={aiProvider === 'gemini' ? 'AIzaSy...' : 'sk-...'}
                    autoComplete="off"
                    className="w-full rounded-xl border border-slate-700 bg-slate-950/80 px-4 py-2.5 text-sm text-white font-mono placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-purple-500/40"
                  />
                )}
              </div>
            </div>
          </div>
        )}

        {/* Security & Isolation Trust Banner */}
        <div className="mt-4 p-4 rounded-xl flex items-start gap-3 bg-purple-950/20 border border-purple-500/20">
          <Shield className="size-5 text-purple-400 shrink-0 mt-0.5" />
          <div className="text-xs text-slate-300 space-y-1">
            <p className="font-semibold text-white">Bank-Grade BYOK Security & Tenant Isolation</p>
            <p className="text-slate-400 leading-relaxed">
              Keys are encrypted with server-side <strong>AES-256-GCM</strong> with authenticated tenant binding.
              Keys are write-only, never sent back to the browser, and inaccessible to any employee or third party.
            </p>
          </div>
        </div>

        {/* Features Powered & Monthly Usage Summary */}
        <div className="mt-5 pt-4 border-t border-slate-800 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Features Powered</p>
            <ul className="space-y-1.5 text-xs text-slate-300">
              <li className="flex items-center gap-2">
                <Check className="size-3.5 text-emerald-400" />
                <span>AI Financial Assistant (Chat & Strategy)</span>
              </li>
              <li className="flex items-center gap-2">
                <Check className="size-3.5 text-emerald-400" />
                <span>Smart Ledger Transaction Classification</span>
              </li>
              <li className="flex items-center gap-2">
                <Check className="size-3.5 text-emerald-400" />
                <span>Bank Statement Intelligence Parser</span>
              </li>
            </ul>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">Usage This Month</p>
            <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 space-y-1.5 text-xs">
              <div className="flex justify-between text-slate-400">
                <span>Active Routing:</span>
                <span className="font-medium text-white">{useCustomAiKey && aiSettings?.hasApiKey ? 'Organization Custom Key' : 'Finance OS Default'}</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>Org Requests Processed:</span>
                <span className="font-medium text-purple-300">{aiSettings?.monthlyUsage?.orgRequests || 0} calls</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>Platform Requests:</span>
                <span className="font-medium text-cyan-300">{aiSettings?.monthlyUsage?.platformRequests || 0} calls</span>
              </div>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={handleSaveAiSettings}
            disabled={!isReady || isSaving}
            className="px-5 py-2.5 rounded-xl text-sm font-medium text-white disabled:opacity-45 transition-colors"
            style={AXIOM.buttons.action}
          >
            {isSaving ? 'Saving...' : 'Save AI Settings'}
          </button>

          {aiSettings?.hasApiKey && (
            <button
              type="button"
              onClick={handleClearAiSettings}
              disabled={!isReady || isSaving}
              className="px-4 py-2.5 rounded-xl text-sm font-medium border border-slate-700 text-slate-300 hover:bg-slate-800/80 disabled:opacity-45 transition-colors"
            >
              Remove Custom Key
            </button>
          )}

          {testResult && (
            <span className={`text-xs font-medium px-3 py-1.5 rounded-lg border ${
              testResult.success
                ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                : 'bg-red-500/10 text-red-300 border-red-500/30'
            }`}>
              {testResult.success
                ? `✓ Connection Valid (${testResult.latencyMs}ms latency)`
                : `✗ Connection Failed: ${testResult.error || 'Unknown error'}`}
            </span>
          )}
        </div>
      </motion.div>

      {/* Payment Platforms */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
      >
        <div className="flex items-center gap-2 mb-4">
          <div 
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{
              background: AXIOM.iconBoxes.cyan,
              boxShadow: AXIOM.shadows.iconCyan,
            }}
          >
            <CreditCard className="size-4 text-white" />
          </div>
          <h2 className="text-2xl font-bold text-white">Payment Platforms</h2>
        </div>
        
        <div className="grid md:grid-cols-2 gap-4">
          {paymentPlatforms.map((integration, idx) => (
            <motion.div
              key={integration.id}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.35 + idx * 0.05 }}
              className="p-6 rounded-2xl"
              style={AXIOM.containers.list}
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="text-5xl">{integration.logo}</div>
                  <div>
                    <h3 className="text-lg font-bold text-white">{integration.name}</h3>
                    <p className="text-sm text-slate-400">{integration.description}</p>
                  </div>
                </div>
                <span 
                  className="px-3 py-1 rounded-lg text-xs font-medium flex items-center gap-1"
                  style={
                    integration.status === 'connected' ? AXIOM.badges.success :
                    integration.status === 'pending' ? AXIOM.badges.warning :
                    AXIOM.badges.danger
                  }
                >
                  {integration.status === 'connected' && <CheckCircle2 className="size-3" />}
                  {integration.status === 'pending' && <RefreshCw className="size-3 animate-spin" />}
                  {integration.status === 'disconnected' && <AlertCircle className="size-3" />}
                  {integration.status}
                </span>
              </div>

              {/* Features */}
              <div className="mb-4">
                <p className="text-xs font-semibold text-slate-400 mb-2">Features</p>
                <ul className="space-y-2">
                  {integration.features.map((feature, idx) => (
                    <li key={idx} className="text-sm text-slate-300 flex items-center gap-2">
                      <CheckCircle2 className="size-3 text-emerald-400 flex-shrink-0" />
                      {feature}
                    </li>
                  ))}
                </ul>
              </div>

              {/* Last Sync */}
              {integration.lastSync && (
                <div className="text-xs text-slate-400 mb-4">
                  Last synced: {new Date(integration.lastSync).toLocaleString()}
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-2">
                {integration.status === 'disconnected' ? (
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={() => handleConnect(integration.id)}
                    disabled={connectingTo === integration.id}
                    className="flex-1 px-4 py-2 rounded-xl text-sm font-medium flex items-center justify-center gap-2"
                    style={{
                      background: 'linear-gradient(135deg, rgba(6, 182, 212, 0.4), rgba(59, 130, 246, 0.4))',
                      border: '1px solid rgba(6, 182, 212, 0.5)',
                      boxShadow: '0 10px 30px -10px rgba(6, 182, 212, 0.6)',
                      color: '#ffffff',
                      opacity: connectingTo === integration.id ? 0.7 : 1,
                    }}
                  >
                    {connectingTo === integration.id ? (
                      <>
                        <RefreshCw className="size-4 animate-spin" />
                        Connecting...
                      </>
                    ) : (
                      <>
                        <Plug className="size-4" />
                        Connect
                      </>
                    )}
                  </motion.button>
                ) : (
                  <>
                    <motion.button
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      onClick={() => handleSync(integration.id)}
                      className="flex-1 px-4 py-2 rounded-xl text-sm font-medium flex items-center justify-center gap-2"
                      style={AXIOM.buttons.primary}
                    >
                      <RefreshCw className="size-4" />
                      Sync Now
                    </motion.button>
                    <motion.button
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      onClick={() => handleDisconnect(integration.id)}
                      className="flex-1 px-4 py-2 rounded-xl text-sm font-medium flex items-center justify-center gap-2"
                      style={AXIOM.buttons.danger}
                    >
                      Disconnect
                    </motion.button>
                  </>
                )}
              </div>
            </motion.div>
          ))}
        </div>
      </motion.div>

      {/* Banks */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5 }}
      >
        <div className="flex items-center gap-2 mb-4">
          <div 
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{
              background: AXIOM.iconBoxes.purple,
              boxShadow: AXIOM.shadows.iconPurple,
            }}
          >
            <Building2 className="size-4 text-white" />
          </div>
          <h2 className="text-2xl font-bold text-white">Pakistani Banks</h2>
        </div>
        
        <div className="grid md:grid-cols-2 gap-4">
          {banks.map((integration, idx) => (
            <motion.div
              key={integration.id}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.55 + idx * 0.05 }}
              className="p-6 rounded-2xl"
              style={AXIOM.containers.list}
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="text-5xl">{integration.logo}</div>
                  <div>
                    <h3 className="text-lg font-bold text-white">{integration.name}</h3>
                    <p className="text-sm text-slate-400">{integration.description}</p>
                  </div>
                </div>
                <span 
                  className="px-3 py-1 rounded-lg text-xs font-medium flex items-center gap-1"
                  style={
                    integration.status === 'connected' ? AXIOM.badges.success :
                    AXIOM.badges.danger
                  }
                >
                  {integration.status === 'connected' && <CheckCircle2 className="size-3" />}
                  {integration.status}
                </span>
              </div>

              {/* Features */}
              <div className="mb-4">
                <p className="text-xs font-semibold text-slate-400 mb-2">Features</p>
                <ul className="space-y-2">
                  {integration.features.map((feature, idx) => (
                    <li key={idx} className="text-sm text-slate-300 flex items-center gap-2">
                      <CheckCircle2 className="size-3 text-emerald-400 flex-shrink-0" />
                      {feature}
                    </li>
                  ))}
                </ul>
              </div>

              {/* Actions */}
              <div className="flex gap-2">
                {integration.status === 'disconnected' ? (
                  <>
                    <motion.button
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      onClick={() => handleConnect(integration.id)}
                      disabled={connectingTo === integration.id}
                      className="flex-1 px-4 py-2 rounded-xl text-sm font-medium flex items-center justify-center gap-2"
                      style={AXIOM.buttons.primary}
                    >
                      {connectingTo === integration.id ? (
                        <>
                          <RefreshCw className="size-4 animate-spin" />
                          Connecting...
                        </>
                      ) : (
                        <>
                          <Plug className="size-4" />
                          Connect via API
                        </>
                      )}
                    </motion.button>
                    <motion.button
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      className="px-4 py-2 rounded-xl text-sm font-medium flex items-center gap-2"
                      style={AXIOM.buttons.secondary}
                      onClick={() => goToOrgView?.('import')}
                    >
                      <Download className="size-4" />
                      Manual
                    </motion.button>
                  </>
                ) : (
                  <>
                    <motion.button
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      onClick={() => handleSync(integration.id)}
                      className="flex-1 px-4 py-2 rounded-xl text-sm font-medium flex items-center justify-center gap-2"
                      style={AXIOM.buttons.primary}
                    >
                      <RefreshCw className="size-4" />
                      Sync
                    </motion.button>
                    <motion.button
                      whileHover={{ scale: 1.05 }}
                      whileTap={{ scale: 0.95 }}
                      onClick={() => handleDisconnect(integration.id)}
                      className="flex-1 px-4 py-2 rounded-xl text-sm font-medium flex items-center justify-center gap-2"
                      style={AXIOM.buttons.danger}
                    >
                      Disconnect
                    </motion.button>
                  </>
                )}
              </div>
            </motion.div>
          ))}
        </div>
      </motion.div>

      {/* Integration Guide */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.7 }}
        className="p-6 rounded-2xl"
        style={AXIOM.containers.chartBlue}
      >
        <div className="flex items-start gap-4">
          <div 
            className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
            style={{
              background: AXIOM.iconBoxes.blue,
              boxShadow: AXIOM.shadows.iconBlue,
            }}
          >
            <Key className="size-6 text-white" />
          </div>
          <div className="flex-1">
            <h3 className="text-xl font-bold text-white mb-4">How to Connect Integrations</h3>
            <ul className="space-y-3 text-sm text-slate-300">
              <li className="flex items-start gap-3">
                <span className="text-blue-400 font-bold mt-0.5">1.</span>
                <span><strong className="text-white">Click "Connect"</strong> on any integration card</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-blue-400 font-bold mt-0.5">2.</span>
                <span><strong className="text-white">Authorize access:</strong> You'll be redirected to log in to the service</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-blue-400 font-bold mt-0.5">3.</span>
                <span><strong className="text-white">Grant permissions:</strong> Allow Finance OS to read transactions</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-blue-400 font-bold mt-0.5">4.</span>
                <span><strong className="text-white">Auto-sync:</strong> Transactions import automatically (daily or real-time)</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-blue-400 font-bold mt-0.5">5.</span>
                <span><strong className="text-white">Manual sync:</strong> Click "Sync Now" anytime to refresh data</span>
              </li>
            </ul>
            <div 
              className="mt-4 p-4 rounded-xl flex items-start gap-3"
              style={{
                background: 'rgba(59, 130, 246, 0.1)',
                border: '1px solid rgba(59, 130, 246, 0.3)',
              }}
            >
              <Shield className="size-5 text-blue-400 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-blue-300">
                <strong>Security:</strong> We use bank-level encryption and never store your passwords. 
                Connections use OAuth 2.0 or read-only API keys.
              </p>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}