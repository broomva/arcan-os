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
  new Elysia({ prefix: '/v1/runs' })

    // -----------------------------------------------------------------
    // POST /v1/runs — Create and start a run
    // -----------------------------------------------------------------
    .post(
      '/',
      ({ body }) => {
        try {
          return RunService.createAndStart(kernel, {
            sessionId: body.sessionId,
            prompt: body.prompt,
            model: body.model,
            workspace: body.workspace,
            skills: body.skills,
            maxSteps: body.maxSteps,
          });
        } catch (error: any) {
          return new Response(
            JSON.stringify({ error: error.message }),
            { status: 409, headers: { 'Content-Type': 'application/json' } },
          );
        }
      },
      { body: RunModel.createBody },
    )

    // -----------------------------------------------------------------
    // GET /v1/runs/:runId/events — SSE event stream with replay
    // -----------------------------------------------------------------
    .get('/:runId/events', ({ params, request }) => {
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
          'Connection': 'keep-alive',
          'X-Accel-Buffering': 'no',
        },
      });
    });
