import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchKrakenOHLC, krakenToEnhancedKline } from '../lib/kraken';

// Mock fetch for testing
global.fetch = vi.fn();

describe('Kraken API Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should map Kraken symbol correctly', async () => {
    const mockKrakenResponse = {
      error: [],
      result: {
        XBTUSDT: [
          [1704067200, '43000.1', '43500.2', '42800.0', '43400.5', '43100.3', '1234.567', 12345]
        ]
      }
    };

    (fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => mockKrakenResponse,
    });

    const options = {
      baseUrl: 'https://api.kraken.com',
      timeoutMs: 10000,
      maxRetries: 3,
      backoffBaseMs: 500,
    };

    const result = await fetchKrakenOHLC('BTCUSDT', '5m', options, 1);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      time: 1704067,
      open: 43000.1,
      high: 43500.2,
      low: 42800.0,
      close: 43400.5,
      volume: 1234.567,
    });
  });

  it('should convert Kraken OHLC to enhanced kline format', () => {
    const krakenOHLC = {
      time: 1704067,
      open: 43000.1,
      high: 43500.2,
      low: 42800.0,
      close: 43400.5,
      volume: 1234.567,
    };

    const result = krakenToEnhancedKline(krakenOHLC);

    expect(result).toEqual({
      timestamp: 1704067000,
      open: 43000.1,
      high: 43500.2,
      low: 42800.0,
      close: 43400.5,
      volume: 1234.567,
    });
  });

  it('should handle Kraken API errors', async () => {
    const mockErrorResponse = {
      error: ['EQuery:Invalid asset pair'],
      result: {},
    };

    (fetch as any).mockResolvedValueOnce({
      ok: true,
      json: async () => mockErrorResponse,
    });

    const options = {
      baseUrl: 'https://api.kraken.com',
      timeoutMs: 10000,
      maxRetries: 1,
      backoffBaseMs: 500,
    };

    await expect(fetchKrakenOHLC('INVALID', '5m', options, 1)).rejects.toThrow('Kraken API error: EQuery:Invalid asset pair');
  });
});