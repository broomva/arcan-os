/**
 * @arcan-os/run-manager — Approval Gate
 *
 * Manages pending approvals as deferred promises.
 * When a tool requires approval, the gate creates a pending entry
 * and the run pauses until resolved via the HTTP API.
 */

import type { RiskProfile } from '@arcan-os/core';
import { generateId } from '@arcan-os/core';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PendingApproval {
  approvalId: string;
  callId: string;
  toolId: string;
  args: Record<string, unknown>;
  preview: Record<string, unknown>;
  risk: RiskProfile;
  createdAt: number;
}

export interface ApprovalDecision {
  decision: 'approve' | 'deny';
  reason?: string;
  resolvedBy?: string;
}

// ---------------------------------------------------------------------------
// Approval Gate
// ---------------------------------------------------------------------------

export class ApprovalGate {
  private pending = new Map<
    string,
    {
      approval: PendingApproval;
      resolve: (decision: ApprovalDecision) => void;
      reject: (error: Error) => void;
    }
  >();

  /**
   * Request approval for a tool call.
   * Returns a promise that resolves when the approval is resolved.
   */
  requestApproval(params: {
    callId: string;
    toolId: string;
    args: Record<string, unknown>;
    preview: Record<string, unknown>;
    risk: RiskProfile;
  }): { approvalId: string; promise: Promise<ApprovalDecision> } {
    const approvalId = generateId();
    const approval: PendingApproval = {
      approvalId,
      ...params,
      createdAt: Date.now(),
    };

    let resolve!: (decision: ApprovalDecision) => void;
    let reject!: (error: Error) => void;

    const promise = new Promise<ApprovalDecision>((res, rej) => {
      resolve = res;
      reject = rej;
    });

    this.pending.set(approvalId, { approval, resolve, reject });

    return { approvalId, promise };
  }

  /**
   * Resolve a pending approval.
   * Called by the arcand when the user approves/denies via HTTP.
   */
  resolveApproval(approvalId: string, decision: ApprovalDecision): void {
    const entry = this.pending.get(approvalId);
    if (!entry) {
      throw new Error(`No pending approval with id: ${approvalId}`);
    }
    this.pending.delete(approvalId);
    entry.resolve(decision);
  }

  /**
   * Reject a pending approval (e.g., on run cancellation).
   */
  cancelApproval(approvalId: string): void {
    const entry = this.pending.get(approvalId);
    if (entry) {
      this.pending.delete(approvalId);
      entry.reject(new Error('Approval cancelled'));
    }
  }

  /**
   * Cancel all pending approvals (e.g., on run failure).
   */
  cancelAll(): void {
    for (const [_id, entry] of this.pending) {
      entry.reject(new Error('All approvals cancelled'));
    }
    this.pending.clear();
  }

  /**
   * Get all currently pending approvals.
   */
  getPending(): PendingApproval[] {
    return Array.from(this.pending.values()).map((e) => e.approval);
  }

  /**
   * Check if an approval is pending.
   */
  hasPending(approvalId: string): boolean {
    return this.pending.has(approvalId);
  }

  /**
   * Number of pending approvals.
   */
  get size(): number {
    return this.pending.size;
  }
}
