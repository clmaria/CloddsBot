import assert from 'node:assert/strict';
import test from 'node:test';
import type { BitvavoLocalBookState } from '../../src/p300/bitvavo-book-sync';
import { parseBitvavoTickerRaw } from '../../src/p300/phase-a-bitvavo-ticker';
import { PhaseATargetCoordinator } from '../../src/p300/phase-a-target-coordinator';
import type { PhaseAReceiveStamp } from '../../src/p300/phase-a-public-feed-parsers';

function stamp(ns: bigint, wall = Number(ns / 1_000_000n)): PhaseAReceiveStamp {
  return { receivedMonoNs: ns.toString(), receivedAtMs: wall };
}

function book(
  nonce: number,
  bid = 100,
  bidSize = 1.5,
  ask = 101,
  askSize = 2,
): BitvavoLocalBookState {
  return {
    market: 'BTC-USDC',
    nonce,
    bids: { [String(bid)]: String(bidSize), '99': '3' },
    asks: { [String(ask)]: String(askSize), '102': '4' },
    exchangeTimestampNs: '1752139200123456789',
  };
}

function tickerRaw(
  bid = '100',
  bidSize = '1.5',
  ask = '101',
  askSize = '2',
): string {
  return JSON.stringify({
    event: 'ticker',
    market: 'BTC-USDC',
    bestBid: bid,
    bestBidSize: bidSize,
    bestAsk: ask,
    bestAskSize: askSize,
    lastPrice: '100.5',
  });
}

test('Bitvavo ticker parser maps the documented BBO event and keeps local receive time as the only causal clock', () => {
  const received = stamp(1_000n, 1234);
  const parsed = parseBitvavoTickerRaw(tickerRaw(), received);
  assert.ok(parsed);
  assert.equal(parsed.market, 'BTC-USDC');
  assert.equal(parsed.bid, 100);
  assert.equal(parsed.bidSize, 1.5);
  assert.equal(parsed.ask, 101);
  assert.equal(parsed.askSize, 2);
  assert.equal(parsed.lastPrice, 100.5);
  assert.deepEqual(parsed.stamp, received);
  assert.equal('timestamp' in parsed, false);
});

test('Bitvavo ticker parser ignores confirmations/non-ticker messages and fails closed on invalid market data', () => {
  assert.equal(parseBitvavoTickerRaw('{"event":"subscribed","subscriptions":{"ticker":["BTC-USDC"]}}', stamp(1n)), null);
  assert.equal(parseBitvavoTickerRaw('{"event":"heartbeat"}', stamp(2n)), null);
  assert.throws(
    () => parseBitvavoTickerRaw(tickerRaw('102', '1', '101', '1'), stamp(3n)),
    /crossed/,
  );
  assert.throws(
    () => parseBitvavoTickerRaw(tickerRaw().replace('BTC-USDC', 'ETH-USDC'), stamp(4n)),
    /unexpected Bitvavo ticker market/,
  );
  assert.throws(() => parseBitvavoTickerRaw('{bad', stamp(5n)), /invalid JSON/);
});

test('ticker first is not backdated: coordinator waits for matching synchronized book and uses the later book receipt', () => {
  const coordinator = new PhaseATargetCoordinator();
  const ticker = parseBitvavoTickerRaw(tickerRaw(), stamp(100n, 1_000));
  assert.ok(ticker);
  assert.equal(coordinator.updateTicker(ticker), null);

  // Same prices but different displayed size is not the same BBO state.
  assert.equal(coordinator.updateBookState(book(10, 100, 1.4, 101, 2), stamp(150n, 1_050)), null);

  const actionable = coordinator.updateBookState(book(11), stamp(200n, 1_100));
  assert.ok(actionable);
  assert.equal(actionable.actionableReceivedMonoNs, '200');
  assert.equal(actionable.bookReceivedMonoNs, '200');
  assert.equal(actionable.tickerReceivedMonoNs, '100');
  assert.equal(actionable.target.receivedMonoNs, '200');
  assert.equal(actionable.target.receivedAtMs, 1_100);
  assert.equal(actionable.target.sourceSequence, 11);
  assert.equal(actionable.target.sourceObservedAtMs, undefined);
  assert.equal(actionable.bookExchangeTimestampNs, '1752139200123456789');
});

test('book first uses the later ticker receipt once the ticker confirms the same top-of-book state', () => {
  const coordinator = new PhaseATargetCoordinator();
  assert.equal(coordinator.updateBookState(book(20), stamp(100n, 1_000)), null);
  const ticker = parseBitvavoTickerRaw(tickerRaw(), stamp(250n, 1_250));
  assert.ok(ticker);
  const actionable = coordinator.updateTicker(ticker);
  assert.ok(actionable);
  assert.equal(actionable.actionableReceivedMonoNs, '250');
  assert.equal(actionable.target.receivedMonoNs, '250');
  assert.equal(actionable.target.bid, 100);
  assert.equal(actionable.target.ask, 101);
});

test('one ticker event can produce at most one actionable target even if later book updates leave the same BBO', () => {
  const coordinator = new PhaseATargetCoordinator();
  coordinator.updateBookState(book(30), stamp(100n));
  const ticker = parseBitvavoTickerRaw(tickerRaw(), stamp(200n));
  assert.ok(ticker);
  assert.ok(coordinator.updateTicker(ticker));

  assert.equal(coordinator.updateBookState(book(31), stamp(300n)), null);
  assert.equal(coordinator.updateBookState(book(32), stamp(400n)), null);
});

test('invalidating the synchronized book prevents targets until a fresh valid book is supplied', () => {
  const coordinator = new PhaseATargetCoordinator();
  coordinator.updateBookState(book(40), stamp(100n));
  coordinator.invalidateBook();
  const ticker = parseBitvavoTickerRaw(tickerRaw(), stamp(200n));
  assert.ok(ticker);
  assert.equal(coordinator.updateTicker(ticker), null);
  assert.ok(coordinator.updateBookState(book(41), stamp(300n)));
});

test('target coordinator fails closed on monotonic receive-clock regression and reset clears the clock domain', () => {
  const coordinator = new PhaseATargetCoordinator();
  coordinator.updateBookState(book(50), stamp(500n));
  const oldTicker = parseBitvavoTickerRaw(tickerRaw(), stamp(499n));
  assert.ok(oldTicker);
  assert.throws(() => coordinator.updateTicker(oldTicker), /clock regressed/);

  coordinator.resetForNewClockDomain();
  const freshTicker = parseBitvavoTickerRaw(tickerRaw(), stamp(10n));
  assert.ok(freshTicker);
  assert.equal(coordinator.updateTicker(freshTicker), null);
  assert.ok(coordinator.updateBookState(book(1), stamp(11n)));
});
