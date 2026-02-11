/**
 * Approvals module — Service (business logic)
 */

import type { ApprovalGate } from '@agent-os/run-manager';

export abstract class ApprovalService {
  /**
   * Resolve a pending approval. Throws if the approval ID is not found.
   */
  static resolve(
    gate: ApprovalGate,
    approvalId: string,
    decision: { decision: 'approve' | 'deny'; reason?: string },
  ) {
    gate.resolveApproval(approvalId, decision);
    return { status: 'resolved' as const, approvalId };
  }
}
