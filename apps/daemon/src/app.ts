/**
 * @agent-os/daemon — App Factory
 *
 * Composes all Elysia modules into a single app instance.
 * Each module is a self-contained Elysia instance with its own
 * prefix, routes, validation, and service logic.
 */

import { Elysia } from 'elysia';
import type { Kernel } from './kernel';

import { approvals } from './modules/approvals';
// Modules
import { health } from './modules/health';
import { runs } from './modules/runs';
import { sessions } from './modules/sessions';

// ---------------------------------------------------------------------------
// App factory
// ---------------------------------------------------------------------------

export function createApp(kernel: Kernel) {
  return new Elysia()
    .use(health)
    .use(runs(kernel))
    .use(approvals(kernel))
    .use(sessions(kernel));
}
