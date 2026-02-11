/**
 * Approvals module — Controller
 *
 * Routes:
 *   POST /v1/approvals/:approvalId — Resolve a pending approval
 */

import { Elysia } from 'elysia';
import type { Kernel } from '../../kernel';
import { ApprovalModel } from './model';
import { ApprovalService } from './service';

export const approvals = (kernel: Kernel) =>
  new Elysia({ prefix: '/v1/approvals' })

    .post(
      '/:approvalId',
      ({ params, body }) => {
        try {
          return ApprovalService.resolve(
            kernel.runManager.approvalGate,
            params.approvalId,
            { decision: body.decision, reason: body.reason },
          );
        } catch (error: any) {
          return new Response(
            JSON.stringify({ error: error.message }),
            { status: 404, headers: { 'Content-Type': 'application/json' } },
          );
        }
      },
      { body: ApprovalModel.resolveBody },
    );
