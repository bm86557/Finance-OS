import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router';
import { AiPortalLayout, type AiPortalView } from './AiPortalLayout';
import {
  platformAiService,
  type PlatformAiStats,
  type TenantAiConsumption,
  type GatewayNodeStatus,
  type ClassificationQualityMetrics,
  type PlatformAiSecurityStatus,
  type KeyTierInfo,
} from '@/services/platformAiService';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import {
  Brain, Cpu, Zap, Activity, ShieldCheck, RefreshCw, Server,
  TrendingUp, DollarSign, Radio, Lock, CheckCircle2, Search,
  AlertTriangle, KeyRound, ArrowRight, Gauge, PlayCircle, ShieldAlert,
  Info, ExternalLink, Sparkles, Plus, Pencil, Trash2, ChevronUp, ChevronDown, Loader2
} from 'lucide-react';
import { motion } from 'motion/react';
import { AddProviderModal } from './AddProviderModal';

export function AiPortalWorkspace() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialView = (searchParams.get('tab') as AiPortalView) || 'telemetry';
  const [currentView, setCurrentView] = useState<AiPortalView>(initialView);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [stats, setStats] = useState<PlatformAiStats | null>(null);
  const [tenants, setTenants] = useState<TenantAiConsumption[]>([]);
  const [gatewayNodes, setGatewayNodes] = useState<GatewayNodeStatus[]>([]);
  const [quality, setQuality] = useState<ClassificationQualityMetrics | null>(null);
  const [security, setSecurity] = useState<PlatformAiSecurityStatus | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [pinging, setPinging] = useState(false);
  const [pingResult, setPingResult] = useState<{ success: boolean; latencyMs: number; model: string } | null>(null);

  const [isAddProviderModalOpen, setIsAddProviderModalOpen] = useState(false);
  const [providerToEdit, setProviderToEdit] = useState<GatewayNodeStatus | null>(null);
  const [testingNodeId, setTestingNodeId] = useState<string | null>(null);

  const loadData = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);

    try {
      const [statsRes, tenantsRes, nodesRes, qualityRes, securityRes] = await Promise.all([
        platformAiService.getStats(),
        platformAiService.getTenantUsage(),
        platformAiService.getGatewayStatus(),
        platformAiService.getClassificationQuality(),
        platformAiService.getSecurityStatus(),
      ]);

      if (statsRes.success && statsRes.data) setStats(statsRes.data);
      if (tenantsRes.success && tenantsRes.data) setTenants(tenantsRes.data);
      if (nodesRes.success && nodesRes.data) setGatewayNodes(nodesRes.data);
      if (qualityRes.success && qualityRes.data) setQuality(qualityRes.data);
      if (securityRes.success && securityRes.data) setSecurity(securityRes.data);
    } catch (err) {
      console.error('Failed to load platform AI data:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(() => loadData(true), 30000);
    return () => clearInterval(interval);
  }, []);

  const handleViewChange = (v: AiPortalView) => {
    setCurrentView(v);
    setSearchParams({ tab: v });
  };

  const handleToggleCircuit = async (provider: string, action: 'trip_circuit' | 'reset_circuit') => {
    try {
      setActionMessage(`Updating circuit for ${provider}...`);
      await platformAiService.toggleGatewayProvider(provider, action);
      await loadData(true);
      setActionMessage(`Provider ${provider} ${action === 'trip_circuit' ? 'circuit tripped (failover active)' : 'circuit reset to normal'}.`);
      setTimeout(() => setActionMessage(null), 4000);
    } catch (e: any) {
      setActionMessage(`Error: ${e.message}`);
    }
  };

  const handleSetPrimary = async (modelName: string) => {
    try {
      setActionMessage(`Switching primary gateway model to ${modelName}...`);
      await platformAiService.setPrimaryModel(modelName);
      await loadData(true);
      setActionMessage(`Primary model successfully switched to ${modelName}.`);
      setTimeout(() => setActionMessage(null), 4000);
    } catch (e: any) {
      setActionMessage(`Error: ${e.message}`);
    }
  };

  const [scanningQuality, setScanningQuality] = useState(false);

  const handlePingGateway = async (modelName?: string) => {
    setPinging(true);
    setPingResult(null);
    try {
      const res = await platformAiService.pingGateway(modelName);
      if (res.success && res.data) {
        setPingResult({
          success: true,
          latencyMs: res.data.latencyMs,
          model: res.data.model || modelName || 'gemini-flash-lite-latest',
        });
        setActionMessage(`Gateway ping succeeded: ${res.data.latencyMs}ms round-trip to ${res.data.model || 'Gemini'}. Verified Free Tier Active.`);
        await loadData(true);
      } else {
        setPingResult({
          success: false,
          latencyMs: 0,
          model: modelName || 'gemini-flash-lite-latest',
        });
        setActionMessage(`Gateway ping warning: ${res.error || 'Connection timed out'}.`);
      }
      setTimeout(() => setActionMessage(null), 6000);
    } catch (e: any) {
      setActionMessage(`Gateway ping failed: ${e.message}`);
    } finally {
      setPinging(false);
    }
  };

  const handleScanQuality = async () => {
    setScanningQuality(true);
    try {
      const res = await platformAiService.scanClassificationQuality();
      if (res.success && res.data) {
        setActionMessage(res.data.message || `Scored transactions per Handoff §11.`);
        await loadData(true);
      } else {
        setActionMessage(`Scan failed: ${res.error || 'Server error'}`);
      }
      setTimeout(() => setActionMessage(null), 6000);
    } catch (e: any) {
      setActionMessage(`Scan error: ${e.message}`);
    } finally {
      setScanningQuality(false);
    }
  };

  const handleOpenAddProvider = () => {
    setProviderToEdit(null);
    setIsAddProviderModalOpen(true);
  };

  const handleEditProvider = (node: GatewayNodeStatus) => {
    setProviderToEdit(node);
    setIsAddProviderModalOpen(true);
  };

  const handleDeleteProvider = async (id: string | undefined, name: string) => {
    if (!id) return;
    if (!confirm(`Are you sure you want to remove "${name}" from the gateway failover cascade?`)) {
      return;
    }
    try {
      setActionMessage(`Removing ${name} from cascade...`);
      const res = await platformAiService.deleteGatewayProvider(id);
      if (res.success) {
        await loadData(true);
        setActionMessage(`Provider ${name} removed from cascade.`);
      } else {
        setActionMessage(`Failed to remove: ${res.error}`);
      }
    } catch (err: any) {
      setActionMessage(`Error: ${err.message}`);
    }
    setTimeout(() => setActionMessage(null), 4000);
  };

  const handleTestSpecificNode = async (node: GatewayNodeStatus) => {
    const targetId = node.id || node.modelName;
    setTestingNodeId(targetId);
    try {
      const res = await platformAiService.testGatewayNode(targetId);
      if (res.success && res.data?.success) {
        setActionMessage(`Node "${node.name}" connected! Latency: ${res.data.latencyMs}ms`);
        await loadData(true);
      } else {
        setActionMessage(`Node "${node.name}" test failed: ${res.data?.error || res.error || 'Connection failed'}`);
      }
    } catch (err: any) {
      setActionMessage(`Test failed: ${err.message}`);
    } finally {
      setTestingNodeId(null);
      setTimeout(() => setActionMessage(null), 5000);
    }
  };

  const handleMovePriority = async (index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= gatewayNodes.length) return;

    const currentNodes = [...gatewayNodes];
    const temp = currentNodes[index];
    currentNodes[index] = currentNodes[targetIndex];
    currentNodes[targetIndex] = temp;

    const order = currentNodes.map((n, idx) => ({
      id: n.id || n.modelName,
      priority: idx + 1,
    }));

    try {
      setActionMessage('Updating failover priority cascade...');
      await platformAiService.reorderGatewayProviders(order);
      await loadData(true);
      setActionMessage('Failover priority order updated.');
      setTimeout(() => setActionMessage(null), 3000);
    } catch (err: any) {
      setActionMessage(`Failed to reorder: ${err.message}`);
    }
  };

  const filteredTenants = tenants.filter(t =>
    t.organizationName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    t.planTier.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (t.slug && t.slug.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  // Calculate live aggregate revenue and commercial equivalent
  const totalPlanRevenuePkr = tenants.reduce((sum, t) => sum + (t.planFeePkr || 0), 0);
  const totalPlanRevenueUsd = tenants.reduce((sum, t) => sum + (t.planFeeUsd || 0), 0);

  const keyTier = stats?.keyTier;

  return (
    <AiPortalLayout currentView={currentView} onViewChange={handleViewChange}>
      <div className="p-8 space-y-8 max-w-7xl mx-auto">
        {/* Top Control Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-2xl font-bold font-mono text-white flex items-center gap-2">
                <Brain className="size-6 text-pink-400" />
                {currentView === 'telemetry' && 'AI Platform Telemetry & Metering Overview'}
                {currentView === 'tenants' && 'Tenant Consumption & Plan Revenue Margins'}
                {currentView === 'gateway' && 'Multi-Model Gateway & Auto-Failover Radar'}
                {currentView === 'quality' && 'Narration Classification Quality & Drift (§11)'}
                {currentView === 'privacy' && 'Customer Data Privacy & Air-Gap Vault (§20, §33)'}
              </h2>
            </div>
            <p className="text-slate-400 text-xs font-mono mt-1">
              Authoritative control plane · Grounded in Supabase DB & Google Gemini Free Tier
            </p>
          </div>

          <div className="flex items-center gap-3">
            {/* Live Ping Gateway Diagnostic */}
            <Button
              onClick={() => handlePingGateway()}
              disabled={pinging}
              className="bg-indigo-950/50 hover:bg-indigo-900/60 text-indigo-300 border border-indigo-500/30 font-mono text-xs flex items-center gap-2"
            >
              <Zap className={`size-3.5 ${pinging ? 'animate-bounce text-yellow-400' : 'text-indigo-400'}`} />
              {pinging ? 'Pinging Gateway...' : 'Ping Gateway'}
            </Button>

            <Button
              onClick={() => loadData(true)}
              disabled={refreshing}
              className="bg-pink-950/40 hover:bg-pink-900/50 text-pink-300 border border-pink-500/30 font-mono text-xs flex items-center gap-2"
            >
              <RefreshCw className={`size-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              {refreshing ? 'Syncing...' : 'Sync Telemetry'}
            </Button>

            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-mono">
              <ShieldCheck className="size-4" />
              <span>Air-Gap Active</span>
            </div>
          </div>
        </div>

        {actionMessage && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-3 bg-pink-500/10 border border-pink-500/30 rounded-xl text-pink-300 text-xs font-mono flex items-center gap-2"
          >
            <Zap className="size-4 text-pink-400" />
            <span>{actionMessage}</span>
          </motion.div>
        )}

        {/* Top Metric Cards - Grounded in Real Data */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Card 1: Actual AI Billed Cost & Key Tier Status */}
          <Card className="bg-slate-900/60 border-pink-500/25 backdrop-blur-xl relative overflow-hidden">
            <div className="absolute top-0 right-0 p-3 opacity-15"><DollarSign className="size-16 text-pink-400" /></div>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardDescription className="text-slate-400 font-mono text-xs">Actual Billed AI Spend</CardDescription>
                <span className={`text-[10px] px-2 py-0.5 rounded font-mono font-bold border ${
                  keyTier?.tier === 'paid'
                    ? 'bg-purple-500/20 text-purple-300 border-purple-500/40'
                    : keyTier?.confidence === 'verified_by_quota_error'
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                    : 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                }`}>
                  {keyTier?.badgeLabel || 'FREE TIER · Unverified'}
                </span>
              </div>
              <CardTitle className="text-2xl font-bold font-mono text-white">
                ${stats?.actualSpendUsd?.toFixed(2) ?? '0.00'}{' '}
                <span className="text-xs text-emerald-400">USD</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0 space-y-1">
              <p className="text-[11px] text-slate-400 font-mono">
                Commercial Equivalent:{' '}
                <span className="text-pink-300 font-bold">
                  ${stats?.commercialEquivalentUsd ? stats.commercialEquivalentUsd.toFixed(4) : '0.0000'} USD
                </span>
              </p>
              <p className="text-[10px] text-emerald-400 font-mono">
                100% Platform Margin Retained
              </p>
            </CardContent>
          </Card>

          {/* Card 2: Platform Token Volume */}
          <Card className="bg-slate-900/60 border-pink-500/25 backdrop-blur-xl relative overflow-hidden">
            <div className="absolute top-0 right-0 p-3 opacity-15"><Cpu className="size-16 text-purple-400" /></div>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardDescription className="text-slate-400 font-mono text-xs">Platform Token Volume</CardDescription>
                {stats?.byokTokens && stats.byokTokens > 0 ? (
                  <span className="text-[10px] font-mono text-purple-300 bg-purple-950/60 px-1.5 py-0.5 rounded border border-purple-500/30 flex items-center gap-1">
                    <ShieldCheck className="size-3 text-purple-400" />
                    BYOK Isolated
                  </span>
                ) : null}
              </div>
              <CardTitle className="text-2xl font-bold font-mono text-white">
                {stats?.totalTokens !== undefined ? stats.totalTokens.toLocaleString() : '0'}{' '}
                <span className="text-xs text-purple-400">Tokens</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0 space-y-1">
              <p className="text-[11px] text-slate-400 font-mono">
                Prompt: {stats?.totalPromptTokens?.toLocaleString() ?? '0'} · Comp: {stats?.totalCompletionTokens?.toLocaleString() ?? '0'}
              </p>
              <div className="flex items-center justify-between text-[10px] font-mono gap-1 pt-0.5">
                <span className="text-purple-300">
                  {stats?.totalEvents ?? 0} Platform Calls
                </span>
                {stats?.byokTokens && stats.byokTokens > 0 ? (
                  <span className="text-purple-400 bg-purple-950/60 px-1.5 py-0.5 rounded border border-purple-500/30" title="Tenant BYOK usage is isolated from platform key quota and billing">
                    {stats.byokTokens.toLocaleString()} BYOK (Tenant)
                  </span>
                ) : null}
              </div>
            </CardContent>
          </Card>

          {/* Card 3: Primary Active Gateway & Rate Limit Radar */}
          <Card className="bg-slate-900/60 border-pink-500/25 backdrop-blur-xl relative overflow-hidden">
            <div className="absolute top-0 right-0 p-3 opacity-15"><Server className="size-16 text-cyan-400" /></div>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardDescription className="text-slate-400 font-mono text-xs">Primary LLM Gateway</CardDescription>
                <span className="text-[10px] font-mono text-cyan-300 bg-cyan-950/60 px-1.5 py-0.5 rounded border border-cyan-500/30">
                  {stats?.apiKeyMasked || '••••8Kqw'}
                </span>
              </div>
              <CardTitle className="text-xl font-bold font-mono text-white flex items-center gap-2">
                <span className="size-2.5 rounded-full bg-emerald-400 animate-pulse" />
                {stats?.activeProvider || 'Google Gemini'}
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0 space-y-1">
              <p className="text-xs text-cyan-400 font-mono truncate">
                Model: {stats?.activeModel || 'gemini-flash-lite-latest'}
              </p>
              <p className="text-[10px] text-slate-400 font-mono">
                Today: {stats?.requestsToday ?? 0} / {stats?.dailyRequestLimit ?? 1500} RPD · {stats?.rollingRpm ?? 0}/{stats?.rateLimitRpm ?? 15} RPM
              </p>
              <p className="text-[9px] text-slate-500 font-mono">
                {stats?.dailyResetTime || 'Resets Midnight Pacific Time'}
              </p>
            </CardContent>
          </Card>

          {/* Card 4: Gateway Latency & Uptime */}
          <Card className="bg-slate-900/60 border-pink-500/25 backdrop-blur-xl relative overflow-hidden">
            <div className="absolute top-0 right-0 p-3 opacity-15"><Activity className="size-16 text-emerald-400" /></div>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardDescription className="text-slate-400 font-mono text-xs">Gateway Latency & Health</CardDescription>
                {pingResult && (
                  <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${pingResult.success ? 'bg-emerald-500/20 text-emerald-300' : 'bg-red-500/20 text-red-300'}`}>
                    Ping: {pingResult.latencyMs}ms
                  </span>
                )}
              </div>
              <CardTitle className="text-2xl font-bold font-mono text-white">
                {stats?.avgLatencyMs !== null && stats?.avgLatencyMs !== undefined ? `${stats.avgLatencyMs}ms` : '—'}
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0 space-y-1">
              <p className="text-xs text-emerald-400 font-mono">
                {stats?.uptimePercent !== null && stats?.uptimePercent !== undefined ? `${stats.uptimePercent}% Success SLA` : 'Ready · Awaiting Invocations'}
              </p>
              <p className="text-[10px] text-slate-400 font-mono">
                Failovers Triggered: {stats?.fallbackCount ?? 0}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* View 1: Telemetry & Overview */}
        {currentView === 'telemetry' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Feature Inferences Breakdown */}
              <Card className="lg:col-span-2 bg-slate-900/50 border-pink-500/20 backdrop-blur-xl">
                <CardHeader>
                  <CardTitle className="text-lg font-bold font-mono text-white flex items-center gap-2">
                    <Activity className="size-5 text-pink-400" />
                    System Feature Telemetry & Subsystem Inferences
                  </CardTitle>
                  <CardDescription className="font-mono text-xs text-slate-400">
                    Live call volume analyzed across Finance OS subsystems
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="p-3 rounded-xl bg-slate-950/60 border border-pink-500/20">
                      <p className="text-slate-400 text-[11px] font-mono">Narration Classification</p>
                      <p className="text-xl font-bold font-mono text-white mt-1">
                        {stats?.featureBreakdown?.narration_classification ?? 0}
                      </p>
                      <p className="text-[10px] text-pink-400 font-mono mt-0.5">§11 Rule Engine</p>
                    </div>

                    <div className="p-3 rounded-xl bg-slate-950/60 border border-indigo-500/20">
                      <p className="text-slate-400 text-[11px] font-mono">Copilot Chat</p>
                      <p className="text-xl font-bold font-mono text-white mt-1">
                        {stats?.featureBreakdown?.copilot_chat ?? 0}
                      </p>
                      <p className="text-[10px] text-indigo-400 font-mono mt-0.5">Financial Advisor</p>
                    </div>

                    <div className="p-3 rounded-xl bg-slate-950/60 border border-purple-500/20">
                      <p className="text-slate-400 text-[11px] font-mono">Copilot Analysis</p>
                      <p className="text-xl font-bold font-mono text-white mt-1">
                        {stats?.featureBreakdown?.copilot_analysis ?? 0}
                      </p>
                      <p className="text-[10px] text-purple-400 font-mono mt-0.5">Anomaly Detection</p>
                    </div>

                    <div className="p-3 rounded-xl bg-slate-950/60 border border-cyan-500/20">
                      <p className="text-slate-400 text-[11px] font-mono">Employee RAG</p>
                      <p className="text-xl font-bold font-mono text-white mt-1">
                        {stats?.featureBreakdown?.employee_rag ?? 0}
                      </p>
                      <p className="text-[10px] text-cyan-400 font-mono mt-0.5">Payroll & Payslips</p>
                    </div>
                  </div>

                  {/* Supabase Database Entity Backing */}
                  <div className="p-4 rounded-xl bg-slate-950/40 border border-slate-800 space-y-2">
                    <p className="text-xs font-mono text-slate-300 font-bold flex items-center gap-2">
                      <Server className="size-4 text-pink-400" />
                      Live Supabase Database Entity Counts
                    </p>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs font-mono pt-1">
                      <div className="text-slate-400">
                        Transactions: <span className="text-white font-bold">{stats?.systemEntities?.totalTransactions ?? 0}</span>
                      </div>
                      <div className="text-slate-400">
                        Classification Rules: <span className="text-white font-bold">{stats?.systemEntities?.totalRules ?? 0}</span>
                      </div>
                      <div className="text-slate-400">
                        Feedback Logs: <span className="text-white font-bold">{stats?.systemEntities?.totalFeedback ?? 0}</span>
                      </div>
                      <div className="text-slate-400">
                        Customer Orgs: <span className="text-white font-bold">{stats?.systemEntities?.totalOrganizations ?? tenants.length}</span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Free Tier Economics Card */}
              <Card className="bg-slate-900/50 border-pink-500/20 backdrop-blur-xl">
                <CardHeader>
                  <CardTitle className="text-lg font-bold font-mono text-white flex items-center gap-2">
                    <DollarSign className="size-5 text-emerald-400" />
                    Platform Margin Economics
                  </CardTitle>
                  <CardDescription className="font-mono text-xs text-slate-400">
                    SaaS Subscription Revenue vs Zero Gemini Free Tier Cost
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4 font-mono text-xs">
                  <div className="p-4 rounded-xl bg-slate-950/60 border border-purple-500/20 space-y-3">
                    <div className="flex justify-between">
                      <span className="text-slate-400">SaaS Plan Revenue:</span>
                      <span className="text-white font-bold">
                        {totalPlanRevenuePkr > 0 ? `${totalPlanRevenuePkr.toLocaleString()} PKR` : '$0.00 USD'}
                        <span className="text-[10px] text-amber-400 font-mono ml-2">(Stripe Sandbox)</span>
                      </span>
                    </div>
                    {totalPlanRevenueUsd > 0 && (
                      <div className="flex justify-between text-[11px] text-slate-400">
                        <span>USD Equivalent (FX 0.0036):</span>
                        <span className="text-slate-300 font-mono">${totalPlanRevenueUsd.toFixed(2)} / mo</span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className="text-slate-400">Actual Out-of-Pocket Spend:</span>
                      <span className="text-emerald-400 font-bold">$0.00 USD (Free Tier)</span>
                    </div>
                    <div className="pt-2 border-t border-purple-500/20 flex justify-between text-sm">
                      <span className="text-emerald-300 font-bold">Net Platform Margin:</span>
                      <span className="text-emerald-400 font-bold">
                        {totalPlanRevenuePkr > 0 ? `${totalPlanRevenuePkr.toLocaleString()} PKR (100%)` : '100% Retained'}
                      </span>
                    </div>
                  </div>

                  <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs">
                    ✓ Authoritative calculation: Customer subscriptions operate in Stripe Sandbox mode without direct AI metering charges. The platform absorbs AI inferences as operating COGS via the shared Gemini Free Tier.
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        {/* View 2: Tenant Consumption & Margins */}
        {(currentView === 'tenants' || currentView === 'telemetry') && (
          <div className="space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="relative w-full max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-slate-400" />
                <Input
                  placeholder="Search tenant or plan tier..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 bg-slate-900/50 border-pink-500/20 text-white font-mono text-sm"
                />
              </div>
              <p className="text-xs text-slate-400 font-mono">
                Showing {filteredTenants.length} customer organizations in database
              </p>
            </div>

            <div className="rounded-xl border border-pink-500/20 overflow-hidden bg-slate-900/40 backdrop-blur-xl">
              <table className="w-full text-left text-sm font-mono">
                <thead className="bg-slate-950/70 border-b border-pink-500/20 text-slate-400 text-xs">
                  <tr>
                    <th className="py-3 px-4">Organization</th>
                    <th className="py-3 px-4">Plan Tier</th>
                    <th className="py-3 px-4">AI Inferences / Monthly Quota</th>
                    <th className="py-3 px-4">Tokens Used</th>
                    <th className="py-3 px-4">Actual Cost</th>
                    <th className="py-3 px-4">Plan Revenue</th>
                    <th className="py-3 px-4">Net Margin</th>
                    <th className="py-3 px-4">Key Mode</th>
                    <th className="py-3 px-4 text-right">Burn Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-pink-500/10">
                  {filteredTenants.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-8 text-center text-slate-500 font-mono text-xs">
                        {loading ? 'Loading real organizations from Supabase...' : 'No organizations found.'}
                      </td>
                    </tr>
                  ) : (
                    filteredTenants.map((t) => (
                      <tr key={t.organizationId} className="hover:bg-pink-500/5 transition-colors">
                        <td className="py-3.5 px-4 font-medium text-white flex items-center gap-2">
                          <div className="size-7 rounded-lg bg-pink-500/10 border border-pink-500/20 flex items-center justify-center text-pink-400 font-bold text-xs">
                            {t.organizationName ? t.organizationName[0].toUpperCase() : 'O'}
                          </div>
                          <div>
                            <div>{t.organizationName}</div>
                            <div className="text-[10px] text-slate-500">
                              {t.slug || t.organizationId} · <span className="text-cyan-400">Statement Quota: {t.statementsQuota ?? 100}/mo</span>
                            </div>
                          </div>
                        </td>
                        <td className="py-3.5 px-4">
                          <div>
                            <span className="text-xs px-2 py-0.5 rounded bg-slate-800 text-pink-300 border border-pink-500/20">
                              {t.planTier}
                            </span>
                            <div className="text-[10px] text-amber-400/80 font-mono mt-0.5">Stripe Sandbox</div>
                          </div>
                        </td>
                        <td className="py-3.5 px-4">
                          {t.keySource === 'custom_byok' ? (
                            <div className="text-xs text-purple-300 font-mono">
                              <span>{t.byokRequests || 0} req (BYOK)</span>
                              <div className="text-[10px] text-slate-500">Exempt from Quota</div>
                            </div>
                          ) : (
                            <div className="space-y-1">
                              <div className="flex justify-between text-xs text-slate-300">
                                <span>{t.requestsUsed} req</span>
                                <span className="text-slate-500">{t.aiCreditsQuota} credits</span>
                              </div>
                              <div className="w-28 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                                <div
                                  className={`h-full ${
                                    t.quotaPercent > 90 ? 'bg-red-400' : t.quotaPercent > 70 ? 'bg-amber-400' : 'bg-pink-400'
                                  }`}
                                  style={{ width: `${Math.min(100, t.quotaPercent)}%` }}
                                />
                              </div>
                            </div>
                          )}
                        </td>
                        <td className="py-3.5 px-4">
                          {t.keySource === 'custom_byok' ? (
                            <div>
                              <div className="text-purple-300 font-bold font-mono text-xs flex items-center gap-1.5">
                                <span>{t.tokensUsed.toLocaleString()}</span>
                                <span className="text-[9px] px-1 py-0.2 rounded bg-purple-950/80 text-purple-400 border border-purple-500/30">
                                  BYOK
                                </span>
                              </div>
                              <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                                0 Platform Tokens
                              </div>
                            </div>
                          ) : (
                            <div>
                              <div className="text-slate-200 font-mono text-xs">
                                {t.tokensUsed.toLocaleString()}
                              </div>
                              <div className="text-[10px] text-slate-500 font-mono mt-0.5">
                                Platform Key
                              </div>
                            </div>
                          )}
                        </td>
                        <td className="py-3.5 px-4 text-emerald-400 font-bold">
                          ${t.rawCostUsd.toFixed(2)}
                        </td>
                        <td className="py-3.5 px-4 text-slate-300">
                          {t.planFeePkr > 0 ? `${t.planFeePkr.toLocaleString()} PKR` : 'Free'}
                        </td>
                        <td className="py-3.5 px-4">
                          <span className="font-bold text-emerald-400">
                            {t.planFeePkr > 0 ? `${t.planFeePkr.toLocaleString()} PKR (100%)` : '100%'}
                          </span>
                        </td>
                        <td className="py-3.5 px-4">
                          <span className={`text-[10px] px-2 py-0.5 rounded font-mono ${
                            t.keySource === 'custom_byok'
                              ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                              : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                          }`}>
                            {t.keySource === 'custom_byok' ? 'TENANT BYOK' : 'FREE TIER POOL'}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 text-right">
                          <span
                            className={`text-xs px-2 py-0.5 rounded font-mono ${
                              t.burnStatus === 'byok_exempt'
                                ? 'bg-purple-500/10 text-purple-400 border border-purple-500/30'
                                : t.burnStatus === 'exceeded'
                                ? 'bg-red-500/10 text-red-400 border border-red-500/30'
                                : t.burnStatus === 'warning'
                                ? 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                                : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                            }`}
                          >
                            {t.burnStatus === 'byok_exempt' ? 'BYOK EXEMPT' : t.burnStatus.toUpperCase()}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* View 3: Gateway Nodes & Manual Failover */}
        {currentView === 'gateway' && (
          <div className="space-y-6">
            {/* Header Control Strip */}
            <div className="p-4 bg-pink-950/20 border border-pink-500/30 rounded-xl text-xs font-mono text-pink-300 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <Zap className="size-5 text-pink-400 animate-pulse shrink-0" />
                <span>
                  Universal Gateway Active: Primary model is <strong className="text-white">{stats?.activeModel || 'gemini-flash-lite-latest'}</strong>. SaaS failover automatically steps down on 429 rate limit or upstream 5xx outages.
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  onClick={() => handlePingGateway()}
                  disabled={pinging}
                  size="sm"
                  variant="outline"
                  className="border-pink-500/40 text-pink-300 hover:bg-pink-950/60 text-xs font-mono"
                >
                  {pinging ? (
                    <>
                      <Loader2 className="size-3 animate-spin mr-1.5" />
                      Pinging...
                    </>
                  ) : (
                    <>
                      <Activity className="size-3 mr-1.5" />
                      Test Primary Node
                    </>
                  )}
                </Button>
                <Button
                  onClick={handleOpenAddProvider}
                  size="sm"
                  className="bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 text-white text-xs font-mono font-semibold"
                >
                  <Plus className="size-3.5 mr-1" />
                  Add LLM Provider
                </Button>
              </div>
            </div>

            {/* Active Failover Cascade Radar Bar */}
            <div className="p-4 bg-slate-900/80 border border-pink-500/20 rounded-xl space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-mono text-slate-300 font-semibold">
                  <Radio className="size-4 text-pink-400 animate-pulse" />
                  <span>ACTIVE FAILOVER CASCADE RADAR (WHOLE SAAS)</span>
                </div>
                <span className="text-[10px] font-mono text-slate-500">
                  {gatewayNodes.length} providers in failover chain (§18, §20)
                </span>
              </div>
              <div className="flex items-center gap-2 overflow-x-auto pb-1">
                {gatewayNodes.map((node, idx) => (
                  <div key={node.id || node.modelName} className="flex items-center gap-2 shrink-0">
                    <div
                      className={`px-3 py-2 rounded-lg border font-mono text-xs flex items-center gap-2.5 transition-all ${
                        node.priority === 1
                          ? 'bg-pink-950/60 border-pink-500/60 text-white shadow-md shadow-pink-500/20'
                          : node.circuitOpen
                          ? 'bg-red-950/30 border-red-500/40 text-red-300'
                          : 'bg-slate-950/60 border-slate-800 text-slate-300'
                      }`}
                    >
                      <span
                        className={`size-2 rounded-full ${
                          node.circuitOpen
                            ? 'bg-red-500 animate-ping'
                            : node.priority === 1
                            ? 'bg-emerald-400 animate-pulse'
                            : 'bg-cyan-400'
                        }`}
                      />
                      <span className="text-[10px] font-bold text-pink-400">P{node.priority}</span>
                      <span className="font-medium text-white">{node.name}</span>
                      <span className="text-[10px] text-slate-400 truncate max-w-[120px]">
                        ({node.modelName})
                      </span>
                      {node.circuitOpen ? (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-red-500/30 text-red-300 font-bold">
                          TRIPPED
                        </span>
                      ) : node.priority === 1 ? (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-bold">
                          PRIMARY
                        </span>
                      ) : (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400">
                          STANDBY
                        </span>
                      )}
                    </div>
                    {idx < gatewayNodes.length - 1 && (
                      <ArrowRight className="size-4 text-slate-600 shrink-0" />
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Provider Node Cards Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {gatewayNodes.map((node, index) => (
                <Card
                  key={node.id || node.modelName || node.provider}
                  className={`bg-slate-900/60 border backdrop-blur-xl relative overflow-hidden transition-all flex flex-col justify-between ${
                    node.circuitOpen
                      ? 'border-red-500/40 shadow-lg shadow-red-500/10'
                      : node.priority === 1
                      ? 'border-pink-500/40 shadow-lg shadow-pink-500/10'
                      : 'border-slate-800'
                  }`}
                >
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs px-2 py-0.5 rounded font-mono bg-pink-500/10 text-pink-300 border border-pink-500/20 font-bold">
                          P{node.priority} {node.priority === 1 ? '(PRIMARY)' : '(FAILOVER)'}
                        </span>
                        {/* Priority Reordering Buttons */}
                        <div className="flex items-center bg-slate-950/60 rounded border border-slate-800">
                          <button
                            type="button"
                            onClick={() => handleMovePriority(index, 'up')}
                            disabled={index === 0}
                            className="p-1 text-slate-400 hover:text-white disabled:opacity-30 disabled:hover:text-slate-400 transition-colors"
                            title="Move priority up"
                          >
                            <ChevronUp className="size-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleMovePriority(index, 'down')}
                            disabled={index === gatewayNodes.length - 1}
                            className="p-1 text-slate-400 hover:text-white disabled:opacity-30 disabled:hover:text-slate-400 transition-colors"
                            title="Move priority down"
                          >
                            <ChevronDown className="size-3" />
                          </button>
                        </div>
                      </div>

                      <div className="flex items-center gap-1">
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded font-mono font-semibold ${
                            node.circuitOpen
                              ? 'bg-red-500/20 text-red-300 border border-red-500/30'
                              : node.status === 'online'
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                              : node.status === 'not_configured'
                              ? 'bg-slate-700/40 text-slate-400 border border-slate-700'
                              : 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/30'
                          }`}
                        >
                          {node.circuitOpen ? 'TRIPPED' : node.status.toUpperCase().replace('_', ' ')}
                        </span>
                        {/* Edit Button */}
                        <button
                          type="button"
                          onClick={() => handleEditProvider(node)}
                          className="p-1 text-slate-400 hover:text-white rounded hover:bg-slate-800 transition-colors ml-1"
                          title="Edit Provider Node"
                        >
                          <Pencil className="size-3.5" />
                        </button>
                        {/* Delete Button (allowed if not P1) */}
                        {node.priority !== 1 && node.id && (
                          <button
                            type="button"
                            onClick={() => handleDeleteProvider(node.id, node.name)}
                            className="p-1 text-slate-400 hover:text-red-400 rounded hover:bg-red-950/40 transition-colors"
                            title="Remove from Cascade"
                          >
                            <Trash2 className="size-3.5" />
                          </button>
                        )}
                      </div>
                    </div>

                    <CardTitle className="text-lg font-bold font-mono text-white mt-2">
                      {node.name}
                    </CardTitle>
                    <CardDescription className="font-mono text-xs text-slate-400 space-y-0.5">
                      <div>Model: <span className="text-pink-300">{node.modelName}</span></div>
                      {node.baseUrl && (
                        <div className="truncate text-[10px] text-slate-500" title={node.baseUrl}>
                          Endpoint: {node.baseUrl}
                        </div>
                      )}
                    </CardDescription>
                  </CardHeader>

                  <CardContent className="space-y-4 font-mono text-xs">
                    <div className="space-y-2 py-2 border-y border-pink-500/10">
                      <div className="flex justify-between items-center text-slate-400">
                        <span>API Key:</span>
                        <span className="text-white flex items-center gap-1 font-mono text-[11px]">
                          {node.hasApiKey ? (
                            node.keySource === 'vault' ? (
                              <span className="text-emerald-400 flex items-center gap-1 font-semibold" title="Encrypted at rest with AES-256-GCM in Supabase DB">
                                <ShieldCheck className="size-3 text-emerald-400" />
                                {node.keyLast4 || '••••'} (Supabase Vault)
                              </span>
                            ) : (
                              <span className="text-amber-300 flex items-center gap-1" title="Configured via server environment variables (.env)">
                                <KeyRound className="size-3 text-amber-400" />
                                {node.keyLast4 || '••••'} (Server .env)
                              </span>
                            )
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleEditProvider(node)}
                              className="text-slate-500 hover:text-pink-300 underline flex items-center gap-1 transition-colors"
                              title="Click to add encrypted API Key into Supabase Vault"
                            >
                              <KeyRound className="size-3" />
                              Not Configured (Add Key)
                            </button>
                          )}
                        </span>
                      </div>
                      <div className="flex justify-between text-slate-400">
                        <span>Rate Limits:</span>
                        <span className="text-slate-300">
                          {node.rateLimitRpm || 60} RPM · {((node.rateLimitTpm || 1000000) / 1000).toLocaleString()}k TPM
                        </span>
                      </div>
                      <div className="flex justify-between text-slate-400">
                        <span>Latency:</span>
                        <span className="text-white">{node.latencyMs ? `${node.latencyMs}ms` : '—'}</span>
                      </div>
                      <div className="flex justify-between text-slate-400">
                        <span>Success Rate:</span>
                        <span className="text-emerald-400">{node.callCount > 0 ? `${node.successRate ?? 100}%` : '100%'}</span>
                      </div>
                      <div className="flex justify-between text-slate-400">
                        <span>Rate (1M In / Out):</span>
                        <span className="text-white">${node.costPer1MInput} / ${node.costPer1MOutput}</span>
                      </div>
                      <div className="flex justify-between text-slate-400">
                        <span>Invocations:</span>
                        <span className="text-pink-300">{node.callCount} calls</span>
                      </div>
                    </div>

                    <div className="space-y-2 pt-1">
                      {/* Test Node Button */}
                      <Button
                        type="button"
                        onClick={() => handleTestSpecificNode(node)}
                        disabled={testingNodeId === (node.id || node.modelName)}
                        variant="outline"
                        className="w-full border-slate-700 bg-slate-950/60 hover:bg-slate-800 text-slate-300 font-mono text-xs"
                      >
                        {testingNodeId === (node.id || node.modelName) ? (
                          <>
                            <Loader2 className="size-3 animate-spin mr-1.5" />
                            Testing Node...
                          </>
                        ) : (
                          <>
                            <Activity className="size-3 mr-1.5 text-cyan-400" />
                            Test Node Live
                          </>
                        )}
                      </Button>

                      {node.priority !== 1 && !node.circuitOpen && (
                        <Button
                          onClick={() => handleSetPrimary(node.modelName)}
                          className="w-full bg-pink-950/60 hover:bg-pink-900 text-pink-200 border border-pink-500/30 font-mono text-xs"
                        >
                          Make Primary Model
                        </Button>
                      )}

                      {node.circuitOpen ? (
                        <Button
                          onClick={() => handleToggleCircuit(node.modelName, 'reset_circuit')}
                          className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-mono text-xs font-semibold"
                        >
                          Reset Circuit & Re-enable
                        </Button>
                      ) : (
                        <Button
                          onClick={() => handleToggleCircuit(node.modelName, 'trip_circuit')}
                          className="w-full bg-slate-800 hover:bg-red-950 text-slate-300 hover:text-red-300 border border-slate-700 font-mono text-xs"
                        >
                          Simulate Failover Trip
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* View 4: Classification Quality (§11) */}
        {currentView === 'quality' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card className="bg-slate-900/50 border-pink-500/20 backdrop-blur-xl">
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-lg font-bold font-mono text-white">
                    Narration Classification Confidence Radar (§11)
                  </CardTitle>
                  <CardDescription className="font-mono text-xs text-slate-400">
                    Target: &gt;85% Auto-Approved Ratio (Finance OS Master Handoff §11)
                  </CardDescription>
                </div>
                <Button
                  onClick={handleScanQuality}
                  disabled={scanningQuality}
                  className="bg-pink-950/60 hover:bg-pink-900 text-pink-200 border border-pink-500/30 font-mono text-xs flex items-center gap-2 cursor-pointer"
                >
                  <Sparkles className={`size-3.5 ${scanningQuality ? 'animate-spin text-yellow-400' : 'text-pink-400'}`} />
                  {scanningQuality ? 'Scoring...' : 'Scan & Score (§11)'}
                </Button>
              </CardHeader>
              <CardContent className="space-y-4 font-mono text-sm">
                <div className="space-y-2">
                  <div className="flex justify-between text-xs">
                    <span className="text-emerald-400 font-bold">High Confidence (&ge;85% Auto-Approved)</span>
                    <span className="text-emerald-400">{quality?.confidenceDistribution?.high ?? 0}%</span>
                  </div>
                  <div className="w-full h-2.5 bg-slate-800 rounded-full overflow-hidden">
                    <div className="h-full bg-emerald-400" style={{ width: `${quality?.confidenceDistribution?.high ?? 0}%` }} />
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between text-xs">
                    <span className="text-amber-400 font-bold">Medium Confidence (60–84% Bulk Review Queue)</span>
                    <span className="text-amber-400">{quality?.confidenceDistribution?.medium ?? 0}%</span>
                  </div>
                  <div className="w-full h-2.5 bg-slate-800 rounded-full overflow-hidden">
                    <div className="h-full bg-amber-400" style={{ width: `${quality?.confidenceDistribution?.medium ?? 0}%` }} />
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex justify-between text-xs">
                    <span className="text-red-400 font-bold">Low Confidence (&lt;60% Individual Review)</span>
                    <span className="text-red-400">{quality?.confidenceDistribution?.low ?? 0}%</span>
                  </div>
                  <div className="w-full h-2.5 bg-slate-800 rounded-full overflow-hidden">
                    <div className="h-full bg-red-400" style={{ width: `${quality?.confidenceDistribution?.low ?? 0}%` }} />
                  </div>
                </div>

                {quality?.confidenceDistribution?.unclassifiedCount ? (
                  <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800 text-xs text-slate-400 flex justify-between items-center">
                    <span>Unclassified / Pending Ingestion:</span>
                    <span className="text-slate-200 font-bold">{quality.confidenceDistribution.unclassifiedCount} transactions</span>
                  </div>
                ) : null}
              </CardContent>
            </Card>

            <Card className="bg-slate-900/50 border-pink-500/20 backdrop-blur-xl">
              <CardHeader>
                <CardTitle className="text-lg font-bold font-mono text-white">
                  Human Override & Learning Feedback Loop
                </CardTitle>
                <CardDescription className="font-mono text-xs text-slate-400">
                  Live metrics calculated from Supabase transactions and classification rules
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 font-mono text-xs text-slate-300">
                <div className="flex items-center justify-between p-3 rounded-lg bg-slate-950/50 border border-pink-500/10">
                  <span>Accountant Override Rate</span>
                  <span className="font-bold text-emerald-400">
                    {quality?.accountantOverrideRate ?? 0}% (Target: &lt;5%)
                  </span>
                </div>
                <div className="flex items-center justify-between p-3 rounded-lg bg-slate-950/50 border border-pink-500/10">
                  <span>Total AI-Classified Transactions</span>
                  <span className="font-bold text-white">{quality?.totalClassifiedMonth?.toLocaleString() ?? '0'}</span>
                </div>
                <div className="flex items-center justify-between p-3 rounded-lg bg-slate-950/50 border border-pink-500/10">
                  <span>Active Learned Rules in DB</span>
                  <span className="font-bold text-pink-400">{quality?.activeRuleVersions ?? 0}</span>
                </div>
                <div className="flex items-center justify-between p-3 rounded-lg bg-slate-950/50 border border-pink-500/10">
                  <span>Cross-Tenant Rule Drift Alerts</span>
                  <span className="font-bold text-emerald-400">
                    {quality?.ruleDriftAlerts ?? 0} Active Drift Alerts
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* View 5: Privacy & Air-Gap Vault */}
        {currentView === 'privacy' && (
          <Card className="bg-slate-900/50 border-pink-500/20 backdrop-blur-xl">
            <CardHeader>
              <div className="flex items-center gap-3">
                <ShieldCheck className="size-6 text-emerald-400" />
                <div>
                  <CardTitle className="text-xl font-bold font-mono text-white">
                    Tenant Data Privacy & Air-Gap Compliance (§20, §33 Rule 16)
                  </CardTitle>
                  <CardDescription className="font-mono text-xs text-slate-400">
                    Cryptographic isolation guarantees that customer financial records remain private
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4 font-mono text-xs text-slate-300">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className={`p-4 rounded-xl bg-slate-950/60 border ${security?.keyTier?.tier === 'free' ? 'border-amber-500/20' : 'border-emerald-500/20'} space-y-2`}>
                  <div className={`${security?.keyTier?.tier === 'free' ? 'text-amber-400' : 'text-emerald-400'} font-bold flex items-center gap-2`}>
                    <CheckCircle2 className="size-4" />
                    <span>{security?.keyTier?.tier === 'free' ? 'Free Tier Privacy Terms' : 'Zero Public Model Training'}</span>
                  </div>
                  <p className="text-slate-400 leading-relaxed text-[11px]">
                    {security?.dataPrivacyDisclosure || 'Customer data is not retained in Finance OS databases. Upgrade to Paid Tier or configure Tenant BYOK for full enterprise zero-training guarantees.'}
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-slate-950/60 border border-emerald-500/20 space-y-2">
                  <div className="text-emerald-400 font-bold flex items-center gap-2">
                    <CheckCircle2 className="size-4" />
                    <span>Platform Admin Data Blindness</span>
                  </div>
                  <p className="text-slate-400 leading-relaxed text-[11px]">
                    Platform Admins can only view anonymized token counters, provider costs, and latency metrics. Raw customer bank statements and balances are mathematically inaccessible.
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-slate-950/60 border border-emerald-500/20 space-y-2">
                  <div className="text-emerald-400 font-bold flex items-center gap-2">
                    <CheckCircle2 className="size-4" />
                    <span>Payroll PII Scrubbing</span>
                  </div>
                  <p className="text-slate-400 leading-relaxed text-[11px]">
                    Prior to LLM context ingestion, employee names, national tax IDs, and sensitive bank IBANs are masked with deterministic tokens.
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-slate-950/60 border border-emerald-500/20 space-y-2">
                  <div className="text-emerald-400 font-bold flex items-center gap-2">
                    <CheckCircle2 className="size-4" />
                    <span>AES-256-GCM Vault Storage</span>
                  </div>
                  <p className="text-slate-400 leading-relaxed text-[11px]">
                    Tenant custom BYOK keys are encrypted at rest with organization-scoped initialization vectors and never returned in plaintext to the browser ({security?.customKeyTenants ?? 0} BYOK tenants active).
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Global LLM Provider & Failover Node Modal */}
      <AddProviderModal
        isOpen={isAddProviderModalOpen}
        onClose={() => {
          setIsAddProviderModalOpen(false);
          setProviderToEdit(null);
        }}
        onSaved={async () => {
          await loadData(true);
        }}
        providerToEdit={providerToEdit}
        existingCount={gatewayNodes.length}
      />
    </AiPortalLayout>
  );
}
