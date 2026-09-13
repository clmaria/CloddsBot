export interface SupervisorConfig {
  maxConsecutiveDecisionFailures: number;
  recoverySuccessesRequired: number;
  maxEntriesPerHour: number;
}

export interface SupervisorState {
  safeMode: boolean;
  consecutiveDecisionFailures: number;
  recoverySuccesses: number;
  /**
   * Process-local monotonic milliseconds. Do not persist these values across a
   * process restart or mix them with wall-clock epoch timestamps.
   */
  entryTimestamps: number[];
  safeModeReason?: string;
}

export interface SupervisorDecision {
  allowed: boolean;
  reason?: string;
  state: SupervisorState;
}

function validateConfig(config: SupervisorConfig): void {
  if (!Number.isInteger(config.maxConsecutiveDecisionFailures) || config.maxConsecutiveDecisionFailures <= 0) {
    throw new Error('max consecutive decision failures must be a positive integer');
  }
  if (!Number.isInteger(config.recoverySuccessesRequired) || config.recoverySuccessesRequired <= 0) {
    throw new Error('recovery successes required must be a positive integer');
  }
  if (!Number.isInteger(config.maxEntriesPerHour) || config.maxEntriesPerHour < 0) {
    throw new Error('max entries per hour must be a non-negative integer');
  }
}

function validateState(state: SupervisorState): void {
  if (!Number.isInteger(state.consecutiveDecisionFailures) || state.consecutiveDecisionFailures < 0) {
    throw new Error('consecutive decision failures must be a non-negative integer');
  }
  if (!Number.isInteger(state.recoverySuccesses) || state.recoverySuccesses < 0) {
    throw new Error('recovery successes must be a non-negative integer');
  }
  if (!Array.isArray(state.entryTimestamps)) throw new Error('entry timestamps must be an array');
  for (const timestamp of state.entryTimestamps) {
    if (!Number.isFinite(timestamp) || timestamp < 0) {
      throw new Error('entry timestamps must be non-negative finite monotonic values');
    }
  }
}

function validateNow(now: number): void {
  if (!Number.isFinite(now) || now < 0) throw new Error('current time must be a non-negative finite monotonic timestamp');
}

function monotonicNowMs(): number {
  return performance.now();
}

export function createSupervisorState(): SupervisorState {
  return {
    safeMode: false,
    consecutiveDecisionFailures: 0,
    recoverySuccesses: 0,
    entryTimestamps: [],
  };
}

function pruneEntries(state: SupervisorState, now: number): SupervisorState {
  validateState(state);
  validateNow(now);
  if (state.entryTimestamps.some((timestamp) => timestamp > now)) {
    throw new Error('supervisor monotonic clock moved backwards or clock domains were mixed');
  }
  const cutoff = now - 60 * 60 * 1000;
  return { ...state, entryTimestamps: state.entryTimestamps.filter(ts => ts > cutoff) };
}

export function recordDecisionFailure(
  state: SupervisorState,
  config: SupervisorConfig,
  reason = 'decision layer failure'
): SupervisorState {
  validateState(state);
  validateConfig(config);
  if (!reason.trim()) throw new Error('decision failure reason is required');

  const failures = state.consecutiveDecisionFailures + 1;
  if (failures >= config.maxConsecutiveDecisionFailures) {
    return {
      ...state,
      safeMode: true,
      consecutiveDecisionFailures: failures,
      recoverySuccesses: 0,
      safeModeReason: reason,
    };
  }
  return { ...state, consecutiveDecisionFailures: failures, recoverySuccesses: 0 };
}

export function recordDecisionSuccess(
  state: SupervisorState,
  config: SupervisorConfig
): SupervisorState {
  validateState(state);
  validateConfig(config);

  if (!state.safeMode) {
    return { ...state, consecutiveDecisionFailures: 0, recoverySuccesses: 0 };
  }

  const recoverySuccesses = state.recoverySuccesses + 1;
  if (recoverySuccesses >= config.recoverySuccessesRequired) {
    return {
      ...state,
      safeMode: false,
      consecutiveDecisionFailures: 0,
      recoverySuccesses: 0,
      safeModeReason: undefined,
    };
  }

  return { ...state, recoverySuccesses };
}

export function canOpenNewExposure(
  stateInput: SupervisorState,
  config: SupervisorConfig,
  now = monotonicNowMs()
): SupervisorDecision {
  validateConfig(config);
  const state = pruneEntries(stateInput, now);

  if (state.safeMode) {
    return { allowed: false, reason: state.safeModeReason ?? 'P300 safe mode active', state };
  }

  if (state.entryTimestamps.length >= config.maxEntriesPerHour) {
    return { allowed: false, reason: 'P300 hourly entry throttle reached', state };
  }

  return { allowed: true, state };
}

export function recordEntry(
  stateInput: SupervisorState,
  config: SupervisorConfig,
  now = monotonicNowMs()
): SupervisorState {
  const decision = canOpenNewExposure(stateInput, config, now);
  if (!decision.allowed) throw new Error(decision.reason);
  return { ...decision.state, entryTimestamps: [...decision.state.entryTimestamps, now] };
}
