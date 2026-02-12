/**
 * @arcan-os/arcand — App Factory
 *
 * Composes all Elysia modules into a single app instance.
 * Each module is a self-contained Elysia instance with its own
 * prefix, routes, validation, and service logic.
 */

import { openapi } from '@elysiajs/openapi';
import { Elysia } from 'elysia';
import type { Kernel } from './kernel';

import { approvals } from './modules/approvals';
// Modules
import { health } from './modules/health';
import { runs } from './modules/runs';
import { sessions, sessionsList } from './modules/sessions';

// ---------------------------------------------------------------------------
// App factory
// ---------------------------------------------------------------------------

export function createApp(kernel: Kernel) {
  return new Elysia()
    .use(
      openapi({
        path: '/openapi',
        provider: 'scalar',
        documentation: {
          info: {
            title: 'Arcan OS',
            version: '0.1.0',
            description: 'Event-sourced AI agent runtime API',
          },
          tags: [
            { name: 'Health', description: 'Health checks' },
            { name: 'Runs', description: 'Run lifecycle management' },
            { name: 'Approvals', description: 'Tool approval gate' },
            { name: 'Sessions', description: 'Session state projections' },
          ],
        },
      }),
    )
    .use(health)
    .onRequest(({ request }) => {
      console.log(`[App:${Date.now()}] ${request.method} ${request.url}`);
    })
    .use(runs(kernel))
    .use(approvals(kernel))
    .use(sessionsList(kernel))
    .use(sessions(kernel));
}
