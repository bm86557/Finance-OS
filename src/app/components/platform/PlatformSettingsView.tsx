import { useState, useEffect } from 'react';
import { Globe, Database, Shield, Bell, Save, Loader2, Plus, X, CheckCircle2, Download, RotateCcw, HardDrive } from 'lucide-react';
import { toast } from 'sonner';
import {
  platformService,
  DEFAULT_PLATFORM_SETTINGS_STATE,
  type PlatformSettingsState,
  type PlatformCurrencyConfig,
  type PlatformBackupRecord,
} from '@/services/platformService';
import { broadcastPlatformSettingsUpdate } from '@/hooks/usePlatformSettings';

function ToggleSwitch({
  checked,
  onChange,
  disabled = false,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="relative inline-flex items-center cursor-pointer shrink-0 disabled:opacity-50"
      style={{
        width: '44px',
        height: '24px',
        borderRadius: '9999px',
        background: checked ? '#7c3aed' : '#334155',
        transition: 'background 0.2s',
        padding: '2px',
        border: 'none',
      }}
    >
      <span
        style={{
          display: 'inline-block',
          width: '20px',
          height: '20px',
          borderRadius: '9999px',
          background: '#fff',
          transition: 'transform 0.2s',
          transform: checked ? 'translateX(20px)' : 'translateX(0)',
        }}
      />
    </button>
  );
}

