/**
 * AI Configuration Routes
 * Mounted at /organizations/:organizationId/ai
 */

import { Router, type Request, type Response } from 'express';
import { getSupabaseAdminClient } from '../lib/supabaseAdmin.js';
import { ok, created, fail, notImplemented } from '../lib/http.js';
import { validateAIConfig, getDefaultAIConfig } from '../config/aiConfig.js';
import { testAIConnection } from '../lib/aiClient.js';
import type { AIConfig } from '../config/aiConfig.js';

const AI_CONFIG_DOCS = `
# AI Configuration

Add AI_API_KEY to .env.local file.

See docs/AI_CLASSIFICATION_SETUP.md for details.
`;

export function createAIConfigRouter(): Router {
  const r = Router({ mergeParams: true });

  /**
   * GET /ai/config - Get AI configuration status (without exposing API key)
   */
  r.get('/config', async (req: Request, res: Response) => {
    const orgId = req.params.organizationId;
    const sb = getSupabaseAdminClient();

    if (!sb) {
      return notImplemented(res, 'Supabase admin client not configured');
    }

    try {
      const { data, error } = await sb
        .from('ai_classification_config')
        .select('provider, model_name, base_url, temperature, max_tokens, is_active, test_connection_status, test_connection_at')
        .eq('organization_id', orgId)
        .single();

      if (error && error.code !== 'PGRST116') {
        throw error;
      }

      if (!data) {
        // Check if default env config exists
        const defaultConfig = getDefaultAIConfig();
        return ok(res, {
          configured: !!defaultConfig,
          source: defaultConfig ? 'environment' : 'none',
          provider: defaultConfig?.provider || null,
          model_name: defaultConfig?.modelName || null,
        });
      }

      ok(res, {
        configured: true,
        source: 'database',
        ...data,
      });
    } catch (error) {
      console.error('Error fetching AI config:', error);
      fail(res, 400, 'Failed to fetch AI configuration');
    }
  });

  /**
   * POST /ai/config - Set AI configuration with encrypted API key
   */
  r.post('/config', async (req: Request, res: Response) => {
    const orgId = req.params.organizationId;
    const { provider, model_name, api_key, base_url, temperature } = req.body as {
      provider: string;
      model_name: string;
      api_key: string;
      base_url?: string;
      temperature?: number;
    };

    // Validate input
    const validation = validateAIConfig({
      provider: provider as AIConfig['provider'],
      modelName: model_name,
      apiKey: api_key,
      baseUrl: base_url,
      temperature: temperature ?? 0.3,
      maxTokens: 500,
    });

    if (!validation.valid) {
      return fail(res, 400, validation.error || 'Invalid configuration');
    }

    const sb = getSupabaseAdminClient();
    if (!sb) {
      return fail(res, 501, 'Supabase admin client not configured');
    }

    try {
      // Use the secure function to encrypt and store
      const { data, error } = await sb.rpc('set_ai_api_key', {
        p_organization_id: orgId,
        p_provider: provider,
        p_model_name: model_name,
        p_api_key: api_key,
        p_base_url: base_url || null,
        p_temperature: temperature ?? 0.3,
      });

      if (error) {
        console.error('Error setting AI config:', error);
        throw error;
      }

      const result = data as { success: boolean; error?: string; message?: string };
      
      if (!result.success) {
        return fail(res, 400, result.error || 'Failed to save configuration');
      }

      created(res, { configured: true, provider, model_name }, 'AI configuration saved successfully');
    } catch (error) {
      console.error('Error saving AI config:', error);
      fail(res, 400, 'Failed to save AI configuration');
    }
  });

  /**
   * POST /ai/test-connection - Test AI API connection
   */
  r.post('/test-connection', async (req: Request, res: Response) => {
    const orgId = req.params.organizationId;
    const sb = getSupabaseAdminClient();

    if (!sb) {
      return fail(res, 501, 'Supabase admin client not configured');
    }

    try {
      // Get decrypted config
      const { data: configData, error: configError } = await sb.rpc('get_ai_api_key', {
        p_organization_id: orgId,
      });

      if (configError || !configData || configData.length === 0) {
        // Try default config
        const defaultConfig = getDefaultAIConfig();
        if (!defaultConfig) {
          return fail(res, 400, 'No AI configuration found');
        }

        // Test with default config
        const testResult = await testAIConnection(defaultConfig);
        return ok(res, testResult);
      }

      const config = configData[0] as {
        provider: AIConfig['provider'];
        model_name: string;
        api_key: string;
        base_url: string | null;
        temperature: number;
        max_tokens: number;
      };

      const aiConfig: AIConfig = {
        provider: config.provider,
        modelName: config.model_name,
        apiKey: config.api_key,
        baseUrl: config.base_url || undefined,
        temperature: config.temperature,
        maxTokens: config.max_tokens,
      };

      // Test connection
      const testResult = await testAIConnection(aiConfig);

      // Update test status in database
      await sb
        .from('ai_classification_config')
        .update({
          test_connection_status: testResult.success ? 'success' : 'failed',
          test_connection_at: new Date().toISOString(),
          test_connection_error: testResult.error || null,
        })
        .eq('organization_id', orgId);

      ok(res, testResult);
    } catch (error) {
      console.error('Error testing AI connection:', error);
      fail(res, 400, 'Failed to test connection');
    }
  });

  /**
   * GET /ai/docs - Get AI configuration documentation
   */
  r.get('/docs', (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/markdown');
    res.send(AI_CONFIG_DOCS);
  });

  return r;
}
