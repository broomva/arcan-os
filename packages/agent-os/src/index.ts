/**
 * agent-os — Meta-package that re-exports all Agent OS packages.
 *
 * Install with: bun install agent-os
 * This gives you access to all @arcan-os/* packages plus the `agent` CLI command.
 */

export * as Context from '@arcan-os/context';
export * from '@arcan-os/core';
export * as EngineAdapter from '@arcan-os/engine-adapter';
export * as EventStore from '@arcan-os/event-store';
export * as Memory from '@arcan-os/memory';
export * as Observability from '@arcan-os/observability';
export * as RunManager from '@arcan-os/run-manager';
export * as Skills from '@arcan-os/skills';
export * as ToolKernel from '@arcan-os/tool-kernel';
