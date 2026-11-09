/**
 * AI-Enhanced Classification Routes
 * Production-ready AI categorization with Supabase integration
 */

import { Router, type Request, type Response } from 'express';
import { getSupabaseAdminClient } from '../lib/supabaseAdmin.js';
import { ok, created, fail, notFound } from '../lib/http.js';
import { 
  classifyWithAI, 
  batchClassifyWithAI, 
  testAIConnection,
  extractMerchantName,
  type ClassificationRequest,
  type ClassificationResult,
} from '../services/aiClassificationService.js';
import { 
  getDefaultAIConfig, 
  validateAIConfig,
  encryptApiKey,
  decryptApiKey,
  type AIConfig,
  type AIProviderConfig,
} from '../config/aiConfig.js';
import { resolveOrgAIConfig } from '../lib/aiGateway.js';
import { getGlobalPlatformSettings } from './platformSettings.js';
import type { Category } from '../../src/services/types.js';

export function createAIClassificationRouter(): Router {
  const r = Router({ mergeParams: true });

  // Enforce global feature flag: AI-Powered Category Suggestions
  r.use(async (req: Request, res: Response, next) => {
    const settings = await getGlobalPlatformSettings();
    if (!settings.feature_flags.ai_category_suggestions && req.method !== 'GET') {
      return fail(res, 403, 'AI-Powered Category Suggestions are currently disabled system-wide by the Platform Administrator.');
    }
    next();
  });
  
  /**
   * Get AI configuration for an organization
   * GET /organizations/:organizationId/ai-classification/config
   */
  r.get('/config', async (req: Request, res: Response) => {
    const sb = getSupabaseAdminClient();
    if (!sb) {
      return fail(res, 503, 'Supabase not configured');
    }
    
    const orgId = String(req.params.organizationId);
    
    try {
      const { data, error } = await sb
        .from('org_ai_settings')
        .select('*')
        .eq('organization_id', orgId)
        .single();
      
      if (error && error.code !== 'PGRST116') { // Not found is OK
        throw error;
      }
      
      // Never send encrypted key to client
      const safeConfig = data ? {
        is_configured: !!(data.api_key_encrypted),
        is_active: data.is_active || false,
        provider_name: data.provider_name || '',
        model_name: data.model_name || '',
        use_custom_key: data.use_custom_key || false,
        base_url: data.base_url || '',
      } : {
        is_configured: false,
        is_active: false,
      };
      
      ok(res, safeConfig);
    } catch (error) {
      console.error('Failed to get AI config:', error);
      fail(res, 500, 'Failed to retrieve AI configuration');
    }
  });
  
  /**
   * Update AI configuration (admin only)
   * POST /organizations/:organizationId/ai-classification/config
   */
  r.post('/config', async (req: Request, res: Response) => {
    const sb = getSupabaseAdminClient();
    if (!sb) {
      return fail(res, 503, 'Supabase not configured');
    }
    
    const orgId = String(req.params.organizationId);
    const { 
      provider_name, 
      model_name, 
      api_key, 
      base_url, 
      use_custom_key,
      temperature,
      max_tokens,
      is_active,
    } = req.body;
    
    try {
      // Validate required fields
      if (!provider_name || !model_name || !api_key) {
        return fail(res, 400, 'provider_name, model_name, and api_key are required');
      }
      
      // Encrypt API key
      const encryptedKey = encryptApiKey(api_key);
      
      // Upsert configuration
      const { error } = await sb
        .from('org_ai_settings')
        .upsert({
          organization_id: orgId,
          provider_name,
          model_name,
          api_key_encrypted: encryptedKey,
          base_url: base_url || 'https://api.openai.com/v1',
          use_custom_key: use_custom_key !== false,
          temperature: temperature || 0.3,
          max_tokens: max_tokens || 500,
          is_active: is_active !== false,
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'organization_id',
        });
      
      if (error) throw error;
      
      ok(res, { configured: true }, 'AI configuration updated successfully');
    } catch (error) {
      console.error('Failed to update AI config:', error);
      fail(res, 500, 'Failed to update AI configuration');
    }
  });
  
  /**
   * Test AI connection
   * POST /organizations/:organizationId/ai-classification/test
   */
  r.post('/test', async (req: Request, res: Response) => {
    const sb = getSupabaseAdminClient();
    if (!sb) {
      return fail(res, 503, 'Supabase not configured');
    }
    
    const orgId = String(req.params.organizationId);
    
    try {
      const config = await getAIConfigForOrg(orgId, sb);
      if (!config) {
        return fail(res, 400, 'AI not configured for this organization');
      }
      
      const result = await testAIConnection(config);
      ok(res, result);
    } catch (error) {
      console.error('AI connection test failed:', error);
      fail(res, 500, error instanceof Error ? error.message : 'Connection test failed');
    }
  });
  
  /**
   * Classify a single transaction
   * POST /organizations/:organizationId/ai-classification/classify
   */
  r.post('/classify', async (req: Request, res: Response) => {
    const sb = getSupabaseAdminClient();
    if (!sb) {
      return fail(res, 503, 'Supabase not configured');
    }
    
    const orgId = String(req.params.organizationId);
    const { narration, amount, type, date } = req.body as ClassificationRequest;
    
    if (!narration || amount === undefined || !type) {
      return fail(res, 400, 'narration, amount, and type are required');
    }
    
    try {
      const config = await getAIConfigForOrg(orgId, sb);
      if (!config) {
        return fail(res, 400, 'AI not configured for this organization');
      }
      
      const categories = await getCategories(orgId, sb);
      if (categories.length === 0) {
        return fail(res, 400, 'No categories found for this organization');
      }
      
      // Extract merchant info
      const merchantInfo = extractMerchantName(narration);
      
      const result = await classifyWithAI(
        { narration, amount, type, date, merchantInfo },
        categories,
        config
      );
      
      ok(res, result);
    } catch (error) {
      console.error('Classification failed:', error);
      fail(res, 500, error instanceof Error ? error.message : 'Classification failed');
    }
  });
  
  /**
   * Batch classify transactions
   * POST /organizations/:organizationId/ai-classification/batch
   */
  r.post('/batch', async (req: Request, res: Response) => {
    const sb = getSupabaseAdminClient();
    if (!sb) {
      return fail(res, 503, 'Supabase not configured');
    }
    
    const orgId = String(req.params.organizationId);
    const { transactions } = req.body as { transactions: ClassificationRequest[] };
    
    if (!Array.isArray(transactions) || transactions.length === 0) {
      return fail(res, 400, 'transactions array is required');
    }
    
    try {
      const config = await getAIConfigForOrg(orgId, sb);
      if (!config) {
        return fail(res, 400, 'AI not configured for this organization');
      }
      
      const categories = await getCategories(orgId, sb);
      if (categories.length === 0) {
        return fail(res, 400, 'No categories found for this organization');
      }
      
      // Add merchant info to each transaction
      const enrichedTransactions = transactions.map(t => ({
        ...t,
        merchantInfo: extractMerchantName(t.narration),
      }));
      
      const results = await batchClassifyWithAI(enrichedTransactions, categories, config);
      
      // Convert Map to array for JSON response
      const resultsArray = Array.from(results.entries()).map(([index, result]) => ({
        index,
        ...result,
      }));
      
      ok(res, { results: resultsArray });
    } catch (error) {
      console.error('Batch classification failed:', error);
      fail(res, 500, error instanceof Error ? error.message : 'Batch classification failed');
    }
  });
  
  /**
   * Record feedback for learning
   * POST /organizations/:organizationId/ai-classification/feedback
   */
  r.post('/feedback', async (req: Request, res: Response) => {
    const sb = getSupabaseAdminClient();
    if (!sb) {
      return fail(res, 503, 'Supabase not configured');
    }
    
    const orgId = String(req.params.organizationId);
    const {
      transaction_id,
      suggested_category_id,
      suggested_confidence,
      final_category_id,
      department_id,
      action,
      ai_reasoning,
      correction_reason,
    } = req.body;
    
    if (!transaction_id || !action) {
      return fail(res, 400, 'transaction_id and action are required');
    }
    
    try {
      // Get the authenticated user ID from the request
      const userId = req.authUser?.id || null;
      
      // Record feedback
      const { error: feedbackError } = await sb
        .from('classification_feedback')
        .insert({
          organization_id: orgId,
          transaction_id,
          suggested_category_id,
          suggested_confidence,
          final_category_id,
          action,
          ai_reasoning,
          correction_reason,
          feedback_by: userId,
        });
      
      if (feedbackError) throw feedbackError;
      
      // Update transaction with final category & department
      let resolvedDeptId: string | undefined;
      if (final_category_id) {
        try {
          const [{ data: txnRow }, { data: orgDepts }, { data: catRow }] = await Promise.all([
            sb.from('transactions').select('description, narration, department_id').eq('id', transaction_id).maybeSingle(),
            sb.from('departments').select('id, name, code').eq('organization_id', orgId),
            sb.from('categories').select('name').eq('id', final_category_id).maybeSingle(),
          ]);

          const depts = Array.isArray(orgDepts) ? orgDepts : [];

          // 1. Explicitly provided department_id
          if (department_id) {
            const matched = depts.find((d: any) => d.id === department_id || String(d.id).toLowerCase() === String(department_id).toLowerCase());
            if (matched) {
              resolvedDeptId = matched.id;
            }
          }

          // 2. Infer department from category name and transaction text
          if (!resolvedDeptId && depts.length > 0) {
            const catName = String(catRow?.name || '').toLowerCase();
            const text = `${txnRow?.description || ''} ${txnRow?.narration || ''} ${ai_reasoning || ''}`.toLowerCase();
            const combined = `${catName} ${text}`;

            // Direct department name mention in category
            for (const d of depts) {
              const base = String(d.name || '').toLowerCase().replace(/\s*department\s*/g, '').trim();
              if (base.length >= 3 && (catName.includes(base) || text.includes(base))) {
                resolvedDeptId = d.id;
                break;
              }
            }

            // Keyword heuristics mapping categories & narrations to domain departments
            if (!resolvedDeptId) {
              const rules = [
                {
                  deptKw: ['marketing', 'mkt', 'growth', 'brand'],
                  txnKw: ['marketing', 'advertising', 'ads', 'campaign', 'seo', 'social media', 'branding', 'public relations', 'promo', 'influencer', 'content'],
                },
                {
                  deptKw: ['development', 'dev', 'engineering', 'eng', 'tech', 'it', 'software'],
                  txnKw: ['software & tools', 'software', 'saas', 'development', 'engineering', 'cloud', 'hosting', 'api', 'ai subscription', 'github', 'aws', 'figma', 'openai', 'anthropic', 'infrastructure', 'tech', 'consulting', 'server', 'database', 'tools'],
                },
                {
                  deptKw: ['sales', 'business', 'bd'],
                  txnKw: ['sales', 'commission', 'crm', 'outreach', 'deal'],
                },
                {
                  deptKw: ['operations', 'ops', 'hr', 'finance', 'admin'],
                  txnKw: ['operations', 'hr', 'payroll', 'legal', 'accounting', 'office supplies', 'office rent', 'office', 'rent', 'supplies', 'maintenance'],
                },
              ];

              for (const rule of rules) {
                if (rule.txnKw.some(k => combined.includes(k))) {
                  const found = depts.find((d: any) => {
                    const dn = String(d.name || '').toLowerCase();
                    const dc = String(d.code || '').toLowerCase();
                    return rule.deptKw.some(dk => dn.includes(dk) || dc === dk);
                  });
                  if (found) {
                    resolvedDeptId = found.id;
                    break;
                  }
                }
              }
            }
          }
        } catch (deptErr) {
          console.warn('[aiClassification.feedback] Dept inference warning:', deptErr);
        }

        const updatePayload: Record<string, any> = {
          category_id: final_category_id,
          status: 'classified',
          classified_by: 'user',
          classified_at: new Date().toISOString(),
          confidence: 100,
        };
        if (resolvedDeptId) {
          updatePayload.department_id = resolvedDeptId;
        }

        const { error: txnError } = await sb
          .from('transactions')
          .update(updatePayload)
          .eq('id', transaction_id);
        
        if (txnError) console.error('Failed to update transaction:', txnError);
      }
      
      // Learn from feedback (correction or acceptance)
      if (final_category_id) {
        await learnFromCorrection(
          orgId,
          transaction_id,
          final_category_id,
          suggested_category_id,
          resolvedDeptId,
          sb
        );
      }
      
      ok(res, { recorded: true, department_id: resolvedDeptId }, 'Feedback recorded successfully');
    } catch (error) {
      console.error('Failed to record feedback:', error);
      fail(res, 500, 'Failed to record feedback');
    }
  });
  
  /**
   * Get classification statistics
   * GET /organizations/:organizationId/ai-classification/stats
   */
  r.get('/stats', async (req: Request, res: Response) => {
    const sb = getSupabaseAdminClient();
    if (!sb) {
      return fail(res, 503, 'Supabase not configured');
    }
    
    const orgId = String(req.params.organizationId);
    
    try {
      // Get feedback count by action
      const { data: feedback, error: feedbackError } = await sb
        .from('classification_feedback')
        .select('action')
        .eq('organization_id', orgId);
      
      if (feedbackError) throw feedbackError;
      
      const stats = {
        total_classifications: feedback?.length || 0,
        accepted: feedback?.filter(f => f.action === 'accepted').length || 0,
        corrected: feedback?.filter(f => f.action === 'corrected').length || 0,
        rejected: feedback?.filter(f => f.action === 'rejected').length || 0,
        accuracy_rate: 0,
      };
      
      if (stats.total_classifications > 0) {
        stats.accuracy_rate = Math.round(
          (stats.accepted / stats.total_classifications) * 100
        );
      }
      
      // Get active rules count
      const { count: rulesCount } = await sb
        .from('classification_rules')
        .select('*', { count: 'exact', head: true })
        .eq('organization_id', orgId)
        .eq('is_active', true);
      
      ok(res, { ...stats, active_rules: rulesCount || 0 });
    } catch (error) {
      console.error('Failed to get stats:', error);
      fail(res, 500, 'Failed to retrieve statistics');
    }
  });
  
  return r;
}

