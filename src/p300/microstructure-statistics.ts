import type { OrderBookEconomics } from './order-book-economics';

export interface MicrostructureObservation {
  observedAtMs: number;
  economics: OrderBookEconomics;
}

export interface DistributionSummary {
  p50: number;
  p90: number;
  p99: number;
  max: number;
}

export interface MicrostructureSummary {
  sampleCount: number;
  spreadBps: DistributionSummary;
  buySlippageBps: DistributionSummary;
  sellSlippageBps: DistributionSummary;
  buyInsufficientDepthRate: number;
  sellInsufficientDepthRate: number;
  firstObservedAtMs: number;
  lastObservedAtMs: number;
}

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) throw new Error('cannot compute quantile of empty sample');
  if (!(q >= 0 && q <= 1)) throw new Error('quantile must be between 0 and 1');
  if (sorted.length === 1) return sorted[0];
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  const weight = position - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function summarize(values: number[]): DistributionSummary {
  if (!values.length) throw new Error('cannot summarize empty sample');
  if (values.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error('microstructure values must be finite and non-negative');
  }
  const sorted = [...values].sort((a, b) => a - b);
  return {
    p50: quantile(sorted, 0.5),
    p90: quantile(sorted, 0.9),
    p99: quantile(sorted, 0.99),
    max: sorted[sorted.length - 1],
  };
}

/**
 * Aggregates read-only order-book economics observations. This deliberately
 * describes distributions rather than turning one snapshot into a venue PASS.
 */
export function summarizeMicrostructure(
  observations: MicrostructureObservation[]
): MicrostructureSummary {
  if (!observations.length) throw new Error('at least one observation is required');

  const timestamps = observations.map((observation) => observation.observedAtMs);
  if (timestamps.some((value) => !Number.isFinite(value) || value <= 0)) {
    throw new Error('observation timestamps must be positive finite values');
  }

  return {
    sampleCount: observations.length,
    spreadBps: summarize(observations.map((item) => item.economics.spreadBps)),
    buySlippageBps: summarize(observations.map((item) => item.economics.buySlippageBps)),
    sellSlippageBps: summarize(observations.map((item) => item.economics.sellSlippageBps)),
    buyInsufficientDepthRate:
      observations.filter((item) => !item.economics.buyFullyFillable).length / observations.length,
    sellInsufficientDepthRate:
      observations.filter((item) => !item.economics.sellFullyFillable).length / observations.length,
    firstObservedAtMs: Math.min(...timestamps),
    lastObservedAtMs: Math.max(...timestamps),
  };
}