const POPULAR_CURRENCY_PRESETS = [
  { code: 'SAR', name: 'Saudi Riyal', symbol: '﷼', rateToUsd: 0.2667 },
  { code: 'INR', name: 'Indian Rupee', symbol: '₹', rateToUsd: 0.0118 },
  { code: 'JPY', name: 'Japanese Yen', symbol: '¥', rateToUsd: 0.0065 },
  { code: 'CHF', name: 'Swiss Franc', symbol: 'CHF', rateToUsd: 1.13 },
  { code: 'CNY', name: 'Chinese Yuan', symbol: '¥', rateToUsd: 0.138 },
  { code: 'QAR', name: 'Qatari Riyal', symbol: 'ر.ق', rateToUsd: 0.2747 },
];

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function PlatformSettingsView() {
  const [settings, setSettings] = useState<PlatformSettingsState>(() =>
    structuredClone(DEFAULT_PLATFORM_SETTINGS_STATE)
  );
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [triggeringBackup, setTriggeringBackup] = useState<boolean>(false);

  // Add Currency Modal State
  const [showAddCurrencyModal, setShowAddCurrencyModal] = useState<boolean>(false);
  const [newCurrCode, setNewCurrCode] = useState<string>('');
  const [newCurrName, setNewCurrName] = useState<string>('');
  const [newCurrSymbol, setNewCurrSymbol] = useState<string>('');
  const [newCurrRate, setNewCurrRate] = useState<string>('1.0');
  const [addingCurrency, setAddingCurrency] = useState<boolean>(false);

  // Backup History Modal State
  const [showBackupHistoryModal, setShowBackupHistoryModal] = useState<boolean>(false);
  const [backups, setBackups] = useState<PlatformBackupRecord[]>([]);
  const [loadingBackups, setLoadingBackups] = useState<boolean>(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      try {
        const res = await platformService.getSettings();
        if (mounted && res.success && res.data) {
          setSettings(res.data);
          broadcastPlatformSettingsUpdate(res.data);
        }
      } catch (err) {
        console.error('[PlatformSettingsView] Error loading settings:', err);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const handleToggleCurrency = (code: string, enabled: boolean) => {
    const activeCount = settings.currencies.filter(c => c.enabled).length;
    if (!enabled && activeCount <= 1) {
      toast.error('At least one global currency must remain enabled.');
      return;
    }
    setSettings(prev => ({
      ...prev,
      currencies: prev.currencies.map(c => (c.code === code ? { ...c, enabled } : c)),
    }));
  };

  const handleAddCurrencySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = newCurrCode.toUpperCase().trim();
    if (!/^[A-Z]{3,5}$/.test(code)) {
      toast.error('Please enter a valid 3-5 letter ISO currency code (e.g. SAR, INR, JPY).');
      return;
    }
    const rate = Number(newCurrRate);
    if (!Number.isFinite(rate) || rate <= 0) {
      toast.error('Exchange rate to USD must be a positive number.');
      return;
    }

    setAddingCurrency(true);
    try {
      const res = await platformService.addCurrency({
        code,
        name: newCurrName.trim() || code,
        symbol: newCurrSymbol.trim() || code,
        rateToUsd: rate,
        precision: 2,
        enabled: true,
      });

      if (res.success && res.data) {
        setSettings(res.data);
        broadcastPlatformSettingsUpdate(res.data);
        toast.success(`Currency ${code} added and enabled system-wide.`);
        setShowAddCurrencyModal(false);
        setNewCurrCode('');
        setNewCurrName('');
        setNewCurrSymbol('');
        setNewCurrRate('1.0');
      } else {
        // Local optimistic update if offline
        const nextCurr: PlatformCurrencyConfig = {
          code,
          name: newCurrName.trim() || code,
          symbol: newCurrSymbol.trim() || code,
          rateToUsd: rate,
          precision: 2,
          enabled: true,
          isCustom: true,
        };
        const nextState: PlatformSettingsState = {
          ...settings,
          currencies: [
            ...settings.currencies.filter(c => c.code !== code),
            nextCurr,
          ],
          updated_at: new Date().toISOString(),
        };
        setSettings(nextState);
        broadcastPlatformSettingsUpdate(nextState);
        toast.success(`Currency ${code} added.`);
        setShowAddCurrencyModal(false);
      }
    } catch (err: any) {
      toast.error(err?.message || 'Failed to add currency');
    } finally {
      setAddingCurrency(false);
    }
  };

  const handleSaveAllChanges = async () => {
    setSaving(true);
    try {
      const res = await platformService.updateSettings({
        currencies: settings.currencies,
        retention_policies: settings.retention_policies,
        backup_policies: settings.backup_policies,
        feature_flags: settings.feature_flags,
      });

      if (res.success && res.data) {
        setSettings(res.data);
        broadcastPlatformSettingsUpdate(res.data);
        const enf = res.data.retention_enforcement;
        if (enf && settings.retention_policies.auto_delete_expired_data) {
          toast.success(
            `Platform settings saved system-wide. Retention policy active (${enf.protectedPostedTransactions} posted ledger entries protected).`
          );
        } else {
          toast.success('Platform settings saved and applied system-wide.');
        }
      } else {
        broadcastPlatformSettingsUpdate(settings);
        toast.error(res.error || 'Failed to save platform settings to server');
      }
    } catch (err: any) {
      toast.error(err?.message || 'Failed to save platform settings');
    } finally {
      setSaving(false);
    }
  };

  const handleTriggerManualBackup = async () => {
    setTriggeringBackup(true);
    try {
      // Save current backup policies first so the manual backup uses the selected storage location & retention
      await platformService.updateSettings({
        backup_policies: settings.backup_policies,
      });
      const res = await platformService.triggerManualBackup();
      if (res.success && res.data) {
        toast.success(
          `Manual backup ${res.data.backup_code} completed (${formatBytes(res.data.size_bytes)}) → ${res.data.storage_location}`
        );
        if (showBackupHistoryModal) {
          void loadBackupHistory();
        }
      } else {
        toast.error(res.error || 'Failed to trigger manual backup');
      }
    } catch (err: any) {
      toast.error(err?.message || 'Failed to trigger manual backup');
    } finally {
      setTriggeringBackup(false);
    }
  };

  const loadBackupHistory = async () => {
    setLoadingBackups(true);
    try {
      const res = await platformService.getBackups();
      if (res.success && Array.isArray(res.data)) {
        setBackups(res.data);
      }
    } catch (err) {
      console.error('[PlatformSettingsView] Failed to load backups:', err);
    } finally {
      setLoadingBackups(false);
    }
  };

  const handleOpenBackupHistory = () => {
    setShowBackupHistoryModal(true);
    void loadBackupHistory();
  };

  const handleDownloadBackupManifest = (backup: PlatformBackupRecord) => {
    const manifest = {
      backup_code: backup.backup_code,
      backup_type: backup.backup_type,
      status: backup.status,
      storage_location: backup.storage_location,
      size_bytes: backup.size_bytes,
      checksum_sha256: backup.checksum_sha256,
      created_at: backup.created_at,
      expires_at: backup.expires_at,
      triggered_by_email: backup.triggered_by_email,
      tables_summary: backup.tables_summary,
    };
    const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${backup.backup_code}-manifest.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success(`Downloaded manifest for ${backup.backup_code}`);
  };

  const handleRestoreBackup = async (backup: PlatformBackupRecord) => {
    setRestoringId(backup.id);
    try {
      const res = await platformService.restoreBackup(backup.id);
      if (res.success && res.data) {
        if (res.data.settings) {
          setSettings(res.data.settings);
          broadcastPlatformSettingsUpdate(res.data.settings);
        }
        toast.success(`Verified SHA-256 checksum & restored snapshot ${backup.backup_code}`);
        void loadBackupHistory();
      } else {
        toast.error(res.error || 'Failed to restore backup snapshot');
      }
    } catch (err: any) {
      toast.error(err?.message || 'Failed to restore backup');
    } finally {
      setRestoringId(null);
    }
  };

  const featureFlagRows: {
    key: keyof PlatformSettingsState['feature_flags'];
    name: string;
  }[] = [
    { key: 'ai_category_suggestions', name: 'AI-Powered Category Suggestions' },
    { key: 'advanced_what_if_simulations', name: 'Advanced What-If Simulations' },
    { key: 'api_access_beta', name: 'API Access (Beta)' },
    { key: 'white_label_mode', name: 'White Label Mode' },
    { key: 'multi_currency_auto_convert', name: 'Multi-Currency Auto-Convert' },
    { key: 'export_to_quickbooks', name: 'Export to QuickBooks' },
  ];

  return (
    <div className="p-6 space-y-6 bg-[#130b24] min-h-screen text-white">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white font-['Plus_Jakarta_Sans']">Platform Settings</h1>
          <p className="text-[#8a7fa8] mt-1 font-['JetBrains_Mono'] text-sm">
            Configure system-wide settings and policies
          </p>
        </div>
        {loading && (
          <div className="flex items-center gap-2 text-xs text-[#8a7fa8] font-['JetBrains_Mono']">
            <Loader2 className="w-4 h-4 animate-spin text-[#7c3aed]" />
            Syncing settings...
          </div>
        )}
      </div>

      {/* Global Currencies */}
      <div className="bg-[#1b1035] rounded-2xl border border-[#2d1b4e] p-6 shadow-[0_0_25px_rgba(124,58,237,0.1)]">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-blue-500/20 rounded-xl flex items-center justify-center border border-blue-500/30">
            <Globe className="w-5 h-5 text-blue-400" />
          </div>
          <div>
            <h3 className="font-bold text-white font-['Plus_Jakarta_Sans']">Global Currencies</h3>
            <p className="text-xs text-[#8a7fa8] font-['JetBrains_Mono']">Manage supported currencies system-wide</p>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {settings.currencies.map((curr) => (
            <div
              key={curr.code}
              className="flex items-center justify-between p-3 bg-[#130b24] rounded-xl border border-[#2d1b4e]"
              title={`${curr.name} (${curr.symbol}) • 1 ${curr.code} = $${curr.rateToUsd} USD`}
            >
              <span className="font-medium text-white font-['JetBrains_Mono']">{curr.code}</span>
              <ToggleSwitch
                checked={curr.enabled}
                onChange={(next) => handleToggleCurrency(curr.code, next)}
              />
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setShowAddCurrencyModal(true)}
          className="mt-4 px-4 py-2 bg-[#130b24] border border-[#2d1b4e] text-[#8a7fa8] hover:text-white rounded-xl hover:bg-[#2d1b4e]/50 transition-colors text-xs font-medium font-['JetBrains_Mono']"
        >
          + Add Currency
        </button>
      </div>

      {/* Data Retention */}
      <div className="bg-[#1b1035] rounded-2xl border border-[#2d1b4e] p-6 shadow-[0_0_25px_rgba(6,182,212,0.1)]">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-cyan-500/20 rounded-xl flex items-center justify-center border border-cyan-500/30">
            <Database className="w-5 h-5 text-cyan-400" />
          </div>
          <div>
            <h3 className="font-bold text-white font-['Plus_Jakarta_Sans']">Data Retention & Privacy</h3>
            <p className="text-xs text-[#8a7fa8] font-['JetBrains_Mono']">Define how long data is retained across organizations</p>
          </div>
        </div>
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-[#8a7fa8] mb-2 font-['JetBrains_Mono']">
                Transaction Data Retention (days)
              </label>
              <input
                type="number"
                min={30}
                value={settings.retention_policies.transaction_retention_days}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    retention_policies: {
                      ...prev.retention_policies,
                      transaction_retention_days: Math.max(1, Number(e.target.value) || 730),
                    },
                  }))
                }
                className="w-full px-4 py-2.5 bg-[#130b24] border border-[#2d1b4e] rounded-xl text-white font-['JetBrains_Mono'] text-sm focus:outline-none focus:border-[#06b6d4]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#8a7fa8] mb-2 font-['JetBrains_Mono']">
                Audit Log Retention (days)
              </label>
              <input
                type="number"
                min={30}
                value={settings.retention_policies.audit_log_retention_days}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    retention_policies: {
                      ...prev.retention_policies,
                      audit_log_retention_days: Math.max(1, Number(e.target.value) || 365),
                    },
                  }))
                }
                className="w-full px-4 py-2.5 bg-[#130b24] border border-[#2d1b4e] rounded-xl text-white font-['JetBrains_Mono'] text-sm focus:outline-none focus:border-[#06b6d4]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#8a7fa8] mb-2 font-['JetBrains_Mono']">
                Statement Files Retention (days)
              </label>
              <input
                type="number"
                min={30}
                value={settings.retention_policies.statement_files_retention_days}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    retention_policies: {
                      ...prev.retention_policies,
                      statement_files_retention_days: Math.max(1, Number(e.target.value) || 365),
                    },
                  }))
                }
                className="w-full px-4 py-2.5 bg-[#130b24] border border-[#2d1b4e] rounded-xl text-white font-['JetBrains_Mono'] text-sm focus:outline-none focus:border-[#06b6d4]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#8a7fa8] mb-2 font-['JetBrains_Mono']">
                Deleted Org Data Retention (days)
              </label>
              <input
                type="number"
                min={7}
                value={settings.retention_policies.deleted_org_retention_days}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    retention_policies: {
                      ...prev.retention_policies,
                      deleted_org_retention_days: Math.max(1, Number(e.target.value) || 90),
                    },
                  }))
                }
                className="w-full px-4 py-2.5 bg-[#130b24] border border-[#2d1b4e] rounded-xl text-white font-['JetBrains_Mono'] text-sm focus:outline-none focus:border-[#06b6d4]"
              />
            </div>
          </div>
          <div className="flex items-center justify-between p-4 bg-[#130b24] rounded-xl border border-[#2d1b4e]">
            <div>
              <div className="font-medium text-white text-sm">Auto-delete expired data</div>
              <div className="text-xs text-[#8a7fa8] font-['JetBrains_Mono']">
                Automatically remove data after retention period
              </div>
            </div>
            <ToggleSwitch
              checked={settings.retention_policies.auto_delete_expired_data}
              onChange={(next) =>
                setSettings((prev) => ({
                  ...prev,
                  retention_policies: {
                    ...prev.retention_policies,
                    auto_delete_expired_data: next,
                  },
                }))
              }
            />
          </div>
        </div>
      </div>

      {/* Backup & Restore */}
      <div className="bg-[#1b1035] rounded-2xl border border-[#2d1b4e] p-6 shadow-[0_0_25px_rgba(217,70,239,0.1)]">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-fuchsia-500/20 rounded-xl flex items-center justify-center border border-fuchsia-500/30">
            <Shield className="w-5 h-5 text-fuchsia-400" />
          </div>
          <div>
            <h3 className="font-bold text-white font-['Plus_Jakarta_Sans']">Backup & Restore Policies</h3>
            <p className="text-xs text-[#8a7fa8] font-['JetBrains_Mono']">System-wide backup frequency and restore controls</p>
          </div>
        </div>
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-[#8a7fa8] mb-2 font-['JetBrains_Mono']">
                Full Backup Frequency
              </label>
              <select
                value={settings.backup_policies.full_backup_frequency}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    backup_policies: {
                      ...prev.backup_policies,
                      full_backup_frequency: e.target.value as PlatformSettingsState['backup_policies']['full_backup_frequency'],
                    },
                  }))
                }
                className="w-full px-4 py-2.5 bg-[#130b24] border border-[#2d1b4e] rounded-xl text-white font-['JetBrains_Mono'] text-sm focus:outline-none focus:border-[#d946ef]"
              >
                <option value="Daily">Daily</option>
                <option value="Weekly">Weekly</option>
                <option value="Monthly">Monthly</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-[#8a7fa8] mb-2 font-['JetBrains_Mono']">
                Incremental Backup Frequency
              </label>
              <select
                value={settings.backup_policies.incremental_backup_frequency}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    backup_policies: {
                      ...prev.backup_policies,
                      incremental_backup_frequency: e.target.value as PlatformSettingsState['backup_policies']['incremental_backup_frequency'],
                    },
                  }))
                }
                className="w-full px-4 py-2.5 bg-[#130b24] border border-[#2d1b4e] rounded-xl text-white font-['JetBrains_Mono'] text-sm focus:outline-none focus:border-[#d946ef]"
              >
                <option value="Hourly">Hourly</option>
                <option value="Every 6 hours">Every 6 hours</option>
                <option value="Every 12 hours">Every 12 hours</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-[#8a7fa8] mb-2 font-['JetBrains_Mono']">
                Backup Retention (days)
              </label>
              <input
                type="number"
                min={1}
                value={settings.backup_policies.backup_retention_days}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    backup_policies: {
                      ...prev.backup_policies,
                      backup_retention_days: Math.max(1, Number(e.target.value) || 30),
                    },
                  }))
                }
                className="w-full px-4 py-2.5 bg-[#130b24] border border-[#2d1b4e] rounded-xl text-white font-['JetBrains_Mono'] text-sm focus:outline-none focus:border-[#d946ef]"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-[#8a7fa8] mb-2 font-['JetBrains_Mono']">
                Backup Storage Location
              </label>
              <input
                type="text"
                value={settings.backup_policies.storage_location}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    backup_policies: {
                      ...prev.backup_policies,
                      storage_location: e.target.value,
                    },
                  }))
                }
                className="w-full px-4 py-2.5 bg-[#130b24] border border-[#2d1b4e] rounded-xl text-white font-['JetBrains_Mono'] text-sm focus:outline-none focus:border-[#d946ef]"
              />
            </div>
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              disabled={triggeringBackup}
              onClick={handleTriggerManualBackup}
              className="px-4 py-2.5 bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded-xl hover:bg-blue-500/30 transition-colors font-medium text-xs font-['Plus_Jakarta_Sans'] flex items-center gap-2 disabled:opacity-50"
            >
              {triggeringBackup && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {triggeringBackup ? 'Creating Snapshot...' : 'Trigger Manual Backup'}
            </button>
            <button
              type="button"
              onClick={handleOpenBackupHistory}
              className="px-4 py-2.5 bg-[#130b24] border border-[#2d1b4e] text-[#8a7fa8] hover:text-white rounded-xl hover:bg-[#2d1b4e]/50 transition-colors font-medium text-xs font-['JetBrains_Mono']"
            >
              View Backup History
            </button>
          </div>
        </div>
      </div>

      {/* Feature Flags */}
      <div className="bg-[#1b1035] rounded-2xl border border-[#2d1b4e] p-6 shadow-[0_0_25px_rgba(249,115,22,0.1)]">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 bg-orange-500/20 rounded-xl flex items-center justify-center border border-orange-500/30">
            <Bell className="w-5 h-5 text-orange-400" />
          </div>
          <div>
            <h3 className="font-bold text-white font-['Plus_Jakarta_Sans']">Global Feature Flags</h3>
            <p className="text-xs text-[#8a7fa8] font-['JetBrains_Mono']">Enable or disable features system-wide</p>
          </div>
        </div>
        <div className="space-y-3">
          {featureFlagRows.map((feature) => (
            <div
              key={feature.key}
              className="flex items-center justify-between p-4 bg-[#130b24] rounded-xl border border-[#2d1b4e]"
            >
              <span className="font-medium text-white text-sm">{feature.name}</span>
              <ToggleSwitch
                checked={Boolean(settings.feature_flags[feature.key])}
                onChange={(next) =>
                  setSettings((prev) => ({
                    ...prev,
                    feature_flags: {
                      ...prev.feature_flags,
                      [feature.key]: next,
                    },
                  }))
                }
              />
            </div>
          ))}
        </div>
      </div>

      {/* Save Button */}
      <div className="flex justify-end">
        <button
          type="button"
          disabled={saving}
          onClick={handleSaveAllChanges}
          className="px-6 py-3 bg-[#06b6d4]/20 text-[#06b6d4] border border-[#06b6d4]/30 rounded-xl hover:bg-[#06b6d4]/30 transition-colors font-bold flex items-center gap-2 shadow-[0_0_15px_rgba(6,182,212,0.2)] font-['Plus_Jakarta_Sans'] text-sm disabled:opacity-50"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {saving ? 'Saving Changes...' : 'Save All Changes'}
        </button>
      </div>

      {/* + Add Currency Modal */}
      {showAddCurrencyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-[#1b1035] border border-[#2d1b4e] rounded-2xl w-full max-w-md p-6 shadow-2xl text-white">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 bg-blue-500/20 rounded-xl flex items-center justify-center border border-blue-500/30">
                  <Plus className="w-4 h-4 text-blue-400" />
                </div>
                <div>
                  <h3 className="font-bold text-white font-['Plus_Jakarta_Sans']">Add Global Currency</h3>
                  <p className="text-xs text-[#8a7fa8] font-['JetBrains_Mono']">Enable a new currency across all organizations</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowAddCurrencyModal(false)}
                className="text-[#8a7fa8] hover:text-white p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="mb-4">
              <div className="text-xs text-[#8a7fa8] mb-2 font-['JetBrains_Mono']">Quick Presets</div>
              <div className="flex flex-wrap gap-1.5">
                {POPULAR_CURRENCY_PRESETS.map((preset) => (
                  <button
                    key={preset.code}
                    type="button"
                    onClick={() => {
                      setNewCurrCode(preset.code);
                      setNewCurrName(preset.name);
                      setNewCurrSymbol(preset.symbol);
                      setNewCurrRate(String(preset.rateToUsd));
                    }}
                    className="px-2.5 py-1 bg-[#130b24] hover:bg-[#2d1b4e] border border-[#2d1b4e] rounded-lg text-xs font-['JetBrains_Mono'] text-[#c4b5fd] transition-colors"
                  >
                    {preset.code} ({preset.symbol})
                  </button>
                ))}
              </div>
            </div>

            <form onSubmit={handleAddCurrencySubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-[#8a7fa8] mb-1.5 font-['JetBrains_Mono']">ISO Code *</label>
                  <input
                    type="text"
                    required
                    maxLength={5}
                    placeholder="e.g. SAR"
                    value={newCurrCode}
                    onChange={(e) => setNewCurrCode(e.target.value.toUpperCase())}
                    className="w-full px-3.5 py-2 bg-[#130b24] border border-[#2d1b4e] rounded-xl text-white font-['JetBrains_Mono'] text-sm focus:outline-none focus:border-blue-400"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[#8a7fa8] mb-1.5 font-['JetBrains_Mono']">Symbol *</label>
                  <input
                    type="text"
                    required
                    maxLength={6}
                    placeholder="e.g. ﷼"
                    value={newCurrSymbol}
                    onChange={(e) => setNewCurrSymbol(e.target.value)}
                    className="w-full px-3.5 py-2 bg-[#130b24] border border-[#2d1b4e] rounded-xl text-white font-['JetBrains_Mono'] text-sm focus:outline-none focus:border-blue-400"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs text-[#8a7fa8] mb-1.5 font-['JetBrains_Mono']">Currency Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Saudi Riyal"
                  value={newCurrName}
                  onChange={(e) => setNewCurrName(e.target.value)}
                  className="w-full px-3.5 py-2 bg-[#130b24] border border-[#2d1b4e] rounded-xl text-white font-['JetBrains_Mono'] text-sm focus:outline-none focus:border-blue-400"
                />
              </div>
              <div>
                <label className="block text-xs text-[#8a7fa8] mb-1.5 font-['JetBrains_Mono']">
                  Exchange Rate to USD (1 Unit = $ USD) *
                </label>
                <input
                  type="number"
                  step="any"
                  required
                  placeholder="e.g. 0.2667"
                  value={newCurrRate}
                  onChange={(e) => setNewCurrRate(e.target.value)}
                  className="w-full px-3.5 py-2 bg-[#130b24] border border-[#2d1b4e] rounded-xl text-white font-['JetBrains_Mono'] text-sm focus:outline-none focus:border-blue-400"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowAddCurrencyModal(false)}
                  className="px-4 py-2 bg-[#130b24] border border-[#2d1b4e] text-[#8a7fa8] hover:text-white rounded-xl text-xs font-['JetBrains_Mono']"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={addingCurrency}
                  className="px-4 py-2 bg-[#7c3aed] hover:bg-[#6d28d9] text-white rounded-xl text-xs font-bold font-['Plus_Jakarta_Sans'] flex items-center gap-1.5 disabled:opacity-50"
                >
                  {addingCurrency && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Add & Enable Currency
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* View Backup History Modal */}
      {showBackupHistoryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="bg-[#1b1035] border border-[#2d1b4e] rounded-2xl w-full max-w-4xl max-h-[85vh] flex flex-col shadow-2xl text-white">
            <div className="flex items-center justify-between p-6 border-b border-[#2d1b4e]">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-fuchsia-500/20 rounded-xl flex items-center justify-center border border-fuchsia-500/30">
                  <HardDrive className="w-5 h-5 text-fuchsia-400" />
                </div>
                <div>
                  <h3 className="font-bold text-white font-['Plus_Jakarta_Sans'] text-lg">
                    System Backup & Snapshot History
                  </h3>
                  <p className="text-xs text-[#8a7fa8] font-['JetBrains_Mono']">
                    Target Storage: {settings.backup_policies.storage_location} • Retention: {settings.backup_policies.backup_retention_days} days
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={triggeringBackup}
                  onClick={handleTriggerManualBackup}
                  className="px-3.5 py-2 bg-blue-500/20 text-blue-400 border border-blue-500/30 rounded-xl hover:bg-blue-500/30 text-xs font-medium flex items-center gap-1.5 disabled:opacity-50"
                >
                  {triggeringBackup && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  + New Manual Snapshot
                </button>
                <button
                  type="button"
                  onClick={() => setShowBackupHistoryModal(false)}
                  className="text-[#8a7fa8] hover:text-white p-1.5"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="p-6 overflow-y-auto space-y-3 flex-1">
              {loadingBackups ? (
                <div className="py-12 flex flex-col items-center justify-center gap-2 text-[#8a7fa8]">
                  <Loader2 className="w-6 h-6 animate-spin text-fuchsia-400" />
                  <span className="text-xs font-['JetBrains_Mono']">Loading backup snapshots...</span>
                </div>
              ) : backups.length === 0 ? (
                <div className="py-12 text-center text-[#8a7fa8] font-['JetBrains_Mono'] text-sm">
                  No backups recorded yet. Click "+ New Manual Snapshot" to create one.
                </div>
              ) : (
                backups.map((bkp) => (
                  <div
                    key={bkp.id}
                    className="p-4 bg-[#130b24] border border-[#2d1b4e] rounded-xl flex flex-col md:flex-row md:items-center justify-between gap-4"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2.5 flex-wrap">
                        <span className="font-bold text-white font-['JetBrains_Mono'] text-sm">
                          {bkp.backup_code}
                        </span>
                        <span className="px-2 py-0.5 text-[11px] rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30 font-['JetBrains_Mono'] uppercase">
                          {bkp.backup_type.replace('_', ' ')}
                        </span>
                        <span className="px-2 py-0.5 text-[11px] rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-['JetBrains_Mono'] flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" />
                          {bkp.status}
                        </span>
                      </div>
                      <div className="text-xs text-[#8a7fa8] font-['JetBrains_Mono']">
                        Created: {new Date(bkp.created_at).toLocaleString()} • Size: {formatBytes(bkp.size_bytes)} • Location: {bkp.storage_location}
                      </div>
                      <div className="text-[11px] text-[#6d628a] font-['JetBrains_Mono'] break-all">
                        SHA-256: {bkp.checksum_sha256}
                      </div>
                      {bkp.tables_summary && (
                        <div className="flex flex-wrap gap-2 pt-1">
                          {['organizations', 'transactions', 'journal_entries', 'accounts', 'audit_logs'].map(
                            (tbl) =>
                              bkp.tables_summary[tbl] !== undefined && (
                                <span
                                  key={tbl}
                                  className="px-2 py-0.5 bg-[#1b1035] border border-[#2d1b4e] rounded text-[11px] text-[#a398c2] font-['JetBrains_Mono']"
                                >
                                  {tbl}: {bkp.tables_summary[tbl]}
                                </span>
                              )
                          )}
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleDownloadBackupManifest(bkp)}
                        className="px-3 py-2 bg-[#1b1035] hover:bg-[#2d1b4e] border border-[#2d1b4e] rounded-xl text-xs text-[#c4b5fd] font-['JetBrains_Mono'] flex items-center gap-1.5 transition-colors"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Manifest
                      </button>
                      <button
                        type="button"
                        disabled={restoringId === bkp.id}
                        onClick={() => handleRestoreBackup(bkp)}
                        className="px-3 py-2 bg-fuchsia-500/20 hover:bg-fuchsia-500/30 border border-fuchsia-500/30 rounded-xl text-xs text-fuchsia-300 font-['JetBrains_Mono'] flex items-center gap-1.5 transition-colors disabled:opacity-50"
                      >
                        {restoringId === bkp.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <RotateCcw className="w-3.5 h-3.5" />
                        )}
                        Restore
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
