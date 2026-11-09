/**
 * Server-Side Currency & FX Conversion Utilities
 * ===============================================
 * Provides robust multi-currency conversion across reports, bank accounts,
 * transactions, and organization dashboards.
 */

export const DEFAULT_RATES_TO_USD: Record<string, number> = {
  USD: 1,
  EUR: 1.08,
  GBP: 1.28,
  PKR: 1 / 280,   // 280 PKR = 1 USD
  INR: 1 / 85,    // 85 INR = 1 USD
  AED: 1 / 3.67,  // 3.67 AED = 1 USD
  SAR: 1 / 3.75,  // 3.75 SAR = 1 USD
  CAD: 1 / 1.38,
  AUD: 1 / 1.55,
  SGD: 1 / 1.35,
  JPY: 1 / 155,
  CNY: 1 / 7.25,
};

let autoConvertEnabled = true;

/**
 * Synchronizes runtime FX rates and Multi-Currency Auto-Convert flag from Platform Settings.
 */
export function syncRuntimeFxRates(ratesToUsd: Record<string, number>, multiCurrencyAutoConvert = true): void {
  for (const [code, rate] of Object.entries(ratesToUsd || {})) {
    if (code && Number.isFinite(rate) && rate > 0) {
      DEFAULT_RATES_TO_USD[code.toUpperCase().trim()] = rate;
    }
  }
  autoConvertEnabled = Boolean(multiCurrencyAutoConvert);
}

export function isMultiCurrencyAutoConvertEnabled(): boolean {
  return autoConvertEnabled;
}

/**
 * Returns estimated exchange rate from `fromCurrency` to `toCurrency`.
 * Example:
 *   getEstimatedFxRate('USD', 'PKR') => 280
 *   getEstimatedFxRate('PKR', 'USD') => 0.00357 (1/280)
 */
export function getEstimatedFxRate(fromCurrency?: string, toCurrency?: string): number {
  const from = (fromCurrency || 'USD').toUpperCase().trim();
  const to = (toCurrency || 'USD').toUpperCase().trim();
  if (from === to) return 1;
  if (!autoConvertEnabled) return 1;

  const fromToUsd = DEFAULT_RATES_TO_USD[from] ?? 1;
  const toToUsd = DEFAULT_RATES_TO_USD[to] ?? 1;

  return fromToUsd / toToUsd;
}

/**
 * Converts `amount` from `fromCurrency` to `toCurrency`.
 * Handles custom FX rates when provided, and respects the global Multi-Currency Auto-Convert flag.
 */
export function convertCurrency(
  amount: number,
  fromCurrency?: string,
  toCurrency?: string,
  customFxRate?: number,
): number {
  if (!amount || !Number.isFinite(amount)) return 0;
  const from = (fromCurrency || 'USD').toUpperCase().trim();
  const to = (toCurrency || 'USD').toUpperCase().trim();
  if (from === to) return amount;

  if (customFxRate && customFxRate > 0) {
    if ((from === 'PKR' && to === 'USD') || (from === 'INR' && to === 'USD')) {
      const rate = customFxRate >= 1 ? 1 / customFxRate : customFxRate;
      return Math.round(amount * rate * 100) / 100;
    }
    if ((from === 'USD' && to === 'PKR') || (from === 'USD' && to === 'INR')) {
      const rate = customFxRate >= 1 ? customFxRate : 1 / customFxRate;
      return Math.round(amount * rate * 100) / 100;
    }
    return Math.round(amount * customFxRate * 100) / 100;
  }

  if (!autoConvertEnabled) {
    return Math.round(amount * 100) / 100;
  }

  const fromRate = DEFAULT_RATES_TO_USD[from] ?? 1;
  const toRate = DEFAULT_RATES_TO_USD[to] ?? 1;
  const amountInUsd = amount * fromRate;
  const targetAmount = amountInUsd / toRate;
  return Math.round(targetAmount * 100) / 100;
}
