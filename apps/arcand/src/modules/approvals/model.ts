/**
 * Approvals module — Model (DTO schemas)
 */

import { t } from 'elysia';

export namespace ApprovalModel {
  export const resolveBody = t.Object({
    decision: t.Union([t.Literal('approve'), t.Literal('deny')]),
    reason: t.Optional(t.String()),
  });
  export type resolveBody = typeof resolveBody.static;

  export const resolveResponse = t.Object({
    status: t.Literal('resolved'),
    approvalId: t.String(),
  });
  export type resolveResponse = typeof resolveResponse.static;

  export const errorResponse = t.Object({
    error: t.String(),
  });
  export type errorResponse = typeof errorResponse.static;
}
