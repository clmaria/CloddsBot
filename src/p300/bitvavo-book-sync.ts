import type { BookLevel, OrderBookSnapshot } from './order-book-economics';

export interface BitvavoSnapshotLike {
  market?: unknown;
  nonce?: unknown;
  bids?: unknown;
  asks?: unknown;
  timestamp?: unknown;
}

export interface BitvavoBookUpdateLike {
  event?: unknown;
  market?: unknown;
  nonce?: unknown;
  bids?: unknown;
  asks?: unknown;
  timestamp?: unknown;
}

export interface BitvavoLocalBookState {
  market: string;
  nonce: number;
  bids: Record<string, string>;
  asks: Record<string, string>;
  /** Nanosecond exchange timestamp kept as decimal text to avoid JS precision loss. */
  exchangeTimestampNs?: string;
}

function parseMarket(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Bitvavo market is required');
  return value.trim();
}

function parseNonce(value: unknown): number {
  const nonce = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(nonce) || nonce < 0) throw new Error('Bitvavo nonce must be a non-negative safe integer');
  return nonce;
}

function parseTimestampNs(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const timestamp = typeof value === 'bigint' ? value.toString() : String(value);
  if (!/^\d+$/.test(timestamp)) throw new Error('Bitvavo timestamp must be an integer nanosecond string');
  return timestamp;
}

function parseDecimal(value: unknown, label: string, allowZero: boolean): string {
  if (typeof value !== 'string' && typeof value !== 'number') throw new Error(`${label} must be numeric`);
  const text = String(value);
  const parsed = Number(text);
  const valid = Number.isFinite(parsed) && (allowZero ? parsed >= 0 : parsed > 0);
  if (!valid) throw new Error(`${label} is invalid`);
  return text;
}

function parseSide(side: unknown, allowZeroQty: boolean): Array<[string, string]> {
  if (!Array.isArray(side)) throw new Error('Bitvavo book side must be an array');
  return side.map((level) => {
    if (!Array.isArray(level) || level.length < 2) throw new Error('Bitvavo book level is malformed');
    const price = parseDecimal(level[0], 'Bitvavo price', false);
    const qty = parseDecimal(level[1], 'Bitvavo quantity', allowZeroQty);
    return [price, qty];
  });
}

function sideToRecord(levels: Array<[string, string]>, label: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [price, qty] of levels) {
    if (Number(qty) <= 0) throw new Error(`${label} snapshot contains zero quantity`);
    if (Object.prototype.hasOwnProperty.call(result, price)) throw new Error(`${label} snapshot contains duplicate price`);
    result[price] = qty;
  }
  if (Object.keys(result).length === 0) throw new Error(`${label} snapshot is empty`);
  return result;
}

function recordToLevels(side: Record<string, string>, descending: boolean): BookLevel[] {
  const levels = Object.entries(side).map(([priceText, qtyText]) => {
    const price = Number(priceText);
    const baseQty = Number(qtyText);
    if (!(Number.isFinite(price) && price > 0 && Number.isFinite(baseQty) && baseQty > 0)) {
      throw new Error('Bitvavo local book contains invalid level');
    }
    return { price, baseQty };
  });
  if (!levels.length) throw new Error('Bitvavo local book side is empty');
  return levels.sort((a, b) => descending ? b.price - a.price : a.price - b.price);
}

function validateNotCrossed(state: BitvavoLocalBookState): void {
  const book = bitvavoStateToOrderBook(state);
  if (book.asks[0].price < book.bids[0].price) throw new Error('Bitvavo local book is crossed');
}

export function createBitvavoLocalBook(snapshot: BitvavoSnapshotLike): BitvavoLocalBookState {
  const market = parseMarket(snapshot.market);
  const nonce = parseNonce(snapshot.nonce);
  const bids = sideToRecord(parseSide(snapshot.bids, false), 'bid');
  const asks = sideToRecord(parseSide(snapshot.asks, false), 'ask');

  const state: BitvavoLocalBookState = {
    market,
    nonce,
    bids,
    asks,
    exchangeTimestampNs: parseTimestampNs(snapshot.timestamp),
  };
  validateNotCrossed(state);
  return state;
}

function applySideUpdate(current: Record<string, string>, rawSide: unknown): Record<string, string> {
  const next = { ...current };
  for (const [price, qty] of parseSide(rawSide, true)) {
    if (Number(qty) === 0) delete next[price];
    else next[price] = qty;
  }
  if (!Object.keys(next).length) throw new Error('Bitvavo update would empty an order-book side');
  return next;
}

export function applyBitvavoBookUpdate(
  state: BitvavoLocalBookState,
  update: BitvavoBookUpdateLike,
): BitvavoLocalBookState {
  if (update.event !== undefined && update.event !== 'book') throw new Error('Bitvavo update is not a book event');
  const market = parseMarket(update.market);
  if (market !== state.market) throw new Error('Bitvavo update market does not match local book');

  const nonce = parseNonce(update.nonce);
  if (!Number.isSafeInteger(state.nonce + 1)) throw new Error('Bitvavo nonce cannot be incremented safely');
  if (nonce !== state.nonce + 1) throw new Error('Bitvavo sequence gap or duplicate update');

  const next: BitvavoLocalBookState = {
    market: state.market,
    nonce,
    bids: applySideUpdate(state.bids, update.bids ?? []),
    asks: applySideUpdate(state.asks, update.asks ?? []),
    exchangeTimestampNs: parseTimestampNs(update.timestamp) ?? state.exchangeTimestampNs,
  };
  validateNotCrossed(next);
  return next;
}

/**
 * Reconciles a REST/WS snapshot with buffered book events. Updates at or below
 * the snapshot nonce are discarded; every remaining event must then be exactly
 * contiguous. Any gap/duplicate fails closed so the caller can restart sync.
 */
export function synchronizeBitvavoBook(
  snapshot: BitvavoSnapshotLike,
  bufferedUpdates: BitvavoBookUpdateLike[],
): BitvavoLocalBookState {
  let state = createBitvavoLocalBook(snapshot);
  const applicable = bufferedUpdates
    .map((update, index) => ({ update, nonce: parseNonce(update.nonce), index }))
    .filter((item) => item.nonce > state.nonce)
    .sort((a, b) => a.nonce - b.nonce || a.index - b.index);

  for (const item of applicable) state = applyBitvavoBookUpdate(state, item.update);
  return state;
}

export function bitvavoStateToOrderBook(state: BitvavoLocalBookState): OrderBookSnapshot {
  return {
    bids: recordToLevels(state.bids, true),
    asks: recordToLevels(state.asks, false),
  };
}

/** Safely derives epoch milliseconds from a nanosecond timestamp string. */
export function bitvavoTimestampNsToMs(timestampNs: string): number {
  if (!/^\d+$/.test(timestampNs)) throw new Error('Bitvavo timestamp must be an integer nanosecond string');
  const msBigInt = BigInt(timestampNs) / 1_000_000n;
  const ms = Number(msBigInt);
  if (!Number.isSafeInteger(ms) || ms <= 0) throw new Error('Bitvavo timestamp milliseconds are invalid');
  return ms;
}
