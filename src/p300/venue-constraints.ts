import type { MarketConstraintsInput } from './types';

interface BinanceFilter {
  filterType?: string;
  minQty?: string;
  stepSize?: string;
  minNotional?: string;
}

export interface BinanceSymbolInfoLike {
  symbol: string;
  filters?: BinanceFilter[];
}

export function marketConstraintsFromBinance(
  symbolInfo: BinanceSymbolInfoLike,
  price: number,
  venue = 'binance'
): MarketConstraintsInput {
  const filters = symbolInfo.filters ?? [];
  const lot = filters.find((f) => f.filterType === 'LOT_SIZE');
  const minNotional = filters.find((f) => f.filterType === 'MIN_NOTIONAL');
  const notional = filters.find((f) => f.filterType === 'NOTIONAL');

  const minBaseQty = lot?.minQty ? Number(lot.minQty) : undefined;
  const stepSize = lot?.stepSize ? Number(lot.stepSize) : undefined;
  const minQuoteNotionalRaw = minNotional?.minNotional ?? notional?.minNotional;
  const minQuoteNotional = minQuoteNotionalRaw ? Number(minQuoteNotionalRaw) : undefined;

  if (!(price > 0)) throw new Error('price must be > 0');
  if (minBaseQty !== undefined && !Number.isFinite(minBaseQty)) throw new Error('invalid Binance minQty');
  if (stepSize !== undefined && !Number.isFinite(stepSize)) throw new Error('invalid Binance stepSize');
  if (minQuoteNotional !== undefined && !Number.isFinite(minQuoteNotional)) {
    throw new Error('invalid Binance minNotional');
  }

  return {
    venue,
    symbol: symbolInfo.symbol,
    price,
    minBaseQty,
    minQuoteNotional,
    stepSize,
  };
}

export interface KrakenAssetPairLike {
  altname?: string;
  wsname?: string;
  ordermin?: string;
  costmin?: string;
  lot_decimals?: number;
}

export function marketConstraintsFromKraken(
  pair: KrakenAssetPairLike,
  price: number,
  venue = 'kraken'
): MarketConstraintsInput {
  if (!(price > 0)) throw new Error('price must be > 0');

  const minBaseQty = pair.ordermin !== undefined ? Number(pair.ordermin) : undefined;
  const minQuoteNotional = pair.costmin !== undefined ? Number(pair.costmin) : undefined;
  const stepSize = pair.lot_decimals !== undefined
    ? 10 ** -pair.lot_decimals
    : undefined;

  if (minBaseQty !== undefined && !Number.isFinite(minBaseQty)) throw new Error('invalid Kraken ordermin');
  if (minQuoteNotional !== undefined && !Number.isFinite(minQuoteNotional)) throw new Error('invalid Kraken costmin');
  if (stepSize !== undefined && !Number.isFinite(stepSize)) throw new Error('invalid Kraken lot_decimals');

  return {
    venue,
    symbol: pair.wsname ?? pair.altname ?? 'unknown',
    price,
    minBaseQty,
    minQuoteNotional,
    stepSize,
  };
}
