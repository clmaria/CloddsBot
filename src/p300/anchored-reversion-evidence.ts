import { evaluateOrderBookEconomics, type OrderBookEconomics, type OrderBookSnapshot } from './order-book-economics';

export type DislocationDirection = 'underpriced' | 'overpriced' | 'flat';

export interface NormalizedReferenceInput {
  /** Unique source label, e.g. coinbase-btc-usdc. */
  source: string;
  /** Source price before optional quote conversion. */
  sourcePrice: number;
  /** Multiply sourcePrice by this value to express it in the target quote asset. */
  sourceQuoteToTargetQuote: number;
  /** Optional exchange/event timestamp retained as provenance when semantics are known. */
  priceObservedAtMs?: number;
  /** Optional timestamp for a separate quote-conversion observation. */
  conversionObservedAtMs?: number;
  /** Local wall-clock receive time for audit/log correlation. */
  receivedAtMs: number;
  /** Same-process monotonic receive clock, stored precision-safe as integer nanoseconds. */
  receivedMonoNs: string;
  /** Identifies the process/session whose monotonic clock produced receivedMonoNs. */
  clockDomain: string;
}

export interface SynchronizedTargetBook {
  venue: string;
  symbol: string;
  sequence: number;
  /** Keep the original nanosecond value as text when the venue provides one. */
  exchangeTimestampNs?: string;
  /** Optional exchange event time only when its semantics match this target state. */
  exchangeObservedAtMs?: number;
  /** Local wall-clock receive time for audit/log correlation. */
  receivedAtMs: number;
  /** Same-process monotonic receive clock for ordering/freshness/skew. */
  receivedMonoNs: string;
  /** Identifies the process/session whose monotonic clock produced receivedMonoNs. */
  clockDomain: string;
  book: OrderBookSnapshot;
}

export interface AnchoredReversionConfig {
  /** Local wall-clock now, retained for audit/sanity only. */
  nowMs: number;
  /** Same-process monotonic now used for data age and cross-feed timing. */
  nowMonoNs: string;
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
  priceObservedAtMs?: number;
  conversionObservedAtMs?: number;
  receivedAtMs: number;
  receivedMonoNs: string;
  clockDomain: string;
}

export interface AnchoredReversionObservation {
  venue: string;
  symbol: string;
  targetSequence: number;
  targetExchangeTimestampNs?: string;
  targetExchangeObservedAtMs?: number;
  targetReceivedAtMs: number;
  targetReceivedMonoNs: string;
  clockDomain: string;
  observedAtMs: number;
  observedMonoNs: string;
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

function parseMonoNs(value: unknown, label: string): bigint {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw new Error(`${label} must be a precision-safe integer nanosecond string`);
  }
  return BigInt(value);
}

function msToNs(valueMs: number, label: string): bigint {
  assertNonNegativeFinite(valueMs, label);
  const ns = valueMs * 1_000_000;
  if (!Number.isSafeInteger(ns)) throw new Error(`${label} is too large for safe nanosecond conversion`);
  return BigInt(ns);
}

function validateWallClock(value: number, nowMs: number, maxFutureSkewMs: number, label: string): void {
  assertPositiveFinite(value, label);
  if (value > nowMs + maxFutureSkewMs) throw new Error(`${label} is future-dated`);
}

function validateOptionalExchangeTime(
  value: number | undefined,
  nowMs: number,
  maxFutureSkewMs: number,
  label: string,
): void {
  if (value === undefined) return;
  validateWallClock(value, nowMs, maxFutureSkewMs, label);
}

