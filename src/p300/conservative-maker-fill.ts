import type { OrderBookSnapshot } from './order-book-economics';

export type MakerSide = 'buy' | 'sell';
export type MakerFillStatus = 'rejected-post-only' | 'unfilled' | 'partially-filled' | 'filled';
export type MakerFillEvidence = 'post-only-reject' | 'none' | 'trade-at-price' | 'trade-through';

export interface ObservedPublicTrade {
  id: string;
  market: string;
  /** Side of the taker, matching Bitvavo's public trades schema. */
  takerSide: 'buy' | 'sell';
  price: number;
  baseQty: number;
  /** Precision-safe exchange timestamp. Never pass a JS number at ns epoch scale. */
  timestampNs: string;
}

export interface ConservativeMakerFillRequest {
  market: string;
  side: MakerSide;
  limitPrice: number;
  baseQty: number;
  activatedAtNs: string;
  /** Last exchange timestamp at which the hypothetical order is considered live. */
  activeUntilNs: string;
  activationBook: OrderBookSnapshot;
  trades: ObservedPublicTrade[];
  /** Caller attests there was no detected gap/disconnect in the trade stream. */
  tradeStreamIntegrityVerified: boolean;
  /** Trade-through inference is valid only during regular matching. */
  regularTradingVerified: boolean;
}

export interface ConservativeMakerFillResult {
  status: MakerFillStatus;
  evidence: MakerFillEvidence;
  market: string;
  side: MakerSide;
  limitPrice: number;
  requestedBase: number;
  filledBase: number;
  remainingBase: number;
  queueAheadBaseInitial: number;
  queueAheadBaseRemaining: number;
  firstFillTimestampNs?: string;
  fullFillTimestampNs?: string;
}

function assertPositiveFinite(value: number, label: string): void {
  if (!(Number.isFinite(value) && value > 0)) throw new Error(`${label} must be positive and finite`);
}

function parseNs(value: unknown, label: string): bigint {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw new Error(`${label} must be a precision-safe integer nanosecond string`);
  }
  return BigInt(value);
}

function validateBook(book: OrderBookSnapshot): { bestBid: number; bestAsk: number } {
  if (!book.bids.length || !book.asks.length) throw new Error('activation book requires bids and asks');
  for (const level of [...book.bids, ...book.asks]) {
    assertPositiveFinite(level.price, 'book price');
    assertPositiveFinite(level.baseQty, 'book quantity');
  }
  const bestBid = Math.max(...book.bids.map((level) => level.price));
  const bestAsk = Math.min(...book.asks.map((level) => level.price));
  if (bestAsk < bestBid) throw new Error('activation book is crossed');
  return { bestBid, bestAsk };
}

function samePrice(left: number, right: number): boolean {
  const tolerance = Math.max(1e-12, Math.max(Math.abs(left), Math.abs(right)) * 1e-12);
  return Math.abs(left - right) <= tolerance;
}

function queueAtPrice(book: OrderBookSnapshot, side: MakerSide, limitPrice: number): number {
  const levels = side === 'buy' ? book.bids : book.asks;
  return levels.reduce((sum, level) => samePrice(level.price, limitPrice) ? sum + level.baseQty : sum, 0);
}

function validatesTrade(trade: ObservedPublicTrade, expectedMarket: string): bigint {
  if (!trade.id.trim()) throw new Error('trade id is required');
  if (trade.market !== expectedMarket) throw new Error('trade market does not match fill request');
  if (trade.takerSide !== 'buy' && trade.takerSide !== 'sell') throw new Error('invalid taker side');
  assertPositiveFinite(trade.price, 'trade price');
  assertPositiveFinite(trade.baseQty, 'trade base quantity');
  return parseNs(trade.timestampNs, 'trade timestampNs');
}

/**
 * Conservative PAPER-only maker fill inference under price-time priority.
 *
 * - The hypothetical order joins behind all displayed quantity already resting
 *   at its exact price at activation.
 * - Cancellations NEVER reduce queue-ahead in this model; this intentionally
 *   understates fills rather than granting unknowable queue improvement.
 * - Only opposite-side taker trades at the limit consume queue ahead.
 * - A trade through the limit implies full fill only when the caller verifies
 *   continuous trade-stream integrity and regular trading.
 * - Fills are bounded by an explicit predeclared active window; later trades
 *   cannot retroactively fill an order that the strategy would have cancelled.
 * - This function performs no networking and cannot place or cancel orders.
 */
