/**
 * agent-os — Meta-package that re-exports all Agent OS packages.
 *
 * Install with: bun install agent-os
 * This gives you access to all @agent-os/* packages plus the `agent` CLI command.
 */

export * as Context from '@agent-os/context';
export * from '@agent-os/core';
export * as EngineAdapter from '@agent-os/engine-adapter';
export * as EventStore from '@agent-os/event-store';
export * as Memory from '@agent-os/memory';
export * as Observability from '@agent-os/observability';
export * as RunManager from '@agent-os/run-manager';
export * as Skills from '@agent-os/skills';
export * as ToolKernel from '@agent-os/tool-kernel';
