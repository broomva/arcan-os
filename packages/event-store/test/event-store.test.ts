/**
 * @arcan-os/event-store — Tests
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { EventStore } from '../src/event-store.js';

describe('EventStore', () => {
  let store: EventStore;

  beforeEach(() => {
    store = new EventStore(':memory:');
  });

  afterEach(() => {
    store.close();
  });

  // -----------------------------------------------------------------------
  // Append
  // -----------------------------------------------------------------------

  describe('append', () => {
    it('assigns auto-incrementing seq per run', () => {
      const e1 = store.append({
        runId: 'run-1',
        sessionId: 'sess-1',
        type: 'run.started',
        payload: { prompt: 'hello', model: 'test', workspace: '.', skills: [] },
      });
      const e2 = store.append({
        runId: 'run-1',
        sessionId: 'sess-1',
        type: 'output.delta',
        payload: { text: 'world' },
      });

      expect(e1.seq).toBe(1);
      expect(e2.seq).toBe(2);
    });

    it('tracks seq independently per run', () => {
      store.append({
        runId: 'run-1',
        sessionId: 'sess-1',
        type: 'run.started',
        payload: {},
      });
      const e2 = store.append({
        runId: 'run-2',
        sessionId: 'sess-1',
        type: 'run.started',
        payload: {},
      });

      expect(e2.seq).toBe(1); // independent counter
    });

    it('generates unique eventId and timestamp', () => {
      const event = store.append({
        runId: 'run-1',
        sessionId: 'sess-1',
        type: 'run.started',
        payload: {},
      });

      expect(event.eventId).toBeTruthy();
      expect(event.ts).toBeGreaterThan(0);
    });
  });

  // -----------------------------------------------------------------------
  // Query
  // -----------------------------------------------------------------------

  describe('query', () => {
    beforeEach(() => {
      // Seed events for two runs in one session
      store.append({
        runId: 'run-1',
        sessionId: 'sess-1',
        type: 'run.started',
        payload: {},
      });
      store.append({
        runId: 'run-1',
        sessionId: 'sess-1',
        type: 'tool.call',
        payload: { callId: 'c1', toolId: 'repo.read', args: {} },
      });
      store.append({
        runId: 'run-1',
        sessionId: 'sess-1',
        type: 'tool.result',
        payload: { callId: 'c1', result: 'ok' },
      });
      store.append({
        runId: 'run-1',
        sessionId: 'sess-1',
        type: 'output.delta',
        payload: { text: 'hello' },
      });
      store.append({
        runId: 'run-1',
        sessionId: 'sess-1',
        type: 'run.completed',
        payload: { summary: 'done' },
      });

      store.append({
        runId: 'run-2',
        sessionId: 'sess-1',
        type: 'run.started',
        payload: {},
      });
      store.append({
        runId: 'run-2',
        sessionId: 'sess-1',
        type: 'output.delta',
        payload: { text: 'hi' },
      });
    });

    it('queries by runId', () => {
      const events = store.query({ runId: 'run-1' });
      expect(events).toHaveLength(5);
      expect(events[0].type).toBe('run.started');
      expect(events[4].type).toBe('run.completed');
    });

    it('queries by sessionId', () => {
      const events = store.query({ sessionId: 'sess-1' });
      expect(events).toHaveLength(7); // all events
    });

    it('filters by event types', () => {
      const events = store.query({
        runId: 'run-1',
        types: ['tool.call', 'tool.result'],
      });
      expect(events).toHaveLength(2);
    });

    it('filters by afterSeq', () => {
      const events = store.query({ runId: 'run-1', afterSeq: 3 });
      expect(events).toHaveLength(2);
      expect(events[0].seq).toBe(4);
    });

    it('supports limit and desc order', () => {
      const events = store.query({
        runId: 'run-1',
        order: 'desc',
        limit: 2,
      });
      expect(events).toHaveLength(2);
      expect(events[0].seq).toBe(5); // latest first
    });

    it('returns empty array for no matches', () => {
      const events = store.query({ runId: 'nonexistent' });
      expect(events).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------
  // getByRunId (replay)
  // -----------------------------------------------------------------------

  describe('getByRunId', () => {
    it('returns all events for a run in order', () => {
      store.append({
        runId: 'run-1',
        sessionId: 'sess-1',
        type: 'run.started',
        payload: {},
      });
      store.append({
        runId: 'run-1',
        sessionId: 'sess-1',
        type: 'output.delta',
        payload: { text: 'a' },
      });
      store.append({
        runId: 'run-1',
        sessionId: 'sess-1',
        type: 'run.completed',
        payload: {},
      });

      const events = store.getByRunId('run-1');
      expect(events).toHaveLength(3);
      expect(events[0].seq).toBe(1);
      expect(events[2].seq).toBe(3);
    });
  });

  // -----------------------------------------------------------------------
  // queryLatest
  // -----------------------------------------------------------------------

  describe('queryLatest', () => {
    it('returns the latest event of a type for a session', () => {
      store.append({
        runId: 'r1',
        sessionId: 's1',
        type: 'working_memory.snapshot',
        payload: { data: { v: 1 } },
      });
      store.append({
        runId: 'r1',
        sessionId: 's1',
        type: 'output.delta',
        payload: {},
      });
      store.append({
        runId: 'r1',
        sessionId: 's1',
        type: 'working_memory.snapshot',
        payload: { data: { v: 2 } },
      });

      const latest = store.queryLatest('s1', 'working_memory.snapshot');
      expect(latest).not.toBeNull();
      expect(
        (
          (latest?.payload as Record<string, unknown>)?.data as Record<
            string,
            unknown
          >
        )?.v,
      ).toBe(2);
    });

    it('returns null when no events match', () => {
      const result = store.queryLatest('nonexistent', 'run.started');
      expect(result).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // Snapshots
  // -----------------------------------------------------------------------

  describe('snapshots', () => {
    it('creates and retrieves snapshots', () => {
      const snap = store.createSnapshot({
        sessionId: 'sess-1',
        runId: 'run-1',
        seq: 5,
        type: 'run',
        data: { state: 'completed', summary: 'done' },
      });

      expect(snap.snapshotId).toBeTruthy();
      expect(snap.createdAt).toBeGreaterThan(0);

      const retrieved = store.getLatestSnapshot({
        sessionId: 'sess-1',
        type: 'run',
      });
      expect(retrieved).not.toBeNull();
      expect(retrieved?.data).toEqual({ state: 'completed', summary: 'done' });
    });

    it('returns the latest snapshot by seq', () => {
      store.createSnapshot({
        sessionId: 's1',
        seq: 5,
        type: 'session',
        data: { version: 1 },
      });
      store.createSnapshot({
        sessionId: 's1',
        seq: 15,
        type: 'session',
        data: { version: 2 },
      });

      const latest = store.getLatestSnapshot({
        sessionId: 's1',
        type: 'session',
      });
      expect((latest?.data as Record<string, unknown>)?.version).toBe(2);
    });

    it('returns null when no snapshots exist', () => {
      const result = store.getLatestSnapshot({ sessionId: 'nonexistent' });
      expect(result).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // rebuildSeqCounters
  // -----------------------------------------------------------------------

  describe('rebuildSeqCounters', () => {
    it('restores seq counters from existing data', () => {
      store.append({
        runId: 'r1',
        sessionId: 's1',
        type: 'run.started',
        payload: {},
      });
      store.append({
        runId: 'r1',
        sessionId: 's1',
        type: 'output.delta',
        payload: {},
      });
      store.append({
        runId: 'r1',
        sessionId: 's1',
        type: 'run.completed',
        payload: {},
      });

      // Simulate daemon restart — create new store on same db wouldn't
      // work with :memory:, so we test the method directly
      store.rebuildSeqCounters();

      // Next append should continue from seq 4
      const e4 = store.append({
        runId: 'r1',
        sessionId: 's1',
        type: 'run.started',
        payload: {},
      });
      expect(e4.seq).toBe(4);
    });
  });

  // -----------------------------------------------------------------------
  // Payload serialization
  // -----------------------------------------------------------------------

  describe('payload serialization', () => {
    it('round-trips complex payloads through JSON', () => {
      const complexPayload = {
        files: ['a.ts', 'b.ts'],
        nested: { deep: { value: 42 } },
        array: [1, 'two', { three: true }],
      };

      store.append({
        runId: 'r1',
        sessionId: 's1',
        type: 'artifact.emitted',
        payload: complexPayload,
      });

      const events = store.getByRunId('r1');
      expect(events[0].payload).toEqual(complexPayload);
    });
  });
});
