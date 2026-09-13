import type { PhaseAReceiveStamp } from './phase-a-public-feed-parsers';

export interface ParsedBitvavoTicker {
  market: string;
  bid: number;
  bidSize: number;
  ask: number;
  askSize: number;
  lastPrice: number;
  stamp: PhaseAReceiveStamp;
}

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown, label: string): UnknownRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as UnknownRecord;
}

function parseText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`);
  return value.trim();
}

function parsePositiveNumber(value: unknown, label: string): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!(Number.isFinite(parsed) && parsed > 0)) throw new Error(`${label} must be positive and finite`);
  return parsed;
}

function validateStamp(stamp: PhaseAReceiveStamp): PhaseAReceiveStamp {
  if (!/^\d+$/.test(stamp.receivedMonoNs)) {
    throw new Error('receivedMonoNs must be a precision-safe integer nanosecond string');
  }
  if (!Number.isFinite(stamp.receivedAtMs)) throw new Error('receivedAtMs must be finite');
  return stamp;
}

function validateTopOfBook(bid: number, ask: number): void {
  if (bid > ask) throw new Error('Bitvavo ticker top of book is crossed');
}

/**
 * Parse Bitvavo's public WebSocket `ticker` event used as the Phase-A BBO
 * trigger. The event intentionally has no exchange timestamp; causality comes
 * only from the same-process receive stamp captured by the caller.
 */
export function parseBitvavoTickerRaw(
  raw: string,
  stampInput: PhaseAReceiveStamp,
  expectedMarket = 'BTC-USDC',
): ParsedBitvavoTicker | null {
  const stamp = validateStamp(stampInput);
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('Bitvavo ticker message must be non-empty JSON text');

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error('Bitvavo ticker message is invalid JSON');
  }
  const root = asRecord(parsed, 'Bitvavo ticker message');

  if (root.event === 'subscribed' && 'subscriptions' in root) return null;
  if (root.event !== 'ticker') return null;

  const market = parseText(root.market, 'Bitvavo ticker market');
  if (market !== expectedMarket) throw new Error(`unexpected Bitvavo ticker market ${market}`);

  const bid = parsePositiveNumber(root.bestBid, 'Bitvavo best bid');
  const bidSize = parsePositiveNumber(root.bestBidSize, 'Bitvavo best bid size');
  const ask = parsePositiveNumber(root.bestAsk, 'Bitvavo best ask');
  const askSize = parsePositiveNumber(root.bestAskSize, 'Bitvavo best ask size');
  const lastPrice = parsePositiveNumber(root.lastPrice, 'Bitvavo last price');
  validateTopOfBook(bid, ask);

  return {
    market,
    bid,
    bidSize,
    ask,
    askSize,
    lastPrice,
    stamp,
  };
}
