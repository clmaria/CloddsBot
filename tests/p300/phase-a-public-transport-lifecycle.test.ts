import assert from 'node:assert/strict';
import test from 'node:test';
import { PhaseAKeylessRuntimeCore } from '../../src/p300/phase-a-keyless-runtime-core';
import {
  PHASE_A_PUBLIC_ENDPOINTS,
  PhaseAPublicMarketTransport,
  type PhaseAWebSocketLike,
} from '../../src/p300/phase-a-public-transport';

class Socket implements PhaseAWebSocketLike {
  readyState = 1;
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

  send(): void {}
  close(): void {
    this.readyState = 3;
    this.emit('close');
  }
  emit(event: string, ...args: unknown[]): void {
    for (const listener of this.listeners.get(event) ?? []) listener(...args);
  }
}

function core(): PhaseAKeylessRuntimeCore {
  return new PhaseAKeylessRuntimeCore({
    sessionId: 'lifecycle-session-1',
    maxBufferedBookUpdates: 10,
    collector: {
      maxHistoryPerStream: 20,
      maxReferenceAgeMs: 1_000,
      maxReferenceReceiveSkewMs: 500,
      maxReferenceDispersionBps: 100,
    },
  });
}

function noNetworkFetch(): Promise<{ ok: boolean; status: number; text(): Promise<string> }> {
  return Promise.resolve({
    ok: true,
    status: 200,
    text: async () => '{"market":"BTC-USDC","nonce":1,"bids":[["99","1"]],"asks":[["100","1"]]}',
  });
}

test('stop then start always begins a fresh causal runtime session', () => {
  const runtime = core();
  const sockets: Socket[] = [];
  let sessionCounter = 1;
  const transport = new PhaseAPublicMarketTransport({
    runtime,
    dependencies: {
      webSocketFactory: () => {
        const socket = new Socket();
        sockets.push(socket);
        return socket;
      },
      fetchFn: noNetworkFetch,
      monotonicNowNs: () => 1n,
      wallNowMs: () => 1,
      makeSessionId: () => `lifecycle-session-${++sessionCounter}`,
      setTimeoutFn: (callback) => setTimeout(callback, 1),
      clearTimeoutFn: (timer) => clearTimeout(timer),
    },
  });

  transport.start();
  assert.equal(runtime.sessionId, 'lifecycle-session-1');
  transport.stop();
  transport.start();
  assert.equal(runtime.sessionId, 'lifecycle-session-2');
  transport.stop();
});

test('socket creation failure cannot continue opening stale-generation venues', () => {
  const runtime = core();
  const timers: Array<() => void> = [];
  let factoryCalls = 0;
  let sessionCounter = 1;
  const transport = new PhaseAPublicMarketTransport({
    runtime,
    reconnectBaseMs: 10,
    reconnectMaxMs: 100,
    dependencies: {
      webSocketFactory: () => {
        factoryCalls += 1;
        throw new Error('factory boom');
      },
      fetchFn: noNetworkFetch,
      monotonicNowNs: () => 1n,
      wallNowMs: () => 1,
      makeSessionId: () => `lifecycle-session-${++sessionCounter}`,
      setTimeoutFn: (callback) => {
        timers.push(callback);
        return ({ fake: timers.length } as unknown) as ReturnType<typeof setTimeout>;
      },
      clearTimeoutFn: () => {},
    },
  });

  transport.start();
  assert.equal(factoryCalls, 1, 'Kraken/Binance must not be created after Bitvavo invalidates the generation');
  assert.equal(runtime.sessionId, 'lifecycle-session-2');
  assert.equal(timers.length, 1);
  transport.stop();
});

test('successful opening of all three feeds resets reconnect backoff', () => {
  const runtime = core();
  const socketsByUrl = new Map<string, Socket>();
  const timers: Array<{ callback: () => void; delay: number }> = [];
  let sessionCounter = 1;
  const transport = new PhaseAPublicMarketTransport({
    runtime,
    reconnectBaseMs: 10,
    reconnectMaxMs: 100,
    dependencies: {
      webSocketFactory: (url) => {
        const socket = new Socket();
        socketsByUrl.set(url, socket);
        return socket;
      },
      fetchFn: noNetworkFetch,
      monotonicNowNs: (() => {
        let n = 1n;
        return () => ++n;
      })(),
      wallNowMs: () => 1,
      makeSessionId: () => `lifecycle-session-${++sessionCounter}`,
      setTimeoutFn: (callback, delay) => {
        timers.push({ callback, delay });
        return ({ fake: timers.length } as unknown) as ReturnType<typeof setTimeout>;
      },
      clearTimeoutFn: () => {},
    },
  });

  transport.start();
  socketsByUrl.get(PHASE_A_PUBLIC_ENDPOINTS.krakenWs)?.emit('error', new Error('first fault'));
  assert.equal(timers[0]?.delay, 10);
  timers[0]?.callback();

  socketsByUrl.get(PHASE_A_PUBLIC_ENDPOINTS.bitvavoWs)?.emit('open');
  socketsByUrl.get(PHASE_A_PUBLIC_ENDPOINTS.krakenWs)?.emit('open');
  socketsByUrl.get(PHASE_A_PUBLIC_ENDPOINTS.binanceWs)?.emit('open');

  socketsByUrl.get(PHASE_A_PUBLIC_ENDPOINTS.binanceWs)?.emit('close');
  assert.equal(timers[1]?.delay, 10, 'backoff must reset after all feeds become healthy');
  transport.stop();
});
