/**
 * Agent OS — E2E Integration Tests
 *
 * Exercises the full stack: EventStore → RunManager → ToolKernel →
 * ContextAssembler → SkillRegistry → Observability → Daemon HTTP/SSE.
 *
 * Uses Elysia's app.handle() for HTTP tests (same pattern as daemon.test.ts).
 */

import { describe, expect, it, beforeAll, afterAll, beforeEach } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';

// Daemon — import from the same package's src
import { createKernel } from '../src/kernel';
import { createApp } from '../src/app';

// Skills + Context
import { SkillRegistry } from '@agent-os/skills';
import { ContextAssembler, projectMessages } from '@agent-os/context';

// Observability
import { EventTracer } from '@agent-os/observability';
// Note: We need to mock telemetry for tests or rely on what's available
// Since setupTelemetry is exported by @agent-os/observability, we can use it.
import { setupTelemetry, shutdownTelemetry, getInMemoryExporter } from '@agent-os/observability';

// Core types
import type { AgentEvent } from '@agent-os/core';
import type { Kernel } from '../src/kernel';
import { now } from '@agent-os/core';

const TEST_WORKSPACE = join(import.meta.dir, '__e2e_workspace__');

function setupWorkspace() {
  mkdirSync(join(TEST_WORKSPACE, 'src'), { recursive: true });
  writeFileSync(join(TEST_WORKSPACE, 'src', 'hello.ts'), 'export const hello = "world";\n');

  // Create a workspace skill
  const skillDir = join(TEST_WORKSPACE, '.agent', 'skills', 'typescript-guide');
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(
    join(skillDir, 'SKILL.md'),
    `---
name: typescript-guide
description: TypeScript coding guidelines
version: 1.0.0
---
# TypeScript Guide

Always use strict TypeScript. Prefer interfaces over type aliases.
`,
  );
}

function teardownWorkspace() {
  if (existsSync(TEST_WORKSPACE)) {
    rmSync(TEST_WORKSPACE, { recursive: true, force: true });
  }
}

// ===========================================================================
// E2E: Full Run Lifecycle via HTTP
// ===========================================================================

describe('E2E: Full Run Lifecycle', () => {
  let app: ReturnType<typeof createApp>;
  let kernel: Kernel;

  beforeAll(async () => {
    setupWorkspace();
    kernel = await createKernel({ workspace: TEST_WORKSPACE });
    // Disable engine for manual control in tests
    kernel.engine = null;
    app = createApp(kernel);
  });

  afterAll(() => {
    kernel?.eventStore.close();
    teardownWorkspace();
  });

  it('creates a run, emits events, and completes the lifecycle', async () => {
    const sessionId = `e2e-lifecycle-${Date.now()}`;

    // 1. Create a run
    const createRes = await app.handle(
      new Request('http://localhost/v1/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, prompt: 'List files in src/' }),
      }),
    );
    expect(createRes.status).toBe(200);
    const createData = await createRes.json() as any;
    const runId = createData.runId;
    expect(runId).toBeDefined();
    expect(createData.state).toBe('running');

    // 2. Emit some events via RunManager (simulating engine adapter output)
    kernel.runManager.emit(runId, 'output.delta', { text: 'Hello ' });
    kernel.runManager.emit(runId, 'output.delta', { text: 'world!' });
    kernel.runManager.emit(runId, 'tool.call', {
      callId: 'c1',
      toolId: 'repo.read',
      args: { path: 'src/hello.ts' },
    });
    kernel.runManager.emit(runId, 'tool.result', {
      callId: 'c1',
      toolId: 'repo.read',
      result: 'export const hello = "world";',
      durationMs: 5,
      approved: true,
    });

    // 3. Complete the run
    kernel.runManager.completeRun(runId, 'done');

    // 4. Verify events via SSE replay
    const sseRes = await app.handle(
      new Request(`http://localhost/v1/runs/${runId}/events`),
    );
    expect(sseRes.status).toBe(200);
    expect(sseRes.headers.get('Content-Type')).toBe('text/event-stream');

    const sseText = await sseRes.text();
    expect(sseText).toContain('event: run.started');
    expect(sseText).toContain('event: output.delta');
    expect(sseText).toContain('event: tool.call');
    expect(sseText).toContain('event: tool.result');
    expect(sseText).toContain('event: run.completed');

    // 5. Verify materialized state
    const stateRes = await app.handle(
      new Request(`http://localhost/v1/sessions/${sessionId}/state`),
    );
    const stateData = await stateRes.json() as any;
    expect(stateData.sessionId).toBe(sessionId);
    expect(stateData.pendingEvents.length).toBeGreaterThanOrEqual(5);
  });

  it('SSE replay with Last-Event-ID resumes from correct position', async () => {
    const sessionId = `e2e-replay-${Date.now()}`;

    // Create and run
    const createRes = await app.handle(
      new Request('http://localhost/v1/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, prompt: 'Test replay' }),
      }),
    );
    const { runId } = await createRes.json() as any;

    // Emit events
    kernel.runManager.emit(runId, 'output.delta', { text: 'First ' });
    kernel.runManager.emit(runId, 'output.delta', { text: 'Second ' });
    kernel.runManager.emit(runId, 'output.delta', { text: 'Third' });
    kernel.runManager.completeRun(runId, 'done');

    // Get all events to find the second event's ID
    const allEvents = kernel.eventStore.query({ runId, order: 'asc' });
    // Events: run.started, delta(First), delta(Second), delta(Third), run.completed
    expect(allEvents.length).toBe(5);
    const secondEventId = allEvents[1].eventId; // First output.delta

    // Replay from after the second event
    const replayRes = await app.handle(
      new Request(`http://localhost/v1/runs/${runId}/events`, {
        headers: { 'Last-Event-ID': secondEventId },
      }),
    );
    const replayText = await replayRes.text();

    // Should NOT contain First but SHOULD contain Second, Third, completed
    const lines = replayText.split('\n').filter((l: string) => l.startsWith('data: '));
    // It depends on how many lines each event takes.
    // The events are:
    // 1. Second (delta)
    // 2. Third (delta)
    // 3. completed
    // So valid data lines check:
    expect(replayText).not.toContain('First');
    expect(replayText).toContain('Second');
    expect(replayText).toContain('Third');
    expect(replayText).toContain('run.completed');
  });
});

