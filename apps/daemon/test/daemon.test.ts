/**
 * @arcan-os/daemon — Integration tests
 *
 * Tests the daemon HTTP API endpoints without an LLM.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { createApp } from '../src/app';
import { createKernel } from '../src/kernel';

describe('Daemon API', () => {
  let app: ReturnType<typeof createApp>;
  let kernel: Awaited<ReturnType<typeof createKernel>>;

  beforeEach(async () => {
    kernel = await createKernel({ workspace: process.cwd() });
    // Disable engine so we can control the run lifecycle manually
    kernel.engine = null;
    app = createApp(kernel);
  });

  afterEach(() => {
    kernel.eventStore.close();
  });

  // -----------------------------------------------------------------------
  // Health
  // -----------------------------------------------------------------------

  describe('GET /v1/health', () => {
    it('returns ok', async () => {
      const res = await app.handle(new Request('http://localhost/v1/health'));
      const body = await res.json();
      expect(body.status).toBe('ok');
      expect(body.ts).toBeGreaterThan(0);
    });
  });

  // -----------------------------------------------------------------------
  // Create run
  // -----------------------------------------------------------------------

  describe('POST /v1/runs', () => {
    it('creates and starts a run', async () => {
      const res = await app.handle(
        new Request('http://localhost/v1/runs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId: 'test-session',
            prompt: 'hello world',
          }),
        }),
      );

      const body = (await res.json()) as {
        runId: string;
        sessionId: string;
        state: string;
      };
      expect(body.runId).toBeTruthy();
      expect(body.sessionId).toBe('test-session');
      expect(body.state).toBe('running');
    });

    it('rejects duplicate session', async () => {
      // First run
      await app.handle(
        new Request('http://localhost/v1/runs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId: 'locked-session',
            prompt: 'first',
          }),
        }),
      );

      // Second run on same session
      const res = await app.handle(
        new Request('http://localhost/v1/runs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId: 'locked-session',
            prompt: 'second',
          }),
        }),
      );

      expect(res.status).toBe(409);
    });
  });

  // -----------------------------------------------------------------------
  // Events (SSE replay)
  // -----------------------------------------------------------------------

  describe('GET /v1/runs/:runId/events', () => {
    it('replays existing events as SSE', async () => {
      // Create a run to generate events
      const createRes = await app.handle(
        new Request('http://localhost/v1/runs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: 's1', prompt: 'test' }),
        }),
      );
      const createBody = (await createRes.json()) as { runId: string };
      const runId = createBody.runId;

      // Add more events
      kernel.runManager.emit(runId, 'output.delta', { text: 'hello' });
      kernel.runManager.completeRun(runId, 'done');

      // Fetch SSE stream
      const controller = new AbortController();
      const res = await app.handle(
        new Request(`http://localhost/v1/runs/${runId}/events`, {
          signal: controller.signal,
        }),
      );

      expect(res.headers.get('Content-Type')).toBe('text/event-stream');

      // Read the stream
      const text = await res.text();

      // Should contain our events
      expect(text).toContain('event: run.started');
      expect(text).toContain('event: output.delta');
      expect(text).toContain('event: run.completed');
      expect(text).toContain('"hello"');
    });
  });

  // -----------------------------------------------------------------------
  // Approvals
  // -----------------------------------------------------------------------

  describe('POST /v1/approvals/:approvalId', () => {
    it('resolves a pending approval', async () => {
      // Create a pending approval
      const { approvalId, promise } =
        kernel.runManager.approvalGate.requestApproval({
          callId: 'c1',
          toolId: 'repo.patch',
          args: {},
          preview: {},
          risk: {
            toolId: 'repo.patch',
            category: 'write',
            estimatedImpact: 'medium',
            touchesSecrets: false,
            touchesConfig: false,
            touchesBuild: false,
          },
        });

      const res = await app.handle(
        new Request(`http://localhost/v1/approvals/${approvalId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ decision: 'approve' }),
        }),
      );

      const body = (await res.json()) as { status: string };
      expect(body.status).toBe('resolved');

      const decision = await promise;
      expect(decision.decision).toBe('approve');
    });

    it('returns 404 for unknown approval', async () => {
      const res = await app.handle(
        new Request('http://localhost/v1/approvals/nonexistent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ decision: 'deny' }),
        }),
      );

      expect(res.status).toBe(404);
    });
  });

  // -----------------------------------------------------------------------
  // Session state
  // -----------------------------------------------------------------------

  describe('GET /v1/sessions/:sessionId/state', () => {
    it('returns materialized state with events', async () => {
      // Create a run to generate events
      const createRes = await app.handle(
        new Request('http://localhost/v1/runs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: 'state-test', prompt: 'test' }),
        }),
      );
      const { runId } = (await createRes.json()) as { runId: string };

      kernel.runManager.emit(runId, 'output.delta', { text: 'hi' });

      // Get state
      const stateRes = await app.handle(
        new Request('http://localhost/v1/sessions/state-test/state'),
      );

      const state = (await stateRes.json()) as {
        sessionId: string;
        pendingEvents: unknown[];
        snapshot: unknown;
      };
      expect(state.sessionId).toBe('state-test');
      // started + engine.request + output.delta = 3
      expect(state.pendingEvents.length).toBeGreaterThanOrEqual(2);
      expect(state.snapshot).toBeNull(); // no snapshots yet
    });

    it('returns snapshot + pending events after snapshotting', async () => {
      // Create events
      const createRes = await app.handle(
        new Request('http://localhost/v1/runs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: 'snap-test', prompt: 'test' }),
        }),
      );
      const { runId } = (await createRes.json()) as { runId: string };

      // Create a snapshot at seq 1
      kernel.eventStore.createSnapshot({
        sessionId: 'snap-test',
        runId,
        seq: 1,
        type: 'session',
        data: { summary: 'snapped at 1' },
      });

      // Add more events after the snapshot
      kernel.runManager.emit(runId, 'output.delta', { text: 'after snap' });

      const stateRes = await app.handle(
        new Request('http://localhost/v1/sessions/snap-test/state'),
      );
      const state = (await stateRes.json()) as {
        snapshot: { data: { summary: string } };
        pendingEvents: { seq: number }[];
      };

      expect(state.snapshot).not.toBeNull();
      expect(state.snapshot.data.summary).toBe('snapped at 1');
      // pendingEvents should only be events after seq 1
      expect(state.pendingEvents.length).toBeGreaterThan(0);
      expect(state.pendingEvents.every((e) => e.seq > 1)).toBe(true);
    });
  });
});
