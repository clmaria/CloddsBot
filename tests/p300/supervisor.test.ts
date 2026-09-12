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
  const now = Date.now();
  let state = createSupervisorState();
  state = recordEntry(state, config, now - 1000);
  state = recordEntry(state, config, now);
  assert.equal(canOpenNewExposure(state, config, now).allowed, false);
});
