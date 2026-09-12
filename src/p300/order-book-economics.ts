export interface BookLevel {
  price: number;
  baseQty: number;
}

export interface OrderBookSnapshot {
  bids: BookLevel[];
  asks: BookLevel[];
}

export interface OrderBookEconomics {
  bestBid: number;
  bestAsk: number;
  mid: number;
  spreadBps: number;
  buyVwap: number;
  sellVwap: number;
  buySlippageBps: number;
  sellSlippageBps: number;
  buyFilledQuote: number;
  sellFilledQuote: number;
  buyFullyFillable: boolean;
  sellFullyFillable: boolean;
}

function validateBook(book: OrderBookSnapshot): void {
  if (!book.bids.length || !book.asks.length) throw new Error('order book requires bids and asks');
  for (const level of [...book.bids, ...book.asks]) {
    if (!(level.price > 0) || !(level.baseQty > 0) || !Number.isFinite(level.price) || !Number.isFinite(level.baseQty)) {
      throw new Error('invalid order book level');
    }
  }
}

function quoteVwap(levels: BookLevel[], quoteTarget: number): { vwap: number; filledQuote: number; fullyFillable: boolean } {
  if (!(quoteTarget > 0)) throw new Error('quote target must be > 0');
  let remaining = quoteTarget;
  let spentQuote = 0;
  let acquiredBase = 0;

  for (const level of levels) {
    if (remaining <= 1e-12) break;
    const levelQuoteCapacity = level.price * level.baseQty;
    const takeQuote = Math.min(remaining, levelQuoteCapacity);
    const takeBase = takeQuote / level.price;
    spentQuote += takeQuote;
    acquiredBase += takeBase;
    remaining -= takeQuote;
  }

  return {
    vwap: acquiredBase > 0 ? spentQuote / acquiredBase : 0,
    filledQuote: spentQuote,
    fullyFillable: remaining <= 1e-9,
  };
}

/**
 * Read-only microstructure analysis for a quote-currency ticket size.
 * No networking and no order placement. Callers must supply a fresh book.
 */
export function evaluateOrderBookEconomics(
  book: OrderBookSnapshot,
  quoteTicket: number
): OrderBookEconomics {
  validateBook(book);
  if (!(quoteTicket > 0)) throw new Error('quote ticket must be > 0');

  const bids = [...book.bids].sort((a, b) => b.price - a.price);
  const asks = [...book.asks].sort((a, b) => a.price - b.price);
  const bestBid = bids[0].price;
  const bestAsk = asks[0].price;
  if (bestAsk < bestBid) throw new Error('crossed order book');

  const mid = (bestBid + bestAsk) / 2;
  const spreadBps = ((bestAsk - bestBid) / mid) * 10_000;

  const buy = quoteVwap(asks, quoteTicket);
  const sell = quoteVwap(bids, quoteTicket);
  const buySlippageBps = buy.vwap > 0 ? ((buy.vwap - bestAsk) / bestAsk) * 10_000 : Infinity;
  const sellSlippageBps = sell.vwap > 0 ? ((bestBid - sell.vwap) / bestBid) * 10_000 : Infinity;

  return {
    bestBid,
    bestAsk,
    mid,
    spreadBps,
    buyVwap: buy.vwap,
    sellVwap: sell.vwap,
    buySlippageBps,
    sellSlippageBps,
    buyFilledQuote: buy.filledQuote,
    sellFilledQuote: sell.filledQuote,
    buyFullyFillable: buy.fullyFillable,
    sellFullyFillable: sell.fullyFillable,
  };
}
