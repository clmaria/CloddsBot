import type { BookLevel, OrderBookSnapshot } from './order-book-economics';

type UnknownArray = unknown[];

function parseLevel(level: unknown, priceIndex = 0, qtyIndex = 1): BookLevel {
  if (!Array.isArray(level)) throw new Error('order book level must be an array');
  const price = Number((level as UnknownArray)[priceIndex]);
  const baseQty = Number((level as UnknownArray)[qtyIndex]);
  if (!Number.isFinite(price) || !Number.isFinite(baseQty) || price <= 0 || baseQty <= 0) {
    throw new Error('invalid order book level');
  }
  return { price, baseQty };
}

function parseSide(side: unknown): BookLevel[] {
  if (!Array.isArray(side) || side.length === 0) throw new Error('order book side is missing or empty');
  return side.map((level) => parseLevel(level));
}

export interface BitvavoBookLike {
  market?: string;
  bids?: unknown;
  asks?: unknown;
}

export function orderBookFromBitvavo(payload: BitvavoBookLike): OrderBookSnapshot {
  return {
    bids: parseSide(payload.bids),
    asks: parseSide(payload.asks),
  };
}

export interface KrakenDepthLike {
  error?: unknown;
  result?: Record<string, { bids?: unknown; asks?: unknown }>;
}

export function orderBookFromKraken(payload: KrakenDepthLike): OrderBookSnapshot {
  if (Array.isArray(payload.error) && payload.error.length > 0) {
    throw new Error(`Kraken depth error: ${payload.error.join(', ')}`);
  }
  const result = payload.result ?? {};
  const entries = Object.values(result);
  if (entries.length !== 1) throw new Error('Kraken depth response must contain exactly one pair');
  return {
    bids: parseSide(entries[0].bids),
    asks: parseSide(entries[0].asks),
  };
}

export interface OkxBooksLike {
  code?: string;
  msg?: string;
  data?: Array<{ bids?: unknown; asks?: unknown }>;
}

export function orderBookFromOkx(payload: OkxBooksLike): OrderBookSnapshot {
  if (payload.code !== undefined && payload.code !== '0') {
    throw new Error(`OKX books error: ${payload.code}${payload.msg ? ` ${payload.msg}` : ''}`);
  }
  if (!Array.isArray(payload.data) || payload.data.length !== 1) {
    throw new Error('OKX books response must contain exactly one data item');
  }
  return {
    bids: parseSide(payload.data[0].bids),
    asks: parseSide(payload.data[0].asks),
  };
}
