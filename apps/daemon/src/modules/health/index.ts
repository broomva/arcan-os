/**
 * Health module — GET /v1/health
 */

import { Elysia } from 'elysia';

export const health = new Elysia({ prefix: '/v1/health' })
  .get('/', () => ({
    status: 'ok' as const,
    version: '0.1.0',
    ts: Date.now(),
  }));
