import type {
  BindingConstraint,
  MarketConstraints,
  MarketConstraintsInput,
  ReducibilitySnapshot,
} from './types';

function ceilToStep(value: number, step?: number): number {
  if (!step || step <= 0) return value;
  return Math.ceil(value / step - 1e-12) * step;
}

function floorToStep(value: number, step?: number): number {
  if (!step || step <= 0) return value;
  return Math.floor(value / step + 1e-12) * step;
}

export function deriveMarketConstraints(input: MarketConstraintsInput): MarketConstraints {
  if (!(input.price > 0)) throw new Error('price must be > 0');

  const minBase = Math.max(0, input.minBaseQty ?? 0);
  const quoteImpliedBase = Math.max(0, (input.minQuoteNotional ?? 0) / input.price);
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

  return {
    ...input,
    minExecutableBaseQty,
    minExecutableNotional: Math.max(baseNotional, quoteNotional, minExecutableBaseQty * input.price),
    bindingConstraint,
  };
}

export function calculateReducibility(
  positionBaseQty: number,
  constraintsInput: MarketConstraintsInput,
  priceOverride?: number
): ReducibilitySnapshot {
  const price = priceOverride ?? constraintsInput.price;
  const constraints = deriveMarketConstraints({ ...constraintsInput, price });
  const sellable = floorToStep(Math.max(0, positionBaseQty), constraints.stepSize);
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
  if (!(adversePrice > 0)) throw new Error('adversePrice must be > 0');
  return calculateReducibility(positionBaseQty, constraints, adversePrice);
}
