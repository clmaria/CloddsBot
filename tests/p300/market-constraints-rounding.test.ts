import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateReducibility, deriveMarketConstraints } from '../../src/p300/index';

function close(actual: number, expected: number, tolerance = 1e-12): void {
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${actual} ~= ${expected}`);
}

test('exact large step multiples do not gain an extra minimum lot from floating-point drift', () => {
  const constraints = deriveMarketConstraints({
    venue: 'example',
    symbol: 'ASSET/QUOTE',
    price: 1,
    minBaseQty: 0.1,
    stepSize: 0.0000001,
  });
  close(constraints.minExecutableBaseQty, 0.1, 1e-12);
});

test('exact sellable quantity is not rounded down by one lot at large quotients', () => {
  const result = calculateReducibility(0.1, {
    venue: 'example',
    symbol: 'ASSET/QUOTE',
    price: 1,
    minBaseQty: 0.0001,
    stepSize: 0.000001,
  });
  assert.equal(result.totalExitSlices, 1000);
  close(result.remainderBaseQty, 0);
});

test('tiny floating dust remainder is normalized to zero', () => {
  const result = calculateReducibility(0.0003, {
    venue: 'example',
    symbol: 'ASSET/QUOTE',
    price: 50_000,
    minBaseQty: 0.0001,
    stepSize: 0.00000001,
  });
  assert.equal(result.totalExitSlices, 3);
  assert.equal(result.remainderBaseQty, 0);
});

test('values genuinely between lot steps still ceil/floor in the safe direction', () => {
  const constraints = deriveMarketConstraints({
    venue: 'example',
    symbol: 'ASSET/QUOTE',
    price: 1,
    minBaseQty: 0.10000005,
    stepSize: 0.0000001,
  });
  close(constraints.minExecutableBaseQty, 0.1000001, 1e-12);

  const reducibility = calculateReducibility(0.10000005, {
    venue: 'example',
    symbol: 'ASSET/QUOTE',
    price: 1,
    minBaseQty: 0.0000001,
    stepSize: 0.0000001,
  });
  close(reducibility.remainderBaseQty, 0);
  assert.equal(reducibility.totalExitSlices, 1_000_000);
});
