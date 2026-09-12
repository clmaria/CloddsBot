import type { OrderBookEconomics } from './order-book-economics';

export interface MicrostructureEvidence {
  venue: string;
  symbol: string;
  quoteTicket: number;
  observedAtMs: number;
  source: 'public-rest' | 'public-ws' | 'fixture';
  economics: OrderBookEconomics;
}

export interface EvidenceSetValidation {
  valid: boolean;
  reasons: string[];
  venue?: string;
  symbol?: string;
  quoteTicket?: number;
  firstObservedAtMs?: number;
  lastObservedAtMs?: number;
}

/**
 * Prevents apples-to-oranges aggregation. One evidence set must represent the
 * same venue, pair and quote-ticket size, and every sample must be recent enough
 * for the caller's declared research window.
 */
export function validateMicrostructureEvidenceSet(
  evidence: MicrostructureEvidence[],
  nowMs: number,
  maxAgeMs: number,
  maxFutureSkewMs = 5_000,
): EvidenceSetValidation {
  const reasons: string[] = [];
  if (!evidence.length) return { valid: false, reasons: ['evidence set is empty'] };
  if (!(Number.isFinite(nowMs) && nowMs > 0)) throw new Error('nowMs must be positive and finite');
  if (!(Number.isFinite(maxAgeMs) && maxAgeMs > 0)) throw new Error('maxAgeMs must be positive and finite');
  if (!(Number.isFinite(maxFutureSkewMs) && maxFutureSkewMs >= 0)) {
    throw new Error('maxFutureSkewMs must be non-negative and finite');
  }

  const first = evidence[0];
  if (!first.venue.trim()) reasons.push('venue is required');
  if (!first.symbol.trim()) reasons.push('symbol is required');
  if (!(first.quoteTicket > 0 && Number.isFinite(first.quoteTicket))) reasons.push('quote ticket must be positive');

  for (const sample of evidence) {
    if (sample.venue !== first.venue) reasons.push('mixed venues in evidence set');
    if (sample.symbol !== first.symbol) reasons.push('mixed symbols in evidence set');
    if (sample.quoteTicket !== first.quoteTicket) reasons.push('mixed quote-ticket sizes in evidence set');
    if (!(Number.isFinite(sample.observedAtMs) && sample.observedAtMs > 0)) {
      reasons.push('invalid observation timestamp');
      continue;
    }
    if (sample.observedAtMs > nowMs + maxFutureSkewMs) reasons.push('future-dated observation');
    if (nowMs - sample.observedAtMs > maxAgeMs) reasons.push('stale observation');
  }

  const timestamps = evidence
    .map((sample) => sample.observedAtMs)
    .filter((value) => Number.isFinite(value) && value > 0);

  return {
    valid: reasons.length === 0,
    reasons: [...new Set(reasons)],
    venue: first.venue,
    symbol: first.symbol,
    quoteTicket: first.quoteTicket,
    firstObservedAtMs: timestamps.length ? Math.min(...timestamps) : undefined,
    lastObservedAtMs: timestamps.length ? Math.max(...timestamps) : undefined,
  };
}
