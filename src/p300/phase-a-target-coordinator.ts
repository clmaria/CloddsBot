import type { CausalMarketEventInput } from './causal-market-buffer';
import {
  bitvavoStateToOrderBook,
  type BitvavoLocalBookState,
} from './bitvavo-book-sync';
import type { OrderBookSnapshot } from './order-book-economics';
import type { PhaseAReceiveStamp } from './phase-a-public-feed-parsers';
import type { ParsedBitvavoTicker } from './phase-a-bitvavo-ticker';

export interface PhaseAActionableTarget {
  target: CausalMarketEventInput;
  book: OrderBookSnapshot;
  bookNonce: number;
  bookExchangeTimestampNs?: string;
  ticker: ParsedBitvavoTicker;
  bookReceivedMonoNs: string;
  tickerReceivedMonoNs: string;
  actionableReceivedMonoNs: string;
}

export type PhaseATargetAlignmentState =
  | {
      status: 'missing';
      missing: readonly ('book' | 'ticker')[];
      observedThroughMonoNs?: string;
    }
  | {
      status: 'mismatched';
      bookReceivedMonoNs: string;
      tickerReceivedMonoNs: string;
      observedThroughMonoNs: string;
    }
  | {
      status: 'aligned';
      actionable: PhaseAActionableTarget;
      observedThroughMonoNs: string;
    };

interface StampedBookState {
  state: BitvavoLocalBookState;
  stamp: PhaseAReceiveStamp;
}

function parseMonoNs(value: unknown, label: string): bigint {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw new Error(`${label} must be a precision-safe integer nanosecond string`);
  }
  return BigInt(value);
}

function validateStamp(stamp: PhaseAReceiveStamp, label: string): bigint {
  const mono = parseMonoNs(stamp.receivedMonoNs, `${label} receivedMonoNs`);
  if (!Number.isFinite(stamp.receivedAtMs)) throw new Error(`${label} receivedAtMs must be finite`);
  return mono;
}

function sameNumber(left: number, right: number): boolean {
  const tolerance = Math.max(1e-12, Math.max(Math.abs(left), Math.abs(right)) * 1e-12);
  return Math.abs(left - right) <= tolerance;
}

function cloneBookState(state: BitvavoLocalBookState): BitvavoLocalBookState {
  if (!state.market.trim()) throw new Error('Bitvavo local book market is required');
  if (!Number.isSafeInteger(state.nonce) || state.nonce < 0) {
    throw new Error('Bitvavo local book nonce must be a non-negative safe integer');
  }
  if (state.exchangeTimestampNs !== undefined && !/^\d+$/.test(state.exchangeTimestampNs)) {
    throw new Error('Bitvavo local book exchange timestamp must be an integer nanosecond string');
  }
  const cloned: BitvavoLocalBookState = {
    market: state.market,
    nonce: state.nonce,
    bids: { ...state.bids },
    asks: { ...state.asks },
    exchangeTimestampNs: state.exchangeTimestampNs,
  };
  // Reuse the existing canonical book validation instead of maintaining a
  // second validator in the coordinator.
  bitvavoStateToOrderBook(cloned);
  return cloned;
}

function laterStamp(left: PhaseAReceiveStamp, right: PhaseAReceiveStamp): PhaseAReceiveStamp {
  const leftMono = parseMonoNs(left.receivedMonoNs, 'left receivedMonoNs');
  const rightMono = parseMonoNs(right.receivedMonoNs, 'right receivedMonoNs');
  if (leftMono > rightMono) return left;
  if (rightMono > leftMono) return right;
  return {
    receivedMonoNs: left.receivedMonoNs,
    // Wall time is audit-only. For equal monotonic instants keep the later wall
    // value without using it to establish causality.
    receivedAtMs: Math.max(left.receivedAtMs, right.receivedAtMs),
  };
}

/**
 * Pure Phase-A target alignment state machine.
 *
 * It does no networking and does not synchronize Bitvavo books itself; callers
 * must pass a sequence-valid BitvavoLocalBookState produced by the existing
 * book-sync layer. An actionable target exists only when the latest public
 * ticker and synchronized local book agree on top price AND displayed size.
 * The actionable clock is the later same-process monotonic receive instant of
 * those two agreeing states, so evidence is delayed rather than backdated.
 */
export class PhaseATargetCoordinator {
  private readonly expectedMarket: string;
  private latestBook?: StampedBookState;
  private latestTicker?: ParsedBitvavoTicker;
  private lastObservedMonoNs?: bigint;
  private lastEmittedTickerToken?: string;

  constructor(expectedMarket = 'BTC-USDC') {
    const market = expectedMarket.trim();
    if (!market) throw new Error('expected Bitvavo market is required');
    this.expectedMarket = market;
  }

  updateBookState(stateInput: BitvavoLocalBookState, stamp: PhaseAReceiveStamp): PhaseAActionableTarget | null {
    this.observeStamp(stamp, 'book');
    const state = cloneBookState(stateInput);
    if (state.market !== this.expectedMarket) {
      throw new Error(`unexpected Bitvavo local book market ${state.market}`);
    }
    this.latestBook = { state, stamp: { ...stamp } };
    return this.maybeActionable();
  }

