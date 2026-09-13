import assert from 'node:assert/strict';
import test from 'node:test';
import { canOpenNewExposure, createSupervisorState, recordDecisionFailure, recordDecisionSuccess, recordEntry } from '../../src/p300/index';

const config = { maxConsecutiveDecisionFailures: 3, recoverySuccessesRequired: 2, maxEntriesPerHour: 2 };

test('safe mode activates after repeated failures', () => {
  let state = createSupervisorState();
  state = recordDecisionFailure(state, config);
  state = recordDecisionFailure(state, config);
  state = recordDecisionFailure(state, config);
  assert.equal(state.safeMode, true);
  assert.equal(canOpenNewExposure(state, config).allowed, false);
});

test('safe mode requires successful recovery', () => {
  let state = createSupervisorState();
  state = recordDecisionFailure(state, config);
  state = recordDecisionFailure(state, config);
  state = recordDecisionFailure(state, config);
  state = recordDecisionSuccess(state, config);
  assert.equal(state.safeMode, true);
  state = recordDecisionSuccess(state, config);
  assert.equal(state.safeMode, false);
});

test('hourly entry throttle blocks excess openings', () => {
  const now = 10_000;
  let state = createSupervisorState();
  state = recordEntry(state, config, now - 1000);
  state = recordEntry(state, config, now);
  assert.equal(canOpenNewExposure(state, config, now).allowed, false);
});

test('hourly entry throttle prunes entries only after a monotonic hour', () => {
  let state = createSupervisorState();
  state = recordEntry(state, config, 1_000);
  state = recordEntry(state, config, 2_000);
  assert.equal(canOpenNewExposure(state, config, 3_601_001).allowed, true);
});

test('supervisor fails closed when monotonic time moves backwards or clock domains are mixed', () => {
  let state = createSupervisorState();
  state = recordEntry(state, config, 5_000);
  assert.throws(
    () => canOpenNewExposure(state, config, 4_999),
    /clock moved backwards|clock domains/,
  );
});
