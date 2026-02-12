/**
 * @arcan-os/core
 *
 * Shared types, interfaces, and enums for Arcan OS.
 * This package has no runtime dependencies on any other Arcan OS package.
 */

// Engine — adapter interface
export type {
  AgentEngine,
  EngineChunk,
  EngineChunkKind,
  EngineMessage,
  EngineRunRequest,
} from './engine.js';
// Events — canonical event model
export type {
  AgentEvent,
  AgentEventType,
  ApprovalRequestedPayload,
  ApprovalResolvedPayload,
  ArtifactEmittedPayload,
  CheckpointCreatedPayload,
  EngineRequestPayload,
  EngineResponsePayload,
  MemoryObservedPayload,
  MemoryReflectedPayload,
  OutputDeltaPayload,
  OutputMessagePayload,
  RiskProfile,
  RunCompletedPayload,
  RunFailedPayload,
  RunPausedPayload,
  RunResumedPayload,
  RunStartedPayload,
  StateSnapshotPayload,
  ToolCallPayload,
  ToolResultPayload,
  WorkingMemorySnapshotPayload,
} from './events.js';
// Run — lifecycle state machine
export type { RunConfig, RunRecord, RunState } from './run.js';
export { VALID_TRANSITIONS } from './run.js';
// Snapshots — materialized projections
export type {
  CheckpointSnapshotData,
  Observation,
  Reflection,
  RunSnapshotData,
  SessionSnapshotData,
  Snapshot,
} from './snapshots.js';
// Tools — kernel interface
export type {
  ControlPath,
  PolicyConfig,
  ToolContext,
  ToolHandler,
  ToolPolicy,
} from './tools.js';

// Utilities
export { generateId, now } from './utils.js';
