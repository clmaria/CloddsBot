import type { NormalizedReferenceInput, SynchronizedTargetBook } from './anchored-reversion-evidence';
import {
  bitvavoStateToOrderBook,
  bitvavoTimestampNsToMs,
  type BitvavoLocalBookState,
} from './bitvavo-book-sync';
import type { ObservedPublicTrade } from './conservative-maker-fill';

export interface PublicTopOfBook {
  source: 'coinbase' | 'binance';
  instrument: string;
  bid: number;
  ask: number;
  observedAtMs: number;
  receivedAtMs: number;
  sequence?: number;
}

export interface UsdcReferenceState {
  coinbaseBtcUsd?: PublicTopOfBook;
  coinbaseUsdcUsd?: PublicTopOfBook;
  binanceBtcUsdt?: PublicTopOfBook;
  binanceUsdcUsdt?: PublicTopOfBook;
}

function positiveFinite(value: unknown, label: string): number {
  const number = typeof value === 'number' ? value : Number(value);
  if (!(Number.isFinite(number) && number > 0)) throw new Error(`${label} must be positive and finite`);
  return number;
}

function safeNonNegativeInteger(value: unknown, label: string): number {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new Error(`${label} must be a non-negative safe integer`);
  return number;
}

function validateBook(bid: number, ask: number): void {
  if (ask < bid) throw new Error('reference top of book is crossed');
}

function midpoint(book: PublicTopOfBook): number {
  validateBook(book.bid, book.ask);
  return (book.bid + book.ask) / 2;
}

/**
 * JSON.parse() cannot preserve 18-19 digit epoch-nanosecond integers. Protect
 * Bitvavo's documented timestamp/timestampNs fields before parsing. Millisecond
 * timestamps remain numbers because they are below this length threshold.
 */
