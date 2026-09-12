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
  buySlippageBps: DistributionSummary | null;
  sellSlippageBps: DistributionSummary | null;
  buyFillableSampleCount: number;
  sellFillableSampleCount: number;
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

function summarizeOptional(values: number[]): DistributionSummary | null {
  return values.length ? summarize(values) : null;
}

/**
 * Aggregates read-only order-book economics observations. Slippage
 * distributions include only snapshots where the requested ticket was fully
 * fillable; partial-fill slippage would otherwise make shallow books look
 * artificially cheap. Depth failure is reported separately.
 */
export function summarizeMicrostructure(
  observations: MicrostructureObservation[]
): MicrostructureSummary {
  if (!observations.length) throw new Error('at least one observation is required');

  const timestamps = observations.map((observation) => observation.observedAtMs);
  if (timestamps.some((value) => !Number.isFinite(value) || value <= 0)) {
    throw new Error('observation timestamps must be positive finite values');
  }

  for (const observation of observations) {
    const metrics = [
      observation.economics.spreadBps,
      observation.economics.buySlippageBps,
      observation.economics.sellSlippageBps,
    ];
    if (metrics.some((value) => !Number.isFinite(value) || value < 0)) {
      throw new Error('microstructure observations contain invalid economics');
    }
  }

  const buyFillable = observations.filter((item) => item.economics.buyFullyFillable);
  const sellFillable = observations.filter((item) => item.economics.sellFullyFillable);

  return {
    sampleCount: observations.length,
    spreadBps: summarize(observations.map((item) => item.economics.spreadBps)),
    buySlippageBps: summarizeOptional(buyFillable.map((item) => item.economics.buySlippageBps)),
    sellSlippageBps: summarizeOptional(sellFillable.map((item) => item.economics.sellSlippageBps)),
    buyFillableSampleCount: buyFillable.length,
    sellFillableSampleCount: sellFillable.length,
    buyInsufficientDepthRate: (observations.length - buyFillable.length) / observations.length,
    sellInsufficientDepthRate: (observations.length - sellFillable.length) / observations.length,
    firstObservedAtMs: Math.min(...timestamps),
    lastObservedAtMs: Math.max(...timestamps),
  };
}
