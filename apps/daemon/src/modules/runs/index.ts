/**
 * Runs module — Controller
 *
 * Routes:
 *   POST /v1/runs              — Create and start a run
 *   GET  /v1/runs/:runId/events — SSE event stream with replay
 */

import { Elysia } from 'elysia';
import type { Kernel } from '../../kernel';
import { RunModel } from './model';
import { RunService } from './service';

export const runs = (kernel: Kernel) =>
  new Elysia({ prefix: '/v1/runs', tags: ['Runs'] })

    // -----------------------------------------------------------------
    // POST /v1/runs — Create and start a run
    // -----------------------------------------------------------------
    .post(
      '/',
      async ({ body, status }) => {
        console.error('[API] POST /v1/runs called');
        try {
          const run = await RunService.createAndStart(kernel, {
            sessionId: body.sessionId,
            prompt: body.prompt,
            model: body.model,
            workspace: body.workspace,
            skills: body.skills,
            maxSteps: body.maxSteps,
          });
          console.error(`[API] Returning run: ${JSON.stringify(run)}`);
          return run;
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          return status(409, { error: message });
        }
      },
      {
        body: RunModel.createBody,
        response: { 200: RunModel.createResponse, 409: RunModel.errorResponse },
        detail: {
          summary: 'Create and start a run',
          description:
            'Creates a new agent run and starts the engine loop in the background. Returns the run record synchronously.',
        },
      },
    )

    // -----------------------------------------------------------------
    // GET /v1/runs/:runId/events — SSE event stream with replay
    // -----------------------------------------------------------------
    .get(
      '/:runId/events',
      ({ params, request }) => {
        const stream = RunService.buildEventStream(
          kernel,
          params.runId,
          request.headers.get('Last-Event-ID'),
          request.signal,
        );

        return new Response(stream, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no',
          },
        });
      },
      {
        detail: {
          summary: 'Stream run events (SSE)',
          description:
            'Server-Sent Event stream that replays existing events then streams live events. Supports resumption via the Last-Event-ID header.',
        },
      },
    );
