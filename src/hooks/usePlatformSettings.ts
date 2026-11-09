/**
 * System-Wide Reactive Platform Settings Hook
 * ============================================
 * Synchronizes global Platform Admin settings across all portals:
 * - Global Currencies (active currencies, symbols, FX rates)
 * - Data Retention & Privacy policies
 * - Backup & Restore policies
 * - Global Feature Flags (AI Category Suggestions, What-If Simulator,
 *   API Access Beta, White Label Mode, Multi-Currency Auto-Convert, Export to QuickBooks)
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  platformService,
  DEFAULT_PLATFORM_SETTINGS_STATE,
  type PlatformSettingsState,
  type PlatformCurrencyConfig,
} from '@/services/platformService';
import { syncPlatformCurrencies } from '@/lib/currencyUtils';

const STORAGE_KEY = 'finance_os_platform_settings_v1';
const EVENT_NAME = 'platform-settings-updated';

let sharedState: PlatformSettingsState = loadInitialState();
let fetchPromise: Promise<PlatformSettingsState> | null = null;
let lastFetchTimestamp = 0;

function loadInitialState(): PlatformSettingsState {
  if (typeof window !== 'undefined') {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as PlatformSettingsState;
        if (parsed && Array.isArray(parsed.currencies) && parsed.feature_flags) {
          syncPlatformCurrencies(
            parsed.currencies,
            parsed.feature_flags.multi_currency_auto_convert
          );
          return parsed;
        }
      }
    } catch {
      // Ignore storage errors
    }
  }
  syncPlatformCurrencies(
    DEFAULT_PLATFORM_SETTINGS_STATE.currencies,
    DEFAULT_PLATFORM_SETTINGS_STATE.feature_flags.multi_currency_auto_convert
  );
  return structuredClone(DEFAULT_PLATFORM_SETTINGS_STATE);
}

export function broadcastPlatformSettingsUpdate(next: PlatformSettingsState): void {
  sharedState = next;
  lastFetchTimestamp = Date.now();
  syncPlatformCurrencies(
    next.currencies,
    next.feature_flags?.multi_currency_auto_convert ?? true
  );

  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage quota errors
    }
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: next }));
    try {
      const bc = new BroadcastChannel('finance_os_platform_settings');
      bc.postMessage(next);
      bc.close();
    } catch {
      // BroadcastChannel not supported in some environments
    }
  }
}

export function getPlatformSettingsSnapshot(): PlatformSettingsState {
  return sharedState;
}

export function usePlatformSettings() {
  const [settings, setSettings] = useState<PlatformSettingsState>(() => sharedState);
  const [loading, setLoading] = useState<boolean>(false);

  const refresh = useCallback(async (force = false): Promise<PlatformSettingsState> => {
    const now = Date.now();
    if (!force && now - lastFetchTimestamp < 4_000 && sharedState) {
      setSettings(sharedState);
      return sharedState;
    }

    if (fetchPromise && !force) {
      return fetchPromise;
    }

    setLoading(true);
    fetchPromise = (async () => {
      try {
        const res = await platformService.getPublicConfig();
        if (res.success && res.data) {
          broadcastPlatformSettingsUpdate(res.data);
          return res.data;
        }
      } catch {
        // Keep existing cached state
      } finally {
        fetchPromise = null;
        setLoading(false);
      }
      return sharedState;
    })();

    return fetchPromise;
  }, []);

  useEffect(() => {
    void refresh(false);

    const handleCustomEvent = (e: Event) => {
      const custom = e as CustomEvent<PlatformSettingsState>;
      if (custom.detail) {
        setSettings(custom.detail);
      }
    };

    const handleStorageEvent = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && e.newValue) {
        try {
          const parsed = JSON.parse(e.newValue) as PlatformSettingsState;
          if (parsed && Array.isArray(parsed.currencies)) {
            sharedState = parsed;
            syncPlatformCurrencies(
              parsed.currencies,
              parsed.feature_flags?.multi_currency_auto_convert ?? true
            );
            setSettings(parsed);
          }
        } catch {
          // Ignore malformed JSON
        }
      }
    };

    window.addEventListener(EVENT_NAME, handleCustomEvent);
    window.addEventListener('storage', handleStorageEvent);

    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel('finance_os_platform_settings');
      bc.onmessage = (msg) => {
        if (msg?.data && Array.isArray(msg.data.currencies)) {
          sharedState = msg.data;
          syncPlatformCurrencies(
            msg.data.currencies,
            msg.data.feature_flags?.multi_currency_auto_convert ?? true
          );
          setSettings(msg.data);
        }
      };
    } catch {
      bc = null;
    }

    return () => {
      window.removeEventListener(EVENT_NAME, handleCustomEvent);
      window.removeEventListener('storage', handleStorageEvent);
      if (bc) bc.close();
    };
  }, [refresh]);

  const enabledCurrencies = useMemo<PlatformCurrencyConfig[]>(() => {
    const active = (settings.currencies || []).filter(c => c.enabled);
    return active.length > 0 ? active : DEFAULT_PLATFORM_SETTINGS_STATE.currencies;
  }, [settings.currencies]);

  const getSelectableCurrencyCodes = useCallback(
    (includeCurrentCurrency?: string): string[] => {
      const codes = enabledCurrencies.map(c => c.code);
      if (includeCurrentCurrency) {
        const clean = includeCurrentCurrency.toUpperCase().trim();
        if (clean && !codes.includes(clean)) {
          return [clean, ...codes];
        }
      }
      return codes;
    },
    [enabledCurrencies]
  );

  return {
    settings,
    loading,
    refresh,
    currencies: settings.currencies || DEFAULT_PLATFORM_SETTINGS_STATE.currencies,
    enabledCurrencies,
    getSelectableCurrencyCodes,
    retentionPolicies: settings.retention_policies || DEFAULT_PLATFORM_SETTINGS_STATE.retention_policies,
    backupPolicies: settings.backup_policies || DEFAULT_PLATFORM_SETTINGS_STATE.backup_policies,
    featureFlags: settings.feature_flags || DEFAULT_PLATFORM_SETTINGS_STATE.feature_flags,
  };
}

