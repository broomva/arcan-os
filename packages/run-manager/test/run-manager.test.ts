/**
 * @arcan-os/run-manager — Tests
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { AgentEvent } from '@arcan-os/core';
import { EventStore } from '@arcan-os/event-store';
import { ApprovalGate } from '../src/approval-gate.js';
import { RunManager } from '../src/run-manager.js';

// =========================================================================
// ApprovalGate tests
// =========================================================================

describe('ApprovalGate', () => {
  let gate: ApprovalGate;

  beforeEach(() => {
    gate = new ApprovalGate();
  });

  it('creates a pending approval that resolves on approve', async () => {
    const risk = {
      toolId: 'repo.patch',
      category: 'write' as const,
      estimatedImpact: 'medium' as const,
      touchesSecrets: false,
      touchesConfig: false,
      touchesBuild: false,
    };
    const { approvalId, promise } = gate.requestApproval({
      callId: 'c1',
      toolId: 'repo.patch',
      args: { path: 'test.ts' },
      preview: { files: 1 },
      risk,
    });

    expect(gate.hasPending(approvalId)).toBe(true);
    expect(gate.size).toBe(1);

    gate.resolveApproval(approvalId, { decision: 'approve' });

    const result = await promise;
    expect(result.decision).toBe('approve');
    expect(gate.size).toBe(0);
  });

  it('creates a pending approval that resolves on deny', async () => {
    const risk = {
      toolId: 'process.run',
      category: 'exec' as const,
      estimatedImpact: 'large' as const,
      touchesSecrets: false,
      touchesConfig: false,
      touchesBuild: false,
    };
    const { approvalId, promise } = gate.requestApproval({
      callId: 'c2',
      toolId: 'process.run',
      args: { command: 'rm -rf /' },
      preview: {},
      risk,
    });

    gate.resolveApproval(approvalId, { decision: 'deny', reason: 'dangerous' });

    const result = await promise;
    expect(result.decision).toBe('deny');
    expect(result.reason).toBe('dangerous');
  });

  it('throws on resolving unknown approval', () => {
    expect(() =>
      gate.resolveApproval('nope', { decision: 'approve' }),
    ).toThrow();
  });

  it('cancels individual approvals', async () => {
    const { approvalId, promise } = gate.requestApproval({
      callId: 'c3',
      toolId: 'test',
      args: {},
      preview: {},
      risk: {
        toolId: 'test',
        category: 'read',
        estimatedImpact: 'small',
        touchesSecrets: false,
        touchesConfig: false,
        touchesBuild: false,
      },
    });

    gate.cancelApproval(approvalId);
    await expect(promise).rejects.toThrow('Approval cancelled');
    expect(gate.size).toBe(0);
  });

  it('cancels all pending approvals', async () => {
    const risk = {
      toolId: 't',
      category: 'read' as const,
      estimatedImpact: 'small' as const,
      touchesSecrets: false,
      touchesConfig: false,
      touchesBuild: false,
    };
    const { promise: p1 } = gate.requestApproval({
      callId: 'c1',
      toolId: 't',
      args: {},
      preview: {},
      risk,
    });
    const { promise: p2 } = gate.requestApproval({
      callId: 'c2',
      toolId: 't',
      args: {},
      preview: {},
      risk,
    });

    gate.cancelAll();

    await expect(p1).rejects.toThrow();
    await expect(p2).rejects.toThrow();
    expect(gate.size).toBe(0);
  });

  it('lists pending approvals', () => {
    const risk = {
      toolId: 't',
      category: 'read' as const,
      estimatedImpact: 'small' as const,
      touchesSecrets: false,
      touchesConfig: false,
      touchesBuild: false,
    };
    gate.requestApproval({
      callId: 'c1',
      toolId: 'a',
      args: {},
      preview: {},
      risk,
    });
    gate.requestApproval({
      callId: 'c2',
      toolId: 'b',
      args: {},
      preview: {},
      risk,
    });

    const pending = gate.getPending();
    expect(pending).toHaveLength(2);
    expect(pending.map((p) => p.toolId).sort()).toEqual(['a', 'b']);
  });
});

// =========================================================================
// RunManager tests
// =========================================================================

describe('RunManager', () => {
  let store: EventStore;
  let manager: RunManager;

  beforeEach(() => {
    store = new EventStore(':memory:');
    manager = new RunManager(store);
  });

  afterEach(() => {
    store.close();
  });

  // -----------------------------------------------------------------------
  // createRun
  // -----------------------------------------------------------------------

  describe('createRun', () => {
    it('creates a run in "created" state', () => {
      const record = manager.createRun({
        sessionId: 'sess-1',
        prompt: 'hello',
      });

      expect(record.state).toBe('created');
      expect(record.runId).toBeTruthy();
      expect(record.sessionId).toBe('sess-1');
      expect(record.prompt).toBe('hello');
    });

    it('sets default model and workspace', () => {
      const record = manager.createRun({
        sessionId: 'sess-1',
        prompt: 'test',
      });

      expect(record.model).toBeTruthy();
      expect(record.workspace).toBeTruthy();
    });
  });

  // -----------------------------------------------------------------------
  // State transitions
  // -----------------------------------------------------------------------

  describe('state transitions', () => {
    it('follows created → running → completed lifecycle', () => {
      const record = manager.createRun({ sessionId: 's1', prompt: 'test' });

      manager.startRun(record.runId);
      expect(manager.getRun(record.runId)?.state).toBe('running');

      manager.completeRun(record.runId, 'done');
      expect(manager.getRun(record.runId)?.state).toBe('completed');
    });

    it('follows running → paused → running → completed', () => {
      const record = manager.createRun({ sessionId: 's1', prompt: 'test' });
      manager.startRun(record.runId);

      manager.pauseRun(record.runId, 'approval-1');
      expect(manager.getRun(record.runId)?.state).toBe('paused');

      manager.resumeRun(record.runId);
      expect(manager.getRun(record.runId)?.state).toBe('running');

      manager.completeRun(record.runId, 'done');
      expect(manager.getRun(record.runId)?.state).toBe('completed');
    });

    it('allows transition to failed from any active state', () => {
      const r1 = manager.createRun({ sessionId: 's1', prompt: 'test' });
      manager.startRun(r1.runId);
      manager.failRun(r1.runId, 'boom');
      expect(manager.getRun(r1.runId)?.state).toBe('failed');
    });

    it('rejects invalid transitions', () => {
      const record = manager.createRun({ sessionId: 's1', prompt: 'test' });
      expect(() => manager.pauseRun(record.runId, 'x')).toThrow(
        'Invalid state transition',
      );
    });
  });

  // -----------------------------------------------------------------------
  // Session queue
  // -----------------------------------------------------------------------

  describe('session queue', () => {
    it('locks session during active run', () => {
      const record = manager.createRun({ sessionId: 's1', prompt: 'test' });
      manager.startRun(record.runId);

      expect(manager.isSessionLocked('s1')).toBe(true);
      expect(() =>
        manager.createRun({ sessionId: 's1', prompt: 'another' }),
      ).toThrow('already has an active run');
    });

    it('unlocks session on completion', () => {
      const record = manager.createRun({ sessionId: 's1', prompt: 'test' });
      manager.startRun(record.runId);
      manager.completeRun(record.runId, 'done');

      expect(manager.isSessionLocked('s1')).toBe(false);
    });

    it('unlocks session on failure', () => {
      const record = manager.createRun({ sessionId: 's1', prompt: 'test' });
      manager.startRun(record.runId);
      manager.failRun(record.runId, 'error');

      expect(manager.isSessionLocked('s1')).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Event emission
  // -----------------------------------------------------------------------

  describe('event emission', () => {
    it('emits events to the event store', () => {
      const record = manager.createRun({ sessionId: 's1', prompt: 'test' });
      manager.startRun(record.runId);

      const events = store.getByRunId(record.runId);
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('run.started');
    });

    it('notifies listeners on events', () => {
      const received: AgentEvent[] = [];
      manager.onEvent((e) => received.push(e));

      const record = manager.createRun({ sessionId: 's1', prompt: 'test' });
      manager.startRun(record.runId);
      manager.completeRun(record.runId, 'done');

      expect(received).toHaveLength(2);
      expect(received[0].type).toBe('run.started');
      expect(received[1].type).toBe('run.completed');
    });

    it('allows unsubscribing listeners', () => {
      const received: AgentEvent[] = [];
      const unsub = manager.onEvent((e) => received.push(e));

      const record = manager.createRun({ sessionId: 's1', prompt: 'test' });
      manager.startRun(record.runId);
      unsub();
      manager.completeRun(record.runId, 'done');

      expect(received).toHaveLength(1); // only run.started
    });

    it('emit() allows engine adapter to emit events', () => {
      const record = manager.createRun({ sessionId: 's1', prompt: 'test' });
      manager.startRun(record.runId);

      manager.emit(record.runId, 'output.delta', { text: 'hello' });
      manager.emit(record.runId, 'tool.call', {
        callId: 'c1',
        toolId: 'repo.read',
        args: {},
      });

      const events = store.getByRunId(record.runId);
      expect(events).toHaveLength(3); // started + delta + tool.call
    });
  });

  // -----------------------------------------------------------------------
  // Step/token tracking
  // -----------------------------------------------------------------------

  describe('tracking helpers', () => {
    it('increments step count', () => {
      const record = manager.createRun({ sessionId: 's1', prompt: 'test' });
      manager.startRun(record.runId);

      manager.incrementStep(record.runId);
      manager.incrementStep(record.runId);

      expect(manager.getRun(record.runId)?.currentStep).toBe(2);
    });

    it('accumulates token usage', () => {
      const record = manager.createRun({ sessionId: 's1', prompt: 'test' });
      manager.startRun(record.runId);

      manager.addTokenUsage(record.runId, { input: 100, output: 50 });
      manager.addTokenUsage(record.runId, { input: 200, output: 100 });

      const run = manager.getRun(record.runId);
      expect(run).toBeDefined();
      if (!run) return;
      expect(run.tokenUsage.input).toBe(300);
      expect(run.tokenUsage.output).toBe(150);
    });
  });
});
