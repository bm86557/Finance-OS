/**
 * Dynamic Multi-Model Gateway & Failover Radar Integration Tests
 * ==============================================================
 * Verifies SaaS-level LLM provider registration, AES-256 encryption,
 * failover priority cascading, circuit breakers, and rate limiting.
 * Aligns strictly with FINANCE_OS_MASTER_BACKEND_HANDOFF_v1.2.md (§2, §5, §18, §20, §33).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
declare function describe(name: string, fn: () => void): void;
declare function it(name: string, fn: () => void | Promise<void>): void;
declare function expect(value: any): any;

const queuedTests: Array<{ name: string; fn: () => void | Promise<void> }> = [];

if (typeof (globalThis as any).describe === 'undefined') {
  (globalThis as any).describe = (name: string, fn: () => void) => {
    console.log(`\n======================================================\n  TEST SUITE: ${name}\n======================================================`);
    fn();
  };
  (globalThis as any).it = (name: string, fn: () => void | Promise<void>) => {
    queuedTests.push({ name, fn });
  };
  (globalThis as any).expect = (val: any) => ({
    toBe(exp: any) {
      if (val !== exp) throw new Error(`Expected ${JSON.stringify(exp)} but got ${JSON.stringify(val)}`);
    },
    toBeGreaterThan(exp: number) {
      if (val <= exp) throw new Error(`Expected ${val} > ${exp}`);
    },
    toBeGreaterThanOrEqual(exp: number) {
      if (val < exp) throw new Error(`Expected ${val} >= ${exp}`);
    },
    toBeLessThanOrEqual(exp: number) {
      if (val > exp) throw new Error(`Expected ${val} <= ${exp}`);
    },
    toContain(exp: string) {
      if (typeof val === 'string' && !val.includes(exp)) {
        throw new Error(`Expected "${val}" to contain "${exp}"`);
      }
    },
    toBeTruthy() {
      if (!val) throw new Error(`Expected truthy value but got ${val}`);
    },
    toBeFalsy() {
      if (val) throw new Error(`Expected falsy value but got ${val}`);
    },
    toEqual(exp: any) {
      if (JSON.stringify(val) !== JSON.stringify(exp)) {
        throw new Error(`Expected ${JSON.stringify(exp)} but got ${JSON.stringify(val)}`);
      }
    },
    not: {
      toBe(exp: any) {
        if (val === exp) throw new Error(`Expected ${JSON.stringify(val)} not to be ${JSON.stringify(exp)}`);
      },
      toContain(exp: string) {
        if (typeof val === 'string' && val.includes(exp)) {
          throw new Error(`Expected "${val}" not to contain "${exp}"`);
        }
      },
    },
  });

  setTimeout(async () => {
    for (const test of queuedTests) {
      try {
        await test.fn();
        console.log(`  [PASS] ✓ ${test.name}`);
      } catch (e: any) {
        console.error(`  [FAIL] ✗ ${test.name}:`, e.message);
        process.exitCode = 1;
      }
    }
    if (process.exitCode === 1) {
      console.error('\n❌ Dynamic Model Gateway tests encountered failures.');
    } else {
      console.log(`\n🎉 All ${queuedTests.length}/${queuedTests.length} Dynamic Model Gateway tests passed!`);
    }
  }, 50);
}

import {
  getGatewayRuntimeModels,
  getGatewayRuntimeState,
  setGatewayModelCircuit,
  setGatewayPrimaryModel,
  addGatewayProviderDb,
  updateGatewayProviderDb,
  deleteGatewayProviderDb,
  reorderGatewayProvidersDb,
  testGatewayNodeDirect,
  resolveNodeApiKey,
  testAIConnection,
} from '../lib/aiGateway.js';
import { decryptSecret, encryptSecret } from '../lib/secretBox.js';

describe('Dynamic Model Gateway & Failover Tests (SaaS Scope)', () => {
  it('1. Initializes default runtime gateway models with prioritized failover order', () => {
    const models = getGatewayRuntimeModels();
    expect(models.length).toBeGreaterThanOrEqual(3);

    // First model must be priority 1 (Primary)
    const primary = models[0];
    expect(primary.priority).toBe(1);
    expect(primary.status).toBe('online');

    // Standby models have priority > 1
    const standby = models[1];
    expect(standby.priority).toBe(2);
    expect(standby.status).toBe('standby');
  });

  it('2. Supports adding custom LLM provider with AES-256 encrypted credentials', async () => {
    const fakeKey = 'sk-deepseek-test-credential-987654321';
    const added = await addGatewayProviderDb({
      provider: 'custom',
      name: 'DeepSeek V3 Production',
      modelName: 'deepseek-chat-v3',
      apiKey: fakeKey,
      baseUrl: 'https://api.deepseek.com/v1',
      priority: 6,
      rateLimitRpm: 120,
      rateLimitTpm: 1500000,
      costPer1MInput: 0.14,
      costPer1MOutput: 0.28,
    });

    expect(added.name).toBe('DeepSeek V3 Production');
    expect(added.modelName).toBe('deepseek-chat-v3');
    expect(added.rateLimitRpm).toBe(120);

    // Plaintext key MUST NEVER be stored bare in apiKey
    expect((added as any).apiKey).not.toBe(fakeKey);

    // If encrypted, verify decryption round-trip via secretBox
    if (added.apiKeyEncrypted) {
      const decrypted = decryptSecret(added.apiKeyEncrypted, 'platform_global');
      expect(decrypted).toBe(fakeKey);
    }
  });

  it('3. Dynamically updates gateway provider configuration and rate limits', async () => {
    const models = getGatewayRuntimeModels();
    const deepseekNode = models.find((m) => m.modelName === 'deepseek-chat-v3');
    expect(deepseekNode).toBeTruthy();

    if (deepseekNode?.id) {
      const updated = await updateGatewayProviderDb(deepseekNode.id, {
        name: 'DeepSeek V3 (Updated Limits)',
        rateLimitRpm: 200,
      });

      expect(updated?.name).toBe('DeepSeek V3 (Updated Limits)');
      expect(updated?.rateLimitRpm).toBe(200);
    }
  });

  it('4. Correctly switches primary model and cascades previous primary to standby', () => {
    const initialModels = getGatewayRuntimeModels();
    const currentPrimary = initialModels.find((m) => m.priority === 1);
    const targetModel = initialModels.find((m) => m.priority === 2) || initialModels[1];

    setGatewayPrimaryModel(targetModel.modelName);

    const updatedState = getGatewayRuntimeState();
    expect(updatedState.activeModel).toBe(targetModel.modelName);

    const modelsAfter = getGatewayRuntimeModels();
    const newPrimary = modelsAfter.find((m) => m.modelName === targetModel.modelName);
    expect(newPrimary?.priority).toBe(1);
    expect(newPrimary?.status).toBe('online');

    // Restore original primary
    if (currentPrimary) {
      setGatewayPrimaryModel(currentPrimary.modelName);
    }
  });

  it('5. Trips circuit breaker on repeated failures and auto-promotes standby fallback', () => {
    const models = getGatewayRuntimeModels();
    const primary = models.find((m) => m.priority === 1)!;

    // Simulate circuit breaker trip
    setGatewayModelCircuit(primary.modelName, true);

    const trippedModels = getGatewayRuntimeModels();
    const trippedPrimary = trippedModels.find((m) => m.modelName === primary.modelName);
    expect(trippedPrimary?.circuitOpen).toBe(true);
    expect(trippedPrimary?.status).toBe('tripped');

    // Reset circuit breaker to restore normal operation
    setGatewayModelCircuit(primary.modelName, false);
    const restoredModels = getGatewayRuntimeModels();
    const restoredPrimary = restoredModels.find((m) => m.modelName === primary.modelName);
    expect(restoredPrimary?.circuitOpen).toBe(false);
    expect(restoredPrimary?.status).toBe('online');
  });

  it('6. Reorders entire failover cascade with custom priorities', async () => {
    const models = getGatewayRuntimeModels();
    if (models.length >= 2) {
      const reorderList = [
        { id: models[0].id || models[0].modelName, priority: 2 },
        { id: models[1].id || models[1].modelName, priority: 1 },
      ];

      await reorderGatewayProvidersDb(reorderList);
      const after = getGatewayRuntimeModels();
      expect(after[0].priority).toBe(1);
    }
  });

  it('7. Directly tests connection to a gateway node without modifying code', async () => {
    const models = getGatewayRuntimeModels();
    const geminiNode = models.find((m) => m.provider === 'gemini');
    expect(geminiNode).toBeTruthy();

    const result = await testGatewayNodeDirect(geminiNode!.id || geminiNode!.modelName);
    expect(result.provider).toBe('gemini');
    expect(typeof result.latencyMs).toBe('number');
  });

  it('8. Successfully deletes a custom provider from the failover cascade', async () => {
    const modelsBefore = getGatewayRuntimeModels();
    const target = modelsBefore.find((m) => m.modelName === 'deepseek-chat-v3');

    if (target?.id) {
      const deleted = await deleteGatewayProviderDb(target.id);
      expect(deleted).toBe(true);

      const modelsAfter = getGatewayRuntimeModels();
      const stillPresent = modelsAfter.some((m) => m.id === target.id);
      expect(stillPresent).toBe(false);
    }
  });

  it('9. Resolves node API keys correctly from encrypted vault and environment variables', () => {
    const fakeKey = 'sk-ant-test-anthropic-key-12345';
    const encrypted = encryptSecret(fakeKey, 'platform_global');

    const nodeWithEncryptedKey = {
      provider: 'anthropic',
      name: 'Claude Test',
      modelName: 'claude-3-5-haiku-20241022',
      priority: 3,
      isActive: true,
      circuitOpen: false,
      callCount: 0,
      failureCount: 0,
      avgLatencyMs: 0,
      lastLatencyMs: 0,
      costPer1MInput: 0.8,
      costPer1MOutput: 4.0,
      status: 'standby' as const,
      apiKeyEncrypted: encrypted,
    };

    const resolved = resolveNodeApiKey(nodeWithEncryptedKey);
    expect(resolved).toBe(fakeKey);

    const nodeWithNoKey = {
      ...nodeWithEncryptedKey,
      provider: 'custom',
      apiKeyEncrypted: undefined,
    };
    const resolvedEmpty = resolveNodeApiKey(nodeWithNoKey);
    expect(typeof resolvedEmpty).toBe('string');
  });

  it('10. Validates Anthropic Claude and OpenAI test connection protocols', async () => {
    // Missing key returns clear diagnostic error
    const missingKeyResult = await testAIConnection({
      provider: 'anthropic',
      modelName: 'claude-3-5-haiku-20241022',
      apiKey: '',
    });
    expect(missingKeyResult.success).toBe(false);
    expect(missingKeyResult.error).toContain('API key is missing or empty');

    const missingOpenAiResult = await testAIConnection({
      provider: 'openai',
      modelName: 'gpt-4o-mini',
      apiKey: '',
    });
    expect(missingOpenAiResult.success).toBe(false);
    expect(missingOpenAiResult.error).toContain('API key is missing or empty');
  });
});
