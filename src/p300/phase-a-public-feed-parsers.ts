import type { CausalMarketEventInput } from './causal-market-buffer';
import type {
  BitvavoBookUpdateLike,
  BitvavoSnapshotLike,
} from './bitvavo-book-sync';

export interface PhaseAReceiveStamp {
  /** Same-process monotonic receive time captured before parsing. */
  receivedMonoNs: string;
  /** Wall clock captured beside receivedMonoNs for audit only. */
  receivedAtMs: number;
}

export type ParsedBitvavoBookMessage =
  | { kind: 'update'; update: BitvavoBookUpdateLike; stamp: PhaseAReceiveStamp }
  | { kind: 'snapshot'; snapshot: BitvavoSnapshotLike; requestId?: number | string; stamp: PhaseAReceiveStamp };

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

function parsePrecisionSafeIntegerText(value: unknown, label: string): string {
  if (typeof value === 'string' && /^\d+$/.test(value)) return value;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return String(value);
  throw new Error(`${label} must be a non-negative precision-safe integer`);
}

function validateStamp(stamp: PhaseAReceiveStamp): PhaseAReceiveStamp {
  if (!/^\d+$/.test(stamp.receivedMonoNs)) {
    throw new Error('receivedMonoNs must be a precision-safe integer nanosecond string');
  }
  if (!Number.isFinite(stamp.receivedAtMs)) throw new Error('receivedAtMs must be finite');
  return stamp;
}

/**
 * Quote selected JSON integer fields before JSON.parse so int64/nanosecond
 * provenance is never silently rounded by JavaScript Number.
 *
 * This only rewrites unquoted non-negative integer literals that immediately
 * follow an exact JSON object key. It deliberately leaves strings untouched.
 */
function parseJsonPreservingIntegerFields(raw: string, fields: readonly string[]): unknown {
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('market-data message must be non-empty JSON text');
  let protectedRaw = raw;
  for (const field of fields) {
    const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`("${escaped}"\\s*:\\s*)(\\d{1,})`, 'g');
    protectedRaw = protectedRaw.replace(pattern, '$1"$2"');
  }
  try {
    return JSON.parse(protectedRaw) as unknown;
  } catch {
    throw new Error('market-data message is invalid JSON');
  }
}

function validateTopOfBook(bid: number, ask: number, label: string): void {
  if (bid > ask) throw new Error(`${label} top of book is crossed`);
}

/** Parse Binance Spot <symbol>@bookTicker market-data messages. */
export function parseBinanceBookTickerRaw(
  raw: string,
  stampInput: PhaseAReceiveStamp,
  expectedSymbol = 'BTCUSDC',
): CausalMarketEventInput | null {
  const stamp = validateStamp(stampInput);
  const root = asRecord(parseJsonPreservingIntegerFields(raw, ['u']), 'Binance message');

  // Combined streams wrap the raw event in { stream, data }. Subscription
  // acknowledgements contain result/id and do not represent market state.
  if ('result' in root && !('data' in root)) return null;
  const payload = 'data' in root ? asRecord(root.data, 'Binance stream data') : root;
  if (!('u' in payload || 's' in payload || 'b' in payload || 'a' in payload)) return null;

  const symbol = parseText(payload.s, 'Binance symbol');
  if (symbol !== expectedSymbol) throw new Error(`unexpected Binance symbol ${symbol}`);
  const bid = parsePositiveNumber(payload.b, 'Binance bid');
  const ask = parsePositiveNumber(payload.a, 'Binance ask');
  validateTopOfBook(bid, ask, 'Binance');

  return {
    venue: 'binance',
    symbol,
    bid,
    ask,
    receivedMonoNs: stamp.receivedMonoNs,
    receivedAtMs: stamp.receivedAtMs,
    sourceSequence: parsePrecisionSafeIntegerText(payload.u, 'Binance update id'),
  };
}

