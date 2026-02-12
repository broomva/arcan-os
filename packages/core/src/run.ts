/**
 * @arcan-os/core — Run types
 *
 * Run lifecycle state machine and record types.
 * (V1 spec §13)
 */

// ---------------------------------------------------------------------------
// Run state machine
// ---------------------------------------------------------------------------

/** Valid states for a run. Transitions: created → running → paused ↔ running → completed | failed */
export type RunState =
  | 'created'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed';

/** Valid state transitions */
export const VALID_TRANSITIONS: Record<RunState, RunState[]> = {
  created: ['running', 'failed'],
  running: ['paused', 'completed', 'failed'],
  paused: ['running', 'failed'],
  completed: [],
  failed: [],
};

// ---------------------------------------------------------------------------
// Run record
// ---------------------------------------------------------------------------

export interface RunRecord {
  runId: string;
  sessionId: string;
  state: RunState;
  createdAt: number;
  updatedAt: number;
  model: string;
  workspace: string;
  prompt: string;
  skills: string[];
  /** Current step count in the agent loop */
  currentStep: number;
  /** Total tokens consumed */
  tokenUsage: { input: number; output: number };
}

// ---------------------------------------------------------------------------
// Run configuration (input to create a run)
// ---------------------------------------------------------------------------

export interface RunConfig {
  sessionId: string;
  prompt: string;
  model?: string;
  workspace?: string;
  skills?: string[];
  maxSteps?: number;
  /** Token budget — stop if exceeded */
  budget?: { maxInputTokens?: number; maxOutputTokens?: number };
}
