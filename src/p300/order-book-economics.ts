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
    const quoteCapacity = level.price * level.baseQty;
    if (!Number.isFinite(quoteCapacity) || quoteCapacity <= 0) {
      throw new Error('invalid order book quote capacity');
    }
  }
}

function buyByQuote(levels: BookLevel[], quoteTarget: number): {
  vwap: number;
  filledQuote: number;
  fullyFillable: boolean;
} {
  if (!Number.isFinite(quoteTarget) || quoteTarget <= 0) {
    throw new Error('quote target must be finite and > 0');
  }
  let remainingQuote = quoteTarget;
  let spentQuote = 0;
  let acquiredBase = 0;

  for (const level of levels) {
    if (remainingQuote <= 1e-12) break;
    const levelQuoteCapacity = level.price * level.baseQty;
    const takeQuote = Math.min(remainingQuote, levelQuoteCapacity);
    const takeBase = takeQuote / level.price;
    spentQuote += takeQuote;
    acquiredBase += takeBase;
    remainingQuote -= takeQuote;
  }

  const vwap = acquiredBase > 0 ? spentQuote / acquiredBase : 0;
  if (!Number.isFinite(vwap) || !Number.isFinite(spentQuote) || !Number.isFinite(remainingQuote)) {
    throw new Error('derived buy-side economics are not finite');
  }

  return {
    vwap,
    filledQuote: spentQuote,
    fullyFillable: remainingQuote <= 1e-9,
  };
}

function sellByBase(levels: BookLevel[], baseTarget: number): {
  vwap: number;
  filledQuote: number;
  fullyFillable: boolean;
} {
  if (!Number.isFinite(baseTarget) || baseTarget <= 0) {
    throw new Error('base target must be finite and > 0');
  }
  let remainingBase = baseTarget;
  let soldBase = 0;
  let receivedQuote = 0;

  for (const level of levels) {
    if (remainingBase <= 1e-12) break;
    const takeBase = Math.min(remainingBase, level.baseQty);
    soldBase += takeBase;
    receivedQuote += takeBase * level.price;
    remainingBase -= takeBase;
  }

  const vwap = soldBase > 0 ? receivedQuote / soldBase : 0;
  if (!Number.isFinite(vwap) || !Number.isFinite(receivedQuote) || !Number.isFinite(remainingBase)) {
    throw new Error('derived sell-side economics are not finite');
  }

  return {
    vwap,
    filledQuote: receivedQuote,
    fullyFillable: remainingBase <= 1e-12,
  };
}

/**
 * Read-only microstructure analysis for a quote-currency ticket size.
 * Buy-side analysis spends the quote ticket. Sell-side analysis fixes the base
 * quantity equivalent to that ticket at best bid, so worse depth lowers actual
 * proceeds instead of silently selling more base to preserve quote proceeds.
 * No networking and no order placement. Callers must supply a fresh book.
 */
export function evaluateOrderBookEconomics(
  book: OrderBookSnapshot,
  quoteTicket: number
): OrderBookEconomics {
  validateBook(book);
  if (!Number.isFinite(quoteTicket) || quoteTicket <= 0) {
    throw new Error('quote ticket must be finite and > 0');
  }

  const bids = [...book.bids].sort((a, b) => b.price - a.price);
  const asks = [...book.asks].sort((a, b) => a.price - b.price);
  const bestBid = bids[0].price;
  const bestAsk = asks[0].price;
  if (bestAsk < bestBid) throw new Error('crossed order book');

  const mid = (bestBid + bestAsk) / 2;
  const spreadBps = ((bestAsk - bestBid) / mid) * 10_000;
  if (!Number.isFinite(mid) || mid <= 0 || !Number.isFinite(spreadBps) || spreadBps < 0) {
    throw new Error('invalid derived spread');
  }

  const buy = buyByQuote(asks, quoteTicket);
  const sellBaseTarget = quoteTicket / bestBid;
  const sell = sellByBase(bids, sellBaseTarget);
  const buySlippageBps = buy.vwap > 0 ? ((buy.vwap - bestAsk) / bestAsk) * 10_000 : Infinity;
  const sellSlippageBps = sell.vwap > 0 ? ((bestBid - sell.vwap) / bestBid) * 10_000 : Infinity;

  if (!Number.isFinite(buySlippageBps) || !Number.isFinite(sellSlippageBps)) {
    throw new Error('derived slippage is not finite');
  }
  if (buySlippageBps < -1e-9 || sellSlippageBps < -1e-9) {
    throw new Error('derived slippage cannot be negative');
  }

  return {
    bestBid,
    bestAsk,
    mid,
    spreadBps,
    buyVwap: buy.vwap,
    sellVwap: sell.vwap,
    buySlippageBps: Math.max(0, buySlippageBps),
    sellSlippageBps: Math.max(0, sellSlippageBps),
    buyFilledQuote: buy.filledQuote,
    sellFilledQuote: sell.filledQuote,
    buyFullyFillable: buy.fullyFillable,
    sellFullyFillable: sell.fullyFillable,
  };
}
