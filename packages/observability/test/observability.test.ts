/**
 * @agent-os/observability — Tests
 */

import { afterEach, describe, expect, it } from 'bun:test';
import type { AgentEvent } from '@agent-os/core';
import { EventTracer } from '../src/event-tracer.js';
import {
  getInMemoryExporter,
  setupTelemetry,
  shutdownTelemetry,
} from '../src/otel-setup.js';

// =========================================================================
// OTel Setup
// =========================================================================

describe('setupTelemetry', () => {
  afterEach(async () => {
    await shutdownTelemetry();
  });

  it('returns a tracer', () => {
    const tracer = setupTelemetry();
    expect(tracer).toBeDefined();
    expect(typeof tracer.startSpan).toBe('function');
  });

  it('creates in-memory exporter when no exporters configured', () => {
    setupTelemetry();
    const exporter = getInMemoryExporter();
    expect(exporter).not.toBeNull();
  });

  it('records spans in memory exporter', () => {
    const tracer = setupTelemetry();
    const span = tracer.startSpan('test-span');
    span.setAttribute('test', true);
    span.end();

    const exporter = getInMemoryExporter();
    const spans = exporter?.getFinishedSpans();
    expect(spans.length).toBeGreaterThanOrEqual(1);
  });
});

// =========================================================================
// EventTracer
// =========================================================================

describe('EventTracer', () => {
  const makeEvent = (
    type: string,
    payload: unknown,
    seq: number,
  ): AgentEvent => ({
    eventId: `e${seq}`,
    runId: 'run1',
    sessionId: 'sess1',
    seq,
    ts: Date.now(),
    type: type as AgentEvent['type'],
    payload,
  });

  afterEach(async () => {
    await shutdownTelemetry();
  });

  it('creates spans for run lifecycle', () => {
    const tracer = setupTelemetry();
    const eventTracer = new EventTracer(tracer);

    eventTracer.traceEvent(makeEvent('run.started', {}, 1));
    expect(eventTracer.activeSpanCount).toBe(1);

    eventTracer.traceEvent(makeEvent('run.completed', {}, 2));
    expect(eventTracer.activeSpanCount).toBe(0);
  });

  it('creates spans for tool execution', () => {
    const tracer = setupTelemetry();
    const eventTracer = new EventTracer(tracer);

    eventTracer.traceEvent(
      makeEvent('tool.call', { callId: 'c1', toolId: 'repo.read' }, 1),
    );
    expect(eventTracer.activeSpanCount).toBe(1);

    eventTracer.traceEvent(
      makeEvent(
        'tool.result',
        { callId: 'c1', toolId: 'repo.read', durationMs: 42 },
        2,
      ),
    );
    expect(eventTracer.activeSpanCount).toBe(0);
  });

  it('creates spans for approval lifecycle', () => {
    const tracer = setupTelemetry();
    const eventTracer = new EventTracer(tracer);

    eventTracer.traceEvent(
      makeEvent(
        'approval.requested',
        { approvalId: 'a1', toolId: 'repo.patch' },
        1,
      ),
    );
    expect(eventTracer.activeSpanCount).toBe(1);

    eventTracer.traceEvent(
      makeEvent(
        'approval.resolved',
        { approvalId: 'a1', decision: 'approve' },
        2,
      ),
    );
    expect(eventTracer.activeSpanCount).toBe(0);
  });

  it('handles nested run + tool spans', () => {
    const tracer = setupTelemetry();
    const eventTracer = new EventTracer(tracer);

    eventTracer.traceEvent(makeEvent('run.started', {}, 1));
    eventTracer.traceEvent(
      makeEvent('tool.call', { callId: 'c1', toolId: 'repo.read' }, 2),
    );
    expect(eventTracer.activeSpanCount).toBe(2);

    eventTracer.traceEvent(
      makeEvent(
        'tool.result',
        { callId: 'c1', toolId: 'repo.read', durationMs: 10 },
        3,
      ),
    );
    expect(eventTracer.activeSpanCount).toBe(1);

    eventTracer.traceEvent(makeEvent('run.completed', {}, 4));
    expect(eventTracer.activeSpanCount).toBe(0);
  });

  it('adds non-lifecycle events to run span', () => {
    const tracer = setupTelemetry();
    const eventTracer = new EventTracer(tracer);

    // Start a run first
    eventTracer.traceEvent(makeEvent('run.started', {}, 1));

    // These should just add events to the run span (no new span created)
    eventTracer.traceEvent(makeEvent('output.delta', { text: 'hi' }, 2));
    eventTracer.traceEvent(makeEvent('engine.request', {}, 3));

    // Still only 1 active span (the run)
    expect(eventTracer.activeSpanCount).toBe(1);

    eventTracer.traceEvent(makeEvent('run.completed', {}, 4));
    expect(eventTracer.activeSpanCount).toBe(0);
  });
});
