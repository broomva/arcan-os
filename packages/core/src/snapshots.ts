/**
 * @agent-os/core — Snapshot types
 *
 * Materialized projections of the event stream.
 * Snapshots are performance caches — never the source of truth.
 */

// ---------------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------------

export interface Snapshot<T = Record<string, unknown>> {
  snapshotId: string;
  sessionId: string;
  runId?: string;
  /** The event sequence number this snapshot covers up to */
  seq: number;
  /** Snapshot type discriminator */
  type: 'run' | 'session' | 'checkpoint';
  /** Materialized projection data */
  data: T;
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Typed snapshot data
// ---------------------------------------------------------------------------

export interface RunSnapshotData {
  state: string;
  totalSteps: number;
  filesModified: string[];
  toolsUsed: string[];
  tokenUsage: { input: number; output: number };
  summary: string;
}

export interface SessionSnapshotData {
  workingMemory: Record<string, unknown>;
  recentMessageSummary: string;
  activeSkills: string[];
  // Observational Memory
  observations: Observation[];
  reflections: Reflection[];
  lastObservedSeq: number;
}

export interface Observation {
  id: string;
  ts: number;
  type: 'fact' | 'action' | 'outcome';
  content: string;
  sourceEventIds: string[];
}

export interface Reflection {
  id: string;
  topic: string;
  content: string;
  frequency: number;
  ts: number;
}

export interface CheckpointSnapshotData {
  summary: string;
  loadedSkills: string[];
  memorySnapshot: Record<string, unknown>;
  fileReferences: string[];
}
