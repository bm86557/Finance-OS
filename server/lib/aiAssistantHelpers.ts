/**
 * AI Assistant Helper Functions
 * Production-ready utilities for AI operations with proper error handling
 */

import type { FinancialPattern } from '../../src/services/aiAssistantService.js';

export interface MetricTrend {
  current: number;
  previous: number;
  percentageChange: number;
  direction: 'up' | 'down' | 'stable';
}

/**
 * Calculate trend between current and previous values
 */
export function calculateTrend(current: number, previous: number): MetricTrend {
  const percentageChange = previous !== 0 
    ? ((current - previous) / Math.abs(previous)) * 100 
    : 0;
  
  let direction: 'up' | 'down' | 'stable' = 'stable';
  if (Math.abs(percentageChange) < 2) {
    direction = 'stable';
  } else if (percentageChange > 0) {
    direction = 'up';
  } else {
    direction = 'down';
  }

  return {
    current,
    previous,
    percentageChange: Math.round(percentageChange * 10) / 10,
    direction,
  };
}

/**
 * Detect anomalies in time series data
 */
export function detectAnomalies(
  values: number[],
  threshold: number = 1.5
): number[] {
  if (values.length < 3) return [];

  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
  const stdDev = Math.sqrt(variance);

  const anomalyIndices: number[] = [];
  values.forEach((val, idx) => {
    const zScore = Math.abs((val - mean) / stdDev);
    if (zScore > threshold) {
      anomalyIndices.push(idx);
    }
  });

  return anomalyIndices;
}

/**
 * Identify recurring patterns in transaction data
 */
export function identifyRecurringPattern(
  dates: Date[],
  amounts: number[],
  description: string
): FinancialPattern | null {
  if (dates.length < 3) return null;

  // Calculate intervals between transactions
  const intervals: number[] = [];
  for (let i = 1; i < dates.length; i++) {
    const daysDiff = Math.abs(
      (dates[i].getTime() - dates[i - 1].getTime()) / (1000 * 60 * 60 * 24)
    );
    intervals.push(daysDiff);
  }

  const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  const variance = intervals.reduce((sum, val) => sum + Math.pow(val - avgInterval, 2), 0) / intervals.length;
  const coefficient = Math.sqrt(variance) / avgInterval; // Lower = more consistent

  // Determine frequency
  let frequency = 'irregular';
  if (coefficient < 0.3) {
    if (avgInterval >= 85 && avgInterval <= 95) frequency = 'quarterly';
    else if (avgInterval >= 25 && avgInterval <= 35) frequency = 'monthly';
    else if (avgInterval >= 12 && avgInterval <= 16) frequency = 'bi-weekly';
    else if (avgInterval >= 6 && avgInterval <= 8) frequency = 'weekly';
  }

  if (frequency === 'irregular') return null;

  // Determine trend
  const amountTrend = calculateTrend(
    amounts[amounts.length - 1],
    amounts[0]
  );

  return {
    id: `pattern-${description.toLowerCase().replace(/\s+/g, '-')}`,
    pattern: `Recurring: ${description}`,
    frequency,
    trend: amountTrend.direction === 'up' ? 'increasing' : 
           amountTrend.direction === 'down' ? 'decreasing' : 'stable',
    suggestion: `This ${frequency} ${description.toLowerCase()} is ${amountTrend.direction === 'stable' ? 'consistent' : amountTrend.direction}. ${
      amountTrend.direction === 'up' 
        ? 'Consider if this increase is sustainable.' 
        : 'Good stability in recurring costs.'
    }`,
  };
}

/**
 * Sanitize financial data for AI prompts (remove sensitive info)
 */
export function sanitizeForPrompt(text: string): string {
  // Remove potential account numbers (sequences of 10+ digits)
  let sanitized = text.replace(/\b\d{10,}\b/g, '[ACCOUNT]');
  
  // Remove email addresses
  sanitized = sanitized.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, '[EMAIL]');
  
  // Remove potential credit card numbers (4 groups of 4 digits)
  sanitized = sanitized.replace(/\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, '[CARD]');
  
  // Remove phone numbers
  sanitized = sanitized.replace(/\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g, '[PHONE]');
  
  return sanitized;
}

/**
 * Calculate confidence score for projections based on data quality
 */
export function calculateProjectionConfidence(params: {
  dataPoints: number;
  timeSpanMonths: number;
  trendConsistency: number; // 0-1, higher = more consistent
  projectionMonths: number;
}): number {
  const { dataPoints, timeSpanMonths, trendConsistency, projectionMonths } = params;

  // Base confidence from data quantity
  let confidence = Math.min(90, 40 + dataPoints * 2);

  // Adjust for time span (more history = more confidence)
  if (timeSpanMonths >= 12) confidence += 10;
  else if (timeSpanMonths >= 6) confidence += 5;
  else confidence -= 10;

  // Adjust for trend consistency
  confidence += trendConsistency * 15;

  // Reduce confidence for longer projections
  confidence -= projectionMonths * 1.5;

  // Ensure bounds
  return Math.max(30, Math.min(95, Math.round(confidence)));
}

