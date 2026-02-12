/**
 * @arcan-os/event-store
 *
 * Append-only SQLite event ledger with snapshot support.
 * This is the single source of truth for all Agent OS state.
 *
 * Uses Bun's built-in SQLite for zero-dependency persistence.
 * (V1 spec §4)
 */

import { Database } from 'bun:sqlite';
import type { AgentEvent, AgentEventType, Snapshot } from '@arcan-os/core';
import { generateId, now } from '@arcan-os/core';

// ---------------------------------------------------------------------------
// Query interfaces
// ---------------------------------------------------------------------------

export interface EventQuery {
  runId?: string;
  sessionId?: string;
  types?: AgentEventType[];
  afterSeq?: number;
  beforeSeq?: number;
  limit?: number;
  order?: 'asc' | 'desc';
}

export interface SnapshotQuery {
  sessionId: string;
  runId?: string;
  type?: 'run' | 'session' | 'checkpoint';
}

// ---------------------------------------------------------------------------
// EventStore
// ---------------------------------------------------------------------------

export class EventStore {
  private db: Database;
  private appendStmt!: ReturnType<Database['prepare']>;
  private seqCounter: Map<string, number> = new Map();

  constructor(dbPath = ':memory:') {
    this.db = new Database(dbPath, { create: true });
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA synchronous = NORMAL');
    this.initialize();
  }

  // -------------------------------------------------------------------------
  // Schema
  // -------------------------------------------------------------------------

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        event_id   TEXT PRIMARY KEY,
        run_id     TEXT NOT NULL,
        session_id TEXT NOT NULL,
        seq        INTEGER NOT NULL,
        ts         INTEGER NOT NULL,
        type       TEXT NOT NULL,
        payload    TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_events_run_seq
        ON events (run_id, seq);
      
      CREATE INDEX IF NOT EXISTS idx_events_session_type_seq
        ON events (session_id, type, seq);

      CREATE INDEX IF NOT EXISTS idx_events_session_seq
        ON events (session_id, seq);