// ===========================================================================
// E2E: Approval Flow
// ===========================================================================

describe('E2E: Approval Flow', () => {
  let app: ReturnType<typeof createApp>;
  let kernel: Kernel;

  beforeAll(async () => {
    if (!existsSync(TEST_WORKSPACE)) setupWorkspace();
    kernel = await createKernel({ workspace: TEST_WORKSPACE });
    kernel.engine = null;
    app = createApp(kernel);
  });

  afterAll(() => {
    kernel?.eventStore.close();
  });

  it('requests approval, resolves via HTTP, and resumes', async () => {
    const sessionId = `e2e-approval-${Date.now()}`;

    // 1. Create a run
    await app.handle(
      new Request('http://localhost/v1/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, prompt: 'Patch a file' }),
      }),
    );

    // 2. Request an approval
    const { approvalId, promise: approvalPromise } = kernel.runManager.approvalGate.requestApproval({
      callId: `call-${Date.now()}`,
      toolId: 'repo.patch',
      args: { path: 'src/test.ts', content: 'export const x = 1;' },
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

    // 3. Verify approval is pending
    const pending = kernel.runManager.approvalGate.getPending();
    expect(pending).toHaveLength(1);
    expect(pending[0].approvalId).toBe(approvalId);

    // 4. Resolve via HTTP
    const approveRes = await app.handle(
      new Request(`http://localhost/v1/approvals/${approvalId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: 'approve', reason: 'Looks good' }),
      }),
    );
    const approveBody = await approveRes.json() as any;
    expect(approveBody.status).toBe('resolved');

    // 5. The approval promise should resolve
    const result = await approvalPromise;
    expect(result.decision).toBe('approve');
    expect(result.reason).toBe('Looks good');

    // 6. No more pending approvals
    expect(kernel.runManager.approvalGate.getPending()).toHaveLength(0);
  });
});

// ===========================================================================
// E2E: Skills + Context Assembly
// ===========================================================================

describe('E2E: Skills + Context Assembly', () => {
  beforeAll(() => {
    if (!existsSync(TEST_WORKSPACE)) setupWorkspace();
  });
  afterAll(teardownWorkspace);

  it('loads workspace skills and assembles a full system prompt', () => {
    const registry = new SkillRegistry({
      workspace: TEST_WORKSPACE,
      homeDir: '/tmp/nonexistent',
    });
    // This is synchronous so no async/await needed
    expect(registry.size).toBe(1);
    expect(registry.get('typescript-guide')).toBeDefined();

    const assembler = new ContextAssembler({
      basePrompt: 'You are Agent OS, a helpful coding assistant.',
      skillRegistry: registry,
      workspace: TEST_WORKSPACE,
    });

    const request = assembler.assemble({
      runConfig: {
        sessionId: 'test-session',
        prompt: 'Fix the TypeScript errors',
        skills: ['typescript-guide'],
      },
      messages: [],
      tools: [],
    });

    expect(request.systemPrompt).toContain('You are Agent OS');
    expect(request.systemPrompt).toContain('## Workspace');
    expect(request.systemPrompt).toContain('## Active Skills');
    expect(request.systemPrompt).toContain('<skill name="typescript-guide">');
    expect(request.systemPrompt).toContain('Always use strict TypeScript');
  });

  it('projects events into conversation messages', () => {
    const events: AgentEvent[] = [
      { eventId: 'e1', runId: 'r1', sessionId: 's1', seq: 1, ts: now(), type: 'run.started', payload: {} },
      { eventId: 'e2', runId: 'r1', sessionId: 's1', seq: 2, ts: now(), type: 'output.delta', payload: { text: 'Looking at ' } },
      { eventId: 'e3', runId: 'r1', sessionId: 's1', seq: 3, ts: now(), type: 'output.delta', payload: { text: 'the code...' } },
      { eventId: 'e4', runId: 'r1', sessionId: 's1', seq: 4, ts: now(), type: 'tool.call', payload: { callId: 'c1', toolId: 'repo.read', args: { path: 'src/hello.ts' } } },
      { eventId: 'e5', runId: 'r1', sessionId: 's1', seq: 5, ts: now(), type: 'tool.result', payload: { callId: 'c1', toolId: 'repo.read', result: 'const x = 1;' } },
      { eventId: 'e6', runId: 'r1', sessionId: 's1', seq: 6, ts: now(), type: 'output.delta', payload: { text: 'Done!' } },
    ];

    const messages = projectMessages(events);
    expect(messages).toHaveLength(4);
    expect(messages[0]).toEqual({ role: 'assistant', content: 'Looking at the code...' });
    expect(messages[1].role).toBe('assistant');
    // @ts-ignore - toolCallId is checked
    expect(messages[1].toolCallId).toBe('c1');
    expect(messages[2].role).toBe('tool');
    expect(messages[2].content).toBe('const x = 1;');
    expect(messages[3]).toEqual({ role: 'assistant', content: 'Done!' });
  });
});

// ===========================================================================
// E2E: Observability
// ===========================================================================

describe('E2E: Observability Event Tracing', () => {
  // Only register shutdown once
  afterAll(async () => {
    try {
      await shutdownTelemetry();
    } catch {
      // ignore
    }
  });

  it('traces a complete run lifecycle through OTel spans', () => {
    const tracer = setupTelemetry({ serviceName: 'agent-os-e2e' });
    const eventTracer = new EventTracer(tracer);
    const runId = 'e2e-run-1';

    const events: AgentEvent[] = [
      { eventId: 'e1', runId, sessionId: 's1', seq: 1, ts: now(), type: 'run.started', payload: {} },
      { eventId: 'e2', runId, sessionId: 's1', seq: 2, ts: now(), type: 'tool.call', payload: { callId: 'c1', toolId: 'repo.read' } },
      { eventId: 'e3', runId, sessionId: 's1', seq: 3, ts: now(), type: 'tool.result', payload: { callId: 'c1', toolId: 'repo.read', durationMs: 15 } },
      { eventId: 'e4', runId, sessionId: 's1', seq: 4, ts: now(), type: 'output.delta', payload: { text: 'result' } },
      { eventId: 'e5', runId, sessionId: 's1', seq: 5, ts: now(), type: 'run.completed', payload: {} },
    ];

    for (const event of events) {
      eventTracer.traceEvent(event);
    }

    expect(eventTracer.activeSpanCount).toBe(0);

    const exporter = getInMemoryExporter();
    const spans = exporter?.getFinishedSpans() ?? [];
    expect(spans.length).toBeGreaterThanOrEqual(2);

    const spanNames = spans.map((s: any) => s.name);
    expect(spanNames).toContain(`run:${runId}`);
    expect(spanNames).toContain('tool:c1');
  });
});

// ===========================================================================
// E2E: Tool Kernel Execution
// ===========================================================================

describe('E2E: Tool Kernel Execution', () => {
  let kernel: Kernel;

  beforeAll(async () => {
    if (!existsSync(TEST_WORKSPACE)) setupWorkspace();
    kernel = await createKernel({ workspace: TEST_WORKSPACE });
    kernel.engine = null;
  });

  afterAll(() => {
    kernel?.eventStore.close();
    teardownWorkspace();
  });

  it('reads a real file through the tool kernel', async () => {
    const result = await kernel.toolKernel.execute(
      'repo.read',
      { path: 'src/hello.ts' },
      'e2e-run',
      'e2e-session',
    );

    // repo.read returns { path, content, totalLines }
    const output = result as { content: string };
    expect(output.content).toContain('export const hello = "world"');
  });

  it('patches a file and reads it back', async () => {
    // Patch
    await kernel.toolKernel.execute(
      'repo.patch',
      { path: 'src/e2e-patched.ts', content: 'export const patched = true;\n' },
      'e2e-run',
      'e2e-session',
    );

    // Read back
    const content = await kernel.toolKernel.execute(
      'repo.read',
      { path: 'src/e2e-patched.ts' },
      'e2e-run',
      'e2e-session',
    );

    const readOutput = content as { content: string };
    expect(readOutput.content).toContain('export const patched = true');
  });
});
