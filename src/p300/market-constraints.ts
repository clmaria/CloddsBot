import type {
  BindingConstraint,
  MarketConstraints,
  MarketConstraintsInput,
  ReducibilitySnapshot,
} from './types';

function requireFinitePositive(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be finite and > 0`);
}

function requireOptionalFiniteNonNegative(value: number | undefined, name: string): void {
  if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
    throw new Error(`${name} must be finite and >= 0 when configured`);
  }
}

function validateMarketInput(input: MarketConstraintsInput): void {
  if (!input.venue.trim()) throw new Error('venue is required');
  if (!input.symbol.trim()) throw new Error('symbol is required');
  requireFinitePositive(input.price, 'price');
  requireOptionalFiniteNonNegative(input.minBaseQty, 'minimum base quantity');
  requireOptionalFiniteNonNegative(input.minQuoteNotional, 'minimum quote notional');
  if (input.stepSize !== undefined) requireFinitePositive(input.stepSize, 'step size');
  if ((input.minBaseQty ?? 0) <= 0 && (input.minQuoteNotional ?? 0) <= 0) {
    throw new Error('at least one positive executable minimum is required');
  }
}

function ceilToStep(value: number, step?: number): number {
  if (step === undefined) return value;
  return Math.ceil(value / step - 1e-12) * step;
}

function floorToStep(value: number, step?: number): number {
  if (step === undefined) return value;
  return Math.floor(value / step + 1e-12) * step;
}

export function deriveMarketConstraints(input: MarketConstraintsInput): MarketConstraints {
  validateMarketInput(input);

  const minBase = input.minBaseQty ?? 0;
  const quoteImpliedBase = (input.minQuoteNotional ?? 0) / input.price;
  const quoteBaseRounded = ceilToStep(quoteImpliedBase, input.stepSize);
  const baseRounded = ceilToStep(minBase, input.stepSize);
  const minExecutableBaseQty = Math.max(baseRounded, quoteBaseRounded);

  const baseNotional = baseRounded * input.price;
  const quoteNotional = input.minQuoteNotional ?? 0;

  let bindingConstraint: BindingConstraint = 'none';
  const eps = 1e-9;
  if (baseRounded > 0 && quoteBaseRounded > 0 && Math.abs(baseRounded - quoteBaseRounded) <= eps) {
    bindingConstraint = 'both';
  } else if (baseRounded > quoteBaseRounded + eps) {
    bindingConstraint = 'base';
  } else if (quoteBaseRounded > baseRounded + eps) {
    bindingConstraint = 'quote';
  } else if (baseRounded > 0) {
    bindingConstraint = 'base';
  } else if (quoteBaseRounded > 0 || quoteNotional > 0) {
    bindingConstraint = 'quote';
  }

  const minExecutableNotional = Math.max(
    baseNotional,
    quoteNotional,
    minExecutableBaseQty * input.price,
  );
  if (!Number.isFinite(minExecutableBaseQty) || !Number.isFinite(minExecutableNotional)) {
    throw new Error('derived market constraints are not finite');
  }

  return {
    ...input,
    minExecutableBaseQty,
    minExecutableNotional,
    bindingConstraint,
  };
}

export function calculateReducibility(
  positionBaseQty: number,
  constraintsInput: MarketConstraintsInput,
  priceOverride?: number
): ReducibilitySnapshot {
  if (!Number.isFinite(positionBaseQty) || positionBaseQty < 0) {
    throw new Error('position base quantity must be finite and >= 0');
  }
  if (priceOverride !== undefined) requireFinitePositive(priceOverride, 'price override');

  const price = priceOverride ?? constraintsInput.price;
  const constraints = deriveMarketConstraints({ ...constraintsInput, price });
  const sellable = floorToStep(positionBaseQty, constraints.stepSize);
  const minQty = constraints.minExecutableBaseQty;

  if (!(minQty > 0) || !(sellable > 0)) {
    return {
      price,
      minExecutableBaseQty: minQty,
      minExecutableNotional: constraints.minExecutableNotional,
      totalExitSlices: 0,
      discretionaryPartialExits: 0,
      remainderBaseQty: sellable,
      bindingConstraint: constraints.bindingConstraint,
    };
  }

  const fullSlices = Math.floor(sellable / minQty + 1e-12);
  const remainderBaseQty = Math.max(0, sellable - fullSlices * minQty);

  // The final exit must absorb any residual quantity. Therefore the number of
  // genuinely discretionary partial reductions is one less than the total
  // number of executable exit slices.
  const discretionaryPartialExits = Math.max(0, fullSlices - 1);

  return {
    price,
    minExecutableBaseQty: minQty,
    minExecutableNotional: constraints.minExecutableNotional,
    totalExitSlices: fullSlices,
    discretionaryPartialExits,
    remainderBaseQty,
    bindingConstraint: constraints.bindingConstraint,
  };
}

export function calculateStressedReducibility(
  positionBaseQty: number,
  constraints: MarketConstraintsInput,
  adversePrice: number
): ReducibilitySnapshot {
  requireFinitePositive(adversePrice, 'adverse price');
  return calculateReducibility(positionBaseQty, constraints, adversePrice);
}
