/**
 * Sessions module — Model (DTO schemas)
 */

import { t } from 'elysia';

export namespace SessionModel {
  export const listResponse = t.Array(t.String());
  export type listResponse = typeof listResponse.static;

  export const stateResponse = t.Object({
    sessionId: t.String(),
    snapshot: t.Any(),
    pendingEvents: t.Array(t.Any()),
    pendingApprovals: t.Array(t.Any()),
    ts: t.Number(),
  });
  export type stateResponse = typeof stateResponse.static;
}