/** Parse Kraken Spot WebSocket v2 ticker messages subscribed with event_trigger=bbo. */
export function parseKrakenTickerV2Raw(
  raw: string,
  stampInput: PhaseAReceiveStamp,
  expectedSymbol = 'BTC/USDC',
): CausalMarketEventInput | null {
  const stamp = validateStamp(stampInput);
  const root = asRecord(parseJsonPreservingIntegerFields(raw, []), 'Kraken message');
  if (root.channel !== 'ticker') return null;
  if (root.type !== 'snapshot' && root.type !== 'update') throw new Error('Kraken ticker type is invalid');
  if (!Array.isArray(root.data) || root.data.length !== 1) throw new Error('Kraken ticker must contain exactly one data item');

  const item = asRecord(root.data[0], 'Kraken ticker data');
  const symbol = parseText(item.symbol, 'Kraken symbol');
  if (symbol !== expectedSymbol) throw new Error(`unexpected Kraken symbol ${symbol}`);
  const bid = parsePositiveNumber(item.bid, 'Kraken bid');
  const ask = parsePositiveNumber(item.ask, 'Kraken ask');
  validateTopOfBook(bid, ask, 'Kraken');

  const timestamp = parseText(item.timestamp, 'Kraken timestamp');
  const sourceObservedAtMs = Date.parse(timestamp);
  if (!(Number.isFinite(sourceObservedAtMs) && sourceObservedAtMs > 0)) {
    throw new Error('Kraken timestamp is invalid');
  }

  return {
    venue: 'kraken',
    symbol,
    bid,
    ask,
    receivedMonoNs: stamp.receivedMonoNs,
    receivedAtMs: stamp.receivedAtMs,
    sourceObservedAtMs,
  };
}

/**
 * Parse only the public Bitvavo messages needed to maintain the Phase A local
 * BTC-USDC book. Nanosecond timestamp literals are converted to strings before
 * JSON.parse so the existing book-sync layer receives precision-safe values.
 *
 * This parser deliberately does not create a causal target. A Bitvavo target
 * becomes actionable only after PhaseATargetCoordinator proves that the
 * synchronized book and public ticker agree on price and displayed size.
 */
export function parseBitvavoBookRaw(
  raw: string,
  stampInput: PhaseAReceiveStamp,
  expectedMarket = 'BTC-USDC',
): ParsedBitvavoBookMessage | null {
  const stamp = validateStamp(stampInput);
  const root = asRecord(parseJsonPreservingIntegerFields(raw, ['timestamp']), 'Bitvavo message');

  if (root.event === 'book' && 'subscriptions' in root) return null;

  if (root.event === 'book') {
    const market = parseText(root.market, 'Bitvavo market');
    if (market !== expectedMarket) throw new Error(`unexpected Bitvavo market ${market}`);
    return {
      kind: 'update',
      update: {
        event: root.event,
        market,
        nonce: root.nonce,
        bids: root.bids,
        asks: root.asks,
        timestamp: root.timestamp,
      },
      stamp,
    };
  }

  if (root.action === 'getBook') {
    const response = asRecord(root.response, 'Bitvavo getBook response');
    const market = parseText(response.market, 'Bitvavo market');
    if (market !== expectedMarket) throw new Error(`unexpected Bitvavo market ${market}`);
    let requestId: number | string | undefined;
    if (root.requestId !== undefined) {
      requestId = typeof root.requestId === 'string'
        ? parseText(root.requestId, 'Bitvavo requestId')
        : Number(root.requestId);
      if (typeof requestId === 'number' && !Number.isSafeInteger(requestId)) {
        throw new Error('Bitvavo requestId must be a safe integer');
      }
    }
    return {
      kind: 'snapshot',
      snapshot: {
        market,
        nonce: response.nonce,
        bids: response.bids,
        asks: response.asks,
        timestamp: response.timestamp,
      },
      requestId,
      stamp,
    };
  }

  return null;
}
