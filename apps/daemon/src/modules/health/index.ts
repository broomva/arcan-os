/**
 * Health module — GET /v1/health
 */

import { Elysia, t } from 'elysia';

export const health = new Elysia({
  prefix: '/v1/health',
  tags: ['Health'],
}).get(
  '/',
  () => ({
    status: 'ok' as const,
    version: '0.1.0',
    ts: Date.now(),
  }),
  {
    response: t.Object({
      status: t.Literal('ok'),
      version: t.String(),
      ts: t.Number(),
    }),
    detail: { summary: 'Health check' },
  },
);
