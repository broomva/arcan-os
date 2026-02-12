/**
 * @arcan-os/observability — Event Tracer
 *
 * Bridges Arcan OS events to OTel spans for non-AI-SDK activity.
 * Covers: tool execution timing, approval wait time, run lifecycle.
 */

import type { AgentEvent } from '@arcan-os/core';
import {
  type Span,
  SpanKind,
  SpanStatusCode,
  type Tracer,
  trace,
} from '@opentelemetry/api';

// ---------------------------------------------------------------------------
// Event Tracer
// ---------------------------------------------------------------------------

export class EventTracer {
  private tracer: Tracer;
  private activeSpans = new Map<string, Span>();

  constructor(tracer?: Tracer) {
    this.tracer = tracer ?? trace.getTracer('arcan-os-events');
  }

  /**
   * Process an AgentEvent and create/close OTel spans as appropriate.
   */
  traceEvent(event: AgentEvent): void {
    switch (event.type) {
      case 'run.started':
        this.startSpan(`run:${event.runId}`, {
          'arcan-os.run_id': event.runId,
          'arcan-os.session_id': event.sessionId,
          'arcan-os.event_type': event.type,
        });
        break;

      case 'run.completed':
      case 'run.failed':
        this.endSpan(`run:${event.runId}`, {
          status:
            event.type === 'run.failed'
              ? SpanStatusCode.ERROR
              : SpanStatusCode.OK,
        });
        break;

      case 'tool.call': {
        const payload = event.payload as { callId: string; toolId: string };
        this.startSpan(`tool:${payload.callId}`, {
          'arcan-os.tool_id': payload.toolId,
          'arcan-os.call_id': payload.callId,
          'arcan-os.run_id': event.runId,
        });
        break;
      }

      case 'tool.result': {
        const payload = event.payload as {
          callId: string;
          toolId: string;
          durationMs: number;
        };
        this.endSpan(`tool:${payload.callId}`, {
          attributes: {
            'arcan-os.tool_duration_ms': payload.durationMs,
          },
        });
        break;
      }

      case 'approval.requested': {
        const payload = event.payload as { approvalId: string; toolId: string };
        this.startSpan(`approval:${payload.approvalId}`, {
          'arcan-os.approval_id': payload.approvalId,
          'arcan-os.tool_id': payload.toolId,
          'arcan-os.run_id': event.runId,
        });
        break;
      }

      case 'approval.resolved': {
        const payload = event.payload as {
          approvalId: string;
          decision: string;
        };
        this.endSpan(`approval:${payload.approvalId}`, {
          attributes: {
            'arcan-os.approval_decision': payload.decision,
          },
        });
        break;
      }

      default: {
        // Record as a simple event on the run span
        const runSpan = this.activeSpans.get(`run:${event.runId}`);
        if (runSpan) {
          runSpan.addEvent(event.type, {
            'arcan-os.seq': event.seq,
            'arcan-os.event_id': event.eventId,
          });
        }
        break;
      }
    }
  }

  // -----------------------------------------------------------------------
  // Internal
  // -----------------------------------------------------------------------

  private startSpan(
    key: string,
    attributes: Record<string, string | number>,
  ): void {
    const span = this.tracer.startSpan(key, {
      kind: SpanKind.INTERNAL,
      attributes,
    });
    this.activeSpans.set(key, span);
  }

  private endSpan(
    key: string,
    opts?: {
      status?: SpanStatusCode;
      attributes?: Record<string, string | number>;
    },
  ): void {
    const span = this.activeSpans.get(key);
    if (!span) return;

    if (opts?.attributes) {
      for (const [k, v] of Object.entries(opts.attributes)) {
        span.setAttribute(k, v);
      }
    }

    if (opts?.status !== undefined) {
      span.setStatus({ code: opts.status });
    }

    span.end();
    this.activeSpans.delete(key);
  }

  /**
   * Get the count of active spans (for testing).
   */
  get activeSpanCount(): number {
    return this.activeSpans.size;
  }
}
