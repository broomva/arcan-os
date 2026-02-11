/**
 * @agent-os/core — Events
 *
 * Canonical event model for Agent OS.
 * All system behavior is observable through a single event stream.
 * (V1 spec §3)
 */

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

/**
 * All supported v1 event types.
 * Deliberately minimal — extend only when a new observable behavior exists.
 */
export type AgentEventType =
  // Run lifecycle
  | 'run.started'
  | 'run.completed'
  | 'run.failed'
  | 'run.paused'
  | 'run.resumed'
  // Output
  | 'output.delta'
  | 'output.message'
  // Tool execution
  | 'tool.call'
  | 'tool.result'
  // Approval gate
  | 'approval.requested'
  | 'approval.resolved'
  // Artifacts
  | 'artifact.emitted'
  // Checkpoints & snapshots
  | 'checkpoint.created'
  | 'state.snapshot'
  // Engine observability
  | 'engine.request'
  | 'engine.response'
  // Memory
  | 'working_memory.snapshot'
  | 'memory.observed'
  | 'memory.reflected';

// ---------------------------------------------------------------------------
// Event envelope
// ---------------------------------------------------------------------------

/**
 * Every event in the system shares this envelope.
 * Events are immutable and append-only.
 */
export interface AgentEvent<T = unknown> {
  /** Unique event identifier (ULID) */
  eventId: string;
  /** Run this event belongs to */
  runId: string;
  /** Session this event belongs to */
  sessionId: string;
  /** Monotonically increasing sequence number within the run */
  seq: number;
  /** Unix timestamp in milliseconds */
  ts: number;
  /** Discriminated event type */
  type: AgentEventType;
  /** Type-specific payload */
  payload: T;
}

// ---------------------------------------------------------------------------
// Event payloads
// ---------------------------------------------------------------------------

export interface RunStartedPayload {
  prompt: string;
  model: string;
  workspace: string;
  skills: string[];
}

export interface RunCompletedPayload {
  summary: string;
  totalSteps: number;
  totalTokens: { input: number; output: number };
}

export interface RunFailedPayload {
  error: string;
  code?: string;
}

export interface RunPausedPayload {
  reason: 'approval' | 'checkpoint';
  approvalId?: string;
}

export interface RunResumedPayload {
  resumedFrom: 'approval' | 'checkpoint';
}

export interface OutputDeltaPayload {
  text: string;
}

export interface OutputMessagePayload {
  role: 'assistant';
  content: string;
}

export interface ToolCallPayload {
  callId: string;
  toolId: string;
  args: Record<string, unknown>;
}

export interface ToolResultPayload {
  callId: string;
  toolId: string;
  result: unknown;
  durationMs: number;
  approved: boolean;
}

export interface ApprovalRequestedPayload {
  approvalId: string;
  callId: string;
  toolId: string;
  args: Record<string, unknown>;
  preview: Record<string, unknown>;
  risk: RiskProfile;
}

export interface ApprovalResolvedPayload {
  approvalId: string;
  decision: 'approve' | 'deny';
  reason?: string;
  resolvedBy?: string;
}

export interface ArtifactEmittedPayload {
  artifactId: string;
  path: string;
  contentType: string;
  sizeBytes: number;
  hash: string;
}

export interface CheckpointCreatedPayload {
  checkpointId: string;
  summary: string;
  loadedSkills: string[];
  memorySnapshot: Record<string, unknown>;
  lastSeq: number;
}

export interface EngineRequestPayload {
  model: string;
  inputTokens: number;
  stepNumber: number;
}

export interface EngineResponsePayload {
  outputTokens: number;
  latencyMs: number;
  finishReason: string;
  stepNumber: number;
}

export interface WorkingMemorySnapshotPayload {
  data: Record<string, unknown>;
}

export interface StateSnapshotPayload {
  snapshotType: 'run' | 'session' | 'checkpoint';
  data: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Memory Payloads
// ---------------------------------------------------------------------------

import type { Observation, Reflection } from './snapshots.js';

export interface MemoryObservedPayload {
  observations: Observation[];
  processedSeqRange: { start: number; end: number };
}

export interface MemoryReflectedPayload {
  reflections: Reflection[];
}

// ---------------------------------------------------------------------------
// Risk profile (V1 spec §38)
// ---------------------------------------------------------------------------

export interface RiskProfile {
  toolId: string;
  category: 'read' | 'write' | 'exec' | 'network';
  estimatedImpact: 'small' | 'medium' | 'large';
  touchesSecrets: boolean;
  touchesConfig: boolean;
  touchesBuild: boolean;
}
