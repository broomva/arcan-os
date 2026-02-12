/**
 * @arcan-os/run-manager — Run Manager
 *
 * Owns the run lifecycle state machine.
 * Coordinates the engine adapter, tool kernel, event store, and approval gate.
 * (V1 spec §2, §13)
 */

import type {
  AgentEvent,
  RunCompletedPayload,
  RunConfig,
  RunFailedPayload,
  RunPausedPayload,
  RunRecord,
  RunResumedPayload,
  RunStartedPayload,
  RunState,
} from '@arcan-os/core';
import { generateId, now } from '@arcan-os/core';
import type { EventStore } from '@arcan-os/event-store';
import { ApprovalGate } from './approval-gate.js';

// ---------------------------------------------------------------------------
// Event listener
// ---------------------------------------------------------------------------

export type RunEventListener = (event: AgentEvent) => void;

// ---------------------------------------------------------------------------
// Run Manager
// ---------------------------------------------------------------------------

export class RunManager {
  private runs = new Map<string, RunRecord>();
  private listeners = new Set<RunEventListener>();
  private sessionLocks = new Set<string>();
  readonly approvalGate = new ApprovalGate();

  constructor(private eventStore: EventStore) {}

  // -------------------------------------------------------------------------
  // Run lifecycle
  // -------------------------------------------------------------------------

  /**
   * Create a new run. Does NOT start execution.
   * (V1 spec §2.1)
   */
  createRun(config: RunConfig): RunRecord {
    if (this.sessionLocks.has(config.sessionId)) {
      throw new Error(`Session ${config.sessionId} already has an active run`);
    }

    const runId = generateId();
    const timestamp = now();

    const record: RunRecord = {
      runId,
      sessionId: config.sessionId,
      state: 'created',
      createdAt: timestamp,
      updatedAt: timestamp,
      model: config.model ?? 'anthropic/claude-sonnet-4-20250514',
      workspace: config.workspace ?? process.cwd(),
      prompt: config.prompt,
      skills: config.skills ?? [],
      currentStep: 0,
      tokenUsage: { input: 0, output: 0 },
    };

    this.runs.set(runId, record);
    return record;
  }

  /**
   * Start executing a run.
   * Transitions: created → running, emits run.started
   */
  startRun(runId: string): AgentEvent<RunStartedPayload> {
    const record = this.getRunOrThrow(runId);
    this.assertTransition(record, 'running');

    // Lock the session
    this.sessionLocks.add(record.sessionId);

    // Update state
    record.state = 'running';
    record.updatedAt = now();

    // Emit event
    const event = this.emitEvent<RunStartedPayload>(record, 'run.started', {
      prompt: record.prompt,
      model: record.model,
      workspace: record.workspace,
      skills: record.skills,
    });

    return event;
  }

  /**
   * Pause a run (for approval gating).
   * Transitions: running → paused
   */
  pauseRun(runId: string, approvalId: string): AgentEvent<RunPausedPayload> {
    const record = this.getRunOrThrow(runId);
    this.assertTransition(record, 'paused');

    record.state = 'paused';
    record.updatedAt = now();

    return this.emitEvent<RunPausedPayload>(record, 'run.paused', {
      reason: 'approval',
      approvalId,
    });
  }

  /**
   * Resume a run after approval resolution.
   * Transitions: paused → running
   */
  resumeRun(runId: string): AgentEvent<RunResumedPayload> {
    const record = this.getRunOrThrow(runId);
    this.assertTransition(record, 'running');

    record.state = 'running';
    record.updatedAt = now();

    return this.emitEvent<RunResumedPayload>(record, 'run.resumed', {
      resumedFrom: 'approval',
    });
  }

  /**
   * Complete a run successfully.
   * Transitions: running → completed
   */
  completeRun(runId: string, summary: string): AgentEvent<RunCompletedPayload> {
    const record = this.getRunOrThrow(runId);
    this.assertTransition(record, 'completed');

    record.state = 'completed';
    record.updatedAt = now();

    // Unlock session
    this.sessionLocks.delete(record.sessionId);

    // Cancel any stale approvals
    this.approvalGate.cancelAll();

    return this.emitEvent<RunCompletedPayload>(record, 'run.completed', {
      summary,
      totalSteps: record.currentStep,
      totalTokens: { ...record.tokenUsage },
    });
  }

  /**
   * Fail a run.
   * Transitions: any active state → failed
   */
  failRun(
    runId: string,
    error: string,
    code?: string,
  ): AgentEvent<RunFailedPayload> {
    const record = this.getRunOrThrow(runId);
    this.assertTransition(record, 'failed');

    record.state = 'failed';
    record.updatedAt = now();

    // Unlock session
    this.sessionLocks.delete(record.sessionId);

    // Cancel any pending approvals
    this.approvalGate.cancelAll();

    return this.emitEvent<RunFailedPayload>(record, 'run.failed', {
      error,
      code,
    });
  }

  // -------------------------------------------------------------------------
  // State tracking helpers (called by the engine adapter during execution)
  // -------------------------------------------------------------------------

  /**
   * Increment the step counter for a run.
   */
  incrementStep(runId: string): void {
    const record = this.getRunOrThrow(runId);
    record.currentStep++;
    record.updatedAt = now();
  }

  /**
   * Add token usage for a run.
   */
  addTokenUsage(runId: string, usage: { input: number; output: number }): void {
    const record = this.getRunOrThrow(runId);
    record.tokenUsage.input += usage.input;
    record.tokenUsage.output += usage.output;
    record.updatedAt = now();
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  getRun(runId: string): RunRecord | undefined {
    return this.runs.get(runId);
  }

  getRunOrThrow(runId: string): RunRecord {
    const record = this.runs.get(runId);
    if (!record) throw new Error(`Run not found: ${runId}`);
    return record;
  }

  isSessionLocked(sessionId: string): boolean {
    return this.sessionLocks.has(sessionId);
  }

  // -------------------------------------------------------------------------
  // Event listeners (for SSE broadcasting)
  // -------------------------------------------------------------------------

  onEvent(listener: RunEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  private emitEvent<T>(
    record: RunRecord,
    type: AgentEvent['type'],
    payload: T,
  ): AgentEvent<T> {
    const event = this.eventStore.append<T>({
      runId: record.runId,
      sessionId: record.sessionId,
      type,
      payload,
    });
    console.log(`[RunManager] Appended event: ${event.eventId} (${type})`);

    // Notify all listeners
    for (const listener of this.listeners) {
      try {
        listener(event as AgentEvent);
      } catch {
        // Don't let listener errors break the run
      }
    }

    return event;
  }

  /**
   * Emit an event without changing run state (for tool.call, output.delta, etc.)
   * This is public so the engine adapter can emit events through the run manager.
   */
  emit<T>(runId: string, type: AgentEvent['type'], payload: T): AgentEvent<T> {
    const record = this.getRunOrThrow(runId);
    return this.emitEvent<T>(record, type, payload);
  }

  private assertTransition(record: RunRecord, target: RunState): void {
    const validTransitions: Record<RunState, RunState[]> = {
      created: ['running', 'failed'],
      running: ['paused', 'completed', 'failed'],
      paused: ['running', 'failed'],
      completed: [],
      failed: [],
    };

    const allowed = validTransitions[record.state];
    if (!allowed.includes(target)) {
      throw new Error(
        `Invalid state transition: ${record.state} → ${target} (run ${record.runId})`,
      );
    }
  }
}
