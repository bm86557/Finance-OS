/**
 * Currency & FX Conversion Utilities
 * ===================================
 * Handles multi-currency conversions and rate estimations across
 * transactions, bank accounts, and financial reports.
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

export const CURRENCY_SYMBOLS: Record<string, string> = {
  PKR: '₨',
  USD: '$',
  EUR: '€',
  GBP: '£',
  AED: 'د.إ',
  CAD: 'CA$',
  AUD: 'A$',
  SGD: 'S$',
  SAR: '﷼',
  INR: '₹',
  JPY: '¥',
  CNY: '¥',
};

export const CURRENCY_NAMES: Record<string, string> = {
  PKR: 'Pakistani Rupee',
  USD: 'US Dollar',
  EUR: 'Euro',
  GBP: 'British Pound',
  AED: 'UAE Dirham',
  CAD: 'Canadian Dollar',
  AUD: 'Australian Dollar',
  SGD: 'Singapore Dollar',
  SAR: 'Saudi Riyal',
  INR: 'Indian Rupee',
  JPY: 'Japanese Yen',
  CNY: 'Chinese Yuan',
};

let enabledCurrencyCodes: string[] = ['PKR', 'USD', 'EUR', 'GBP', 'AED', 'CAD', 'AUD', 'SGD'];
let multiCurrencyAutoConvert = true;

export function syncPlatformCurrencies(
  currencies: Array<{ code: string; name?: string; symbol?: string; enabled: boolean; rateToUsd?: number }>,
  autoConvert = true
): void {
  if (Array.isArray(currencies) && currencies.length > 0) {
    const nextEnabled: string[] = [];
    for (const c of currencies) {
      if (!c?.code) continue;
      const code = c.code.toUpperCase().trim();
      if (c.symbol) CURRENCY_SYMBOLS[code] = c.symbol;
      if (c.name) CURRENCY_NAMES[code] = c.name;
      if (Number.isFinite(Number(c.rateToUsd)) && Number(c.rateToUsd) > 0) {
        DEFAULT_RATES_TO_USD[code] = Number(c.rateToUsd);
      }
      if (c.enabled) {
        nextEnabled.push(code);
      }
    }
    if (nextEnabled.length > 0) {
      enabledCurrencyCodes = nextEnabled;
    }
  }
  multiCurrencyAutoConvert = Boolean(autoConvert);
}

export function getEnabledPlatformCurrencies(includeCurrency?: string): string[] {
  if (includeCurrency) {
    const clean = includeCurrency.toUpperCase().trim();
    if (clean && !enabledCurrencyCodes.includes(clean)) {
      return [clean, ...enabledCurrencyCodes];
    }
  }
  return [...enabledCurrencyCodes];
}

export function isMultiCurrencyAutoConvertEnabled(): boolean {
  return multiCurrencyAutoConvert;
}

/**
 * Returns estimated exchange rate from `fromCurrency` to `toCurrency`.
 * Example:
 *   getEstimatedFxRate('USD', 'PKR') => 280
 *   getEstimatedFxRate('PKR', 'USD') => 0.00357 (1/280)
 */
export function getEstimatedFxRate(fromCurrency: string, toCurrency: string): number {
  const from = (fromCurrency || 'USD').toUpperCase().trim();
  const to = (toCurrency || 'USD').toUpperCase().trim();
  if (from === to) return 1;
  if (!multiCurrencyAutoConvert) return 1;

  const fromToUsd = DEFAULT_RATES_TO_USD[from] ?? 1;
  const toToUsd = DEFAULT_RATES_TO_USD[to] ?? 1;

  return fromToUsd / toToUsd;
}

/**
 * Converts `amount` from `fromCurrency` to `toCurrency`.
 * Handles custom FX rates when provided.
 */
export function convertCurrency(
  amount: number,
  fromCurrency: string,
  toCurrency: string,
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

  if (!multiCurrencyAutoConvert) {
    return Math.round(amount * 100) / 100;
  }

  const rate = getEstimatedFxRate(from, to);
  return Math.round(amount * rate * 100) / 100;
}
