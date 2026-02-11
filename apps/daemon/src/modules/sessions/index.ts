/**
 * Sessions module — Controller
 *
 * Routes:
 *   GET /v1/sessions/:sessionId/state — Materialized session state
 */

import { Elysia } from 'elysia';
import type { Kernel } from '../../kernel';
import { SessionService } from './service';

export const sessions = (kernel: Kernel) =>
  new Elysia({ prefix: '/v1/sessions' }).get(
    '/:sessionId/state',
    ({ params }) => {
      return SessionService.getState(
        kernel.eventStore,
        kernel.runManager,
        params.sessionId,
      );
    },
  );
