# Harness Upgrade Plan (Arcan OS)

This document captures an incremental plan to improve Arcan OS harness reliability,
focused on edit robustness and per-step repair loops.

## Why this plan

Model quality is not the only bottleneck in coding agents. Harness quality (tool
protocols, edit formats, error semantics, retries, and verification loops) heavily
influences end-to-end task success.

## Phase 1 — Anchored edits (partially shipped)

Implemented:

- Added `repo.edit` tool for anchored operations:
  - `replace-line`
  - `insert-after`
  - `replace-range`
- Added stale-read protection via optional `baseHash` precondition.
- Added structured failure reasons:
  - `file-not-found`
  - `stale-base`
  - `anchor-mismatch`
  - `invalid-range`
- Extended `repo.read` with optional `includeAnchors` so callers can request
  stable per-line hashes to drive anchored edit attempts.
- Added conflict controls in `repo.edit` with `mode`:
  - `atomic` (default): reject the entire edit set on any failure
  - `best-effort`: apply valid ops and report failures
- Added `anchorWindow` diagnostics on anchor mismatches so repair loops can
  deterministically refresh and retry.

Next in phase 1:

- Add conflict-safe batch semantics (all-or-nothing mode) for multi-op edits.
- Add explicit anchor-window metadata for safer retries.

## Phase 2 — Verification and repair loop

- Add step-level verify actions after write/edit operations.
- Route failures to deterministic repair playbooks (not open-ended retries).
- Emit structured run events for `step.verify` / `step.repair` outcomes.

## Phase 3 — Metrics and benchmarking

Track and report harness-centric metrics:

- edit success rate by format/tool
- retries per successful task
- anchor mismatch rate
- token overhead from retries
- time-to-first-valid-edit

## Rollout notes

- Keep `repo.patch` for backward compatibility.
- Prefer `repo.edit` for medium/large files and multi-change operations.
- Keep policy defaults conservative (`approval: always` for write tools).
- Ensure engine events always carry true `runId` (not `sessionId`) so harness
  analytics and replay diagnostics remain correct.
