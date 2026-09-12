import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateVenueGate } from '../../src/p300/venue-gate';

test('regulatory failure blocks a venue even when all other gates pass', () => {
  const result = evaluateVenueGate({
    venue: 'cheap-but-blocked',
    regulatory: 'FAIL',
    technicalTradability: 'PASS',
    riskReducibility: 'PASS',
    economics: 'PASS',
    reportingOperations: 'PASS',
    executionAdapter: 'READY',
  });

  assert.equal(result.status, 'BLOCKED_REGULATORY');
});

test('unverified economics keeps venue in research-only state', () => {
  const result = evaluateVenueGate({
    venue: 'candidate',
    regulatory: 'PASS',
    technicalTradability: 'PASS',
    riskReducibility: 'PASS',
    economics: 'UNVERIFIED',
    reportingOperations: 'PASS',
    executionAdapter: 'MISSING',
  });

  assert.equal(result.status, 'RESEARCH_ONLY');
  assert.ok(result.reasons.some((reason) => reason.includes('economics')));
});

test('missing adapter is considered only after all pre-adapter gates pass', () => {
  const result = evaluateVenueGate({
    venue: 'bitvavo-like',
    regulatory: 'PASS',
    technicalTradability: 'PASS',
    riskReducibility: 'PASS',
    economics: 'PASS',
    reportingOperations: 'PASS',
    executionAdapter: 'MISSING',
  });

  assert.equal(result.status, 'ADAPTER_REQUIRED');
});

test('PAPER_READY never implies LIVE permission', () => {
  const result = evaluateVenueGate({
    venue: 'fully-validated',
    regulatory: 'PASS',
    technicalTradability: 'PASS',
    riskReducibility: 'PASS',
    economics: 'PASS',
    reportingOperations: 'PASS',
    executionAdapter: 'READY',
  });

  assert.equal(result.status, 'PAPER_READY');
  assert.ok(result.reasons.some((reason) => reason.includes('LIVE')));
});