/**
 * Helper: Get AI config for organization
 */
async function getAIConfigForOrg(
  orgId: string,
  sb: any
): Promise<AIProviderConfig | null> {
  try {
    const resolved = await resolveOrgAIConfig(orgId);
    if (resolved.source !== 'none' && resolved.apiKey) {
      return {
        provider: resolved.provider as any,
        providerName: resolved.providerName,
        modelName: resolved.modelName,
        baseUrl: resolved.baseUrl || 'https://api.openai.com/v1',
        apiKey: resolved.apiKey,
        temperature: resolved.temperature,
        maxTokens: resolved.maxTokens,
      };
    }
  } catch (err: any) {
    console.error('[aiClassification] Error resolving org AI config:', err.message);
  }
  // Try organization-specific config first
  const { data } = await sb
    .from('org_ai_settings')
    .select('*')
    .eq('organization_id', orgId)
    .eq('is_active', true)
    .single();
  
  if (data && data.api_key_encrypted) {
    try {
      return {
        provider: (data.provider_name || 'openai') as any,
        providerName: data.provider_name || 'openai',
        modelName: data.model_name,
        baseUrl: data.base_url || 'https://api.openai.com/v1',
        apiKey: decryptApiKey(data.api_key_encrypted),
        temperature: Number(data.temperature || 0.3),
        maxTokens: Number(data.max_tokens || 500),
      };
    } catch (error) {
      console.error('Failed to decrypt API key:', error);
      return null;
    }
  }
  
  // Fallback to default config from environment
  return getDefaultAIConfig();
}

