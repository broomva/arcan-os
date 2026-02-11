/**
 * Sessions module — Service (business logic)
 */

import type { EventStore } from '@agent-os/event-store';
import type { RunManager } from '@agent-os/run-manager';

export const SessionService = {
  /**
   * Get materialized state for a session: latest snapshot + pending events.
   */
  getState(eventStore: EventStore, runManager: RunManager, sessionId: string) {
    const snapshot = eventStore.getLatestSnapshot({ sessionId });
    const afterSeq = snapshot?.seq ?? 0;

    const pendingEvents = eventStore.query({
      sessionId,
      afterSeq,
      order: 'asc',
    });

    return {
      sessionId,
      snapshot: snapshot ?? null,
      pendingEvents,
      pendingApprovals: runManager.approvalGate.getPending(),
      ts: Date.now(),
    };
  },
};
