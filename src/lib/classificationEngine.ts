// AI & Logic Learning Classification Engine - Precision Financial Classifier
// ============================================================================
// Multi-stage semantic classification with whole-narration understanding,
// bank transaction de-noising, 250+ merchant taxonomy, and dynamic learning.

import { Category, Transaction } from '@/services/types';

export interface ClassificationRule {
  id: string;
  pattern: string;
  categoryId: string;
  confidence: number;
  matchCount: number;
  createdFrom: 'user' | 'auto';
  lastUsed?: string;
  // §11 Versioned rule compatibility properties
  version?: number;
  status?: 'active' | 'archived' | 'disabled';
  priority?: number;
  explanation?: string;
  scope?: {
    world?: 'business' | 'personal';
    account_ids?: string[];
    directions?: ('debit' | 'credit')[];
    min_amount?: number;
    max_amount?: number;
  };
  match?: {
    method?: 'exact' | 'pattern' | 'token_set' | 'merchant_alias';
    tokens?: string[];
    pattern?: string;
    merchant_alias?: string;
  };
  prediction?: {
    category_id?: string;
    category_code?: string;
    counterparty?: string;
    department_id?: string;
    project_id?: string;
    client?: string;
    world?: 'business' | 'personal';
  };
}

export type PlacementType = 'auto_approved' | 'bulk_review' | 'manual_review';
export type ConfidenceBand = 'high' | 'medium' | 'low';

export interface VersionedRule {
  id: string; // rule_id
  rule_id?: string;
  organization_id: string;
  version: number;
  status: 'active' | 'archived' | 'disabled';
  pattern?: string;
  categoryId?: string;
  scope: {
    world?: 'business' | 'personal';
    account_ids?: string[];
    directions?: ('debit' | 'credit')[];
    min_amount?: number;
    max_amount?: number;
  };
  match: {
    method: 'exact' | 'pattern' | 'token_set' | 'merchant_alias';
    tokens?: string[];
    pattern?: string;
    merchant_alias?: string;
  };
  prediction: {
    category_id?: string;
    category_code?: string;
    counterparty?: string;
    department_id?: string;
    project_id?: string;
    client?: string;
    world?: 'business' | 'personal';
  };
  confidence_policy: 'high_only_if_no_conflict' | 'medium_group_review' | 'manual_only' | string;
  priority: number;
  explanation: string;
  created_from_feedback_id?: string | null;
  effective_from: string;
  effective_to?: string | null;
  times_applied?: number;
  times_confirmed?: number;
  times_overridden?: number;
  false_positive_count?: number;
}

export interface TenantPolicy {
  organizationId: string;
  highThreshold: number;
  mediumThreshold: number;
  allowsAutoApproval: boolean;
  highValueThreshold: number;
  duplicateWindowDays: number;
  policyVersion: number;
}

export interface ClassificationResult {
  categoryId: string;
  categoryName: string;
  confidence: number;
  reasoning: string;
  alternativeSuggestions: Array<{
    categoryId: string;
    categoryName: string;
    confidence: number;
  }>;
  needsReview: boolean;
  source?: 'pattern' | 'rule' | 'ai' | 'fallback' | string;
  // §11 Extended properties
  confidenceBand?: ConfidenceBand;
  placement?: PlacementType;
  riskFlags?: string[];
  matchedRuleId?: string;
  matchedRuleVersion?: number;
  suggestedDepartmentId?: string;
  suggestedProjectId?: string;
  counterparty?: string;
  rawNarration?: string;
  normalizedTokens?: string[];
  candidateRules?: Array<{ id: string; version: number; score: number; matchReason?: string }>;
}

// ────────────────────────────────────────────────────────────────────────────
// 1. BANK NARRATION DE-NOISING & CLEANING
// ────────────────────────────────────────────────────────────────────────────