export function parseBitvavoPrecisionSafeJson(raw: string): unknown {
  if (typeof raw !== 'string' || raw.length === 0) throw new Error('Bitvavo payload must be a non-empty string');
  const protectedRaw = raw.replace(
    /(\"(?:timestampNs|timestamp)\"\s*:\s*)(\d{16,})(?=\s*[,}])/g,
    '$1"$2"',
  );
  return JSON.parse(protectedRaw) as unknown;
}

export function parseCoinbaseTicker(
  payload: unknown,
  receivedAtMs: number,
): PublicTopOfBook | null {
  if (!(Number.isFinite(receivedAtMs) && receivedAtMs > 0)) throw new Error('receivedAtMs must be positive and finite');
  if (!payload || typeof payload !== 'object') throw new Error('Coinbase payload must be an object');
  const item = payload as Record<string, unknown>;
  if (item.type !== 'ticker') return null;
  if (typeof item.product_id !== 'string' || !item.product_id.trim()) throw new Error('Coinbase product_id is required');
  if (typeof item.time !== 'string') throw new Error('Coinbase ticker time is required');
  const observedAtMs = Date.parse(item.time);
  if (!Number.isFinite(observedAtMs) || observedAtMs <= 0) throw new Error('Coinbase ticker time is invalid');

  const bid = positiveFinite(item.best_bid, 'Coinbase best_bid');
  const ask = positiveFinite(item.best_ask, 'Coinbase best_ask');
  validateBook(bid, ask);

  const sequence = item.sequence === undefined
    ? undefined
    : safeNonNegativeInteger(item.sequence, 'Coinbase sequence');

  return {
    source: 'coinbase',
    instrument: item.product_id,
    bid,
    ask,
    observedAtMs,
    receivedAtMs,
    sequence,
  };
}

export function parseBinanceTicker(
  payload: unknown,
  receivedAtMs: number,
): PublicTopOfBook | null {
  if (!(Number.isFinite(receivedAtMs) && receivedAtMs > 0)) throw new Error('receivedAtMs must be positive and finite');
  if (!payload || typeof payload !== 'object') throw new Error('Binance payload must be an object');
  const item = payload as Record<string, unknown>;
  if (item.e !== '24hrTicker') return null;
  if (typeof item.s !== 'string' || !item.s.trim()) throw new Error('Binance symbol is required');
  const observedAtMs = positiveFinite(item.E, 'Binance event time');
  const bid = positiveFinite(item.b, 'Binance best bid');
  const ask = positiveFinite(item.a, 'Binance best ask');
  validateBook(bid, ask);

  return {
    source: 'binance',
    instrument: item.s,
    bid,
    ask,
    observedAtMs,
    receivedAtMs,
  };
}

export function updateUsdcReferenceState(
  state: UsdcReferenceState,
  quote: PublicTopOfBook,
): UsdcReferenceState {
  const next = { ...state };
  if (quote.source === 'coinbase') {
    if (quote.instrument === 'BTC-USD') next.coinbaseBtcUsd = quote;
    else if (quote.instrument === 'USDC-USD') next.coinbaseUsdcUsd = quote;
  } else {
    if (quote.instrument === 'BTCUSDT') next.binanceBtcUsdt = quote;
    else if (quote.instrument === 'USDCUSDT') next.binanceUsdcUsdt = quote;
  }
  return next;
}

export function buildUsdcReferenceInputs(state: UsdcReferenceState): NormalizedReferenceInput[] {
  const references: NormalizedReferenceInput[] = [];

  if (state.coinbaseBtcUsd && state.coinbaseUsdcUsd) {
    const btcUsd = midpoint(state.coinbaseBtcUsd);
    const usdcUsd = midpoint(state.coinbaseUsdcUsd);
    references.push({
      source: 'coinbase-btc-usd-via-usdc-usd',
      sourcePrice: btcUsd,
      sourceQuoteToTargetQuote: 1 / usdcUsd,
      priceObservedAtMs: state.coinbaseBtcUsd.observedAtMs,
      conversionObservedAtMs: state.coinbaseUsdcUsd.observedAtMs,
      receivedAtMs: Math.max(state.coinbaseBtcUsd.receivedAtMs, state.coinbaseUsdcUsd.receivedAtMs),
    });
  }

  if (state.binanceBtcUsdt && state.binanceUsdcUsdt) {
    const btcUsdt = midpoint(state.binanceBtcUsdt);
    const usdcUsdt = midpoint(state.binanceUsdcUsdt);
    references.push({
      source: 'binance-btc-usdt-via-usdc-usdt',
      sourcePrice: btcUsdt,
      sourceQuoteToTargetQuote: 1 / usdcUsdt,
      priceObservedAtMs: state.binanceBtcUsdt.observedAtMs,
      conversionObservedAtMs: state.binanceUsdcUsdt.observedAtMs,
      receivedAtMs: Math.max(state.binanceBtcUsdt.receivedAtMs, state.binanceUsdcUsdt.receivedAtMs),
    });
  }

  return references;
}

export function targetFromBitvavoLocalBook(
  state: BitvavoLocalBookState,
  receivedAtMs: number,
): SynchronizedTargetBook {
  if (!(Number.isFinite(receivedAtMs) && receivedAtMs > 0)) throw new Error('receivedAtMs must be positive and finite');
  if (!state.exchangeTimestampNs) throw new Error('Bitvavo synchronized book is missing exchange timestamp');
  return {
    venue: 'bitvavo',
    symbol: state.market,
    sequence: state.nonce,
    exchangeTimestampNs: state.exchangeTimestampNs,
    exchangeObservedAtMs: bitvavoTimestampNsToMs(state.exchangeTimestampNs),
    receivedAtMs,
    book: bitvavoStateToOrderBook(state),
  };
}

export function parseBitvavoTrade(
  payload: unknown,
): ObservedPublicTrade | null {
  if (!payload || typeof payload !== 'object') throw new Error('Bitvavo trade payload must be an object');
  const item = payload as Record<string, unknown>;
  if (item.event !== 'trade') return null;
  if (typeof item.id !== 'string' || !item.id.trim()) throw new Error('Bitvavo trade id is required');
  if (typeof item.market !== 'string' || !item.market.trim()) throw new Error('Bitvavo trade market is required');
  if (item.side !== 'buy' && item.side !== 'sell') throw new Error('Bitvavo trade side is invalid');
  if (typeof item.timestampNs !== 'string' || !/^\d+$/.test(item.timestampNs)) {
    throw new Error('Bitvavo trade timestampNs must be a precision-safe integer string');
  }
  return {
    id: item.id,
    market: item.market,
    takerSide: item.side,
    price: positiveFinite(item.price, 'Bitvavo trade price'),
    baseQty: positiveFinite(item.amount, 'Bitvavo trade amount'),
    timestampNs: item.timestampNs,
  };
}
