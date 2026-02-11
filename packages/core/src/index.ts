/**
 * @agent-os/core
 *
 * Shared types, interfaces, and enums for Agent OS.
 * This package has no runtime dependencies on any other Agent OS package.
 */

// Events — canonical event model
export type {
  AgentEventType,
  AgentEvent,
  RunStartedPayload,
  RunCompletedPayload,
  RunFailedPayload,
  RunPausedPayload,
  RunResumedPayload,
  OutputDeltaPayload,
  OutputMessagePayload,
  ToolCallPayload,
  ToolResultPayload,
  ApprovalRequestedPayload,
  ApprovalResolvedPayload,
  ArtifactEmittedPayload,
  CheckpointCreatedPayload,
  EngineRequestPayload,
  EngineResponsePayload,
  WorkingMemorySnapshotPayload,
  StateSnapshotPayload,
  RiskProfile,
  MemoryObservedPayload,
  MemoryReflectedPayload,
} from './events.js';

// Run — lifecycle state machine
export type { RunState, RunRecord, RunConfig } from './run.js';
export { VALID_TRANSITIONS } from './run.js';

// Tools — kernel interface
export type {
  ToolHandler,
  ToolContext,
  ControlPath,
  ToolPolicy,
  PolicyConfig,
} from './tools.js';

// Engine — adapter interface
export type {
  EngineChunkKind,
  EngineChunk,
  EngineRunRequest,
  EngineMessage,
  AgentEngine,
} from './engine.js';

// Snapshots — materialized projections
export type {
  Snapshot,
  RunSnapshotData,
  SessionSnapshotData,
  CheckpointSnapshotData,
  Observation,
  Reflection,
} from './snapshots.js';

// Utilities
export { generateId, now } from './utils.js';