/**
 * Format large numbers for display
 */
export function formatMetricValue(value: number, decimals: number = 1): string {
  if (Math.abs(value) >= 1_000_000_000) {
    return `${(value / 1_000_000_000).toFixed(decimals)}B`;
  } else if (Math.abs(value) >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(decimals)}M`;
  } else if (Math.abs(value) >= 1_000) {
    return `${(value / 1_000).toFixed(decimals)}K`;
  }
  return value.toFixed(decimals);
}

/**
 * Validate AI response for safety and quality
 */
export function validateAIResponse(response: string): {
  valid: boolean;
  sanitized: string;
  warnings: string[];
} {
  const warnings: string[] = [];
  let sanitized = response.trim();

  // Check length
  if (sanitized.length === 0) {
    return { valid: false, sanitized, warnings: ['Empty response'] };
  }
  
  if (sanitized.length > 5000) {
    warnings.push('Response truncated');
    sanitized = sanitized.slice(0, 5000) + '...';
  }

  // Check for potential hallucinated data
  const hasSpecificNumbers = /\$?\d{1,3}(,\d{3})*(\.\d{2})?/.test(sanitized);
  if (!hasSpecificNumbers && sanitized.length > 100) {
    warnings.push('Response may lack specific data references');
  }

  // Remove markdown if present (frontend handles formatting)
  sanitized = sanitized.replace(/```[\s\S]*?```/g, '');
  sanitized = sanitized.replace(/`([^`]+)`/g, '$1');

  return { valid: true, sanitized, warnings };
}

/**
 * Generate context-aware follow-up suggestions
 */
export function generateFollowUpSuggestions(
  userMessage: string,
  financialContext: {
    hasLowMargin?: boolean;
    hasLowRunway?: boolean;
    hasHighDrawings?: boolean;
    hasRevenueGrowth?: boolean;
  }
): string[] {
  const suggestions: string[] = [];
  const lower = userMessage.toLowerCase();

  // Context-based suggestions
  if (lower.includes('expense') || lower.includes('spending')) {
    suggestions.push('Which expense categories can I reduce?');
    suggestions.push('Show me spending trends over time');
  } else if (lower.includes('revenue') || lower.includes('income')) {
    suggestions.push('Which projects are most profitable?');
    suggestions.push('How can I increase revenue?');
  } else if (lower.includes('cash') || lower.includes('runway')) {
    suggestions.push('What are my upcoming obligations?');
    suggestions.push('How can I extend my runway?');
  } else if (lower.includes('profit') || lower.includes('margin')) {
    suggestions.push('Compare margins across projects');
    suggestions.push('What\'s impacting my profitability?');
  }

  // Add context-driven suggestions
  if (financialContext.hasLowMargin) {
    suggestions.push('Why is my profit margin low?');
  }
  if (financialContext.hasLowRunway) {
    suggestions.push('How can I improve cash flow?');
  }
  if (financialContext.hasHighDrawings) {
    suggestions.push('Are my personal drawings too high?');
  }

  // Generic fallbacks
  if (suggestions.length === 0) {
    suggestions.push('Show me my financial summary');
    suggestions.push('What should I focus on this month?');
    suggestions.push('Any concerning trends?');
  }

  return suggestions.slice(0, 3);
}

/**
 * Rate limit checker (simple in-memory implementation)
 */
const rateLimitStore = new Map<string, { count: number; resetTime: number }>();

export function checkRateLimit(
  key: string,
  maxRequests: number = 100,
  windowMs: number = 15 * 60 * 1000 // 15 minutes
): { allowed: boolean; remaining: number; resetIn: number } {
  const now = Date.now();
  const record = rateLimitStore.get(key);

  if (!record || now > record.resetTime) {
    // New window
    rateLimitStore.set(key, { count: 1, resetTime: now + windowMs });
    return { allowed: true, remaining: maxRequests - 1, resetIn: windowMs };
  }

  if (record.count >= maxRequests) {
    // Rate limit exceeded
    return { 
      allowed: false, 
      remaining: 0, 
      resetIn: record.resetTime - now 
    };
  }

  // Increment count
  record.count++;
  return { 
    allowed: true, 
    remaining: maxRequests - record.count, 
    resetIn: record.resetTime - now 
  };
}

/**
 * Clean up old rate limit entries (call periodically)
 */
export function cleanupRateLimits(): void {
  const now = Date.now();
  for (const [key, record] of rateLimitStore.entries()) {
    if (now > record.resetTime) {
      rateLimitStore.delete(key);
    }
  }
}

// Auto-cleanup every 10 minutes
setInterval(cleanupRateLimits, 10 * 60 * 1000);