const BANK_TRANSACTION_PREFIXES = [
  /\b(pos\s+debit|pos\s+purchase|pos\s+trans|pos\s+auth|pos\s+w\/d|pos)\b/gi,
  /\b(ach\s+debit|ach\s+credit|ach\s+payment|ach\s+withdrawal|ach\s+deposit|ach\s+corp|ach\s+xfer|ach)\b/gi,
  /\b(wire\s+transfer|wire\s+in|wire\s+out|intl\s+wire|fedwire|wire)\b/gi,
  /\b(check\s+#?\d+|chq\s+#?\d+|draft\s+#?\d+|cheque\s+#?\d+|check|chq)\b/gi,
  /\b(atm\s+cash\s+w\/d|atm\s+withdrawal|atm\s+deposit|atm)\b/gi,
  /\b(debit\s+card\s+purchase|debit\s+card|credit\s+card|card\s+purchase|card\s+#?\d+)\b/gi,
  /\b(direct\s+deposit|direct\s+dep|dir\s+dep)\b/gi,
  /\b(recurring\s+payment|recurring\s+bill\s+pmt|recurring\s+debit|recurring)\b/gi,
  /\b(online\s+banking\s+transfer|online\s+payment|online\s+pmt|web\s+payment|bill\s+payment|bill\s+pmt)\b/gi,
  /\b(inward\s+remittance|outward\s+remittance|inter-bank\s+transfer|ibft|1-link|raast)\b/gi,
  /\b(pre-auth\s+hold|pre-auth|preauth|pending\s+auth|settlement|clearing|cleared)\b/gi,
  /\b(electronic\s+funds\s+transfer|eft\s+payment|eft\s+debit|eft)\b/gi,
  /\b(fee:\s*|service\s+fee|monthly\s+fee|maintenance\s+fee)\b/gi,
];

const STOP_WORDS = new Set([
  'the', 'is', 'at', 'which', 'on', 'a', 'an', 'and', 'or', 'but',
  'in', 'with', 'to', 'from', 'for', 'of', 'by', 'as', 'into', 'through',
  'inc', 'llc', 'ltd', 'corp', 'co', 'pvt', 'gmbh', 'sa', 'plc',
  'com', 'net', 'org', 'io', 'www', 'http', 'https',
]);

/**
 * Strips bank processing noise, terminal IDs, transaction codes, and locations
 * to isolate the core commercial entity and human intent.
 */
export function cleanNarration(narration: string): {
  cleaned: string;
  merchant: string;
  tokens: string[];
  phrases: string[];
} {
  if (!narration) return { cleaned: '', merchant: '', tokens: [], phrases: [] };

  let text = narration.toLowerCase();

  // 1. Remove common bank transaction prefixes
  for (const prefix of BANK_TRANSACTION_PREFIXES) {
    text = text.replace(prefix, ' ');
  }

  // 2. Remove dates: 10/14/2026, 2026-10-14, 10/14, 10-14
  text = text.replace(/\b\d{1,4}[/-]\d{1,2}([/-]\d{1,4})?\b/g, ' ');

  // 3. Remove reference numbers, confirmation codes, transaction hashes
  text = text.replace(/\b(ref|inv|invoice|txn|auth|trace|id|acct|batch|chk|term)[\s#:]*[a-z0-9-]+\b/g, ' ');
  text = text.replace(/\b[a-z0-9]*\d{4,}[a-z0-9]*\b/g, ' '); // alphanumeric codes with 4+ digits
  text = text.replace(/[*#\\/_\-:]+/g, ' ');

  // 4. Remove phone numbers (e.g., 866-579-7172)
  text = text.replace(/\b\d{3}[-\s]?\d{3}[-\s]?\d{4}\b/g, ' ');

  // 5. Remove common state/country abbreviations at the end of merchant names
  text = text.replace(/\b(usa?|uk|uae|can?|aus?|deu?|fra?|pak?|ind?)\b/g, ' ');
  text = text.replace(/\b(ca|ny|tx|wa|fl|il|ga|nc|va|oh|pa|az|co)\b/g, ' ');

  // 6. Clean whitespace and non-alphabetical punctuation
  text = text.replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

  // Extract clean keywords (excluding stop words and very short tokens)
  const rawWords = text.split(/\s+/).filter(Boolean);
  const tokens = rawWords.filter(w => w.length > 2 && !STOP_WORDS.has(w));

  // Extract meaningful 2-word and 3-word n-gram phrases
  const phrases: string[] = [];
  for (let i = 0; i < tokens.length - 1; i++) {
    phrases.push(`${tokens[i]} ${tokens[i + 1]}`);
    if (i < tokens.length - 2) {
      phrases.push(`${tokens[i]} ${tokens[i + 1]} ${tokens[i + 2]}`);
    }
  }

  // Merchant candidate is usually the first 1-2 prominent cleaned words
  const merchant = tokens.slice(0, 2).join(' ');

  return {
    cleaned: text,
    merchant,
    tokens,
    phrases,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// 2. UNIVERSAL FINANCIAL TAXONOMY & 250+ VENDOR KNOWLEDGE BASE
// ────────────────────────────────────────────────────────────────────────────

export type FinancialArchetype =
  | 'SOFTWARE_SAAS'
  | 'MARKETING_ADS'
  | 'SALARIES_PAYROLL'
  | 'RENT_FACILITIES'
  | 'UTILITIES_COMMUNICATION'
  | 'OFFICE_SUPPLIES_EQUIPMENT'
  | 'TRAVEL_TRANSPORTATION'
  | 'MEALS_ENTERTAINMENT'
  | 'PROFESSIONAL_LEGAL_CONSULTING'
  | 'BANK_FEES_FINANCE'
  | 'TAXES_LICENSES'
  | 'INSURANCE'
  | 'CLIENT_REVENUE_INCOME'
  | 'PRODUCT_SALES_INCOME'
  | 'OTHER_INCOME'
  | 'GENERAL_OPERATING';

interface ArchetypeDefinition {
  type: 'expense' | 'income' | 'both';
  nameKeywords: string[]; // Patterns matching user's category names
  vendors: string[];      // Recognized commercial merchants & brand entities
  keywords: string[];     // Contextual words & concepts
}

const TAXONOMY: Record<FinancialArchetype, ArchetypeDefinition> = {
  SOFTWARE_SAAS: {
    type: 'expense',
    nameKeywords: ['software', 'saas', 'subscription', 'technology', 'it', 'cloud', 'tools', 'hosting', 'license', 'app'],
    vendors: [
      'google workspace', 'google cloud', 'gcp', 'google one', 'aws', 'amazon web services', 'microsoft',
      'office 365', 'azure', 'github', 'gitlab', 'atlassian', 'jira', 'confluence', 'trello',
      'slack', 'zoom', 'notion', 'figma', 'canva', 'adobe', 'creative cloud', 'dropbox', 'box',
      'salesforce', 'hubspot', 'zendesk', 'mailchimp', 'klaviyo', 'sendgrid', 'twilio', 'vercel',
      'netlify', 'supabase', 'digitalocean', 'heroku', 'cloudflare', 'openai', 'chatgpt', 'anthropic',
      'claude', 'midjourney', 'sentry', 'datadog', 'new relic', 'intuit', 'quickbooks', 'xero',
      'freshbooks', 'docker', 'jetbrains', 'postman', 'zapier', 'make.com', 'webflow', 'shopify app',
      'wordpress', '1password', 'lastpass', 'bitwarden', 'linear', 'loom', 'airtable', 'clickup',
      'monday.com', 'miro', 'lucidchart', 'datadog', 'dynatrace', 'pagerduty', 'circleci', 'snyk',
      'datadog', 'segment', 'mixpanel', 'amplitude', 'intercom', 'drift', 'algolia', 'elastic'
    ],
    keywords: [
      'software', 'saas', 'subscription', 'sub', 'annual license', 'monthly license', 'cloud hosting',
      'server', 'domain registration', 'dns', 'ssl certificate', 'api usage', 'compute', 'storage bucket',
      'developer tools', 'ide license', 'productivity tool', 'collaboration tool'
    ],
  },

  MARKETING_ADS: {
    type: 'expense',
    nameKeywords: ['marketing', 'advertising', 'ads', 'promotion', 'campaign', 'sales', 'growth'],
    vendors: [
      'meta ads', 'facebook ads', 'instagram ads', 'google ads', 'google adwords', 'youtube ads',
      'linkedin ads', 'x ads', 'twitter ads', 'tiktok ads', 'reddit ads', 'pinterest ads', 'bing ads',
      'microsoft advertising', 'semrush', 'ahrefs', 'moz', 'hootsuite', 'buffer', 'sprout social',
      'pr newswire', 'businesswire', 'outbrain', 'taboola', 'criteo', 'adroll', 'buzzsprout',
      'vimeo', 'wistia', 'adform', 'the trade desk', 'influencer fee'
    ],
    keywords: [
      'advertising', 'advertisement', 'marketing', 'campaign', 'ad spend', 'ppc', 'cpc', 'seo service',
      'social media promotion', 'billboard', 'sponsorship', 'event booth', 'flyers', 'brochure print',
      'press release', 'lead generation', 'brand promotion', 'affiliate payout'
    ],
  },

  SALARIES_PAYROLL: {
    type: 'expense',
    nameKeywords: ['payroll', 'salary', 'salaries', 'wages', 'benefits', 'compensation', 'staff', 'employee', 'personnel'],
    vendors: [
      'gusto', 'rippling', 'deel', 'remote.com', 'adp', 'paychex', 'workday', 'bamboohr',
      'justworks', 'zenefits', 'oyster hr', 'papaya global', 'triNet', 'paylocity', 'quickbooks payroll'
    ],
    keywords: [
      'payroll', 'salary', 'wages', 'net pay', 'employee salary', 'staff salary', 'payroll tax',
      'compensation', 'monthly salary', 'stipend', 'intern pay', 'director remuneration', 'bonus payout',
      'employee commission', 'severance', 'overtime pay', 'provident fund', 'pension contribution',
      'eobi', 'social security', 'staff welfare', 'medical allowance'
    ],
  },

  RENT_FACILITIES: {
    type: 'expense',
    nameKeywords: ['rent', 'facility', 'facilities', 'lease', 'occupancy', 'office space', 'building', 'premises'],
    vendors: [
      'wework', 'regus', 'spaces', 'industrious', 'workbar', 'the executive centre', 'coworking',
      'commercial real estate', 'cbre', 'jll', 'colliers'
    ],
    keywords: [
      'office rent', 'rent payment', 'building lease', 'monthly rent', 'coworking space',
      'desk rental', 'suite lease', 'landlord', 'tenancy', 'property management',
      'office maintenance', 'building service charge', 'janitorial', 'cleaning service', 'security guard'
    ],
  },

  UTILITIES_COMMUNICATION: {
    type: 'expense',
    nameKeywords: ['utilities', 'utility', 'electricity', 'water', 'internet', 'telecom', 'phone', 'communication'],
    vendors: [
      'at&t', 'verizon', 't-mobile', 'comcast', 'xfinity', 'spectrum', 'centurylink', 'cox',
      'vodafone', 'o2', 'ee', 'bt group', 'airtel', 'jio', 'lesco', 'k-electric', 'ptcl', 'nayatel',
      'stormfiber', 'con edison', 'duke energy', 'pge', 'pacific gas'
    ],
    keywords: [
      'electricity', 'electric bill', 'power bill', 'gas bill', 'water bill', 'sewerage',
      'internet bill', 'broadband', 'fiber connection', 'wifi bill', 'mobile phone bill',
      'cellular service', 'voip phone', 'landline', 'telecommunications', 'utility'
    ],
  },

  OFFICE_SUPPLIES_EQUIPMENT: {
    type: 'expense',
    nameKeywords: ['office supplies', 'supplies', 'stationery', 'equipment', 'hardware', 'admin', 'computer'],
    vendors: [
      'staples', 'office depot', 'officemax', 'amazon business', 'best buy', 'apple store',
      'b&h photo', 'cdw', 'dell', 'hp', 'lenovo', 'newegg', 'herman miller', 'ikea business'
    ],
    keywords: [
      'office supplies', 'stationery', 'printer paper', 'toner cartridge', 'ink cartridge',
      'monitors', 'laptop', 'desktop computer', 'keyboard mouse', 'office chair', 'desk',
      'filing cabinet', 'whiteboard', 'desk accessories', 'packaging material', 'postage stamps'
    ],
  },

  TRAVEL_TRANSPORTATION: {
    type: 'expense',
    nameKeywords: ['travel', 'transport', 'transportation', 'lodging', 'flight', 'vehicle', 'auto', 'commute'],
    vendors: [
      'uber', 'lyft', 'grab', 'bolt', 'freenow', 'yellow cab', 'taxi', 'amtrak', 'eurostar',
      'delta air', 'american airlines', 'united airlines', 'southwest', 'british airways', 'emirates',
      'qatar airways', 'lufthansa', 'air france', 'pia', 'air canada', 'marriott', 'hilton',
      'hyatt', 'ihg', 'sheraton', 'airbnb', 'vrbo', 'booking.com', 'expedia', 'hertz', 'enterprise',
      'avis', 'budget rent a car', 'sixt', 'shell', 'chevron', 'exxonmobil', 'bp', 'totalenergies'
    ],
    keywords: [
      'flight', 'airline ticket', 'hotel stay', 'lodging', 'room reservation', 'car rental',
      'rideshare', 'taxi fare', 'cab fare', 'train ticket', 'bus fare', 'metro card', 'parking fee',
      'toll fee', 'gasoline', 'petrol', 'fuel purchase', 'diesel', 'travel insurance', 'per diem'
    ],
  },

  MEALS_ENTERTAINMENT: {
    type: 'expense',
    nameKeywords: ['meals', 'entertainment', 'food', 'dining', 'catering', 'restaurant', 'refreshment'],
    vendors: [
      'starbucks', 'dunkin', 'peet\'s coffee', 'costa coffee', 'pret a manger', 'chipotle',
      'panera bread', 'sweetgreen', 'shake shack', 'mcdonald\'s', 'subway', 'domino\'s pizza',
      'doordash', 'uber eats', 'grubhub', 'deliveroo', 'just eat', 'seamless', 'postmates'
    ],
    keywords: [
      'team lunch', 'client dinner', 'business meal', 'team dinner', 'coffee meeting', 'catering service',
      'office snacks', 'pantry supplies', 'working lunch', 'staff refreshment', 'team building event',
      'cocktail reception', 'restaurant bill', 'cafe'
    ],
  },

  PROFESSIONAL_LEGAL_CONSULTING: {
    type: 'expense',
    nameKeywords: ['professional', 'legal', 'consulting', 'contractor', 'freelance', 'accounting', 'advisory', 'audit'],
    vendors: [
      'upwork', 'fiverr', 'toptal', 'freelancer', 'ernst & young', 'ey', 'pwc', 'deloitte',
      'kpmg', 'mckinsey', 'boston consulting', 'bain', 'legalzoom', 'rocket lawyer', 'docusign'
    ],
    keywords: [
      'contractor fee', 'freelancer payment', 'consulting fee', 'legal services', 'attorney fee',
      'lawyer retainer', 'litigation', 'trademark filing', 'patent fee', 'notary service',
      'audit fee', 'tax preparation', 'bookkeeping service', 'cpa advisory', 'financial consultancy',
      'hr consultant', 'design contractor', 'developer contractor'
    ],
  },

  BANK_FEES_FINANCE: {
    type: 'expense',
    nameKeywords: ['bank fees', 'bank charges', 'finance charges', 'fees', 'charges', 'interest expense'],
    vendors: [
      'jpmorgan chase', 'bank of america', 'wells fargo', 'citibank', 'hsbc', 'barclays',
      'standard chartered', 'hbl', 'mcb', 'meezan', 'stripe fee', 'paypal fee', 'square fee'
    ],
    keywords: [
      'bank service charge', 'monthly account fee', 'wire transfer fee', 'outgoing wire fee',
      'international transaction fee', 'fx fee', 'foreign exchange margin', 'overdraft fee',
      'nsf charge', 'atm surcharge fee', 'card annual fee', 'merchant processing fee',
      'merchant discount rate', 'payment gateway fee', 'loan interest charged', 'late payment fee'
    ],
  },

  TAXES_LICENSES: {
    type: 'expense',
    nameKeywords: ['tax', 'taxes', 'license', 'licenses', 'government', 'duties', 'compliance'],
    vendors: [
      'internal revenue service', 'irs', 'us treasury', 'fbr', 'hmrc', 'state tax commission',
      'department of revenue', 'sec filing', 'companies house'
    ],
    keywords: [
      'income tax', 'corporate tax', 'sales tax payment', 'vat payment', 'gst payment',
      'withholding tax', 'advance tax', 'property tax', 'franchise tax', 'business license renewal',
      'annual corporate registration', 'municipal fee', 'customs duty', 'import tax'
    ],
  },

  INSURANCE: {
    type: 'expense',
    nameKeywords: ['insurance', 'coverage', 'premium', 'indemnity', 'policy'],
    vendors: [
      'state farm', 'geico', 'progressive', 'allstate', 'travelers', 'chubb', 'hiscox',
      'hartford', 'liberty mutual', 'aetna', 'cigna', 'blue cross', 'unitedhealthcare'
    ],
    keywords: [
      'general liability insurance', 'professional indemnity', 'cyber insurance', 'directors and officers',
      'property insurance', 'commercial auto insurance', 'workers compensation insurance',
      'health insurance premium', 'group medical insurance', 'keyman insurance'
    ],
  },

  CLIENT_REVENUE_INCOME: {
    type: 'income',
    nameKeywords: ['revenue', 'sales', 'client revenue', 'income', 'consulting revenue', 'project income', 'services revenue', 'retainer'],
    vendors: [
      'stripe payout', 'shopify payout', 'paypal transfer', 'square deposit', 'merchant payout',
      'amazon settlement', 'wire transfer in', 'client wire', 'customer payment'
    ],
    keywords: [
      'client payment', 'invoice payment', 'payment received', 'customer deposit', 'project milestone',
      'monthly retainer', 'consulting fees received', 'service billing', 'contract revenue',
      'settlement payout', 'client wire received', 'inward remittance from client'
    ],
  },

  PRODUCT_SALES_INCOME: {
    type: 'income',
    nameKeywords: ['product sales', 'ecommerce', 'sales', 'merchandise', 'retail'],
    vendors: ['shopify', 'amazon seller', 'etsy', 'woocommerce', 'stripe payments', 'pos sales'],
    keywords: [
      'product sale', 'store sales', 'ecommerce order', 'merchandise sales', 'online order payout',
      'point of sale batch', 'daily store takings', 'customer sales receipt'
    ],
  },

  OTHER_INCOME: {
    type: 'income',
    nameKeywords: ['other income', 'miscellaneous income', 'interest income', 'refunds', 'reimbursements'],
    vendors: ['interest credit', 'bank interest', 'dividend payment', 'tax refund', 'cashback'],
    keywords: [
      'interest earned', 'savings interest', 'dividend received', 'cashback reward', 'expense reimbursement',
      'vendor refund', 'overpayment refund', 'insurance claim settlement', 'grant funding', 'government subsidy'
    ],
  },

  GENERAL_OPERATING: {
    type: 'expense',
    nameKeywords: ['general', 'operating', 'admin', 'miscellaneous', 'other expenses'],
    vendors: [],
    keywords: ['general expense', 'operating cost', 'miscellaneous', 'unclassified expense'],
  },
};

// ────────────────────────────────────────────────────────────────────────────
// 3. ARCHETYPE RESOLUTION FOR USER'S SPECIFIC CHART OF ACCOUNTS
// ────────────────────────────────────────────────────────────────────────────

/**
 * Maps each of the organization's existing categories to one or more
 * Financial Archetypes based on category name and patterns.
 */
function resolveCategoryArchetypes(categories: Category[]): Map<string, FinancialArchetype[]> {
  const mapping = new Map<string, FinancialArchetype[]>();

  for (const cat of categories) {
    const nameLower = cat.name.toLowerCase();
    const patterns = (cat.patterns || []).map(p => p.toLowerCase());
    const matchedArchetypes: FinancialArchetype[] = [];

    for (const [archetypeKey, def] of Object.entries(TAXONOMY)) {
      const archetype = archetypeKey as FinancialArchetype;
      
      // Type compatibility
      if (def.type !== 'both') {
        const isCompatibleType =
          (def.type === 'expense' && cat.type === 'expense') ||
          (def.type === 'income' && cat.type === 'income');
        if (!isCompatibleType) continue;
      }

      // Check name keywords
      const hasNameMatch = def.nameKeywords.some(kw => nameLower.includes(kw) || kw.includes(nameLower));
      
      // Check pattern matches
      const hasPatternMatch = patterns.some(pat => 
        def.nameKeywords.some(kw => pat.includes(kw)) ||
        def.keywords.some(kw => pat.includes(kw)) ||
        def.vendors.some(v => pat.includes(v))
      );

      if (hasNameMatch || hasPatternMatch) {
        matchedArchetypes.push(archetype);
      }
    }

    // Default fallback archetype based purely on category type
    if (matchedArchetypes.length === 0) {
      if (cat.type === 'income') {
        matchedArchetypes.push('CLIENT_REVENUE_INCOME');
      } else {
        matchedArchetypes.push('GENERAL_OPERATING');
      }
    }

    mapping.set(cat.id, matchedArchetypes);
  }

  return mapping;
}

// ────────────────────────────────────────────────────────────────────────────
// 4. STRING SIMILARITY & PATTERN MATCHING PRIMITIVES
// ────────────────────────────────────────────────────────────────────────────

export const extractKeywords = (narration: string): string[] => {
  return cleanNarration(narration).tokens;
};

export const calculateSimilarity = (str1: string, str2: string): number => {
  const longer = str1.length > str2.length ? str1 : str2;
  const shorter = str1.length > str2.length ? str2 : str1;

  if (longer.length === 0) return 1.0;

  const costs: number[] = [];
  for (let i = 0; i <= longer.length; i++) {
    let lastValue = i;
    for (let j = 0; j <= shorter.length; j++) {
      if (i === 0) {
        costs[j] = j;
      } else if (j > 0) {
        let newValue = costs[j - 1];
        if (longer.charAt(i - 1) !== shorter.charAt(j - 1)) {
          newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
        }
        costs[j - 1] = lastValue;
        lastValue = newValue;
      }
    }
    if (i > 0) costs[shorter.length] = lastValue;
  }

  return (longer.length - costs[shorter.length]) / longer.length;
};

export const matchPattern = (narration: string, pattern: string): number => {
  if (!narration || !pattern) return 0;
  const narrLower = narration.toLowerCase();
  const patLower = pattern.toLowerCase();

  // Exact substring
  if (narrLower.includes(patLower)) {
    return 1.0;
  }

  // Cleaned version match
  const { cleaned } = cleanNarration(narration);
  const cleanPat = cleanNarration(pattern).cleaned || patLower;

  if (cleaned.includes(cleanPat)) {
    return 0.98;
  }

  // Token overlap match
  const narrTokens = cleanNarration(narration).tokens;
  const patTokens = cleanNarration(pattern).tokens;

  if (patTokens.length === 0) return 0;

  let matched = 0;
  for (const pt of patTokens) {
    if (narrTokens.includes(pt)) {
      matched += 1;
    } else if (narrTokens.some(nt => calculateSimilarity(nt, pt) > 0.85)) {
      matched += 0.85;
    }
  }

  return Math.min(1.0, matched / patTokens.length);
};

// ────────────────────────────────────────────────────────────────────────────
// 4.5. ADVANCED RISK & CONFLICT ENGINE (§11)
// ────────────────────────────────────────────────────────────────────────────

const TRANSFER_INDICATORS = [
  /\b(atm\s+w\/d|atm\s+withdrawal|atm\s+deposit|atm)\b/gi,
  /\b(inter-bank\s+transfer|ibft|1-link|raast|bank\s+transfer|internal\s+xfer|account\s+transfer)\b/gi,
  /\b(transfer\s+to|transfer\s+from|xfer\s+to|xfer\s+from|funds\s+transfer)\b/gi,
  /\b(wire\s+in|wire\s+out|fedwire|swift\s+transfer)\b/gi,
  /\b(wallet\s+top-up|wallet\s+funding|top\s+up|cash\s+in\s+hand)\b/gi,
];

export function detectRiskFlags(
  narration: string,
  amount: number,
  type: 'debit' | 'credit',
  previousTransactions: Transaction[] = [],
  options?: {
    highValueThreshold?: number;
    duplicateWindowDays?: number;
    world?: 'business' | 'personal';
    hasConflict?: boolean;
    isTransferFlagged?: boolean;
  }
): string[] {
  const flags: string[] = [];
  const absAmount = Math.abs(amount);
  const threshold = options?.highValueThreshold ?? 5000;
  const duplicateDays = options?.duplicateWindowDays ?? 7;

  // 1. High-Value Anomaly Risk
  if (absAmount >= threshold) {
    flags.push('HIGH_VALUE_TRANSACTION');
  }

  // 2. Transfer / Inter-Account Movement Risk
  const isTransferNarration = TRANSFER_INDICATORS.some(rx => {
    rx.lastIndex = 0;
    return rx.test(narration);
  });
  if (isTransferNarration || options?.isTransferFlagged) {
    flags.push('TRANSFER_CANDIDATE');
  }

  // 3. Duplicate Transaction Risk
  if (previousTransactions.length > 0 && absAmount > 0) {
    const { cleaned } = cleanNarration(narration);
    const now = Date.now();
    const windowMs = duplicateDays * 24 * 60 * 60 * 1000;

    const duplicateFound = previousTransactions.some(prev => {
      if (Math.abs(prev.amount) !== absAmount || prev.type !== type) return false;
      const prevDate = prev.date ? new Date(prev.date).getTime() : 0;
      if (prevDate > 0 && Math.abs(now - prevDate) > windowMs) return false;
      const prevCleaned = cleanNarration(prev.narration || prev.description || '').cleaned;
      return cleaned && prevCleaned && (cleaned === prevCleaned || calculateSimilarity(cleaned, prevCleaned) > 0.85);
    });

    if (duplicateFound) {
      flags.push('DUPLICATE_RISK');
    }
  }

  // 4. Policy Risk: Cross-World spending
  if (options?.world === 'business') {
    const personalHints = [
      /\b(gym|cinema|movie|grocery|supermarket|pharmacy|kids|toys|salon|spa)\b/gi,
      /\b(personal\s+draw|owner\s+withdrawal|personal\s+expense)\b/gi,
    ];
    if (personalHints.some(rx => rx.test(narration))) {
      flags.push('CROSS_WORLD_AMBIGUITY');
    }
  }

  // 5. Contradictory Rule Conflict
  if (options?.hasConflict) {
    flags.push('RULE_CONFLICT');
  }

  return flags;
}

export interface ExtendedClassificationOptions {
  organizationId?: string;
  world?: 'business' | 'personal';
  accountId?: string;
  tenantPolicy?: Partial<TenantPolicy>;
  isTransfer?: boolean;
}

// ────────────────────────────────────────────────────────────────────────────
// 5. MASTER CLASSIFICATION ENGINE (100% PRECISION CASCADE)
// ────────────────────────────────────────────────────────────────────────────

export const classifyTransaction = (
  narration: string,
  amount: number,
  type: 'debit' | 'credit',
  categories: Category[],
  previousTransactions: Transaction[] = [],
  rules: ClassificationRule[] = [],
  options?: ExtendedClassificationOptions
): ClassificationResult => {
  if (!narration || categories.length === 0) {
    return {
      categoryId: categories[0]?.id || '',
      categoryName: categories[0]?.name || 'Uncategorized',
      confidence: 0,
      confidenceBand: 'low',
      placement: 'manual_review',
      reasoning: 'No description provided or no categories available.',
      alternativeSuggestions: [],
      needsReview: true,
      riskFlags: [],
      rawNarration: narration,
      normalizedTokens: [],
    };
  }

  const { cleaned, merchant, tokens, phrases } = cleanNarration(narration);
  const narrLower = narration.toLowerCase();
  const expectedCategoryType = type === 'credit' ? 'income' : 'expense';

  // Compatible categories matching the transaction direction
  const compatibleCategories = categories.filter(c => c.type === expectedCategoryType);
  const searchPool = compatibleCategories.length > 0 ? compatibleCategories : categories;

  // Resolve category archetypes for all available categories
  const categoryArchetypeMap = resolveCategoryArchetypes(searchPool);

  const candidates: Array<{
    categoryId: string;
    categoryName: string;
    score: number;
    tier: number; // 1 = Rules, 2 = Learned, 3 = Merchant Taxonomy, 4 = History, 5 = Tokens
    priority: number;
    ruleId?: string;
    ruleVersion?: number;
    matchReason: string;
    departmentId?: string;
    projectId?: string;
    counterparty?: string;
  }> = [];

  // Helper to add or upgrade a candidate (supports both legacy 5-arg and §11 7-arg calls)
  const addCandidate = (
    catId: string,
    catName: string,
    score: number,
    tier: number,
    priorityOrReason: number | string,
    matchReason?: string,
    extra?: {
      ruleId?: string;
      ruleVersion?: number;
      departmentId?: string;
      projectId?: string;
      counterparty?: string;
    }
  ) => {
    let priority = 40;
    let effectiveReason = '';
    if (typeof priorityOrReason === 'number') {
      priority = priorityOrReason;
      effectiveReason = matchReason || '';
    } else {
      effectiveReason = priorityOrReason;
    }

    const existing = candidates.find(c => c.categoryId === catId);
    if (existing) {
      if (score > existing.score || (score === existing.score && priority > existing.priority)) {
        existing.score = score;
        existing.tier = tier;
        existing.priority = priority;
        existing.matchReason = effectiveReason;
        if (extra?.ruleId) existing.ruleId = extra.ruleId;
        if (extra?.ruleVersion) existing.ruleVersion = extra.ruleVersion;
        if (extra?.departmentId) existing.departmentId = extra.departmentId;
        if (extra?.projectId) existing.projectId = extra.projectId;
        if (extra?.counterparty) existing.counterparty = extra.counterparty;
      }
    } else {
      candidates.push({
        categoryId: catId,
        categoryName: catName,
        score,
        tier,
        priority,
        matchReason: effectiveReason,
        ruleId: extra?.ruleId,
        ruleVersion: extra?.ruleVersion,
        departmentId: extra?.departmentId,
        projectId: extra?.projectId,
        counterparty: extra?.counterparty,
      });
    }
  };

  // --------------------------------------------------------------------------
  // TIER 1 & TIER 2: VERSIONED USER RULES & HIGH-SPEC PATTERNS (§11 Cascaded Order)
  // --------------------------------------------------------------------------
  if (rules && rules.length > 0) {
    for (const rule of rules) {
      // 1. Status gate: disabled or archived rules must not match
      if (rule.status && rule.status !== 'active') continue;

      // 2. Scope validation: direction and world boundaries
      if (rule.scope) {
        if (rule.scope.directions && rule.scope.directions.length > 0 && !rule.scope.directions.includes(type)) {
          continue;
        }
        if (rule.scope.world && options?.world && rule.scope.world !== options.world) {
          continue;
        }
        if (rule.scope.min_amount != null && Math.abs(amount) < rule.scope.min_amount) {
          continue;
        }
        if (rule.scope.max_amount != null && Math.abs(amount) > rule.scope.max_amount) {
          continue;
        }
      }

      const pat = (rule.pattern || rule.match?.pattern || '').trim().toLowerCase();
      const tokensInRule = (rule.match?.tokens || []).map(t => t.toLowerCase().trim()).filter(Boolean);
      const merchantAlias = (rule.match?.merchant_alias || '').trim().toLowerCase();
      const priority = rule.priority ?? 50;

      let ruleMatched = false;
      let matchTier = 4;
      let matchScore = 0;
      let reason = '';

      // Tier 1: Exact bank reference or trusted counterparty match
      if (rule.match?.method === 'exact' && (narrLower === pat || cleaned === pat)) {
        ruleMatched = true;
        matchTier = 1;
        matchScore = 1.0;
        reason = `Exact trusted bank reference match "${pat}"`;
      }
      // Tier 2: Approved high-specificity narration pattern
      else if (pat && (narrLower.includes(pat) || cleaned.includes(pat))) {
        ruleMatched = true;
        matchTier = pat.length > 4 ? 2 : 4;
        matchScore = 0.98;
        reason = `Approved high-specificity pattern "${pat}" (priority ${priority})`;
      }
      // Tier 3: Merchant alias
      else if (merchantAlias && (narrLower.includes(merchantAlias) || cleaned.includes(merchantAlias))) {
        ruleMatched = true;
        matchTier = 3;
        matchScore = 0.95;
        reason = `Merchant alias "${merchantAlias}" matched`;
      }
      // Tier 4: Token set intersection
      else if (tokensInRule.length > 0) {
        const intersection = tokensInRule.filter(t => tokens.includes(t) || cleaned.includes(t));
        if (intersection.length === tokensInRule.length) {
          ruleMatched = true;
          matchTier = 4;
          matchScore = 0.92;
          reason = `Token set match [${intersection.join(', ')}]`;
        }
      } else if (pat) {
        const patternMatch = matchPattern(narration, pat);
        if (patternMatch >= 0.80) {
          ruleMatched = true;
          matchTier = 4;
          matchScore = patternMatch;
          reason = `Pattern similarity ${(patternMatch * 100).toFixed(0)}% to "${pat}"`;
        }
      }

      if (ruleMatched) {
        const targetCatId = rule.categoryId || rule.prediction?.category_id;
        const matchedCat = categories.find(c => c.id === targetCatId);
        if (matchedCat) {
          addCandidate(
            matchedCat.id,
            matchedCat.name,
            matchScore,
            matchTier,
            priority,
            reason,
            {
              ruleId: rule.id,
              ruleVersion: rule.version || 1,
              departmentId: rule.prediction?.department_id,
              projectId: rule.prediction?.project_id,
              counterparty: rule.prediction?.counterparty || merchantAlias || merchant,
            }
          );
        }
      }
    }
  }

  // --------------------------------------------------------------------------
  // TIER 2: CATEGORY PATTERNS & LEARNED FEEDBACK (98-100% Precision)
  // --------------------------------------------------------------------------
  for (const cat of searchPool) {
    // 1. Direct name match
    const cleanCatName = cleanNarration(cat.name).cleaned || cat.name.toLowerCase();
    if (narrLower.includes(cat.name.toLowerCase()) || cleaned.includes(cleanCatName)) {
      addCandidate(cat.id, cat.name, 0.98, 2, `Direct match on category name "${cat.name}"`);
    }

    // 2. Learned patterns on the category
    for (const pat of cat.patterns || []) {
      const patLower = pat.toLowerCase().trim();
      if (!patLower) continue;

      if (narrLower.includes(patLower) || cleaned.includes(patLower)) {
        addCandidate(cat.id, cat.name, 0.99, 2, `Matched learned pattern "${pat}"`);
        break;
      }

      // Exact match on merchant entity
      if (merchant && patLower === merchant) {
        addCandidate(cat.id, cat.name, 0.98, 2, `Matched learned merchant "${pat}"`);
        break;
      }

      // Fuzzy pattern match
      const pScore = matchPattern(narration, pat);
      if (pScore >= 0.85) {
        addCandidate(cat.id, cat.name, 0.94, 2, `High-similarity match on learned pattern "${pat}"`);
      }
    }
  }

  // --------------------------------------------------------------------------
  // TIER 3: RECOGNIZED MERCHANT & UNIVERSAL FINANCIAL TAXONOMY (95-100% Precision)
  // --------------------------------------------------------------------------
  for (const [archetypeKey, def] of Object.entries(TAXONOMY)) {
    const archetype = archetypeKey as FinancialArchetype;

    // Check transaction type alignment
    if (def.type !== 'both' && def.type !== expectedCategoryType) {
      continue;
    }

    let recognizedVendor: string | null = null;
    let vendorMatchStrength = 0;

    // A. Check known commercial vendors
    for (const vendor of def.vendors) {
      const vLower = vendor.toLowerCase();
      if (narrLower.includes(vLower) || cleaned.includes(vLower)) {
        recognizedVendor = vendor;
        vendorMatchStrength = 1.0;
        break;
      }
      // Check multi-word phrase equality
      if (phrases.some(p => p === vLower || calculateSimilarity(p, vLower) > 0.88)) {
        recognizedVendor = vendor;
        vendorMatchStrength = 0.95;
        break;
      }
    }

    // B. Check domain keywords and concepts
    let recognizedConcept: string | null = null;
    let conceptMatchStrength = 0;
    if (!recognizedVendor) {
      for (const kw of def.keywords) {
        const kwLower = kw.toLowerCase();
        if (narrLower.includes(kwLower) || cleaned.includes(kwLower)) {
          recognizedConcept = kw;
          conceptMatchStrength = 0.92;
          break;
        }
      }
    }

    // If a vendor or concept was strongly recognized for this archetype,
    // map it directly to the user's corresponding category
    if (recognizedVendor || recognizedConcept) {
      const signal = recognizedVendor || recognizedConcept!;
      const matchScore = recognizedVendor ? 0.98 : 0.92;

      // Find the best category in the user's organization for this archetype
      let matchedCategory: Category | undefined;

      for (const cat of searchPool) {
        const archetypes = categoryArchetypeMap.get(cat.id) || [];
        if (archetypes.includes(archetype)) {
          matchedCategory = cat;
          break;
        }
      }

      // If no exact archetype match, search by keyword overlap on category names
      if (!matchedCategory) {
        matchedCategory = searchPool.find(c => {
          const cName = c.name.toLowerCase();
          return def.nameKeywords.some(nkw => cName.includes(nkw));
        });
      }

      if (matchedCategory) {
        addCandidate(
          matchedCategory.id,
          matchedCategory.name,
          matchScore,
          3,
          recognizedVendor
            ? `Identified merchant "${recognizedVendor}" -> categorized to ${matchedCategory.name}`
            : `Identified transaction context "${recognizedConcept}" -> categorized to ${matchedCategory.name}`
        );
      }
    }
  }

  // --------------------------------------------------------------------------
  // TIER 4: HISTORICAL TRANSACTIONS REPETITION (90-98% Confidence)
  // --------------------------------------------------------------------------
  if (previousTransactions.length > 0) {
    const historicalMatches = previousTransactions.filter(prevTxn => {
      if (prevTxn.type !== type || !prevTxn.categoryId) return false;
      const prevNarr = prevTxn.narration || prevTxn.description || '';
      const { cleaned: prevCleaned, merchant: prevMerchant } = cleanNarration(prevNarr);

      // Same merchant entity
      if (merchant && prevMerchant && merchant === prevMerchant) return true;

      // High cleaned string similarity
      if (cleaned && prevCleaned) {
        if (cleaned.includes(prevCleaned) || prevCleaned.includes(cleaned)) return true;
        if (calculateSimilarity(cleaned, prevCleaned) > 0.75) return true;
      }

      return false;
    });

    if (historicalMatches.length > 0) {
      const categoryFrequency = new Map<string, number>();
      for (const h of historicalMatches) {
        if (h.categoryId) {
          categoryFrequency.set(h.categoryId, (categoryFrequency.get(h.categoryId) || 0) + 1);
        }
      }

      let topHistoricalCatId = '';
      let maxCount = 0;
      for (const [catId, count] of categoryFrequency.entries()) {
        if (count > maxCount) {
          maxCount = count;
          topHistoricalCatId = catId;
        }
      }

      if (topHistoricalCatId) {
        const histCat = categories.find(c => c.id === topHistoricalCatId);
        if (histCat) {
          const confidenceRatio = maxCount / historicalMatches.length;
          const histScore = Math.min(0.96, 0.88 + 0.1 * confidenceRatio);
          addCandidate(
            histCat.id,
            histCat.name,
            histScore,
            4,
            `Consistent with ${maxCount} previously classified transaction${maxCount === 1 ? '' : 's'}`
          );
        }
      }
    }
  }

  // --------------------------------------------------------------------------
  // TIER 5: TOKEN OVERLAP ON CATEGORY NAMES & SMART FALLBACKS (80-88%)
  // --------------------------------------------------------------------------
  for (const cat of searchPool) {
    const catWords = cleanNarration(cat.name).tokens;
    let matchCount = 0;
    for (const cw of catWords) {
      if (tokens.includes(cw) || tokens.some(t => calculateSimilarity(t, cw) > 0.85)) {
        matchCount += 1;
      }
    }
    if (matchCount > 0 && catWords.length > 0) {
      const tokenScore = 0.80 + 0.10 * (matchCount / catWords.length);
      addCandidate(cat.id, cat.name, tokenScore, 5, `Keyword overlap with category "${cat.name}"`);
    }
  }

  // Sort candidates by tier (lower tier = higher priority), then by priority descending, then by score descending
  candidates.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    if (a.priority !== b.priority) return b.priority - a.priority;
    return b.score - a.score;
  });

  const bestMatch = candidates[0];

  // Conflict check (§11): If top candidates predict differing categories with equal tier and priority
  let hasConflict = false;
  if (candidates.length > 1 && bestMatch) {
    const second = candidates[1];
    if (
      second.categoryId !== bestMatch.categoryId &&
      second.tier === bestMatch.tier &&
      second.priority === bestMatch.priority &&
      Math.abs(second.score - bestMatch.score) < 0.05
    ) {
      hasConflict = true;
    }
  }

  // Orthogonal Risk Assessment (§11)
  const tenantPolicy = options?.tenantPolicy;
  const highThreshold = tenantPolicy?.highThreshold ?? 85;
  const mediumThreshold = tenantPolicy?.mediumThreshold ?? 60;
  const allowsAuto = tenantPolicy?.allowsAutoApproval ?? true;

  const riskFlags = detectRiskFlags(narration, amount, type, previousTransactions, {
    highValueThreshold: tenantPolicy?.highValueThreshold ?? 5000,
    duplicateWindowDays: tenantPolicy?.duplicateWindowDays ?? 7,
    world: options?.world,
    hasConflict,
    isTransferFlagged: options?.isTransfer,
  });

  // If no match was found at all:
  if (!bestMatch) {
    // Pick the most appropriate default category for the type
    const defaultFallback = searchPool.find(c =>
      c.name.toLowerCase().includes('general') ||
      c.name.toLowerCase().includes('operating') ||
      c.name.toLowerCase().includes('revenue') ||
      c.name.toLowerCase().includes('sales')
    ) || searchPool[0] || categories[0];

    return {
      categoryId: defaultFallback?.id || '',
      categoryName: defaultFallback?.name || 'Uncategorized',
      confidence: 30,
      confidenceBand: 'low',
      placement: 'manual_review',
      reasoning: 'Ambiguous transaction description. Requires user review.',
      alternativeSuggestions: searchPool.slice(1, 4).map(c => ({
        categoryId: c.id,
        categoryName: c.name,
        confidence: 25,
      })),
      needsReview: true,
      riskFlags,
      rawNarration: narration,
      normalizedTokens: tokens,
      candidateRules: [],
    };
  }

  // Calculate final confidence (0-100)
  const finalConfidence = Math.min(100, Math.max(0, Math.round(bestMatch.score * 100)));
  const confidenceBand: ConfidenceBand =
    finalConfidence >= highThreshold ? 'high' : finalConfidence >= mediumThreshold ? 'medium' : 'low';

  // Placement decision logic (§11)
  let placement: PlacementType = 'manual_review';
  let needsReview = true;

  if (hasConflict) {
    placement = 'manual_review';
    needsReview = true;
  } else if (confidenceBand === 'high' && riskFlags.length === 0 && allowsAuto) {
    placement = 'auto_approved';
    needsReview = false;
  } else if (confidenceBand === 'medium' && riskFlags.length === 0) {
    placement = 'bulk_review';
    needsReview = true;
  } else {
    placement = 'manual_review';
    needsReview = true;
  }

  // Compile top 3 alternatives
  const alternatives = candidates
    .filter(c => c.categoryId !== bestMatch.categoryId)
    .slice(0, 3)
    .map(c => ({
      categoryId: c.categoryId,
      categoryName: c.categoryName,
      confidence: Math.min(100, Math.max(0, Math.round(c.score * 100))),
    }));

  const candidateEvidence = candidates.slice(0, 5).map(c => ({
    id: c.ruleId || 'taxonomy',
    version: c.ruleVersion || 1,
    score: Math.round(c.score * 100),
    matchReason: c.matchReason,
  }));

  const conflictSuffix = hasConflict
    ? ' [CONFLICT: Multiple active rules matched with equal precedence. Routed to manual review.]'
    : '';

  return {
    categoryId: bestMatch.categoryId,
    categoryName: bestMatch.categoryName,
    confidence: finalConfidence,
    confidenceBand,
    placement,
    riskFlags,
    reasoning: `${bestMatch.matchReason} (${finalConfidence}% confidence)${conflictSuffix}`,
    alternativeSuggestions: alternatives,
    needsReview,
    source: bestMatch.tier <= 2 ? 'rule' : bestMatch.tier === 3 ? 'pattern' : 'fallback',
    matchedRuleId: bestMatch.ruleId,
    matchedRuleVersion: bestMatch.ruleVersion,
    suggestedDepartmentId: bestMatch.departmentId,
    suggestedProjectId: bestMatch.projectId,
    counterparty: bestMatch.counterparty,
    rawNarration: narration,
    normalizedTokens: tokens,
    candidateRules: candidateEvidence,
  };
};

// ────────────────────────────────────────────────────────────────────────────
// 6. HIGH-PRECISION LEARNING FROM USER FEEDBACK
// ────────────────────────────────────────────────────────────────────────────

export const learnFromFeedback = (
  narration: string,
  selectedCategoryId: string,
  previousCategoryId: string | null,
  categories: Category[]
): Category[] => {
  const { cleaned, merchant, tokens, phrases } = cleanNarration(narration);

  // High-value signal keywords and phrases (excluding numbers, noise)
  const candidatePatterns = [
    merchant,
    ...phrases.slice(0, 2),
    ...tokens.filter(t => t.length > 3).slice(0, 3),
  ].filter(Boolean);

  const updatedCategories = categories.map(category => {
    // Positive learning: add clean signal patterns to the selected category
    if (category.id === selectedCategoryId) {
      const existingPatterns = (category.patterns || []).map(p => p.toLowerCase());
      const newPatternsToAdd: string[] = [];

      for (const pattern of candidatePatterns) {
        const patLower = pattern.toLowerCase().trim();
        if (patLower.length > 2 && !existingPatterns.includes(patLower)) {
          newPatternsToAdd.push(patLower);
        }
      }

      return {
        ...category,
        patterns: Array.from(new Set([...(category.patterns || []), ...newPatternsToAdd])).slice(0, 50),
      };
    }

    // Negative learning: remove conflicting patterns from the previous incorrect category
    if (previousCategoryId && category.id === previousCategoryId) {
      return {
        ...category,
        patterns: (category.patterns || []).filter(pattern => {
          const patLower = pattern.toLowerCase();
          // Remove if this pattern directly equals or matches the corrected merchant
          if (merchant && patLower === merchant) return false;
          if (cleaned.includes(patLower) && patLower.length > 3) return false;
          return true;
        }),
      };
    }

    return category;
  });

  return updatedCategories;
};

// ────────────────────────────────────────────────────────────────────────────
// 7. UTILITIES & BATCH PROCESSING
// ────────────────────────────────────────────────────────────────────────────

export const generateClarificationQuestion = (
  classification: ClassificationResult,
  narration: string
): string | null => {
  if (classification.confidence >= 85) {
    return null; // High confidence, no question needed
  }

  if (classification.alternativeSuggestions.length > 0) {
    const topAlternative = classification.alternativeSuggestions[0];
    return `Is this transaction "${classification.categoryName}" or "${topAlternative.categoryName}"?`;
  }

  return `Please confirm if "${classification.categoryName}" is the correct category for: "${narration}".`;
};

export const batchClassify = (
  transactions: Array<{ narration: string; amount: number; type: 'debit' | 'credit' }>,
  categories: Category[],
  previousTransactions: Transaction[] = [],
  rules?: ClassificationRule[]
): Map<number, ClassificationResult> => {
  const results = new Map<number, ClassificationResult>();

  transactions.forEach((txn, index) => {
    const result = classifyTransaction(
      txn.narration,
      txn.amount,
      txn.type,
      categories,
      previousTransactions,
      rules
    );
    results.set(index, result);
  });

  return results;
};

// ────────────────────────────────────────────────────────────────────────────
// 8. CANDIDATE RULE GENERATION & COLLISION EVALUATOR (§11)
// ────────────────────────────────────────────────────────────────────────────

const GENERIC_WORDS = new Set([
  'payment', 'trans', 'transaction', 'debit', 'credit', 'online', 'store',
  'bill', 'bank', 'service', 'account', 'card', 'checkout', 'pos', 'fee',
  'purchase', 'terminal', 'direct', 'recurring', 'charge', 'sub', 'order',
]);

export interface CandidateRuleEvaluation {
  candidateRule: VersionedRule;
  isValid: boolean;
  collisionWarning?: string;
  matchedSampleCount: number;
  conflictingRuleCount: number;
}

export function evaluateRuleCandidate(
  candidate: VersionedRule,
  sampleTransactions: Transaction[] = [],
  activeRules: ClassificationRule[] = []
): CandidateRuleEvaluation {
  const pat = (candidate.pattern || candidate.match?.pattern || '').trim().toLowerCase();
  const tokens = (candidate.match?.tokens || []).map(t => t.toLowerCase().trim()).filter(Boolean);

  // 1. Generic word check: disallow rules matching single generic words without context
  if (tokens.length === 1 && GENERIC_WORDS.has(tokens[0])) {
    return {
      candidateRule: candidate,
      isValid: false,
      collisionWarning: `Pattern "${tokens[0]}" is too generic and would cause false-positive captures across unrelated descriptions.`,
      matchedSampleCount: 0,
      conflictingRuleCount: 0,
    };
  }

  // 2. Collision with active rules predicting differing categories
  let conflictingRuleCount = 0;
  for (const r of activeRules) {
    if (r.id === candidate.id || r.status === 'disabled' || r.status === 'archived') continue;
    const rCat = r.categoryId || r.prediction?.category_id;
    const candCat = candidate.prediction?.category_id || candidate.categoryId;

    if (rCat && candCat && rCat !== candCat) {
      const rPat = (r.pattern || r.match?.pattern || '').trim().toLowerCase();
      if (rPat && pat && (rPat === pat || pat.includes(rPat) || rPat.includes(pat))) {
        conflictingRuleCount++;
      }
    }
  }

  // 3. Test matching on sample transactions
  let matchedSampleCount = 0;
  for (const txn of sampleTransactions) {
    const raw = (txn.narration || txn.description || '').toLowerCase();
    if (pat && raw.includes(pat)) {
      matchedSampleCount++;
    } else if (tokens.length > 0) {
      const { tokens: txnTokens } = cleanNarration(raw);
      if (tokens.every(t => txnTokens.includes(t))) {
        matchedSampleCount++;
      }
    }
  }

  const warning = conflictingRuleCount > 0
    ? `Warning: Candidate rule collides with ${conflictingRuleCount} existing active rule(s) for different categories.`
    : undefined;

  return {
    candidateRule: candidate,
    isValid: true,
    collisionWarning: warning,
    matchedSampleCount,
    conflictingRuleCount,
  };
}

export function createCandidateRule(
  organizationId: string,
  narration: string,
  correctCategoryId: string,
  options?: {
    existingRule?: ClassificationRule;
    world?: 'business' | 'personal';
    departmentId?: string;
    projectId?: string;
    counterparty?: string;
    feedbackId?: string;
  }
): VersionedRule {
  const { cleaned, merchant, tokens } = cleanNarration(narration);
  const existing = options?.existingRule;
  const currentVersion = existing?.version || 1;
  const newVersion = existing ? currentVersion + 1 : 1;

  // Prefer clean merchant name if identified, otherwise top 2 distinctive tokens
  const cleanTokens = tokens.filter(t => !GENERIC_WORDS.has(t));
  const merchantToken = merchant && !GENERIC_WORDS.has(merchant)
    ? merchant
    : (cleanTokens.slice(0, 2).join(' ') || narration.slice(0, 30));

  const ruleId = existing ? existing.id : `rule_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  return {
    id: ruleId,
    rule_id: ruleId,
    organization_id: organizationId,
    version: newVersion,
    status: 'active',
    scope: {
      world: options?.world || 'business',
      account_ids: [],
      directions: ['debit'],
    },
    match: {
      method: 'token_set',
      tokens: cleanTokens.slice(0, 3),
      pattern: merchantToken.toLowerCase(),
      merchant_alias: options?.counterparty || merchant || undefined,
    },
    prediction: {
      category_id: correctCategoryId,
      counterparty: options?.counterparty || merchant || undefined,
      department_id: options?.departmentId,
      project_id: options?.projectId,
      world: options?.world || 'business',
    },
    confidence_policy: 'high_only_if_no_conflict',
    priority: 50,
    explanation: `Approved vendor rule for "${merchantToken}"`,
    created_from_feedback_id: options?.feedbackId || null,
    effective_from: new Date().toISOString(),
    times_applied: 0,
    times_confirmed: 1,
    times_overridden: 0,
    false_positive_count: 0,
  };
}
