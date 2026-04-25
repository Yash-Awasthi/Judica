import { describe, it, expect, vi } from 'vitest';
import { requestContext } from '../../src/lib/context.js';

// We need to mock pino BEFORE importing logger
vi.mock('pino', () => {
  const pinoMock = vi.fn((config) => {
    return {
      info: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
      // expose config for testing
      _testConfig: config
    };
  });
  return { default: pinoMock };
});

describe('Logger Utility', () => {
  it('should initialize pino with correct level and mixin', async () => {
    const { default: logger } = await import('../../src/lib/logger.js');
    const config = (logger as any)._testConfig;

    expect(config.level).toBeDefined();
    expect(config.mixin).toBeDefined();
  });

  it('should include requestId in logs when running in context', async () => {
    const { default: logger } = await import('../../src/lib/logger.js');
    const config = (logger as any)._testConfig;

    // Test mixin directly
    const mockId = 'test-request-id';
    
    // Outside context
    const mixinResult1 = config.mixin();
    expect(mixinResult1.requestId).toBeUndefined();

    // Inside context
    await requestContext.run({ requestId: mockId }, () => {
      const mixinResult2 = config.mixin();
      expect(mixinResult2.requestId).toBe(mockId);
    });
  });
});
