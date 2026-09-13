import assert from 'node:assert/strict';
import test from 'node:test';
import type { OrderBookEconomics } from '../../src/p300/order-book-economics';
import { validateMicrostructureEvidenceSet } from '../../src/p300/microstructure-evidence';

function economics(): OrderBookEconomics {
  return {
    bestBid: 100,
    bestAsk: 100.1,
    mid: 100.05,
    spreadBps: 10,
    buyVwap: 100.1,
    sellVwap: 100,
    buySlippageBps: 0,
    sellSlippageBps: 0,
    buyFilledQuote: 10,
    sellFilledQuote: 10,
    buyFullyFillable: true,
    sellFullyFillable: true,
  };
}

test('evidence validator accepts same venue, pair and ticket within freshness window', () => {
  const now = 10_000;
  const result = validateMicrostructureEvidenceSet([
    { venue: 'bitvavo', symbol: 'BTC-EUR', quoteTicket: 10, observedAtMs: 8_000, source: 'public-rest', economics: economics() },
    { venue: 'bitvavo', symbol: 'BTC-EUR', quoteTicket: 10, observedAtMs: 9_000, source: 'public-rest', economics: economics() },
  ], now, 5_000);

  assert.equal(result.valid, true);
  assert.equal(result.firstObservedAtMs, 8_000);
  assert.equal(result.lastObservedAtMs, 9_000);
});

test('evidence validator rejects mixed venue, symbol, ticket and stale/future samples', () => {
  const now = 10_000;
  const result = validateMicrostructureEvidenceSet([
    { venue: 'bitvavo', symbol: 'BTC-EUR', quoteTicket: 10, observedAtMs: 1_000, source: 'public-rest', economics: economics() },
    { venue: 'kraken', symbol: 'ETH-EUR', quoteTicket: 25, observedAtMs: 20_000, source: 'public-rest', economics: economics() },
  ], now, 5_000, 100);

  assert.equal(result.valid, false);
  assert.ok(result.reasons.includes('mixed venues in evidence set'));
  assert.ok(result.reasons.includes('mixed symbols in evidence set'));
  assert.ok(result.reasons.includes('mixed quote-ticket sizes in evidence set'));
  assert.ok(result.reasons.includes('stale observation'));
  assert.ok(result.reasons.includes('future-dated observation'));
});