      CREATE TABLE IF NOT EXISTS snapshots (
        snapshot_id TEXT PRIMARY KEY,
        session_id  TEXT NOT NULL,
        run_id      TEXT,
        seq         INTEGER NOT NULL,
        type        TEXT NOT NULL,
        data        TEXT NOT NULL,
        created_at  INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_snapshots_session_type
        ON snapshots (session_id, type, seq DESC);
    `);

    this.appendStmt = this.db.prepare(`
      INSERT INTO events (event_id, run_id, session_id, seq, ts, type, payload)
      VALUES ($eventId, $runId, $sessionId, $seq, $ts, $type, $payload)
    `);
  }

  // -------------------------------------------------------------------------
  // Events — append
  // -------------------------------------------------------------------------

  /**
   * Append an event to the ledger.
   * Assigns a monotonically increasing sequence number per run.
   */
  append<T>(
    partial: Omit<AgentEvent<T>, 'eventId' | 'seq' | 'ts'>,
  ): AgentEvent<T> {
    const seq = this.nextSeq(partial.runId);
    const event: AgentEvent<T> = {
      ...partial,
      eventId: generateId(),
      seq,
      ts: now(),
    };

    this.appendStmt.run({
      $eventId: event.eventId,
      $runId: event.runId,
      $sessionId: event.sessionId,
      $seq: event.seq,
      $ts: event.ts,
      $type: event.type,
      $payload: JSON.stringify(event.payload),
    });

    return event;
  }

  private nextSeq(runId: string): number {
    const current = this.seqCounter.get(runId) ?? 0;
    const next = current + 1;
    this.seqCounter.set(runId, next);
    return next;
  }

  // -------------------------------------------------------------------------
  // Events — query
  // -------------------------------------------------------------------------

  /**
   * Query events with flexible filtering.
   */
  query(q: EventQuery): AgentEvent[] {
    const conditions: string[] = [];
    const params: Record<string, string | number | null> = {};

    if (q.runId) {
      conditions.push('run_id = $runId');
      params.$runId = q.runId;
    }
    if (q.sessionId) {
      conditions.push('session_id = $sessionId');
      params.$sessionId = q.sessionId;
    }
    if (q.types && q.types.length > 0) {
      const placeholders = q.types.map((_, i) => `$type${i}`).join(', ');
      conditions.push(`type IN (${placeholders})`);
      q.types.forEach((t, i) => {
        params[`$type${i}`] = t;
      });
    }
    if (q.afterSeq !== undefined) {
      conditions.push('seq > $afterSeq');
      params.$afterSeq = q.afterSeq;
    }
    if (q.beforeSeq !== undefined) {
      conditions.push('seq < $beforeSeq');
      params.$beforeSeq = q.beforeSeq;
    }

    const where =
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const order = q.order === 'desc' ? 'DESC' : 'ASC';
    const limit = q.limit ? 'LIMIT $limit' : '';
    if (q.limit) params.$limit = q.limit;

    const sql = `SELECT * FROM events ${where} ORDER BY seq ${order} ${limit}`;
    // biome-ignore lint/suspicious/noExplicitAny: bun:sqlite bindings are flexible
    const rows = this.db.prepare(sql).all(params as any) as EventRow[];

    return rows.map(rowToEvent);
  }

  /**
   * Get all events for a run, in order. Used for replay.
   */
  getByRunId(runId: string): AgentEvent[] {
    return this.query({ runId, order: 'asc' });
  }

  /**
   * Get the latest event of a given type for a session.
   */
  queryLatest(sessionId: string, type: AgentEventType): AgentEvent | null {
    const results = this.query({
      sessionId,
      types: [type],
      order: 'desc',
      limit: 1,
    });
    return results[0] ?? null;
  }

  // -------------------------------------------------------------------------
  // Snapshots
  // -------------------------------------------------------------------------

  /**
   * Create a materialized snapshot.
   */
  createSnapshot<T>(
    partial: Omit<Snapshot<T>, 'snapshotId' | 'createdAt'>,
  ): Snapshot<T> {
    const snapshot: Snapshot<T> = {
      ...partial,
      snapshotId: generateId(),
      createdAt: now(),
    };

    this.db
      .prepare(
        `INSERT INTO snapshots (snapshot_id, session_id, run_id, seq, type, data, created_at)
         VALUES ($snapshotId, $sessionId, $runId, $seq, $type, $data, $createdAt)`,
      )
      .run({
        $snapshotId: snapshot.snapshotId,
        $sessionId: snapshot.sessionId,
        $runId: snapshot.runId ?? null,
        $seq: snapshot.seq,
        $type: snapshot.type,
        $data: JSON.stringify(snapshot.data),
        $createdAt: snapshot.createdAt,
      });

    return snapshot;
  }

  /**
   * Get the latest snapshot for a session, optionally filtered by type.
   */
  getLatestSnapshot<T>(q: SnapshotQuery): Snapshot<T> | null {
    const conditions = ['session_id = $sessionId'];
    const params: Record<string, string | number | null> = {
      $sessionId: q.sessionId,
    };

    if (q.runId) {
      conditions.push('run_id = $runId');
      params.$runId = q.runId;
    }
    if (q.type) {
      conditions.push('type = $type');
      params.$type = q.type;
    }

    const sql = `SELECT * FROM snapshots WHERE ${conditions.join(' AND ')} ORDER BY seq DESC LIMIT 1`;
    // biome-ignore lint/suspicious/noExplicitAny: bun:sqlite bindings are flexible
    const row = this.db.prepare(sql).get(params as any) as SnapshotRow | null;

    if (!row) return null;

    return {
      snapshotId: row.snapshot_id,
      sessionId: row.session_id,
      runId: row.run_id ?? undefined,
      seq: row.seq,
      type: row.type as Snapshot['type'],
      data: JSON.parse(row.data) as T,
      createdAt: row.created_at,
    };
  }

  // -------------------------------------------------------------------------
  // Sessions
  // -------------------------------------------------------------------------

  /**
   * List all distinct session IDs, ordered by most recent event first.
   */
  listSessionIds(): string[] {
    const rows = this.db
      .prepare(
        'SELECT session_id, MAX(ts) as last_ts FROM events GROUP BY session_id ORDER BY last_ts DESC',
      )
      .all() as Array<{ session_id: string; last_ts: number }>;

    return rows.map((r) => r.session_id);
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Rebuild sequence counters from existing data (for daemon restart).
   */
  rebuildSeqCounters(): void {
    const rows = this.db
      .prepare('SELECT run_id, MAX(seq) as max_seq FROM events GROUP BY run_id')
      .all() as Array<{ run_id: string; max_seq: number }>;

    this.seqCounter.clear();
    for (const row of rows) {
      this.seqCounter.set(row.run_id, row.max_seq);
    }
  }

  /**
   * Close the database connection.
   */
  close(): void {
    this.db.close();
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface EventRow {
  event_id: string;
  run_id: string;
  session_id: string;
  seq: number;
  ts: number;
  type: string;
  payload: string;
}

interface SnapshotRow {
  snapshot_id: string;
  session_id: string;
  run_id: string | null;
  seq: number;
  type: string;
  data: string;
  created_at: number;
}

function rowToEvent(row: EventRow): AgentEvent {
  return {
    eventId: row.event_id,
    runId: row.run_id,
    sessionId: row.session_id,
    seq: row.seq,
    ts: row.ts,
    type: row.type as AgentEventType,
    payload: JSON.parse(row.payload),
  };
}
