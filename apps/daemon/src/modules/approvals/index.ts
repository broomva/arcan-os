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
  new Elysia({ prefix: '/v1/approvals', tags: ['Approvals'] }).post(
    '/:approvalId',
    ({ params, body, status }) => {
      try {
        return ApprovalService.resolve(
          kernel.runManager.approvalGate,
          params.approvalId,
          { decision: body.decision, reason: body.reason },
        );
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return status(404, { error: message });
      }
    },
    {
      body: ApprovalModel.resolveBody,
      response: {
        200: ApprovalModel.resolveResponse,
        404: ApprovalModel.errorResponse,
      },
      detail: {
        summary: 'Resolve a pending approval',
        description:
          'Approves or denies a tool execution that is waiting for human review.',
      },
    },
  );
