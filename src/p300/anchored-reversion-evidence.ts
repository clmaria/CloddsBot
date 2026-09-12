import { evaluateOrderBookEconomics, type OrderBookEconomics, type OrderBookSnapshot } from './order-book-economics';

export type DislocationDirection = 'underpriced' | 'overpriced' | 'flat';

export interface NormalizedReferenceInput {
  /** Unique source label, e.g. kraken-btc-usd. */
  source: string;
  /** Source price before quote conversion. */
  sourcePrice: number;
  /** Multiply sourcePrice by this value to express it in the target quote asset. */
  sourceQuoteToTargetQuote: number;
  /** Exchange/event timestamp for the source price, in epoch milliseconds. */
  priceObservedAtMs: number;
  /** Timestamp of the quote-conversion observation, in epoch milliseconds. */
  conversionObservedAtMs: number;
  /** Local wall-clock receive timestamp used to measure transport skew. */
  receivedAtMs: number;
}

export interface SynchronizedTargetBook {
  venue: string;
  symbol: string;
  sequence: number;
  /** Keep the original nanosecond value as text when the venue provides one. */
  exchangeTimestampNs?: string;
  exchangeObservedAtMs: number;
  receivedAtMs: number;
  book: OrderBookSnapshot;
}

export interface AnchoredReversionConfig {
  nowMs: number;
  quoteTicket: number;
  minReferenceSources: number;
  maxDataAgeMs: number;
  maxFutureSkewMs: number;
  maxCrossFeedReceiveSkewMs: number;
  maxReferenceDispersionBps: number;
  imbalanceLevels: number;
}

export interface ReferenceComponent {
  source: string;
  normalizedPrice: number;
  priceObservedAtMs: number;
  conversionObservedAtMs: number;
  receivedAtMs: number;
}

export interface AnchoredReversionObservation {
  venue: string;
  symbol: string;
  targetSequence: number;
  targetExchangeTimestampNs?: string;
  observedAtMs: number;
  quoteTicket: number;
  targetMid: number;
  referencePrice: number;
  referenceDispersionBps: number;
  deviationBps: number;
  direction: DislocationDirection;
  /** Current P300 envelope can monetize only buy-first Spot observations. */
  executableLongOnly: boolean;
  hypotheticalMakerEntryPrice: number | null;
  orderBookImbalance: number;
  economics: OrderBookEconomics;
  references: ReferenceComponent[];
}

function assertPositiveFinite(value: number, label: string): void {
  if (!(Number.isFinite(value) && value > 0)) throw new Error(`${label} must be positive and finite`);
}

function assertNonNegativeFinite(value: number, label: string): void {
  if (!(Number.isFinite(value) && value >= 0)) throw new Error(`${label} must be non-negative and finite`);
}

