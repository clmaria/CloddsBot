export interface SupervisorConfig {
  maxConsecutiveDecisionFailures: number;
  recoverySuccessesRequired: number;
  maxEntriesPerHour: number;
}

export interface SupervisorState {
  safeMode: boolean;
  consecutiveDecisionFailures: number;
  recoverySuccesses: number;
  entryTimestamps: number[];
  safeModeReason?: string;
}

export interface SupervisorDecision {
  allowed: boolean;
  reason?: string;
  state: SupervisorState;
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
  const cutoff = now - 60 * 60 * 1000;
  return { ...state, entryTimestamps: state.entryTimestamps.filter(ts => ts > cutoff) };
}

export function recordDecisionFailure(
  state: SupervisorState,
  config: SupervisorConfig,
  reason = 'decision layer failure'
): SupervisorState {
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
  now = Date.now()
): SupervisorDecision {
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
  now = Date.now()
): SupervisorState {
  const decision = canOpenNewExposure(stateInput, config, now);
  if (!decision.allowed) throw new Error(decision.reason);
  return { ...decision.state, entryTimestamps: [...decision.state.entryTimestamps, now] };
}
