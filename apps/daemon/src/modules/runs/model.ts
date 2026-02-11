/**
 * Runs module — Model (DTO schemas)
 *
 * Single source of truth for request/response shapes.
 * Uses Elysia's t.* (TypeBox) for runtime validation + type inference.
 */

import { t } from 'elysia';

export namespace RunModel {
  // -----------------------------------------------------------------------
  // POST /v1/runs
  // -----------------------------------------------------------------------

  export const createBody = t.Object({
    sessionId: t.String({ description: 'Unique session identifier' }),
    prompt: t.String({ description: 'User prompt to send to the agent' }),
    model: t.Optional(t.String({ description: 'Model spec: provider/model' })),
    workspace: t.Optional(t.String({ description: 'Workspace root path' })),
    skills: t.Optional(
      t.Array(t.String(), { description: 'Active skill names' }),
    ),
    maxSteps: t.Optional(t.Number({ description: 'Max agent loop steps' })),
  });
  export type createBody = typeof createBody.static;

  export const createResponse = t.Object({
    runId: t.String(),
    sessionId: t.String(),
    state: t.String(),
    startedAt: t.Number(),
  });
  export type createResponse = typeof createResponse.static;

  export const errorResponse = t.Object({
    error: t.String(),
  });
  export type errorResponse = typeof errorResponse.static;
}
