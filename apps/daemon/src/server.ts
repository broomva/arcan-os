/**
 * @agent-os/daemon — Elysia HTTP/SSE Server
 *
 * The daemon (agentd) exposes Agent OS over HTTP.
 * (V1 spec §8)
 *
 * Endpoints:
 *   POST /v1/runs              — Create and start a run
 *   GET  /v1/runs/:runId/events — SSE event stream with replay
 *   POST /v1/approvals/:id     — Resolve an approval
 *   GET  /v1/sessions/:id/state — Get materialized state
 *   GET  /v1/health            — Health check
 */

import { Elysia, t } from 'elysia';
import { EventStore } from '@agent-os/event-store';
import { RunManager } from '@agent-os/run-manager';
import { ToolKernel, repoRead, repoSearch, repoPatch, processRun } from '@agent-os/tool-kernel';
import type { AgentEvent, RunConfig } from '@agent-os/core';

// ---------------------------------------------------------------------------
// Kernel factory
// ---------------------------------------------------------------------------

export function createKernel(opts: {
  dbPath?: string;
  workspace?: string;
}) {
  const eventStore = new EventStore(opts.dbPath ?? ':memory:');
  const runManager = new RunManager(eventStore);
  const toolKernel = new ToolKernel(opts.workspace ?? process.cwd());

  // Register capability tools
  toolKernel.register(repoRead);
  toolKernel.register(repoSearch);
  toolKernel.register(repoPatch);
  toolKernel.register(processRun);

  // Rebuild seq counters if using persisted DB
  if (opts.dbPath && opts.dbPath !== ':memory:') {
    eventStore.rebuildSeqCounters();
  }

  return { eventStore, runManager, toolKernel };
}

// ---------------------------------------------------------------------------
// App factory
// ---------------------------------------------------------------------------

export function createApp(kernel: ReturnType<typeof createKernel>) {
  const { eventStore, runManager, toolKernel } = kernel;

  const app = new Elysia()
    // -------------------------------------------------------------------
    // Health
    // -------------------------------------------------------------------
    .get('/v1/health', () => ({
      status: 'ok',
      ts: Date.now(),
    }))

    // -------------------------------------------------------------------
    // POST /v1/runs — Create and start a run
    // -------------------------------------------------------------------
    .post(
      '/v1/runs',
      async ({ body }) => {
        const config: RunConfig = {
          sessionId: body.sessionId,
          prompt: body.prompt,
          model: body.model,
          workspace: body.workspace,
          skills: body.skills,
          maxSteps: body.maxSteps,
        };

        try {
          const record = runManager.createRun(config);
          const startEvent = runManager.startRun(record.runId);

          return {
            runId: record.runId,
            sessionId: record.sessionId,
            state: record.state,
            startedAt: startEvent.ts,
          };
        } catch (error: any) {
          return new Response(
            JSON.stringify({ error: error.message }),
            { status: 409, headers: { 'Content-Type': 'application/json' } },
          );
        }
      },
      {
        body: t.Object({
          sessionId: t.String(),
          prompt: t.String(),
          model: t.Optional(t.String()),
          workspace: t.Optional(t.String()),
          skills: t.Optional(t.Array(t.String())),
          maxSteps: t.Optional(t.Number()),
        }),
      },
    )

    // -------------------------------------------------------------------
    // GET /v1/runs/:runId/events — SSE stream with replay
    // -------------------------------------------------------------------
    .get('/v1/runs/:runId/events', ({ params, request }) => {
      const runId = params.runId;

      // Check for Last-Event-ID header for replay
      const lastEventId = request.headers.get('Last-Event-ID');
      let afterSeq = 0;

      if (lastEventId) {
        // Find the seq of the last received event
        const events = eventStore.query({ runId });
        const lastEvent = events.find((e) => e.eventId === lastEventId);
        if (lastEvent) {
          afterSeq = lastEvent.seq;
        }
      }

      // Create SSE stream
      const stream = new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();

          const send = (event: AgentEvent) => {
            const data = JSON.stringify(event);
            const sseMessage = `id: ${event.eventId}\nevent: ${event.type}\ndata: ${data}\n\n`;
            try {
              controller.enqueue(encoder.encode(sseMessage));
            } catch {
              // Stream closed
            }
          };

          // Replay existing events (after the last received seq)
          const existingEvents = eventStore.query({
            runId,
            afterSeq,
            order: 'asc',
          });

          let isTerminal = false;
          for (const event of existingEvents) {
            send(event);
            if (event.type === 'run.completed' || event.type === 'run.failed') {
              isTerminal = true;
            }
          }

          // If the run is already terminal, close after replay
          if (isTerminal) {
            try { controller.close(); } catch { /* already closed */ }
            return;
          }

          // Subscribe to new events
          const unsub = runManager.onEvent((event) => {
            if (event.runId === runId) {
              send(event);
            }

            // Close stream on terminal events
            if (
              event.runId === runId &&
              (event.type === 'run.completed' || event.type === 'run.failed')
            ) {
              try {
                controller.close();
              } catch {
                // Already closed
              }
              unsub();
            }
          });

          // Clean up on abort
          request.signal.addEventListener('abort', () => {
            unsub();
            try {
              controller.close();
            } catch {
              // Already closed
            }
          });
        },
      });

      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'X-Accel-Buffering': 'no',
        },
      });
    })

    // -------------------------------------------------------------------
    // POST /v1/approvals/:approvalId — Resolve an approval
    // -------------------------------------------------------------------
    .post(
      '/v1/approvals/:approvalId',
      async ({ params, body }) => {
        try {
          runManager.approvalGate.resolveApproval(params.approvalId, {
            decision: body.decision,
            reason: body.reason,
          });

          return { status: 'resolved', approvalId: params.approvalId };
        } catch (error: any) {
          return new Response(
            JSON.stringify({ error: error.message }),
            { status: 404, headers: { 'Content-Type': 'application/json' } },
          );
        }
      },
      {
        body: t.Object({
          decision: t.Union([t.Literal('approve'), t.Literal('deny')]),
          reason: t.Optional(t.String()),
        }),
      },
    )

    // -------------------------------------------------------------------
    // GET /v1/sessions/:sessionId/state — Materialized state
    // -------------------------------------------------------------------
    .get('/v1/sessions/:sessionId/state', ({ params }) => {
      const sessionId = params.sessionId;

      // Get latest snapshot
      const snapshot = eventStore.getLatestSnapshot({ sessionId });
      const afterSeq = snapshot?.seq ?? 0;

      // Get events since snapshot
      const recentEvents = eventStore.query({
        sessionId,
        afterSeq,
        order: 'asc',
      });

      return {
        sessionId,
        snapshot: snapshot ?? null,
        pendingEvents: recentEvents,
        pendingApprovals: runManager.approvalGate.getPending(),
        ts: Date.now(),
      };
    });

  return app;
}