function validateReceiveClocks(
  receivedAtMs: number,
  receivedMonoNs: string,
  config: AnchoredReversionConfig,
  label: string,
): bigint {
  validateWallClock(receivedAtMs, config.nowMs, config.maxFutureSkewMs, `${label} wall receive timestamp`);
  const nowMonoNs = parseMonoNs(config.nowMonoNs, 'nowMonoNs');
  const receiveMonoNs = parseMonoNs(receivedMonoNs, `${label} receivedMonoNs`);
  if (receiveMonoNs > nowMonoNs) throw new Error(`${label} monotonic receive timestamp is future-dated`);
  const maxAgeNs = msToNs(config.maxDataAgeMs, 'maxDataAgeMs');
  if (nowMonoNs - receiveMonoNs > maxAgeNs) throw new Error(`${label} monotonic receive timestamp is stale`);
  return receiveMonoNs;
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
  expectedClockDomain: string,
): { components: ReferenceComponent[]; referencePrice: number; dispersionBps: number; receiveMonoNs: bigint[] } {
  if (!Number.isInteger(config.minReferenceSources) || config.minReferenceSources < 2) {
    throw new Error('minReferenceSources must be an integer >= 2');
  }
  if (references.length < config.minReferenceSources) {
    throw new Error('insufficient independent reference sources');
  }

  const sources = new Set<string>();
  const receiveMonoNs: bigint[] = [];
  const components = references.map((reference) => {
    const source = reference.source.trim();
    if (!source) throw new Error('reference source is required');
    if (sources.has(source)) throw new Error('duplicate reference source');
    sources.add(source);

    const clockDomain = reference.clockDomain.trim();
    if (!clockDomain) throw new Error('reference clockDomain is required');
    if (clockDomain !== expectedClockDomain) throw new Error('mixed monotonic clock domains');

    assertPositiveFinite(reference.sourcePrice, 'reference sourcePrice');
    assertPositiveFinite(reference.sourceQuoteToTargetQuote, 'reference quote conversion');
    validateOptionalExchangeTime(reference.priceObservedAtMs, config.nowMs, config.maxFutureSkewMs, 'reference price timestamp');
    validateOptionalExchangeTime(reference.conversionObservedAtMs, config.nowMs, config.maxFutureSkewMs, 'reference conversion timestamp');
    const receivedMono = validateReceiveClocks(reference.receivedAtMs, reference.receivedMonoNs, config, 'reference');
    receiveMonoNs.push(receivedMono);

    const normalizedPrice = reference.sourcePrice * reference.sourceQuoteToTargetQuote;
    assertPositiveFinite(normalizedPrice, 'normalized reference price');

    return {
      source,
      normalizedPrice,
      priceObservedAtMs: reference.priceObservedAtMs,
      conversionObservedAtMs: reference.conversionObservedAtMs,
      receivedAtMs: reference.receivedAtMs,
      receivedMonoNs: reference.receivedMonoNs,
      clockDomain,
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

  return { components, referencePrice, dispersionBps, receiveMonoNs };
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
 * order-submission capability. Timing validity is based on same-process local
 * monotonic receive clocks; exchange timestamps are optional provenance only.
 */
export function buildAnchoredReversionObservation(
  target: SynchronizedTargetBook,
  references: NormalizedReferenceInput[],
  config: AnchoredReversionConfig,
): AnchoredReversionObservation {
  assertPositiveFinite(config.nowMs, 'nowMs');
  parseMonoNs(config.nowMonoNs, 'nowMonoNs');
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
  validateOptionalExchangeTime(target.exchangeObservedAtMs, config.nowMs, config.maxFutureSkewMs, 'target exchange timestamp');

  const clockDomain = target.clockDomain.trim();
  if (!clockDomain) throw new Error('target clockDomain is required');
  const targetReceiveMonoNs = validateReceiveClocks(target.receivedAtMs, target.receivedMonoNs, config, 'target');

  const normalized = normalizeReferences(references, config, clockDomain);
  const receiveTimes = [targetReceiveMonoNs, ...normalized.receiveMonoNs];
  const minReceive = receiveTimes.reduce((min, value) => value < min ? value : min);
  const maxReceive = receiveTimes.reduce((max, value) => value > max ? value : max);
  const maxReceiveSkewNs = msToNs(config.maxCrossFeedReceiveSkewMs, 'maxCrossFeedReceiveSkewMs');
  if (maxReceive - minReceive > maxReceiveSkewNs) {
    throw new Error('cross-feed monotonic receive skew exceeds allowed maximum');
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
    targetExchangeObservedAtMs: target.exchangeObservedAtMs,
    targetReceivedAtMs: target.receivedAtMs,
    targetReceivedMonoNs: target.receivedMonoNs,
    clockDomain,
    observedAtMs: config.nowMs,
    observedMonoNs: config.nowMonoNs,
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