export function simulateConservativeMakerFill(
  request: ConservativeMakerFillRequest,
): ConservativeMakerFillResult {
  const market = request.market.trim();
  if (!market) throw new Error('market is required');
  if (request.side !== 'buy' && request.side !== 'sell') throw new Error('invalid maker side');
  assertPositiveFinite(request.limitPrice, 'limitPrice');
  assertPositiveFinite(request.baseQty, 'baseQty');
  const activatedAtNs = parseNs(request.activatedAtNs, 'activatedAtNs');
  const activeUntilNs = parseNs(request.activeUntilNs, 'activeUntilNs');
  if (activeUntilNs <= activatedAtNs) throw new Error('activeUntilNs must be after activatedAtNs');
  if (!request.tradeStreamIntegrityVerified) throw new Error('trade stream integrity is not verified');
  if (!request.regularTradingVerified) throw new Error('regular trading is not verified');

  const { bestBid, bestAsk } = validateBook(request.activationBook);
  const postOnlyWouldCross = request.side === 'buy'
    ? request.limitPrice >= bestAsk
    : request.limitPrice <= bestBid;
  const queueAheadBaseInitial = queueAtPrice(request.activationBook, request.side, request.limitPrice);

  if (postOnlyWouldCross) {
    return {
      status: 'rejected-post-only',
      evidence: 'post-only-reject',
      market,
      side: request.side,
      limitPrice: request.limitPrice,
      requestedBase: request.baseQty,
      filledBase: 0,
      remainingBase: request.baseQty,
      queueAheadBaseInitial,
      queueAheadBaseRemaining: queueAheadBaseInitial,
    };
  }

  const seenIds = new Set<string>();
  const trades = request.trades.map((trade, index) => {
    const timestamp = validatesTrade(trade, market);
    if (seenIds.has(trade.id)) throw new Error('duplicate trade id');
    seenIds.add(trade.id);
    return { trade, timestamp, index };
  }).sort((a, b) => a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : a.index - b.index);

  let queueAheadBaseRemaining = queueAheadBaseInitial;
  let filledBase = 0;
  let firstFillTimestampNs: string | undefined;
  let fullFillTimestampNs: string | undefined;
  let evidence: MakerFillEvidence = 'none';

  for (const item of trades) {
    if (item.timestamp < activatedAtNs) continue;
    if (item.timestamp > activeUntilNs) break;
    const trade = item.trade;
    const consumesOurSide = request.side === 'buy' ? trade.takerSide === 'sell' : trade.takerSide === 'buy';
    if (!consumesOurSide) continue;

    const tradedThrough = request.side === 'buy'
      ? trade.price < request.limitPrice && !samePrice(trade.price, request.limitPrice)
      : trade.price > request.limitPrice && !samePrice(trade.price, request.limitPrice);

    if (tradedThrough) {
      if (filledBase === 0) firstFillTimestampNs = trade.timestampNs;
      filledBase = request.baseQty;
      queueAheadBaseRemaining = 0;
      fullFillTimestampNs = trade.timestampNs;
      evidence = 'trade-through';
      break;
    }

    if (!samePrice(trade.price, request.limitPrice)) continue;

    let availableBase = trade.baseQty;
    const queueConsumed = Math.min(queueAheadBaseRemaining, availableBase);
    queueAheadBaseRemaining -= queueConsumed;
    availableBase -= queueConsumed;

    if (availableBase <= 0) continue;
    const remainingOrder = request.baseQty - filledBase;
    const newlyFilled = Math.min(remainingOrder, availableBase);
    if (newlyFilled <= 0) continue;

    if (filledBase === 0) firstFillTimestampNs = trade.timestampNs;
    filledBase += newlyFilled;
    evidence = 'trade-at-price';

    if (request.baseQty - filledBase <= 1e-12) {
      filledBase = request.baseQty;
      fullFillTimestampNs = trade.timestampNs;
      break;
    }
  }

  const remainingBase = Math.max(0, request.baseQty - filledBase);
  const status: MakerFillStatus = filledBase <= 1e-12
    ? 'unfilled'
    : remainingBase <= 1e-12
      ? 'filled'
      : 'partially-filled';

  return {
    status,
    evidence,
    market,
    side: request.side,
    limitPrice: request.limitPrice,
    requestedBase: request.baseQty,
    filledBase,
    remainingBase,
    queueAheadBaseInitial,
    queueAheadBaseRemaining,
    firstFillTimestampNs,
    fullFillTimestampNs,
  };
}
