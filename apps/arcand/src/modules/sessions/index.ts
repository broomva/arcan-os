/**
 * Sessions module — Controller
 *
 * Routes:
 *   GET /v1/sessions/list             — List all session IDs
 *   GET /v1/sessions/:sessionId/state — Materialized session state
 */

import { Elysia } from 'elysia';
import type { Kernel } from '../../kernel';
import { SessionModel } from './model';
import { SessionService } from './service';

export const sessionsList = (kernel: Kernel) =>
  new Elysia({ tags: ['Sessions'] }).get(
    '/v1/sessions/list',
    () => kernel.eventStore.listSessionIds(),
    {
      response: SessionModel.listResponse,
      detail: {
        summary: 'List sessions',
        description:
          'Returns all session IDs, ordered by most recent activity.',
      },
    },
  );

export const sessions = (kernel: Kernel) =>
  new Elysia({ prefix: '/v1/sessions', tags: ['Sessions'] }).get(
    '/:sessionId/state',
    ({ params }) => {
      return SessionService.getState(
        kernel.eventStore,
        kernel.runManager,
        params.sessionId,
      );
    },
    {
      response: SessionModel.stateResponse,
      detail: {
        summary: 'Get session state',
        description:
          'Returns the materialized session state: latest snapshot, pending events since that snapshot, and any pending approvals.',
      },
    },
  );