  updateTicker(tickerInput: ParsedBitvavoTicker): PhaseAActionableTarget | null {
    this.observeStamp(tickerInput.stamp, 'ticker');
    if (tickerInput.market !== this.expectedMarket) {
      throw new Error(`unexpected Bitvavo ticker market ${tickerInput.market}`);
    }
    this.latestTicker = {
      ...tickerInput,
      stamp: { ...tickerInput.stamp },
    };
    return this.maybeActionable();
  }

  /**
   * Read the latest target-alignment state without treating a prior emission as
   * fresh evidence. This separates state validity from signal deduplication so
   * horizon sampling can fail closed on missing/mismatched inputs.
   */
  currentAlignment(): PhaseATargetAlignmentState {
    return this.evaluateAlignment();
  }

  /** Sequence gap/disconnect callers use this to fail closed until resync. */
  invalidateBook(): void {
    this.latestBook = undefined;
  }

  /** A new process/clock domain must start with no retained target state. */
  resetForNewClockDomain(): void {
    this.latestBook = undefined;
    this.latestTicker = undefined;
    this.lastObservedMonoNs = undefined;
    this.lastEmittedTickerToken = undefined;
  }

  private observeStamp(stamp: PhaseAReceiveStamp, label: string): void {
    const mono = validateStamp(stamp, label);
    if (this.lastObservedMonoNs !== undefined && mono < this.lastObservedMonoNs) {
      throw new Error('Phase-A target receive clock regressed; serialize ingestion or reset the clock domain');
    }
    this.lastObservedMonoNs = mono;
  }

  private evaluateAlignment(): PhaseATargetAlignmentState {
    const missing: ('book' | 'ticker')[] = [];
    if (!this.latestBook) missing.push('book');
    if (!this.latestTicker) missing.push('ticker');
    if (missing.length > 0) {
      const observedThroughMonoNs = this.lastObservedMonoNs?.toString();
      return Object.freeze({
        status: 'missing' as const,
        missing: Object.freeze(missing),
        ...(observedThroughMonoNs !== undefined ? { observedThroughMonoNs } : {}),
      });
    }

    const { state, stamp: bookStamp } = this.latestBook!;
    const ticker = this.latestTicker!;
    const book = bitvavoStateToOrderBook(state);
    const bestBid = book.bids[0];
    const bestAsk = book.asks[0];
    if (!bestBid || !bestAsk) throw new Error('synchronized Bitvavo book has no top of book');

    const observedThrough = laterStamp(bookStamp, ticker.stamp);
    const agrees =
      sameNumber(bestBid.price, ticker.bid) &&
      sameNumber(bestBid.baseQty, ticker.bidSize) &&
      sameNumber(bestAsk.price, ticker.ask) &&
      sameNumber(bestAsk.baseQty, ticker.askSize);
    if (!agrees) {
      return Object.freeze({
        status: 'mismatched' as const,
        bookReceivedMonoNs: bookStamp.receivedMonoNs,
        tickerReceivedMonoNs: ticker.stamp.receivedMonoNs,
        observedThroughMonoNs: observedThrough.receivedMonoNs,
      });
    }

    const target: CausalMarketEventInput = {
      venue: 'bitvavo',
      symbol: state.market,
      bid: bestBid.price,
      ask: bestAsk.price,
      receivedMonoNs: observedThrough.receivedMonoNs,
      receivedAtMs: observedThrough.receivedAtMs,
      // The book timestamp is the last transaction timestamp, not this book
      // mutation's event time. Keep it separately as provenance; never place it
      // in sourceObservedAtMs where a consumer could mistake it for causality.
      sourceSequence: state.nonce,
    };

    const actionable: PhaseAActionableTarget = {
      target,
      book,
      bookNonce: state.nonce,
      bookExchangeTimestampNs: state.exchangeTimestampNs,
      ticker: { ...ticker, stamp: { ...ticker.stamp } },
      bookReceivedMonoNs: bookStamp.receivedMonoNs,
      tickerReceivedMonoNs: ticker.stamp.receivedMonoNs,
      actionableReceivedMonoNs: observedThrough.receivedMonoNs,
    };
    return Object.freeze({
      status: 'aligned' as const,
      actionable,
      observedThroughMonoNs: observedThrough.receivedMonoNs,
    });
  }

  private maybeActionable(): PhaseAActionableTarget | null {
    const alignment = this.evaluateAlignment();
    if (alignment.status !== 'aligned') return null;

    const { ticker } = alignment.actionable;
    const tickerToken = [
      ticker.stamp.receivedMonoNs,
      ticker.bid,
      ticker.bidSize,
      ticker.ask,
      ticker.askSize,
    ].join('|');
    if (tickerToken === this.lastEmittedTickerToken) return null;

    this.lastEmittedTickerToken = tickerToken;
    return alignment.actionable;
  }
}
