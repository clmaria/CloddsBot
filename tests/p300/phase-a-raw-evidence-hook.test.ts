import assert from 'node:assert/strict';
import test from 'node:test';
import { PhaseAKeylessRuntimeCore } from '../../src/p300/phase-a-keyless-runtime-core';
import {
  PHASE_A_PUBLIC_ENDPOINTS,
  PhaseAPublicMarketTransport,
  type PhaseAPublicRawMarketData,
  type PhaseAWebSocketLike,
} from '../../src/p300/phase-a-public-transport';

class Socket implements PhaseAWebSocketLike {
  readyState = 1;
  readonly sent: string[] = [];
  private readonly listeners = new Map<string, Array<(...args: unknown[]) => void>>();

  on(event: 'open', listener: () => void): this;
  on(event: 'message', listener: (data: unknown) => void): this;
  on(event: 'close', listener: () => void): this;
  on(event: 'error', listener: (error: unknown) => void): this;
  on(event: 'pong', listener: () => void): this;
  on(event: string, listener: (...args: unknown[]) => void): this {
    const list = this.listeners.get(event) ?? [];
    list.push(listener);
    this.listeners.set(event, list);
    return this;
  }

  send(data: string): void { this.sent.push(data); }
  close(): void { this.readyState = 3; this.emit('close'); }
  emit(event: string, ...args: unknown[]): void {
    for (const listener of this.listeners.get(event) ?? []) listener(...args);
  }
}

function runtime(): PhaseAKeylessRuntimeCore {
  return new PhaseAKeylessRuntimeCore({
    sessionId: 'raw-hook-session-1',
    maxBufferedBookUpdates: 10,
    collector: {
      maxHistoryPerStream: 20,
      maxReferenceAgeMs: 1_000,
      maxReferenceReceiveSkewMs: 500,
      maxReferenceDispersionBps: 100,
    },
  });
}

function firstBitvavoBookUpdate(): string {
  return '{"event":"book","market":"BTC-USDC","nonce":0,"bids":[],"asks":[],"timestamp":1752139200123456700}';
}

function harness(snapshotBody = '{"market":"BTC-USDC","nonce":1,"bids":[["99","1"]],"asks":[["100","1"]],"timestamp":1752139200123456789}') {
  const sockets = new Map<string, Socket>();
  const raw: PhaseAPublicRawMarketData[] = [];
  const timers: Array<() => void> = [];
  let mono = 1_000_000_000n;
  let sessionCounter = 1;
  const core = runtime();
  const transport = new PhaseAPublicMarketTransport({
    runtime: core,
    dependencies: {
      webSocketFactory: (url) => {
        const socket = new Socket();
        sockets.set(url, socket);
        return socket;
      },
      fetchFn: async () => ({ ok: true, status: 200, text: async () => snapshotBody }),
      monotonicNowNs: () => (mono += 1_000_000n),
      wallNowMs: () => Number(mono / 1_000_000n),
      makeSessionId: () => `raw-hook-session-${++sessionCounter}`,
      setTimeoutFn: (callback) => {
        timers.push(callback);
        return ({ fake: timers.length } as unknown) as ReturnType<typeof setTimeout>;
      },
      clearTimeoutFn: () => {},
    },
    onRawMarketData: (event) => raw.push(event),
  });
  return { core, transport, sockets, raw, timers };
}

async function flushAsync(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

test('records the exact websocket payload with the same causal stamp before runtime parsing', () => {
  const h = harness();
  h.transport.start();
  const binance = h.sockets.get(PHASE_A_PUBLIC_ENDPOINTS.binanceWs);
  assert.ok(binance);
  const payload = JSON.stringify({ u: 7, s: 'BTCUSDC', b: '99.9', B: '1', a: '100.1', A: '1' });
  binance.emit('message', payload);

  assert.equal(h.raw.length, 1);
  assert.equal(h.raw[0].source, 'binance');
  assert.equal(h.raw[0].channel, 'websocket');
  assert.equal(h.raw[0].rawPayload, payload);
  assert.match(h.raw[0].stamp.receivedMonoNs, /^\d+$/);
  h.transport.stop();
});

test('malformed websocket payload is preserved before the session fails closed', () => {
  const h = harness();
  h.transport.start();
  const kraken = h.sockets.get(PHASE_A_PUBLIC_ENDPOINTS.krakenWs);
  assert.ok(kraken);
  kraken.emit('message', '{not-json');

  assert.equal(h.raw.length, 1);
  assert.equal(h.raw[0].source, 'kraken');
  assert.equal(h.raw[0].rawPayload, '{not-json');
  assert.equal(h.core.sessionId, 'raw-hook-session-2');
  assert.equal(h.timers.length, 1);
  h.transport.stop();
});

test('Bitvavo REST raw evidence is emitted only after proven live-book overlap and preserves ns literal', async () => {
  const snapshot = '{"market":"BTC-USDC","nonce":1,"bids":[["99","1"]],"asks":[["100","1"]],"timestamp":1752139200123456789}';
  const h = harness(snapshot);
  h.transport.start();
  const bitvavo = h.sockets.get(PHASE_A_PUBLIC_ENDPOINTS.bitvavoWs);
  assert.ok(bitvavo);
  bitvavo.emit('open');
  await flushAsync();

  assert.equal(h.raw.some((event) => event.channel === 'book_snapshot_rest'), false);
  assert.equal(h.core.bitvavoSynchronized, false);

  bitvavo.emit('message', firstBitvavoBookUpdate());
  await flushAsync();

  const rest = h.raw.find((event) => event.channel === 'book_snapshot_rest');
  assert.ok(rest);
  assert.equal(rest.source, 'bitvavo');
  assert.equal(rest.rawPayload, snapshot);
  assert.ok(rest.rawPayload.includes('1752139200123456789'));
  assert.doesNotMatch(rest.rawPayload, /requestId/);
  assert.equal(h.core.bitvavoSynchronized, true);
  h.transport.stop();
});

test('evidence sink failure invalidates the causal session instead of collecting an unaudited observation', () => {
  const sockets = new Map<string, Socket>();
  const timers: Array<() => void> = [];
  let sessionCounter = 1;
  const core = runtime();
  const transport = new PhaseAPublicMarketTransport({
    runtime: core,
    dependencies: {
      webSocketFactory: (url) => {
        const socket = new Socket();
        sockets.set(url, socket);
        return socket;
      },
      fetchFn: async () => ({ ok: true, status: 200, text: async () => '{}' }),
      monotonicNowNs: () => 1n,
      wallNowMs: () => 1,
      makeSessionId: () => `raw-hook-session-${++sessionCounter}`,
      setTimeoutFn: (callback) => {
        timers.push(callback);
        return ({ fake: timers.length } as unknown) as ReturnType<typeof setTimeout>;
      },
      clearTimeoutFn: () => {},
    },
    onRawMarketData: () => { throw new Error('disk unavailable'); },
  });
  transport.start();
  const binance = sockets.get(PHASE_A_PUBLIC_ENDPOINTS.binanceWs);
  assert.ok(binance);
  binance.emit('message', JSON.stringify({ u: 1, s: 'BTCUSDC', b: '99', B: '1', a: '100', A: '1' }));
  assert.equal(core.sessionId, 'raw-hook-session-2');
  assert.equal(timers.length, 1);
  transport.stop();
});