/**
 * Helper: Get categories for organization
 */
async function getCategories(orgId: string, sb: any): Promise<Category[]> {
  const { data, error } = await sb
    .from('categories')
    .select('*')
    .eq('organization_id', orgId);
  
  if (error) {
    console.error('Failed to get categories:', error);
    return [];
  }
  
  return data || [];
}

/**
 * Helper: Learn from user correction
 */
async function learnFromCorrection(
  orgId: string,
  transactionId: string,
  correctCategoryId: string,
  wrongCategoryId: string | null,
  departmentId: string | undefined,
  sb: any
): Promise<void> {
  try {
    // Get transaction details
    const { data: txn } = await sb
      .from('transactions')
      .select('narration')
      .eq('id', transactionId)
      .single();
    
    if (!txn) return;
    
    // Extract pattern (merchant name or keywords)
    const pattern = extractMerchantName(txn.narration);
    if (!pattern || !pattern.trim()) return;
    
    // Check if a rule already exists for this organization & pattern
    const { data: existingRule } = await sb
      .from('classification_rules')
      .select('id, match_count, correct_count, wrong_count')
      .eq('organization_id', orgId)
      .ilike('pattern', pattern.trim())
      .maybeSingle();
    
    if (existingRule) {
      const { error: updateError } = await sb
        .from('classification_rules')
        .update({
          category_id: correctCategoryId,
          department_id: departmentId || null,
          prediction: {
            category_id: correctCategoryId,
            department_id: departmentId || null,
            world: 'business',
          },
          confidence: 100,
          source: 'user',
          correct_count: (existingRule.correct_count || 0) + 1,
          match_count: (existingRule.match_count || 0) + 1,
          last_used_at: new Date().toISOString(),
          is_active: true,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existingRule.id);

      if (updateError) {
        console.error('Failed to update learning rule:', updateError);
      }
    } else {
      const { error: insertError } = await sb
        .from('classification_rules')
        .insert({
          organization_id: orgId,
          pattern: pattern.trim(),
          category_id: correctCategoryId,
          department_id: departmentId || null,
          prediction: {
            category_id: correctCategoryId,
            department_id: departmentId || null,
            world: 'business',
          },
          confidence: 100,
          source: 'user',
          correct_count: 1,
          match_count: 1,
          wrong_count: 0,
          last_used_at: new Date().toISOString(),
          is_active: true,
        });

      if (insertError) {
        console.error('Failed to create learning rule:', insertError);
      }
    }
    
    // Mark wrong rules as less confident / inactive
    if (wrongCategoryId && wrongCategoryId !== correctCategoryId) {
      const { data: wrongRules } = await sb
        .from('classification_rules')
        .select('id, wrong_count, is_active')
        .eq('organization_id', orgId)
        .ilike('pattern', pattern.trim())
        .eq('category_id', wrongCategoryId);

      if (wrongRules && wrongRules.length > 0) {
        for (const wr of wrongRules) {
          const nextWrong = (wr.wrong_count || 0) + 1;
          await sb
            .from('classification_rules')
            .update({
              wrong_count: nextWrong,
              is_active: nextWrong >= 3 ? false : wr.is_active,
              updated_at: new Date().toISOString(),
            })
            .eq('id', wr.id);
        }
      }
    }
  } catch (error) {
    console.error('Learning from correction failed:', error);
  }
}