function validateTimestamp(value: number, nowMs: number, maxAgeMs: number, maxFutureSkewMs: number, label: string): void {
  assertPositiveFinite(value, label);
  if (value > nowMs + maxFutureSkewMs) throw new Error(`${label} is future-dated`);
  if (nowMs - value > maxAgeMs) throw new Error(`${label} is stale`);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function normalizeReferences(
  references: NormalizedReferenceInput[],
  config: AnchoredReversionConfig,
): { components: ReferenceComponent[]; referencePrice: number; dispersionBps: number } {
  if (!Number.isInteger(config.minReferenceSources) || config.minReferenceSources < 2) {
    throw new Error('minReferenceSources must be an integer >= 2');
  }
  if (references.length < config.minReferenceSources) {
    throw new Error('insufficient independent reference sources');
  }

  const sources = new Set<string>();
  const components = references.map((reference) => {
    const source = reference.source.trim();
    if (!source) throw new Error('reference source is required');
    if (sources.has(source)) throw new Error('duplicate reference source');
    sources.add(source);

    assertPositiveFinite(reference.sourcePrice, 'reference sourcePrice');
    assertPositiveFinite(reference.sourceQuoteToTargetQuote, 'reference quote conversion');
    validateTimestamp(reference.priceObservedAtMs, config.nowMs, config.maxDataAgeMs, config.maxFutureSkewMs, 'reference price timestamp');
    validateTimestamp(reference.conversionObservedAtMs, config.nowMs, config.maxDataAgeMs, config.maxFutureSkewMs, 'reference conversion timestamp');
    validateTimestamp(reference.receivedAtMs, config.nowMs, config.maxDataAgeMs, config.maxFutureSkewMs, 'reference receive timestamp');

    const normalizedPrice = reference.sourcePrice * reference.sourceQuoteToTargetQuote;
    assertPositiveFinite(normalizedPrice, 'normalized reference price');

    return {
      source,
      normalizedPrice,
      priceObservedAtMs: reference.priceObservedAtMs,
      conversionObservedAtMs: reference.conversionObservedAtMs,
      receivedAtMs: reference.receivedAtMs,
    };
  });

  const normalizedPrices = components.map((component) => component.normalizedPrice);
  const referencePrice = median(normalizedPrices);
  const minPrice = Math.min(...normalizedPrices);
  const maxPrice = Math.max(...normalizedPrices);
  const dispersionBps = ((maxPrice - minPrice) / referencePrice) * 10_000;
  assertNonNegativeFinite(dispersionBps, 'reference dispersion');
  if (dispersionBps > config.maxReferenceDispersionBps) {
    throw new Error('reference sources disagree beyond allowed dispersion');
  }

  return { components, referencePrice, dispersionBps };
}

export function calculateOrderBookImbalance(book: OrderBookSnapshot, levels: number): number {
  if (!Number.isInteger(levels) || levels <= 0) throw new Error('imbalanceLevels must be a positive integer');
  if (!book.bids.length || !book.asks.length) throw new Error('order book requires bids and asks');

  const bids = [...book.bids].sort((a, b) => b.price - a.price).slice(0, levels);
  const asks = [...book.asks].sort((a, b) => a.price - b.price).slice(0, levels);

  const bidQuoteDepth = bids.reduce((sum, level) => {
    assertPositiveFinite(level.price, 'bid price');
    assertPositiveFinite(level.baseQty, 'bid quantity');
    return sum + level.price * level.baseQty;
  }, 0);
  const askQuoteDepth = asks.reduce((sum, level) => {
    assertPositiveFinite(level.price, 'ask price');
    assertPositiveFinite(level.baseQty, 'ask quantity');
    return sum + level.price * level.baseQty;
  }, 0);

  const total = bidQuoteDepth + askQuoteDepth;
  assertPositiveFinite(total, 'combined quote depth');
  const imbalance = (bidQuoteDepth - askQuoteDepth) / total;
  if (!Number.isFinite(imbalance) || imbalance < -1 || imbalance > 1) {
    throw new Error('derived order-book imbalance is invalid');
  }
  return imbalance;
}

/**
 * Builds a read-only research observation. It has no exchange client and no
 * order-submission capability. The caller must provide a synchronized target
 * book and independently observed/normalized reference inputs.
 */
export function buildAnchoredReversionObservation(
  target: SynchronizedTargetBook,
  references: NormalizedReferenceInput[],
  config: AnchoredReversionConfig,
): AnchoredReversionObservation {
  assertPositiveFinite(config.nowMs, 'nowMs');
  assertPositiveFinite(config.quoteTicket, 'quoteTicket');
  assertPositiveFinite(config.maxDataAgeMs, 'maxDataAgeMs');
  assertNonNegativeFinite(config.maxFutureSkewMs, 'maxFutureSkewMs');
  assertNonNegativeFinite(config.maxCrossFeedReceiveSkewMs, 'maxCrossFeedReceiveSkewMs');
  assertNonNegativeFinite(config.maxReferenceDispersionBps, 'maxReferenceDispersionBps');

  if (!target.venue.trim()) throw new Error('target venue is required');
  if (!target.symbol.trim()) throw new Error('target symbol is required');
  if (!Number.isSafeInteger(target.sequence) || target.sequence < 0) {
    throw new Error('target sequence must be a non-negative safe integer');
  }
  if (target.exchangeTimestampNs !== undefined && !/^\d+$/.test(target.exchangeTimestampNs)) {
    throw new Error('target exchangeTimestampNs must be an integer string');
  }

  validateTimestamp(target.exchangeObservedAtMs, config.nowMs, config.maxDataAgeMs, config.maxFutureSkewMs, 'target exchange timestamp');
  validateTimestamp(target.receivedAtMs, config.nowMs, config.maxDataAgeMs, config.maxFutureSkewMs, 'target receive timestamp');

  const normalized = normalizeReferences(references, config);
  const receiveTimes = [target.receivedAtMs, ...normalized.components.map((component) => component.receivedAtMs)];
  const receiveSkew = Math.max(...receiveTimes) - Math.min(...receiveTimes);
  if (receiveSkew > config.maxCrossFeedReceiveSkewMs) {
    throw new Error('cross-feed receive skew exceeds allowed maximum');
  }

  const economics = evaluateOrderBookEconomics(target.book, config.quoteTicket);
  const deviationBps = ((economics.mid - normalized.referencePrice) / normalized.referencePrice) * 10_000;
  if (!Number.isFinite(deviationBps)) throw new Error('derived deviation is not finite');

  const epsilon = 1e-9;
  const direction: DislocationDirection = Math.abs(deviationBps) <= epsilon
    ? 'flat'
    : deviationBps < 0
      ? 'underpriced'
      : 'overpriced';
  const executableLongOnly = direction === 'underpriced';
  const hypotheticalMakerEntryPrice = direction === 'underpriced'
    ? economics.bestBid
    : direction === 'overpriced'
      ? economics.bestAsk
      : null;

  return {
    venue: target.venue,
    symbol: target.symbol,
    targetSequence: target.sequence,
    targetExchangeTimestampNs: target.exchangeTimestampNs,
    observedAtMs: config.nowMs,
    quoteTicket: config.quoteTicket,
    targetMid: economics.mid,
    referencePrice: normalized.referencePrice,
    referenceDispersionBps: normalized.dispersionBps,
    deviationBps,
    direction,
    executableLongOnly,
    hypotheticalMakerEntryPrice,
    orderBookImbalance: calculateOrderBookImbalance(target.book, config.imbalanceLevels),
    economics,
    references: normalized.components,
  };
}
